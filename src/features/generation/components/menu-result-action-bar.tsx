import type { ReactNode } from "react";

/** 採用成功の見出し（4 画面で共通）。 */
export const MENU_ACCEPT_NOTICE_TITLE = "この献立にしました";

/** 家族向け: 買い物リストを作れるときの次の一手。 */
export const MENU_ACCEPT_NOTICE_SHOPPING_READY =
  "次は材料の買い物リストを作ると、買うものがまとまります。";

/** 家族向け: いまリストを作れないときの次の一手（無効ボタンと矛盾させない）。 */
export const MENU_ACCEPT_NOTICE_SHOPPING_WAIT =
  "買い物リストを準備できる状態になると、下のボタンから作れます。";

/** アイデア向け: 採用後の次の一手。 */
export const MENU_ACCEPT_NOTICE_IDEA =
  "履歴の「作った献立」からいつでも見返せます。下のボタンから開けます。";

type MenuResultActionBarProps = {
  /**
   * 採用成功など、操作帯の直前に出す状況メッセージ。
   * 「それで？」にならないよう、次の一手の説明を含める。
   */
  notice?: ReactNode;
  /** いま押すべき主操作（採用 or 採用後の次の一手）。全幅。 */
  primary: ReactNode;
  /** 次点の行動（採用前の買い物リストなど）。任意・全幅。 */
  next?: ReactNode;
  /**
   * 補助操作。渡したときだけ「ほかの操作」見出し付きで下段に出す。
   * 並びと表示条件は呼び出し側が決める。
   */
  auxiliaries?: ReactNode;
};

/**
 * 献立結果・履歴詳細の操作帯。
 * 主操作を上段に固定し、補助は下段へ分ける。
 * 採用後は notice + primary（次の一手）だけで進め、無効な「しました」ボタンは置かない。
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
          <p className="menu-result-actions-aux-label">ほかの操作</p>
          {auxiliaries}
        </div>
      ) : null}
    </div>
  );
}
