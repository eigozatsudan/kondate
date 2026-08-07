import { z } from "zod";
import {
  generationConflictCopy,
  generationConflictSchema,
  generationCommandVersionV3,
  issueMessages,
  type GenerationCommandV3,
  type GenerationIntegrityContextV3,
  type GenerationRequestLookup,
  type ValidatedMenu,
} from "../../../shared/contracts/generation.js";
import type { GenerationTargetMember } from "../../../shared/safety/generation-context.js";
import { ideaSafetySnapshot } from "../../../shared/safety/idea-fingerprint.js";
import type { Database } from "../../../src/shared/types/database.js";
import {
  applyQuotaPlan,
  BillingEntitlementUnavailableError,
  limitsForPlan,
  loadEntitlement,
} from "./billing-entitlement.js";
import { getServerEnv } from "./env.js";
import {
  generationRequestHmac,
  generationRequestHmacVersion,
} from "./generation-command-integrity.js";
import {
  parseIntegrityContextPayload,
  toIntegrityContextPayload,
} from "./generation-integrity-context.js";
import { HttpError } from "./http.js";
import { computeQuotaIdentityKey } from "./quota-identity.js";
import { getSupabaseAdmin } from "./supabase-admin.js";
import { createUserScopedSupabase, type UserSupabaseClient } from "./supabase-user.js";

export type GenerationSuccessBase = {
  requestId: string;
  menu: ValidatedMenu;
  preferenceSnapshot: Readonly<Record<string, unknown>>;
  safetyFingerprint: string;
  expiredChecks: readonly unknown[];
  sourceMenuId: string | null;
  changeReason: string | null;
  changeReasonCustom: string | null;
};

export type GenerationSuccessInput =
  | (GenerationSuccessBase & {
      targetMode: "household";
      safetySnapshot: Readonly<Record<string, unknown>>;
      allergenVersion: string;
      foodRuleVersion: string;
      targetMembers: readonly GenerationTargetMember[];
    })
  | (GenerationSuccessBase & {
      targetMode: "idea";
      safetySnapshot: typeof ideaSafetySnapshot;
      allergenVersion: null;
      foodRuleVersion: null;
      targetMembers: readonly [];
    });

/** succeed に渡す残 deadline（ms）。DB statement_timeout と入口ゲートの正本。 */
export type GenerationSucceedOptions = {
  remainingMs: number;
};

/**
 * finalize が statement_timeout / cancel で中断されたとき。
 * succeedOrConflict はこれを generation_timeout へ写し、成功保存として扱わない。
 */
export class GenerationFinalizeTimeoutError extends Error {
  readonly code = "generation_timeout" as const;
  constructor() {
    super("generation_timeout");
    this.name = "GenerationFinalizeTimeoutError";
  }
}

export type GenerationSuccessWriter = {
  succeed: (
    input: GenerationSuccessInput,
    options: GenerationSucceedOptions,
  ) => Promise<QuotaRequestRecord>;
};

// 型定義に使う const を実行時参照として保持し、tree-shake でも消えないようにする
export { ideaSafetySnapshot };

/** 認証済みユーザー（再生成・再検証など userId/token のみで足りる経路） */
export type AuthenticatedUser = {
  userId: string;
  accessToken: string;
};

/** identity 日次枠を使う生成経路（email 必須） */
export type AuthenticatedUserWithEmail = AuthenticatedUser & {
  email: string;
};

const requestPayloadSchema = z
  .object({
    request_id: z.uuid().optional(),
    idempotency_key: z.uuid(),
    status: z.enum(["not_started", "processing", "succeeded", "failed", "constraint_conflict"]),
    failure_code: z.string().nullable().optional(),
    retry_at: z.iso.datetime({ offset: true }).nullable().optional(),
    processing_expires_at: z.iso.datetime({ offset: true }).nullable().optional(),
    completed_menu_id: z.uuid().nullable().optional(),
    remaining: z.number().int().min(0).optional(),
    // Free 3 / Plus 10。RPC は常に p_user_limit を返すため必須（欠落時 Free 3 へ fail-open しない・S11）
    user_daily_limit: z.union([z.literal(3), z.literal(10)]),
    consumed: z.boolean().optional(),
    terminal_details: z.record(z.string(), z.unknown()).nullable().optional(),
    actual_model_ids: z.array(z.string()).optional(),
    started_at: z.iso.datetime({ offset: true }).optional(),
    completed_at: z.iso.datetime({ offset: true }).nullable().optional(),
    replayed: z.boolean().optional(),
  })
  .strip();
