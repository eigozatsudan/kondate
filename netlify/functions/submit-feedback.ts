import type { Config } from "@netlify/functions";
import { z } from "zod";
import {
  FEEDBACK_DAILY_LIMIT,
  submitFeedbackRequestSchema,
  type SubmitFeedbackResult,
} from "../../shared/contracts/feedback.js";
import { requireUser } from "./_shared/auth.js";
import { handleError, HttpError, json, methodNotAllowed, parseJson } from "./_shared/http.js";
import { getSupabaseAdmin } from "./_shared/supabase-admin.js";

/**
 * 利用者あたり直近 24 時間の送信上限（連投・スパム抑止）。
 * 契約 FEEDBACK_DAILY_LIMIT を正とする（UI 事前説明と一致: AP9）。
 * AP11 residual-intentional: RPC は service_role 専用で p_user_id / p_limit を信頼する。
 * 通常 Function は auth.userId と本定数のみ渡す。browser 主 path は閉じている。
 */
const feedbackDailyLimit = FEEDBACK_DAILY_LIMIT;

const rateLimitedInsertResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), id: z.uuid() }),
  z.object({ ok: z.literal(false), code: z.literal("feedback_rate_limited") }),
]);

export type SubmitFeedbackDeps = {
  authenticate: typeof requireUser;
  /** 原子的な rate-limit + insert。RPC で advisory lock を取る。 */
  submitRateLimited: (input: {
    userId: string;
    category: string;
    body: string;
    clientPath: string | null;
  }) => Promise<{ id: string } | { rateLimited: true } | { error: string }>;
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

      const result = await deps.submitRateLimited({
        userId: auth.userId,
        category: payload.category,
        body: payload.body,
        clientPath: payload.clientPath ?? null,
      });
      if ("rateLimited" in result) {
        throw new HttpError(
          429,
          "feedback_rate_limited",
          "送信回数の上限に達しました。時間をおいてもう一度お試しください",
        );
      }
      if ("error" in result) {
        throw new HttpError(
          503,
          "feedback_save_failed",
          "送信できませんでした。時間をおいてもう一度お試しください",
        );
      }
      return json<SubmitFeedbackResult>(201, { ok: true, data: { id: result.id } });
    } catch (error) {
      return handleError(error);
    }
  };

const handler = createSubmitFeedbackHandler({
  authenticate: requireUser,
  submitRateLimited: async (input) => {
    const { data, error } = await getSupabaseAdmin().rpc("insert_user_feedback_rate_limited", {
      p_user_id: input.userId,
      p_category: input.category,
      p_body: input.body,
      p_client_path: input.clientPath,
      p_limit: feedbackDailyLimit,
    });
    if (error !== null || data === null) return { error: "insert_failed" };
    const payload = rateLimitedInsertResultSchema.safeParse(data);
    if (!payload.success) return { error: "insert_failed" };
    if (payload.data.ok) return { id: payload.data.id };
    return { rateLimited: true };
  },
});

export default handler;
export const config: Config = { path: "/api/feedback" };
