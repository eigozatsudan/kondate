import {
  AI_CREATED_MENU_DISCLAIMER_BODY,
  AI_CREATED_MENU_DISCLAIMER_LEAD,
  EASE_SOFT_NOT_SWALLOW_DISCLAIMER,
  MENU_LABEL_DISCLAIMER,
} from "@/features/generation/components/idea-menu-safety-notice";
import type { RevalidationPhaseName } from "@/features/history/hooks/use-menu-revalidation";
import { Button } from "@/shared/ui/button";
import { Inset, Stack } from "@/shared/ui/stack";
import { Surface } from "@/shared/ui/surface";

export type MenuSafetyNoticeIssue = {
  code: string;
  path: string;
  message: string;
};

export type MenuSafetyNoticeProps = {
  /**
   * 再検証フェーズ（checking/error/invalid の出し分け）。
   * section="disclaimers" では参照しないため省略可（UX U1: 見出し直後の単独カード呼び出し用）。
   */
  phase?: RevalidationPhaseName;
  /**
   * offline hold 中は shopping と同型の接続誘導 copy を出す（HR1）。
   * checking オーバーレイ内の文言だけを切り替える。section="disclaimers" では未使用。
   */
  isOfflineHold?: boolean;
  /**
   * error 帯・gate sticky に出す状態文。
   * phase=error のとき role=alert、gate 通過時は role=status。section="disclaimers" では未使用。
   */
  statusCopy?: string | null;
  /**
   * phase=checked かつ status=invalid のときだけ渡す。
   * 省略または空なら invalid 帯を出さない。
   */
  invalidIssues?: readonly MenuSafetyNoticeIssue[] | undefined;
  /** phase=error の「もう一度確認」 */
  onRetry?: (() => void) | undefined;
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
 * 表示専用。ゲート文は作成時の対象家族に限り、世帯全員とは書かない。保証フレーズは出さない。
 * role=alert / role=status の使い分けも維持する。
 * sticky は .menu-result-gate-status 意味クラスへ退避（生 utility 禁止）。
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
      <div className="menu-result-gate-status" role="status">
        <p className="menu-result-gate-status-copy">{statusCopy}</p>
        {changedDetailLines.length > 0 && (
          <ul className="menu-result-gate-status-list type-small">
            {changedDetailLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (section === "disclaimers") {
    // UX U1: 加工品表示確認・やわらかめ文・AI作成文の3枚を1枚のカードにまとめる（人間の決定）。
    // 文の意味は変えず、不安を煽らず目立たせる notice 面 1 つに収める。
    return (
      <Surface tone="notice">
        <Inset pad={5}>
          <Stack gap={2}>
            <p className="menu-detail-disclaimer-strong">{MENU_LABEL_DISCLAIMER}</p>
            <p className="type-small">{EASE_SOFT_NOT_SWALLOW_DISCLAIMER}</p>
            <p>
              <strong>{AI_CREATED_MENU_DISCLAIMER_LEAD}</strong> {AI_CREATED_MENU_DISCLAIMER_BODY}
            </p>
          </Stack>
        </Inset>
      </Surface>
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
                ? "ネット接続後にこの献立の対象家族の設定を確認してください"
                : "この献立の対象家族の設定で確認しています"}
            </p>
          </div>
        </div>
      )}

      {phase === "error" && (
        <Stack gap={2}>
          <p role="alert">{statusCopy}</p>
          <Button
            variant="secondary"
            onClick={() => {
              onRetry?.();
            }}
          >
            もう一度確認
          </Button>
        </Stack>
      )}

      {phase === "checked" && invalidIssues !== undefined && invalidIssues.length > 0 && (
        <Surface tone="notice" role="alert">
          <Inset pad={5}>
            <Stack gap={2}>
              <p>この献立の対象家族の設定では利用できません</p>
              <ul className="menu-detail-issue-list">
                {invalidIssues.map((issue) => (
                  <li key={`${issue.code}:${issue.path}`}>{issue.message}</li>
                ))}
              </ul>
            </Stack>
          </Inset>
        </Surface>
      )}
    </>
  );
}
