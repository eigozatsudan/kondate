import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generationConflictCopy,
  generationFailureCodes,
  type GenerationStatusData,
} from "../../../shared/contracts/generation.js";
import { requireUserWithEmail } from "../_shared/auth.js";
import type { QuotaRequestRecord } from "../_shared/generation-repository.js";
import {
  createGenerationDeps,
  getGenerationFailureCopy,
  reserveGeneration,
  type GenerationDependencies,
} from "../_shared/generation-service.js";
import { HttpError } from "../_shared/http.js";
import { readLocalMockScenario } from "../_shared/local-mock-scenario.js";
import { dispatchMenuGeneration } from "../_shared/menu-background.js";
vi.mock("../_shared/menu-background.js", () => ({
  dispatchMenuGeneration: vi.fn(() => Promise.resolve()),
}));
import handler from "../generate-menu.js";

vi.mock("../_shared/generation-integrity-context.js", () => ({
  resolveGenerationIntegrityContext: vi.fn(() =>
    Promise.resolve({
      kind: "new_menu",
      targetMode: "household",
      servings: null,
      targetMemberIds: ["90000000-0000-4000-8000-000000000001"],
      sourceMenuVersion: null,
    }),
  ),
}));
vi.mock("../_shared/supabase-admin.js", () => ({
  getSupabaseAdmin: vi.fn(() => ({})),
}));
vi.mock("../_shared/auth.js", () => ({ requireUserWithEmail: vi.fn() }));
vi.mock("../../../shared/safety/validate-generated-menu.js", () => ({
  validateGeneratedMenu: vi.fn(),
}));
vi.mock("../_shared/generation-materializer.js", () => ({
  materializeAiGeneratedMenu: vi.fn(),
}));
vi.mock("../_shared/local-mock-scenario.js", () => ({
  readLocalMockScenario: vi.fn(() => undefined),
}));
vi.mock("../_shared/generation-service.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../_shared/generation-service.js")>();
  return {
    ...original,
    createGenerationDeps: vi.fn(),
    reserveGeneration: vi.fn(),
  };
});

