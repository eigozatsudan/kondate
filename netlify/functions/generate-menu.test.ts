import { beforeEach, describe, expect, it, vi } from "vitest";
import { scenarios } from "../../tools/openrouter-mock/fixtures/scenarios.mjs";
import {
  generationConflictCopy,
  generationFailureCodes,
  type GenerationStatusData,
} from "../../shared/contracts/generation.js";
import { validateGeneratedMenu } from "../../shared/safety/validate-generated-menu.js";
import {
  makeGeneratedMenu,
  makeGenerationContext,
  makeValidatedMenu,
} from "../../shared/testing/factories.js";
import { requireUser } from "./_shared/auth.js";
import { materializeAiGeneratedMenu } from "./_shared/generation-materializer.js";
import type { QuotaRequestRecord } from "./_shared/generation-repository.js";
import {
  createGenerationDeps,
  runGeneration,
  type GenerationDependencies,
  type GenerationExecutionContext,
} from "./_shared/generation-service.js";
import { HttpError } from "./_shared/http.js";
import handler from "./generate-menu.js";

vi.mock("./_shared/auth.js", () => ({ requireUser: vi.fn() }));
vi.mock("../../shared/safety/validate-generated-menu.js", () => ({
  validateGeneratedMenu: vi.fn(),
}));
vi.mock("./_shared/generation-materializer.js", () => ({
  materializeAiGeneratedMenu: vi.fn(),
}));
vi.mock("./_shared/generation-service.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./_shared/generation-service.js")>();
  return {
    ...original,
    createGenerationDeps: vi.fn(),
    runGeneration: vi.fn(),
  };
});

const user = {
  userId: "85000000-0000-4000-8000-000000000001",
  accessToken: "token",
};
const requestBody = {
  idempotencyKey: "82000000-0000-4000-8000-000000000001",
  draftId: "84000000-0000-4000-8000-000000000001",
  draftRevision: 1,
  privacyNoticeVersion: "2026-07-11.v1",
  expiredPantryConfirmations: [],
};
const terminalResult: GenerationStatusData = {
  status: "succeeded",
  idempotencyKey: requestBody.idempotencyKey,
  requestId: "81000000-0000-4000-8000-000000000001",
  quota: {
    consumed: true,
    remaining: 4,
    userDailyLimit: 5,
    limitKind: null,
    retryAt: null,
  },
  menuId: "83000000-0000-4000-8000-000000000001",
  completedAt: "2026-07-11T00:00:01.000Z",
};
const quota = {
  consumed: false,
  remaining: 5,
  userDailyLimit: 5 as const,
  limitKind: null,
  retryAt: null,
};

function expectedFailureStatus(code: (typeof generationFailureCodes)[number]): number {
  if (["user_daily_limit", "user_attempt_limit", "user_short_window_limit"].includes(code)) {
    return 429;
  }
  if (["global_daily_limit", "model_unavailable", "generation_timeout"].includes(code)) {
    return 503;
  }
  return 422;
}

const canonicalResponseCases: readonly [string, GenerationStatusData, number][] = [
  [
    "not_started",
    { status: "not_started", idempotencyKey: requestBody.idempotencyKey, quota },
    200,
  ],
  [
    "processing",
    {
      status: "processing",
      idempotencyKey: requestBody.idempotencyKey,
      requestId: terminalResult.requestId,
      quota,
      startedAt: "2026-07-11T00:00:00.000Z",
    },
    202,
  ],
  ["succeeded", terminalResult, 200],
  [
    "constraint_conflict",
    {
      status: "constraint_conflict",
      idempotencyKey: requestBody.idempotencyKey,
      requestId: terminalResult.requestId,
      quota,
      conflicts: [
        {
          code: "must_use_conflict",
          message: generationConflictCopy.must_use_conflict,
          conditionRefs: [],
        },
      ],
      completedAt: terminalResult.completedAt,
    },
    200,
  ],
  ...generationFailureCodes.map((code): [string, GenerationStatusData, number] => [
    `failed:${code}`,
    {
      status: "failed",
      idempotencyKey: requestBody.idempotencyKey,
      requestId: terminalResult.requestId,
      quota,
      error: { code, message: "固定文言", retryable: false },
      completedAt: terminalResult.completedAt,
    },
    expectedFailureStatus(code),
  ]),
];

