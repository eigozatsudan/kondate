import { z } from "zod";
import {
  generationConflictCopy,
  generationConflictSchema,
  generationCommandVersionV2,
  releaseQuota,
  type GenerationCommandV2,
  type GenerationIntegrityContextV2,
  type GenerationRequestLookup,
  type ValidatedMenu,
} from "../../../shared/contracts/generation.js";
import type { GenerationTargetMember } from "../../../shared/safety/generation-context.js";
import { ideaSafetySnapshot } from "../../../shared/safety/idea-fingerprint.js";
import type { Database } from "../../../src/shared/types/database.js";
import type { requireUser } from "./auth.js";
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

export type GenerationSuccessWriter = {
  succeed: (input: GenerationSuccessInput) => Promise<QuotaRequestRecord>;
};

// 型定義に使う const を実行時参照として保持し、tree-shake でも消えないようにする
export { ideaSafetySnapshot };

export type AuthenticatedUser = Awaited<ReturnType<typeof requireUser>>;

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
    user_daily_limit: z.literal(releaseQuota.userDailySuccessLimit).optional(),
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

async function rpc<Name extends PublicFunctionName>(
  name: Name,
  parameters: PublicFunctions[Name]["Args"],
): Promise<unknown> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc(name, parameters);
    if (error !== null) throw error;
    return data;
  } catch (error: unknown) {
    // 同一冪等キーで異なるコマンド本文は非再試行の 409 へ固定する
    if (
      isPostgrestLikeError(error) &&
      error.code === "22023" &&
      error.message === "idempotency_payload_mismatch"
    ) {
      throw new HttpError(
        409,
        "idempotency_payload_mismatch",
        "同じ操作番号で異なる内容は送信できません。最初からやり直してください。",
      );
    }
    // finalize の fingerprint 不一致が raise で返る旧経路向け。
    // 正規経路は SQL 側で constraint_conflict に原子遷移する。
    if (
      isPostgrestLikeError(error) &&
      (error.code === "P0001" || error.code === "22023") &&
      error.message === "current_safety_changed"
    ) {
      throw new HttpError(
        409,
        "current_safety_changed",
        generationConflictCopy.current_safety_changed,
      );
    }
    throw new HttpError(500, "quota_transition_failed", "生成の受付状態を更新できませんでした。");
  }
}

const lookupHitSchema = z
  .object({
    kind: z.literal("hit"),
    request_id: z.uuid(),
    request_hmac_version: z.literal(generationCommandVersionV2),
    integrity: z.unknown(),
  })
  .strict();
const lookupMissSchema = z.object({ kind: z.literal("miss") }).strict();

export type GenerationReservationRepository = {
  lookup: (idempotencyKey: string) => Promise<GenerationRequestLookup>;
  replayExisting: (
    command: GenerationCommandV2,
    lookup: Extract<GenerationRequestLookup, { kind: "hit" }>,
  ) => Promise<QuotaRequestRecord>;
  reserveNew: (
    command: GenerationCommandV2,
    integrity: GenerationIntegrityContextV2,
  ) => Promise<QuotaRequestRecord>;
};

export function createGenerationRepository(user: AuthenticatedUser) {
  const env = getServerEnv();
  const userClient = createUserScopedSupabase(user.accessToken);

  const buildReserveArgs = (
    command: GenerationCommandV2,
    integrity: GenerationIntegrityContextV2,
  ) => {
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
      p_user_limit: env.openRouter.userDailyLimit,
      p_global_limit: env.openRouter.globalDailyLimit,
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
        return requestPayloadSchema.parse(
          await rpc("reserve_ai_generation", buildReserveArgs(command, lookup.integrity)),
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
        await rpc("reserve_ai_generation", buildReserveArgs(command, integrity)),
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
    async succeed(input: GenerationSuccessInput) {
      // idea は null version / 空 target をそのまま渡し、サム値へ置換しない
      return requestPayloadSchema.parse(
        await rpc("finalize_ai_generation_success", {
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
      return requestPayloadSchema.parse(
        await rpc("get_ai_generation_status", {
          p_user_id: user.userId,
          p_idempotency_key: idempotencyKey,
          p_user_limit: env.openRouter.userDailyLimit,
        }),
      );
    },
  };
}

export type GenerationRepository = ReturnType<typeof createGenerationRepository>;
export { type UserSupabaseClient };
