import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  generationConflictCodes,
  generationConflictCopy,
  generationConflictSchema,
  generationFailureCodes,
  releaseQuota,
  type GenerationCommand,
  type GenerationFailureCode,
  type GenerationStatusData,
  type MenuValidationResult,
} from "../../../shared/contracts/generation.js";
import { createCurrentSafetyFingerprint } from "../../../shared/safety/fingerprint.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";
import { validateGeneratedMenu } from "../../../shared/safety/validate-generated-menu.js";
import { getServerEnv } from "./env.js";
import {
  loadGenerationContext,
  validateGenerationPreflight,
  type GenerationPreflightResult,
} from "./generation-context.js";
import { materializeAiGeneratedMenu } from "./generation-materializer.js";
import { buildGenerationMessages } from "./generation-prompt.js";
import {
  GenerationOutputError,
  toRepairDiagnostics,
  type GenerationRepairDiagnostic,
} from "./generation-repair.js";
import {
  createGenerationRepository,
  type AuthenticatedUser,
  type GenerationRepository,
  type QuotaRequestRecord,
} from "./generation-repository.js";
import { HttpError, json } from "./http.js";
import {
  OpenRouterCallError,
  sendMenuGeneration,
  type OpenRouterGenerationResult,
  type OpenRouterMessage,
} from "./openrouter.js";

/** 1 回の OpenRouter 試行上限（ms） */
export const ATTEMPT_TIMEOUT_MS = 20_000;
/** 最終化用に確保する残り予算（ms） */
export const FINALIZE_RESERVE_MS = 2_000;
/** markSent 前に必要な最小残り予算 */
export const REQUIRED_SEND_BUDGET_MS = ATTEMPT_TIMEOUT_MS + FINALIZE_RESERVE_MS;

export type GenerationDependencies = {
  user: AuthenticatedUser;
  repository: Omit<GenerationRepository, "userClient">;
  models: readonly string[];
  loadExecutionContext(
    command: GenerationCommand,
    requestId: string,
    deadlineAtMonotonicMs: number,
  ): Promise<{ generationContext: GenerationContext }>;
  validatePreflight(context: GenerationContext, now: Date): GenerationPreflightResult;
  buildMessages(context: GenerationContext): readonly OpenRouterMessage[];
  callOpenRouter(
    input: Parameters<typeof sendMenuGeneration>[0],
  ): Promise<OpenRouterGenerationResult>;
  now(): Date;
  /** 単調時計。認証・予約も同じ 50s 予算を消費する */
  monotonicNow(): number;
  openRouterTimeoutMs: number;
  requestStartedAtMonotonicMs: number;
  functionTotalBudgetMs: number;
  uuid(): string;
};

const generationFailureCodeSchema = z.enum(generationFailureCodes);
const providerConflictCodeSchema = z.enum([
  "must_use_conflict",
  "allergen_pantry_conflict",
  "dish_count_conflict",
  "mandatory_safety_conflict",
]);
const providerConflictInputSchema = z
  .array(
    z
      .object({
        code: z.string(),
        message: z.unknown(),
        conditionRefs: z.array(z.string()).max(24),
      })
      .strict(),
  )
  .min(1)
  .max(12);

