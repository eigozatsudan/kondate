import { beforeEach, describe, expect, it, vi } from "vitest";
import { scenarios } from "../../../tools/openrouter-mock/fixtures/scenarios.mjs";
import {
  generationConflictCopy,
  type GenerationCommand,
} from "../../../shared/contracts/generation.js";
import { validateGeneratedMenu } from "../../../shared/safety/validate-generated-menu.js";
import {
  makeGeneratedMenu,
  makeGenerationContext,
  makeValidatedMenu,
} from "../../../shared/testing/factories.js";
import { materializeAiGeneratedMenu } from "./generation-materializer.js";
import { HttpError } from "./http.js";
import { OpenRouterCallError } from "./openrouter.js";
import {
  projectProviderConflicts,
  runGeneration,
  toGenerationStatus,
  type GenerationDependencies,
} from "./generation-service.js";

vi.mock("../../../shared/safety/validate-generated-menu.js", () => ({
  validateGeneratedMenu: vi.fn(),
}));
vi.mock("./generation-materializer.js", () => ({
  materializeAiGeneratedMenu: vi.fn(),
}));

const requestId = "81000000-0000-4000-8000-000000000001";
const key = "82000000-0000-4000-8000-000000000001";
const menuId = "83000000-0000-4000-8000-000000000001";
const models = ["mock/primary:free", "mock/repair:free"] as const;
const command: GenerationCommand = {
  kind: "new_menu",
  request: {
    idempotencyKey: key,
    draftId: "84000000-0000-4000-8000-000000000001",
    draftRevision: 1,
    privacyNoticeVersion: "2026-07-11.v1",
    expiredPantryConfirmations: [],
  },
};

function record(
  status: "processing" | "failed" | "constraint_conflict" | "succeeded",
): Awaited<ReturnType<GenerationDependencies["repository"]["status"]>> {
  return {
    request_id: requestId,
    idempotency_key: key,
    status,
    remaining: status === "succeeded" ? 4 : 5,
    user_daily_limit: 5 as const,
    consumed: status === "succeeded",
    started_at: "2026-07-11T00:00:00.000Z",
    completed_at: status === "processing" ? null : "2026-07-11T00:00:01.000Z",
    completed_menu_id: status === "succeeded" ? menuId : null,
    failure_code: status === "failed" ? "internal_error" : null,
    terminal_details: null,
    replayed: false,
  };
}

function makeRepository() {
  let current = record("processing");
  const repository = {
    reserve: vi.fn(() => Promise.resolve(current)),
    markSent: vi.fn(() => Promise.resolve(current)),
    reserveRepair: vi.fn<GenerationDependencies["repository"]["reserveRepair"]>(() =>
      Promise.resolve({ reserved: true, retry_at: null }),
    ),
    recordModel: vi.fn(() => Promise.resolve(undefined)),
    fail: vi.fn((_id: string, code: string, retryAt: string | null) => {
      current = { ...record("failed"), failure_code: code, retry_at: retryAt };
      return Promise.resolve(current);
    }),
    conflict: vi.fn((_id: string, conflicts: unknown[]) => {
      current = { ...record("constraint_conflict"), terminal_details: { conflicts } };
      return Promise.resolve(current);
    }),
    succeed: vi.fn(() => {
      current = record("succeeded");
      return Promise.resolve(current);
    }),
    status: vi.fn(() => Promise.resolve(current)),
  };
  return repository;
}

function makeDeps(
  overrides: Partial<GenerationDependencies> & {
    repository?: ReturnType<typeof makeRepository>;
  } = {},
): GenerationDependencies {
  const context = makeGenerationContext();
  const validatePreflight: GenerationDependencies["validatePreflight"] = () => ({ ok: true });
  const buildMessages: GenerationDependencies["buildMessages"] = () => [
    { role: "user", content: "prompt" },
  ];
  return {
    user: { userId: "85000000-0000-4000-8000-000000000001", accessToken: "token" },
    repository: overrides.repository ?? makeRepository(),
    models,
    loadExecutionContext: vi.fn(() => Promise.resolve({ generationContext: context })),
    validatePreflight,
    buildMessages,
    callOpenRouter: vi.fn(() => Promise.resolve({ output: scenarios.success, modelId: models[0] })),
    now: () => new Date("2026-07-11T00:00:00.000Z"),
    openRouterTimeoutMs: 20_000,
    requestStartedAtMonotonicMs: 0,
    functionTotalBudgetMs: 50_000,
    uuid: () => "86000000-0000-4000-8000-000000000001",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(materializeAiGeneratedMenu).mockReturnValue(makeGeneratedMenu());
  vi.mocked(validateGeneratedMenu).mockReturnValue({
    ok: true,
    menu: makeValidatedMenu(),
    labelConfirmations: [],
    safetyFingerprint: "sha256:test",
  });
});

