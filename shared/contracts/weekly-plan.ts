import { z } from "zod";
import { weeklyFlyerDaySchema } from "./flyer-weekly.js";
import { cuisineGenres } from "./domain.js";
import { budgetPreferences, noveltyPreferences, PLANNER_TARGET_MEMBER_LIMIT } from "./planner.js";
import { planQuota } from "./plan-quota.js";

/** household モードのみ。idea モード（人数指定）は持たない。 */
export const weeklyPlanRequestSchema = z
  .object({
    idempotencyKey: z.uuid(),
    targetMemberIds: z.array(z.uuid()).min(1).max(PLANNER_TARGET_MEMBER_LIMIT),
    cuisineGenre: z.enum(cuisineGenres),
    budgetPreference: z.enum(budgetPreferences).nullable(),
    noveltyPreference: z.enum(noveltyPreferences).nullable(),
  })
  .strict();
export type WeeklyPlanRequest = z.infer<typeof weeklyPlanRequestSchema>;

/** AI 出力 / finalize_flyer_weekly_success の p_result 形（weekStartJst + days のみ）。 */
const weeklyPlanAiObjectSchema = z
  .object({
    weekStartJst: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .optional(),
    days: z.array(weeklyFlyerDaySchema).length(7),
  })
  .strict();
export const weeklyPlanAiMenuSchema = weeklyPlanAiObjectSchema.superRefine((value, context) => {
  const indexes = value.days.map((d) => d.dayIndex).sort((a, b) => a - b);
  for (let i = 0; i < 7; i += 1) {
    if (indexes[i] !== i + 1) {
      context.addIssue({ code: "custom", path: ["days"], message: "dayIndex must be unique 1..7" });
      break;
    }
  }
});
export type WeeklyPlanAiMenu = z.infer<typeof weeklyPlanAiMenuSchema>;

/** 成功レスポンスに載せる確定形（weekStartJst 必須）。finalize/stash の p_result はこの形。 */
export const weeklyPlanAiMenuResultSchema = weeklyPlanAiObjectSchema
  .extend({ weekStartJst: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u) })
  .strict();
export type WeeklyPlanAiMenuResult = z.infer<typeof weeklyPlanAiMenuResultSchema>;

/** レスポンス（POST 成功 / GET）。safetyFingerprint はレスポンスに載せない。 */
export const weeklyPlanResultSchema = z
  .object({
    weeklyPlanId: z.uuid(),
    weekStartJst: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    days: z.array(weeklyFlyerDaySchema).length(7),
    targetMemberIds: z.array(z.uuid()),
    cuisineGenre: z.enum(cuisineGenres),
    /** true: snapshot の targetMemberIds 集合が現行 complete メンバー集合と一致しない */
    partialHousehold: z.boolean(),
    /** サーバ計算。保存時 fingerprint と現行対象メンバー条件の fingerprint が不一致 */
    staleSafety: z.boolean(),
  })
  .strict();
export type WeeklyPlanResult = z.infer<typeof weeklyPlanResultSchema>;

export const weeklyPlanIssueCodes = [
  "weekly_plan_requires_plus",
  "weekly_plan_weekly_limit",
  "weekly_plan_try_limit",
  "weekly_plan_unsatisfiable_member",
  "weekly_plan_invalid_ai_response",
  "weekly_plan_persist_failed",
] as const;
export type WeeklyPlanIssueCode = (typeof weeklyPlanIssueCodes)[number];

/** 日本語固定（spec §3「エラーコードと SQL 写像」）。 */
export const weeklyPlanIssueMessages = {
  weekly_plan_requires_plus: "今週の献立づくりは Plus の機能です。",
  weekly_plan_weekly_limit: "今週の週献立（チラシ献立と共通）の作成上限に達しています。",
  weekly_plan_try_limit: "しばらくしてから再度お試しください。",
  weekly_plan_unsatisfiable_member:
    "この家族向けの週献立は作れません。日ごとの献立作成をご利用ください。",
  weekly_plan_invalid_ai_response:
    "週献立を正しく確認できませんでした。作成の試行回数は使われている場合があります。",
  weekly_plan_persist_failed: "週献立を保存できませんでした。同じ条件でもう一度お試しください。",
} as const satisfies Record<WeeklyPlanIssueCode, string>;

/**
 * SQL / 内部コード → 週献立専用コードの写像。
 * ここに無いコードは既存 issueMessages（generation.ts）へフォールバックする。
 */
export const weeklyPlanFailureCodeMap = {
  flyer_weekly_limit: "weekly_plan_weekly_limit",
  flyer_weekly_try_limit: "weekly_plan_try_limit",
} as const satisfies Record<string, WeeklyPlanIssueCode>;

/**
 * 週献立 UI を出すか。FLYER_WEEKLY_UI_ENABLED とは独立の運用スイッチ。
 * このplanの実装が全Task完了した時点で true にする（Task 10/15/17がこの値を前提にしている。
 * false のまま出荷する場合は Task 10 Step 6 / Task 15 Step 6 / Task 17 のE2Eをすべて
 * 「フラグ待ち」に書き換える必要がある — 本plan はデフォルトで true 出荷を前提に書いている）。
 */
export const WEEKLY_PLAN_UI_ENABLED: boolean = true;

/** 契約テストが参照する残数コピーの固定断片。 */
export const WEEKLY_PLAN_QUOTA_COPY_LABEL = "今週の週献立（チラシ献立と共通）" as const;
void planQuota;
