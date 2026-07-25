import type { Config } from "@netlify/functions";
import {
  submitFeedbackRequestSchema,
  type SubmitFeedbackResult,
} from "../../shared/contracts/feedback.js";
import { requireUser } from "./_shared/auth.js";
import { handleError, HttpError, json, methodNotAllowed, parseJson } from "./_shared/http.js";
import { getSupabaseAdmin } from "./_shared/supabase-admin.js";

/** 利用者あたり直近 24 時間の送信上限（連投・スパム抑止）。 */
const feedbackDailyLimit = 5;

export type SubmitFeedbackDeps = {
  authenticate: typeof requireUser;
  insertFeedback: (input: {
    userId: string;
    category: string;
    body: string;
    clientPath: string | null;
  }) => Promise<{ id: string } | { error: string }>;
  countRecentFeedback: (userId: string, sinceIso: string) => Promise<number>;
};

/**
 * 認証済み利用者のフィードバックを保存する。
 * 本文・clientPath はログに出さない（free-form / 画面パスの取り扱い）。
 */
export const createSubmitFeedbackHandler =
  (deps: SubmitFeedbackDeps) =>
  async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    try {
      const auth = await deps.authenticate(request);
      const payload = await parseJson(request, submitFeedbackRequestSchema);

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const recentCount = await deps.countRecentFeedback(auth.userId, since);
      if (recentCount >= feedbackDailyLimit) {
        throw new HttpError(
          429,
          "feedback_rate_limited",
          "送信回数の上限に達しました。時間をおいてもう一度お試しください",
        );
      }

      const inserted = await deps.insertFeedback({
        userId: auth.userId,
        category: payload.category,
        body: payload.body,
        clientPath: payload.clientPath ?? null,
      });
      if ("error" in inserted) {
        throw new HttpError(
          503,
          "feedback_save_failed",
          "送信できませんでした。時間をおいてもう一度お試しください",
        );
      }
      return json<SubmitFeedbackResult>(201, { ok: true, data: { id: inserted.id } });
    } catch (error) {
      return handleError(error);
    }
  };

const handler = createSubmitFeedbackHandler({
  authenticate: requireUser,
  countRecentFeedback: async (userId, sinceIso) => {
    const { count, error } = await getSupabaseAdmin()
      .from("user_feedback")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", sinceIso);
    if (error !== null) {
      throw new HttpError(
        503,
        "feedback_save_failed",
        "送信できませんでした。時間をおいてもう一度お試しください",
      );
    }
    return count ?? 0;
  },
  insertFeedback: async (input) => {
    const { data, error } = await getSupabaseAdmin()
      .from("user_feedback")
      .insert({
        user_id: input.userId,
        category: input.category,
        body: input.body,
        client_path: input.clientPath,
      })
      .select("id")
      .single();
    if (error !== null || data === null) return { error: "insert_failed" };
    return { id: data.id };
  },
});

export default handler;
export const config: Config = { path: "/api/feedback" };
