/**
 * 今週の献立サービス。チラシ週次の予約/確定 SQL（reserve/mark/finalize/stash/lookup）と
 * 週次枠をそのまま共有する。flyer-weekly-service.ts は変更しない（export を読むだけ）。
 */
import { z } from "zod";
import {
  weeklyPlanAiMenuSchema,
  weeklyPlanFailureCodeMap,
  weeklyPlanIssueMessages,
  weeklyPlanResultSchema,
  type WeeklyPlanAiMenuResult,
  type WeeklyPlanRequest,
  type WeeklyPlanResult,
} from "../../../shared/contracts/weekly-plan.js";
import { issueMessages } from "../../../shared/contracts/generation.js";
import {
  FINALIZE_RESERVE_MS,
  OPENROUTER_TIMEOUT_MS,
} from "../../../shared/contracts/function-budget.js";
import { createCurrentSafetyFingerprint } from "../../../shared/safety/fingerprint.js";
import type { CurrentSafetyContext } from "../../../shared/safety/context.js";
import {
  applyQuotaPlan,
  BillingEntitlementUnavailableError,
  limitsForPlan,
  loadEntitlement,
} from "./billing-entitlement.js";
import { loadCurrentSafetyContext } from "./current-safety.js";
import { getServerEnv } from "./env.js";
import {
  assertFlyerMenuAgainstSafety,
  assertFlyerMenuHasNoGuaranteePhrases,
  assertFlyerPrivacyConsent,
  isFlyerPlusAllowed,
  jstWeekStartMonday,
  type FlyerWeeklyAuthUser,
} from "./flyer-weekly-service.js";
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
import { buildWeeklyPlanMessages } from "./weekly-plan-prompt.js";

export type WeeklyPlanAuthUser = FlyerWeeklyAuthUser;

/** typegen 前の新 RPC 呼び出し。flyer-weekly-service.ts の private ヘルパーと同じ形を複製する。 */
async function rpcUntyped(
  admin: AdminSupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; error: { message?: string } | null }> {
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

const WEEKLY_PLAN_IDEMPOTENCY_KEY_PREFIX = "wp:";

/**
 * private.flyer_weekly_requests の (user_id, idempotency_key) はチラシと週献立で
 * 機能識別子なしに共有されている。クライアント指定の同一キーを両エンドポイントへ
 * うっかり使い回すと片方の台帳行をもう片方が操作できてしまうため、週献立側だけ
 * 内部的にプレフィックスを付けて名前空間を分離する（RPC 自体のシグネチャは変えない）。
 * クライアントの idempotencyKey は z.uuid()＝36 文字固定で、接頭辞 3 文字を足しても
 * 39 文字であり SQL 側の char_length 1..128 制約に収まる。
 */
function namespacedIdempotencyKey(idempotencyKey: string): string {
  return `${WEEKLY_PLAN_IDEMPOTENCY_KEY_PREFIX}${idempotencyKey}`;
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
});

const markPayloadSchema = z.looseObject({
  sent: z.boolean(),
  code: z.string().optional(),
  failure_code: z.string().nullable().optional(),
  retry_at: z.string().nullable().optional(),
});

const flyerLookupMissSchema = z.object({ kind: z.literal("miss") }).strict();

const weeklyPlanRowSchema = z.object({
  id: z.uuid(),
  week_start: z.string(),
  preference_snapshot: z.object({
    targetMemberIds: z.array(z.uuid()),
    cuisineGenre: z.string(),
    budgetPreference: z.string().nullable(),
    noveltyPreference: z.string().nullable(),
  }),
  safety_fingerprint: z.string(),
  days: z.array(z.unknown()),
});

const intentRowSchema = z.object({
  preference_snapshot: z.object({
    targetMemberIds: z.array(z.uuid()),
    cuisineGenre: z.string(),
    budgetPreference: z.string().nullable(),
    noveltyPreference: z.string().nullable(),
  }),
  safety_fingerprint: z.string(),
});

/** mark 前に必要な最小残り予算。flyer-weekly-service.ts と同じ式。 */
const REQUIRED_SEND_BUDGET_MS = OPENROUTER_TIMEOUT_MS + FINALIZE_RESERVE_MS;

function inspectionUnavailable(): HttpError {
  return new HttpError(500, "safety_context_failed", "現在の安全条件を読み込めませんでした");
}

/**
 * spec §5「対象メンバー基準と reserve 前 422 集合」。
 * flyer の loadFlyerInspectionSafety と異なり、対象は「フォームで選んだ」明示的な member id 集合。
 */
