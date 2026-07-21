import { useId, useRef, useState } from "react";
import { Link } from "react-router";
import type { HistoryGroup } from "../model/group-history";
import { useDeleteMenuGroup, useToggleFavorite } from "../hooks/use-history";

type HistoryCardProps = {
  group: HistoryGroup;
};

/**
 * 派生グループ1件分の履歴カード。
 * - 代表タイトルへ /menus/:id で遷移（詳細の安全再検査は結果画面側）
 * - 44px タッチターゲットのお気に入り／削除
 * - 削除は native dialog で確認し、失敗時はカードを残して再試行可能
 */
export function HistoryCard({ group }: HistoryCardProps) {
  const titleId = useId();
  const dialogTitleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const toggleFavorite = useToggleFavorite();
  const deleteGroup = useDeleteMenuGroup();
  const { representative, versionCount, derivationGroupId } = group;
  const favoritePending = toggleFavorite.isPending;
  const deletePending = deleteGroup.isPending;

  const openDeleteDialog = () => {
    setDeleteError(null);
    dialogRef.current?.showModal();
  };

  const closeDeleteDialog = () => {
    if (deletePending) return;
    dialogRef.current?.close();
    setDeleteError(null);
  };

  const confirmDelete = () => {
    setDeleteError(null);
    deleteGroup.mutate(derivationGroupId, {
      onSuccess: () => {
        dialogRef.current?.close();
      },
      onError: () => {
        // カードは残したまま再試行を促す
        setDeleteError("削除できませんでした。もう一度試してください");
      },
    });
  };

  const onToggleFavorite = () => {
    if (favoritePending) return;
    toggleFavorite.mutate({
      menuId: representative.id,
      isFavorite: !representative.isFavorite,
    });
  };

  return (
    <article className="card stack" aria-labelledby={titleId}>
      <div className="stack gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 id={titleId} className="min-w-0 text-lg font-bold break-words">
            <Link
              to={`/menus/${representative.id}`}
              className="min-h-11 inline-flex items-center text-inherit underline-offset-2 hover:underline"
            >
              {representative.title.length > 0 ? representative.title : "献立"}
            </Link>
          </h2>
          <p className="shrink-0 rounded-full border px-3 py-1 text-sm font-semibold">
            {versionCount}案
          </p>
        </div>
        <p className="text-sm text-stone-700">開くと現在の家族設定で再確認します</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg border-2 border-stone-800 px-3 font-semibold"
          aria-pressed={representative.isFavorite}
          aria-label={representative.isFavorite ? "お気に入りを外す" : "お気に入りに追加"}
          disabled={favoritePending}
          onClick={onToggleFavorite}
        >
          {representative.isFavorite ? "★ お気に入り" : "☆ お気に入り"}
        </button>
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg border-2 border-stone-800 px-3 font-semibold"
          aria-label="この履歴を削除"
          disabled={deletePending}
          onClick={openDeleteDialog}
        >
          削除
        </button>
      </div>
      {toggleFavorite.isError && (
        <p role="alert" className="error-message">
          お気に入りを更新できませんでした
        </p>
      )}
      <dialog
        ref={dialogRef}
        className="card stack m-auto max-w-[min(100%,24rem)] rounded-xl p-4"
        aria-labelledby={dialogTitleId}
      >
        <h3 id={dialogTitleId} className="text-base font-bold">
          この履歴を削除しますか？
        </h3>
        <p>派生した案も含めてまとめて消えます。元に戻せません。</p>
        {deleteError !== null && (
          <p role="alert" className="error-message">
            {deleteError}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="min-h-11 min-w-11 rounded-lg bg-terracotta-700 px-4 font-semibold text-white"
            disabled={deletePending}
            onClick={confirmDelete}
          >
            {deletePending
              ? "削除しています"
              : deleteError !== null
                ? "もう一度削除する"
                : "削除する"}
          </button>
          <button
            type="button"
            className="min-h-11 min-w-11 rounded-lg border-2 border-stone-800 px-4 font-semibold"
            disabled={deletePending}
            onClick={closeDeleteDialog}
          >
            やめる
          </button>
        </div>
      </dialog>
    </article>
  );
}
