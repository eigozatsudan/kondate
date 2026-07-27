import {
  generationCommandVersionV2,
  type GenerationCommand,
} from "../../../shared/contracts/generation.js";
import type { IdeaGenerationContext } from "../../../shared/safety/generation-context.js";
import {
  createIdeaSafetyFingerprint,
  ideaSafetySnapshot,
} from "../../../shared/safety/idea-fingerprint.js";
import { buildGenerationMessages } from "./generation-prompt.js";
import {
  ATTEMPT_TIMEOUT_MS,
  runGeneration,
  type GenerationDependencies,
  type GenerationExecutionContext,
} from "./generation-service.js";
import type { QuotaRequestRecord } from "./generation-repository.js";
import { validateGenerationPreflight } from "./generation-context.js";
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
const benchmarkTotalBudgetMs = 50_000;

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
  failureCodes: readonly string[];
  totalElapsedMs: number;
}>;

export type PaidBenchmarkRepositoryTransition = Readonly<{
  kind:
    | "lookup"
    | "reserve"
    | "mark_sent"
    | "reserve_repair"
    | "record_model"
    | "finalize_failure"
    | "finalize_conflict"
    | "finalize_success"
    | "status";
  attemptsReserved: number;
  sends: number;
  successes: number;
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
  commandVersion: generationCommandVersionV2,
  kind: "new_menu",
  request: {
    idempotencyKey: benchmarkIdempotencyKey,
    draftId: benchmarkDraftId,
    draftRevision: 1,
    privacyNoticeVersion: "2026-07-26.v1",
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
  let attemptsReserved = 1;
  let sends = 0;
  let successes = 0;
  const actualModelIds: string[] = [];
  const report = (kind: PaidBenchmarkRepositoryTransition["kind"]): void => {
    observer?.({ kind, attemptsReserved, sends, successes });
  };
  const terminalRecord = (
    status: "failed" | "constraint_conflict" | "succeeded",
  ): QuotaRequestRecord => ({
    ...record,
    status,
    failure_code: status === "failed" ? record.failure_code : null,
    completed_menu_id: status === "succeeded" ? benchmarkMenuId : null,
    remaining: Math.max(0, 3 - successes),
    consumed: status === "succeeded",
    actual_model_ids: [...actualModelIds],
    completed_at: benchmarkCompletedAt,
  });

  const repository: BenchmarkRepository = {
    lookup() {
      report("lookup");
      // hit を返すことで、production runGeneration のDB integrity解決を通らず、
      // 固定した非PIIコンテキストだけで隔離ベンチを成立させる。
      return Promise.resolve({
        kind: "hit",
        requestId: benchmarkRequestId,
        requestHmacVersion: generationCommandVersionV2,
        integrity: {
          kind: "new_menu",
          targetMode: "idea",
          servings: 2,
          targetMemberIds: [],
          sourceMenuVersion: null,
        },
      });
    },
    replayExisting() {
      report("reserve");
      return Promise.resolve(record);
    },
    reserveNew() {
      report("reserve");
      return Promise.resolve(record);
    },
    markSent() {
      sends += 1;
      report("mark_sent");
      return Promise.resolve({ ...record, sent: true, code: null });
    },
    failBeforeSend(_requestId, code, retryAt = null) {
      record = {
        ...record,
        failure_code: code,
        retry_at: retryAt,
      };
      record = terminalRecord("failed");
      report("finalize_failure");
      return Promise.resolve(record);
    },
    reserveRepair() {
      if (attemptsReserved >= 6 || sends >= 20) {
        return Promise.resolve({ reserved: false, retry_at: null });
      }
      attemptsReserved += 1;
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
      report("finalize_conflict");
      return Promise.resolve(record);
    },
    succeed() {
      successes += 1;
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
  const callOpenRouter: GenerationDependencies["callOpenRouter"] = async (
    callInput,
  ): Promise<OpenRouterGenerationResult> => {
    const excludedModelIds = callInput.excludedModelIds ?? [];
    const models = configuration.filter((model) => !excludedModelIds.includes(model));
    const startedAt = monotonicNow();
    let responseModel: string | null = null;
    try {
      const result = await sender({ ...callInput, models: configuration });
      responseModel = result.modelId;
      return result;
    } catch (error) {
      if (error instanceof OpenRouterCallError) responseModel = error.modelId;
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
    user: { userId: benchmarkUserId, accessToken: "benchmark-no-db-access" },
    repository: createInMemoryRepository(input.onRepositoryTransition),
    models: configuration,
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
  const ok = status.status === "succeeded";
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
    failureCodes: Object.freeze([...failureCodesFromStatus(status)]),
    totalElapsedMs: Math.max(0, Math.trunc(monotonicNow() - requestStartedAtMonotonicMs)),
  };
}