const user = {
  userId: "85000000-0000-4000-8000-000000000001",
  accessToken: "token",
  email: "owner@example.com",
};
const requestBody = {
  commandVersion: "generation-command.v3" as const,
  kind: "new_menu" as const,
  qualityMode: false,
  request: {
    idempotencyKey: "82000000-0000-4000-8000-000000000001",
    draftId: "84000000-0000-4000-8000-000000000001",
    draftRevision: 1,
    privacyNoticeVersion: "2026-07-29.v1",
    expiredPantryConfirmations: [],
  },
};
const terminalResult: GenerationStatusData = {
  status: "succeeded",
  idempotencyKey: requestBody.request.idempotencyKey,
  requestId: "81000000-0000-4000-8000-000000000001",
  quota: {
    consumed: true,
    remaining: 0,
    userDailyLimit: 1,
    limitKind: null,
    retryAt: null,
  },
  menuId: "83000000-0000-4000-8000-000000000001",
  completedAt: "2026-07-11T00:00:01.000Z",
};
const quota = {
  consumed: false,
  remaining: 1,
  userDailyLimit: 1 as const,
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
    { status: "not_started", idempotencyKey: requestBody.request.idempotencyKey, quota },
    200,
  ],
  [
    "processing",
    {
      status: "processing",
      idempotencyKey: requestBody.request.idempotencyKey,
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
      idempotencyKey: requestBody.request.idempotencyKey,
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
      idempotencyKey: requestBody.request.idempotencyKey,
      requestId:
        code === "generation_in_progress"
          ? "00000000-0000-4000-8000-000000000098"
          : terminalResult.requestId,
      quota: {
        ...quota,
        limitKind:
          code === "user_daily_limit"
            ? "user"
            : code === "global_daily_limit"
              ? "global"
              : code === "model_unavailable"
                ? "provider"
                : null,
      },
      error: { code, ...getGenerationFailureCopy(code) },
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

function toRecord(data: GenerationStatusData): QuotaRequestRecord {
  return {
    status: data.status,
    idempotency_key: data.idempotencyKey,
    request_id: "requestId" in data ? data.requestId : undefined,
    user_daily_limit: data.quota.userDailyLimit,
    consumed: data.quota.consumed,
    remaining: data.quota.remaining,
    retry_at: data.quota.retryAt,
    failure_code: data.status === "failed" ? data.error.code : null,
    started_at: data.status === "processing" ? data.startedAt : undefined,
    completed_at: "completedAt" in data ? data.completedAt : null,
    completed_menu_id: data.status === "succeeded" ? data.menuId : null,
    terminal_details:
      data.status === "constraint_conflict"
        ? { conflictCodes: data.conflicts.map((conflict) => conflict.code) }
        : null,
  };
}
const statusMock = vi.fn(() => Promise.resolve(toRecord(terminalResult)));
const callOpenRouter = vi.fn<GenerationDependencies["callOpenRouter"]>();
const deps: GenerationDependencies = {
  user,
  models: [],
  repository: {
    lookup: vi.fn(),
    replayExisting: vi.fn(),
    reserveNew: vi.fn(),
    markSent: vi.fn(),
    fail: vi.fn(),
    failBeforeSend: vi.fn(),
    reserveRepair: vi.fn(),
    recordModel: vi.fn(),
    conflict: vi.fn(),
    succeed: vi.fn(),
    status: statusMock,
  },
  loadExecutionContext: vi.fn(),
  validatePreflight: vi.fn(),
  buildMessages: vi.fn(),
  callOpenRouter,
  now: () => new Date(),
  monotonicNow: () => 0,
  uuid: () => "uuid",
  openRouterTimeoutMs: 20_000,
  functionTotalBudgetMs: 26_000,
  requestStartedAtMonotonicMs: 0,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUserWithEmail).mockResolvedValue(user);
  vi.mocked(createGenerationDeps).mockReturnValue(deps);
  vi.mocked(reserveGeneration).mockResolvedValue(toRecord(terminalResult));
  statusMock.mockResolvedValue(toRecord(terminalResult));
  vi.mocked(readLocalMockScenario).mockReturnValue(undefined);
});

