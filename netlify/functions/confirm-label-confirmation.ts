import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { requireUser } from "./_shared/auth.js";
import { handleError, HttpError, json, methodNotAllowed, parseJson } from "./_shared/http.js";
import { createUserScopedSupabase } from "./_shared/supabase-user.js";

const uuidSchema = z.uuid();
const bodySchema = z
  .object({
    // DB 境界と同じ 1〜200 文字（trim 後の正準形）
    expectedSafetyFingerprint: z.string().min(1).max(200),
  })
  .strict();

export type ConfirmationDependencies = {
  requireUser: typeof requireUser;
  rpc(
    accessToken: string,
    args: {
      p_menu_id: string;
      p_confirmation_id: string;
      p_expected_safety_fingerprint: string;
    },
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
};

export function confirmLabelConfirmationHandler(
  createDeps: () => ConfirmationDependencies = () => ({
    requireUser,
    rpc: async (accessToken, args) =>
      createUserScopedSupabase(accessToken).rpc("confirm_menu_label_confirmation", args),
  }),
) {
  return async (request: Request, context: Context): Promise<Response> => {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    try {
      const deps = createDeps();
      // 最初に認証し、両方の context.params UUID を parse してから owner RPC を呼ぶ
      const user = await deps.requireUser(request);
      const menuId = uuidSchema.safeParse(context.params.menuId);
      const confirmationId = uuidSchema.safeParse(context.params.confirmationId);
      if (!menuId.success || !confirmationId.success) {
        throw new HttpError(400, "invalid_request", "入力内容を確認してください");
      }
      const body = await parseJson(request, bodySchema);
      const { data, error } = await deps.rpc(user.accessToken, {
        p_menu_id: menuId.data,
        p_confirmation_id: confirmationId.data,
        p_expected_safety_fingerprint: body.expectedSafetyFingerprint,
      });
      if (error !== null) {
        throw new HttpError(500, "confirmation_failed", "確認を保存できませんでした");
      }
      const rows = Array.isArray(data) ? data : [];
      if (rows.length === 0) {
        // missing / foreign / wrong-menu / archived / stale / replay は閉じた 404
        throw new HttpError(404, "confirmation_not_found", "確認対象が見つかりませんでした");
      }
      const row = rows[0] as {
        id: string;
        confirmation_status: string;
        confirmed_at: string | null;
        confirmed_by: string | null;
      };
      return json(200, {
        ok: true,
        data: {
          confirmationId: row.id,
          confirmationStatus: row.confirmation_status,
          confirmedAt: row.confirmed_at,
          confirmedBy: row.confirmed_by,
        },
      });
    } catch (error) {
      return handleError(error);
    }
  };
}

export default async function confirmLabelConfirmation(
  request: Request,
  context: Context,
): Promise<Response> {
  return confirmLabelConfirmationHandler()(request, context);
}

export const config: Config = {
  path: "/api/menus/:menuId/label-confirmations/:confirmationId/confirm",
  method: "POST",
};
