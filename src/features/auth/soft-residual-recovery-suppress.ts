import { z } from "zod";

/**
 * C4/R3/R4: soft residual 後の residual recovery 抑止印と、意図的 login 再開時の re-arm。
 *
 * auth-flow と auth-cleanup の循環 import を避けるため、suppress の正本を本モジュールに置く。
 * - mark: soft residual 実行後（origin 共有 localStorage）
 * - clear: createAuthFlow 成功・session 適用・明示 clear。解除時に re-arm イベントを発火する（R4）
 * - is: AuthProvider residual effect のゲート（C4/C36: 印があり pin が無いときだけ start しない）
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
  // R4: 印そのものが立っていたら re-arm。C36 の pin 有無は見ない。
  const wasSuppressed = isSoftResidualRecoverySuppressFlagSet();
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
 * C4: origin 共有（または r2 session 残骸）の suppress 印があるか。
 * pin の有無は見ない。R4 の clear 判定用。
 */
function isSoftResidualRecoverySuppressFlagSet(): boolean {
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

/**
 * C36/C38: 開始タブの session/local pin があるか。
 * auth-flow を import すると循環するため、同じキーをここで読む。
 * readActiveLoginFlowId と同じ z.uuid。不正値は pin 無し（ここでは消さない）。
 */
const activeLoginFlowIdSchema = z.uuid();

function hasReadableActiveLoginFlowId(): boolean {
  const read = (storage: Storage): boolean => {
    try {
      const raw = storage.getItem("kondate.auth.active-login-flow");
      if (raw === null || raw.length === 0) return false;
      return activeLoginFlowIdSchema.safeParse(raw).success;
    } catch {
      return false;
    }
  };
  if (typeof sessionStorage !== "undefined" && read(sessionStorage)) return true;
  if (typeof localStorage !== "undefined" && read(localStorage)) return true;
  return false;
}

/**
 * C4/C36/C38: residual recovery を抑止するか。
 * local（または r2 session）suppress が立っていて、readActiveLoginFlowId 相当の UUID pin が無いときだけ true。
 * 開始タブは session pin があるので false → residual を開始できる。他タブは pin 無し + suppress 残で true。
 * 不正 pin は pin 無し扱い。read がキーを消しても true のまま（restrict 無し全件 residual を開かない）。
 */
export function isSoftResidualRecoverySuppressed(): boolean {
  if (!isSoftResidualRecoverySuppressFlagSet()) return false;
  return !hasReadableActiveLoginFlowId();
}
