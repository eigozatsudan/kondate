import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  FINALIZE_RESERVE_MS as SHARED_FINALIZE_RESERVE_MS,
  OPENROUTER_TIMEOUT_MS,
} from "../../../shared/contracts/function-budget.js";
import {
  generationConflictCodes,
  generationConflictCopy,
  generationConflictSchema,
  generationFailureCodes,
  issueMessages,
  type GenerationCommand,
  type GenerationFailureCode,
  type GenerationIntegrityContextV2,
  type GenerationStatusData,
  type MenuValidationResult,
  type ValidatedMenu,
} from "../../../shared/contracts/generation.js";
import {
  createCurrentSafetyFingerprint,
  createFinalizeSafetyFingerprint,
} from "../../../shared/safety/fingerprint.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";
import {
  createIdeaSafetyFingerprint,
  ideaSafetySnapshot,
} from "../../../shared/safety/idea-fingerprint.js";
import { collectGuaranteePhraseIssuesFromDishRegenAiOutput } from "../../../shared/safety/guarantee-phrases.js";
import { collectNonJapaneseUserTextIssuesFromDishRegenAiOutput } from "../../../shared/safety/japanese-user-text.js";
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
import { resolveGenerationIntegrityContext } from "./generation-integrity-context.js";
import {
  createGenerationRepository,
  GenerationFinalizeTimeoutError,
  type AuthenticatedUserWithEmail,
  type GenerationRepository,
  type QuotaRequestRecord,
} from "./generation-repository.js";
import { HttpError, json } from "./http.js";
import { logGenerationEvent } from "./logger.js";
import { getSupabaseAdmin } from "./supabase-admin.js";
import {
  createOpenRouterGenerationSender,
  ensureOpenRouterRuntimeModelPolicy,
  OpenRouterCallError,
  sendMenuGeneration,
  type OpenRouterGenerationResult,
  type OpenRouterMessage,
} from "./openrouter.js";
import { runWithOpenRouterMockScenario } from "./openrouter-mock-scenario.js";
import {
  DIVERSITY_HINTS_ENABLED,
  loadRecentDishHints,
  type RecentDishHint,
} from "./diversity-hints.js";
import { createRegenerationLoaderDeps } from "./regeneration-adapter.js";
import {
  isRegenerationDuplicate,
  loadRegenerationExecutionContext,
  materializeDishRegenerationCandidate,
  reloadExistingDerivationMenus,
} from "./regeneration-context.js";
import { maybeEnqueueShareJob } from "./share-enqueue.js";
import { createUserScopedSupabase } from "./supabase-user.js";

/** L13 フラグを boolean として読む（`true as const` の死枝 lint 回避 + テスト mock 可） */
function isDiversityHintsEnabled(flag: boolean): boolean {
  return flag;
}

/** 1 回の OpenRouter 試行上限（ms）。OPENROUTER_TIMEOUT_MS リリースロックと一致させる */
export const ATTEMPT_TIMEOUT_MS = OPENROUTER_TIMEOUT_MS;
/** 最終化用に確保する残り予算（ms） */
export const FINALIZE_RESERVE_MS = SHARED_FINALIZE_RESERVE_MS;
/** markSent 前に必要な最小残り予算（試行上限 + finalize 予約） */
export const REQUIRED_SEND_BUDGET_MS = ATTEMPT_TIMEOUT_MS + FINALIZE_RESERVE_MS;

/** 全 kind 共通の実行コンテキスト基底（Plan 4 が再生成経路で再利用） */
type ExecutionBase = {
  requestId: string;
  generationContext: GenerationContext;
  expectedSafetyFingerprint: string;
  startedAtMonotonicMs: number;
  deadlineAtMonotonicMs: number;
};

/**
 * 再生成時に loadExecutionContext が埋めるペイロード。
 * Plan 4 所有の prompt/materialization データは artifacts に閉じ、
 * スキーマガードなしでは信頼しない。
 */
export type RegenerationExecutionPayload = {
  sourceMenuId: string;
  sourceMenu: ValidatedMenu;
  derivationGroupId: string;
  replaceDishId: string | null;
  retainedDishIds: readonly string[];
  excludedDishIds: readonly string[];
  sourceSafetyFingerprint: string;
  sourcePreferenceSnapshot: Readonly<Record<string, unknown>>;
  existingDerivationMenus: readonly {
    menuId: string;
    menuSignature: string;
    dishSignatures: readonly string[];
  }[];
  /** Plan 4 所有の prompt/materialization データ。スキーマガードなしでは信頼しない。 */
  artifacts: unknown;
};

/**
 * オーケストレーション所有の実行コンテキスト。
 * Plan 4 はここから import し、同名型を再宣言してはならない。
 * new_menu のみ recentDishHints（prompt 専用・fingerprint 非介入）を載せる。
 */
