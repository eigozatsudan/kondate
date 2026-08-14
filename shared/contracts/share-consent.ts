/**
 * 共有同意の現行版（TS 側 SSOT）。旧版は未同意扱い（互換パーサなし・本番リセット前提）。
 * privacyNoticeVersion とは別系統。生成 API の必須条件にはしない。
 *
 * AP20: SQL `private.share_current_consent_version()` は同一リテラルを dual-write する。
 * 版を上げるときは本定数と SQL 関数を同時改訂し、share-consent.test の cross-lock を通す。
 * スキーマ破壊なしの単一生成源は持たない（DB immutable SQL と TS 契約の境界）。
 */
export const shareConsentVersion = "2026-08-01.v1" as const;

/**
 * AP20: SQL 側 dual-write のリテラル。shareConsentVersion と常に一致させる。
 * テストが両定数の一致を拘束する（片側だけ bump を検知）。
 */
export const SHARE_CONSENT_VERSION_SQL_LITERAL = "2026-08-01.v1" as const;

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
