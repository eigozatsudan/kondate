import { z } from "zod";

/** フィードバック種別。UI ラベルは表示層で日本語化する。 */
export const feedbackCategories = ["feature_request", "bug_report", "other"] as const;
export type FeedbackCategory = (typeof feedbackCategories)[number];

export const feedbackCategorySchema = z.enum(feedbackCategories);

/**
 * フィードバック送信リクエスト。
 * body は 10〜2000 文字。clientPath は任意の画面パス（PII を載せない前提）。
 */
export const submitFeedbackRequestSchema = z.object({
  category: feedbackCategorySchema,
  body: z
    .string()
    .trim()
    .min(10, "もう少し詳しく書いてください（10文字以上）")
    .max(2000, "2000文字以内で入力してください"),
  clientPath: z.string().trim().min(1).max(200).optional(),
});

export type SubmitFeedbackRequest = z.infer<typeof submitFeedbackRequestSchema>;

export type SubmitFeedbackResult = {
  id: string;
};
