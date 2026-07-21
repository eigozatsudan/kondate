import { useState } from "react";

export type CreateListSheetProps = {
  activeList: { id: string; version: number; itemCount: number } | null;
  pending: boolean;
  safetyBlocked: boolean;
  onSubmit: (input: {
    mode: "new" | "append";
    activeListId: string | null;
    expectedListVersion: number | null;
  }) => void;
  onCancel: () => void;
};

export function CreateListSheet({
  activeList,
  pending,
  safetyBlocked,
  onSubmit,
  onCancel,
}: CreateListSheetProps) {
  const [mode, setMode] = useState<"new" | "append">(activeList === null ? "new" : "append");
  return (
    <section className="card stack" aria-labelledby="create-list-title">
      <h2 id="create-list-title">買い物リストを作る</h2>
      {activeList !== null && (
        <fieldset>
          <legend>作り方</legend>
          <label className="min-h-11 flex items-center">
            <input
              type="radio"
              name="create-list-mode"
              checked={mode === "append"}
              onChange={() => {
                setMode("append");
              }}
            />
            今のリストへ追加（{activeList.itemCount}件）
          </label>
          <label className="min-h-11 flex items-center">
            <input
              type="radio"
              name="create-list-mode"
              checked={mode === "new"}
              onChange={() => {
                setMode("new");
              }}
            />
            新しいリストにする
          </label>
        </fieldset>
      )}
      <button
        type="button"
        className="primary-button min-h-11"
        disabled={pending || safetyBlocked}
        onClick={() => {
          onSubmit({
            mode,
            activeListId: activeList?.id ?? null,
            expectedListVersion: activeList?.version ?? null,
          });
        }}
      >
        作成する
      </button>
      <button type="button" className="text-button min-h-11" onClick={onCancel}>
        キャンセル
      </button>
    </section>
  );
}
