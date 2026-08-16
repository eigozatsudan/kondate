import { useEffect, useRef, useState } from "react";
import { shoppingListAtItemCeilingCopy } from "../shopping-copy";

export type CreateListSheetProps = {
  activeList: { id: string; version: number; itemCount: number } | null;
  pending: boolean;
  safetyBlocked: boolean;
  /**
   * SP-I10: 現行リストが安全確認不能（削除献立ソース等）のとき true。
   * append 既定で壊れたリストに再トラップしないよう new を強制する。
   */
  forceNewMode?: boolean;
  /**
   * SHOP-R1: soft-delete 込みで shoppingItemsMax に達しているとき true。
   * リスト面は「新しいリストを作ってください」と案内するが、lineage 無しの別献立では
   * 既定 append のまま 422 するため、天井時は new 固定する。
   */
  atItemCeiling?: boolean;
  /**
   * SHOP4: 同 lineage が reconcilable のとき true。
   * append は二重行になるため閉じ、差分 CTA へ誘導する（mode=new は維持）。
   */
  disableAppend?: boolean;
  onSubmit: (input: {
    mode: "new" | "append";
    activeListId: string | null;
    expectedListVersion: number | null;
  }) => void;
  onCancel: () => void;
};

/**
 * 買い物リスト作成の確認ダイアログ（native dialog）。
 * マウント時に showModal する。親は shoppingSheet==="create" のときだけ描画する。
 * dialog 本体に .stack（display:grid）を付けない — 閉じた dialog が display で見えるのを防ぐ。
 */
export function CreateListSheet({
  activeList,
  pending,
  safetyBlocked,
  forceNewMode = false,
  atItemCeiling = false,
  disableAppend = false,
  onSubmit,
  onCancel,
}: CreateListSheetProps) {
  // 確認不能 / 天井 / reconcilable のときは append 既定を避ける（SP-I10 / SHOP-R1 / SHOP4）
  const appendBlocked = forceNewMode || atItemCeiling || disableAppend;
  const [mode, setMode] = useState<"new" | "append">(
    activeList === null || appendBlocked ? "new" : "append",
  );
  // forceNew / 天井は new 固定。disableAppend のみのときは new 既定だがユーザーは new のみ選択可
  const effectiveMode = appendBlocked ? "new" : mode;
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      dialog.showModal();
    }
    // L14: auto-open / 手動 open 後に見出しへ focus
    document.getElementById("create-list-title")?.focus();
  }, []);

  // 新しいリストにすると active がアーカイブされ、いまのリストは画面から消える
  const showNewListWarning = activeList !== null && (effectiveMode === "new" || forceNewMode);

  return (
    <dialog
      ref={dialogRef}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-line p-5"
      aria-labelledby="create-list-title"
      onCancel={(event) => {
        event.preventDefault();
        if (pending) return;
        onCancel();
      }}
    >
      <div className="stack">
        {/* L14: プログラム focus 用 */}
        <h2 id="create-list-title" tabIndex={-1} className="text-lg font-bold">
          買い物リストを作る
        </h2>
        {activeList !== null && (
          <fieldset>
            <legend>作り方</legend>
            {forceNewMode && (
              <p className="type-small" role="status">
                今のリストは家族設定で確認できないため、新しいリストを作ります。
              </p>
            )}
            {atItemCeiling && !forceNewMode && (
              <p className="type-small" role="status">
                {shoppingListAtItemCeilingCopy}
              </p>
            )}
            {disableAppend && !forceNewMode && !atItemCeiling && (
              <p className="type-small" role="status">
                この献立の更新は「買い物リストの差分を見る」から反映してください。追加ではなく新しいリストにする場合のみ選べます。
              </p>
            )}
            <label className="control-label">
              <input
                type="radio"
                name="create-list-mode"
                checked={effectiveMode === "append"}
                disabled={appendBlocked}
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
        {showNewListWarning ? (
          <p role="status" className="rounded-xl border border-line bg-canvas px-3 py-2 text-sm">
            新しいリストにすると、いまの買い物リスト（{activeList.itemCount}
            件）は消えます。
            {appendBlocked
              ? null
              : "いまのリストへ足したいときは「今のリストへ追加」を選んでください。"}
          </p>
        ) : null}
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
        <button
          type="button"
          className="text-button min-h-11"
          disabled={pending}
          onClick={onCancel}
        >
          キャンセル
        </button>
      </div>
    </dialog>
  );
}
