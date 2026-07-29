import {
  generationCommandVersionV3,
  type GenerationCommand,
} from "../../../shared/contracts/generation.js";
import type { IdeaGenerationContext } from "../../../shared/safety/generation-context.js";
import {
  createIdeaSafetyFingerprint,
  ideaSafetySnapshot,
} from "../../../shared/safety/idea-fingerprint.js";
import { validateGeneratedMenu } from "../../../shared/safety/validate-generated-menu.js";
import { buildGenerationMessages } from "./generation-prompt.js";
import {
  ATTEMPT_TIMEOUT_MS,
  projectProviderConflicts,
  runGeneration,
  type GenerationDependencies,
  type GenerationExecutionContext,
} from "./generation-service.js";
import type { QuotaRequestRecord } from "./generation-repository.js";
import { validateGenerationPreflight } from "./generation-context.js";
import { materializeAiGeneratedMenu } from "./generation-materializer.js";
import { GenerationOutputError, toRepairDiagnostics } from "./generation-repair.js";
import {
  createOpenRouterGenerationSender,
  OpenRouterCallError,
  type OpenRouterGenerationResult,
} from "./openrouter.js";

const benchmarkRequestId = "91000000-0000-4000-8000-000000000001";
const benchmarkIdempotencyKey = "91000000-0000-4000-8000-000000000002";
const benchmarkDraftId = "91000000-0000-4000-8000-000000000003";
const benchmarkMenuId = "91000000-0000-4000-8000-000000000004";
const benchmarkUserId = "91000000-0000-4000-8000-000000000005";
const benchmarkStartedAt = "2026-07-27T00:00:00.000Z";
const benchmarkCompletedAt = "2026-07-27T00:00:01.000Z";
/** FUNCTION_TOTAL_BUDGET_MS リリースロックと一致 */
const benchmarkTotalBudgetMs = 55_000;

export type PaidBenchmarkUnitResult = Readonly<{
  ok: boolean;
  configuration: readonly string[];
  sends: readonly Readonly<{
    models: readonly string[];
    responseModel: string | null;
    excludedModel: string | null;
    elapsedMs: number;
  }>[];
  outcome: "primary_success" | "repair_success" | "failure";
  /** 台帳終端コード（例: invalid_ai_response） */
  failureCodes: readonly string[];
  /**
   * materialize/validate の closed repair code（例: pantry_unit_mismatch）。
   * wire 失敗のみのときは空。raw 出力・自由文 path は載せない。
   */
  diagnosticCodes: readonly string[];
  totalElapsedMs: number;
}>;

/**
 * OpenRouter 受理後の compose を閉じた code だけに写像する（証跡用・本番台帳非永続）。
 * message / raw menu は返さない。
 */
export function diagnoseClosedComposeCodes(
  result: OpenRouterGenerationResult,
  generationContext: GenerationExecutionContext["generationContext"],
  uuid: () => string,
): readonly string[] {
  if (result.mode === "replacement_dish") {
    return Object.freeze(["invalid_provider_menu"]);
  }
  if (result.mode === "flyer_weekly") {
    return Object.freeze(["invalid_provider_menu"]);
  }
  if (result.output.outcome === "constraint_conflict") {
    // 本番 compose と同じ projectProviderConflicts を通す。
    // wire 上の conflict code だけでは invalid_provider_menu になるケースを
    // constraint_conflict と誤証跡しない（idea 空 ref・未知 code 等）。
    try {
      const projected = projectProviderConflicts(result.output.conflicts, generationContext);
      const codes = new Set<string>(["constraint_conflict"]);
      for (const conflict of projected) {
        codes.add(conflict.code);
      }
      return Object.freeze([...codes]);
    } catch (error) {
      if (error instanceof GenerationOutputError) {
        return Object.freeze(error.issues.map((issue) => issue.code));
      }
      return Object.freeze(["invalid_provider_menu"]);
    }
  }
  try {
    const checked = validateGeneratedMenu(
      materializeAiGeneratedMenu(result.output.menu, generationContext, uuid),
      generationContext,
    );
    if (checked.ok) return Object.freeze([]);
    return Object.freeze(toRepairDiagnostics(checked.issues).map((issue) => issue.code));
  } catch (error) {
    if (error instanceof GenerationOutputError) {
      return Object.freeze(error.issues.map((issue) => issue.code));
    }
    return Object.freeze(["invalid_provider_menu"]);
  }
}

