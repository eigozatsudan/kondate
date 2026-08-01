/**
 * 共有同意の現行版。旧版は未同意扱い（互換パーサなし・本番リセット前提）。
 * privacyNoticeVersion とは別系統。生成 API の必須条件にはしない。
 */
export const shareConsentVersion = "2026-08-01.v1" as const;

/**
 * 有効同意: 現行 version かつ revoked_at が null。
 * DB 行・RPC 応答の判定で同一定義を使う。
 */
export function isCurrentShareConsent(row: {
  consent_version: string;
  revoked_at: string | null;
}): boolean {
  return row.consent_version === shareConsentVersion && row.revoked_at === null;
}
