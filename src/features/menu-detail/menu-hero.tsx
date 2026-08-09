import { formatGenerationModelLabel } from "@shared/contracts/generation-model-label";

export type MenuHeroProps = {
  /** 食卓までの合計目安分 */
  totalElapsedMinutes: number;
  /** 人分 */
  servings: number;
  /**
   * 生成に使われた最終 OpenRouter model ID。
   * 台帳欠落・未記録は null。推測ラベルを捏造しない。
   */
  generationModelId: string | null;
};

/**
 * 献立詳細の見出し部（成功タイトル・所要時間・作成モデル）。
 * 表示専用。状態・副作用は持たない。
 * Task 3.1: household/MenuResult から見た目を変えず切り出した。
 */
export function MenuHero({
  totalElapsedMinutes,
  servings,
  generationModelId,
}: MenuHeroProps) {
  return (
    <header className="menu-result-header">
      <h1 className="menu-result-title">献立ができました</h1>
      <p className="menu-result-summary">
        食卓まで約{totalElapsedMinutes}分・{servings}人分
      </p>
      {/*
        生成モデルは透明性のための薄いメタ情報。主見出しの下に小さく置き、
        台帳欠落時は出さない（推測ラベルを捏造しない）。
      */}
      {generationModelId !== null &&
      formatGenerationModelLabel(generationModelId) !== "" ? (
        <p className="menu-result-model type-small">
          作成モデル: {formatGenerationModelLabel(generationModelId)}
        </p>
      ) : null}
    </header>
  );
}
