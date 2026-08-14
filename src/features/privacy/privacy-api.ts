import { privacyNoticeVersion } from "@shared/contracts/domain";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import type { Tables, TablesInsert } from "@/shared/types/database.generated";

export type PrivacyConsentRow = Tables<"privacy_consents">;

/**
 * 現行 notice_version の同意行を読む。error 時は throw → RQ isError。
 * AP5: 呼び出し側は isError を未同意に潰さずエラー UI へ分岐すること。
 */
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

/**
 * 現行 notice_version の同意行を返すか INSERT する。
 * AP6 residual-intentional: ゲート権威は DB 行の有無。説明本文の読了証明・content hash は無い。
 * 改変クライアントの own-user insert はサーバ生成の consent SELECT でも通る（elevation ではない）。
 * AP4: INSERT はアプリも DB ポリシーも現行 privacyNoticeVersion のみ（未来版の先書きを閉じる）。
 */
export async function acceptCurrentPrivacyConsent(
  client: BrowserSupabaseClient,
  userId: string,
): Promise<PrivacyConsentRow> {
  const existing = await getCurrentPrivacyConsent(client, userId);
  if (existing !== null) return existing;
  const input: TablesInsert<"privacy_consents"> = {
    user_id: userId,
    notice_version: privacyNoticeVersion,
    accepted_at: new Date().toISOString(),
  };
  const { data, error } = await client.from("privacy_consents").insert(input).select("*").single();
  if (error?.code === "23505") {
    const accepted = await getCurrentPrivacyConsent(client, userId);
    if (accepted !== null) return accepted;
  }
  if (error !== null) throw new Error("AI情報の確認を保存できませんでした");
  return data;
}

export function hasCurrentPrivacyConsent(row: PrivacyConsentRow | null): boolean {
  return row?.notice_version === privacyNoticeVersion;
}