export type PaidBenchmarkRepositoryTransition = Readonly<{
  kind:
    | "lookup"
    | "reserve_new"
    | "replay_existing"
    | "mark_sent"
    | "reserve_repair"
    | "record_model"
    | "finalize_failure"
    | "finalize_conflict"
    | "finalize_success"
    | "status";
  userSuccessReserved: number;
  userSuccessConsumed: number;
  attemptReserved: number;
  attemptSent: number;
  globalReserved: number;
  globalSent: number;
}>;

type RepositoryObserver = (transition: PaidBenchmarkRepositoryTransition) => void;

type BenchmarkRepository = GenerationDependencies["repository"];

function createFixedGenerationContext(): IdeaGenerationContext {
  return {
    targetMode: "idea",
    submission: {
      mealType: "breakfast",
      mainIngredients: ["鶏もも肉"],
      cuisineGenre: "japanese",
      targetMode: "idea",
      targetMemberIds: [],
      servings: 2,
      timeLimitMinutes: 15,
      budgetPreference: "standard",
      avoidIngredients: [],
      memo: "",
      pantrySelections: [],
    },
    safety: null,
    pantryItems: [],
    memberPreferences: [],
    targetMembers: [],
    allergenVersion: null,
    foodRuleVersion: null,
    expiredPantryChecks: [],
    idempotencyKey: benchmarkIdempotencyKey,
    preferenceSnapshot: {},
    safetySnapshot: ideaSafetySnapshot,
  };
}

const benchmarkCommand: Extract<GenerationCommand, { kind: "new_menu" }> = {
  commandVersion: generationCommandVersionV3,
  qualityMode: false,
  kind: "new_menu",
  request: {
    idempotencyKey: benchmarkIdempotencyKey,
    draftId: benchmarkDraftId,
    draftRevision: 1,
    privacyNoticeVersion: "2026-07-29.v1",
    expiredPantryConfirmations: [],
  },
};

function makeProcessingRecord(): QuotaRequestRecord {
  return {
    request_id: benchmarkRequestId,
    idempotency_key: benchmarkIdempotencyKey,
    status: "processing",
    failure_code: null,
    retry_at: null,
    processing_expires_at: null,
    completed_menu_id: null,
    remaining: 3,
    user_daily_limit: 3,
    consumed: false,
    terminal_details: null,
    actual_model_ids: [],
    started_at: benchmarkStartedAt,
    completed_at: null,
    replayed: false,
  };
}

