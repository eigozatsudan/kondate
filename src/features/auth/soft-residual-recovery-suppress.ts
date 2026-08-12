/**
 * C4/R3/R4: soft residual 後の residual recovery 抑止印と、意図的 login 再開時の re-arm。
 *
 * auth-flow と auth-cleanup の循環 import を避けるため、suppress の正本を本モジュールに置く。
 * - mark: soft residual 実行後（origin 共有 localStorage）
 * - clear: createAuthFlow 成功・session 適用・明示 clear。解除時に re-arm イベントを発火する（R4）
 * - is: AuthProvider residual effect のゲート（suppress 中は startRecovery しない = C4）
 *
 * R4: storage から印を消すだけでは residual useEffect が再評価されない（deps に suppress 無し）。
 * clear 時に window イベントで AuthProvider に通知し、unauthenticated /login 上で再武装する。
 * C4 は suppress 中の silent complete を閉じたまま — re-arm は clear 後だけ。
 */

export const SOFT_RESIDUAL_RECOVERY_SUPPRESS_KEY =
  "kondate.auth.soft-residual-recovery-suppress" as const;

/** R4: suppress 解除後に residual recovery を再評価させるタブ内イベント */
export const SOFT_RESIDUAL_RECOVERY_REARM_EVENT =
  "kondate.auth.soft-residual-recovery-rearm" as const;

/** C4: soft residual 実行後に origin 共有の residual recovery を抑止する */
export function markSoftResidualRecoverySuppressed(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SOFT_RESIDUAL_RECOVERY_SUPPRESS_KEY, "1");
  } catch {
    // storage 障害時は suppress 不能 — AuthProvider 側は best-effort
  }
}

/**
 * R4: AuthProvider residual effect に re-arm を要求する（タブ内）。
 * clear 経路から呼ぶ。リスナー未登録なら no-op。
 */
export function notifySoftResidualRecoveryRearm(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(SOFT_RESIDUAL_RECOVERY_REARM_EVENT));
  } catch {
    // best-effort（jsdom / 古い環境）
  }
}

/**
 * C4/R3: 新規 login 開始・認証成功時に suppress を解除する。
 * r2 時代の sessionStorage 残骸も一緒に落とす（同一タブ fail-closed の保険）。
 *
 * R4: 解除前に suppress が立っていたときだけ re-arm を通知する。
 * 無印 clear（テスト後始末等）で recovery を無駄に再起動しない。
 */
export function clearSoftResidualRecoverySuppressed(): void {
  const wasSuppressed = isSoftResidualRecoverySuppressed();
  for (const storage of [
    typeof localStorage !== "undefined" ? localStorage : null,
    typeof sessionStorage !== "undefined" ? sessionStorage : null,
  ]) {
    if (storage === null) continue;
    try {
      storage.removeItem(SOFT_RESIDUAL_RECOVERY_SUPPRESS_KEY);
    } catch {
      // best-effort
    }
  }
  if (wasSuppressed) {
    notifySoftResidualRecoveryRearm();
  }
}

/**
 * C4: soft residual 後の residual recovery を抑止中か（origin 共有 localStorage を正とする）。
 * r2 tab-local 印が残っていれば同一タブでは fail-closed で true（移行残骸）。
 */
export function isSoftResidualRecoverySuppressed(): boolean {
  try {
    if (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(SOFT_RESIDUAL_RECOVERY_SUPPRESS_KEY) === "1"
    ) {
      return true;
    }
  } catch {
    // fall through to sessionStorage legacy
  }
  try {
    if (
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem(SOFT_RESIDUAL_RECOVERY_SUPPRESS_KEY) === "1"
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