export type GenerationExecutionContext =
  | (ExecutionBase & {
      kind: "new_menu";
      command: Extract<GenerationCommand, { kind: "new_menu" }>;
      regeneration: null;
      /** soft diversity 用。空配列可。fingerprint / quota に含めない */
      recentDishHints: readonly RecentDishHint[];
    })
  | (ExecutionBase & {
      kind: "regenerate_menu";
      command: Extract<GenerationCommand, { kind: "regenerate_menu" }>;
      regeneration: RegenerationExecutionPayload & { replaceDishId: null };
    })
  | (ExecutionBase & {
      kind: "regenerate_dish";
      command: Extract<GenerationCommand, { kind: "regenerate_dish" }>;
      regeneration: RegenerationExecutionPayload & { replaceDishId: string };
    });

export type GenerationDependencies = {
  user: AuthenticatedUserWithEmail;
  repository: Omit<GenerationRepository, "userClient">;
  models: readonly string[];
  /** repository miss時の権威integrity解決。productionはadmin読取、benchmarkは固定非PII値。 */
  resolveIntegrityContext?: (command: GenerationCommand) => Promise<GenerationIntegrityContextV2>;
  loadExecutionContext(
    command: GenerationCommand,
    requestId: string,
    deadlineAtMonotonicMs: number,
  ): Promise<GenerationExecutionContext>;
  /**
   * HR3: 再生成 succeed 直前に derivation exclusion を再読する。
   * load 時 snapshot と AI 往復のあいだに並行 finalize された sibling を取り込む。
   * 未指定時は execution 上の snapshot のみで再判定（unit の差し替え用）。
   */
  reloadRegenerationExclusion?(
    execution: Extract<GenerationExecutionContext, { kind: "regenerate_menu" | "regenerate_dish" }>,
  ): Promise<RegenerationExecutionPayload["existingDerivationMenus"]>;
  validatePreflight(context: GenerationContext, now: Date): GenerationPreflightResult;
  buildMessages(context: GenerationExecutionContext): readonly OpenRouterMessage[];
  callOpenRouter(
    input: Parameters<typeof sendMenuGeneration>[0],
  ): Promise<OpenRouterGenerationResult>;
  /**
   * G4: markSent 前の Models 政策ゲート。未指定時は env から ensureOpenRouterRuntimeModelPolicy。
   * mock base は remote skip。失敗は model_unavailable で attempt を焼かない。
   */
  ensureOpenRouterModelPolicy?: (input: { models: readonly string[] }) => Promise<void>;
  now(): Date;
  /** 単調時計。認証・予約も同じ 55s 総予算を消費する */
  monotonicNow(): number;
  openRouterTimeoutMs: number;
  requestStartedAtMonotonicMs: number;
  functionTotalBudgetMs: number;
  uuid(): string;
  /**
   * 終端ログ（成功・閉じた失敗）。未指定時は logGenerationEvent。
   * テストはこれを差し替えて呼び出しを検証する。
   */
  logTerminalEvent?: typeof logGenerationEvent;
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

/**
 * 失敗コードごとの retryable フラグ。message 本文は issueMessages が正本。
 * true/false は従来 failureCopy と同一（変えない）。
 */
const failureRetryable: Record<GenerationFailureCode, boolean> = {
  consent_required: false,
  draft_not_found: false,
  invalid_request: false,
  generation_in_progress: true,
  user_daily_limit: false,
  user_attempt_limit: false,
  user_short_window_limit: false,
  global_daily_limit: false,
  allergy_unconfirmed: false,
  allergen_missing: false,
  unmapped_custom_allergy: false,
  unsupported_diet_unconfirmed: false,
  regeneration_not_implemented: false,
  unsupported_diet: false,
  allergy_conflict: false,
  expired_pantry_unconfirmed: false,
  model_unavailable: true,
  invalid_ai_response: true,
  generation_timeout: true,
  internal_error: true,
  // Plan 4 再生成契約の閉じた失敗コード
  duplicate_output: true,
  idempotency_payload_mismatch: false,
  current_safety_revalidation_required: false,
  current_target_member_required: false,
  source_menu_not_found: false,
  replace_dish_not_found: false,
  source_menu_changed: false,
  quality_mode_requires_plus: false,
  quality_daily_limit: false,
  quality_monthly_limit: false,
  flyer_requires_plus: false,
  flyer_weekly_limit: false,
  flyer_weekly_try_limit: false,
  flyer_invalid_image: false,
  flyer_unsupported_media: false,
  flyer_invalid_ai_response: true,
};

/** テストとサービス本体の正。message は必ず issueMessages 参照。 */
export function getGenerationFailureCopy(code: GenerationFailureCode): {
  message: string;
  retryable: boolean;
} {
  return {
    message: issueMessages[code],
    retryable: failureRetryable[code],
  };
}

function closedFailureCode(error: unknown): GenerationFailureCode {
  if (!(error instanceof HttpError)) return "internal_error";
  const parsed = generationFailureCodeSchema.safeParse(error.code);
  return parsed.success ? parsed.data : "internal_error";
}

/** finalize の fingerprint 不一致（raise 経路）を conflict 終端へ落とす判定 */
function isCurrentSafetyChangedError(error: unknown): boolean {
  return error instanceof HttpError && error.code === "current_safety_changed";
}

function currentSafetyChangedConflict(): z.infer<typeof generationConflictSchema> {
  return {
    code: "current_safety_changed",
    message: generationConflictCopy.current_safety_changed,
    conditionRefs: [],
  };
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

/** generation_in_progress 合成失敗用。他行 request_id をクライアントへ載せない（G13）。 */
const SYNTHETIC_IN_PROGRESS_REQUEST_ID = "00000000-0000-4000-8000-000000000098";

export function toGenerationStatus(
  record: QuotaRequestRecord,
  idempotencyKey: string,
): GenerationStatusData {
  const quota = {
    consumed: record.consumed ?? record.status === "succeeded",
    remaining: record.remaining ?? 0,
    // RPC 契約上必須。欠落時の Free 3 既定は Plus を誤表示するため置かない（S11）
    userDailyLimit: record.user_daily_limit,
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
    error: { code, ...getGenerationFailureCopy(code) },
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

/**
 * Plan 3 の new_menu ファクトリ本体。byte-for-byte 互換を保つ。
 * 再生成スタブは createGenerationDeps ラッパーが置き換える。
 */
function createBaseGenerationDeps(
  user: AuthenticatedUserWithEmail,
  timing: { requestStartedAtMonotonicMs: number },
): GenerationDependencies {
  const env = getServerEnv();
  return {
    user,
    repository: createGenerationRepository(user),
    models: env.openRouter.models,
    resolveIntegrityContext: (command) =>
      resolveGenerationIntegrityContext(getSupabaseAdmin(), user.userId, command),
    loadExecutionContext: async (command, requestId, deadlineAtMonotonicMs) => {
      if (command.kind !== "new_menu") {
        throw new HttpError(
          422,
          "regeneration_not_implemented",
          "再生成は次の計画で有効になります。",
        );
      }
      // L13: flag off 時は load 自体を呼ばない（内部 early-return に頼らない）
      // `true as const` を直接三項に置くと lint が死枝扱いするため boolean 引数経由で読む
      const diversityEnabled = isDiversityHintsEnabled(DIVERSITY_HINTS_ENABLED);
      const ownerClient = createUserScopedSupabase(user.accessToken);
      const hintsPromise = diversityEnabled
        ? loadRecentDishHints({ ownerClient, userId: user.userId })
        : Promise.resolve([] as const);
      const [generationContext, recentDishHints] = await Promise.all([
        loadGenerationContext(user, requestId, command.request),
        hintsPromise,
      ]);
      return {
        kind: "new_menu",
        command,
        requestId,
        generationContext,
        recentDishHints,
        expectedSafetyFingerprint:
          generationContext.targetMode === "idea"
            ? createIdeaSafetyFingerprint()
            : createCurrentSafetyFingerprint(generationContext.safety),
        startedAtMonotonicMs: timing.requestStartedAtMonotonicMs,
        deadlineAtMonotonicMs,
        regeneration: null,
      };
    },
    validatePreflight: validateGenerationPreflight,
    buildMessages: buildGenerationMessages,
    callOpenRouter: sendMenuGeneration,
    // G4: markSent 前に process 寿命 Models 政策を強制（openrouter 内にも cache 付き二重化）
    ensureOpenRouterModelPolicy: async ({ models }) => {
      const env = getServerEnv();
      await ensureOpenRouterRuntimeModelPolicy({
        baseUrl: env.openRouter.baseUrl,
        models,
        apiKey: env.openRouter.apiKey,
      });
    },
    now: () => new Date(),
    monotonicNow: () => performance.now(),
    openRouterTimeoutMs: env.openRouter.timeoutMs,
    requestStartedAtMonotonicMs: timing.requestStartedAtMonotonicMs,
    functionTotalBudgetMs: env.openRouter.functionTotalBudgetMs,
    uuid: randomUUID,
  };
}

/** handler 入口で渡す生成依存の timing と、ローカル mock 限定のシナリオ */
export type GenerationDepsOptions = {
  requestStartedAtMonotonicMs: number;
  /**
   * Compose openrouter-mock 専用。sendMenuGeneration が OPENROUTER_MOCK_SCENARIO を読むため、
   * リクエスト単位で環境変数へ橋渡しする（本番 base URL では handler が設定しない）。
   */
  localTestScenario?: string;
};

/**
 * 公開ファクトリ。new_menu は base のまま、再生成だけ loadRegenerationExecutionContext へ分岐する。
 */
export function createGenerationDeps(
  user: AuthenticatedUserWithEmail,
  timing: GenerationDepsOptions,
): GenerationDependencies {
  const base = createBaseGenerationDeps(user, timing);
  const localTestScenario = timing.localTestScenario;
  // 並行リクエストで process.env を奪い合わないよう、ALS でリクエスト単位にシナリオを渡す
  const callOpenRouter: GenerationDependencies["callOpenRouter"] =
    localTestScenario === undefined
      ? sendMenuGeneration
      : async (input) =>
          runWithOpenRouterMockScenario(localTestScenario, () => sendMenuGeneration(input));
  return {
    ...base,
    callOpenRouter,
    loadExecutionContext: async (command, requestId, deadlineAtMonotonicMs) => {
      if (command.kind === "new_menu") {
        return base.loadExecutionContext(command, requestId, deadlineAtMonotonicMs);
      }
      return loadRegenerationExecutionContext(
        createRegenerationLoaderDeps(user, {
          requestStartedAtMonotonicMs: timing.requestStartedAtMonotonicMs,
        }),
        user,
        command,
        requestId,
        deadlineAtMonotonicMs,
      );
    },
    // HR3: createGenerationDeps 経由の再生成だけ finalize 直前に exclusion を再読する
    reloadRegenerationExclusion: async (execution) => {
      const loader = createRegenerationLoaderDeps(user, {
        requestStartedAtMonotonicMs: timing.requestStartedAtMonotonicMs,
      });
      return reloadExistingDerivationMenus(
        loader,
        user,
        execution.regeneration.derivationGroupId,
        execution.regeneration.sourceMenu,
      );
    },
  };
}

type CheckedOutput =
  | { kind: "valid"; checked: Extract<MenuValidationResult, { ok: true }> }
  | { kind: "conflict"; conflicts: readonly z.infer<typeof generationConflictSchema>[] }
  | {
      kind: "invalid";
      issues: readonly { code: string; path?: string; message?: string }[];
      /** 重複は repair 後も残れば duplicate_output で fail（成功消費なし） */
      duplicate?: boolean;
    };

/**
 * OpenRouter 結果を完全候補へ合成し、validateGeneratedMenu まで通す。
 * 再生成の duplicate は valid 後にシグネチャで判定する。
 */
function composeCandidate(
  result: OpenRouterGenerationResult,
  execution: GenerationExecutionContext,
  uuid: () => string,
): CheckedOutput {
  const context = execution.generationContext;

  if (result.mode === "replacement_dish") {
    if (execution.kind !== "regenerate_dish") {
      return { kind: "invalid", issues: [{ code: "invalid_provider_menu" }] };
    }
    try {
      // 保持料理の過去英語 description / 保証文を落とさない。今回の AI 出力だけ見る。
      const aiTextIssues = [
        ...collectNonJapaneseUserTextIssuesFromDishRegenAiOutput(result.output),
        ...collectGuaranteePhraseIssuesFromDishRegenAiOutput(result.output),
      ];
      if (aiTextIssues.length > 0) {
        return { kind: "invalid", issues: aiTextIssues };
      }
      const candidate = materializeDishRegenerationCandidate(execution, result.output, uuid);
      const checked = validateGeneratedMenu(candidate, context, {
        checkJapaneseUserText: false,
      });
      if (!checked.ok) return { kind: "invalid", issues: checked.issues };
      if (isRegenerationDuplicate(checked.menu, execution)) {
        return {
          kind: "invalid",
          issues: [{ code: "duplicate_output" }],
          duplicate: true,
        };
      }
      return { kind: "valid", checked };
    } catch (error) {
      if (error instanceof GenerationOutputError) {
        return { kind: "invalid", issues: error.issues };
      }
      return { kind: "invalid", issues: [{ code: "invalid_provider_menu" }] };
    }
  }

  // チラシ週間は別 Function。生成 compose 経路では受理しない
  if (result.mode === "flyer_weekly") {
    return { kind: "invalid", issues: [{ code: "invalid_provider_menu" }] };
  }

  // full_menu: new_menu と regenerate_menu
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
    if (!checked.ok) return { kind: "invalid", issues: checked.issues };
    if (execution.kind !== "new_menu" && isRegenerationDuplicate(checked.menu, execution)) {
      return {
        kind: "invalid",
        issues: [{ code: "duplicate_output" }],
        duplicate: true,
      };
    }
    return { kind: "valid", checked };
  } catch (error) {
    if (!(error instanceof GenerationOutputError)) throw error;
    return { kind: "invalid", issues: error.issues };
  }
}

function lineageFields(execution: GenerationExecutionContext): {
  sourceMenuId: string | null;
  changeReason: string | null;
  changeReasonCustom: string | null;
} {
  if (execution.kind === "new_menu") {
    return { sourceMenuId: null, changeReason: null, changeReasonCustom: null };
  }
  return {
    sourceMenuId: execution.regeneration.sourceMenuId,
    changeReason: execution.command.request.changeReason,
    changeReasonCustom: execution.command.request.changeReasonCustom,
  };
}

/**
 * succeed 入力を mode 判別可能 union として組み立てる。
 * idea では version 文字列や家族対象をサム値で埋めない。
 */
function buildSuccessInput(
  requestId: string,
  menu: ValidatedMenu,
  context: GenerationContext,
  execution: GenerationExecutionContext,
) {
  const lineage = lineageFields(execution);
  // HIST-1: SQL lock は p_target_members 配列順の ordinality で member_1..N を採番する。
  // 再生成 context の履歴 ref をそのまま hash すると survivor だけでも current_safety_changed になる。
  const householdTargetIds = context.targetMembers.map((member) => member.householdMemberId);
  const base = {
    requestId,
    menu,
    preferenceSnapshot: context.preferenceSnapshot,
    safetyFingerprint:
      context.targetMode === "idea"
        ? createIdeaSafetyFingerprint()
        : createFinalizeSafetyFingerprint(context.safety, householdTargetIds),
    expiredChecks: [...context.expiredPantryChecks],
    ...lineage,
  };
  if (context.targetMode === "idea") {
    return {
      ...base,
      targetMode: "idea" as const,
      safetySnapshot: ideaSafetySnapshot,
      allergenVersion: null,
      foodRuleVersion: null,
      targetMembers: [] as const,
    };
  }
  return {
    ...base,
    targetMode: "household" as const,
    safetySnapshot: context.safetySnapshot,
    allergenVersion: context.allergenVersion,
    foodRuleVersion: context.foodRuleVersion,
    targetMembers: [...context.targetMembers],
  };
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
  inputDeps: GenerationDependencies,
  command: GenerationCommand,
): Promise<GenerationStatusData> {
  const key = command.request.idempotencyKey;
  // 品質モードは Plus リストのみ（repair も command.qualityMode / スナップショット継承）。
  // 送信 body も createOpenRouterGenerationSender で同じリストに閉じ込める（flyer と同型）。
  // sendMenuGeneration 既定は OPENROUTER_MODELS のため、deps.models 差し替えだけでは足りない。
  const envForModels = getServerEnv();
  const models = command.qualityMode ? envForModels.openRouter.plusModels : inputDeps.models;
  const callOpenRouter: GenerationDependencies["callOpenRouter"] = command.qualityMode
    ? createOpenRouterGenerationSender({
        apiKey: envForModels.openRouter.apiKey,
        baseUrl: envForModels.openRouter.baseUrl,
        models: envForModels.openRouter.plusModels,
        timeoutMs: envForModels.openRouter.timeoutMs,
      })
    : (input) => inputDeps.callOpenRouter(input);
  const deps: GenerationDependencies = {
    ...inputDeps,
    models,
    callOpenRouter,
  };
  // 品質リスト空の 503 は Plus 利用者だけ（Free / kill は repository の 403 quality_mode_requires_plus を先に返す）
  // 空チェック自体は reserveNew 後・OpenRouter 直前で行い、Free 経路で 503 が CTA を潰さないようにする。
  const resolveIntegrity =
    deps.resolveIntegrityContext ??
    ((input: GenerationCommand) =>
      resolveGenerationIntegrityContext(getSupabaseAdmin(), deps.user.userId, input));
  // ledger-first: hit は保存済み integrity だけで replay し、live draft/menu を読まない
  const lookup = await deps.repository.lookup(key);
  const reserved =
    lookup.kind === "hit"
      ? await deps.repository.replayExisting(command, lookup)
      : await deps.repository.reserveNew(command, await resolveIntegrity(command));
  const hydrate = async () => {
    try {
      return toGenerationStatus(await deps.repository.status(key), key);
    } catch (error) {
      throw new StatusHydrationError(error);
    }
  };
  if (reserved.status !== "processing" || reserved.replayed === true) {
    // G1 residual-intentional: processing 中の同一 key 再 POST は replay のみで
    // load/OpenRouter を再開しない。孤児は AI_PROCESSING_STALE_SECONDS=180 まで占有
    //（アプリ 55s / platform 60s より長いのはロック残差。stale 値は緩めない）。
    // generation_in_progress は台帳行を増やさない合成 failed。status(key) は
    // not_started になるため、reserve payload を GenerationStatusData へ写す。
    // 他 active 行の request_id は運用相関の誤認源なので sentinel に置換する（G6/G13）。
    if (reserved.status === "failed" && reserved.failure_code === "generation_in_progress") {
      return toGenerationStatus({ ...reserved, request_id: SYNTHETIC_IN_PROGRESS_REQUEST_ID }, key);
    }
    try {
      return await hydrate();
    } catch (error) {
      if (error instanceof StatusHydrationError) throw error.cause;
      throw error;
    }
  }
  const requestId = reserved.request_id;
  if (requestId === undefined) throw new Error("request_id_missing");
  // Plus 経路で品質リストが空 = 設定ミス。Free は reserve 前に 403 済み。
  // markSent 前に fail して try/台帳を対称解放する。
  if (command.qualityMode && deps.models.length === 0) {
    try {
      await deps.repository.fail(requestId, "model_unavailable", null);
      return await hydrate();
    } catch (error) {
      throw new TerminalTransitionError(unwrapStatusHydration(error));
    }
  }
  // 実際に OpenRouter へ送ったモデルだけを任意で載せる（未送信終端では省略）
  let loggedModelId: string | null = null;
  const emitTerminalLog = (level: "info" | "warn" | "error", code: string): void => {
    const durationMs = Math.max(
      0,
      Math.trunc(deps.monotonicNow() - deps.requestStartedAtMonotonicMs),
    );
    const log = deps.logTerminalEvent ?? logGenerationEvent;
    log(level, {
      requestId,
      errorCode: code,
      durationMs,
      modelId: loggedModelId,
    });
  };
  const fail = async (code: GenerationFailureCode, retryAt: string | null) => {
    try {
      await deps.repository.fail(requestId, code, retryAt);
      const status = await hydrate();
      emitTerminalLog("error", code);
      return status;
    } catch (error) {
      throw new TerminalTransitionError(unwrapStatusHydration(error));
    }
  };
  const conflict = async (conflicts: readonly z.infer<typeof generationConflictSchema>[]) => {
    await deps.repository.conflict(requestId, [...conflicts]);
    const status = await hydrate();
    emitTerminalLog("warn", "constraint_conflict");
    return status;
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
  // A-I9: provider 返却後も総予算を守り、残 deadline が尽きたら succeed しない。
  const abortIfDeadlineExceeded = async (): Promise<GenerationStatusData | null> => {
    if (remainingMs() > 0) return null;
    return await fail("generation_timeout", null);
  };

  // succeed は SQL が constraint_conflict を返す正規経路と、raise を 409 に写した防御経路の両方を扱う。
  // A-I9 / I1: 入口ゲートに加え、残 deadline を repository.succeed へ渡し
  // SET LOCAL statement_timeout で finalize 自体を中断する（背景継続させない）。
  const succeedOrConflict = async (
    input: Parameters<GenerationRepository["succeed"]>[0],
  ): Promise<GenerationStatusData> => {
    const timedOut = await abortIfDeadlineExceeded();
    if (timedOut !== null) return timedOut;
    try {
      await deps.repository.succeed(input, { remainingMs: remainingMs() });
      const status = await hydrate();
      // A-I8: SQL 正規の constraint_conflict / failed を常に succeeded とログしない。
      // hydrate 後の status を ops ログの errorCode にする。
      if (status.status === "succeeded") {
        emitTerminalLog("info", "succeeded");
        // 共有化 job: 成功かつ completed_menu_id hydrate 後のみ。
        // conflict/timeout/failed では呼ばない。enqueue 失敗は握りつぶし（生成成功を壊さない）。
        // OpenRouter / Pass pipeline はここから import しない（share-enqueue 内 eligibility + RPC のみ）。
        try {
          await maybeEnqueueShareJob({
            menuId: status.menuId,
            menu: input.menu,
            admin: getSupabaseAdmin(),
          });
        } catch {
          // maybeEnqueueShareJob は never throws 契約だが、生成成功を二重に守る
        }
      } else if (status.status === "constraint_conflict") {
        emitTerminalLog("warn", "constraint_conflict");
      } else if (status.status === "failed") {
        emitTerminalLog("error", status.error.code);
      }
      return status;
    } catch (error) {
      // finalizer 中の statement_timeout / cancel → 成功扱いにせず generation_timeout
      if (error instanceof GenerationFinalizeTimeoutError) {
        return await fail("generation_timeout", null);
      }
      if (isCurrentSafetyChangedError(error)) {
        return await conflict([currentSafetyChangedConflict()]);
      }
      throw error;
    }
  };

  try {
    const execution = await deps.loadExecutionContext(command, requestId, deadlineAtMonotonicMs);
    const context = execution.generationContext;
    /**
     * HR3: compose は load 時 exclusion snapshot で早期弾き。succeed 直前に再読し、
     * AI 往復中に並行 finalize された sibling との material 衝突を duplicate_output にする。
     * reload 未配線（unit makeDeps）時は snapshot のみで再判定し、本番 createGenerationDeps は再読する。
     * reload〜commit の極小窓は assign_regeneration_lineage が material を見ない技術残差。
     */
    const failIfDuplicateAtFinalize = async (
      menu: ValidatedMenu,
    ): Promise<GenerationStatusData | null> => {
      if (execution.kind === "new_menu") return null;
      const regenExecution: Extract<
        GenerationExecutionContext,
        { kind: "regenerate_menu" | "regenerate_dish" }
      > = execution;
      const freshMenus =
        deps.reloadRegenerationExclusion !== undefined
          ? await deps.reloadRegenerationExclusion(regenExecution)
          : regenExecution.regeneration.existingDerivationMenus;
      // kind は維持したまま exclusion だけ差し替え（spread で discriminant が崩れないよう再構築）
      const rechecked: Extract<
        GenerationExecutionContext,
        { kind: "regenerate_menu" | "regenerate_dish" }
      > =
        regenExecution.kind === "regenerate_menu"
          ? {
              ...regenExecution,
              regeneration: {
                ...regenExecution.regeneration,
                existingDerivationMenus: freshMenus,
              },
            }
          : {
              ...regenExecution,
              regeneration: {
                ...regenExecution.regeneration,
                existingDerivationMenus: freshMenus,
              },
            };
      if (isRegenerationDuplicate(menu, rechecked)) {
        return await fail("duplicate_output", null);
      }
      return null;
    };
    const preflight = deps.validatePreflight(context, deps.now());
    if (!preflight.ok) {
      if (preflight.terminal === "constraint_conflict") {
        return await conflict(preflight.conflicts);
      }
      const code = generationFailureCodeSchema.safeParse(preflight.primaryCode);
      return await fail(code.success ? code.data : "internal_error", null);
    }

    // idea 再生成は年齢適合を意味する child_friendly を外部送信前に拒否する。
    // context.targetMode は request snapshot 権威（loadRegenerationExecutionContext の
    // live mode 照合・preference 一致検査の後）が buildCurrentContext で確定した値。
    // UI でも非表示だが、直接 API 呼び出しに対するサーバー境界として必須。
    if (
      (execution.kind === "regenerate_menu" || execution.kind === "regenerate_dish") &&
      context.targetMode === "idea" &&
      execution.command.request.changeReason === "child_friendly"
    ) {
      return await fail("invalid_request", null);
    }

    const originalMessages = deps.buildMessages(execution);
    const wireMode = execution.kind === "regenerate_dish" ? "replacement_dish" : "full_menu";

    // markSent 直前の pre-send ゲート。不足時は HTTP を一度も送らず timeout へ
    if (remainingMs() < REQUIRED_SEND_BUDGET_MS) {
      await deps.repository.failBeforeSend(requestId, "generation_timeout");
      const status = await hydrate();
      emitTerminalLog("error", "generation_timeout");
      return status;
    }

    // G4: markSent 前の Models 政策。deps 未指定時は env 経由の ensure を使う。
    const ensureModelPolicy =
      deps.ensureOpenRouterModelPolicy ??
      (async ({ models }: { models: readonly string[] }) => {
        const env = getServerEnv();
        await ensureOpenRouterRuntimeModelPolicy({
          baseUrl: env.openRouter.baseUrl,
          models,
          apiKey: env.openRouter.apiKey,
        });
      });

    const call = async (
      excludedModelIds: readonly string[] = [],
      messages: readonly OpenRouterMessage[] = originalMessages,
    ): Promise<OpenRouterGenerationResult | "terminal"> => {
      // 1 回目・repair の 2 回目を含め、毎回 markSent 直前に 24s+2s を再確認する。
      // canRepair/外側ゲート通過後に時間が進んでも、部分 timeout で markSent しない。
      if (remainingMs() < REQUIRED_SEND_BUDGET_MS) {
        await deps.repository.failBeforeSend(requestId, "generation_timeout");
        return "terminal";
      }
      // G4 residual: attempt を焼く markSent より前に政策失敗を閉じる。
      // process 寿命 cache により 2 回目以降（repair）は remote を叩かない。
      // R2: ensure は Models API 最大 5s を食うことがあるため、成功後に REQUIRED_SEND を
      // 再ゲートする。G5: chat 上限（attemptTimeout）は markSent 後に再 snapshot する
      // （RPC 遅延で finalize 2s 予約を侵食した過大 timeout を避ける）。
      try {
        await ensureModelPolicy({ models: deps.models });
      } catch (error) {
        if (error instanceof OpenRouterCallError && error.code === "model_unavailable") {
          await deps.repository.failBeforeSend(requestId, "model_unavailable");
          return "terminal";
        }
        throw error;
      }
      if (remainingMs() < REQUIRED_SEND_BUDGET_MS) {
        await deps.repository.failBeforeSend(requestId, "generation_timeout");
        return "terminal";
      }
      // markSent 前ゲート: 予算不足なら attempt を焼かず timeout 終端
      if (timeoutForAttempt() <= 0) {
        await deps.repository.failBeforeSend(requestId, "generation_timeout");
        return "terminal";
      }
      const sent = await deps.repository.markSent(requestId);
      // 短期窓拒否は markSent 内で failed 終端化済み。再 fail せず status を読む。
      if (!sent.sent) {
        return "terminal";
      }
      // G2 residual-intentional: markSent 後に chat 予算が尽きたら OpenRouter 未呼出でも
      // fail（attempt 非返却）。送信予約＝消費の契約。枠返却はしない。
      // G5 経路: markSent RPC 所要後に chat 上限を再 snapshot。
      const attemptTimeout = timeoutForAttempt();
      if (attemptTimeout <= 0) {
        // markSent 済みなので failBeforeSend 名義ではなく通常 fail（attempt は解放しない）
        await deps.repository.fail(requestId, "generation_timeout", null);
        return "terminal";
      }
      let result: OpenRouterGenerationResult;
      try {
        result = await deps.callOpenRouter({
          messages,
          timeoutMs: attemptTimeout,
          excludedModelIds,
          mode: wireMode,
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
      loggedModelId = result.modelId;
      return result;
    };

    let firstResult: OpenRouterGenerationResult | null = null;
    let firstIssues: readonly { code: string; path?: string; message?: string }[] | null = null;
    let firstModelId: string | null = null;
    let firstWasDuplicate = false;
    try {
      const firstCall = await call();
      if (firstCall === "terminal") {
        // markSent 拒否や pre-send timeout は台帳側で終端済み。status を読みつつ閉じた失敗をログする。
        const status = await hydrate();
        if (status.status === "failed") {
          emitTerminalLog("error", status.error.code);
        }
        return status;
      }
      firstResult = firstCall;
      firstModelId = firstResult.modelId;
    } catch (error) {
      if (!(error instanceof OpenRouterCallError)) throw error;
      const code = generationFailureCodeSchema.safeParse(error.code);
      if (!code.success) return await fail("internal_error", null);
      // timeout は修理しない
      // G3 residual-intentional: markSent 後の model_unavailable（非200/輸送）は repair せず
      // attempt 非返却のまま fail。retryable 表示でも枠は戻さない（送信予約契約）。
      if (code.data === "generation_timeout") return await fail(code.data, error.retryAt);
      if (code.data !== "invalid_ai_response") return await fail(code.data, error.retryAt);
      firstModelId =
        error.modelId !== null && deps.models.includes(error.modelId) ? error.modelId : null;
      if (firstModelId !== null) loggedModelId = firstModelId;
      firstIssues = [{ code: "invalid_provider_menu" }];
    }

    if (firstResult !== null) {
      const output = composeCandidate(firstResult, execution, () => deps.uuid());
      if (output.kind === "conflict") return await conflict(output.conflicts);
      if (output.kind === "valid") {
        const timedOut = await abortIfDeadlineExceeded();
        if (timedOut !== null) return timedOut;
        const duplicateAtFinalize = await failIfDuplicateAtFinalize(output.checked.menu);
        if (duplicateAtFinalize !== null) return duplicateAtFinalize;
        return await succeedOrConflict(
          buildSuccessInput(requestId, output.checked.menu, context, execution),
        );
      }
      firstIssues = output.issues;
      firstWasDuplicate = output.duplicate === true;
    }

    // repair は canRepair（24s+2s 残）のときだけ。timeout 経路はここへ来ない
    // 重複も 1 回だけ repair を通し、再重複なら duplicate_output（成功消費なし）
    // G5 residual-intentional: repair は 2 本目 markSent（attempt 二重消費）。invalid 連発で
    // Free attempt 枠が success に届かない相互作用は仕様どおりの溶融残差。枠返却しない。
    if (!canRepair()) {
      return await fail(firstWasDuplicate ? "duplicate_output" : "invalid_ai_response", null);
    }
    // 許可リストが2本以上のときだけ失敗モデルを exclude。
    // G11 residual-intentional: 1本構成では exclude すると候補0になり repair 不能になるため、
    // 同モデル再送を許す（運用 1 本時は invalid 再発で attempt だけ減りやすい）。
    const excludedModelIds = deps.models.length <= 1 || firstModelId === null ? [] : [firstModelId];
    const eligibleModels = deps.models.filter((model) => !excludedModelIds.includes(model));
    if (eligibleModels.length === 0) {
      return await fail(firstWasDuplicate ? "duplicate_output" : "invalid_ai_response", null);
    }
    const repair = await deps.repository.reserveRepair(requestId);
    if (!repair.reserved) {
      return await fail(
        firstWasDuplicate ? "duplicate_output" : "invalid_ai_response",
        repair.retry_at,
      );
    }
    const diagnostics: readonly GenerationRepairDiagnostic[] = toRepairDiagnostics(
      firstIssues ?? [{ code: "invalid_provider_menu" }],
    );
    // 取り分け mismatch 時は soften/cut_small/remove_bones の kind 必須を明示（closed code のみ＋固定ヒント）
    const preferenceRepairHint = diagnostics.some(
      (item) => item.code === "member_preference_mismatch",
    )
      ? " eatingEase soft→safetyActions.kind=soften、small_pieces→cut_small、boneless→remove_bones を当該memberのadaptationに必ず含める。"
      : "";
    let repaired: OpenRouterGenerationResult;
    try {
      const repairedCall = await call(excludedModelIds, [
        ...originalMessages,
        {
          role: "user",
          content: `前の結果を次の項目だけ修正し、全体JSONを一度だけ再生成してください: ${JSON.stringify(diagnostics)}${preferenceRepairHint}`,
        },
      ]);
      if (repairedCall === "terminal") {
        const status = await hydrate();
        if (status.status === "failed") {
          emitTerminalLog("error", status.error.code);
        }
        return status;
      }
      repaired = repairedCall;
    } catch (error) {
      if (!(error instanceof OpenRouterCallError)) throw error;
      const code = generationFailureCodeSchema.safeParse(error.code);
      return await fail(code.success ? code.data : "internal_error", error.retryAt);
    }
    const repairedOutput = composeCandidate(repaired, execution, () => deps.uuid());
    if (repairedOutput.kind === "conflict") return await conflict(repairedOutput.conflicts);
    if (repairedOutput.kind === "invalid") {
      return await fail(
        repairedOutput.duplicate === true || firstWasDuplicate
          ? "duplicate_output"
          : "invalid_ai_response",
        null,
      );
    }
    const repairedTimedOut = await abortIfDeadlineExceeded();
    if (repairedTimedOut !== null) return repairedTimedOut;
    const repairedDuplicateAtFinalize = await failIfDuplicateAtFinalize(
      repairedOutput.checked.menu,
    );
    if (repairedDuplicateAtFinalize !== null) return repairedDuplicateAtFinalize;
    return await succeedOrConflict(
      buildSuccessInput(requestId, repairedOutput.checked.menu, context, execution),
    );
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
