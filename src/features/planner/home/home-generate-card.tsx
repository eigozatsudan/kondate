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
  /**
   * U3: 答えかけの下書きがあるときの進み具合。null / 未指定なら下書き無しとして扱う。
   * answeredSteps は回答済みの質問数、totalSteps は plannerSteps の総数（route が計算する）。
   */
  draftProgress?: HomeDraftProgress | null;
  /** U3: 下書きの続きからウィザードを開く。draftProgress があるときだけ使う。 */
  onResumeDraft?: () => void;
  /** U3: 確認のうえ下書きを消して 1 問目から始める。確認・消去は route 側が持つ。 */
  onRestartDraft?: () => void;
  /** 保存・遷移中など主 CTA を止めるとき。 */
  disabled?: boolean;
};

export type HomeDraftProgress = {
  answeredSteps: number;
  totalSteps: number;
  /**
   * 必須の質問（食事〜作る相手）がすべて埋まり、続きが確認画面になるとき true。
   * このとき answeredSteps は任意の質問（5〜8）を開いていなくても 8 になり、
   * 「8 / 9 まで答えています」は事実と合わないため、件数ではなく状態の文言を出す（U3 修正 M-5）。
   */
  readyForReview: boolean;
};

/**
 * ホームの生成導線。表示専用。
 * 主ボタン名は「献立を作る」と衝突させない（mobile-accessibility の件数固定契約）。
 * P9: remainingToday===0 のとき新規開始 CTA を止め、ウィザード完走後の usage ブロックへ
 * 誘導する死に道を減らす。未取得 (null) は誤停止しない。進行中 pending の再開は残す。
 *
 * U3: 答えかけの下書きがあるときは「続きから答える」を主ボタン、「最初から」を副ボタンにする。
 * 進行中 pending があるときはそちらを優先し、下書きの導線は出さない（従来の表示のまま）。
 * 「続きから答える」は残り 0 回でも止めない。従来は下書きがあればウィザードへ自動復帰して
 * 回答を見返せたため、ホーム経由にしたことで入れなくなる退行を避ける（生成の可否は確認画面の
 * 残数表示・ボタン側が従来どおり止める）。「最初から」は新規開始なので P9 に合わせて止める。
 */
export function HomeGenerateCard({
  remainingToday,
  onStart,
  hasResumablePending = false,
  onResumePending,
  draftProgress = null,
  onResumeDraft,
  onRestartDraft,
  disabled = false,
}: HomeGenerateCardProps): JSX.Element {
  // 成功残 0 のときだけ新規開始を止める。null は C-I12 と同型で fail-open。
  const startDisabled = disabled || remainingToday === 0;
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
              <Button variant="secondary" disabled={startDisabled} onClick={onStart}>
                今日の献立をつくる
              </Button>
            </Stack>
          ) : draftProgress !== null &&
            onResumeDraft !== undefined &&
            onRestartDraft !== undefined ? (
            <Stack gap={3}>
              {/* 開いた時点で決まっている静的な説明なので live region（role=status）にしない。
                  「あと n 回」と続けて読み上げが割り込むのを避ける（U3 修正 M-1）。 */}
              <p className="home-pending-notice">
                {draftProgress.readyForReview
                  ? "必須の質問はすべて答えています。確認画面から続けられます。"
                  : `${String(draftProgress.answeredSteps)} / ${String(draftProgress.totalSteps)} まで答えています`}
              </p>
              <Button variant="primary" size="large" disabled={disabled} onClick={onResumeDraft}>
                続きから答える
              </Button>
              <Button variant="secondary" disabled={startDisabled} onClick={onRestartDraft}>
                最初から
              </Button>
            </Stack>
          ) : (
            <Button variant="primary" size="large" disabled={startDisabled} onClick={onStart}>
              今日の献立をつくる
            </Button>
          )}
        </Stack>
      </Inset>
    </Surface>
  );
}