const failureCopy: Record<GenerationFailureCode, { message: string; retryable: boolean }> = {
  consent_required: { message: "AIへ送る情報の説明を確認してください。", retryable: false },
  draft_not_found: { message: "保存した献立条件が見つかりませんでした。", retryable: false },
  invalid_request: { message: "献立条件を確認してください。", retryable: false },
  generation_in_progress: { message: "別の献立を作成中です。", retryable: true },
  user_daily_limit: {
    message: "今日は5回利用しました。明日0:00（日本時間）から利用できます",
    retryable: false,
  },
  user_attempt_limit: {
    message: "本日のAI通信試行上限に達しました。明日0:00（日本時間）から利用できます",
    retryable: false,
  },
  user_short_window_limit: {
    message: "10分間の通信試行上限に達しました。しばらくしてから再度お試しください",
    retryable: false,
  },
  global_daily_limit: {
    message: "本日分のAI受付がいっぱいです。成功回数には含まれません。明日0:00から再開します",
    retryable: false,
  },
  allergy_unconfirmed: {
    message: "アレルギー確認が必要な項目があります。確認してからもう一度お試しください。",
    retryable: false,
  },
  allergen_missing: {
    message: "アレルギー情報の登録が必要です。家族の設定を確認してください。",
    retryable: false,
  },
  unmapped_custom_allergy: {
    message: "登録されたアレルギー内容を確認できませんでした。家族の設定を確認してください。",
    retryable: false,
  },
  unsupported_diet_unconfirmed: {
    message: "離乳食・飲み込み/嚥下・治療食の確認が必要です。",
    retryable: false,
  },
  regeneration_not_implemented: {
    message: "再生成は次の計画で有効になります。",
    retryable: false,
  },
  unsupported_diet: {
    message: "離乳食、飲み込み・嚥下、治療食の依頼には対応できません。",
    retryable: false,
  },
  allergy_conflict: {
    message: "アレルギー食材が、使いたい食材に含まれています",
    retryable: false,
  },
  expired_pantry_unconfirmed: {
    message: "期限を過ぎた食材は、今回の実物確認が必要です。",
    retryable: false,
  },
  model_unavailable: {
    message: "AIが混み合っています。成功回数には含まれません。",
    retryable: true,
  },
  invalid_ai_response: {
    message: "献立を正しく確認できませんでした。成功回数には含まれません。",
    retryable: true,
  },
  generation_timeout: {
    message: "作成に時間がかかりました。成功回数には含まれません。",
    retryable: true,
  },
  internal_error: {
    message: "献立を作成できませんでした。成功回数には含まれません。",
    retryable: true,
  },
};

function closedFailureCode(error: unknown): GenerationFailureCode {
  if (!(error instanceof HttpError)) return "internal_error";
  const parsed = generationFailureCodeSchema.safeParse(error.code);
  return parsed.success ? parsed.data : "internal_error";
}

export function projectProviderConflicts(
  input: unknown,
  context: GenerationContext,
): readonly z.infer<typeof generationConflictSchema>[] {
  const parsed = providerConflictInputSchema.safeParse(input);
  if (!parsed.success) throw new GenerationOutputError(["invalid_provider_menu"]);
  const allowedRefs = new Set([
    ...context.targetMembers.map((member) => member.anonymousRef),
    ...context.submission.pantrySelections.map((_, index) => `pantry_${String(index + 1)}`),
  ]);
  const seen = new Set<z.infer<typeof providerConflictCodeSchema>>();
  return parsed.data.map((conflict) => {
    const code = providerConflictCodeSchema.safeParse(conflict.code);
    if (!code.success || seen.has(code.data)) {
      throw new GenerationOutputError(["invalid_provider_menu"]);
    }
    seen.add(code.data);
    const conditionRefs = [...new Set(conflict.conditionRefs)];
    if (conditionRefs.some((ref) => !allowedRefs.has(ref))) {
      throw new GenerationOutputError(["invalid_provider_menu"]);
    }
    return {
      code: code.data,
      message: generationConflictCopy[code.data],
      conditionRefs,
    };
  });
}

export function toGenerationStatus(
  record: QuotaRequestRecord,
  idempotencyKey: string,
): GenerationStatusData {
  const quota = {
    consumed: record.consumed ?? record.status === "succeeded",
    remaining: record.remaining ?? 0,
    userDailyLimit: record.user_daily_limit ?? releaseQuota.userDailySuccessLimit,
    limitKind:
      record.failure_code === "user_daily_limit"
        ? ("user" as const)
        : record.failure_code === "global_daily_limit"
          ? ("global" as const)
          : record.failure_code === "model_unavailable"
            ? ("provider" as const)
            : null,
    retryAt: record.retry_at ?? null,
  };
  if (record.status === "not_started") return { status: "not_started", idempotencyKey, quota };
  const requestId = record.request_id;
  if (requestId === undefined) throw new Error("request_id_missing");
  if (record.status === "processing") {
    return {
      status: "processing",
      idempotencyKey,
      requestId,
      quota,
      startedAt: requireStoredTimestamp(record.started_at, "started_at_missing"),
    };
  }
  const completedAt = requireStoredTimestamp(record.completed_at, "completed_at_missing");
  if (record.status === "succeeded") {
    if (record.completed_menu_id === null || record.completed_menu_id === undefined) {
      throw new Error("completed_menu_id_missing");
    }
    return {
      status: "succeeded",
      idempotencyKey,
      requestId,
      quota,
      menuId: record.completed_menu_id,
      completedAt,
    };
  }
  if (record.status === "constraint_conflict") {
    // 台帳は code のみ。表示 message は Task 9 の generationConflictCopy から再構成する
    const codes = z
      .object({
        conflictCodes: z.array(z.enum(generationConflictCodes)).min(1).max(12),
      })
      .strict()
      .parse(record.terminal_details).conflictCodes;
    const uniqueCodes = [...new Set(codes)];
    if (uniqueCodes.length !== codes.length) {
      throw new Error("terminal_conflict_codes_invalid");
    }
    return {
      status: "constraint_conflict",
      idempotencyKey,
      requestId,
      quota,
      completedAt,
      conflicts: uniqueCodes.map((code) =>
        generationConflictSchema.parse({
          code,
          message: generationConflictCopy[code],
          conditionRefs: [],
        }),
      ),
    };
  }
  const parsedCode = generationFailureCodeSchema.safeParse(record.failure_code);
  const code = parsedCode.success ? parsedCode.data : "internal_error";
  return {
    status: "failed",
    idempotencyKey,
    requestId,
    quota,
    completedAt,
    error: { code, ...failureCopy[code] },
  };
}