function createInMemoryRepository(observer?: RepositoryObserver): BenchmarkRepository {
  let record = makeProcessingRecord();
  let userSuccessReserved = 0;
  let userSuccessConsumed = 0;
  let attemptReserved = 0;
  let attemptSent = 0;
  let globalReserved = 0;
  let globalSent = 0;
  const actualModelIds: string[] = [];
  const report = (kind: PaidBenchmarkRepositoryTransition["kind"]): void => {
    observer?.({
      kind,
      userSuccessReserved,
      userSuccessConsumed,
      attemptReserved,
      attemptSent,
      globalReserved,
      globalSent,
    });
  };
  const releaseReservations = (): void => {
    userSuccessReserved = 0;
    attemptReserved = 0;
    globalReserved = 0;
  };
  const terminalRecord = (
    status: "failed" | "constraint_conflict" | "succeeded",
  ): QuotaRequestRecord => ({
    ...record,
    status,
    failure_code: status === "failed" ? record.failure_code : null,
    completed_menu_id: status === "succeeded" ? benchmarkMenuId : null,
    remaining: Math.max(0, 3 - userSuccessConsumed),
    consumed: status === "succeeded",
    actual_model_ids: [...actualModelIds],
    completed_at: benchmarkCompletedAt,
  });

  const repository: BenchmarkRepository = {
    lookup() {
      report("lookup");
      return Promise.resolve({ kind: "miss" });
    },
    replayExisting() {
      report("replay_existing");
      return Promise.reject(new Error("benchmark_replay_forbidden"));
    },
    reserveNew() {
      if (userSuccessReserved + userSuccessConsumed >= 3) {
        record = {
          ...record,
          status: "failed",
          failure_code: "user_daily_limit",
          completed_at: benchmarkCompletedAt,
        };
        report("reserve_new");
        return Promise.resolve(record);
      }
      if (attemptReserved + attemptSent >= 6) {
        record = {
          ...record,
          status: "failed",
          failure_code: "user_attempt_limit",
          completed_at: benchmarkCompletedAt,
        };
        report("reserve_new");
        return Promise.resolve(record);
      }
      if (globalReserved + globalSent >= 20) {
        record = {
          ...record,
          status: "failed",
          failure_code: "global_daily_limit",
          completed_at: benchmarkCompletedAt,
        };
        report("reserve_new");
        return Promise.resolve(record);
      }
      userSuccessReserved += 1;
      attemptReserved += 1;
      globalReserved += 1;
      report("reserve_new");
      return Promise.resolve(record);
    },
    markSent() {
      if (attemptReserved < 1 || globalReserved < 1) {
        record = {
          ...record,
          status: "failed",
          failure_code: "internal_error",
          completed_at: benchmarkCompletedAt,
        };
        releaseReservations();
        report("mark_sent");
        return Promise.resolve({ ...record, sent: false, code: "internal_error" });
      }
      attemptReserved -= 1;
      attemptSent += 1;
      globalReserved -= 1;
      globalSent += 1;
      report("mark_sent");
      return Promise.resolve({ ...record, sent: true, code: null });
    },
    failBeforeSend(_requestId, code, retryAt = null) {
      record = {
        ...record,
        failure_code: code,
        retry_at: retryAt,
      };
      releaseReservations();
      record = terminalRecord("failed");
      report("finalize_failure");
      return Promise.resolve(record);
    },
    reserveRepair() {
      if (attemptReserved + attemptSent >= 6 || globalReserved + globalSent >= 20) {
        return Promise.resolve({ reserved: false, retry_at: null });
      }
      attemptReserved += 1;
      globalReserved += 1;
      report("reserve_repair");
      return Promise.resolve({ reserved: true, retry_at: null });
    },
    recordModel(_requestId, modelId) {
      actualModelIds.push(modelId);
      report("record_model");
      return Promise.resolve();
    },
    fail(_requestId, code, retryAt) {
      record = {
        ...record,
        failure_code: code,
        retry_at: retryAt,
      };
      releaseReservations();
      record = terminalRecord("failed");
      report("finalize_failure");
      return Promise.resolve(record);
    },
    conflict(_requestId, conflicts) {
      const conflictCodes = conflicts.flatMap((conflict) => {
        if (typeof conflict !== "object" || conflict === null || !("code" in conflict)) return [];
        return typeof conflict.code === "string" ? [conflict.code] : [];
      });
      record = {
        ...terminalRecord("constraint_conflict"),
        terminal_details: { conflictCodes },
      };
      releaseReservations();
      report("finalize_conflict");
      return Promise.resolve(record);
    },
    succeed() {
      if (userSuccessReserved !== 1 || userSuccessConsumed >= 3) {
        return Promise.reject(new Error("benchmark_success_reservation_invalid"));
      }
      userSuccessReserved = 0;
      userSuccessConsumed += 1;
      attemptReserved = 0;
      globalReserved = 0;
      record = terminalRecord("succeeded");
      report("finalize_success");
      return Promise.resolve(record);
    },
    status() {
      report("status");
      return Promise.resolve(record);
    },
  };
  return repository;
}

function createUuidFactory(): () => string {
  let counter = 10;
  return () => {
    counter += 1;
    return `92000000-0000-4000-8000-${counter.toString().padStart(12, "0")}`;
  };
}

function failureCodesFromStatus(
  status: Awaited<ReturnType<typeof runGeneration>>,
): readonly string[] {
  if (status.status === "failed") return [status.error.code];
  if (status.status === "constraint_conflict") return ["constraint_conflict"];
  return [];
}

