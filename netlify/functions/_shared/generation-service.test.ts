import { beforeEach, describe, expect, it, vi } from "vitest";
import { scenarios } from "../../../tools/openrouter-mock/fixtures/scenarios.mjs";
import {
  generationConflictCopy,
  generationFailureCodes,
  type GenerationCommand,
  type GenerationFailureCode,
  type GenerationStatusData,
} from "../../../shared/contracts/generation.js";
import { createDishSignature, createMenuSignature } from "../../../shared/safety/deduplicate.js";
import { createCurrentSafetyFingerprint } from "../../../shared/safety/fingerprint.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";
import { validateGeneratedMenu } from "../../../shared/safety/validate-generated-menu.js";
import {
  makeGeneratedMenu,
  makeGenerationContext,
  makeIdeaGenerationContext,
  makeValidatedMenu,
} from "../../../shared/testing/factories.js";
import { materializeAiGeneratedMenu } from "./generation-materializer.js";
import { GenerationOutputError } from "./generation-repair.js";
import { HttpError } from "./http.js";
import { OpenRouterCallError, type OpenRouterGenerationResult } from "./openrouter.js";
vi.mock("./generation-integrity-context.js", () => ({
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
vi.mock("./supabase-admin.js", () => ({
  getSupabaseAdmin: vi.fn(() => ({})),
}));
import {
  ATTEMPT_TIMEOUT_MS,
  createGenerationDeps,
  FINALIZE_RESERVE_MS,
  generationResponse,
  projectProviderConflicts,
  REQUIRED_SEND_BUDGET_MS,
  runGeneration,
  toGenerationStatus,
  type GenerationDependencies,
  type GenerationExecutionContext,
} from "./generation-service.js";

// createGenerationDeps の契約テスト用。runGeneration 経路は makeDeps で差し替えるため
// これらのモックは createGenerationDeps を直接呼ぶ describe でのみ設定する。
const {
  getServerEnvMock,
  loadGenerationContextMock,
  createGenerationRepositoryMock,
  loadRegenerationExecutionContextMock,
  createRegenerationLoaderDepsMock,
} = vi.hoisted(() => ({
  getServerEnvMock: vi.fn(),
  loadGenerationContextMock: vi.fn(),
  createGenerationRepositoryMock: vi.fn(),
  loadRegenerationExecutionContextMock: vi.fn(),
  createRegenerationLoaderDepsMock: vi.fn(() => ({ requestStartedAtMonotonicMs: 0 })),
}));

vi.mock("../../../shared/safety/validate-generated-menu.js", () => ({
  validateGeneratedMenu: vi.fn(),
}));
vi.mock("./generation-materializer.js", () => ({
  materializeAiGeneratedMenu: vi.fn(),
}));
vi.mock("./env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./env.js")>();
  return { ...actual, getServerEnv: getServerEnvMock };
});
vi.mock("./generation-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./generation-context.js")>();
  return { ...actual, loadGenerationContext: loadGenerationContextMock };
});
vi.mock("./generation-repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./generation-repository.js")>();
  return { ...actual, createGenerationRepository: createGenerationRepositoryMock };
});
vi.mock("./regeneration-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./regeneration-context.js")>();
  return {
    ...actual,
    loadRegenerationExecutionContext: loadRegenerationExecutionContextMock,
  };
});
vi.mock("./regeneration-adapter.js", () => ({
  createRegenerationLoaderDeps: createRegenerationLoaderDepsMock,
}));

const requestId = "81000000-0000-4000-8000-000000000001";
const key = "82000000-0000-4000-8000-000000000001";
const menuId = "83000000-0000-4000-8000-000000000001";
const models = ["mock/primary:free", "mock/repair:free"] as const;
const command: Extract<GenerationCommand, { kind: "new_menu" }> = {
  commandVersion: "generation-command.v2",
  kind: "new_menu",
  request: {
    idempotencyKey: key,
    draftId: "84000000-0000-4000-8000-000000000001",
    draftRevision: 1,
    privacyNoticeVersion: "2026-07-11.v1",
    expiredPantryConfirmations: [],
  },
};

