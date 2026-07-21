import { z } from "zod";
import { usageTodayDataSchema, type UsageTodayData } from "@shared/contracts/generation";
import { requireAccessToken } from "@/features/auth/session";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";

const usageEnvelopeSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: usageTodayDataSchema }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: z
        .object({
          code: z.string(),
          message: z.string(),
          details: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
    })
    .strict(),
]);

/** ブラウザから当日利用状況だけを読む。生成行は作らない。 */
export async function getUsageToday(
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<UsageTodayData> {
  const accessToken = await requireAccessToken(getBrowserSupabaseClient());
  const response = await (deps.fetchImpl ?? fetch)("/api/usage/today", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });
  const envelope = usageEnvelopeSchema.parse(await response.json());
  if (!envelope.ok) {
    throw new Error(envelope.error.code);
  }
  return envelope.data;
}