function postRequest(body: unknown = requestBody, headers?: Record<string, string>): Request {
  return new Request("http://127.0.0.1:5173/api/generations/menu", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue(user);
  vi.mocked(createGenerationDeps).mockReturnValue({} as GenerationDependencies);
  vi.mocked(runGeneration).mockResolvedValue(terminalResult);
});

describe("POST /api/generations/menu", () => {
  it("rejects other methods before authentication or orchestration", async () => {
    const response = await handler(
      new Request("http://127.0.0.1:5173/api/generations/menu", { method: "GET" }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(requireUser).not.toHaveBeenCalled();
    expect(createGenerationDeps).not.toHaveBeenCalled();
    expect(runGeneration).not.toHaveBeenCalled();
  });

  it("rejects a request without a verified access token", async () => {
    vi.mocked(requireUser).mockRejectedValue(
      new HttpError(401, "auth_required", "ログインが必要です"),
    );

    const response = await handler(postRequest());

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: { code: "auth_required", message: "ログインが必要です" },
    });
    expect(createGenerationDeps).not.toHaveBeenCalled();
    expect(runGeneration).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid JSON", "{sentinel", "invalid_json"],
    ["unknown field", { ...requestBody, sentinel: true }, "invalid_request"],
    ["missing consent", { ...requestBody, privacyNoticeVersion: undefined }, "invalid_request"],
    ["invalid consent", { ...requestBody, privacyNoticeVersion: "sentinel" }, "invalid_request"],
  ])("rejects %s without orchestration", async (_label, body, code) => {
    const response = await handler(postRequest(body));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code } });
    expect(createGenerationDeps).not.toHaveBeenCalled();
    expect(runGeneration).not.toHaveBeenCalled();
  });

  it("rejects an oversized body through the existing parser boundary", async () => {
    const response = await handler(postRequest(requestBody, { "content-length": "65537" }));

    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "request_too_large" },
    });
    expect(runGeneration).not.toHaveBeenCalled();
  });

  it("keeps the existing boundary without adding origin or content-type requirements", async () => {
    const response = await handler(
      new Request("http://127.0.0.1:5173/api/generations/menu", {
        method: "POST",
        headers: { authorization: "Bearer token", origin: "https://sentinel.invalid" },
        body: JSON.stringify(requestBody),
      }),
    );

    expect(response.status).toBe(200);
    expect(runGeneration).toHaveBeenCalledTimes(1);
  });

  it("captures entry time before authentication and projects the result canonically", async () => {
    const order: string[] = [];
    const now = vi.spyOn(performance, "now").mockImplementation(() => {
      order.push("time");
      return 1234.5;
    });
    vi.mocked(requireUser).mockImplementation(() => {
      order.push("auth");
      return Promise.resolve(user);
    });
    const deps = {} as GenerationDependencies;
    vi.mocked(createGenerationDeps).mockReturnValue(deps);

    const response = await handler(postRequest());

    expect(order.slice(0, 2)).toEqual(["time", "auth"]);
    expect(createGenerationDeps).toHaveBeenCalledWith(user, {
      requestStartedAtMonotonicMs: 1234.5,
    });
    expect(runGeneration).toHaveBeenCalledTimes(1);
    expect(runGeneration).toHaveBeenCalledWith(deps, {
      kind: "new_menu",
      request: requestBody,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ok: true, data: terminalResult });
    now.mockRestore();
  });

  it.each(canonicalResponseCases)(
    "projects %s through the complete canonical POST boundary",
    async (_label, result, expectedStatus) => {
      vi.mocked(runGeneration).mockResolvedValue(result);

      const response = await handler(postRequest());

      expect(response.status).toBe(expectedStatus);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({ ok: true, data: result });
      expect(runGeneration).toHaveBeenCalledTimes(1);
    },
  );

  it("hydrates a same-key terminal replay without duplicating generation side effects", async () => {
    const actualService = await vi.importActual<typeof import("./_shared/generation-service.js")>(
      "./_shared/generation-service.js",
    );
    const requestId = terminalResult.requestId;
    const modelId = "mock/primary:free";
    let reservationCreations = 0;
    let current: QuotaRequestRecord = {
      request_id: requestId,
      idempotency_key: requestBody.idempotencyKey,
      status: "processing",
      failure_code: null,
      retry_at: null,
      completed_menu_id: null,
      remaining: 5,
      user_daily_limit: 5,
      consumed: false,
      terminal_details: null,
      started_at: "2026-07-11T00:00:00.000Z",
      completed_at: null,
      replayed: false,
    };
    const knownReservations = new Set<string>();
    const repository: GenerationDependencies["repository"] = {
      reserve: vi.fn((command: { request: { idempotencyKey: string } }) => {
        if (!knownReservations.has(command.request.idempotencyKey)) {
          knownReservations.add(command.request.idempotencyKey);
          reservationCreations += 1;
          return Promise.resolve(current);
        }
        return Promise.resolve({ ...current, replayed: true });
      }),
      markSent: vi.fn(() => Promise.resolve({ ...current, sent: true as const, code: null })),
      reserveRepair: vi.fn(() => Promise.resolve({ reserved: false, retry_at: null })),
      recordModel: vi.fn(() => Promise.resolve()),
      fail: vi.fn(() => Promise.resolve(current)),
      failBeforeSend: vi.fn(() => Promise.resolve(current)),
      conflict: vi.fn(() => Promise.resolve(current)),
      succeed: vi.fn(() => {
        current = {
          ...current,
          status: "succeeded",
          completed_menu_id: terminalResult.menuId,
          completed_at: terminalResult.completedAt,
          remaining: 4,
          consumed: true,
        };
        return Promise.resolve(current);
      }),
      status: vi.fn(() => Promise.resolve(current)),
    };
    const generationContext = makeGenerationContext();
    const executionContext: Extract<GenerationExecutionContext, { kind: "new_menu" }> = {
      kind: "new_menu",
      command: {
        kind: "new_menu",
        request: {
          idempotencyKey: "82000000-0000-4000-8000-000000000001",
          draftId: "84000000-0000-4000-8000-000000000001",
          draftRevision: 1,
          privacyNoticeVersion: "2026-07-11.v1",
          expiredPantryConfirmations: [],
        },
      },
      requestId: "81000000-0000-4000-8000-000000000001",
      generationContext,
      expectedSafetyFingerprint: "sha256:test-fingerprint",
      startedAtMonotonicMs: 0,
      deadlineAtMonotonicMs: 50_000,
      regeneration: null,
    };
    const loadExecutionContext = vi.fn(() => Promise.resolve(executionContext));
    const validatePreflight = vi.fn(() => ({ ok: true as const }));
    const buildMessages = vi.fn(() => [{ role: "user" as const, content: "prompt" }]);
    const callOpenRouter = vi.fn(() => Promise.resolve({ output: scenarios.success, modelId }));
    const deps: GenerationDependencies = {
      user,
      repository,
      models: [modelId],
      loadExecutionContext,
      validatePreflight,
      buildMessages,
      callOpenRouter,
      now: () => new Date("2026-07-11T00:00:00.000Z"),
      monotonicNow: () => 0,
      openRouterTimeoutMs: 20_000,
      requestStartedAtMonotonicMs: 0,
      functionTotalBudgetMs: 50_000,
      uuid: () => "86000000-0000-4000-8000-000000000001",
    };
    vi.mocked(materializeAiGeneratedMenu).mockReturnValue(makeGeneratedMenu());
    vi.mocked(validateGeneratedMenu).mockReturnValue({
      ok: true,
      menu: makeValidatedMenu(),
      labelConfirmations: [],
      safetyFingerprint: "sha256:test",
    });
    vi.mocked(createGenerationDeps).mockReturnValue(deps);
    vi.mocked(runGeneration).mockImplementation(actualService.runGeneration);

    const firstResponse = await handler(postRequest());
    const replayResponse = await handler(postRequest());

    expect(firstResponse.status).toBe(200);
    expect(replayResponse.status).toBe(200);
    await expect(firstResponse.json()).resolves.toEqual({ ok: true, data: terminalResult });
    await expect(replayResponse.json()).resolves.toEqual({ ok: true, data: terminalResult });
    expect(repository.reserve).toHaveBeenCalledTimes(2);
    expect(reservationCreations).toBe(1);
    expect(loadExecutionContext).toHaveBeenCalledTimes(1);
    expect(validatePreflight).toHaveBeenCalledTimes(1);
    expect(buildMessages).toHaveBeenCalledTimes(1);
    expect(repository.markSent).toHaveBeenCalledTimes(1);
    expect(callOpenRouter).toHaveBeenCalledTimes(1);
    expect(repository.recordModel).toHaveBeenCalledTimes(1);
    expect(repository.succeed).toHaveBeenCalledTimes(1);
    expect(repository.fail).not.toHaveBeenCalled();
    expect(repository.conflict).not.toHaveBeenCalled();
    expect(repository.status).toHaveBeenCalledTimes(2);
  });
});
