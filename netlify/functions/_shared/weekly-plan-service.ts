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
    partialHousehold,
    staleSafety,
  });
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
  const inserted = await insertWeeklyPlanRow(
    admin,
    userId,
    reserve.request_id,
    weekStart,
    intent.data.preference_snapshot,
    intent.data.safety_fingerprint,
    resultMenu,
  );
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
  try {
    const inspectionSafety = await loadWeeklyPlanInspectionSafety(
      admin,
      userId,
      intent.data.preference_snapshot.targetMemberIds,
    );
    assertFlyerMenuAgainstSafety(resultMenu, inspectionSafety);
    assertFlyerMenuHasNoGuaranteePhrases(resultMenu);
    const currentFingerprint = createCurrentSafetyFingerprint(inspectionSafety);
    staleSafety = currentFingerprint !== intent.data.safety_fingerprint;
  } catch {
    staleSafety = true;
  }

  await commitWeeklyPlanFinalize(admin, requestId, resultMenu);
  const inserted = await insertWeeklyPlanRow(
    admin,
    userId,
    requestId,
    weekStart,
    intent.data.preference_snapshot,
    intent.data.safety_fingerprint,
    resultMenu,
  );
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
    p_idempotency_key: request.idempotencyKey,
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
      p_idempotency_key: request.idempotencyKey,
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
  try {
    assertFlyerMenuHasNoGuaranteePhrases(parsedMenu.data);
    const freshSafety = await loadWeeklyPlanInspectionSafety(
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

  // 手順11: finalize_flyer_weekly_success
  await commitWeeklyPlanFinalize(admin, requestId, resultMenu);

  // 手順12: weekly_plans へ insert
  const inserted = await insertWeeklyPlanRow(
    admin,
    deps.user.userId,
    requestId,
    weekStart,
    snapshot,
    preReserveFingerprint,
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
