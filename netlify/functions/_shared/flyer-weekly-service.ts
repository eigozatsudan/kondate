/**
 * チラシ→1 週間献立サービス。
 * reserve S0–S4 → mark sent → OpenRouter vision → Zod + server safety → finalize。
 * 画像・ファイル名はログしない（SafeLog flyer: true のみ）。
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  flyerWeeklyIssueMessages,
  weeklyFlyerMenuResultSchema,
  weeklyFlyerMenuSchema,
  type WeeklyFlyerMenu,
  type WeeklyFlyerMenuResult,
} from "../../../shared/contracts/flyer-weekly.js";
import {
  FINALIZE_RESERVE_MS,
  OPENROUTER_TIMEOUT_MS,
} from "../../../shared/contracts/function-budget.js";
import { issueMessages } from "../../../shared/contracts/generation.js";
import {
  ageBands,
  privacyNoticeVersion,
  requiredSafetyConstraints,
  type AgeBand,
  type RequiredSafetyConstraint,
} from "../../../shared/contracts/domain.js";
import { planQuota } from "../../../shared/contracts/plan-quota.js";
import { foodTextContainsAlias, normalizeFoodText } from "../../../shared/safety/allergens.js";
import type { CurrentSafetyContext } from "../../../shared/safety/context.js";
import { collectGuaranteePhraseIssuesFromFlyerMenu } from "../../../shared/safety/guarantee-phrases.js";
import {
  applyQuotaPlan,
  BillingEntitlementUnavailableError,
  limitsForPlan,
  loadEntitlement,
  productSurfacesOpen,
  type Entitlement,
} from "./billing-entitlement.js";
import { loadCurrentSafetyContext } from "./current-safety.js";
import { getServerEnv } from "./env.js";
import { FlyerImageError, prepareFlyerImage } from "./flyer-image.js";
import { HttpError } from "./http.js";
import { safeLog } from "./logger.js";
import {
  createOpenRouterGenerationSender,
  ensureOpenRouterRuntimeModelPolicy,
  OpenRouterCallError,
  type OpenRouterGenerationResult,
  type OpenRouterMessage,
} from "./openrouter.js";
import { computeQuotaIdentityKey } from "./quota-identity.js";
import { getSupabaseAdmin, type AdminSupabaseClient } from "./supabase-admin.js";
import { createUserScopedSupabase } from "./supabase-user.js";

/**
 * JST 週の月曜 YYYY-MM-DD。usage-today の flyer weekStart フォールバックと同式。
 * UTC toISOString の暦日は使わない（JST 深夜付近でずれる）。
 */
export function jstWeekStartMonday(now: Date): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = jst.getUTCDay(); // 0=Sun
  const mondayOffset = day === 0 ? -6 : 1 - day;
  jst.setUTCDate(jst.getUTCDate() + mondayOffset);
  return jst.toISOString().slice(0, 10);
}

/**
 * 新 RPC を typegen 前に呼ぶ。migration 適用後は `npm run db:types` で正式型へ寄せる。
 */
async function rpcUntyped(
  admin: AdminSupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; error: { message?: string } | null }> {
  // typegen 前の新 RPC 呼び出し。await 後に data/error だけ読む。
  const result: unknown = await (
    admin as unknown as {
      rpc: (name: string, params: Record<string, unknown>) => Promise<unknown>;
    }
  ).rpc(fn, args);
  if (typeof result !== "object" || result === null) {
    return { data: null, error: { message: "rpc_failed" } };
  }
  const record = result as { data?: unknown; error?: { message?: string } | null };
  return { data: record.data ?? null, error: record.error ?? null };
}

const reservePayloadSchema = z.looseObject({
  request_id: z.uuid().nullable(),
  idempotency_key: z.string(),
  status: z.enum(["processing", "succeeded", "failed"]),
  failure_code: z.string().nullable().optional(),
  retry_at: z.string().nullable().optional(),
  week_start: z.string().optional(),
  result: z.unknown().nullable().optional(),
  replayed: z.boolean().optional(),
  flyer_try_sent: z.boolean().optional(),
  global_sent_calls: z.number().optional(),
});

const markPayloadSchema = z.looseObject({
  sent: z.boolean(),
  code: z.string().optional(),
  status: z.string().optional(),
  failure_code: z.string().nullable().optional(),
  retry_at: z.string().nullable().optional(),
});

export type FlyerWeeklyAuthUser = {
  userId: string;
  email: string;
  /** privacy_consents を user-scoped で読むための JWT */
  accessToken: string;
};

/** mark 前に必要な最小残り予算（試行上限 + finalize 予約）。generation-service と同型。 */
const REQUIRED_SEND_BUDGET_MS = OPENROUTER_TIMEOUT_MS + FINALIZE_RESERVE_MS;