export async function runPaidBenchmarkUnit(input: {
  configuration: readonly string[];
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** unit test用。公開証跡へは含めず、台帳遷移の意味論だけを観測する。 */
  onRepositoryTransition?: RepositoryObserver;
}): Promise<PaidBenchmarkUnitResult> {
  const configuration = Object.freeze([...input.configuration]);
  const monotonicNow = input.now ?? (() => performance.now());
  const requestStartedAtMonotonicMs = monotonicNow();
  const generationContext = createFixedGenerationContext();
  const execution: Extract<GenerationExecutionContext, { kind: "new_menu" }> = {
    kind: "new_menu",
    command: benchmarkCommand,
    requestId: benchmarkRequestId,
    generationContext,
    expectedSafetyFingerprint: createIdeaSafetyFingerprint(),
    startedAtMonotonicMs: requestStartedAtMonotonicMs,
    deadlineAtMonotonicMs: requestStartedAtMonotonicMs + benchmarkTotalBudgetMs,
    regeneration: null,
  };
  const sender = createOpenRouterGenerationSender({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    models: configuration,
    timeoutMs: ATTEMPT_TIMEOUT_MS,
    ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
    now: monotonicNow,
  });
  const sends: Array<PaidBenchmarkUnitResult["sends"][number]> = [];
  const diagnosticCodeSet = new Set<string>();
  const uuidForDiagnostics = createUuidFactory();
  const callOpenRouter: GenerationDependencies["callOpenRouter"] = async (
    callInput,
  ): Promise<OpenRouterGenerationResult> => {
    const excludedModelIds = callInput.excludedModelIds ?? [];
    const models = configuration.filter((model) => !excludedModelIds.includes(model));
    const startedAt = monotonicNow();
    let responseModel: string | null = null;
    try {
      const result = await sender(callInput);
      responseModel = result.modelId;
      // 証跡用: wire 受理後の materialize/validate closed codes（raw は保持しない）
      for (const code of diagnoseClosedComposeCodes(
        result,
        generationContext,
        uuidForDiagnostics,
      )) {
        diagnosticCodeSet.add(code);
      }
      return result;
    } catch (error) {
      if (error instanceof OpenRouterCallError) {
        responseModel = error.modelId;
        // wire/envelope 失敗は top-level code のみ（subcode なし）
        if (error.code === "invalid_ai_response") {
          diagnosticCodeSet.add("wire_or_envelope_invalid");
        }
      }
      throw error;
    } finally {
      sends.push({
        models: Object.freeze([...models]),
        responseModel,
        excludedModel: excludedModelIds[0] ?? null,
        elapsedMs: Math.max(0, Math.trunc(monotonicNow() - startedAt)),
      });
    }
  };

  const deps: GenerationDependencies = {
    user: {
      userId: benchmarkUserId,
      accessToken: "benchmark-no-db-access",
      email: "owner@example.com",
    },
    repository: createInMemoryRepository(input.onRepositoryTransition),
    models: configuration,
    resolveIntegrityContext: () =>
      Promise.resolve({
        kind: "new_menu",
        targetMode: "idea",
        servings: 2,
        targetMemberIds: [],
        sourceMenuVersion: null,
      }),
    loadExecutionContext: () => Promise.resolve(execution),
    validatePreflight: validateGenerationPreflight,
    buildMessages: buildGenerationMessages,
    callOpenRouter,
    now: () => new Date(benchmarkStartedAt),
    monotonicNow,
    openRouterTimeoutMs: ATTEMPT_TIMEOUT_MS,
    requestStartedAtMonotonicMs,
    functionTotalBudgetMs: benchmarkTotalBudgetMs,
    uuid: createUuidFactory(),
    // ベンチ証跡は戻り値の閉じたcodeだけ。production loggerへは流さない。
    logTerminalEvent: () => {},
  };

  const status = await runGeneration(deps, benchmarkCommand);
  // finalize/status読取後の値を一度だけ確定し、総予算境界到達を成功へ戻さない。
  const totalElapsedMs = Math.max(0, Math.trunc(monotonicNow() - requestStartedAtMonotonicMs));
  const totalDeadlineExceeded = totalElapsedMs >= benchmarkTotalBudgetMs;
  const ok = status.status === "succeeded" && !totalDeadlineExceeded;
  const outcome =
    ok && sends.length === 1
      ? ("primary_success" as const)
      : ok
        ? ("repair_success" as const)
        : ("failure" as const);
  return {
    ok,
    configuration,
    sends: Object.freeze([...sends]),
    outcome,
    failureCodes: Object.freeze([
      ...(totalDeadlineExceeded ? ["generation_timeout"] : failureCodesFromStatus(status)),
    ]),
    diagnosticCodes: Object.freeze([...diagnosticCodeSet]),
    totalElapsedMs,
  };
}