export async function loadWeeklyPlanInspectionSafety(
  admin: AdminSupabaseClient,
  userId: string,
  targetMemberIds: readonly string[],
): Promise<CurrentSafetyContext> {
  const { data: memberRows, error: memberError } = await admin
    .from("household_members")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "complete")
    .in("id", targetMemberIds);
  if (memberError !== null) throw inspectionUnavailable();
  const completeIds = new Set(
    (Array.isArray(memberRows) ? memberRows : []).map((row: { id: string }) => row.id),
  );
  if (targetMemberIds.some((id) => !completeIds.has(id))) {
    throw new HttpError(
      422,
      "current_target_member_required",
      issueMessages.current_target_member_required,
    );
  }
  const safety = await loadCurrentSafetyContext(admin, userId, targetMemberIds);
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
    // Minor（既存 generation-context.ts の loadGenerationContext と同じ AGS-I2 判定を移植）:
    // 評価可能なカスタムアレルギー文字列が無いのに hasUnmappedCustomAllergy が立っている場合、
    // AI へ安全条件を伝えられないため reserve 前に止める。
    if (
      member.hasUnmappedCustomAllergy &&
      member.customAllergies.every(
        (entry) => entry.name.trim() === "" && entry.aliases.every((alias) => alias.trim() === ""),
      )
    ) {
      throw new HttpError(422, "unmapped_custom_allergy", issueMessages.unmapped_custom_allergy);
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
    if (member.requiredSafetyConstraints.includes("cut_small")) {
      throw new HttpError(
        422,
        "weekly_plan_unsatisfiable_member",
        weeklyPlanIssueMessages.weekly_plan_unsatisfiable_member,
      );
    }
    const hasUnsatisfiableAgeTag = safety.foodSafetyRules.some(
      (rule) => rule.ruleKind === "requires_tag" && rule.appliesToAgeBands.includes(member.ageBand),
    );
    if (hasUnsatisfiableAgeTag) {
      throw new HttpError(
        422,
        "weekly_plan_unsatisfiable_member",
        weeklyPlanIssueMessages.weekly_plan_unsatisfiable_member,
      );
    }
  }
  return safety;
}

function mapWeeklyPlanFailureHttp(code: string, retryAt: string | null = null): never {
  const mapKey = code as keyof typeof weeklyPlanFailureCodeMap;
  const finalCode: string =
    mapKey in weeklyPlanFailureCodeMap ? weeklyPlanFailureCodeMap[mapKey] : code;
  const wpKey = finalCode as keyof typeof weeklyPlanIssueMessages;
  const genKey = finalCode as keyof typeof issueMessages;
  const wpMsg = wpKey in weeklyPlanIssueMessages ? weeklyPlanIssueMessages[wpKey] : undefined;
  const genMsg = genKey in issueMessages ? issueMessages[genKey] : undefined;
  const message = wpMsg ?? genMsg ?? "週献立を作成できませんでした。";
  const status =
    finalCode === "weekly_plan_requires_plus"
      ? 403
      : finalCode === "generation_in_progress"
        ? 409
        : finalCode === "weekly_plan_weekly_limit" ||
            finalCode === "weekly_plan_try_limit" ||
            finalCode === "user_attempt_limit" ||
            finalCode === "user_short_window_limit" ||
            finalCode === "global_daily_limit"
          ? 429
          : finalCode === "model_unavailable" || finalCode === "generation_timeout"
            ? 503
            : finalCode === "safety_context_failed"
              ? 500
              : finalCode === "allergy_unconfirmed" ||
                  finalCode === "allergen_missing" ||
                  finalCode === "unsupported_diet_unconfirmed" ||
                  finalCode === "unsupported_diet" ||
                  finalCode === "current_target_member_required" ||
                  finalCode === "weekly_plan_unsatisfiable_member" ||
                  finalCode === "consent_required"
                ? 422
                : 400;
  throw new HttpError(status, finalCode, message, retryAt ? { retryAt } : undefined);
}

/**
 * テスト用: reserve 後の early 分岐を本体と同順で模倣する（flyer の
 * runFlyerWeeklyWithReserveStub と同型）。
 */
export async function runWeeklyPlanWithReserveStub(options: {
  reserveResult: unknown;
  openRouterSender: (
    messages: readonly OpenRouterMessage[],
    timeoutMs: number,
  ) => Promise<OpenRouterGenerationResult>;
  plusEntitled: boolean;
  billingEnabled: boolean;
}): Promise<{ openRouterCalls: number; errorCode?: string }> {
  if (!options.billingEnabled || !options.plusEntitled) {
    const denied = reservePayloadSchema.safeParse(options.reserveResult);
    if (
      denied.success &&
      denied.data.status === "succeeded" &&
      denied.data.result != null &&
      weeklyPlanAiMenuSchema.safeParse(denied.data.result).success
    ) {
      return { openRouterCalls: 0 };
    }
    return { openRouterCalls: 0, errorCode: "weekly_plan_requires_plus" };
  }
  const reserve = reservePayloadSchema.parse(options.reserveResult);
  if (reserve.status === "failed") {
    return { openRouterCalls: 0, errorCode: reserve.failure_code ?? "internal_error" };
  }
  if (reserve.status === "succeeded") {
    return { openRouterCalls: 0 };
  }
  if (reserve.replayed === true) {
    if (reserve.result != null && weeklyPlanAiMenuSchema.safeParse(reserve.result).success) {
      return { openRouterCalls: 0 };
    }
    return { openRouterCalls: 0, errorCode: "generation_in_progress" };
  }
  await options.openRouterSender([], 1000);
  return { openRouterCalls: 1 };
}

export type WeeklyPlanDeps = {
  user: WeeklyPlanAuthUser;
  openRouterSender?: (
    messages: readonly OpenRouterMessage[],
    timeoutMs: number,
  ) => Promise<OpenRouterGenerationResult>;
  requestStartedAtMonotonicMs?: number;
  functionTotalBudgetMs?: number;
  monotonicNow?: () => number;
  assertPrivacyConsent?: (user: WeeklyPlanAuthUser) => Promise<void>;
  ensureOpenRouterModelPolicy?: (input: { models: readonly string[] }) => Promise<void>;
};

type WeeklyPlanSnapshot = {
  targetMemberIds: readonly string[];
  cuisineGenre: string;
  budgetPreference: string | null;
  noveltyPreference: string | null;
};

function snapshotFromRequest(request: WeeklyPlanRequest): WeeklyPlanSnapshot {
  return {
    targetMemberIds: [...request.targetMemberIds],
    cuisineGenre: request.cuisineGenre,
    budgetPreference: request.budgetPreference,
    noveltyPreference: request.noveltyPreference,
  };
}

