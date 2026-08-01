import type { ReactNode } from "react";

type MenuResultActionBarProps = {
  /**
   * 採用成功など、操作帯の直前に出す状況メッセージ。
   * 「それで？」にならないよう、次の一手の説明を含める。
   */
  notice?: ReactNode;
  /** 主操作（この献立にする / 採用済み表示）。常に最上段・全幅。 */
  primary: ReactNode;
  /** 次点の行動（買い物リスト・履歴へ など）。任意・全幅。 */
  next?: ReactNode;
  /**
   * 作り直し・補助操作。渡したときだけ「気に入らないときは」見出し付きで下段に出す。
   * 並びと表示条件は呼び出し側が決める。
   */
  auxiliaries?: ReactNode;
};

/**
 * 献立結果・履歴詳細の操作帯。
 * 主操作を上段に固定し、作り直し系は補助段へ分ける。
 * 採用後は notice + next で「次に押すもの」を示す。
 */
export function MenuResultActionBar({
  notice,
  primary,
  next,
  auxiliaries,
}: MenuResultActionBarProps) {
  return (
    <div className="menu-result-actions">
      {notice != null ? <div className="menu-result-actions-notice">{notice}</div> : null}
      <div className="menu-result-actions-primary">
        {primary}
        {next ?? null}
      </div>
      {auxiliaries != null ? (
        <div className="menu-result-actions-aux">
          <p className="menu-result-actions-aux-label">気に入らないときは</p>
          {auxiliaries}
        </div>
      ) : null}
    </div>
  );
}