const flyerConsentRowSchema = z
  .object({
    user_id: z.uuid(),
    notice_version: z.literal(privacyNoticeVersion),
    accepted_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export type FlyerWeeklyDeps = {
  user: FlyerWeeklyAuthUser;
  /** テスト用: OpenRouter 呼び出し回数を数える */
  openRouterSender?: (
    messages: readonly OpenRouterMessage[],
    timeoutMs: number,
  ) => Promise<OpenRouterGenerationResult>;
  now?: () => Date;
  /** handler 入口の performance.now()。未指定時は本関数入口で計測する。 */
  requestStartedAtMonotonicMs?: number;
  /** 総予算 ms。既定はリリース固定 55s。 */
  functionTotalBudgetMs?: number;
  /** テスト用の単調時計。 */
  monotonicNow?: () => number;
  /**
   * テスト用: 現行 notice への同意確認を差し替え。
   * 未指定時は privacy_consents を user-scoped に読む（生成経路と同型）。
   */
  assertPrivacyConsent?: (user: FlyerWeeklyAuthUser) => Promise<void>;
  /**
   * PE5: mark 前の Models 政策。未指定時は env から ensureOpenRouterRuntimeModelPolicy。
   * 失敗は p_sent:false（try 非消費）。allowlist / 価格定数は変えない。
   */
  ensureOpenRouterModelPolicy?: (input: { models: readonly string[] }) => Promise<void>;
  /**
   * PE2: Plus 短絡時の台帳参照。未指定時は lookup_flyer_weekly（新規 reserve しない）。
   */
  lookupFlyerWeekly?: (input: { userId: string; idempotencyKey: string }) => Promise<unknown>;
};

/**
 * PRIV-1: チラシも OpenRouter へ送る AI 経路のため、現行 privacy_consents 必須。
 * reserve / 画像処理の前に fail-closed し、未同意で try を焼かない。
 */
export async function assertFlyerPrivacyConsent(user: FlyerWeeklyAuthUser): Promise<void> {
  const userClient = createUserScopedSupabase(user.accessToken);
  const consentResult = await userClient
    .from("privacy_consents")
    .select("user_id,notice_version,accepted_at")
    .eq("user_id", user.userId)
    .eq("notice_version", privacyNoticeVersion)
    .maybeSingle();
  const consent = flyerConsentRowSchema.safeParse(consentResult.data);
  if (consentResult.error !== null || !consent.success || consent.data.user_id !== user.userId) {
    throw new HttpError(422, "consent_required", "最新の利用説明への同意が必要です。");
  }
}

/**
 * flyer 第一関門。usage と同じく applyQuotaPlan の plus を見る。
 * B2: kill_source では elevation しない。生 plusEntitled（kill unpaid）で短絡しない。
 */
export function isFlyerPlusAllowed(entitlement: Entitlement, billingEnabled: boolean): boolean {
  return (
    productSurfacesOpen(billingEnabled) && applyQuotaPlan(entitlement, billingEnabled) === "plus"
  );
}

function entitlementUnavailableHttpError(): HttpError {
  return new HttpError(
    503,
    "billing_entitlement_unavailable",
    "プラン情報を確認できませんでした。しばらくしてからお試しください。",
  );
}

function mapFailureHttp(code: string, retryAt: string | null = null): never {
  const flyerKey = code as keyof typeof flyerWeeklyIssueMessages;
  const genKey = code as keyof typeof issueMessages;
  const flyerMsg =
    flyerKey in flyerWeeklyIssueMessages ? flyerWeeklyIssueMessages[flyerKey] : undefined;
  const genMsg = genKey in issueMessages ? issueMessages[genKey] : undefined;
  const message = flyerMsg ?? genMsg ?? "チラシ献立を作成できませんでした。";
  const status =
    code === "flyer_requires_plus"
      ? 403
      : code === "flyer_invalid_image" ||
          code === "flyer_unsupported_media" ||
          code === "flyer_invalid_ai_response" ||
          code === "invalid_request"
        ? 400
        : // PE1: processing 冪等 hit / 他 key の in_progress は再試行可能（枠破壊なし）
          code === "generation_in_progress"
          ? 409
          : code === "flyer_weekly_limit" ||
              code === "flyer_weekly_try_limit" ||
              code === "user_attempt_limit" ||
              code === "user_short_window_limit" ||
              code === "global_daily_limit"
            ? 429
            : code === "model_unavailable" || code === "generation_timeout"
              ? 503
              : code === "safety_context_failed"
                ? 500
                : code === "allergy_unconfirmed" ||
                    code === "allergen_missing" ||
                    code === "unsupported_diet_unconfirmed" ||
                    code === "unsupported_diet" ||
                    code === "current_target_member_required" ||
                    code === "current_safety_revalidation_required" ||
                    code === "consent_required"
                  ? 422
                  : 400;
  throw new HttpError(status, code, message, retryAt ? { retryAt } : undefined);
}

function flyerDayTextFields(day: WeeklyFlyerMenu["days"][number]): readonly string[] {
  return [day.label, day.mainName, day.sideName ?? "", day.notes ?? "", ...day.ingredients].filter(
    (text) => text.trim() !== "",
  );
}

/**
 * 表示・保持フィールド全体が禁止アレルゲン針に触れていないか。
 * PE2: 素の includes ではなく evaluateAllergens と同型の foodTextContainsAlias を使う
 *（区切り跨ぎ誤検知の除外・トークン境界）。
 */
export function assertFlyerMenuSafe(
  menu: WeeklyFlyerMenu,
  bannedIngredientNeedles: readonly string[],
): void {
  if (bannedIngredientNeedles.length === 0) return;
  const needles = bannedIngredientNeedles
    .map((n) => normalizeFoodText(n))
    .filter((n) => n.length > 0);
  if (needles.length === 0) return;

  for (const day of menu.days) {
    for (const field of flyerDayTextFields(day)) {
      for (const needle of needles) {
        if (foodTextContainsAlias(field, needle)) {
          throw new HttpError(
            400,
            "flyer_invalid_ai_response",
            flyerWeeklyIssueMessages.flyer_invalid_ai_response,
          );
        }
      }
    }
  }
}

/**
 * PE2: current safety の辞書 alias + 確認済み custom を evaluateAllergens と同型マッチャで検査。
 * チラシ結果画面にラベル確認 UI が無いため requiresLabelConfirmation も拒否（fail-closed）。
 * R1: 年齢帯 food rules も適用。flyer は generation 形の adaptations / safetyActions を持たないため、
 * forbidden・requires_tag のいずれも matchTerms が日次テキストに出たら fail-closed
 *（requiredSafetyConstraints 証拠を付けられない経路の residual を閉じる）。
 */
function rejectFlyerSafetyHit(): never {
  throw new HttpError(
    400,
    "flyer_invalid_ai_response",
    flyerWeeklyIssueMessages.flyer_invalid_ai_response,
  );
}

/** PE11: flyer は cut_small 証拠を付けられない。mark 前 422（try 非消費）。 */
function rejectFlyerCutSmallIfPresent(safety: CurrentSafetyContext): void {
  for (const member of safety.members) {
    if (member.requiredSafetyConstraints.includes("cut_small")) {
      throw new HttpError(
        422,
        "current_safety_revalidation_required",
        issueMessages.current_safety_revalidation_required,
      );
    }
  }
}

/** 検査集合の DB / 一時障害。400 に写すと sticky が消え同一画像が新 key になる。 */
function inspectionSafetyUnavailable(): HttpError {
  return new HttpError(500, "safety_context_failed", "現在の安全条件を読み込めませんでした");
}

/** draft メンバーの member_allergies 行（検査用 union 入力）。 */
export type FlyerDraftAllergyRow = {
  member_id: string;
  allergen_id: string | null;
  custom_name: string | null;
  custom_aliases: readonly string[] | null;
  custom_confirmed: boolean;
};

/** draft メンバーの年齢帯・必須制約（検査用。部分 age は adult と推測しない）。 */
export type FlyerDraftMemberRow = {
  id: string;
  age_band: AgeBand | null;
  required_safety_constraints: readonly RequiredSafetyConstraint[];
};

/**
 * PE1: complete のみの safety に、draft（入力途中）メンバーの確認済みアレルギー針を検査集合へ union する。
 * get_current_safety_snapshot は status=complete のみのため draft は RPC に載せられない。
 * 表示ターゲットにはせず、banned / assert 用にだけ合成する。
 * PE5: 保存済み age_band / required_safety_constraints を使う。
 * PE2: 未保存の年齢は adult 既定にしない。検査に載せる draft は幼児ルール fail-closed。
 */
export function appendDraftMemberAllergiesForFlyerInspection(
  safety: CurrentSafetyContext,
  draftAllergyRows: readonly FlyerDraftAllergyRow[],
  draftMembers: readonly FlyerDraftMemberRow[] = [],
): CurrentSafetyContext {
  if (draftAllergyRows.length === 0 && draftMembers.length === 0) return safety;

  const byMember = new Map<
    string,
    { allergenIds: string[]; customAllergies: { name: string; aliases: string[] }[] }
  >();
  for (const row of draftAllergyRows) {
    const bucket = byMember.get(row.member_id) ?? { allergenIds: [], customAllergies: [] };
    if (row.allergen_id !== null && row.allergen_id.trim() !== "") {
      if (!bucket.allergenIds.includes(row.allergen_id)) {
        bucket.allergenIds.push(row.allergen_id);
      }
    } else if (row.custom_confirmed && row.custom_name !== null && row.custom_name.trim() !== "") {
      // RPC と同型: custom_confirmed のみ検査針にする
      bucket.customAllergies.push({
        name: row.custom_name,
        aliases: [...(row.custom_aliases ?? [])].filter((alias) => alias.trim() !== ""),
      });
    }
    byMember.set(row.member_id, bucket);
  }

  const memberMeta = new Map(draftMembers.map((member) => [member.id, member]));
  const memberIds = new Set([...byMember.keys(), ...memberMeta.keys()]);

  // member_id 昇順で合成し、anonymousRef 採番を決定的にする
  const extraMembers: CurrentSafetyContext["members"][number][] = [];
  let refIndex = safety.members.length;
  for (const memberId of [...memberIds].sort()) {
    const bucket = byMember.get(memberId) ?? { allergenIds: [], customAllergies: [] };
    const meta = memberMeta.get(memberId);
    // PE2: null 帯を adult と推測すると離乳後〜5歳ルール（餅・硬い豆等）が外れる。
    // 検査に載せるときだけ幼児帯へ fail-closed。針も制約も無い draft は下の continue で載せない。
    const ageBand = meta?.age_band ?? "post_weaning_to_2";
    const constraints = meta?.required_safety_constraints ?? [];
    const hasAllergies = bucket.allergenIds.length > 0 || bucket.customAllergies.length > 0;
    const hasAgeRules = meta?.age_band != null && meta.age_band !== "adult";
    if (!hasAllergies && !hasAgeRules && constraints.length === 0) continue;
    refIndex += 1;
    extraMembers.push({
      householdMemberId: memberId,
      anonymousRef: `member_${String(refIndex)}`,
      ageBand,
      allergyStatus: hasAllergies ? "registered" : "none",
      allergenIds: bucket.allergenIds,
      hasUnmappedCustomAllergy: bucket.customAllergies.length > 0,
      customAllergies: bucket.customAllergies,
      requiredSafetyConstraints: [...constraints],
      unsupportedDietStatus: "none",
      unsupportedDietKinds: [],
    });
  }
  if (extraMembers.length === 0) return safety;
  return {
    ...safety,
    members: [...safety.members, ...extraMembers],
  };
}

/**
 * PE2: complete + draft 検査用の現行 safety を組み立てる。
 * succeeded 冪等 replay と初回 OpenRouter 後で同じ検査集合を使い、
 * 成功後に追加されたアレルギーで旧献立を再生しない。
 * finalize は触らない（既 terminal を壊さない）。
 */
export async function loadFlyerInspectionSafety(
  admin: AdminSupabaseClient,
  userId: string,
): Promise<CurrentSafetyContext> {
  const { data: memberRows, error: memberError } = await admin
    .from("household_members")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "complete")
    .order("sort_order", { ascending: true });
  if (memberError !== null) {
    throw inspectionSafetyUnavailable();
  }
  const memberIds = (Array.isArray(memberRows) ? memberRows : []).map(
    (row: { id: string }) => row.id,
  );
  // complete 0 人では banned 空のまま検査スキップして成功させない（false-safe 禁止）
  if (memberIds.length === 0) {
    throw new HttpError(
      422,
      "current_target_member_required",
      issueMessages.current_target_member_required,
    );
  }
  const safety = await loadCurrentSafetyContext(admin, userId, memberIds);
  // unconfirmed / allergen_missing を generation と同型で fail-closed
  for (const member of safety.members) {
    if (member.allergyStatus === "unconfirmed") {
      throw new HttpError(422, "allergy_unconfirmed", issueMessages.allergy_unconfirmed);
    }
    if (
      member.allergyStatus === "registered" &&
      member.allergenIds.length === 0 &&
      member.customAllergies.length === 0
    ) {
      throw new HttpError(422, "allergen_missing", issueMessages.allergen_missing);
    }
    if (member.unsupportedDietStatus === "unconfirmed") {
      throw new HttpError(
        422,
        "unsupported_diet_unconfirmed",
        issueMessages.unsupported_diet_unconfirmed,
      );
    }
    if (member.unsupportedDietStatus === "present") {
      throw new HttpError(422, "unsupported_diet", issueMessages.unsupported_diet);
    }
  }
  // draft に登録済みアレルギーが残っていても検査集合から外さない
  const { data: draftMemberRows, error: draftMemberError } = await admin
    .from("household_members")
    .select("id,age_band,required_safety_constraints")
    .eq("user_id", userId)
    .eq("status", "draft");
  if (draftMemberError !== null) {
    throw inspectionSafetyUnavailable();
  }
  const parsedDraftMembers = z
    .array(
      z.object({
        id: z.string().min(1),
        age_band: z.enum(ageBands).nullable(),
        required_safety_constraints: z
          .array(z.enum(requiredSafetyConstraints))
          .nullish()
          .transform((value) => value ?? []),
      }),
    )
    .safeParse(Array.isArray(draftMemberRows) ? draftMemberRows : []);
  if (!parsedDraftMembers.success) {
    throw inspectionSafetyUnavailable();
  }
  const draftMembers: FlyerDraftMemberRow[] = parsedDraftMembers.data;
  const draftMemberIds = draftMembers.map((row) => row.id);
  if (draftMemberIds.length === 0) {
    rejectFlyerCutSmallIfPresent(safety);
    return safety;
  }
  const { data: draftAllergyRows, error: draftAllergyError } = await admin
    .from("member_allergies")
    .select("member_id,allergen_id,custom_name,custom_aliases,custom_confirmed")
    .eq("user_id", userId)
    .in("member_id", draftMemberIds);
  if (draftAllergyError !== null) {
    throw inspectionSafetyUnavailable();
  }
  const inspection = appendDraftMemberAllergiesForFlyerInspection(
    safety,
    Array.isArray(draftAllergyRows) ? draftAllergyRows : [],
    draftMembers,
  );
  rejectFlyerCutSmallIfPresent(inspection);
  return inspection;
}

/**
 * persist / UI に「安全です」等を残さない。生成の collectGuaranteePhraseIssues と同針。
 * ヒットは 400 flyer_invalid_ai_response（新 code は足さない）。
 */
export function assertFlyerMenuHasNoGuaranteePhrases(menu: WeeklyFlyerMenu): void {
  if (collectGuaranteePhraseIssuesFromFlyerMenu(menu).length === 0) return;
  throw new HttpError(
    400,
    "flyer_invalid_ai_response",
    flyerWeeklyIssueMessages.flyer_invalid_ai_response,
  );
}

export function assertFlyerMenuAgainstSafety(
  menu: WeeklyFlyerMenu,
  safety: CurrentSafetyContext,
): void {
  // PE6: flyer は adaptations / safetyActions を持てない。cut_small は料理単位で証拠必須のため即拒否。
  for (const member of safety.members) {
    if (member.requiredSafetyConstraints.includes("cut_small")) {
      rejectFlyerSafetyHit();
    }
  }
  for (const day of menu.days) {
    const fields = flyerDayTextFields(day);
    for (const member of safety.members) {
      for (const allergenId of member.allergenIds) {
        const aliases = safety.allergenDictionary.aliases.filter(
          (alias) => alias.allergenId === allergenId,
        );
        for (const field of fields) {
          if (aliases.some((alias) => foodTextContainsAlias(field, alias.normalizedAlias))) {
            rejectFlyerSafetyHit();
          }
        }
      }
      for (const custom of member.customAllergies) {
        const needles = [custom.name, ...custom.aliases].filter((value) => value.trim() !== "");
        if (needles.length === 0) continue;
        for (const field of fields) {
          if (needles.some((needle) => foodTextContainsAlias(field, needle))) {
            rejectFlyerSafetyHit();
          }
        }
      }
      // 年齢帯ルール: flyer にタグ証拠が無いので命中即拒否（adult のみ等は appliesTo で無操作）
      for (const rule of safety.foodSafetyRules) {
        if (!rule.appliesToAgeBands.includes(member.ageBand)) continue;
        for (const field of fields) {
          if (rule.matchTerms.some((term) => foodTextContainsAlias(field, term))) {
            rejectFlyerSafetyHit();
          }
        }
      }
    }
  }
}

const flyerLookupMissSchema = z.object({ kind: z.literal("miss") }).strict();

async function defaultLookupFlyerWeekly(
  admin: AdminSupabaseClient,
  userId: string,
  idempotencyKey: string,
): Promise<unknown> {
  const { data, error } = await rpcUntyped(admin, "lookup_flyer_weekly", {
    p_user_id: userId,
    p_idempotency_key: idempotencyKey,
  });
  if (error !== null) {
    throw new HttpError(500, "internal_error", issueMessages.internal_error);
  }
  return data;
}

/**
 * 既 terminal succeeded の台帳本文を現行 safety 再 assert のうえ返す。
 * result 欠損 / Zod 非適合は PE13 どおり fail-closed。
 */
async function replaySucceededFlyerMenu(
  admin: AdminSupabaseClient,
  userId: string,
  reserve: z.infer<typeof reservePayloadSchema>,
  requestIdForLog: string,
): Promise<{ menu: WeeklyFlyerMenuResult; requestId: string }> {
  if (reserve.result == null) {
    throw new HttpError(400, "internal_error", issueMessages.internal_error);
  }
  // PE7: 再生は weekStartJst 必須の Result schema。弱い AI schema + cast で必須をスキップしない。
  const parsedResult = weeklyFlyerMenuResultSchema.safeParse(reserve.result);
  if (!parsedResult.success) {
    throw new HttpError(400, "internal_error", issueMessages.internal_error);
  }
  const menu = parsedResult.data;
  const inspectionSafety = await loadFlyerInspectionSafety(admin, userId);
  assertFlyerMenuAgainstSafety(menu, inspectionSafety);
  // PE3: 再生でも保証フレーズ針を通す（針増補・旧行の historical 本文を 200 に残さない）
  assertFlyerMenuHasNoGuaranteePhrases(menu);
  return { menu, requestId: reserve.request_id ?? requestIdForLog };
}

/**
 * PE11: persist + reserved→success が終わるまで 200 にしない。
 * finalize 失敗時は本文を stash して 500。同一キー再入場 / cleanup が枠を空けずに確定する。
 * finalize_failure は呼ばない（reserved を解放すると successPerJstWeek を踏まず 200 を繰り返せる）。
 */
async function commitFlyerWeeklySuccess(
  admin: AdminSupabaseClient,
  requestId: string,
  resultMenu: WeeklyFlyerMenuResult,
  started: number,
): Promise<void> {
  const { error: finError } = await rpcUntyped(admin, "finalize_flyer_weekly_success", {
    p_request_id: requestId,
    p_result: resultMenu,
  });
  if (finError === null) return;

  await rpcUntyped(admin, "stash_flyer_weekly_result", {
    p_request_id: requestId,
    p_result: resultMenu,
  });
  safeLog({
    level: "error",
    requestId,
    code: "flyer_finalize_success_failed",
    durationMs: performance.now() - started,
    flyer: true,
    plan: "plus",
  });
  throw new HttpError(500, "internal_error", issueMessages.internal_error);
}

function buildFlyerMessages(dataUrl: string): OpenRouterMessage[] {
  return [
    {
      role: "system",
      content:
        "あなたは家庭の週間献立アシスタントです。スーパーのチラシ写真から、主菜中心の 7 日分献立を JSON で返してください。" +
        "days は dayIndex 1..7 を一意に含み、各日 mainName と ingredients（食材名の配列）を必ず入れてください。" +
        "アレルギー・医療・離乳食は扱わず、一般的な家庭料理に限定してください。",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "このチラシ写真を見て、1 週間（7 日）の献立案を JSON で作ってください。",
        },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ];
}

/**
 * multipart の image フィールドのみを受け取り、週間献立を返す。
 */
export async function runFlyerWeekly(
  deps: FlyerWeeklyDeps,
  imageBytes: Uint8Array,
  idempotencyKey: string = randomUUID(),
): Promise<{ menu: WeeklyFlyerMenuResult; requestId: string }> {
  const env = getServerEnv();
  const startedAtMonotonicMs = deps.requestStartedAtMonotonicMs ?? performance.now();
  const functionTotalBudgetMs = deps.functionTotalBudgetMs ?? env.openRouter.functionTotalBudgetMs;
  const monotonicNow = deps.monotonicNow ?? (() => performance.now());
  const remainingMs = (): number =>
    Math.max(0, Math.trunc(startedAtMonotonicMs + functionTotalBudgetMs - monotonicNow()));
  // ログ duration は handler 相対の経過時間
  const started = startedAtMonotonicMs;
  const requestIdForLog = randomUUID();
  let openRouterCalls = 0;

  let entitlement;
  try {
    entitlement = await loadEntitlement(deps.user.userId);
  } catch (error: unknown) {
    if (error instanceof BillingEntitlementUnavailableError || error instanceof HttpError) {
      throw entitlementUnavailableHttpError();
    }
    throw entitlementUnavailableHttpError();
  }

  const admin = getSupabaseAdmin();
  const plusAllowed =
    isFlyerPlusAllowed(entitlement, env.billingEnabled) &&
    applyQuotaPlan(entitlement, env.billingEnabled) === "plus";

  // PE2: 新規 reserve は従来どおり 403。既 terminal succeeded の同一キーだけ
  // Plus / kill switch 短絡の前に台帳 hit を見て、現行 safety 再 assert のうえ再生する。
  // PE-R2: UI 失効面の画像なし再 POST はサーバがまだ Plus でも空バイト検証へ落とさない。
  // 空画像は新規生成できないので、Plus 中でも lookup 再生だけ先に見る。
  const imageMissing = imageBytes.byteLength === 0;
  if (!plusAllowed || imageMissing) {
    const lookupFlyer =
      deps.lookupFlyerWeekly ??
      (async (input: { userId: string; idempotencyKey: string }) =>
        defaultLookupFlyerWeekly(admin, input.userId, input.idempotencyKey));
    const lookupRaw = await lookupFlyer({
      userId: deps.user.userId,
      idempotencyKey,
    });
    if (!flyerLookupMissSchema.safeParse(lookupRaw).success) {
      const lookedUp = reservePayloadSchema.safeParse(lookupRaw);
      if (!lookedUp.success) {
        throw new HttpError(500, "internal_error", issueMessages.internal_error);
      }
      if (lookedUp.data.status === "succeeded") {
        return replaySucceededFlyerMenu(admin, deps.user.userId, lookedUp.data, requestIdForLog);
      }
    }
    if (!plusAllowed) {
      safeLog({
        level: "info",
        requestId: requestIdForLog,
        code: "flyer_requires_plus",
        durationMs: performance.now() - started,
        flyer: true,
        plan: "free",
      });
      throw new HttpError(403, "flyer_requires_plus", flyerWeeklyIssueMessages.flyer_requires_plus);
    }
    // Plus だが画像が空で succeeded 再生できない。reserve / OpenRouter には進まない。
    mapFailureHttp("flyer_invalid_image");
  }

  // PRIV-1: Plus でも未同意なら AI 送信しない（生成・再生成と同型）。OpenRouter 0 回。
  const assertConsent = deps.assertPrivacyConsent ?? assertFlyerPrivacyConsent;
  await assertConsent(deps.user);

  // 画像は reserve 前に検証（失敗で try を焼かない）
  let prepared;
  try {
    prepared = await prepareFlyerImage(imageBytes);
  } catch (error: unknown) {
    if (error instanceof FlyerImageError) {
      mapFailureHttp(error.code);
    }
    mapFailureHttp("flyer_invalid_image");
  }

  const limits = limitsForPlan("plus");
  const identityKey = computeQuotaIdentityKey(env.quotaIdentityHmacKey, deps.user.email);

  const { data: reserveRaw, error: reserveError } = await rpcUntyped(
    admin,
    "reserve_flyer_weekly",
    {
      p_user_id: deps.user.userId,
      p_identity_key: identityKey,
      p_idempotency_key: idempotencyKey,
      p_attempt_limit: limits.attemptsPerDay,
      p_short_window_limit: limits.shortWindowLimit,
      p_global_limit: env.openRouter.globalDailyLimit,
      p_quota_disabled: env.aiQuotaDisabled,
    },
  );
  if (reserveError !== null) {
    throw new HttpError(500, "internal_error", issueMessages.internal_error);
  }

  const reserve = reservePayloadSchema.parse(reserveRaw);
  if (reserve.status === "failed") {
    const code = reserve.failure_code ?? "internal_error";
    if (code === "flyer_weekly_limit") {
      // A11: OpenRouter 0 回
      safeLog({
        level: "info",
        requestId: requestIdForLog,
        code: "flyer_weekly_limit",
        durationMs: performance.now() - started,
        flyer: true,
        plan: "plus",
      });
    }
    mapFailureHttp(code, reserve.retry_at ?? null);
  }

  // PE13: succeeded は result 有無に関わらず mark パイプラインへ落とさない。
  // result null / Zod 非適合は fail-closed（壊れた成功行に再入場して 500 ループしない）。
  // 4xx internal_error でクライアント sticky を clear（PE1 隣接: 同一 key 束縛を断つ）。
  // 健全な result は現行 safety を再 assert（terminal 非破壊・拒否のみ）。
  if (reserve.status === "succeeded") {
    return replaySucceededFlyerMenu(admin, deps.user.userId, reserve, requestIdForLog);
  }

  // PE1: 同一 key の processing 冪等 hit（replayed）は OpenRouter に再入場しない。
  // PE11: 検証済み result が残っていれば finalize だけ再試行する（processing 409 のまま
  // 再入場不可は PE6 回帰。finalize_failure は先着枠を解放するので呼ばない）。
  // result が無い replay は従来どおり in-progress。
  if (reserve.replayed === true) {
    const stashed = weeklyFlyerMenuSchema.safeParse(reserve.result);
    if (stashed.success && reserve.request_id != null) {
      const weekStart =
        typeof reserve.week_start === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(reserve.week_start)
          ? reserve.week_start
          : (stashed.data.weekStartJst ?? jstWeekStartMonday(new Date()));
      const resultMenu: WeeklyFlyerMenuResult = {
        ...stashed.data,
        weekStartJst: weekStart,
      };
      try {
        const inspectionSafety = await loadFlyerInspectionSafety(admin, deps.user.userId);
        assertFlyerMenuAgainstSafety(resultMenu, inspectionSafety);
        // PE3: stash 再試行も保証フレーズを通す（初回 persist と同じ針）
        assertFlyerMenuHasNoGuaranteePhrases(resultMenu);
      } catch (error: unknown) {
        // 一時的な検査障害は行を残し sticky を保つ。確定した safety 拒否だけ failure にする。
        if (error instanceof HttpError && error.code === "safety_context_failed") {
          throw error;
        }
        if (error instanceof HttpError) {
          await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
            p_request_id: reserve.request_id,
            p_failure_code: error.code,
            p_sent: true,
          });
          throw error;
        }
        throw error;
      }
      await commitFlyerWeeklySuccess(admin, reserve.request_id, resultMenu, started);
      return { menu: resultMenu, requestId: reserve.request_id };
    }
    mapFailureHttp("generation_in_progress", reserve.retry_at ?? null);
  }

  const requestId = reserve.request_id;
  if (requestId == null) {
    throw new HttpError(500, "internal_error", issueMessages.internal_error);
  }

  // PE5: mark 前ゲート（generation-service failBeforeSend と同型）。
  // model 欠落・timeout は try/attempt を焼かず p_sent:false で閉じる。
  if (remainingMs() < REQUIRED_SEND_BUDGET_MS) {
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: "generation_timeout",
      p_sent: false,
    });
    mapFailureHttp("generation_timeout");
  }

  const flyerModels =
    env.openRouter.flyerModels.length > 0 ? env.openRouter.flyerModels : env.openRouter.plusModels;
  if (flyerModels.length === 0) {
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: "model_unavailable",
      p_sent: false,
    });
    mapFailureHttp("model_unavailable");
  }

  const attemptTimeoutMs = Math.min(
    env.openRouter.timeoutMs,
    Math.max(0, remainingMs() - FINALIZE_RESERVE_MS),
  );
  if (attemptTimeoutMs <= 0) {
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: "generation_timeout",
      p_sent: false,
    });
    mapFailureHttp("generation_timeout");
  }

  // PE1: mark / OpenRouter 前に generation と同型の member 安全ゲートを閉じる。
  // complete 人数だけ見て unconfirmed / allergen_missing / diet を後回しにしない。
  // mark 後の再検査は現行 safety 優先のため残す。
  try {
    await loadFlyerInspectionSafety(admin, deps.user.userId);
  } catch (error: unknown) {
    const code = error instanceof HttpError ? error.code : "internal_error";
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: code,
      p_sent: false,
    });
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, "internal_error", issueMessages.internal_error);
  }

  // PE5: mark 前に Models 政策を閉じる（generation failBeforeSend と同型）。
  // Models API 障害で try を焼かない。vision 必須の新契約は発明しない。
  const ensureModelPolicy =
    deps.ensureOpenRouterModelPolicy ??
    (async ({ models }: { models: readonly string[] }) => {
      await ensureOpenRouterRuntimeModelPolicy({
        baseUrl: env.openRouter.baseUrl,
        models,
        apiKey: env.openRouter.apiKey,
      });
    });
  try {
    await ensureModelPolicy({ models: flyerModels });
  } catch (error: unknown) {
    if (error instanceof OpenRouterCallError && error.code === "model_unavailable") {
      await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
        p_request_id: requestId,
        p_failure_code: "model_unavailable",
        p_sent: false,
      });
      mapFailureHttp("model_unavailable");
    }
    throw error;
  }
  // ensure は Models API を食うことがあるため、成功後に送信予算を再ゲートする。
  if (remainingMs() < REQUIRED_SEND_BUDGET_MS) {
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: "generation_timeout",
      p_sent: false,
    });
    mapFailureHttp("generation_timeout");
  }

  // mark sent（short + try→sent + attempt/global）
  const { data: markRaw, error: markError } = await rpcUntyped(admin, "mark_flyer_weekly_sent", {
    p_request_id: requestId,
  });
  if (markError !== null) {
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: "internal_error",
      p_sent: false,
    });
    throw new HttpError(500, "internal_error", issueMessages.internal_error);
  }
  const mark = markPayloadSchema.parse(markRaw);
  if (!mark.sent) {
    const code = mark.code ?? mark.failure_code ?? "user_short_window_limit";
    mapFailureHttp(code, mark.retry_at ?? null);
  }

  const sender =
    deps.openRouterSender ??
    (async (messages, timeoutMs) => {
      const send = createOpenRouterGenerationSender({
        apiKey: env.openRouter.apiKey,
        baseUrl: env.openRouter.baseUrl,
        models: flyerModels,
        timeoutMs: env.openRouter.timeoutMs,
      });
      return send({ messages, timeoutMs, mode: "flyer_weekly" });
    });

  let aiResult: OpenRouterGenerationResult;
  try {
    openRouterCalls += 1;
    aiResult = await sender(buildFlyerMessages(prepared.dataUrl), attemptTimeoutMs);
  } catch (error: unknown) {
    const code = error instanceof OpenRouterCallError ? error.code : "model_unavailable";
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: code === "invalid_ai_response" ? "flyer_invalid_ai_response" : code,
      p_sent: true,
    });
    if (code === "invalid_ai_response") {
      mapFailureHttp("flyer_invalid_ai_response");
    }
    mapFailureHttp(code);
  }

  if (aiResult.mode !== "flyer_weekly") {
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: "flyer_invalid_ai_response",
      p_sent: true,
    });
    mapFailureHttp("flyer_invalid_ai_response");
  }

  const parsedMenu = weeklyFlyerMenuSchema.safeParse(aiResult.output);
  if (!parsedMenu.success) {
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: "flyer_invalid_ai_response",
      p_sent: true,
    });
    mapFailureHttp("flyer_invalid_ai_response");
  }

  // persist 前: 生成と同じ保証フレーズ針。ヒットは本文を残さず失敗。
  try {
    assertFlyerMenuHasNoGuaranteePhrases(parsedMenu.data);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
        p_request_id: requestId,
        p_failure_code: error.code,
        p_sent: true,
      });
      throw error;
    }
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: "flyer_invalid_ai_response",
      p_sent: true,
    });
    mapFailureHttp("flyer_invalid_ai_response");
  }

  // server current safety only（クライアント allergy は信頼しない）
  try {
    // 初回も replay と同型の loadFlyerInspectionSafety（complete + draft union）
    const inspectionSafety = await loadFlyerInspectionSafety(admin, deps.user.userId);
    // 辞書 alias + custom を foodTextContainsAlias（evaluateAllergens 同型）で検査
    assertFlyerMenuAgainstSafety(parsedMenu.data, inspectionSafety);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
        p_request_id: requestId,
        p_failure_code: error.code,
        p_sent: true,
      });
      throw error;
    }
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: "flyer_invalid_ai_response",
      p_sent: true,
    });
    mapFailureHttp("flyer_invalid_ai_response");
  }

  // reserve / model 欠落時も UTC 暦ではなく JST 月曜（usage-today と同アルゴリズム）
  const weekStart =
    typeof reserve.week_start === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(reserve.week_start)
      ? reserve.week_start
      : (parsedMenu.data.weekStartJst ?? jstWeekStartMonday(new Date()));

  const resultMenu: WeeklyFlyerMenuResult = {
    ...parsedMenu.data,
    weekStartJst: weekStart,
  };

  // PE11: finalize 失敗でも 200 すると reserved のまま cleanup が枠を空ける。
  // 本文は stash、HTTP は 500。同一キー再 POST が finalize を再試行する。
  await commitFlyerWeeklySuccess(admin, requestId, resultMenu, started);

  safeLog({
    level: "info",
    requestId,
    code: "flyer_weekly_succeeded",
    durationMs: performance.now() - started,
    flyer: true,
    plan: "plus",
    modelId: aiResult.modelId,
  });

  // openRouterCalls はテストから deps 経由で観測（A11 は limit 経路で 0）
  void openRouterCalls;
  void planQuota;

  return { menu: resultMenu, requestId };
}