/**
 * household_members 読取自体が失敗したときも「わからない」を partial 扱いにする
 * （false-negative で「対象は全員 complete」を偽って主張しない）。
 */
async function computePartialHousehold(
  admin: AdminSupabaseClient,
  userId: string,
  targetMemberIds: readonly string[],
): Promise<boolean> {
  const { data: completeRows, error: completeError } = await admin
    .from("household_members")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "complete");
  const completeIds = new Set(
    completeError !== null
      ? []
      : (Array.isArray(completeRows) ? completeRows : []).map((row: { id: string }) => row.id),
  );
  const snapshotIds = new Set(targetMemberIds);
  return (
    completeError !== null ||
    completeIds.size !== snapshotIds.size ||
    [...snapshotIds].some((id) => !completeIds.has(id))
  );
}

/**
 * R-07: 現行安全条件の読取失敗・対象メンバー欠損は本文を止めない。staleSafety: true に落とす。
 */
async function computeStaleSafetyAndPartial(
  admin: AdminSupabaseClient,
  userId: string,
  snapshot: WeeklyPlanSnapshot,
  storedFingerprint: string,
): Promise<{ staleSafety: boolean; partialHousehold: boolean }> {
  const partialHousehold = await computePartialHousehold(admin, userId, snapshot.targetMemberIds);
  try {
    const safety = await loadWeeklyPlanInspectionSafety(admin, userId, snapshot.targetMemberIds);
    const currentFingerprint = createCurrentSafetyFingerprint(safety);
    return { staleSafety: currentFingerprint !== storedFingerprint, partialHousehold };
  } catch {
    return { staleSafety: true, partialHousehold };
  }
}

async function buildResultFromRow(
  admin: AdminSupabaseClient,
  userId: string,
  row: z.infer<typeof weeklyPlanRowSchema>,
): Promise<WeeklyPlanResult> {
  const snapshot = row.preference_snapshot;
  const { staleSafety, partialHousehold } = await computeStaleSafetyAndPartial(
    admin,
    userId,
    snapshot,
    row.safety_fingerprint,
  );
  return weeklyPlanResultSchema.parse({
    weeklyPlanId: row.id,
    weekStartJst: row.week_start,
    days: row.days,
    targetMemberIds: snapshot.targetMemberIds,
    cuisineGenre: snapshot.cuisineGenre,
    budgetPreference: snapshot.budgetPreference,
    noveltyPreference: snapshot.noveltyPreference,
    partialHousehold,
    staleSafety,
  });
}

/**
 * P3修正C: weekly_plans.request_id の unique 制約により、同一キーの同時復元で
 * 片方の insert が一意制約違反になり得る（二重枠消費は finalize_flyer_weekly_success の
 * status='succeeded' 早期 return で既に閉じているので、insert の失敗は「もう片方が
 * 先に保存した」ことを示すだけ）。エラーコード（23505 等）には依存せず、insert 失敗を
 * 捕まえたら request_id で引き直し、見つかればそれを buildResultFromRow で返す。
 * 見つからなければ null を返し、呼び出し元が元のエラーを rethrow する。
 */
async function recoverExistingWeeklyPlanRow(
  admin: AdminSupabaseClient,
  userId: string,
  requestId: string,
): Promise<WeeklyPlanResult | null> {
  const { data: rowRaw, error: rowError } = await admin
    .from("weekly_plans")
    .select("id, week_start, preference_snapshot, safety_fingerprint, days")
    .eq("request_id", requestId)
    // M-1: request_id は unique なので実害はないが、userId を引数に取りながら
    // 述語に使わないのは誤解を招く。getWeeklyPlan の既存 select に合わせる。
    .eq("user_id", userId)
    .maybeSingle();
  if (rowError !== null || rowRaw === null) return null;
  const row = weeklyPlanRowSchema.safeParse(rowRaw);
  if (!row.success) return null;
  return buildResultFromRow(admin, userId, row.data);
}

/**
 * finalize_flyer_weekly_success を確定するまで 200 にしない。失敗時は stash して 500。
 * finalize_flyer_weekly_failure は呼ばない（reserved を解放すると成功枠を踏まず 200 を繰り返せる）。
 */
async function commitWeeklyPlanFinalize(
  admin: AdminSupabaseClient,
  requestId: string,
  resultMenu: WeeklyPlanAiMenuResult,
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
    code: "weekly_plan_finalize_success_failed",
    durationMs: 0,
    // 新しいログフィールドは足さない。共有台帳系イベントの既存フラグを流用する。
    flyer: true,
    plan: "plus",
  });
  throw new HttpError(500, "internal_error", issueMessages.internal_error);
}

