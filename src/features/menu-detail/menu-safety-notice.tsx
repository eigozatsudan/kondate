import {
  EASE_SOFT_NOT_SWALLOW_DISCLAIMER,
  MENU_LABEL_DISCLAIMER,
} from "@/features/generation/components/idea-menu-safety-notice";
import type { RevalidationPhaseName } from "@/features/history/hooks/use-menu-revalidation";

export type MenuSafetyNoticeIssue = {
  code: string;
  path: string;
  message: string;
};

export type MenuSafetyNoticeProps = {
  /** 再検証フェーズ（checking/error/invalid の出し分け） */
  phase: RevalidationPhaseName;
  /**
   * offline hold 中は shopping と同型の接続誘導 copy を出す（HR1）。
   * checking オーバーレイ内の文言だけを切り替える。
   */
  isOfflineHold: boolean;
  /**
   * error 帯・gate sticky に出す状態文。
   * phase=error のとき role=alert、gate 通過時は role=status。
   */
  statusCopy: string | null;
  /**
   * phase=checked かつ status=invalid のときだけ渡す。
   * 省略または空なら invalid 帯を出さない。
   */
  invalidIssues?: readonly MenuSafetyNoticeIssue[];
  /** phase=error の「もう一度確認」 */
  onRetry?: () => void;
  /**
   * gate 通過後の sticky 状態帯を出すか。
   * MenuResult 直前に置く提示順を維持するため、親が gateOpen 時に true にする。
   */
  showGateStatus?: boolean;
  /** changed 時の日本語詳細行（HR-I2）。showGateStatus 時のみ使う */
  changedDetailLines?: readonly string[];
  /**
   * レンダー範囲。提示順を崩さないために親が 3 箇所から呼ぶ。
   * - `disclaimers`: ページ最上部の固定免責
   * - `revalidation`: flyer の後・案切替の前の checking/error/invalid
   * - `gate`: MenuResult 直前の sticky 状態帯
   */
  section?: "disclaimers" | "revalidation" | "gate";
};

/**
 * household 献立詳細の安全・アレルギー表示。
 * 表示専用。文言は不変契約どおり一字一句変えない。
 * role=alert / role=status の使い分けも維持する。
 */
export function MenuSafetyNotice({
  phase,
  isOfflineHold,
  statusCopy,
  invalidIssues,
  onRetry,
  showGateStatus = false,
  changedDetailLines = [],
  section = "disclaimers",
}: MenuSafetyNoticeProps) {
  if (section === "gate") {
    if (!showGateStatus) return null;
    return (
      <div
        className="menu-result-gate-status sticky top-0 z-10 bg-canvas/95 py-2"
        role="status"
      >
        <p className="m-0">{statusCopy}</p>
        {changedDetailLines.length > 0 && (
          <ul className="mt-1 list-disc pl-5 type-small">
            {changedDetailLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (section === "disclaimers") {
    return (
      <>
        <p className="rounded-xl border border-amber-700 p-3 font-semibold">
          {MENU_LABEL_DISCLAIMER}
        </p>
        <p className="type-small text-ink/80">{EASE_SOFT_NOT_SWALLOW_DISCLAIMER}</p>
      </>
    );
  }

  // section === "revalidation"
  return (
    <>
      {phase === "checking" && (
        <div
          className="revalidation-checking-overlay"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="revalidation-checking-panel">
            <div className="gen-status-indicator" aria-hidden="true" />
            {/* HR1: offline hold は shopping と同型の接続誘導。通常 checking は確認中 */}
            <p>
              {isOfflineHold
                ? "ネット接続後に現在の家族設定を確認してください"
                : "現在の家族設定で確認しています"}
            </p>
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="mt-4 stack gap-2">
          <p role="alert">{statusCopy}</p>
          <button
            type="button"
            className="min-h-11 rounded-lg border-2 border-terracotta-700 px-4 font-semibold"
            onClick={() => {
              onRetry?.();
            }}
          >
            もう一度確認
          </button>
        </div>
      )}

      {phase === "checked" && invalidIssues !== undefined && invalidIssues.length > 0 && (
        <div className="mt-4 stack gap-2" role="alert">
          <p>現在の家族設定ではこの献立を利用できません</p>
          <ul className="list-disc pl-5">
            {invalidIssues.map((issue) => (
              <li key={`${issue.code}:${issue.path}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
