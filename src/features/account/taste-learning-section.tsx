import { useId, useState } from "react";

export const tasteLearningCopy = {
  title: "好みの学習",
  toggleLabel: "好みの学習",
  body: "★を付けた献立、「この献立にする」で選んだ献立、再生成の理由、入力したメイン食材から傾向を読み取り、次の提案に反映します。",
  sending:
    "献立を作るときに、そこから読み取った料理名と食材名（最長90日・最大50献立）がAIへ送られます。",
  storage: "OFFにすると読み取りをやめます。設定と反映の記録は保存されます。",
  failed: "設定を変更できませんでした。時間をおいてもう一度お試しください",
} as const;

export type TasteLearningSectionProps = {
  enabled: boolean;
  onToggle: (nextEnabled: boolean) => Promise<void>;
};

/**
 * 好みの学習の ON/OFF。読み取りは呼び出し側、書き込みは RPC。
 * 楽観表示はせず、失敗したら元の値へ戻す。
 */
export function TasteLearningSection({ enabled, onToggle }: TasteLearningSectionProps) {
  const [current, setCurrent] = useState(enabled);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const describedById = useId();

  return (
    <section className="card stack settings-section" aria-labelledby="taste-learning-title">
      <h2 id="taste-learning-title" className="settings-section-title">
        {tasteLearningCopy.title}
      </h2>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          role="switch"
          className="min-h-11 min-w-11"
          checked={current}
          aria-checked={current}
          aria-describedby={describedById}
          disabled={pending}
          onChange={(event) => {
            const next = event.target.checked;
            const previous = current;
            setPending(true);
            setFailed(false);
            setCurrent(next);
            void onToggle(next)
              .catch(() => {
                setCurrent(previous);
                setFailed(true);
              })
              .finally(() => {
                setPending(false);
              });
          }}
        />
        {tasteLearningCopy.toggleLabel}
      </label>
      <p id={describedById} className="type-small text-ink/80">
        {tasteLearningCopy.body}
        {tasteLearningCopy.sending}
        {tasteLearningCopy.storage}
      </p>
      {failed ? (
        <p className="type-small" role="status">
          {tasteLearningCopy.failed}
        </p>
      ) : null}
    </section>
  );
}