describe("POST /api/generations/menu", () => {
  it("rejects other methods before authentication or orchestration", async () => {
    const response = await handler(
      new Request("http://127.0.0.1:5173/api/generations/menu", { method: "GET" }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(requireUserWithEmail).not.toHaveBeenCalled();
    expect(createGenerationDeps).not.toHaveBeenCalled();
    expect(reserveGeneration).not.toHaveBeenCalled();
  });

  it("rejects a request without a verified access token", async () => {
    vi.mocked(requireUserWithEmail).mockRejectedValue(
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
    expect(reserveGeneration).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid JSON", "{sentinel", "invalid_json"],
    ["unknown field", { ...requestBody, sentinel: true }, "invalid_request"],
    [
      "missing consent",
      {
        ...requestBody,
        request: { ...requestBody.request, privacyNoticeVersion: undefined },
      },
      "invalid_request",
    ],
    [
      "invalid consent",
      {
        ...requestBody,
        request: { ...requestBody.request, privacyNoticeVersion: "sentinel" },
      },
      "invalid_request",
    ],
  ])("rejects %s without orchestration", async (_label, body, code) => {
    const response = await handler(postRequest(body));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code } });
    expect(createGenerationDeps).not.toHaveBeenCalled();
    expect(reserveGeneration).not.toHaveBeenCalled();
  });

  it("rejects an oversized body through the existing parser boundary", async () => {
    const response = await handler(postRequest(requestBody, { "content-length": "65537" }));

    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "request_too_large" },
    });
    expect(reserveGeneration).not.toHaveBeenCalled();
  });

  it("does not require Origin; parseJson still requires JSON Content-Type", async () => {
    // Origin は generate-menu では検査しない（sentinel でも通過）。
    // Content-Type は parseJson 境界で application/json（+json）を要求する。
    const response = await handler(
      new Request("http://127.0.0.1:5173/api/generations/menu", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          origin: "https://sentinel.invalid",
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }),
    );

    expect(response.status).toBe(200);
    expect(reserveGeneration).toHaveBeenCalledTimes(1);
  });

  it("captures entry time before authentication and projects the result canonically", async () => {
    const order: string[] = [];
    const now = vi.spyOn(performance, "now").mockImplementation(() => {
      order.push("time");
      return 1234.5;
    });
    vi.mocked(requireUserWithEmail).mockImplementation(() => {
      order.push("auth");
      return Promise.resolve(user);
    });
    vi.mocked(createGenerationDeps).mockReturnValue(deps);

    const response = await handler(postRequest());

    expect(order.slice(0, 2)).toEqual(["time", "auth"]);
    expect(createGenerationDeps).toHaveBeenCalledWith(user, {
      requestStartedAtMonotonicMs: 1234.5,
    });
    expect(reserveGeneration).toHaveBeenCalledTimes(1);
    expect(reserveGeneration).toHaveBeenCalledWith(deps, requestBody);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ok: true, data: terminalResult });
    now.mockRestore();
  });

  it("forwards localTestScenario when the local mock header is honored", async () => {
    vi.mocked(readLocalMockScenario).mockReturnValue("duplicate-menu");
    await handler(postRequest(requestBody, { "x-kondate-mock-scenario": "duplicate-menu" }));
    const depsArgs = vi.mocked(createGenerationDeps).mock.calls[0];
    expect(depsArgs?.[0]).toEqual(user);
    expect(depsArgs?.[1]).toMatchObject({
      localTestScenario: "duplicate-menu",
    });
    expect(typeof depsArgs?.[1]?.requestStartedAtMonotonicMs).toBe("number");
  });

  it("does not pass localTestScenario when the mock header is ignored (production base)", async () => {
    // readLocalMockScenario が production base で undefined を返す経路を再現
    vi.mocked(readLocalMockScenario).mockReturnValue(undefined);
    await handler(postRequest(requestBody, { "x-kondate-mock-scenario": "duplicate-menu" }));
    const depsArgs = vi.mocked(createGenerationDeps).mock.calls[0];
    expect(depsArgs?.[0]).toEqual(user);
    expect(depsArgs?.[1]).toEqual({
      requestStartedAtMonotonicMs: depsArgs?.[1]?.requestStartedAtMonotonicMs,
    });
    expect(depsArgs?.[1]).not.toHaveProperty("localTestScenario");
  });

  it.each(canonicalResponseCases)(
    "projects %s through the complete canonical POST boundary",
    async (_label, result, expectedStatus) => {
      vi.mocked(reserveGeneration).mockResolvedValue(toRecord(result));
      statusMock.mockResolvedValue(toRecord(result));

      const response = await handler(postRequest());

      expect(response.status).toBe(expectedStatus);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({ ok: true, data: result });
      expect(reserveGeneration).toHaveBeenCalledTimes(1);
    },
  );

  it("returns processing before any AI execution and dispatches only its internal worker", async () => {
    const processing = canonicalResponseCases.find(([label]) => label === "processing")?.[1];
    if (processing?.status !== "processing") throw new Error("processing_missing");
    vi.mocked(reserveGeneration).mockResolvedValue(toRecord(processing));
    statusMock.mockResolvedValue(toRecord(processing));
    const response = await handler(postRequest());
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true, data: processing });
    expect(dispatchMenuGeneration).toHaveBeenCalledWith(
      user,
      requestBody,
      processing.requestId,
      undefined,
    );
    expect(callOpenRouter).not.toHaveBeenCalled();
  });
});
