import { formatGenerationModelLabel } from "@shared/contracts/generation-model-label";
import { PageHeader } from "@/shared/ui/page-header";

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
 * 明朝ヒーローは PageHeader に委ね、文言は不変契約どおり維持する。
 */
export function MenuHero({ totalElapsedMinutes, servings, generationModelId }: MenuHeroProps) {
  const modelLabel =
    generationModelId !== null ? formatGenerationModelLabel(generationModelId) : "";
  // 台帳欠落時は note を渡さない（推測ラベルを捏造しない）
  const note = modelLabel !== "" ? `作成モデル: ${modelLabel}` : undefined;

  return (
    <PageHeader
      title="献立ができました"
      lead={`食卓まで約${String(totalElapsedMinutes)}分・${String(servings)}人分`}
      {...(note !== undefined ? { note } : {})}
    />
  );
}