/**
 * テスト用: reserve 後の early 分岐を本体と同順で模倣する。
 * PE1: processing + replayed は OpenRouter 0。
 * PE11: 検証済み result がある replay は finalize 再試行相当（OpenRouter 無し）。
 */
export async function runFlyerWeeklyWithReserveStub(options: {
  reserveResult: unknown;
  openRouterSender: (
    messages: readonly OpenRouterMessage[],
    timeoutMs: number,
  ) => Promise<OpenRouterGenerationResult>;
  plusEntitled: boolean;
  billingEnabled: boolean;
  /** 未指定は同意済み扱い。false で consent_required を再現する。 */
  hasPrivacyConsent?: boolean;
}): Promise<{ openRouterCalls: number; errorCode?: string }> {
  let openRouterCalls = 0;
  if (!options.billingEnabled || !options.plusEntitled) {
    // PE2: 新規は 403。既 terminal succeeded だけ台帳本文を再生する（OpenRouter 0）。
    const deniedReserve = reservePayloadSchema.safeParse(options.reserveResult);
    if (
      deniedReserve.success &&
      deniedReserve.data.status === "succeeded" &&
      deniedReserve.data.result != null &&
      weeklyFlyerMenuResultSchema.safeParse(deniedReserve.data.result).success
    ) {
      return { openRouterCalls: 0 };
    }
    return { openRouterCalls: 0, errorCode: "flyer_requires_plus" };
  }
  // PRIV-1: Plus でも未同意なら OpenRouter に触れない
  if (options.hasPrivacyConsent === false) {
    return { openRouterCalls: 0, errorCode: "consent_required" };
  }
  const reserve = reservePayloadSchema.parse(options.reserveResult);
  if (reserve.status === "failed") {
    return {
      openRouterCalls: 0,
      errorCode: reserve.failure_code ?? "internal_error",
    };
  }
  // PE13: succeeded は result 欠損・壊結果でも mark / OpenRouter に落とさない
  if (reserve.status === "succeeded") {
    if (reserve.result == null) {
      return { openRouterCalls: 0, errorCode: "internal_error" };
    }
    const parsed = weeklyFlyerMenuResultSchema.safeParse(reserve.result);
    if (!parsed.success) {
      return { openRouterCalls: 0, errorCode: "internal_error" };
    }
    return { openRouterCalls: 0 };
  }
  // PE1: 冪等 hit の processing は OpenRouter 再入場しない
  // PE11: stash 済み result は finalize 再試行相当（OpenRouter 0・エラーなし）
  if (reserve.replayed === true) {
    if (reserve.result != null && weeklyFlyerMenuSchema.safeParse(reserve.result).success) {
      return { openRouterCalls: 0 };
    }
    return { openRouterCalls: 0, errorCode: "generation_in_progress" };
  }
  openRouterCalls += 1;
  await options.openRouterSender([], 1000);
  return { openRouterCalls };
}