function requireStoredTimestamp(
  value: string | null | undefined,
  missingCode: "started_at_missing" | "completed_at_missing",
): string {
  if (value === null || value === undefined) throw new Error(missingCode);
  return value;
}

export function generationResponse(result: GenerationStatusData): Response {
  const status =
    result.status === "processing"
      ? 202
      : result.status === "failed" &&
          ["user_daily_limit", "user_attempt_limit", "user_short_window_limit"].includes(
            result.error.code,
          )
        ? 429
        : result.status === "failed" &&
            ["global_daily_limit", "model_unavailable", "generation_timeout"].includes(
              result.error.code,
            )
          ? 503
          : result.status === "failed"
            ? 422
            : 200;
  return json(status, { ok: true, data: result });
}

export function createGenerationDeps(
  user: AuthenticatedUser,
  timing: { requestStartedAtMonotonicMs: number },
): GenerationDependencies {
  const env = getServerEnv();
  return {
    user,
    repository: createGenerationRepository(user),
    models: env.openRouter.models,
    loadExecutionContext: async (command, requestId) => {
      if (command.kind !== "new_menu") {
        throw new HttpError(
          422,
          "regeneration_not_implemented",
          "再生成は次の計画で有効になります。",
        );
      }
      return {
        generationContext: await loadGenerationContext(user, requestId, command.request),
      };
    },
    validatePreflight: validateGenerationPreflight,
    buildMessages: buildGenerationMessages,
    callOpenRouter: sendMenuGeneration,
    now: () => new Date(),
    monotonicNow: () => performance.now(),
    openRouterTimeoutMs: env.openRouter.timeoutMs,
    requestStartedAtMonotonicMs: timing.requestStartedAtMonotonicMs,
    functionTotalBudgetMs: env.openRouter.functionTotalBudgetMs,
    uuid: randomUUID,
  };
}

type CheckedOutput =
  | { kind: "valid"; checked: Extract<MenuValidationResult, { ok: true }> }
  | { kind: "conflict"; conflicts: readonly z.infer<typeof generationConflictSchema>[] }
  | { kind: "invalid"; issues: readonly { code: string; path?: string; message?: string }[] };

function checkOutput(
  result: OpenRouterGenerationResult,
  context: GenerationContext,
  uuid: () => string,
): CheckedOutput {
  if (result.output.outcome === "constraint_conflict") {
    try {
      return {
        kind: "conflict",
        conflicts: projectProviderConflicts(result.output.conflicts, context),
      };
    } catch (error) {
      if (!(error instanceof GenerationOutputError)) throw error;
      return { kind: "invalid", issues: error.issues };
    }
  }
  try {
    const checked = validateGeneratedMenu(
      materializeAiGeneratedMenu(result.output.menu, context, uuid),
      context,
    );
    return checked.ok ? { kind: "valid", checked } : { kind: "invalid", issues: checked.issues };
  } catch (error) {
    if (!(error instanceof GenerationOutputError)) throw error;
    return { kind: "invalid", issues: error.issues };
  }
}