export type QuotaRequestRecord = z.infer<typeof requestPayloadSchema>;

const repairReservationSchema = z
  .object({
    reserved: z.boolean(),
    retry_at: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();
const jsonValueSchema = z.json();
const conflictPayloadSchema = z.array(generationConflictSchema).min(1).max(12);
type PublicFunctions = Database["public"]["Functions"];
type PublicFunctionName = keyof PublicFunctions;

type PostgrestLikeError = {
  code?: string | null;
  message?: string | null;
};

function isPostgrestLikeError(error: unknown): error is PostgrestLikeError {
  return typeof error === "object" && error !== null;
}

function isStatementTimeoutError(error: unknown): boolean {
  if (!isPostgrestLikeError(error)) return false;
  // Postgres query_canceled と wrapper の明示 raise、PostgREST 経由の文言ゆれを拾う
  if (error.code === "57014") return true;
  const message = error.message ?? "";
  return (
    message === "generation_timeout" ||
    message.includes("statement timeout") ||
    message.includes("canceling statement due to statement timeout")
  );
}

/**
 * SQL raise の exact message を閉じた HttpError に写す。
 * integrity 解決（TS）と同系の業務 code を POST 経路でも UX 可能な形で返す（G3）。
 * 未知 message は null（呼び出し側が quota_transition_failed）。
 *
 * G8: 設定ミス系（limit 範囲外 / HMAC / identity）と repair_not_available も
 * exact message で写し、一律の汎用 500 に潰さない。ユーザー向け文面は汎用のまま、
 * code だけ診断可能にする（クライアントは offline + pending 維持）。
 */
function mapClosedRpcFailure(error: PostgrestLikeError): HttpError | null {
  const message = error.message ?? "";
  const code = error.code ?? "";
  // 業務 raise は P0001 / P0002 / 22023。repair 拒否は 55000。
  if (code !== "P0001" && code !== "P0002" && code !== "22023" && code !== "55000") {
    return null;
  }
  if (message === "idempotency_payload_mismatch") {
    return new HttpError(
      409,
      "idempotency_payload_mismatch",
      "同じ操作番号で異なる内容は送信できません。最初からやり直してください。",
    );
  }
  // finalize の fingerprint 不一致が raise で返る旧経路向け。
  // 正規経路は SQL 側で constraint_conflict に原子遷移する。
  if (message === "current_safety_changed") {
    return new HttpError(
      409,
      "current_safety_changed",
      generationConflictCopy.current_safety_changed,
    );
  }
  // reserve 内 TOCTOU: integrity で見えた draft/menu が消えた・競合した
  if (message === "draft_unavailable") {
    return new HttpError(404, "draft_not_found", issueMessages.draft_not_found);
  }
  if (message === "draft_revision_conflict") {
    return new HttpError(422, "invalid_request", issueMessages.invalid_request);
  }
  if (message === "source_menu_not_found") {
    return new HttpError(404, "source_menu_not_found", issueMessages.source_menu_not_found);
  }
  if (message === "source_menu_changed") {
    return new HttpError(409, "source_menu_changed", issueMessages.source_menu_changed);
  }
  if (message === "replace_dish_not_found") {
    return new HttpError(404, "replace_dish_not_found", issueMessages.replace_dish_not_found);
  }
  // 運用・設定ミス向け診断 code（G8）。文言はユーザー向けに汎用のまま。
  if (
    message === "release_quota_mismatch" ||
    message === "invalid_request_hmac" ||
    message === "invalid_identity_key" ||
    message === "repair_not_available"
  ) {
    return new HttpError(500, message, "生成の受付状態を更新できませんでした。");
  }
  return null;
}

async function rpc<Name extends PublicFunctionName>(
  name: Name,
  parameters: PublicFunctions[Name]["Args"],
): Promise<unknown> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc(name, parameters);
    if (error !== null) throw error;
    return data;
  } catch (error: unknown) {
    // finalizer の statement_timeout / cancel。成功保存として確定させない。
    if (error instanceof GenerationFinalizeTimeoutError) throw error;
    if (isStatementTimeoutError(error)) {
      throw new GenerationFinalizeTimeoutError();
    }
    // reserve / finalize が raise する閉じた業務 code を 500 に潰さない（G3）。
    // message exact のみ信頼し、P0001/P0002/22023 以外の雑音は quota_transition_failed へ。
    if (isPostgrestLikeError(error)) {
      const closed = mapClosedRpcFailure(error);
      if (closed !== null) throw closed;
    }
    throw new HttpError(500, "quota_transition_failed", "生成の受付状態を更新できませんでした。");
  }
}

