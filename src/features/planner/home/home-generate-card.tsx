import type { JSX } from "react";
import { Button } from "@/shared/ui/button";
import { Inset, Stack } from "@/shared/ui/stack";
import { Surface } from "@/shared/ui/surface";

export type HomeGenerateCardProps = {
  /** 本日の生成成功 残り回数。未取得時は null（件数文を出さない）。 */
  remainingToday: number | null;
  /** ウィザード第1ステップへ進む主 CTA。 */
  onStart: () => void;
  /**
   * 進行中 generation pending があるとき true。
   * ホームでは再開を最優先で見せ、主 CTA と並べる（pending の読み書き自体は route 側）。
   */
  hasResumablePending?: boolean;
  /** pending 再開（/generation?resumed=1 等）。hasResumablePending 時のみ使う。 */
  onResumePending?: () => void;
  /** 保存・遷移中など主 CTA を止めるとき。 */
  disabled?: boolean;
};

/**
 * ホームの生成導線。表示専用。
 * 主ボタン名は「献立を作る」と衝突させない（mobile-accessibility の件数固定契約）。
 */
export function HomeGenerateCard({
  remainingToday,
  onStart,
  hasResumablePending = false,
  onResumePending,
  disabled = false,
}: HomeGenerateCardProps): JSX.Element {
  return (
    <Surface as="section" tone="plain" aria-labelledby="home-generate-heading">
      <Inset pad={5}>
        <Stack gap={4}>
          <Stack gap={2}>
            <h2 id="home-generate-heading" className="home-generate-title">
              今日の献立
            </h2>
            <p className="type-small">
              いくつか質問に答えると、家庭向けの献立案をつくれます。アレルギーなどの安全確認は別途ご自身でお願いします。
            </p>
            {remainingToday !== null ? (
              <p className="home-generate-remaining" role="status">
                あと{String(remainingToday)}回
              </p>
            ) : null}
          </Stack>
          {hasResumablePending && onResumePending !== undefined ? (
            <Stack gap={3}>
              <p className="home-pending-notice" role="status">
                作成中の献立があります。続きから再開できます。
              </p>
              <Button variant="primary" size="large" disabled={disabled} onClick={onResumePending}>
                作成中の献立を続ける
              </Button>
              <Button variant="secondary" disabled={disabled} onClick={onStart}>
                今日の献立をつくる
              </Button>
            </Stack>
          ) : (
            <Button variant="primary" size="large" disabled={disabled} onClick={onStart}>
              今日の献立をつくる
            </Button>
          )}
        </Stack>
      </Inset>
    </Surface>
  );
}
