import { z } from "zod";
import { planQuota } from "./plan-quota.js";

/** チラシ週間献立の 1 日分（主菜中心・食材名で safety 検査可能） */
export const weeklyFlyerDaySchema = z
  .object({
    dayIndex: z.number().int().min(1).max(7),
    label: z.string().trim().min(1).max(20),
    mainName: z.string().trim().min(1).max(100),
    sideName: z.string().trim().min(1).max(100).nullable().optional(),
    ingredients: z.array(z.string().trim().min(1).max(100)).min(1).max(30),
    notes: z.string().trim().max(300).nullable().optional(),
  })
  .strict();

/**
 * OpenRouter vision の構造化出力。7 日分。
 * weekStartJst はサーバが付与してもよく、AI 出力では省略可。
 * JSON Schema 用に superRefine 無しの base を先に定義する。
 */
const weeklyFlyerMenuObjectSchema = z
  .object({
    weekStartJst: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .optional(),
    days: z.array(weeklyFlyerDaySchema).length(7),
  })
  .strict();

export const weeklyFlyerMenuSchema = weeklyFlyerMenuObjectSchema.superRefine((value, context) => {
  const indexes = value.days.map((d) => d.dayIndex).sort((a, b) => a - b);
  for (let i = 0; i < 7; i += 1) {
    if (indexes[i] !== i + 1) {
      context.addIssue({
        code: "custom",
        path: ["days"],
        message: "dayIndex must be unique 1..7",
      });
      break;
    }
  }
});

export type WeeklyFlyerDay = z.infer<typeof weeklyFlyerDaySchema>;
export type WeeklyFlyerMenu = z.infer<typeof weeklyFlyerMenuSchema>;

/** 成功レスポンスに載せる確定形（weekStartJst 必須） */
export const weeklyFlyerMenuResultSchema = weeklyFlyerMenuObjectSchema
  .extend({
    weekStartJst: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  })
  .strict();
export type WeeklyFlyerMenuResult = z.infer<typeof weeklyFlyerMenuResultSchema>;

export const flyerWeeklyIssueCodes = [
  "flyer_requires_plus",
  "flyer_weekly_limit",
  "flyer_weekly_try_limit",
  "flyer_invalid_image",
  "flyer_unsupported_media",
  "flyer_invalid_ai_response",
] as const;
export type FlyerWeeklyIssueCode = (typeof flyerWeeklyIssueCodes)[number];

/** 日本語固定（設計 Task7 表）。issueMessages からも参照する */
export const flyerWeeklyIssueMessages = {
  flyer_requires_plus: "チラシ写真から 1 週間の献立は Plus の機能です。",
  flyer_weekly_limit: "今週のチラシ献立の作成上限に達しています。",
  flyer_weekly_try_limit: "しばらくしてから再度お試しください。",
  flyer_invalid_image: "画像を読み取れませんでした。別の写真でお試しください。",
  flyer_unsupported_media: "対応している画像形式は JPEG / PNG / WebP です。",
  // PE11: mark 後失敗は try 非返却（generation と同型）。連発枯渇を平易に開示する。
  flyer_invalid_ai_response:
    "週間献立を正しく確認できませんでした。作成の試行回数は使われている場合があります。",
} as const satisfies Record<FlyerWeeklyIssueCode, string>;

/** Free locked preview 用の固定文言（L10-3） */
export const FLYER_LOCKED_PREVIEW_COPY = "チラシ写真から 1 週間の献立は Plus の機能です" as const;

/**
 * チラシ週間献立の UI 入口（プランナー枠・成功後 upsell）を出すか。
 * 有料プラン方針が固まるまで false。API・契約・コンポーネント実装は残し、表示だけ止める。
 */
export const FLYER_WEEKLY_UI_ENABLED: boolean = false;

/** usage-today の flyerWeekly 投影形（balance: consumed + remaining === limit） */
export const flyerWeeklyUsageSchema = z
  .object({
    successConsumed: z.number().int().min(0).max(planQuota.defense.maxFlyerSuccessPerWeek),
    successLimit: z.literal(planQuota.flyerWeekly.successPerJstWeek),
    successRemaining: z.number().int().min(0).max(planQuota.defense.maxFlyerSuccessPerWeek),
    triesConsumed: z.number().int().min(0).max(planQuota.defense.maxFlyerTriesPerWeek),
    triesLimit: z.literal(planQuota.flyerWeekly.triesPerJstWeek),
    triesRemaining: z.number().int().min(0).max(planQuota.defense.maxFlyerTriesPerWeek),
    weekStartJst: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  })
  .strict()
  .superRefine((data, context) => {
    if (data.successConsumed + data.successRemaining !== data.successLimit) {
      context.addIssue({
        code: "custom",
        path: ["successRemaining"],
        message: "flyer success counts must balance",
      });
    }
    if (data.triesConsumed + data.triesRemaining !== data.triesLimit) {
      context.addIssue({
        code: "custom",
        path: ["triesRemaining"],
        message: "flyer try counts must balance",
      });
    }
  });

export type FlyerWeeklyUsage = z.infer<typeof flyerWeeklyUsageSchema>;

/** AI structured_outputs 用 JSON Schema 断片（response_format） */
export const weeklyFlyerMenuResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "kondate_weekly_flyer_menu",
    strict: true,
    schema: z.toJSONSchema(weeklyFlyerMenuObjectSchema, {
      target: "draft-2020-12",
    }),
  },
} as const;
