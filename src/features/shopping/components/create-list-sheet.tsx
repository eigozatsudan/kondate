import { useState } from "react";

export type CreateListSheetProps = {
  activeList: { id: string; version: number; itemCount: number } | null;
  pending: boolean;
  safetyBlocked: boolean;
  /**
   * SP-I10: 現行リストが安全確認不能（削除献立ソース等）のとき true。
   * append 既定で壊れたリストに再トラップしないよう new を強制する。
   */
  forceNewMode?: boolean;
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
  forceNewMode = false,
  onSubmit,
  onCancel,
}: CreateListSheetProps) {
  // 確認不能な active リストがあるときは append 既定を避ける（SP-I10）
  const [mode, setMode] = useState<"new" | "append">(
    activeList === null || forceNewMode ? "new" : "append",
  );
  const effectiveMode = forceNewMode ? "new" : mode;
  return (
    <section className="card stack" aria-labelledby="create-list-title">
      <h2 id="create-list-title">買い物リストを作る</h2>
      {activeList !== null && (
        <fieldset>
          <legend>作り方</legend>
          {forceNewMode && (
            <p className="type-small" role="status">
              今のリストは家族設定で確認できないため、新しいリストを作ります。
            </p>
          )}
          <label className="control-label">
            <input
              type="radio"
              name="create-list-mode"
              checked={effectiveMode === "append"}
              disabled={forceNewMode}
              onChange={() => {
                setMode("append");
              }}
            />
            今のリストへ追加（{activeList.itemCount}件）
          </label>
          <label className="control-label">
            <input
              type="radio"
              name="create-list-mode"
              checked={effectiveMode === "new"}
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
            mode: effectiveMode,
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
