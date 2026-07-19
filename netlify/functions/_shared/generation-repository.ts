import { z } from "zod";
import {
  generationConflictSchema,
  releaseQuota,
  type ValidatedMenu,
} from "../../../shared/contracts/generation.js";
import type { Database } from "../../../src/shared/types/database.js";
import type { requireUser } from "./auth.js";
import { getServerEnv } from "./env.js";
import { HttpError } from "./http.js";
import { getSupabaseAdmin } from "./supabase-admin.js";
import { createUserScopedSupabase, type UserSupabaseClient } from "./supabase-user.js";

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

async function rpc<Name extends PublicFunctionName>(
  name: Name,
  parameters: PublicFunctions[Name]["Args"],
): Promise<unknown> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc(name, parameters);
    if (error !== null) throw error;
    return data;
  } catch {
    throw new HttpError(500, "quota_transition_failed", "生成の受付状態を更新できませんでした。");
  }
}

export function createGenerationRepository(user: AuthenticatedUser) {
  const env = getServerEnv();
  const userClient = createUserScopedSupabase(user.accessToken);
  return {
    userClient,
    async reserve(input: {
      idempotencyKey: string;
      kind: "new_menu" | "regenerate_menu" | "regenerate_dish";
      draftId: string | null;
      draftRevision: number | null;
    }) {
      return requestPayloadSchema.parse(
        await rpc("reserve_ai_generation", {
          p_user_id: user.userId,
          p_idempotency_key: input.idempotencyKey,
          p_request_kind: input.kind,
          p_draft_id: input.draftId,
          p_draft_revision: input.draftRevision,
          p_user_limit: env.openRouter.userDailyLimit,
          p_global_limit: env.openRouter.globalDailyLimit,
          p_stale_after_seconds: env.openRouter.staleAfterSeconds,
        }),
      );
    },
    async markSent(requestId: string) {
      return requestPayloadSchema.parse(
        await rpc("mark_ai_global_sent", { p_request_id: requestId }),
      );
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
      return requestPayloadSchema.parse(
        await rpc("finalize_ai_generation_conflict", {
          p_request_id: requestId,
          p_conflicts: jsonValueSchema.parse(conflictPayloadSchema.parse(conflicts)),
        }),
      );
    },
    async succeed(input: {
      requestId: string;
      menu: ValidatedMenu;
      preferenceSnapshot: unknown;
      safetySnapshot: unknown;
      safetyFingerprint: string;
      allergenVersion: string;
      foodRuleVersion: string;
      targetMembers: unknown[];
      expiredChecks: unknown[];
      sourceMenuId: string | null;
      changeReason: string | null;
      changeReasonCustom: string | null;
    }) {
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
