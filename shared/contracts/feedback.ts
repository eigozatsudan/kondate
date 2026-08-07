import { z } from "zod";

/** フィードバック種別。UI ラベルは表示層で日本語化する。 */
export const feedbackCategories = ["feature_request", "bug_report", "other"] as const;
export type FeedbackCategory = (typeof feedbackCategories)[number];

export const feedbackCategorySchema = z.enum(feedbackCategories);

/**
 * 利用者あたり直近窓の送信上限（submit-feedback Function と UI の単一ソース）。
 * AP9: 設定画面の事前説明と RPC p_limit を食い違わせない。
 */
export const FEEDBACK_DAILY_LIMIT = 5 as const;

/** 送信上限の集計窓（時間）。RPC 既定 86400s と一致。 */
export const FEEDBACK_RATE_WINDOW_HOURS = 24 as const;

/**
 * 画面パスとして許可する clientPath。
 * UI は pathname のみ送る。改変クライアントによる scheme / ホスト / 空白 / 誘導文字列を拒否する（AP4）。
 * ドットのみのセグメント（`.` / `..` / `....`）も拒否し運用閲覧ノイズを抑える（AP9）。
 * 例: /settings, /history/abc-123, /planner? は不可（query なし）。
 */
export const feedbackClientPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^\/(?:[A-Za-z0-9._~-]+\/?)*$/, "画面パスの形式が正しくありません")
  // AP9: 文字クラスに `.` が含まれるため `/a/../b` 等を regex だけでは弾けない
  .refine(
    (path) =>
      !path
        .split("/")
        .filter(Boolean)
        .some((segment) => /^\.+$/u.test(segment)),
    "画面パスの形式が正しくありません",
  );

/**
 * フィードバック送信リクエスト。
 * body は 10〜2000 文字。clientPath は相対 pathname のみ（PII・URL を載せない）。
 */
export const submitFeedbackRequestSchema = z.object({
  category: feedbackCategorySchema,
  body: z
    .string()
    .trim()
    .min(10, "もう少し詳しく書いてください（10文字以上）")
    .max(2000, "2000文字以内で入力してください"),
  clientPath: feedbackClientPathSchema.optional(),
});

export type SubmitFeedbackRequest = z.infer<typeof submitFeedbackRequestSchema>;

export type SubmitFeedbackResult = {
  id: string;
};

/** Function エラー code: SafeLog closedErrorCode と同形の snake_case（S9）。 */
const functionErrorCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/u);
/** 利用者向け message の天井。巨大プロキシ改変を構造拒否。 */
const functionErrorMessageSchema = z.string().min(1).max(500);

/** Function 応答 envelope。ネットワーク境界では safeParse で検証する。 */
export const feedbackEnvelopeSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.object({ id: z.string().min(1).max(80) }) }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: functionErrorCodeSchema, message: functionErrorMessageSchema }),
  }),
]);
export type FeedbackEnvelope = z.infer<typeof feedbackEnvelopeSchema>;