/** テストダブルが満たす new_menu 実行コンテキスト（Plan 3 Task 15 契約） */
function makeNewMenuExecutionContext(
  overrides: {
    generationContext?: GenerationContext;
    command?: Extract<GenerationCommand, { kind: "new_menu" }>;
    requestId?: string;
    expectedSafetyFingerprint?: string;
    startedAtMonotonicMs?: number;
    deadlineAtMonotonicMs?: number;
  } = {},
): Extract<GenerationExecutionContext, { kind: "new_menu" }> {
  const generationContext = overrides.generationContext ?? makeGenerationContext();
  return {
    kind: "new_menu",
    command: overrides.command ?? command,
    requestId: overrides.requestId ?? requestId,
    generationContext,
    expectedSafetyFingerprint:
      overrides.expectedSafetyFingerprint ??
      (generationContext.targetMode === "idea"
        ? "idea-fingerprint"
        : createCurrentSafetyFingerprint(generationContext.safety)),
    startedAtMonotonicMs: overrides.startedAtMonotonicMs ?? 0,
    deadlineAtMonotonicMs: overrides.deadlineAtMonotonicMs ?? 50_000,
    regeneration: null,
  };
}

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
    lookup: vi.fn(() => Promise.resolve({ kind: "miss" as const })),
    replayExisting: vi.fn(() => Promise.resolve(current)),
    reserveNew: vi.fn(() => Promise.resolve(current)),
    markSent: vi.fn(() => Promise.resolve({ ...current, sent: true as const, code: null })),
    reserveRepair: vi.fn<GenerationDependencies["repository"]["reserveRepair"]>(() =>
      Promise.resolve({ reserved: true, retry_at: null }),
    ),
    recordModel: vi.fn<GenerationDependencies["repository"]["recordModel"]>(() =>
      Promise.resolve(undefined),
    ),
    fail: vi.fn((_id: string, code: string, retryAt: string | null) => {
      current = { ...record("failed"), failure_code: code, retry_at: retryAt };
      return Promise.resolve(current);
    }),
    failBeforeSend: vi.fn((_id: string, code: string, retryAt: string | null = null) => {
      current = { ...record("failed"), failure_code: code, retry_at: retryAt };
      return Promise.resolve(current);
    }),
    conflict: vi.fn((_id: string, conflicts: unknown[]) => {
      const codes = (conflicts as Array<{ code: string }>).map((conflict) => conflict.code);
      current = {
        ...record("constraint_conflict"),
        terminal_details: { conflictCodes: codes },
      };
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
    loadExecutionContext: vi.fn(() =>
      Promise.resolve(makeNewMenuExecutionContext({ generationContext: context })),
    ),
    validatePreflight,
    buildMessages,
    callOpenRouter: vi.fn(() =>
      Promise.resolve({
        mode: "full_menu" as const,
        output: scenarios.success,
        modelId: models[0],
      }),
    ),
    now: () => new Date("2026-07-11T00:00:00.000Z"),
    monotonicNow: () => 0,
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

  it("accepts all provider codes and deduplicates current member and pantry refs", () => {
    const base = makeGenerationContext();
    const context = {
      ...base,
      submission: {
        ...base.submission,
        pantrySelections: [
          {
            pantryItemId: "61000000-0000-4000-8000-000000000001",
            priority: "must_use" as const,
          },
        ],
      },
    };
    const codes = [
      "must_use_conflict",
      "allergen_pantry_conflict",
      "dish_count_conflict",
      "mandatory_safety_conflict",
    ] as const;
    expect(
      projectProviderConflicts(
        codes.map((code) => ({
          code,
          message: "raw canary",
          conditionRefs: ["member_1", "pantry_1", "member_1"],
        })),
        context,
      ),
    ).toEqual(
      codes.map((code) => ({
        code,
        message: generationConflictCopy[code],
        conditionRefs: ["member_1", "pantry_1"],
      })),
    );
  });

  const invalidProviderConflicts: readonly unknown[] = [
    null,
    { code: "must_use_conflict" },
    [],
    Array.from({ length: 13 }, () => ({
      code: "must_use_conflict",
      message: "x",
      conditionRefs: [],
    })),
    [{ code: "current_safety_changed", message: "x", conditionRefs: [] }],
    [{ code: "unknown", message: "x", conditionRefs: [] }],
    [{ code: "must_use_conflict", message: "x", conditionRefs: [], extra: true }],
    [{ code: "must_use_conflict", message: "x", conditionRefs: "member_1" }],
    [
      {
        code: "must_use_conflict",
        message: "x",
        conditionRefs: Array.from({ length: 25 }, (_, index) => `member_${String(index + 1)}`),
      },
    ],
    [{ code: "must_use_conflict", message: "x", conditionRefs: ["member_2"] }],
    [{ code: "must_use_conflict", message: "x", conditionRefs: ["pantry_1"] }],
    [{ code: "must_use_conflict", message: "x", conditionRefs: ["member_0"] }],
    [{ code: "must_use_conflict", message: "x", conditionRefs: ["member_x"] }],
    [{ code: "must_use_conflict", message: "x", conditionRefs: ["pantry_0"] }],
    [{ code: "must_use_conflict", message: "x", conditionRefs: ["pantry_x"] }],
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

  it.each([[null], ["sentinel"]] as const)(
    "collapses invalid conflict element %j without retaining it",
    (input) => {
      try {
        projectProviderConflicts(input, makeGenerationContext());
      } catch (error) {
        expect(error).toBeInstanceOf(GenerationOutputError);
        if (error instanceof GenerationOutputError) {
          expect(error.issues).toEqual([{ code: "invalid_provider_menu", path: "menu" }]);
          expect(JSON.stringify(error.issues)).not.toContain("sentinel");
        }
        return;
      }
      throw new Error("expected GenerationOutputError");
    },
  );
});

describe("runGeneration", () => {
  const thrownBoundaryCases = [
    ["load", 0, 0],
    ["preflight", 0, 0],
    ["prompt", 0, 0],
    ["markSent", 1, 0],
    ["provider", 1, 1],
    ["recordModel", 1, 1],
    ["materializer", 1, 1],
    ["validator", 1, 1],
    ["reserveRepair", 1, 1],
    ["repairedProcessing", 2, 2],
    ["succeed", 1, 1],
  ] as const;

  it.each(thrownBoundaryCases)(
    "terminalizes a thrown %s boundary exactly once",
    async (boundary, expectedMarkSent, expectedFetch) => {
      const repository = makeRepository();
      const callOpenRouter = vi.fn<GenerationDependencies["callOpenRouter"]>(() =>
        Promise.resolve({
          mode: "full_menu" as const,
          output: scenarios.success,
          modelId: models[0],
        }),
      );
      const overrides: Partial<Omit<GenerationDependencies, "repository">> = {
        callOpenRouter,
      };
      if (boundary === "load") {
        overrides.loadExecutionContext = vi.fn().mockRejectedValue(new Error("canary"));
      } else if (boundary === "preflight") {
        overrides.validatePreflight = vi.fn(() => {
          throw new Error("canary");
        });
      } else if (boundary === "prompt") {
        overrides.buildMessages = vi.fn(() => {
          throw new Error("canary");
        });
      } else if (boundary === "markSent") {
        repository.markSent.mockRejectedValue(new Error("canary"));
      } else if (boundary === "provider") {
        callOpenRouter.mockRejectedValue(new Error("canary"));
      } else if (boundary === "recordModel") {
        repository.recordModel.mockRejectedValue(new Error("canary"));
      } else if (boundary === "materializer") {
        vi.mocked(materializeAiGeneratedMenu).mockImplementation(() => {
          throw new Error("canary");
        });
      } else if (boundary === "validator") {
        vi.mocked(validateGeneratedMenu).mockImplementation(() => {
          throw new Error("canary");
        });
      } else if (boundary === "reserveRepair") {
        vi.mocked(validateGeneratedMenu).mockReturnValue({
          ok: false,
          issues: [{ code: "time_limit_exceeded", path: "raw", message: "canary" }],
        });
        repository.reserveRepair.mockRejectedValue(new Error("canary"));
      } else if (boundary === "repairedProcessing") {
        vi.mocked(validateGeneratedMenu).mockReturnValueOnce({
          ok: false,
          issues: [{ code: "time_limit_exceeded", path: "raw", message: "canary" }],
        });
        vi.mocked(materializeAiGeneratedMenu)
          .mockReturnValueOnce(makeGeneratedMenu())
          .mockImplementationOnce(() => {
            throw new Error("canary");
          });
      } else {
        repository.succeed.mockRejectedValue(new Error("canary"));
      }

      const deps = makeDeps({ repository, ...overrides });
      const result = await runGeneration(deps, command);
      expect(result).toMatchObject({ status: "failed", error: { code: "internal_error" } });
      expect(repository.fail).toHaveBeenCalledTimes(1);
      expect(repository.status).toHaveBeenCalledTimes(1);
      expect(repository.markSent).toHaveBeenCalledTimes(expectedMarkSent);
      expect(callOpenRouter).toHaveBeenCalledTimes(expectedFetch);
      expect(JSON.stringify(result)).not.toContain("canary");
    },
  );

  it("marks sent immediately before fetch and hydrates success", async () => {
    const order: string[] = [];
    const repository = makeRepository();
    repository.markSent.mockImplementation(() => {
      order.push("sent");
      return Promise.resolve({ ...record("processing"), sent: true as const, code: null });
    });
    const callOpenRouter = vi.fn<GenerationDependencies["callOpenRouter"]>(() => {
      order.push("fetch");
      return Promise.resolve({
        mode: "full_menu" as const,
        output: scenarios.success,
        modelId: models[0],
      });
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
    // 永続化後の status 再読込は codes-only → conditionRefs は空で固定 copy を再構成する
    expect(result).toMatchObject({
      status: "constraint_conflict",
      conflicts: [
        {
          code: "must_use_conflict",
          message: generationConflictCopy.must_use_conflict,
          conditionRefs: [],
        },
      ],
    });
    expect(repository.conflict).toHaveBeenCalledWith(requestId, [conflict]);
    expect(repository.fail).not.toHaveBeenCalled();
    expect(repository.markSent).not.toHaveBeenCalled();
    expect(buildMessages).not.toHaveBeenCalled();
    expect(callOpenRouter).not.toHaveBeenCalled();
  });

  it.each(["preflight", "provider"] as const)(
    "closes a rejected %s conflict mutation as one internal failure",
    async (source) => {
      const repository = makeRepository();
      repository.conflict.mockRejectedValue(new Error("conflict transport failed"));
      const validatePreflight: GenerationDependencies["validatePreflight"] =
        source === "preflight"
          ? () => ({
              ok: false,
              terminal: "constraint_conflict",
              primaryCode: "must_use_conflict",
              issueCodes: ["must_use_conflict"],
              conflicts: [
                {
                  code: "must_use_conflict",
                  message: generationConflictCopy.must_use_conflict,
                  conditionRefs: [],
                },
              ],
            })
          : () => ({ ok: true });
      const callOpenRouter = vi.fn<GenerationDependencies["callOpenRouter"]>(() =>
        Promise.resolve({
          mode: "full_menu" as const,
          output: {
            outcome: "constraint_conflict",
            conflicts: [
              {
                code: "must_use_conflict",
                message: "raw canary",
                conditionRefs: ["member_1"],
              },
            ],
          },
          modelId: models[0],
        }),
      );
      const result = await runGeneration(
        makeDeps({ repository, validatePreflight, callOpenRouter }),
        command,
      );
      expect(result).toMatchObject({ status: "failed", error: { code: "internal_error" } });
      expect(repository.conflict).toHaveBeenCalledTimes(1);
      expect(repository.fail).toHaveBeenCalledTimes(1);
      expect(repository.status).toHaveBeenCalledTimes(1);
      expect(repository.markSent).toHaveBeenCalledTimes(source === "provider" ? 1 : 0);
      expect(callOpenRouter).toHaveBeenCalledTimes(source === "provider" ? 1 : 0);
    },
  );

  it("propagates status failure after a successful conflict without failing again", async () => {
    const repository = makeRepository();
    const statusError = new Error("status unavailable");
    repository.status.mockRejectedValue(statusError);
    const validatePreflight = vi.fn<GenerationDependencies["validatePreflight"]>(() => ({
      ok: false,
      terminal: "constraint_conflict",
      primaryCode: "must_use_conflict",
      issueCodes: ["must_use_conflict"],
      conflicts: [
        {
          code: "must_use_conflict",
          message: generationConflictCopy.must_use_conflict,
          conditionRefs: [],
        },
      ],
    }));
    await expect(runGeneration(makeDeps({ repository, validatePreflight }), command)).rejects.toBe(
      statusError,
    );
    expect(repository.conflict).toHaveBeenCalledTimes(1);
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it("closes an unexpected provider-conflict projection throw exactly once", async () => {
    const repository = makeRepository();
    const canary = "projection getter canary";
    const context = makeGenerationContext();
    Object.defineProperty(context, "targetMembers", {
      get(): never {
        throw new Error(canary);
      },
    });
    const loadExecutionContext = vi.fn<GenerationDependencies["loadExecutionContext"]>(() =>
      Promise.resolve(makeNewMenuExecutionContext({ generationContext: context })),
    );
    const callOpenRouter = vi.fn<GenerationDependencies["callOpenRouter"]>(() =>
      Promise.resolve({
        mode: "full_menu" as const,
        output: {
          outcome: "constraint_conflict",
          conflicts: [
            {
              code: "must_use_conflict",
              message: canary,
              conditionRefs: [],
            },
          ],
        },
        modelId: models[0],
      }),
    );
    const result = await runGeneration(
      makeDeps({ repository, loadExecutionContext, callOpenRouter }),
      command,
    );
    expect(repository.fail).toHaveBeenCalledWith(requestId, "internal_error", null);
    expect(repository.fail).toHaveBeenCalledTimes(1);
    expect(repository.conflict).not.toHaveBeenCalled();
    expect(repository.status).toHaveBeenCalledTimes(1);
    expect(repository.reserveRepair).not.toHaveBeenCalled();
    expect(repository.markSent).toHaveBeenCalledTimes(1);
    expect(callOpenRouter).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(repository.fail.mock.calls)).not.toContain(canary);
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(result).toMatchObject({ status: "failed", error: { code: "internal_error" } });
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
    [{ status: 422, code: "unsupported_diet", message: "shaped" }, "internal_error"],
    [{ name: "Error", message: "unsupported_diet" }, "internal_error"],
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
      .mockResolvedValueOnce({
        mode: "full_menu" as const,
        output: scenarios.success,
        modelId: models[0],
      })
      .mockResolvedValueOnce({
        mode: "full_menu" as const,
        output: scenarios.success,
        modelId: models[1],
      });
    const result = await runGeneration(makeDeps({ repository, callOpenRouter }), command);
    expect(repository.reserveRepair).toHaveBeenCalledTimes(1);
    expect(repository.markSent).toHaveBeenCalledTimes(2);
    expect(callOpenRouter.mock.calls[1]?.[0].excludedModelIds).toEqual([models[0]]);
    expect(callOpenRouter.mock.calls[1]?.[0].messages.at(-1)?.content).not.toContain("canary");
    expect(result.status).toBe("succeeded");
  });

  it("uses one repair for an invalid initial provider conflict and strips canaries", async () => {
    const repository = makeRepository();
    const canary = "raw-provider-message-55000000-0000-4000-8000-000000000001";
    const callOpenRouter = vi
      .fn<GenerationDependencies["callOpenRouter"]>()
      .mockResolvedValueOnce({
        mode: "full_menu" as const,
        output: {
          outcome: "constraint_conflict",
          conflicts: [{ code: "current_safety_changed", message: canary, conditionRefs: [canary] }],
        },
        modelId: models[0],
      })
      .mockResolvedValueOnce({
        mode: "full_menu" as const,
        output: scenarios.success,
        modelId: models[1],
      });
    const result = await runGeneration(makeDeps({ repository, callOpenRouter }), command);
    expect(repository.reserveRepair).toHaveBeenCalledTimes(1);
    expect(callOpenRouter).toHaveBeenCalledTimes(2);
    expect(callOpenRouter.mock.calls[1]?.[0].messages.at(-1)?.content).not.toContain(canary);
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(result.status).toBe("succeeded");
  });

  it("terminalizes an invalid repaired provider conflict without a third send", async () => {
    const repository = makeRepository();
    const canary = "raw-provider-message-55000000-0000-4000-8000-000000000001";
    const invalidConflict: Extract<OpenRouterGenerationResult, { mode: "full_menu" }>["output"] = {
      outcome: "constraint_conflict" as const,
      conflicts: [{ code: "current_safety_changed", message: canary, conditionRefs: [canary] }],
    };
    const callOpenRouter = vi
      .fn<GenerationDependencies["callOpenRouter"]>()
      .mockResolvedValueOnce({
        mode: "full_menu" as const,
        output: invalidConflict,
        modelId: models[0],
      })
      .mockResolvedValueOnce({
        mode: "full_menu" as const,
        output: invalidConflict,
        modelId: models[1],
      });
    const result = await runGeneration(makeDeps({ repository, callOpenRouter }), command);
    expect(repository.reserveRepair).toHaveBeenCalledTimes(1);
    expect(repository.conflict).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledTimes(1);
    expect(repository.markSent).toHaveBeenCalledTimes(2);
    expect(callOpenRouter).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(repository.fail.mock.calls)).not.toContain(canary);
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(result).toMatchObject({ status: "failed", error: { code: "invalid_ai_response" } });
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
      .mockResolvedValueOnce({
        mode: "full_menu" as const,
        output: scenarios.success,
        modelId: models[1],
      });
    await runGeneration(makeDeps({ repository, callOpenRouter }), command);
    expect(order.slice(0, 2)).toEqual(["record", "repair"]);
  });

  it("closes a trusted invalid-response model-record rejection without repair", async () => {
    const repository = makeRepository();
    repository.recordModel.mockRejectedValue(new Error("record failed"));
    const callOpenRouter = vi
      .fn<GenerationDependencies["callOpenRouter"]>()
      .mockRejectedValue(new OpenRouterCallError("invalid_ai_response", models[0]));
    const result = await runGeneration(makeDeps({ repository, callOpenRouter }), command);
    expect(repository.recordModel).toHaveBeenCalledWith(requestId, models[0]);
    expect(repository.reserveRepair).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "failed", error: { code: "internal_error" } });
  });

  it.each(["model_unavailable", "generation_timeout"] as const)(
    "terminalizes %s without repair",
    async (code) => {
      const repository = makeRepository();
      const callOpenRouter = vi
        .fn<GenerationDependencies["callOpenRouter"]>()
        .mockRejectedValue(new OpenRouterCallError(code));
      const result = await runGeneration(makeDeps({ repository, callOpenRouter }), command);
      expect(repository.reserveRepair).not.toHaveBeenCalled();
      expect(repository.fail).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ status: "failed", error: { code } });
    },
  );

  it.each([
    ["null", new OpenRouterCallError("invalid_ai_response")],
    ["unknown", new OpenRouterCallError("invalid_ai_response", "foreign/model:free")],
  ] as const)(
    "repairs a %s first model without recording or excluding it",
    async (_kind, error) => {
      const repository = makeRepository();
      const callOpenRouter = vi
        .fn<GenerationDependencies["callOpenRouter"]>()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({
          mode: "full_menu" as const,
          output: scenarios.success,
          modelId: models[1],
        });
      const result = await runGeneration(makeDeps({ repository, callOpenRouter }), command);
      expect(callOpenRouter.mock.calls[1]?.[0].excludedModelIds).toEqual([]);
      expect(repository.recordModel).toHaveBeenCalledTimes(1);
      expect(repository.recordModel).toHaveBeenCalledWith(requestId, models[1]);
      expect(result.status).toBe("succeeded");
    },
  );

  it("records a trusted invalid repaired model before terminalizing without a third send", async () => {
    const order: string[] = [];
    const repository = makeRepository();
    repository.recordModel.mockImplementation((_requestId, modelId) => {
      order.push(`record:${modelId}`);
      return Promise.resolve(undefined);
    });
    repository.fail.mockImplementation((_requestId, code, retryAt) => {
      order.push("fail");
      return Promise.resolve({
        ...record("failed"),
        failure_code: code,
        retry_at: retryAt,
      });
    });
    vi.mocked(validateGeneratedMenu).mockReturnValue({
      ok: false,
      issues: [{ code: "time_limit_exceeded", path: "raw", message: "canary" }],
    });
    const callOpenRouter = vi
      .fn<GenerationDependencies["callOpenRouter"]>()
      .mockResolvedValueOnce({
        mode: "full_menu" as const,
        output: scenarios.success,
        modelId: models[0],
      })
      .mockRejectedValueOnce(new OpenRouterCallError("invalid_ai_response", models[1]));
    await runGeneration(makeDeps({ repository, callOpenRouter }), command);
    expect(order).toEqual([`record:${models[0]}`, `record:${models[1]}`, "fail"]);
    expect(repository.reserveRepair).toHaveBeenCalledTimes(1);
    expect(repository.markSent).toHaveBeenCalledTimes(2);
    expect(callOpenRouter).toHaveBeenCalledTimes(2);
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
    const callOpenRouter = vi.fn<GenerationDependencies["callOpenRouter"]>().mockResolvedValue({
      mode: "full_menu" as const,
      output: scenarios.success,
      modelId: models[0],
    });
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

  describe("50-second deadline and pre-send budget", () => {
    it("exports the release-locked budget constants", () => {
      expect(ATTEMPT_TIMEOUT_MS).toBe(20_000);
      expect(FINALIZE_RESERVE_MS).toBe(2_000);
      expect(REQUIRED_SEND_BUDGET_MS).toBe(22_000);
    });

    it("fails before markSent when remaining is below REQUIRED_SEND_BUDGET_MS", async () => {
      const repository = makeRepository();
      const callOpenRouter = vi.fn<GenerationDependencies["callOpenRouter"]>();
      // 認証・予約後に共有予算が進み、pre-send 時点で remaining = REQUIRED - 1
      let nowMs = 0;
      const result = await runGeneration(
        makeDeps({
          repository,
          callOpenRouter,
          requestStartedAtMonotonicMs: 0,
          functionTotalBudgetMs: 50_000,
          monotonicNow: () => nowMs,
          loadExecutionContext: vi.fn(() => {
            nowMs = 50_000 - (REQUIRED_SEND_BUDGET_MS - 1);
            return Promise.resolve(makeNewMenuExecutionContext());
          }),
        }),
        command,
      );
      expect(result).toMatchObject({
        status: "failed",
        error: { code: "generation_timeout" },
      });
      expect(repository.failBeforeSend).toHaveBeenCalledWith(requestId, "generation_timeout");
      expect(repository.markSent).not.toHaveBeenCalled();
      expect(callOpenRouter).not.toHaveBeenCalled();
      expect(repository.reserveRepair).not.toHaveBeenCalled();
    });

    it("allows one send with a positive timeout when remaining equals REQUIRED_SEND_BUDGET_MS", async () => {
      const repository = makeRepository();
      let nowMs = 0;
      const callOpenRouter = vi.fn<GenerationDependencies["callOpenRouter"]>(() =>
        Promise.resolve({
          mode: "full_menu" as const,
          output: scenarios.success,
          modelId: models[0],
        }),
      );
      const result = await runGeneration(
        makeDeps({
          repository,
          callOpenRouter,
          requestStartedAtMonotonicMs: 0,
          functionTotalBudgetMs: 50_000,
          monotonicNow: () => nowMs,
          loadExecutionContext: vi.fn(() => {
            nowMs = 50_000 - REQUIRED_SEND_BUDGET_MS;
            return Promise.resolve(makeNewMenuExecutionContext());
          }),
        }),
        command,
      );
      expect(result.status).toBe("succeeded");
      expect(repository.failBeforeSend).not.toHaveBeenCalled();
      expect(repository.markSent).toHaveBeenCalledTimes(1);
      expect(callOpenRouter).toHaveBeenCalledTimes(1);
      const timeoutMs = callOpenRouter.mock.calls[0]?.[0].timeoutMs;
      expect(timeoutMs).toBeGreaterThan(0);
      expect(timeoutMs).toBeLessThanOrEqual(ATTEMPT_TIMEOUT_MS);
    });

    it("never repairs after a provider generation_timeout", async () => {
      const repository = makeRepository();
      const callOpenRouter = vi
        .fn<GenerationDependencies["callOpenRouter"]>()
        .mockRejectedValue(new OpenRouterCallError("generation_timeout"));
      const result = await runGeneration(makeDeps({ repository, callOpenRouter }), command);
      expect(result).toMatchObject({
        status: "failed",
        error: { code: "generation_timeout" },
      });
      expect(repository.markSent).toHaveBeenCalledTimes(1);
      expect(repository.reserveRepair).not.toHaveBeenCalled();
      expect(callOpenRouter).toHaveBeenCalledTimes(1);
    });

    it("rechecks REQUIRED_SEND_BUDGET_MS before repair markSent", async () => {
      // 1 回目送信後に validate が失敗 → canRepair/reserveRepair は通るが、
      // repair の markSent 直前で残り予算が 22s 未満になったら HTTP を送らない。
      const repository = makeRepository();
      vi.mocked(validateGeneratedMenu).mockReturnValueOnce({
        ok: false,
        issues: [{ code: "time_limit_exceeded", path: "raw", message: "budget-slip" }],
      });
      let nowMs = 0;
      repository.reserveRepair.mockImplementation(() => {
        // reserve 成功直後に共有予算が削られ、2 回目 markSent 前の再検査で落ちる。
        nowMs = 50_000 - (REQUIRED_SEND_BUDGET_MS - 1);
        return Promise.resolve({ reserved: true, retry_at: null });
      });
      const callOpenRouter = vi.fn<GenerationDependencies["callOpenRouter"]>().mockResolvedValue({
        mode: "full_menu" as const,
        output: scenarios.success,
        modelId: models[0],
      });
      const result = await runGeneration(
        makeDeps({
          repository,
          callOpenRouter,
          requestStartedAtMonotonicMs: 0,
          functionTotalBudgetMs: 50_000,
          monotonicNow: () => nowMs,
        }),
        command,
      );
      expect(result).toMatchObject({
        status: "failed",
        error: { code: "generation_timeout" },
      });
      expect(repository.reserveRepair).toHaveBeenCalledTimes(1);
      expect(repository.markSent).toHaveBeenCalledTimes(1);
      expect(repository.failBeforeSend).toHaveBeenCalledWith(requestId, "generation_timeout");
      expect(callOpenRouter).toHaveBeenCalledTimes(1);
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

  it("does not repeat a terminal transition when fail transport rejects", async () => {
    const repository = makeRepository();
    const transportError = new Error("terminal transport failed");
    repository.fail.mockRejectedValue(transportError);
    await expect(
      runGeneration(
        makeDeps({
          repository,
          validatePreflight: vi.fn<GenerationDependencies["validatePreflight"]>(() => ({
            ok: false,
            terminal: "failed",
            primaryCode: "allergy_conflict",
            issueCodes: ["allergy_conflict"],
          })),
        }),
        command,
      ),
    ).rejects.toBe(transportError);
    expect(repository.fail).toHaveBeenCalledTimes(1);
  });

  it("propagates fail transport after a load rejection with one transition", async () => {
    const repository = makeRepository();
    const transportError = new Error("terminal transport failed");
    repository.fail.mockRejectedValue(transportError);
    await expect(
      runGeneration(
        makeDeps({
          repository,
          loadExecutionContext: vi.fn().mockRejectedValue(new Error("load failed")),
        }),
        command,
      ),
    ).rejects.toBe(transportError);
    expect(repository.fail).toHaveBeenCalledTimes(1);
  });

  it("hydrates a replay without executing generation", async () => {
    const repository = makeRepository();
    repository.reserveNew.mockResolvedValue({ ...record("processing"), replayed: true });
    repository.status.mockResolvedValue(record("succeeded"));
    const loadExecutionContext = vi.fn<GenerationDependencies["loadExecutionContext"]>();
    const result = await runGeneration(makeDeps({ repository, loadExecutionContext }), command);
    expect(result).toMatchObject({ status: "succeeded", menuId });
    expect(repository.status).toHaveBeenCalledWith(key);
    expect(loadExecutionContext).not.toHaveBeenCalled();
    expect(repository.markSent).not.toHaveBeenCalled();
  });

  it("surfaces synthetic generation_in_progress without hydrating not_started", async () => {
    // 台帳に rejected key の行は無い。status(key) は not_started を返すが、
    // POST 応答は reserve 合成 payload の安定 code を優先する。
    const activeRequestId = "87000000-0000-4000-8000-000000000001";
    const repository = makeRepository();
    repository.reserveNew.mockResolvedValue({
      request_id: activeRequestId,
      idempotency_key: key,
      status: "failed",
      failure_code: "generation_in_progress",
      retry_at: "2026-07-11T00:03:00.000Z",
      processing_expires_at: "2026-07-11T00:03:00.000Z",
      completed_menu_id: null,
      started_at: "2026-07-11T00:00:00.000Z",
      completed_at: "2026-07-11T00:00:01.000Z",
      remaining: 4,
      user_daily_limit: 5 as const,
      consumed: false,
      replayed: false,
    });
    repository.status.mockResolvedValue({
      idempotency_key: key,
      status: "not_started",
      remaining: 5,
      user_daily_limit: 5 as const,
      consumed: false,
    });
    const loadExecutionContext = vi.fn<GenerationDependencies["loadExecutionContext"]>();
    const result = await runGeneration(makeDeps({ repository, loadExecutionContext }), command);
    expect(result).toEqual({
      status: "failed",
      idempotencyKey: key,
      requestId: activeRequestId,
      quota: {
        consumed: false,
        remaining: 4,
        userDailyLimit: 5,
        limitKind: null,
        retryAt: "2026-07-11T00:03:00.000Z",
      },
      completedAt: "2026-07-11T00:00:01.000Z",
      error: {
        code: "generation_in_progress",
        message: "別の献立を作成中です。",
        retryable: true,
      },
    });
    expect(result.status).not.toBe("not_started");
    expect(repository.status).not.toHaveBeenCalled();
    expect(loadExecutionContext).not.toHaveBeenCalled();
    expect(repository.markSent).not.toHaveBeenCalled();
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it.each([
    ["failed", false],
    ["constraint_conflict", false],
    ["succeeded", false],
    ["processing", true],
  ] as const)(
    "ignores a stale %s reservation return and hydrates authoritative status",
    async (status, replayed) => {
      const repository = makeRepository();
      repository.reserveNew.mockResolvedValue({ ...record(status), replayed });
      repository.status.mockResolvedValue(record("succeeded"));
      const loadExecutionContext = vi.fn<GenerationDependencies["loadExecutionContext"]>();
      const result = await runGeneration(makeDeps({ repository, loadExecutionContext }), command);
      expect(result).toMatchObject({ status: "succeeded", menuId });
      expect(repository.status).toHaveBeenCalledTimes(1);
      expect(loadExecutionContext).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["failed", false],
    ["constraint_conflict", false],
    ["succeeded", false],
    ["processing", true],
  ] as const)(
    "rejects status hydration for an early %s reservation result",
    async (status, replayed) => {
      const repository = makeRepository();
      const statusError = new Error("status unavailable");
      repository.reserveNew.mockResolvedValue({ ...record(status), replayed });
      repository.status.mockRejectedValue(statusError);
      const loadExecutionContext = vi.fn<GenerationDependencies["loadExecutionContext"]>();
      await expect(
        runGeneration(makeDeps({ repository, loadExecutionContext }), command),
      ).rejects.toBe(statusError);
      expect(repository.fail).not.toHaveBeenCalled();
      expect(loadExecutionContext).not.toHaveBeenCalled();
    },
  );

  it("rejects status hydration after repair denial without repeating failure", async () => {
    const repository = makeRepository();
    const statusError = new Error("status unavailable");
    repository.reserveRepair.mockResolvedValue({ reserved: false, retry_at: null });
    repository.status.mockRejectedValue(statusError);
    vi.mocked(validateGeneratedMenu).mockReturnValue({
      ok: false,
      issues: [{ code: "time_limit_exceeded", path: "raw canary", message: "raw canary" }],
    });
    await expect(runGeneration(makeDeps({ repository }), command)).rejects.toBe(statusError);
    expect(repository.reserveRepair).toHaveBeenCalledTimes(1);
    expect(repository.fail).toHaveBeenCalledTimes(1);
    expect(repository.markSent).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["failure", "failed"],
    ["conflict", "constraint_conflict"],
    ["success", "succeeded"],
  ] as const)("ignores a stale %s mutation return", async (transition, hydratedStatus) => {
    const repository = makeRepository();
    if (transition === "failure") {
      repository.fail.mockResolvedValue(record("succeeded"));
    } else if (transition === "conflict") {
      repository.conflict.mockResolvedValue(record("succeeded"));
    } else {
      repository.succeed.mockResolvedValue(record("failed"));
    }
    const hydrated = record(hydratedStatus);
    if (hydratedStatus === "constraint_conflict") {
      hydrated.terminal_details = {
        conflictCodes: ["must_use_conflict"],
      };
    }
    repository.status.mockResolvedValue(hydrated);
    const validatePreflight: GenerationDependencies["validatePreflight"] =
      transition === "failure"
        ? () => ({
            ok: false,
            terminal: "failed",
            primaryCode: "allergy_conflict",
            issueCodes: ["allergy_conflict"],
          })
        : transition === "conflict"
          ? () => ({
              ok: false,
              terminal: "constraint_conflict",
              primaryCode: "must_use_conflict",
              issueCodes: ["must_use_conflict"],
              conflicts: [
                {
                  code: "must_use_conflict",
                  message: generationConflictCopy.must_use_conflict,
                  conditionRefs: [],
                },
              ],
            })
          : () => ({ ok: true });
    const result = await runGeneration(makeDeps({ repository, validatePreflight }), command);
    expect(result.status).toBe(hydratedStatus);
    expect(repository.status).toHaveBeenCalledTimes(1);
  });

  it.each(["failure", "conflict", "success"] as const)(
    "rejects a %s status hydration without a second terminal transition",
    async (transition) => {
      const repository = makeRepository();
      const statusError = new Error("status unavailable");
      repository.status.mockRejectedValue(statusError);
      const validatePreflight: GenerationDependencies["validatePreflight"] =
        transition === "failure"
          ? () => ({
              ok: false,
              terminal: "failed",
              primaryCode: "allergy_conflict",
              issueCodes: ["allergy_conflict"],
            })
          : transition === "conflict"
            ? () => ({
                ok: false,
                terminal: "constraint_conflict",
                primaryCode: "must_use_conflict",
                issueCodes: ["must_use_conflict"],
                conflicts: [
                  {
                    code: "must_use_conflict",
                    message: generationConflictCopy.must_use_conflict,
                    conditionRefs: [],
                  },
                ],
              })
            : () => ({ ok: true });
      await expect(
        runGeneration(makeDeps({ repository, validatePreflight }), command),
      ).rejects.toBe(statusError);
      expect(repository.fail).toHaveBeenCalledTimes(transition === "failure" ? 1 : 0);
      expect(repository.conflict).toHaveBeenCalledTimes(transition === "conflict" ? 1 : 0);
      expect(repository.succeed).toHaveBeenCalledTimes(transition === "success" ? 1 : 0);
    },
  );

  // --- 敵対的シナリオのサービス層終端性テスト ---
  // scenario固有fixtureを実materializer/validatorに通す統合テストは
  // generation-adversarial.integration.test.ts へ移動。ここでは mock 環境の
  // 基本的な orchestration 不変条件（reserve/markSent/reserveRepair 呼出し回数）
  // だけを malformed-json 代表ケースで確認する。
  it("malformed-json performs at most one repair and never consumes user success when still invalid", async () => {
    const mockRepository = makeRepository();
    const callOpenRouter = vi
      .fn<GenerationDependencies["callOpenRouter"]>()
      .mockRejectedValueOnce(new OpenRouterCallError("invalid_ai_response", models[0]))
      .mockRejectedValueOnce(new OpenRouterCallError("invalid_ai_response", models[1]));

    const result = await runGeneration(
      makeDeps({ repository: mockRepository, callOpenRouter }),
      command,
    );
    expect(result.status).toBe("failed");
    expect(result).toMatchObject({ quota: { consumed: false } });
    expect(mockRepository.lookup).toHaveBeenCalledTimes(1);
    expect(mockRepository.reserveNew).toHaveBeenCalledTimes(1);
    expect(mockRepository.reserveRepair).toHaveBeenCalledTimes(1);
    expect(mockRepository.markSent).toHaveBeenCalledTimes(2);
    expect(mockRepository.succeed).not.toHaveBeenCalled();
  });
});

describe("createGenerationDeps loadExecutionContext contract", () => {
  const user = {
    userId: "85000000-0000-4000-8000-000000000001",
    accessToken: "token",
  };
  const timing = { requestStartedAtMonotonicMs: 1_234 };
  const deadlineAtMonotonicMs = 51_234;
  const loadRequestId = "87000000-0000-4000-8000-000000000001";

  beforeEach(() => {
    getServerEnvMock.mockReturnValue({
      openRouter: {
        models: [...models],
        timeoutMs: 20_000,
        functionTotalBudgetMs: 50_000,
      },
    });
    createGenerationRepositoryMock.mockReturnValue({
      reserve: vi.fn(),
      markSent: vi.fn(),
      reserveRepair: vi.fn(),
      recordModel: vi.fn(),
      fail: vi.fn(),
      failBeforeSend: vi.fn(),
      conflict: vi.fn(),
      succeed: vi.fn(),
      status: vi.fn(),
    });
    loadGenerationContextMock.mockReset();
  });

  it("returns a full new_menu GenerationExecutionContext with regeneration null", async () => {
    const generationContext = makeGenerationContext();
    loadGenerationContextMock.mockResolvedValue(generationContext);

    const deps = createGenerationDeps(user, timing);
    const execution = await deps.loadExecutionContext(
      command,
      loadRequestId,
      deadlineAtMonotonicMs,
    );

    expect(execution).toEqual({
      kind: "new_menu",
      command,
      requestId: loadRequestId,
      generationContext,
      expectedSafetyFingerprint: createCurrentSafetyFingerprint(generationContext.safety),
      startedAtMonotonicMs: timing.requestStartedAtMonotonicMs,
      deadlineAtMonotonicMs,
      regeneration: null,
    });
    expect(loadGenerationContextMock).toHaveBeenCalledWith(user, loadRequestId, command.request);
  });

  it.each([
    {
      commandVersion: "generation-command.v2" as const,
      kind: "regenerate_menu" as const,
      request: {
        idempotencyKey: key,
        sourceMenuId: "88000000-0000-4000-8000-000000000001",
        changeReason: "simpler" as const,
        changeReasonCustom: null,
        expiredPantryConfirmations: [],
      },
    },
    {
      commandVersion: "generation-command.v2" as const,
      kind: "regenerate_dish" as const,
      request: {
        idempotencyKey: key,
        sourceMenuId: "88000000-0000-4000-8000-000000000001",
        dishId: "89000000-0000-4000-8000-000000000001",
        changeReason: "simpler" as const,
        changeReasonCustom: null,
        expiredPantryConfirmations: [],
      },
    },
  ])("routes $kind through loadRegenerationExecutionContext with entry timing", async (regen) => {
    const regenerationContext = {
      kind: regen.kind,
      command: regen,
      requestId: loadRequestId,
      generationContext: makeGenerationContext(),
      expectedSafetyFingerprint: "current-v3",
      startedAtMonotonicMs: timing.requestStartedAtMonotonicMs,
      deadlineAtMonotonicMs,
      regeneration: {
        sourceMenuId: regen.request.sourceMenuId,
        sourceMenu: makeValidatedMenu(),
        derivationGroupId: "group-1",
        replaceDishId: regen.kind === "regenerate_dish" ? regen.request.dishId : null,
        retainedDishIds: [],
        excludedDishIds: [],
        sourceSafetyFingerprint: "source-fp",
        sourcePreferenceSnapshot: {},
        existingDerivationMenus: [],
        artifacts: {
          retainedDishes: [],
          sourceDishToReplace: null,
          promptDto: null,
          retainedRefMap: new Map(),
        },
      },
    };
    loadRegenerationExecutionContextMock.mockResolvedValue(regenerationContext);
    createRegenerationLoaderDepsMock.mockReturnValue({
      requestStartedAtMonotonicMs: timing.requestStartedAtMonotonicMs,
    });

    const deps = createGenerationDeps(user, timing);
    const execution = await deps.loadExecutionContext(regen, loadRequestId, deadlineAtMonotonicMs);

    expect(loadGenerationContextMock).not.toHaveBeenCalled();
    expect(createRegenerationLoaderDepsMock).toHaveBeenCalledWith(user, {
      requestStartedAtMonotonicMs: timing.requestStartedAtMonotonicMs,
    });
    expect(loadRegenerationExecutionContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestStartedAtMonotonicMs: timing.requestStartedAtMonotonicMs,
      }),
      user,
      regen,
      loadRequestId,
      deadlineAtMonotonicMs,
    );
    expect(execution.startedAtMonotonicMs).toBe(timing.requestStartedAtMonotonicMs);
    expect(execution.kind).toBe(regen.kind);
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

  it("requires the authoritative processing start timestamp", () => {
    expect(() =>
      toGenerationStatus({ ...record("processing"), started_at: undefined }, key),
    ).toThrow("started_at_missing");
  });

  it.each(["succeeded", "failed", "constraint_conflict"] as const)(
    "requires the authoritative completion timestamp for %s",
    (status) => {
      expect(() => toGenerationStatus({ ...record(status), completed_at: null }, key)).toThrow(
        "completed_at_missing",
      );
    },
  );

  it("requires the authoritative completed menu id for succeeded", () => {
    expect(() =>
      toGenerationStatus({ ...record("succeeded"), completed_menu_id: null }, key),
    ).toThrow("completed_menu_id_missing");
  });

  it("keeps an unknown stored failure in the fixed internal error state", () => {
    expect(toGenerationStatus({ ...record("failed"), failure_code: "raw-canary" }, key)).toEqual({
      status: "failed",
      idempotencyKey: key,
      requestId,
      quota: {
        consumed: false,
        remaining: 5,
        userDailyLimit: 5,
        limitKind: null,
        retryAt: null,
      },
      error: {
        code: "internal_error",
        message: "献立を作成できませんでした。成功回数には含まれません。",
        retryable: true,
      },
      completedAt: "2026-07-11T00:00:01.000Z",
    });
  });

  it("rehydrates constraint conflicts from closed codes with fixed Japanese copy", () => {
    expect(
      toGenerationStatus(
        {
          ...record("constraint_conflict"),
          terminal_details: { conflictCodes: ["must_use_conflict", "current_safety_changed"] },
        },
        key,
      ),
    ).toEqual({
      status: "constraint_conflict",
      idempotencyKey: key,
      requestId,
      quota: {
        consumed: false,
        remaining: 5,
        userDailyLimit: 5,
        limitKind: null,
        retryAt: null,
      },
      completedAt: "2026-07-11T00:00:01.000Z",
      conflicts: [
        {
          code: "must_use_conflict",
          message: generationConflictCopy.must_use_conflict,
          conditionRefs: [],
        },
        {
          code: "current_safety_changed",
          message: generationConflictCopy.current_safety_changed,
          conditionRefs: [],
        },
      ],
    });
  });
});

describe("generationResponse", () => {
  const quota = {
    consumed: false,
    remaining: 5,
    userDailyLimit: 5 as const,
    limitKind: null,
    retryAt: null,
  };
  const expectedFailureStatus: Record<GenerationFailureCode, number> = Object.fromEntries(
    generationFailureCodes.map((code) => [
      code,
      ["user_daily_limit", "user_attempt_limit", "user_short_window_limit"].includes(code)
        ? 429
        : ["global_daily_limit", "model_unavailable", "generation_timeout"].includes(code)
          ? 503
          : 422,
    ]),
  ) as Record<GenerationFailureCode, number>;

  const successfulStates: readonly [GenerationStatusData, number][] = [
    [{ status: "not_started", idempotencyKey: key, quota }, 200],
    [
      {
        status: "processing",
        idempotencyKey: key,
        requestId,
        quota,
        startedAt: "2026-07-11T00:00:00.000Z",
      },
      202,
    ],
    [
      {
        status: "succeeded",
        idempotencyKey: key,
        requestId,
        quota,
        menuId,
        completedAt: "2026-07-11T00:00:01.000Z",
      },
      200,
    ],
    [
      {
        status: "constraint_conflict",
        idempotencyKey: key,
        requestId,
        quota,
        conflicts: [
          {
            code: "must_use_conflict",
            message: generationConflictCopy.must_use_conflict,
            conditionRefs: [],
          },
        ],
        completedAt: "2026-07-11T00:00:01.000Z",
      },
      200,
    ],
  ];

  it.each(successfulStates)("maps %s to its canonical HTTP status", async (result, status) => {
    const response = generationResponse(result);
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ok: true, data: result });
  });

  it.each(generationFailureCodes)("maps failed %s to its canonical HTTP status", (code) => {
    const result: GenerationStatusData = {
      status: "failed",
      idempotencyKey: key,
      requestId,
      quota,
      error: { code, message: "固定文言", retryable: false },
      completedAt: "2026-07-11T00:00:01.000Z",
    };
    const response = generationResponse(result);
    expect(response.status).toBe(expectedFailureStatus[code]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("runGeneration regeneration duplicate gating", () => {
  it("returns duplicate_output without finalizing user success", async () => {
    const menu = makeValidatedMenu();
    const dishSig = (dish: (typeof menu.dishes)[number]) => ({
      role: dish.role,
      name: dish.name,
      primaryIngredients: dish.ingredients.map((item) => item.name),
    });
    const wholeRegenerationCommand = {
      commandVersion: "generation-command.v2" as const,
      kind: "regenerate_menu" as const,
      request: {
        idempotencyKey: key,
        sourceMenuId: "88000000-0000-4000-8000-000000000001",
        changeReason: "simpler" as const,
        changeReasonCustom: null,
        expiredPantryConfirmations: [],
      },
    };
    const execution: Extract<GenerationExecutionContext, { kind: "regenerate_menu" }> = {
      kind: "regenerate_menu",
      command: wholeRegenerationCommand,
      requestId,
      generationContext: makeGenerationContext(),
      expectedSafetyFingerprint: "fp",
      startedAtMonotonicMs: 0,
      deadlineAtMonotonicMs: 50_000,
      regeneration: {
        sourceMenuId: wholeRegenerationCommand.request.sourceMenuId,
        sourceMenu: menu,
        derivationGroupId: "a1000000-0000-4000-8000-000000000001",
        replaceDishId: null,
        retainedDishIds: menu.dishes.map((dish) => dish.id),
        excludedDishIds: menu.dishes.map((dish) => dish.id),
        sourceSafetyFingerprint: "source-fp",
        sourcePreferenceSnapshot: {},
        existingDerivationMenus: [
          {
            menuId: menu.menuId,
            menuSignature: createMenuSignature({ dishes: menu.dishes.map(dishSig) }),
            dishSignatures: menu.dishes.map((dish) => createDishSignature(dishSig(dish))),
          },
        ],
        artifacts: {
          retainedDishes: [],
          sourceDishToReplace: null,
          promptDto: null,
          retainedRefMap: new Map(),
        },
      },
    };
    vi.mocked(validateGeneratedMenu).mockReturnValue({
      ok: true,
      menu,
      labelConfirmations: [],
      safetyFingerprint: "sha256:test",
    });
    const repository = makeRepository();
    // 2 モデルあるため repair でも同一 model が選ばれ得る。両回とも duplicate になるよう modelId を分ける
    const callOpenRouter = vi
      .fn<GenerationDependencies["callOpenRouter"]>()
      .mockResolvedValueOnce({
        mode: "full_menu" as const,
        output: scenarios.success,
        modelId: models[0],
      })
      .mockResolvedValueOnce({
        mode: "full_menu" as const,
        output: scenarios.success,
        modelId: models[1],
      });
    const depsWithDuplicateOutput = makeDeps({
      repository,
      loadExecutionContext: vi.fn(() => Promise.resolve(execution)),
      callOpenRouter,
    });

    const result = await runGeneration(depsWithDuplicateOutput, wholeRegenerationCommand);
    expect(result).toMatchObject({
      status: "failed",
      error: { code: "duplicate_output" },
      quota: { consumed: false },
    });
    expect(repository.succeed).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledWith(requestId, "duplicate_output", null);
  });

  it("rejects material near-duplicate dish output without succeed or success quota", async () => {
    const chickenCabbage = {
      role: "main" as const,
      name: "鶏肉と白菜の煮物",
      primaryIngredients: ["鶏もも肉", "白菜", "しょうゆ"],
    };
    const cabbageChicken = {
      role: "main" as const,
      name: "白菜と鶏肉の煮物",
      primaryIngredients: ["白菜", "鶏もも肉", "しょうゆ"],
    };
    const sourceMainId = "50000000-0000-4000-8000-000000000001";
    const sourceMenu = makeValidatedMenu({
      dishes: [
        {
          id: sourceMainId,
          role: "main",
          position: 1,
          name: chickenCabbage.name,
          description: "主菜",
          cookingTimeMinutes: 20,
          ingredients: chickenCabbage.primaryIngredients.map((name, index) => ({
            id: `53000000-0000-4000-8000-00000000000${String(index + 1)}`,
            position: index + 1,
            name,
            quantityValue: 100,
            quantityText: "100g",
            unit: "g",
            storeSection: "meat_fish" as const,
            pantrySelectionId: null,
            labelConfirmationRequired: false,
          })),
          steps: [
            {
              id: "51000000-0000-4000-8000-000000000001",
              position: 1,
              instruction: "煮る",
            },
          ],
        },
        makeValidatedMenu().dishes[1]!,
      ],
    });
    const nearDuplicateMenu = makeValidatedMenu({
      dishes: [
        {
          id: "b0000000-0000-4000-8000-000000000001",
          role: "main",
          position: 1,
          name: cabbageChicken.name,
          description: "主菜",
          cookingTimeMinutes: 20,
          ingredients: cabbageChicken.primaryIngredients.map((name, index) => ({
            id: `b3000000-0000-4000-8000-00000000000${String(index + 1)}`,
            position: index + 1,
            name,
            quantityValue: 100,
            quantityText: "100g",
            unit: "g",
            storeSection: "meat_fish" as const,
            pantrySelectionId: null,
            labelConfirmationRequired: false,
          })),
          steps: [
            {
              id: "b1000000-0000-4000-8000-000000000001",
              position: 1,
              instruction: "煮る",
            },
          ],
        },
        {
          ...makeValidatedMenu().dishes[1]!,
          id: "b0000000-0000-4000-8000-000000000002",
        },
      ],
    });
    const dishRegenerationCommand = {
      commandVersion: "generation-command.v2" as const,
      kind: "regenerate_dish" as const,
      request: {
        idempotencyKey: key,
        sourceMenuId: sourceMenu.menuId,
        dishId: sourceMainId,
        changeReason: "simpler" as const,
        changeReasonCustom: null,
        expiredPantryConfirmations: [],
      },
    };
    const execution: Extract<GenerationExecutionContext, { kind: "regenerate_dish" }> = {
      kind: "regenerate_dish",
      command: dishRegenerationCommand,
      requestId,
      generationContext: makeGenerationContext(),
      expectedSafetyFingerprint: "fp",
      startedAtMonotonicMs: 0,
      deadlineAtMonotonicMs: 50_000,
      regeneration: {
        sourceMenuId: sourceMenu.menuId,
        sourceMenu,
        derivationGroupId: "a1000000-0000-4000-8000-000000000001",
        replaceDishId: sourceMainId,
        retainedDishIds: [sourceMenu.dishes[1]!.id],
        excludedDishIds: sourceMenu.dishes.map((dish) => dish.id),
        sourceSafetyFingerprint: "source-fp",
        sourcePreferenceSnapshot: {},
        existingDerivationMenus: [
          {
            menuId: sourceMenu.menuId,
            menuSignature: createMenuSignature({
              dishes: sourceMenu.dishes.map((dish) => ({
                role: dish.role,
                name: dish.name,
                primaryIngredients: dish.ingredients.map((item) => item.name),
              })),
            }),
            dishSignatures: sourceMenu.dishes.map((dish) =>
              createDishSignature({
                role: dish.role,
                name: dish.name,
                primaryIngredients: dish.ingredients.map((item) => item.name),
              }),
            ),
          },
        ],
        artifacts: {
          retainedDishes: [],
          sourceDishToReplace: null,
          promptDto: null,
          retainedRefMap: new Map(),
        },
      },
    };
    // full_menu 経路で materialize 済み候補を validator が返す想定
    vi.mocked(validateGeneratedMenu).mockReturnValue({
      ok: true,
      menu: nearDuplicateMenu,
      labelConfirmations: [],
      safetyFingerprint: "sha256:test",
    });
    const repository = makeRepository();
    const callOpenRouter = vi
      .fn<GenerationDependencies["callOpenRouter"]>()
      .mockResolvedValueOnce({
        mode: "full_menu" as const,
        output: scenarios.success,
        modelId: models[0],
      })
      .mockResolvedValueOnce({
        mode: "full_menu" as const,
        output: scenarios.success,
        modelId: models[1],
      });
    const result = await runGeneration(
      makeDeps({
        repository,
        loadExecutionContext: vi.fn(() => Promise.resolve(execution)),
        callOpenRouter,
      }),
      dishRegenerationCommand,
    );
    expect(result).toMatchObject({
      status: "failed",
      error: { code: "duplicate_output" },
      quota: { consumed: false },
    });
    expect(repository.succeed).not.toHaveBeenCalled();
  });

  it("succeeds dish regeneration once with current safety snapshot and lineage", async () => {
    const sourceMenu = makeValidatedMenu();
    const replaceDishId = sourceMenu.dishes[0]!.id;
    const freshMenu = makeValidatedMenu({
      menuId: "b2000000-0000-4000-8000-000000000001",
      labelConfirmations: [
        {
          sourceType: "ingredient",
          sourceId: "b3000000-0000-4000-8000-000000000001",
          sourcePath: "dishes.0.ingredients.0.name",
          sourceText: "しょうゆ",
          allergenId: "wheat",
          anonymousMemberRef: "member_1",
          dictionaryVersion: "jp-caa-2026-04.v1",
          confirmationStatus: "pending",
          confirmedAt: null,
          confirmedBy: null,
        },
      ],
    });
    const currentSafetySnapshot = {
      dictionaryVersion: "dict-current",
      foodRuleVersion: "rule-current",
      marker: "current-safety-snapshot",
    };
    const generationContext = makeGenerationContext({
      safetySnapshot: currentSafetySnapshot,
      preferenceSnapshot: {
        mealType: "breakfast",
        mainIngredients: ["ごはん"],
      },
    });
    const dishRegenerationCommand = {
      commandVersion: "generation-command.v2" as const,
      kind: "regenerate_dish" as const,
      request: {
        idempotencyKey: key,
        sourceMenuId: sourceMenu.menuId,
        dishId: replaceDishId,
        changeReason: "simpler" as const,
        changeReasonCustom: null,
        expiredPantryConfirmations: [],
      },
    };
    const execution: Extract<GenerationExecutionContext, { kind: "regenerate_dish" }> = {
      kind: "regenerate_dish",
      command: dishRegenerationCommand,
      requestId,
      generationContext,
      expectedSafetyFingerprint: createCurrentSafetyFingerprint(generationContext.safety),
      startedAtMonotonicMs: 0,
      deadlineAtMonotonicMs: 50_000,
      regeneration: {
        sourceMenuId: sourceMenu.menuId,
        sourceMenu,
        derivationGroupId: "a1000000-0000-4000-8000-000000000001",
        replaceDishId,
        retainedDishIds: sourceMenu.dishes.slice(1).map((dish) => dish.id),
        excludedDishIds: sourceMenu.dishes.map((dish) => dish.id),
        sourceSafetyFingerprint: "source-fp",
        sourcePreferenceSnapshot: generationContext.preferenceSnapshot,
        existingDerivationMenus: [],
        artifacts: {
          retainedDishes: [],
          sourceDishToReplace: null,
          promptDto: null,
          retainedRefMap: new Map(),
        },
      },
    };
    vi.mocked(validateGeneratedMenu).mockReturnValue({
      ok: true,
      menu: freshMenu,
      labelConfirmations: freshMenu.labelConfirmations,
      safetyFingerprint: "sha256:test",
    });
    const repository = makeRepository();
    const result = await runGeneration(
      makeDeps({
        repository,
        loadExecutionContext: vi.fn(() => Promise.resolve(execution)),
        callOpenRouter: vi.fn(() =>
          Promise.resolve({
            mode: "full_menu" as const,
            output: scenarios.success,
            modelId: models[0],
          }),
        ),
      }),
      dishRegenerationCommand,
    );
    expect(result.status).toBe("succeeded");
    expect(repository.succeed).toHaveBeenCalledTimes(1);
    expect(repository.succeed).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId,
        menu: freshMenu,
        safetySnapshot: generationContext.safetySnapshot,
        preferenceSnapshot: generationContext.preferenceSnapshot,
        sourceMenuId: sourceMenu.menuId,
        changeReason: "simpler",
        changeReasonCustom: null,
      }),
    );
    // 空オブジェクトや履歴専用 marker ではないことを固定
    const succeedCalls = repository.succeed.mock.calls as unknown as Array<
      [{ safetySnapshot: unknown }]
    >;
    expect(succeedCalls[0]?.[0]?.safetySnapshot).toEqual(currentSafetySnapshot);
    expect(freshMenu.labelConfirmations.every((row) => row.confirmationStatus === "pending")).toBe(
      true,
    );
  });
});

describe("runGeneration idea child_friendly rejection", () => {
  it("rejects an idea child_friendly command before provider send", async () => {
    const ideaChildFriendlyCommand = {
      commandVersion: "generation-command.v2" as const,
      kind: "regenerate_menu" as const,
      request: {
        idempotencyKey: key,
        sourceMenuId: "88000000-0000-4000-8000-000000000001",
        changeReason: "child_friendly" as const,
        changeReasonCustom: null,
        expiredPantryConfirmations: [],
      },
    };
    const menu = makeValidatedMenu();
    const execution: Extract<GenerationExecutionContext, { kind: "regenerate_menu" }> = {
      kind: "regenerate_menu",
      command: ideaChildFriendlyCommand,
      requestId,
      generationContext: makeIdeaGenerationContext(),
      expectedSafetyFingerprint: "idea-fingerprint",
      startedAtMonotonicMs: 0,
      deadlineAtMonotonicMs: 50_000,
      regeneration: {
        sourceMenuId: ideaChildFriendlyCommand.request.sourceMenuId,
        sourceMenu: menu,
        derivationGroupId: "a1000000-0000-4000-8000-000000000001",
        replaceDishId: null,
        retainedDishIds: menu.dishes.map((dish) => dish.id),
        excludedDishIds: menu.dishes.map((dish) => dish.id),
        sourceSafetyFingerprint: "source-fp",
        sourcePreferenceSnapshot: {},
        existingDerivationMenus: [],
        artifacts: {
          retainedDishes: [],
          sourceDishToReplace: null,
          promptDto: null,
          retainedRefMap: new Map(),
        },
      },
    };
    const repository = makeRepository();
    const callOpenRouter = vi.fn<GenerationDependencies["callOpenRouter"]>();
    const deps = makeDeps({
      repository,
      loadExecutionContext: vi.fn(() => Promise.resolve(execution)),
      callOpenRouter,
    });

    const status = await runGeneration(deps, ideaChildFriendlyCommand);
    expect(status).toMatchObject({
      status: "failed",
      error: { code: "invalid_request" },
    });
    expect(callOpenRouter).not.toHaveBeenCalled();
    expect(repository.markSent).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledWith(requestId, "invalid_request", null);
  });

  it("rejects idea dish regeneration with child_friendly before provider send", async () => {
    const ideaChildFriendlyDishCommand = {
      commandVersion: "generation-command.v2" as const,
      kind: "regenerate_dish" as const,
      request: {
        idempotencyKey: key,
        sourceMenuId: "88000000-0000-4000-8000-000000000001",
        dishId: "89000000-0000-4000-8000-000000000001",
        changeReason: "child_friendly" as const,
        changeReasonCustom: null,
        expiredPantryConfirmations: [],
      },
    };
    const menu = makeValidatedMenu();
    const execution: Extract<GenerationExecutionContext, { kind: "regenerate_dish" }> = {
      kind: "regenerate_dish",
      command: ideaChildFriendlyDishCommand,
      requestId,
      generationContext: makeIdeaGenerationContext(),
      expectedSafetyFingerprint: "idea-fingerprint",
      startedAtMonotonicMs: 0,
      deadlineAtMonotonicMs: 50_000,
      regeneration: {
        sourceMenuId: ideaChildFriendlyDishCommand.request.sourceMenuId,
        sourceMenu: menu,
        derivationGroupId: "a1000000-0000-4000-8000-000000000001",
        replaceDishId: ideaChildFriendlyDishCommand.request.dishId,
        retainedDishIds: [],
        excludedDishIds: [ideaChildFriendlyDishCommand.request.dishId],
        sourceSafetyFingerprint: "source-fp",
        sourcePreferenceSnapshot: {},
        existingDerivationMenus: [],
        artifacts: {
          retainedDishes: [],
          sourceDishToReplace: null,
          promptDto: null,
          retainedRefMap: new Map(),
        },
      },
    };
    const repository = makeRepository();
    const callOpenRouter = vi.fn<GenerationDependencies["callOpenRouter"]>();
    const status = await runGeneration(
      makeDeps({
        repository,
        loadExecutionContext: vi.fn(() => Promise.resolve(execution)),
        callOpenRouter,
      }),
      ideaChildFriendlyDishCommand,
    );
    expect(status).toMatchObject({
      status: "failed",
      error: { code: "invalid_request" },
    });
    expect(callOpenRouter).not.toHaveBeenCalled();
    expect(repository.markSent).not.toHaveBeenCalled();
  });

  it("allows household child_friendly regeneration to reach provider send", async () => {
    const householdChildFriendlyCommand = {
      commandVersion: "generation-command.v2" as const,
      kind: "regenerate_menu" as const,
      request: {
        idempotencyKey: key,
        sourceMenuId: "88000000-0000-4000-8000-000000000001",
        changeReason: "child_friendly" as const,
        changeReasonCustom: null,
        expiredPantryConfirmations: [],
      },
    };
    const menu = makeValidatedMenu();
    const execution: Extract<GenerationExecutionContext, { kind: "regenerate_menu" }> = {
      kind: "regenerate_menu",
      command: householdChildFriendlyCommand,
      requestId,
      generationContext: makeGenerationContext(),
      expectedSafetyFingerprint: "fp",
      startedAtMonotonicMs: 0,
      deadlineAtMonotonicMs: 50_000,
      regeneration: {
        sourceMenuId: householdChildFriendlyCommand.request.sourceMenuId,
        sourceMenu: menu,
        derivationGroupId: "a1000000-0000-4000-8000-000000000001",
        replaceDishId: null,
        retainedDishIds: menu.dishes.map((dish) => dish.id),
        excludedDishIds: menu.dishes.map((dish) => dish.id),
        sourceSafetyFingerprint: "source-fp",
        sourcePreferenceSnapshot: {},
        existingDerivationMenus: [],
        artifacts: {
          retainedDishes: [],
          sourceDishToReplace: null,
          promptDto: null,
          retainedRefMap: new Map(),
        },
      },
    };
    const repository = makeRepository();
    const callOpenRouter = vi.fn<GenerationDependencies["callOpenRouter"]>().mockResolvedValue({
      mode: "full_menu" as const,
      output: scenarios.success,
      modelId: models[0],
    });
    // 重複判定を避けるため別メニュー署名になるよう validate を通す
    vi.mocked(validateGeneratedMenu).mockReturnValue({
      ok: true,
      menu: makeValidatedMenu({
        dishes: menu.dishes.map((dish) => ({
          ...dish,
          name: `${dish.name} 別案`,
        })),
      }),
      labelConfirmations: [],
      safetyFingerprint: "sha256:test",
    });
    await runGeneration(
      makeDeps({
        repository,
        loadExecutionContext: vi.fn(() => Promise.resolve(execution)),
        callOpenRouter,
      }),
      householdChildFriendlyCommand,
    );
    expect(callOpenRouter).toHaveBeenCalled();
    expect(repository.markSent).toHaveBeenCalled();
  });
});
