import { useId, useRef, useState } from "react";
import { Link } from "react-router";
import { menusPathForShopping } from "@/features/shopping/shopping-intent";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/feedback";
import { Stack } from "@/shared/ui/stack";
import { Surface } from "@/shared/ui/surface";
import type { HistoryGroup } from "../model/group-history";
import { useDeleteMenuGroup, useToggleFavorite } from "../hooks/use-history";

type HistoryCardProps = {
  group: HistoryGroup;
  /** 履歴が for=shopping 文脈のとき true。タイトルも買い物 intent を付ける */
  shoppingIntent?: boolean;
};

/**
 * 派生グループ1件分の履歴カード。
 * - 代表タイトルと「詳細を見る」で /menus/:id へ遷移（詳細の安全再検査は結果画面側）
 * - 44px タッチターゲットの詳細／お気に入り／削除
 * - 削除は native dialog で確認し、失敗時はカードを残して再試行可能
 * menu-detail と同じ語彙（Surface / Stack / Button / Badge）で組む。
 */
export function HistoryCard({ group, shoppingIntent = false }: HistoryCardProps) {
  const titleId = useId();
  const dialogTitleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const toggleFavorite = useToggleFavorite();
  const deleteGroup = useDeleteMenuGroup();
  const { representative, versionCount, derivationGroupId } = group;
  const favoritePending = toggleFavorite.isPending;
  const deletePending = deleteGroup.isPending;
  const menuPath = shoppingIntent
    ? menusPathForShopping(representative.id)
    : `/menus/${representative.id}`;

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
    <Surface as="article" aria-labelledby={titleId} tone="plain">
      <Stack gap={4}>
        <Stack gap={2}>
          <div className="history-card-heading">
            <h2 id={titleId} className="history-card-title">
              <Link to={menuPath} className="history-card-title-link min-h-11">
                {representative.title.length > 0 ? representative.title : "献立"}
              </Link>
            </h2>
            <Badge tone="neutral">{versionCount}案</Badge>
          </div>
          {/* idea/household の権威ある判定元はHistoryGroup.representative.targetMode。
              idea カードには家族安全確認済みと誤解させる表現を一切出さない
              （brief step 12）。 */}
          <Badge tone={representative.targetMode === "idea" ? "neutral" : "warning"}>
            {representative.targetMode === "idea" ? "アイデア" : "家族に合わせた献立"}
          </Badge>
          <p className="type-small">
            {new Intl.DateTimeFormat("ja-JP", {
              timeZone: "Asia/Tokyo",
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(representative.createdAt))}
          </p>
          <p className="type-small">
            {representative.targetMode === "idea"
              ? "開いても家族条件は確認しません"
              : "開くと現在の家族設定で再確認します"}
          </p>
        </Stack>
        <div className="history-card-actions">
          {representative.targetMode === "household" ? (
            <Link
              to={menusPathForShopping(representative.id)}
              className="button-link button-link--primary min-h-11 min-w-11"
            >
              買い物リストを作る
            </Link>
          ) : null}
          <Link to={menuPath} className="button-link min-h-11 min-w-11">
            詳細を見る
          </Link>
          <Button
            variant="secondary"
            aria-pressed={representative.isFavorite}
            aria-label={representative.isFavorite ? "お気に入りを外す" : "お気に入りに追加"}
            disabled={favoritePending}
            onClick={onToggleFavorite}
          >
            {representative.isFavorite ? "★ お気に入り" : "☆ お気に入り"}
          </Button>
          <Button
            variant="secondary"
            aria-label="この履歴を削除"
            disabled={deletePending}
            onClick={openDeleteDialog}
          >
            削除
          </Button>
        </div>
        {toggleFavorite.isError && (
          <p role="alert" className="error-message">
            お気に入りを更新できませんでした
          </p>
        )}
      </Stack>
      {/*
        dialog 本体に .stack（display:grid）を付けない。
        作者スタイルの display は UA の dialog:not([open]){display:none} を
        上書きするため、閉じた確認ダイアログが初期表示から見えて操作を妨げる。
        余白レイアウトは内側ラッパーへ寄せる（DeleteAccountDialog と同じ方針）。
      */}
      <dialog
        ref={dialogRef}
        className="history-dialog"
        aria-labelledby={dialogTitleId}
        onCancel={(event) => {
          // 削除中の Escape で閉じると、失敗時のエラーが閉じた dialog に載る。
          event.preventDefault();
          if (deletePending) return;
          closeDeleteDialog();
        }}
      >
        <Stack gap={4}>
          <h3 id={dialogTitleId} className="history-dialog-title">
            この履歴を削除しますか？
          </h3>
          <p>
            派生した案も含めてまとめて消えます。元に戻せません。この献立を元にした買い物リストがある場合、そのリストの確認操作はできなくなります。新しいリストは履歴から作り直せます。
          </p>
          {deleteError !== null && (
            <p role="alert" className="error-message">
              {deleteError}
            </p>
          )}
          <div className="history-card-actions">
            <Button variant="primary" disabled={deletePending} onClick={confirmDelete}>
              {deletePending
                ? "削除しています"
                : deleteError !== null
                  ? "もう一度削除する"
                  : "削除する"}
            </Button>
            <Button variant="secondary" disabled={deletePending} onClick={closeDeleteDialog}>
              やめる
            </Button>
          </div>
        </Stack>
      </dialog>
    </Surface>
  );
}