/** insert 成功後に weekly_plans 行を組み立てて返す（intent 由来 / snapshot 由来で共通）。 */
async function insertWeeklyPlanRow(
  admin: AdminSupabaseClient,
  userId: string,
  requestId: string,
  weekStart: string,
  snapshot: WeeklyPlanSnapshot,
  fingerprint: string,
  menu: WeeklyPlanAiMenuResult,
): Promise<{ id: string }> {
  const { data, error } = await admin
    .from("weekly_plans")
    .insert({
      user_id: userId,
      week_start: weekStart,
      source: "household",
      request_id: requestId,
      // WeeklyPlanSnapshot.targetMemberIds は readonly string[] だが、生成型 Json は
      // 可変の Json[] を要求する（Task 2/3 typegen 後の型不整合）。値は変えず、境界だけ
      // 可変配列へ写す最小修正（プラン Step7 のコードは typegen 前提のため元コードのままでは
      // 型エラーになる）。
      preference_snapshot: {
        targetMemberIds: [...snapshot.targetMemberIds],
        cuisineGenre: snapshot.cuisineGenre,
        budgetPreference: snapshot.budgetPreference,
        noveltyPreference: snapshot.noveltyPreference,
      },
      safety_fingerprint: fingerprint,
      days: menu.days,
    })
    .select("id")
    .single();
  // insert().select().single() は discriminated union のため error===null なら
  // data は非 null が型で保証される（`|| data === null` は
  // @typescript-eslint/no-unnecessary-condition が指摘する到達不能分岐だったため外した）。
  if (error !== null) {
    throw new HttpError(
      500,
      "weekly_plan_persist_failed",
      weeklyPlanIssueMessages.weekly_plan_persist_failed,
    );
  }
  // Task 2 Step 5 の db:types 再生成後は weekly_plans の行型が付くため、
  // ここで unchecked cast をしない（Global Constraints: DB 境界で any / 未検証 cast 禁止）。
  return data;
}

/**
 * lookup / reserve の succeeded hit を再生する。weekly_plans 行があればそれを正とする
 * （intent は参照しない）。無ければ result + intent から復元して insert する。
 * いずれの経路も現行安全再 assert では本文を止めない（R-07）。
 */
async function replaySucceededWeeklyPlan(
  admin: AdminSupabaseClient,
  userId: string,
  reserve: z.infer<typeof reservePayloadSchema>,
): Promise<WeeklyPlanResult> {
  if (reserve.request_id === null) {
    throw new HttpError(500, "internal_error", issueMessages.internal_error);
  }
  const { data: rowRaw, error: rowError } = await admin
    .from("weekly_plans")
    .select("id, week_start, preference_snapshot, safety_fingerprint, days")
    .eq("request_id", reserve.request_id)
    .maybeSingle();
  if (rowError !== null) {
    throw new HttpError(503, "request_failed", "処理を完了できませんでした");
  }
  if (rowRaw !== null) {
    const row = weeklyPlanRowSchema.parse(rowRaw);
    return buildResultFromRow(admin, userId, row);
  }
  // 行なし: result + intent から復元して insert（当時の条件は intent が正。body は使わない）
  const parsedResult = weeklyPlanAiMenuSchema.safeParse(reserve.result);
  if (!parsedResult.success) {
    throw new HttpError(500, "internal_error", issueMessages.internal_error);
  }
  const { data: intentRaw, error: intentError } = await rpcUntyped(
    admin,
    "get_weekly_plan_intent",
    {
      p_request_id: reserve.request_id,
      p_user_id: userId,
    },
  );
  if (intentError !== null) {
    throw new HttpError(500, "internal_error", issueMessages.internal_error);
  }
  const intentRows = Array.isArray(intentRaw) ? intentRaw : [];
  const intent = intentRowSchema.safeParse(intentRows[0]);
  if (!intent.success) {
    throw new HttpError(500, "internal_error", issueMessages.internal_error);
  }
  const weekStart =
    typeof reserve.week_start === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(reserve.week_start)
      ? reserve.week_start
      : (parsedResult.data.weekStartJst ?? jstWeekStartMonday(new Date()));
  const resultMenu: WeeklyPlanAiMenuResult = { ...parsedResult.data, weekStartJst: weekStart };
  let inserted: { id: string };
  try {
    inserted = await insertWeeklyPlanRow(
      admin,
      userId,
      reserve.request_id,
      weekStart,
      intent.data.preference_snapshot,
      intent.data.safety_fingerprint,
      resultMenu,
    );
  } catch (error: unknown) {
    // P3修正C: 同時実行の勝者が既に保存した行があればそれを返す。
    // こちらは assert を持たない経路（R-07）なので、buildResultFromRow の指紋比較だけの
    // staleSafety 再計算で問題ない（I-1 は replayStashedWeeklyPlan 側のみ対象）。
    // MIN-4: この早期 return では delete_weekly_plan_intent を呼ばない。勝者側が
    // 既に削除しているはずで、取りこぼしても孤児 intent は run_kondate_maintenance の
    // 孤児回収が拾う（挙動は変えない、コメントのみ）。
    const recovered = await recoverExistingWeeklyPlanRow(admin, userId, reserve.request_id);
    if (recovered !== null) return recovered;
    throw error;
  }
  await rpcUntyped(admin, "delete_weekly_plan_intent", { p_request_id: reserve.request_id });
  const { staleSafety, partialHousehold } = await computeStaleSafetyAndPartial(
    admin,
    userId,
    intent.data.preference_snapshot,
    intent.data.safety_fingerprint,
  );
  return weeklyPlanResultSchema.parse({
    weeklyPlanId: inserted.id,
    weekStartJst: weekStart,
    days: resultMenu.days,
    targetMemberIds: intent.data.preference_snapshot.targetMemberIds,
    cuisineGenre: intent.data.preference_snapshot.cuisineGenre,
    budgetPreference: intent.data.preference_snapshot.budgetPreference,
    noveltyPreference: intent.data.preference_snapshot.noveltyPreference,
    partialHousehold,
    staleSafety,
  });
}

/**
 * N-I-10: processing + replayed + stash 済み result の finalize 再試行。
 * 現行安全再 assert に失敗しても finalize_flyer_weekly_failure は呼ばず、
 * finalize_flyer_weekly_success の確定を保ったまま insert → staleSafety: true で返す。
 */
