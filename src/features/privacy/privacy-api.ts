import { privacyNoticeVersion } from "@shared/contracts/domain";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import type { Tables, TablesInsert } from "@/shared/types/database.generated";

export type PrivacyConsentRow = Tables<"privacy_consents">;

export async function getCurrentPrivacyConsent(
  client: BrowserSupabaseClient,
  userId: string,
): Promise<PrivacyConsentRow | null> {
  const { data, error } = await client
    .from("privacy_consents")
    .select("*")
    .eq("user_id", userId)
    .eq("notice_version", privacyNoticeVersion)
    .maybeSingle();
  if (error !== null) throw new Error("AI情報の確認状態を読み込めませんでした");
  return data;
}

export async function acceptCurrentPrivacyConsent(
  client: BrowserSupabaseClient,
  userId: string,
): Promise<PrivacyConsentRow> {
  const input: TablesInsert<"privacy_consents"> = {
    user_id: userId,
    notice_version: privacyNoticeVersion,
    accepted_at: new Date().toISOString(),
  };
  const { data, error } = await client
    .from("privacy_consents")
    .upsert(input, { onConflict: "user_id,notice_version", ignoreDuplicates: false })
    .select("*")
    .single();
  if (error !== null) throw new Error("AI情報の確認を保存できませんでした");
  return data;
}

export function hasCurrentPrivacyConsent(row: PrivacyConsentRow | null): boolean {
  return row?.notice_version === privacyNoticeVersion;
}
