import { z } from "zod";
import { isCurrentShareConsent, shareConsentVersion } from "@shared/contracts/share-consent";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";

/**
 * get_my_share_consent / upsert 応答の共通フィールド。
 * RPC は Json 戻りのため、ブラウザ側で Zod 検証してから使う。
 */
const shareConsentStateSchema = z
  .object({
    consent_version: z.string().nullable(),
    accepted_at: z.string().nullable(),
    revoked_at: z.string().nullable(),
  })
  .strict();

const upsertShareConsentResponseSchema = shareConsentStateSchema
  .extend({
    ok: z.literal(true),
  })
  .strict();

export type ShareConsentState = z.infer<typeof shareConsentStateSchema>;

/** 本人の現行共有同意行を読む（未同意時は null フィールド）。 */
export async function getMyShareConsent(client: BrowserSupabaseClient): Promise<ShareConsentState> {
  const { data, error } = await client.rpc("get_my_share_consent");
  if (error !== null) throw new Error("共有の同意状態を読み込めませんでした");
  const parsed = shareConsentStateSchema.safeParse(data);
  if (!parsed.success) throw new Error("共有の同意状態を読み込めませんでした");
  return parsed.data;
}

/**
 * 共有同意の on/off。version は常に現行 shareConsentVersion を送る。
 * accept=true で再同意、false で revoke（Task 5 トグルからも利用）。
 */
export async function upsertMyShareConsent(
  client: BrowserSupabaseClient,
  accept: boolean,
): Promise<ShareConsentState> {
  const { data, error } = await client.rpc("upsert_my_share_consent", {
    p_version: shareConsentVersion,
    p_accept: accept,
  });
  if (error !== null) throw new Error("共有の同意を保存できませんでした");
  const parsed = upsertShareConsentResponseSchema.safeParse(data);
  if (!parsed.success) throw new Error("共有の同意を保存できませんでした");
  return {
    consent_version: parsed.data.consent_version,
    accepted_at: parsed.data.accepted_at,
    revoked_at: parsed.data.revoked_at,
  };
}

/** 現行版かつ未 revoke なら true（契約 isCurrentShareConsent と同じ判定）。 */
export function hasCurrentShareConsent(state: ShareConsentState | null): boolean {
  if (state === null || state.consent_version === null) return false;
  return isCurrentShareConsent({
    consent_version: state.consent_version,
    revoked_at: state.revoked_at,
  });
}