describe("projectProviderConflicts", () => {
  it("projects provider codes and current refs with trusted copy", () => {
    expect(
      projectProviderConflicts(
        [{ code: "must_use_conflict", message: "raw canary", conditionRefs: ["member_1"] }],
        makeGenerationContext(),
      ),
    ).toEqual([
      {
        code: "must_use_conflict",
        message: generationConflictCopy.must_use_conflict,
        conditionRefs: ["member_1"],
      },
    ]);
  });

  const invalidProviderConflicts: readonly unknown[] = [
    [],
    Array.from({ length: 13 }, () => ({
      code: "must_use_conflict",
      message: "x",
      conditionRefs: [],
    })),
    [{ code: "current_safety_changed", message: "x", conditionRefs: [] }],
    [{ code: "unknown", message: "x", conditionRefs: [] }],
    [{ code: "must_use_conflict", message: "x", conditionRefs: ["member_2"] }],
    [{ code: "must_use_conflict", message: "x", conditionRefs: [requestId] }],
    [
      { code: "must_use_conflict", message: "x", conditionRefs: [] },
      { code: "must_use_conflict", message: "y", conditionRefs: [] },
    ],
  ];

  it.each(invalidProviderConflicts)("rejects invalid provider conflicts", (input) => {
    expect(() => projectProviderConflicts(input, makeGenerationContext())).toThrow(
      "invalid_generation_output",
    );
  });
});

