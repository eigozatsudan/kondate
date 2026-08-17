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
// RPC setof 行を 200 応答前に検証する（未検査 cast 禁止）。余分な列は許容する。
// H5: confirmation_status は browser 契約と同型に enum 閉じ（未知 status は fail-closed 500）
const confirmationRowSchema = z.looseObject({
  id: z.uuid(),
  confirmation_status: z.enum(["pending", "confirmed"]),
  confirmed_at: z.iso.datetime({ offset: true }).nullable(),
  confirmed_by: z.uuid().nullable(),
});

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
  /**
   * G6: RPC が 0 行のとき、同一利用者の is_current かつ confirmed かつ
   * fingerprint 一致行を読む。存在非漏洩の 404 畳み込みは変えない。
   */
  lookupConfirmedReplay(
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
    lookupConfirmedReplay: async (accessToken, args) =>
      createUserScopedSupabase(accessToken)
        .from("menu_label_confirmations")
        .select("id, confirmation_status, confirmed_at, confirmed_by")
        .eq("id", args.p_confirmation_id)
        .eq("menu_id", args.p_menu_id)
        .eq("is_current", true)
        .eq("confirmation_status", "confirmed")
        .eq("requirement_safety_fingerprint", args.p_expected_safety_fingerprint)
        .maybeSingle(),
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
      let row: z.infer<typeof confirmationRowSchema>;
      if (rows.length === 0) {
        // G6: 成功済み同一 body の再 POST は存在漏洩にならない。RPC は pending だけ
        // UPDATE するため 0 行になるが、current+confirmed+fingerprint 一致なら 200 replay。
        const replay = await deps.lookupConfirmedReplay(user.accessToken, {
          p_menu_id: menuId.data,
          p_confirmation_id: confirmationId.data,
          p_expected_safety_fingerprint: body.expectedSafetyFingerprint,
        });
        if (replay.error !== null) {
          throw new HttpError(500, "confirmation_failed", "確認を保存できませんでした");
        }
        const replayParsed = confirmationRowSchema.safeParse(replay.data);
        if (!replayParsed.success || replayParsed.data.confirmation_status !== "confirmed") {
          // G9 residual-intentional: missing / foreign / wrong-menu / archived / stale
          // は存在非漏洩のためすべて confirmation_not_found 404。current_safety
          // 専用 code への細分化は写像拡大になるためしない。
          throw new HttpError(404, "confirmation_not_found", "確認対象が見つかりませんでした");
        }
        row = replayParsed.data;
      } else {
        const parsed = confirmationRowSchema.safeParse(rows[0]);
        if (!parsed.success) {
          throw new HttpError(500, "confirmation_failed", "確認を保存できませんでした");
        }
        row = parsed.data;
      }
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
