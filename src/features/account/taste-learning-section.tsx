import { useId, useState } from "react";
import { tasteLearningCopy } from "./taste-learning-copy";

export type TasteLearningSectionProps = {
  /** サーバー側の現在値。楽観表示中でなければこの値がそのまま表示される。 */
  enabled: boolean;
  onToggle: (nextEnabled: boolean) => Promise<void>;
  describedById?: string;
};

/**
 * 好みの学習の ON/OFF スイッチ本体。
 * 表示値は enabled prop に追従する（useState で最初の値を固定しない）ので、
 * 他タブでの変更や再読み込みも反映される。書き込み中だけローカルの仮値を出し、
 * 成功時は呼び出し元のキャッシュ更新（enabled prop の変化）に自然に追従し、
 * 失敗時は pending 解除と同時に enabled prop（変更前のサーバー値）へ戻る。
 */
export function TasteLearningSection({
  enabled,
  onToggle,
  describedById,
}: TasteLearningSectionProps) {
  const [pending, setPending] = useState(false);
  const [optimisticValue, setOptimisticValue] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const [requested, setRequested] = useState<boolean | null>(null);
  const toggleId = useId();

  const displayed = pending && optimisticValue !== null ? optimisticValue : enabled;
  // 失敗後の再読み込みなどで、表示値が利用者の求めた値に追いついたら失敗表示を下げる
  // （出したままだと、もう一度押して自分の変更を取り消させてしまう）。
  const showFailed = failed && !pending && requested !== enabled;

  return (
    <div className="stack gap-2">
      <label className="inline-flex min-h-11 items-center gap-2" htmlFor={toggleId}>
        <input
          id={toggleId}
          type="checkbox"
          role="switch"
          className="min-h-11 min-w-11"
          checked={displayed}
          aria-describedby={describedById}
          disabled={pending}
          onChange={(event) => {
            const next = event.target.checked;
            setPending(true);
            setFailed(false);
            setOptimisticValue(next);
            setRequested(next);
            void onToggle(next)
              .catch(() => {
                setFailed(true);
              })
              .finally(() => {
                setPending(false);
                setOptimisticValue(null);
              });
          }}
        />
        {tasteLearningCopy.toggleLabel}
      </label>
      {showFailed ? (
        <p className="type-small" role="alert">
          {tasteLearningCopy.failed}
        </p>
      ) : null}
    </div>
  );
}