class StatusHydrationError extends Error {
  constructor(readonly cause: unknown) {
    super("status_hydration_failed");
  }
}

class TerminalTransitionError extends Error {
  constructor(readonly cause: unknown) {
    super("terminal_transition_failed");
  }
}

function unwrapStatusHydration(error: unknown): unknown {
  return error instanceof StatusHydrationError ? error.cause : error;
}

export async function runGeneration(
  deps: GenerationDependencies,
  command: GenerationCommand,
): Promise<GenerationStatusData> {
  const key = command.request.idempotencyKey;
  const reserved = await deps.repository.reserve(command);
  const hydrate = async () => {
    try {
      return toGenerationStatus(await deps.repository.status(key), key);
    } catch (error) {
      throw new StatusHydrationError(error);
    }
  };
  if (reserved.status !== "processing" || reserved.replayed === true) {
    try {
      return await hydrate();
    } catch (error) {
      if (error instanceof StatusHydrationError) throw error.cause;
      throw error;
    }
  }
  const requestId = reserved.request_id;
  if (requestId === undefined) throw new Error("request_id_missing");
  const fail = async (code: GenerationFailureCode, retryAt: string | null) => {
    try {
      await deps.repository.fail(requestId, code, retryAt);
      return await hydrate();
    } catch (error) {
      throw new TerminalTransitionError(unwrapStatusHydration(error));
    }
  };
  const conflict = async (conflicts: readonly z.infer<typeof generationConflictSchema>[]) => {
    await deps.repository.conflict(requestId, [...conflicts]);
    return await hydrate();
  };

  const deadlineAtMonotonicMs = deps.requestStartedAtMonotonicMs + deps.functionTotalBudgetMs;
  const remainingMs = () => deadlineAtMonotonicMs - deps.monotonicNow();
  const timeoutForAttempt = () =>
    Math.min(
      ATTEMPT_TIMEOUT_MS,
      deps.openRouterTimeoutMs,
      Math.max(0, remainingMs() - FINALIZE_RESERVE_MS),
    );
  const canRepair = () => remainingMs() >= REQUIRED_SEND_BUDGET_MS;

  try {
    const execution = await deps.loadExecutionContext(command, requestId, deadlineAtMonotonicMs);
    const context = execution.generationContext;
    const preflight = deps.validatePreflight(context, deps.now());
    if (!preflight.ok) {
      if (preflight.terminal === "constraint_conflict") {
        return await conflict(preflight.conflicts);
      }
      const code = generationFailureCodeSchema.safeParse(preflight.primaryCode);
      return await fail(code.success ? code.data : "internal_error", null);
    }
    const originalMessages = deps.buildMessages(context);

    // markSent 直前の pre-send ゲート。不足時は HTTP を一度も送らず timeout へ
    if (remainingMs() < REQUIRED_SEND_BUDGET_MS) {
      await deps.repository.failBeforeSend(requestId, "generation_timeout");
      return await hydrate();
    }

    const call = async (
      excludedModelIds: readonly string[] = [],
      messages: readonly OpenRouterMessage[] = originalMessages,
    ): Promise<OpenRouterGenerationResult | "terminal"> => {
      const attemptTimeout = timeoutForAttempt();
      if (attemptTimeout <= 0) {
        throw new OpenRouterCallError("generation_timeout");
      }
      const sent = await deps.repository.markSent(requestId);
      // 短期窓拒否は markSent 内で failed 終端化済み。再 fail せず status を読む。
      if (!sent.sent) {
        return "terminal";
      }
      let result: OpenRouterGenerationResult;
      try {
        result = await deps.callOpenRouter({
          messages,
          timeoutMs: attemptTimeout,
          excludedModelIds,
        });
      } catch (error) {
        if (
          error instanceof OpenRouterCallError &&
          error.code === "invalid_ai_response" &&
          error.modelId !== null &&
          deps.models.includes(error.modelId)
        ) {
          await deps.repository.recordModel(requestId, error.modelId);
        }
        throw error;
      }
      if (!deps.models.includes(result.modelId)) {
        throw new OpenRouterCallError("invalid_ai_response");
      }
      await deps.repository.recordModel(requestId, result.modelId);
      return result;
    };

    let firstResult: OpenRouterGenerationResult | null = null;
    let firstIssues: readonly { code: string; path?: string; message?: string }[] | null = null;
    let firstModelId: string | null = null;
    try {
      const firstCall = await call();
      if (firstCall === "terminal") return await hydrate();
      firstResult = firstCall;
      firstModelId = firstResult.modelId;
    } catch (error) {
      if (!(error instanceof OpenRouterCallError)) throw error;
      const code = generationFailureCodeSchema.safeParse(error.code);
      if (!code.success) return await fail("internal_error", null);
      // timeout は修理しない
      if (code.data === "generation_timeout") return await fail(code.data, error.retryAt);
      if (code.data !== "invalid_ai_response") return await fail(code.data, error.retryAt);
      firstModelId =
        error.modelId !== null && deps.models.includes(error.modelId) ? error.modelId : null;
      firstIssues = [{ code: "invalid_provider_menu" }];
    }

    if (firstResult !== null) {
      const output = checkOutput(firstResult, context, () => deps.uuid());
      if (output.kind === "conflict") return await conflict(output.conflicts);
      if (output.kind === "valid") {
        await deps.repository.succeed({
          requestId,
          menu: output.checked.menu,
          preferenceSnapshot: context.preferenceSnapshot,
          safetySnapshot: context.safetySnapshot,
          safetyFingerprint: createCurrentSafetyFingerprint(context.safety),
          allergenVersion: context.safety.dictionaryVersion,
          foodRuleVersion: context.safety.foodRuleVersion,
          targetMembers: [...context.targetMembers],
          expiredChecks: [...context.expiredPantryChecks],
          sourceMenuId: null,
          changeReason: null,
          changeReasonCustom: null,
        });
        return await hydrate();
      }
      firstIssues = output.issues;
    }

    // repair は canRepair（20s+2s 残）のときだけ。timeout 経路はここへ来ない
    if (!canRepair()) return await fail("invalid_ai_response", null);
    const excludedModelIds = firstModelId === null ? [] : [firstModelId];
    const eligibleModels = deps.models.filter((model) => !excludedModelIds.includes(model));
    if (eligibleModels.length === 0) return await fail("invalid_ai_response", null);
    const repair = await deps.repository.reserveRepair(requestId);
    if (!repair.reserved) return await fail("invalid_ai_response", repair.retry_at);
    const diagnostics: readonly GenerationRepairDiagnostic[] = toRepairDiagnostics(
      firstIssues ?? [{ code: "invalid_provider_menu" }],
    );
    let repaired: OpenRouterGenerationResult;
    try {
      const repairedCall = await call(excludedModelIds, [
        ...originalMessages,
        {
          role: "user",
          content: `前の結果を次の項目だけ修正し、全体JSONを一度だけ再生成してください: ${JSON.stringify(diagnostics)}`,
        },
      ]);
      if (repairedCall === "terminal") return await hydrate();
      repaired = repairedCall;
    } catch (error) {
      if (!(error instanceof OpenRouterCallError)) throw error;
      const code = generationFailureCodeSchema.safeParse(error.code);
      return await fail(code.success ? code.data : "internal_error", error.retryAt);
    }
    const repairedOutput = checkOutput(repaired, context, () => deps.uuid());
    if (repairedOutput.kind === "conflict") return await conflict(repairedOutput.conflicts);
    if (repairedOutput.kind === "invalid") return await fail("invalid_ai_response", null);
    await deps.repository.succeed({
      requestId,
      menu: repairedOutput.checked.menu,
      preferenceSnapshot: context.preferenceSnapshot,
      safetySnapshot: context.safetySnapshot,
      safetyFingerprint: createCurrentSafetyFingerprint(context.safety),
      allergenVersion: context.safety.dictionaryVersion,
      foodRuleVersion: context.safety.foodRuleVersion,
      targetMembers: [...context.targetMembers],
      expiredChecks: [...context.expiredPantryChecks],
      sourceMenuId: null,
      changeReason: null,
      changeReasonCustom: null,
    });
    return await hydrate();
  } catch (error) {
    if (error instanceof TerminalTransitionError) throw error.cause;
    if (error instanceof StatusHydrationError) throw error.cause;
    try {
      return await fail(closedFailureCode(error), null);
    } catch (terminalError) {
      if (terminalError instanceof TerminalTransitionError) throw terminalError.cause;
      if (terminalError instanceof StatusHydrationError) throw terminalError.cause;
      throw terminalError;
    }
  }
}
