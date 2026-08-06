import { createHmac } from "node:crypto";

/**
 * 日次 identity 用のメール正規化。
 * NFKC → trim → lower。生メールは DB に保存しない。
 */
export function normalizeQuotaEmail(email: string): string {
  return email.normalize("NFKC").trim().toLowerCase();
}

/**
 * HMAC-SHA256(secret, utf8(normalize_email)) の小文字 hex 64 桁。
 * QUOTA_IDENTITY_HMAC_KEY は GENERATION_REQUEST_HMAC_KEY と共用しない。
 *
 * G7 residual-intentional: 日次 freemium 枠は identity_key 単位。同一 user_id で
 * メール変更すると別 identity 行になりカウンタがゼロ起点に見える（プライバシー/
 * multi-account 設計の副作用。user_id 一本化は契約変更）。
 */
export function computeQuotaIdentityKey(secret: Uint8Array, email: string): string {
  const normalized = normalizeQuotaEmail(email);
  return createHmac("sha256", secret).update(normalized, "utf8").digest("hex");
}
