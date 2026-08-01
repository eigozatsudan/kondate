/**
 * 共有一般化 job の status / skip / failure。
 * ログ・台帳は非PII の閉じた enum のみ（自由文禁止）。
 * consent_revoked は skip 側のみ（failure に入れない — revoke は失敗ではなく非掲載）。
 */

export const shareJobStatuses = ["pending", "running", "succeeded", "failed", "skipped"] as const;
export type ShareJobStatus = (typeof shareJobStatuses)[number];

/** 適格外・同意失効・日次成功上限など「失敗ではなくスキップ」 */
export const shareSkipReasons = [
  "not_emergency_duration",
  "pantry_bound",
  "consent_revoked",
  "ineligible_structure",
  /** publish 直前の user/app 日次 success 上限（pool INSERT 前に fail-closed） */
  "daily_success_cap",
] as const;
export type ShareSkipReason = (typeof shareSkipReasons)[number];

/** reaper / サーバー関門 / OpenRouter 等の端末失敗コード */
export const shareFailureCodes = [
  "lease_expired",
  "server_gate_failed",
  "openrouter_failed",
] as const;
export type ShareFailureCode = (typeof shareFailureCodes)[number];