const lookupHitSchema = z
  .object({
    kind: z.literal("hit"),
    request_id: z.uuid(),
    request_hmac_version: z.literal(generationCommandVersionV3),
    integrity: z.unknown(),
  })
  .strict();
const lookupMissSchema = z.object({ kind: z.literal("miss") }).strict();

export type GenerationReservationRepository = {
  lookup: (idempotencyKey: string) => Promise<GenerationRequestLookup>;
  replayExisting: (
    command: GenerationCommandV3,
    lookup: Extract<GenerationRequestLookup, { kind: "hit" }>,
  ) => Promise<QuotaRequestRecord>;
  reserveNew: (
    command: GenerationCommandV3,
    integrity: GenerationIntegrityContextV3,
  ) => Promise<QuotaRequestRecord>;
};

function toEntitlementUnavailableHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  return new HttpError(
    503,
    "billing_entitlement_unavailable",
    "プラン情報を確認できませんでした。しばらくしてからお試しください。",
  );
}

export function createGenerationRepository(user: AuthenticatedUserWithEmail) {
  const env = getServerEnv();
  const userClient = createUserScopedSupabase(user.accessToken);
  // identity_key はサーバのみ計算。クライアント入力を信頼しない
  const identityKey = computeQuotaIdentityKey(env.quotaIdentityHmacKey, user.email);
  // ServerEnv.aiQuotaDisabled は parse 済み boolean（local かつ AI_QUOTA_DISABLED=true のみ true）
  const quotaDisabled = env.aiQuotaDisabled;

  /**
   * entitlement → applyQuotaPlan → planQuota のみで limits を決める。
   * env Free 固定や defense.max* を default にしない（A9）。
   */
  const resolvePlanLimits = async () => {
    try {
      const entitlement = await loadEntitlement(user.userId);
      const quotaPlan = applyQuotaPlan(entitlement, env.billingEnabled);
      return { limits: limitsForPlan(quotaPlan), quotaPlan };
    } catch (error: unknown) {
      if (error instanceof BillingEntitlementUnavailableError) {
        throw toEntitlementUnavailableHttpError(error);
      }
      throw toEntitlementUnavailableHttpError(error);
    }
  };

  /**
   * Free / !plus / kill で qualityMode:true は reserve 前 403。
   * quality 台帳に触らない（RPC を呼ばない）。
   */
  const assertQualityModeAllowed = (
    command: GenerationCommandV3,
    quotaPlan: "free" | "plus",
  ): void => {
    if (!command.qualityMode) return;
    if (quotaPlan !== "plus") {
      throw new HttpError(
        403,
        "quality_mode_requires_plus",
        issueMessages.quality_mode_requires_plus,
      );
    }
  };

  type ResolvedPlanLimits = Awaited<ReturnType<typeof resolvePlanLimits>>;

  /**
   * reserve 引数を構築する。
   * planLimits を渡した場合は entitlement を再読取しない（RR1: request 内 dual-read TOCTOU 防止）。
   */
  const buildReserveArgs = async (
    command: GenerationCommandV3,
    integrity: GenerationIntegrityContextV3,
    planLimits?: ResolvedPlanLimits,
  ) => {
    const { limits, quotaPlan } = planLimits ?? (await resolvePlanLimits());
    assertQualityModeAllowed(command, quotaPlan);
    // p_quality_mode は Plus かつ command.qualityMode のときのみ true
    const pQualityMode = command.qualityMode && quotaPlan === "plus";
    const hmac = generationRequestHmac(command, integrity, env.generationIntegrity.requestHmacKey);
    const isNewMenu = command.kind === "new_menu";
    return {
      p_user_id: user.userId,
      p_idempotency_key: command.request.idempotencyKey,
      p_request_kind: command.kind,
      p_draft_id: isNewMenu ? command.request.draftId : null,
      p_draft_revision: isNewMenu ? command.request.draftRevision : null,
      p_source_menu_id: isNewMenu ? null : command.request.sourceMenuId,
      p_replace_dish_id: command.kind === "regenerate_dish" ? command.request.dishId : null,
      p_change_reason: isNewMenu ? null : command.request.changeReason,
      p_request_hmac_version: generationRequestHmacVersion,
      p_request_hmac: hmac,
      p_integrity_context: toIntegrityContextPayload(integrity),
      p_identity_key: identityKey,
      p_user_limit: limits.successPerDay,
      p_attempt_limit: limits.attemptsPerDay,
      p_short_window_limit: limits.shortWindowLimit,
      p_global_limit: env.openRouter.globalDailyLimit,
      p_quota_disabled: quotaDisabled,
      p_quality_mode: pQualityMode,
      p_stale_after_seconds: env.openRouter.staleAfterSeconds,
    };
  };

  const reservation: GenerationReservationRepository = {
    async lookup(idempotencyKey) {
      const raw = await rpc("lookup_ai_generation_request", {
        p_user_id: user.userId,
        p_idempotency_key: idempotencyKey,
      });
      const miss = lookupMissSchema.safeParse(raw);
      if (miss.success) return { kind: "miss" };
      const hit = lookupHitSchema.parse(raw);
      return {
        kind: "hit",
        requestId: hit.request_id,
        requestHmacVersion: hit.request_hmac_version,
        integrity: parseIntegrityContextPayload(hit.integrity),
      };
    },

    async replayExisting(command, lookup) {
      // 保存済み integrity から HMAC を再計算し、live draft/menu を読まずに台帳へ照合する
      try {
        // G1: Plus で qualityMode:true 予約後に plan が Free 化すると、reserve 前
        // assertQualityModeAllowed の 403 だけで processing 行が残り、クライアントが
        // quality_mode_requires_plus を failed として pending を消して status 回収不能になる。
        // lookup hit では先に finalize failure で processing を終端し、枠を解放する。
        // 既に succeeded 等の terminal は finalize が現状を返すため壊さない。
        // HMAC / qualityMode 契約は緩めない（false へ書換えての再送は 409 のまま）。
        //
        // RR1: demotion 判定と buildReserveArgs で entitlement を二重読取しない。
        // 1 回目 Plus・2 回目 Free の TOCTOU だと finalize 無し 403 + processing 孤児が再発する。
        // request 内で resolvePlanLimits を 1 回に固定し、降格時は必ず finalize してから 403。
        if (command.qualityMode) {
          const planLimits = await resolvePlanLimits();
          if (planLimits.quotaPlan !== "plus") {
            const terminal = requestPayloadSchema.parse(
              await rpc("finalize_ai_generation_failure", {
                p_request_id: lookup.requestId,
                p_failure_code: "quality_mode_requires_plus",
                p_retry_at: null,
              }),
            );
            // processing→failed（または既に同 code failed）: 初回 Free quality と同 UX の 403
            if (
              terminal.status === "failed" &&
              terminal.failure_code === "quality_mode_requires_plus"
            ) {
              throw new HttpError(
                403,
                "quality_mode_requires_plus",
                issueMessages.quality_mode_requires_plus,
              );
            }
            // 既 terminal（succeeded / 他 failed / conflict）はそのまま返す
            return terminal;
          }
          // plus 継続: 同じ planLimits を reserve に渡し、assert / limits の再読取を避ける
          return requestPayloadSchema.parse(
            await rpc(
              "reserve_ai_generation",
              await buildReserveArgs(command, lookup.integrity, planLimits),
            ),
          );
        }
        return requestPayloadSchema.parse(
          await rpc("reserve_ai_generation", await buildReserveArgs(command, lookup.integrity)),
        );
      } catch (error: unknown) {
        // lookup hit 後に row が消えた場合は miss へ戻さず fail-closed
        if (error instanceof HttpError && error.code === "quota_transition_failed") {
          throw new HttpError(500, "internal_error", "生成の受付状態を更新できませんでした。");
        }
        throw error;
      }
    },

    async reserveNew(command, integrity) {
      return requestPayloadSchema.parse(
        await rpc("reserve_ai_generation", await buildReserveArgs(command, integrity)),
      );
    },
  };

  return {
    userClient,
    ...reservation,
    async markSent(requestId: string) {
      // sent / code は短期窓拒否時に付加される。通常成功は sent=true。
      // extras 解析失敗時は status!==processing なら fail-closed で sent=false。
      const raw = await rpc("mark_ai_global_sent", { p_request_id: requestId });
      const record = requestPayloadSchema.parse(raw);
      const extras = z
        .object({
          sent: z.boolean().optional(),
          code: z.string().optional(),
        })
        .safeParse(raw);
      const processing = record.status === "processing";
      return {
        ...record,
        sent: extras.success ? (extras.data.sent ?? processing) : processing,
        code: extras.success
          ? (extras.data.code ?? record.failure_code ?? null)
          : (record.failure_code ?? null),
      };
    },
    async failBeforeSend(requestId: string, code: string, retryAt: string | null = null) {
      // 未送信の success / attempt / global 予約を解放する fail の別名
      return this.fail(requestId, code, retryAt);
    },
    async reserveRepair(requestId: string) {
      return repairReservationSchema.parse(
        await rpc("reserve_ai_repair_call", {
          p_request_id: requestId,
          p_global_limit: env.openRouter.globalDailyLimit,
          p_quota_disabled: quotaDisabled,
        }),
      );
    },
    async recordModel(requestId: string, modelId: string) {
      await rpc("record_ai_generation_model", {
        p_request_id: requestId,
        p_model_id: modelId,
      });
    },
    async fail(requestId: string, code: string, retryAt: string | null) {
      return requestPayloadSchema.parse(
        await rpc("finalize_ai_generation_failure", {
          p_request_id: requestId,
          p_failure_code: code,
          p_retry_at: retryAt,
        }),
      );
    },
    async conflict(requestId: string, conflicts: unknown[]) {
      // 永続化境界へは閉じた code 配列だけを渡し、message/conditionRefs は載せない
      const parsed = conflictPayloadSchema.parse(conflicts);
      const codes = [...new Set(parsed.map((conflict) => conflict.code))];
      return requestPayloadSchema.parse(
        await rpc("finalize_ai_generation_conflict", {
          p_request_id: requestId,
          p_conflict_codes: codes,
        }),
      );
    },
    async succeed(input: GenerationSuccessInput, options: GenerationSucceedOptions) {
      // 残 deadline を同一 RPC セッションの statement_timeout に載せ、背景継続させない。
      // remainingMs<=0 は入口ゲート漏れの防御として即 timeout（DB を叩かない）。
      const timeoutMs = Math.floor(options.remainingMs);
      if (timeoutMs <= 0) {
        throw new GenerationFinalizeTimeoutError();
      }
      // idea は null version / 空 target をそのまま渡し、サム値へ置換しない
      return requestPayloadSchema.parse(
        await rpc("finalize_ai_generation_success_deadline_bounded", {
          p_timeout_ms: timeoutMs,
          p_request_id: input.requestId,
          p_menu: jsonValueSchema.parse(input.menu),
          p_preference_snapshot: jsonValueSchema.parse(input.preferenceSnapshot),
          p_safety_snapshot: jsonValueSchema.parse(input.safetySnapshot),
          p_safety_fingerprint: input.safetyFingerprint,
          p_allergen_version: input.allergenVersion,
          p_food_rule_version: input.foodRuleVersion,
          p_target_members: jsonValueSchema.parse(input.targetMembers),
          p_expired_checks: jsonValueSchema.parse(input.expiredChecks),
          p_source_menu_id: input.sourceMenuId,
          p_change_reason: input.changeReason,
          p_change_reason_custom: input.changeReasonCustom,
        }),
      );
    },
    async status(idempotencyKey: string) {
      const { limits } = await resolvePlanLimits();
      return requestPayloadSchema.parse(
        await rpc("get_ai_generation_status", {
          p_user_id: user.userId,
          p_idempotency_key: idempotencyKey,
          p_user_limit: limits.successPerDay,
          p_attempt_limit: limits.attemptsPerDay,
          p_short_window_limit: limits.shortWindowLimit,
          p_identity_key: identityKey,
        }),
      );
    },
  };
}

export type GenerationRepository = ReturnType<typeof createGenerationRepository>;
export { type UserSupabaseClient };
