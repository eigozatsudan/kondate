import type { Config } from "@netlify/functions";
import {
  deleteAccountRequestSchema,
  type DeleteAccountResult,
} from "../../shared/contracts/account.js";
import { requireUser } from "./_shared/auth.js";
import { handleError, HttpError, json, methodNotAllowed, parseJson } from "./_shared/http.js";
import { getSupabaseAdmin } from "./_shared/supabase-admin.js";

export type DeleteAccountDeps = {
  authenticate: typeof requireUser;
  /** processing 予約を identity/global から解放する（Auth 削除前） */
  releaseProcessingReservations: (userId: string) => Promise<{ error: { message: string } | null }>;
  /** 注入時は userId のみ。本番アダプタは Admin hard delete (shouldSoftDelete=false) を渡す。 */
  deleteUser: (userId: string) => Promise<{ error: { message: string } | null }>;
};

/**
 * 認証済み本人の Auth ユーザーを Admin API で hard delete する。
 * リクエスト body の user_id は契約外（無視）であり、削除対象は常に bearer の userId のみ。
 * Auth 削除前に processing 予約を解放し、identity reserved 孤児を防ぐ。
 */
export const createDeleteAccountHandler =
  (deps: DeleteAccountDeps) =>
  async (request: Request): Promise<Response> => {
    if (request.method !== "DELETE") return methodNotAllowed(["DELETE"]);
    try {
      const auth = await deps.authenticate(request);
      // 確認フレーズのみ検証。余分なキー（user_id 等）は Zod 既定で strip され削除対象に使わない。
      await parseJson(request, deleteAccountRequestSchema);
      const release = await deps.releaseProcessingReservations(auth.userId);
      if (release.error) {
        throw new HttpError(
          503,
          "account_delete_failed",
          "削除できませんでした。時間をおいてもう一度お試しください",
        );
      }
      const { error } = await deps.deleteUser(auth.userId);
      if (error) {
        throw new HttpError(
          503,
          "account_delete_failed",
          "削除できませんでした。時間をおいてもう一度お試しください",
        );
      }
      return json<DeleteAccountResult>(200, { ok: true, data: { deleted: true } });
    } catch (error) {
      return handleError(error);
    }
  };

const handler = createDeleteAccountHandler({
  authenticate: requireUser,
  releaseProcessingReservations: async (userId) => {
    const { error } = await getSupabaseAdmin().rpc(
      "release_identity_and_global_for_user_processing",
      { p_user_id: userId },
    );
    return { error: error === null ? null : { message: error.message } };
  },
  // false = hard delete（soft delete ではなく Auth ユーザーを完全削除）
  deleteUser: async (userId) => getSupabaseAdmin().auth.admin.deleteUser(userId, false),
});

export default handler;
export const config: Config = { path: "/api/account" };
