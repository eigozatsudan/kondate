import { z } from "zod";
import { requireAccessToken } from "@/features/auth/session";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";

const envelopeSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      data: z
        .object({
          confirmationId: z.string(),
          confirmationStatus: z.string(),
          confirmedAt: z.string().nullable(),
          confirmedBy: z.string().nullable(),
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
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<{
  confirmationId: string;
  confirmationStatus: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
}> {
  const accessToken = await requireAccessToken(getBrowserSupabaseClient());
  const response = await (deps.fetchImpl ?? fetch)(
    `/api/menus/${menuId}/label-confirmations/${confirmationId}/confirm`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expectedSafetyFingerprint }),
      cache: "no-store",
    },
  );
  const envelope = envelopeSchema.parse(await response.json());
  if (!envelope.ok) {
    throw new Error(envelope.error.code);
  }
  return envelope.data;
}