async function replayStashedWeeklyPlan(
  admin: AdminSupabaseClient,
  userId: string,
  reserve: z.infer<typeof reservePayloadSchema>,
): Promise<WeeklyPlanResult> {
  if (reserve.request_id === null) {
    throw new HttpError(500, "internal_error", issueMessages.internal_error);
  }
  const requestId = reserve.request_id;
  const weekStart =
    typeof reserve.week_start === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(reserve.week_start)
      ? reserve.week_start
      : jstWeekStartMonday(new Date());
  const resultMenu: WeeklyPlanAiMenuResult = {
    ...(reserve.result as WeeklyPlanAiMenuResult),
    weekStartJst: weekStart,
  };

  const { data: intentRaw, error: intentError } = await rpcUntyped(
    admin,
    "get_weekly_plan_intent",
    {
      p_request_id: requestId,
      p_user_id: userId,
    },
  );
  if (intentError !== null) {
    throw new HttpError(500, "internal_error", issueMessages.internal_error);
  }
  const intentRows = Array.isArray(intentRaw) ? intentRaw : [];
  const intent = intentRowSchema.safeParse(intentRows[0]);
  if (!intent.success) {
    throw new HttpError(500, "internal_error", issueMessages.internal_error);
  }

  // 現行安全条件の再 assert。失敗しても本文は止めない（N-I-10）。
  let staleSafety = false;
  // I-2 / IMP-2: assert が成功したときは検査済み条件の指紋を保存し、staleSafety も false にする
  // （「保存する指紋＝その献立を実際に検査した条件」という不変条件を全経路で成立させる）。
  // 失敗時（null のまま）は従来どおり intent 指紋を使い staleSafety: true のまま
  // （N-I-10 の契約: 再 assert 失敗でも本文を止めず staleSafety: true で返すのは変えない）。
  // IMP-2 の根拠: 利用者が条件を元に戻したケースで、成功時も intent 指紋を保存し続ける案だと
  // 保存指紋と現行条件が一致してしまい GET が「変更なし」と誤って主張する。ここで false にすれば
  // 保存指紋（検査済み条件）と現行条件が食い違ったときだけ GET 側で正しく true に倒れる。
  let validatedFingerprint: string | null = null;
  try {
    const inspectionSafety = await loadWeeklyPlanInspectionSafety(
      admin,
      userId,
      intent.data.preference_snapshot.targetMemberIds,
    );
    assertFlyerMenuAgainstSafety(resultMenu, inspectionSafety);
    assertFlyerMenuHasNoGuaranteePhrases(resultMenu);
    validatedFingerprint = createCurrentSafetyFingerprint(inspectionSafety);
    staleSafety = false;
  } catch {
    staleSafety = true;
  }

  await commitWeeklyPlanFinalize(admin, requestId, resultMenu);
  const fingerprintToPersist = validatedFingerprint ?? intent.data.safety_fingerprint;
  let inserted: { id: string };
  try {
    inserted = await insertWeeklyPlanRow(
      admin,
      userId,
      requestId,
      weekStart,
      intent.data.preference_snapshot,
      fingerprintToPersist,
      resultMenu,
    );
  } catch (error: unknown) {
    // P3修正C: 同時実行の勝者が既に保存した行があればそれを返す。
    // I-1: buildResultFromRow は指紋比較だけで staleSafety を再計算するため、
    // ここで確定済みの再 assert 失敗（staleSafety: true）を OR で必ず残す
    // （assert 失敗と指紋不一致は同値ではなく、後者だけを見ると true → false に落ちうる）。
    // MIN-1: OR 合成後も本モジュールの他の return と同じく weeklyPlanResultSchema.parse を通す。
    // MIN-4: この早期 return では delete_weekly_plan_intent を呼ばない。勝者側が既に削除して
    // いるはずで、取りこぼしても孤児 intent は run_kondate_maintenance の孤児回収が拾う
    // （挙動は変えない、コメントのみ）。
    const recovered = await recoverExistingWeeklyPlanRow(admin, userId, requestId);
    if (recovered !== null) {
      return weeklyPlanResultSchema.parse({
        ...recovered,
        staleSafety: recovered.staleSafety || staleSafety,
      });
    }
    throw error;
  }
  await rpcUntyped(admin, "delete_weekly_plan_intent", { p_request_id: requestId });

  const partialHousehold = await computePartialHousehold(
    admin,
    userId,
    intent.data.preference_snapshot.targetMemberIds,
  );

  return weeklyPlanResultSchema.parse({
    weeklyPlanId: inserted.id,
    weekStartJst: weekStart,
    days: resultMenu.days,
    targetMemberIds: intent.data.preference_snapshot.targetMemberIds,
    cuisineGenre: intent.data.preference_snapshot.cuisineGenre,
    budgetPreference: intent.data.preference_snapshot.budgetPreference,
    noveltyPreference: intent.data.preference_snapshot.noveltyPreference,
    partialHousehold,
    staleSafety,
  });
}

