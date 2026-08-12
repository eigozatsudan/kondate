import { z } from "zod";
import { requireAccessToken } from "@/features/auth/session";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";

/**
 * ラベル確認 POST のクライアント abort 上限（ms）。
 * 生成 58s ほど長く待つ必要はなく、hung proxy で busy が永久化しないよう 30s（G15）。
 */
export const CONFIRM_LABEL_CLIENT_TIMEOUT_MS = 30_000;

const envelopeSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      data: z
        .object({
          confirmationId: z.uuid(),
          confirmationStatus: z.enum(["pending", "confirmed"]),
          confirmedAt: z.string().nullable(),
          confirmedBy: z.uuid().nullable(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: z
        .object({
          code: z.string(),
          message: z.string(),
        })
        .loose(),
    })
    .strict(),
]);

/** ブラウザは Supabase RPC を直接呼ばず、Netlify 境界だけを叩く。 */
export async function confirmLabelConfirmation(
  menuId: string,
  confirmationId: string,
  expectedSafetyFingerprint: string,
  deps: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<{
  confirmationId: string;
  confirmationStatus: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
}> {
  const accessToken = await requireAccessToken(getBrowserSupabaseClient());
  const timeoutMs = deps.timeoutMs ?? CONFIRM_LABEL_CLIENT_TIMEOUT_MS;
  // F-U07-3: path 断片を encode し、他 API と同型の境界にする
  const response = await (deps.fetchImpl ?? fetch)(
    `/api/menus/${encodeURIComponent(menuId)}/label-confirmations/${encodeURIComponent(confirmationId)}/confirm`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expectedSafetyFingerprint }),
      cache: "no-store",
      // G15: hung proxy で確認ボタン busy が解けないのを防ぐ
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  const envelope = envelopeSchema.parse(await response.json());
  if (!envelope.ok) {
    throw new Error(envelope.error.code);
  }
  return envelope.data;
}
