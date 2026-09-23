import { PageHeader } from "@/shared/ui/page-header";

export type MenuHeroProps = {
  /** 食卓までの合計目安分 */
  totalElapsedMinutes: number;
  /** 人分 */
  servings: number;
  /**
   * 見出し文言。生成直後（surface=generation, /menus/:menuId）は「献立ができました」、
   * 履歴詳細（surface=history, /history/:menuId）は「献立の詳細」（人間の決定、UX U1）。
   * 呼び出し側（menu-detail-types.ts の MenuDetailSurface）が確定させ、ここは表示のみ。
   * 安全表示ではないため、不変契約1（安全表示文言の固定）の対象外。
   */
  heading: string;
  /**
   * 学習ヒント（tasteHints）を実際にプロンプトへ載せて生成し、強さが medium 以上だった
   * 献立にだけ true。判定は menu-result-api の投影側で済ませ、ここは表示だけを担う。
   */
  tasteHintsApplied: boolean;
};

/**
 * 献立詳細の見出し部（成功タイトル・所要時間・好みの反映）。
 * 表示専用。状態・副作用は持たない。
 * 明朝ヒーローは PageHeader に委ね、見出し文言は呼び出し側から渡された heading を出す。
 * UX U1: 「作成モデル: …」の note は開発用表記のため利用者には出さない（人間の決定）。
 */
export function MenuHero({
  totalElapsedMinutes,
  servings,
  heading,
  tasteHintsApplied,
}: MenuHeroProps) {
  return (
    <>
      <PageHeader
        title={heading}
        lead={`食卓まで約${String(totalElapsedMinutes)}分・${String(servings)}人分`}
      />
      {/* 強さの語（weak/medium/strong）は利用者に見せない。短い 1 行だけを出す */}
      {tasteHintsApplied ? (
        <p className="type-small text-ink/80">✨ いつもの好みを反映しました</p>
      ) : null}
    </>
  );
}