export async function runWeeklyPlan(
  deps: WeeklyPlanDeps,
  request: WeeklyPlanRequest,
): Promise<WeeklyPlanResult> {
  const env = getServerEnv();
  const startedAtMonotonicMs = deps.requestStartedAtMonotonicMs ?? performance.now();
  const functionTotalBudgetMs = deps.functionTotalBudgetMs ?? env.openRouter.functionTotalBudgetMs;
  const monotonicNow = deps.monotonicNow ?? (() => performance.now());
  const remainingMs = (): number =>
    Math.max(0, Math.trunc(startedAtMonotonicMs + functionTotalBudgetMs - monotonicNow()));

  const admin = getSupabaseAdmin();

  // 手順1: entitlement 読取
  let entitlement;
  try {
    entitlement = await loadEntitlement(deps.user.userId);
  } catch (error: unknown) {
    if (error instanceof BillingEntitlementUnavailableError || error instanceof HttpError) {
      throw new HttpError(
        503,
        "billing_entitlement_unavailable",
        "プラン情報を確認できませんでした。しばらくしてからお試しください。",
      );
    }
    throw error;
  }
  const plusAllowed =
    isFlyerPlusAllowed(entitlement, env.billingEnabled) &&
    applyQuotaPlan(entitlement, env.billingEnabled) === "plus";

  // 手順2: lookup を Plus 判定より前に置く（PE2 と同型）
  const { data: lookupRaw, error: lookupError } = await rpcUntyped(admin, "lookup_flyer_weekly", {
    p_user_id: deps.user.userId,
    p_idempotency_key: namespacedIdempotencyKey(request.idempotencyKey),
  });
  if (lookupError !== null) {
    throw new HttpError(500, "internal_error", issueMessages.internal_error);
  }
  let lookedUpPayload: z.infer<typeof reservePayloadSchema> | undefined;
  if (!flyerLookupMissSchema.safeParse(lookupRaw).success) {
    const lookedUp = reservePayloadSchema.safeParse(lookupRaw);
    if (!lookedUp.success) {
      throw new HttpError(500, "internal_error", issueMessages.internal_error);
    }
    if (lookedUp.data.status === "succeeded") {
      return replaySucceededWeeklyPlan(admin, deps.user.userId, lookedUp.data);
    }
    lookedUpPayload = lookedUp.data;
  }

  // 手順3: Plus でなければ 403
  if (!plusAllowed) {
    mapWeeklyPlanFailureHttp("weekly_plan_requires_plus");
  }

  // 手順4: 現行 privacy notice への同意確認
  const assertConsent = deps.assertPrivacyConsent ?? assertFlyerPrivacyConsent;
  await assertConsent(deps.user);

  // P2修正2: finalize 失敗で stash された結果は、手順5（対象メンバー現在安全条件の
  // reserve 前 422 集合）より先に復旧する。手順5は reserve 前の新規生成向けゲートであり、
  // stash 復旧待ちのリクエストが対象メンバー変更（削除・未確認化）で 422 に落ちると、
  // reserve 後の stash 分岐（手順6 replayed 判定）へ二度と到達できなくなる
  // （N-I-10「保存済み結果は 200 + staleSafety: true で復旧する」契約に反する）。
  // status === "processing" && result が有効な weeklyPlanAiMenuSchema であることが
  // 「stash 済みで finalize 再試行待ち」の一意な識別（進行中の並行リクエストは result が null）。
  if (
    lookedUpPayload !== undefined &&
    lookedUpPayload.status === "processing" &&
    lookedUpPayload.result != null &&
    weeklyPlanAiMenuSchema.safeParse(lookedUpPayload.result).success
  ) {
    return replayStashedWeeklyPlan(admin, deps.user.userId, lookedUpPayload);
  }

  // 手順5: 対象メンバーの現在安全条件（reserve 前 422 集合）
  await loadWeeklyPlanInspectionSafety(admin, deps.user.userId, request.targetMemberIds);

  // 手順6: reserve_flyer_weekly（週次成功/試行、日次試行、短時間窓、全体枠）
  const limits = limitsForPlan("plus");
  const identityKey = computeQuotaIdentityKey(env.quotaIdentityHmacKey, deps.user.email);
  const { data: reserveRaw, error: reserveError } = await rpcUntyped(
    admin,
    "reserve_flyer_weekly",
    {
      p_user_id: deps.user.userId,
      p_identity_key: identityKey,
      p_idempotency_key: namespacedIdempotencyKey(request.idempotencyKey),
      p_attempt_limit: limits.attemptsPerDay,
      p_short_window_limit: limits.shortWindowLimit,
      p_global_limit: env.openRouter.globalDailyLimit,
      p_quota_disabled: env.aiQuotaDisabled,
      p_stale_after_seconds: env.openRouter.staleAfterSeconds,
    },
  );
  if (reserveError !== null) {
    throw new HttpError(500, "internal_error", issueMessages.internal_error);
  }
  const reserve = reservePayloadSchema.parse(reserveRaw);

  if (reserve.status === "failed") {
    mapWeeklyPlanFailureHttp(reserve.failure_code ?? "internal_error", reserve.retry_at ?? null);
  }
  if (reserve.status === "succeeded") {
    return replaySucceededWeeklyPlan(admin, deps.user.userId, reserve);
  }
  if (reserve.replayed === true) {
    if (reserve.result != null && weeklyPlanAiMenuSchema.safeParse(reserve.result).success) {
      return replayStashedWeeklyPlan(admin, deps.user.userId, reserve);
    }
    mapWeeklyPlanFailureHttp("generation_in_progress", reserve.retry_at ?? null);
  }

  const requestId = reserve.request_id;
  if (requestId === null) {
    throw new HttpError(500, "internal_error", issueMessages.internal_error);
  }

  // 手順6': 新規予約なら intent を書く
  const snapshot = snapshotFromRequest(request);
  // P2修正3: ここは reserve 成功後。try/catch なしで throw すると
  // finalize_flyer_weekly_failure を通らずに関数を抜け、予約が processing のまま
  // staleAfterSeconds まで残ってしまう（774-790行の mark 前ゲートと同一パターンを適用）。
  let preReserveSafety: CurrentSafetyContext;
  try {
    preReserveSafety = await loadWeeklyPlanInspectionSafety(
      admin,
      deps.user.userId,
      request.targetMemberIds,
    );
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
  const preReserveFingerprint = createCurrentSafetyFingerprint(preReserveSafety);
  const { error: putIntentError } = await rpcUntyped(admin, "put_weekly_plan_intent", {
    p_request_id: requestId,
    p_user_id: deps.user.userId,
    p_snapshot: snapshot,
    p_fingerprint: preReserveFingerprint,
  });
  if (putIntentError !== null) {
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: "internal_error",
      p_sent: false,
    });
    throw new HttpError(500, "internal_error", issueMessages.internal_error);
  }

  // 手順7: 予算ゲート 1
  if (remainingMs() < REQUIRED_SEND_BUDGET_MS) {
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: "generation_timeout",
      p_sent: false,
    });
    mapWeeklyPlanFailureHttp("generation_timeout");
  }

  // 手順8: モデル政策（plusModels のみ。flyerModels は使わない）
  if (env.openRouter.plusModels.length === 0) {
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: "model_unavailable",
      p_sent: false,
    });
    mapWeeklyPlanFailureHttp("model_unavailable");
  }
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
    await ensureModelPolicy({ models: env.openRouter.plusModels });
  } catch (error: unknown) {
    if (error instanceof OpenRouterCallError && error.code === "model_unavailable") {
      await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
        p_request_id: requestId,
        p_failure_code: "model_unavailable",
        p_sent: false,
      });
      mapWeeklyPlanFailureHttp("model_unavailable");
    }
    throw error;
  }
  if (remainingMs() < REQUIRED_SEND_BUDGET_MS) {
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: "generation_timeout",
      p_sent: false,
    });
    mapWeeklyPlanFailureHttp("generation_timeout");
  }

  // mark 前に現行 member 安全ゲートを再度閉じる（generation と同型）
  let markGateSafety: CurrentSafetyContext;
  try {
    markGateSafety = await loadWeeklyPlanInspectionSafety(
      admin,
      deps.user.userId,
      request.targetMemberIds,
    );
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
    mapWeeklyPlanFailureHttp(
      mark.code ?? mark.failure_code ?? "user_short_window_limit",
      mark.retry_at ?? null,
    );
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
    mapWeeklyPlanFailureHttp("generation_timeout");
  }

  // 手順9: OpenRouter 呼び出し（テキストのみ。既存 mode: "flyer_weekly" を再利用）
  const sender =
    deps.openRouterSender ??
    (async (messages, timeoutMs) => {
      const send = createOpenRouterGenerationSender({
        apiKey: env.openRouter.apiKey,
        baseUrl: env.openRouter.baseUrl,
        models: env.openRouter.plusModels,
        timeoutMs: env.openRouter.timeoutMs,
      });
      return send({ messages, timeoutMs, mode: "flyer_weekly" });
    });

  let aiResult: OpenRouterGenerationResult;
  try {
    aiResult = await sender(buildWeeklyPlanMessages(request, markGateSafety), attemptTimeoutMs);
  } catch (error: unknown) {
    const code = error instanceof OpenRouterCallError ? error.code : "model_unavailable";
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: code === "invalid_ai_response" ? "weekly_plan_invalid_ai_response" : code,
      p_sent: true,
    });
    mapWeeklyPlanFailureHttp(
      code === "invalid_ai_response" ? "weekly_plan_invalid_ai_response" : code,
    );
  }

  if (aiResult.mode !== "flyer_weekly") {
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: "weekly_plan_invalid_ai_response",
      p_sent: true,
    });
    mapWeeklyPlanFailureHttp("weekly_plan_invalid_ai_response");
  }

  // 手順10: Zod 検証 → 保証フレーズ検査 → 対象メンバー安全条件（新規生成のみ）
  const parsedMenu = weeklyPlanAiMenuSchema.safeParse(aiResult.output);
  if (!parsedMenu.success) {
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: "weekly_plan_invalid_ai_response",
      p_sent: true,
    });
    mapWeeklyPlanFailureHttp("weekly_plan_invalid_ai_response");
  }
  // P2修正A: 保存する safety_fingerprint は「実際に献立を検査した条件」（freshSafety）の
  // ものでなければならない。try の外へ持ち出し、catch の挙動・写像（WP-P-1）は変えない。
  let freshSafety: CurrentSafetyContext;
  try {
    assertFlyerMenuHasNoGuaranteePhrases(parsedMenu.data);
    freshSafety = await loadWeeklyPlanInspectionSafety(
      admin,
      deps.user.userId,
      request.targetMemberIds,
    );
    assertFlyerMenuAgainstSafety(parsedMenu.data, freshSafety);
  } catch {
    // WP-P-1: assertFlyerMenuHasNoGuaranteePhrases / assertFlyerMenuAgainstSafety は
    // flyer 側の固定コード "flyer_invalid_ai_response" を投げる。それをそのまま re-throw すると
    // クライアントは weekly_plan_invalid_ai_response しか sticky key を破棄しないため、
    // 同じキーで 400 が固定され作り直せなくなる（ブラウザ側は Task 12 参照）。
    // ここでは error の中身に関わらず常に weekly_plan_invalid_ai_response へ写す
    // （replayStashedWeeklyPlan の catch — N-I-10 — はこの写像をしない。別経路なので触らない）。
    await rpcUntyped(admin, "finalize_flyer_weekly_failure", {
      p_request_id: requestId,
      p_failure_code: "weekly_plan_invalid_ai_response",
      p_sent: true,
    });
    mapWeeklyPlanFailureHttp("weekly_plan_invalid_ai_response");
  }

  const weekStart =
    typeof reserve.week_start === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(reserve.week_start)
      ? reserve.week_start
      : (parsedMenu.data.weekStartJst ?? jstWeekStartMonday(new Date()));
  const resultMenu: WeeklyPlanAiMenuResult = { ...parsedMenu.data, weekStartJst: weekStart };

  // P2修正A: 保存する指紋は preReserveFingerprint（intent 用に既に put 済み）ではなく、
  // 実際に assertFlyerMenuAgainstSafety に使った freshSafety の指紋にする
  // （GET 経路の staleSafety 比較が「検査した条件」と一致している必要がある）。
  const validatedFingerprint = createCurrentSafetyFingerprint(freshSafety);

  // I-2: put_weekly_plan_intent は upsert（on conflict (request_id) do update,
  // supabase/migrations/20260903121000_weekly_plan_intents.sql:28-33）なので、
  // ここで intent の指紋を検査済み条件（validatedFingerprint）に更新しておく。
  // これをしないと、この直後の insert が一過性障害で失敗し
  // replaySucceededWeeklyPlan の「result + intent から復元」経路に回った場合、
  // 復元される行の safety_fingerprint が古い preReserveFingerprint のままになり、
  // 修正Aで直したはずの不一致が別経路で再発する。
  // IMP-1: この時点で mark_flyer_weekly_sent 済み・AI 応答取得済み・Zod 検証済み・
  // assertFlyerMenuAgainstSafety 通過済み、つまりもう返せる本文が確定している。
  // ここを失敗即 500（finalize_flyer_weekly_failure 呼び出し）にすると、簿記用 upsert の
  // 一過性失敗のために finalize_flyer_weekly_success も stash_flyer_weekly_result も呼ばれず
  // 本文が完全に失われ、しかも reserve_flyer_weekly は failed 行も replay するため
  // 同一 idempotencyKey が恒久的に 500 になり得た（誤り、前回の指示を撤回）。
  // 手順13の delete_weekly_plan_intent と同じ書き方で best-effort にする：
  // 失敗しても throw せず、finalize_flyer_weekly_failure も呼ばず、続行する。
  // IMP-A: 「安全側に落ちるだけ」という前回の断言は撤回する。この put が失敗すると intent は
  // 旧指紋（preReserveFingerprint）のまま残る。その後の手順12 insert が別要因で失敗し、
  // 同一キー再送で replaySucceededWeeklyPlan（result + intent から復元）に入った場合に限り、
  // その旧指紋が weekly_plans.safety_fingerprint にそのまま永続化されうる（検査した条件は
  // validatedFingerprint なのに、行には古い preReserveFingerprint が残る）。つまり必ず安全側に
  // 倒れるとは言えない残存窓がある。この窓自体は insert 失敗＋再送という複合条件が必要で
  // 発生頻度は低いと見て、失敗を握りつぶす判断（best-effort）は変えず、可観測にするに留める。
  const { error: refreshIntentError } = await rpcUntyped(admin, "put_weekly_plan_intent", {
    p_request_id: requestId,
    p_user_id: deps.user.userId,
    p_snapshot: snapshot,
    p_fingerprint: validatedFingerprint,
  });
  if (refreshIntentError !== null) {
    safeLog({
      level: "error",
      requestId,
      code: "weekly_plan_intent_refresh_failed",
      durationMs: 0,
      // 新しいログフィールドは足さない。共有台帳系イベントの既存フラグを流用する。
      flyer: true,
      plan: "plus",
    });
  }

  // 手順11: finalize_flyer_weekly_success
  await commitWeeklyPlanFinalize(admin, requestId, resultMenu);

  // 手順12: weekly_plans へ insert
  const inserted = await insertWeeklyPlanRow(
    admin,
    deps.user.userId,
    requestId,
    weekStart,
    snapshot,
    validatedFingerprint,
    resultMenu,
  );

  // 手順13: intent を best-effort で削除
  await rpcUntyped(admin, "delete_weekly_plan_intent", { p_request_id: requestId });

  const partialHousehold = await computePartialHousehold(
    admin,
    deps.user.userId,
    snapshot.targetMemberIds,
  );

  return weeklyPlanResultSchema.parse({
    weeklyPlanId: inserted.id,
    weekStartJst: weekStart,
    days: resultMenu.days,
    targetMemberIds: snapshot.targetMemberIds,
    cuisineGenre: snapshot.cuisineGenre,
    budgetPreference: snapshot.budgetPreference,
    noveltyPreference: snapshot.noveltyPreference,
    partialHousehold,
    staleSafety: false,
  });
}

/**
 * GET /api/weekly-plan/:id。所有者は JWT の userId のみ。再検査・AI呼び出しはしない。
 */
export async function getWeeklyPlan(
  admin: AdminSupabaseClient,
  userId: string,
  weeklyPlanId: string,
): Promise<WeeklyPlanResult> {
  const { data: rowRaw, error } = await admin
    .from("weekly_plans")
    .select("id, week_start, preference_snapshot, safety_fingerprint, days")
    .eq("id", weeklyPlanId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error !== null) {
    throw new HttpError(503, "request_failed", "処理を完了できませんでした");
  }
  if (rowRaw === null) {
    throw new HttpError(404, "not_found", "見つかりませんでした");
  }
  const row = weeklyPlanRowSchema.parse(rowRaw);
  return buildResultFromRow(admin, userId, row);
}