describe("runGeneration", () => {
  it("marks sent immediately before fetch and hydrates success", async () => {
    const order: string[] = [];
    const repository = makeRepository();
    repository.markSent.mockImplementation(() => {
      order.push("sent");
      return Promise.resolve(record("processing"));
    });
    const callOpenRouter = vi.fn<GenerationDependencies["callOpenRouter"]>(() => {
      order.push("fetch");
      return Promise.resolve({ output: scenarios.success, modelId: models[0] });
    });
    const result = await runGeneration(makeDeps({ repository, callOpenRouter }), command);
    expect(order).toEqual(["sent", "fetch"]);
    expect(repository.succeed).toHaveBeenCalledTimes(1);
    expect(repository.status).toHaveBeenCalled();
    expect(result.status).toBe("succeeded");
  });

  it("runs preflight before prompt and send", async () => {
    const repository = makeRepository();
    const buildMessages = vi.fn(() => [{ role: "user" as const, content: "prompt" }]);
    const callOpenRouter = vi.fn();
    const validatePreflight = vi.fn<GenerationDependencies["validatePreflight"]>(() => ({
      ok: false,
      terminal: "failed",
      primaryCode: "allergy_conflict",
      issueCodes: ["allergy_conflict"],
    }));
    const result = await runGeneration(
      makeDeps({
        repository,
        validatePreflight,
        buildMessages,
        callOpenRouter,
      }),
      command,
    );
    expect(result).toMatchObject({ status: "failed", error: { code: "allergy_conflict" } });
    expect(buildMessages).not.toHaveBeenCalled();
    expect(repository.markSent).not.toHaveBeenCalled();
    expect(callOpenRouter).not.toHaveBeenCalled();
  });

  it("terminalizes a preflight conflict without constructing or sending a prompt", async () => {
    const repository = makeRepository();
    const conflict: Extract<
      ReturnType<GenerationDependencies["validatePreflight"]>,
      { terminal: "constraint_conflict" }
    >["conflicts"][number] = {
      code: "must_use_conflict",
      message: generationConflictCopy.must_use_conflict,
      conditionRefs: ["pantry_1"],
    };
    const validatePreflight = vi.fn<GenerationDependencies["validatePreflight"]>(() => ({
      ok: false,
      terminal: "constraint_conflict",
      primaryCode: "must_use_conflict",
      issueCodes: ["must_use_conflict"],
      conflicts: [conflict],
    }));
    const buildMessages = vi.fn<GenerationDependencies["buildMessages"]>();
    const callOpenRouter = vi.fn<GenerationDependencies["callOpenRouter"]>();
    const result = await runGeneration(
      makeDeps({ repository, validatePreflight, buildMessages, callOpenRouter }),
      command,
    );
    expect(result).toMatchObject({ status: "constraint_conflict", conflicts: [conflict] });
    expect(repository.conflict).toHaveBeenCalledWith(requestId, [conflict]);
    expect(repository.fail).not.toHaveBeenCalled();
    expect(repository.markSent).not.toHaveBeenCalled();
    expect(buildMessages).not.toHaveBeenCalled();
    expect(callOpenRouter).not.toHaveBeenCalled();
  });

  it("closes a thrown preflight before prompt construction", async () => {
    const repository = makeRepository();
    const buildMessages = vi.fn<GenerationDependencies["buildMessages"]>();
    const callOpenRouter = vi.fn<GenerationDependencies["callOpenRouter"]>();
    const result = await runGeneration(
      makeDeps({
        repository,
        validatePreflight: vi.fn(() => {
          throw new Error("sensitive canary");
        }),
        buildMessages,
        callOpenRouter,
      }),
      command,
    );
    expect(result).toMatchObject({ status: "failed", error: { code: "internal_error" } });
    expect(repository.fail).toHaveBeenCalledTimes(1);
    expect(repository.markSent).not.toHaveBeenCalled();
    expect(buildMessages).not.toHaveBeenCalled();
    expect(callOpenRouter).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("sensitive canary");
  });

  it.each([
    [new HttpError(422, "unsupported_diet", "closed"), "unsupported_diet"],
    [new Error("unsupported_diet"), "internal_error"],
    [new HttpError(500, "unknown_code", "unknown"), "internal_error"],
  ] as const)("closes load errors", async (error, code) => {
    const repository = makeRepository();
    const result = await runGeneration(
      makeDeps({
        repository,
        loadExecutionContext: vi.fn().mockRejectedValue(error),
      }),
      command,
    );
    expect(result).toMatchObject({ status: "failed", error: { code } });
    expect(repository.fail).toHaveBeenCalledWith(requestId, code, null);
  });

  it("uses one repair and excludes a known first model", async () => {
    const repository = makeRepository();
    vi.mocked(validateGeneratedMenu)
      .mockReturnValueOnce({
        ok: false,
        issues: [{ code: "time_limit_exceeded", path: "raw", message: "canary" }],
      })
      .mockReturnValueOnce({
        ok: true,
        menu: makeValidatedMenu(),
        labelConfirmations: [],
        safetyFingerprint: "sha256:test",
      });
    const callOpenRouter = vi
      .fn<GenerationDependencies["callOpenRouter"]>()
      .mockResolvedValueOnce({ output: scenarios.success, modelId: models[0] })
      .mockResolvedValueOnce({ output: scenarios.success, modelId: models[1] });
    const result = await runGeneration(makeDeps({ repository, callOpenRouter }), command);
    expect(repository.reserveRepair).toHaveBeenCalledTimes(1);
    expect(repository.markSent).toHaveBeenCalledTimes(2);
    expect(callOpenRouter.mock.calls[1]?.[0].excludedModelIds).toEqual([models[0]]);
    expect(callOpenRouter.mock.calls[1]?.[0].messages.at(-1)?.content).not.toContain("canary");
    expect(result.status).toBe("succeeded");
  });

  it("records an invalid response model before reserving repair", async () => {
    const order: string[] = [];
    const repository = makeRepository();
    repository.recordModel.mockImplementation(() => {
      order.push("record");
      return Promise.resolve(undefined);
    });
    repository.reserveRepair.mockImplementation(() => {
      order.push("repair");
      return Promise.resolve({ reserved: true, retry_at: null });
    });
    const callOpenRouter = vi
      .fn<GenerationDependencies["callOpenRouter"]>()
      .mockRejectedValueOnce(new OpenRouterCallError("invalid_ai_response", models[0]))
      .mockResolvedValueOnce({ output: scenarios.success, modelId: models[1] });
    await runGeneration(makeDeps({ repository, callOpenRouter }), command);
    expect(order.slice(0, 2)).toEqual(["record", "repair"]);
  });

  it("does not reserve repair when a known model is the sole model", async () => {
    const repository = makeRepository();
    const result = await runGeneration(
      makeDeps({
        repository,
        models: [models[0]],
        callOpenRouter: vi
          .fn()
          .mockRejectedValue(new OpenRouterCallError("invalid_ai_response", models[0])),
      }),
      command,
    );
    expect(repository.reserveRepair).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "failed", error: { code: "invalid_ai_response" } });
  });

  it("does not send a repair when repair quota is denied", async () => {
    const repository = makeRepository();
    repository.reserveRepair.mockResolvedValue({
      reserved: false,
      retry_at: "2026-07-11T00:10:00.000Z",
    });
    vi.mocked(validateGeneratedMenu).mockReturnValue({
      ok: false,
      issues: [{ code: "time_limit_exceeded", path: "raw", message: "canary" }],
    });
    const callOpenRouter = vi
      .fn<GenerationDependencies["callOpenRouter"]>()
      .mockResolvedValue({ output: scenarios.success, modelId: models[0] });
    const result = await runGeneration(makeDeps({ repository, callOpenRouter }), command);
    expect(repository.reserveRepair).toHaveBeenCalledTimes(1);
    expect(repository.markSent).toHaveBeenCalledTimes(1);
    expect(callOpenRouter).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "failed",
      error: { code: "invalid_ai_response" },
      quota: { retryAt: "2026-07-11T00:10:00.000Z" },
    });
  });

  it("terminalizes unexpected post-reservation errors once", async () => {
    const repository = makeRepository();
    const result = await runGeneration(
      makeDeps({
        repository,
        buildMessages: vi.fn(() => {
          throw new Error("sensitive canary");
        }),
      }),
      command,
    );
    expect(repository.fail).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "failed", error: { code: "internal_error" } });
    expect(JSON.stringify(result)).not.toContain("sensitive canary");
  });

  it("rejects when authoritative status hydration fails", async () => {
    const repository = makeRepository();
    repository.status.mockRejectedValue(new Error("status unavailable"));
    await expect(runGeneration(makeDeps({ repository }), command)).rejects.toThrow(
      "status unavailable",
    );
    expect(repository.fail).not.toHaveBeenCalledWith(requestId, "internal_error", null);
  });

  it("does not repeat a failed terminal transition when its status hydration fails", async () => {
    const repository = makeRepository();
    repository.status.mockRejectedValue(new Error("status unavailable"));
    await expect(
      runGeneration(
        makeDeps({
          repository,
          loadExecutionContext: vi.fn().mockRejectedValue(new Error("load failed")),
        }),
        command,
      ),
    ).rejects.toThrow("status unavailable");
    expect(repository.fail).toHaveBeenCalledTimes(1);
  });

  it("hydrates a replay without executing generation", async () => {
    const repository = makeRepository();
    repository.reserve.mockResolvedValue({ ...record("processing"), replayed: true });
    repository.status.mockResolvedValue(record("succeeded"));
    const loadExecutionContext = vi.fn<GenerationDependencies["loadExecutionContext"]>();
    const result = await runGeneration(makeDeps({ repository, loadExecutionContext }), command);
    expect(result).toMatchObject({ status: "succeeded", menuId });
    expect(repository.status).toHaveBeenCalledWith(key);
    expect(loadExecutionContext).not.toHaveBeenCalled();
    expect(repository.markSent).not.toHaveBeenCalled();
  });
});

describe("toGenerationStatus", () => {
  it("maps every closed Task 9 failure copy", () => {
    for (const code of [
      "user_attempt_limit",
      "user_short_window_limit",
      "allergy_unconfirmed",
      "allergen_missing",
      "unmapped_custom_allergy",
      "unsupported_diet_unconfirmed",
      "regeneration_not_implemented",
    ] as const) {
      expect(toGenerationStatus({ ...record("failed"), failure_code: code }, key)).toMatchObject({
        status: "failed",
        error: { code },
      });
    }
  });
});
