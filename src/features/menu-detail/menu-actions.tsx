import { Link } from "react-router";
import {
  MENU_ACCEPT_NOTICE_SHOPPING_READY,
  MENU_ACCEPT_NOTICE_SHOPPING_WAIT,
  MENU_ACCEPT_NOTICE_TITLE,
  MenuResultActionBar,
} from "@/features/generation/components/menu-result-action-bar";
import type { RevalidationPhaseName } from "@/features/history/hooks/use-menu-revalidation";
import { historyPathForShopping } from "@/features/shopping/shopping-intent";
import { Button } from "@/shared/ui/button";
import { Inset, Stack } from "@/shared/ui/stack";
import { Surface } from "@/shared/ui/surface";

export type MenuActionsProps = {
  accepted: boolean;
  gateOpen: boolean;
  canCreateShoppingList: boolean;
  shoppingAsPrimary: boolean;
  actionsEnabled: boolean;
  acceptPending: boolean;
  confirmedSingle: boolean;
  pantryGateReady: boolean;
  /** reconcile 対象があるとき true */
  showReconcile: boolean;
  reconcileDisabled: boolean;
  canUpdatePostCook: boolean;
  showRetarget: boolean;
  retargetEnabled: boolean;
  retargetPending: boolean;
  retargetError: string | null;
  shoppingError: string | null;
  shoppingIntentActive: boolean;
  revalidationPhase: RevalidationPhaseName;
  isSoftRechecking: boolean;
  /** shopping intent 拒否時の本文（errorMessage または既定文） */
  shoppingRejectedMessage: string | null;
  onAccept: () => void;
  onOpenCreateShopping: () => void;
  onOpenWholeRegen: () => void;
  onOpenReconcile: () => void;
  onOpenPostCook: () => void;
  onRetarget: () => void;
};

/**
 * household 献立詳細の操作列（採用・買い物・再生成・在庫・条件変更）と
 * 買い物 intent の状態メッセージ。
 * 表示専用。mutation / sheet 開閉は親のコールバックに委譲する。
 * ボタンのアクセシブル名は e2e 契約のため変更しない。
 * Link は Button 化しない（generation と同じ方針）。button-link 意味クラスを使う。
 */
export function MenuActions({
  accepted,
  gateOpen,
  canCreateShoppingList,
  shoppingAsPrimary,
  actionsEnabled,
  acceptPending,
  confirmedSingle,
  pantryGateReady,
  showReconcile,
  reconcileDisabled,
  canUpdatePostCook,
  showRetarget,
  retargetEnabled,
  retargetPending,
  retargetError,
  shoppingError,
  shoppingIntentActive,
  revalidationPhase,
  isSoftRechecking,
  shoppingRejectedMessage,
  onAccept,
  onOpenCreateShopping,
  onOpenWholeRegen,
  onOpenReconcile,
  onOpenPostCook,
  onRetarget,
}: MenuActionsProps) {
  return (
    <>
      <MenuResultActionBar
        notice={
          // HR12: invalid 後も「採用しました」が残ると usable 誤読になる。gate が開いているときだけ表示
          accepted && gateOpen ? (
            <div role="status">
              <p className="menu-result-actions-notice-title">{MENU_ACCEPT_NOTICE_TITLE}</p>
              <p className="menu-result-actions-notice-hint">
                {canCreateShoppingList
                  ? MENU_ACCEPT_NOTICE_SHOPPING_READY
                  : MENU_ACCEPT_NOTICE_SHOPPING_WAIT}
              </p>
            </div>
          ) : null
        }
        primary={
          // HR2: invalid 後に disabled 買い物を primary に残さない（gateOpen 必須）。
          // 単一案の採用降格は買い物が作れるときだけ（C5 / 再検証中の死んだ主操作防止）
          shoppingAsPrimary ? (
            <Button
              variant={canCreateShoppingList ? "primary" : "secondary"}
              disabled={!canCreateShoppingList}
              onClick={onOpenCreateShopping}
            >
              材料の買い物リストを作る
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={!actionsEnabled || acceptPending}
              onClick={onAccept}
            >
              この献立にする
            </Button>
          )
        }
        next={
          // HR2: gate が閉じているあいだは secondary 買い物も出さない（死んだ CTA を残さない）
          shoppingAsPrimary || !gateOpen ? null : (
            <Button
              variant="secondary"
              disabled={!canCreateShoppingList}
              onClick={onOpenCreateShopping}
            >
              材料の買い物リストを作る
            </Button>
          )
        }
        auxiliaries={
          <>
            {!accepted && confirmedSingle && canCreateShoppingList ? (
              <Button
                variant="secondary"
                // canCreate 中も soft 再突入で actionsEnabled が落ちる窓がある。
                // disabled を acceptPending だけにすると enabled 見た目のまま onAccept が no-op する。
                disabled={acceptPending || !actionsEnabled}
                onClick={onAccept}
              >
                この献立にする
              </Button>
            ) : null}
            <Button
              variant="secondary"
              disabled={!actionsEnabled || !pantryGateReady}
              onClick={onOpenWholeRegen}
            >
              この案を元に別の献立を作り直す
            </Button>
            {showReconcile ? (
              <Button variant="secondary" disabled={reconcileDisabled} onClick={onOpenReconcile}>
                買い物リストの差分を見る
              </Button>
            ) : null}
            {canUpdatePostCook ? (
              <Button variant="secondary" disabled={!actionsEnabled} onClick={onOpenPostCook}>
                使った食材の在庫を更新
              </Button>
            ) : null}
            {showRetarget ? (
              <Button
                variant="secondary"
                disabled={!retargetEnabled || retargetPending}
                onClick={onRetarget}
              >
                条件を変えて作り直す
              </Button>
            ) : null}
          </>
        }
      />

      <Stack gap={3}>
        {retargetError !== null && <p role="alert">{retargetError}</p>}

        {shoppingError !== null && <p role="alert">{shoppingError}</p>}

        {shoppingIntentActive && actionsEnabled ? (
          <p role="status">この献立で買い物リストを作れます</p>
        ) : null}
        {shoppingIntentActive && revalidationPhase === "checking" ? (
          <p role="status">買い物リストを作る前に、いまの家族設定を確認しています</p>
        ) : null}
        {/* HR1: soft 飛行中は恒久拒否ではなく再確認待ち（invalid アラートと混同しない） */}
        {shoppingIntentActive && isSoftRechecking ? (
          <p role="status">買い物リストを作る前に、いまの家族設定を再確認しています</p>
        ) : null}
        {shoppingIntentActive &&
        (revalidationPhase === "error" || (revalidationPhase === "checked" && !gateOpen)) ? (
          <Surface as="section" role="alert" tone="notice">
            <Inset pad={5}>
              <Stack gap={3}>
                <p>
                  {shoppingRejectedMessage ??
                    "現在の家族設定ではこの献立から買い物リストを作れません"}
                </p>
                <Link className="button-link" to={historyPathForShopping()}>
                  履歴に戻る
                </Link>
                <Link className="button-link" to="/shopping">
                  買い物に戻る
                </Link>
              </Stack>
            </Inset>
          </Surface>
        ) : null}
      </Stack>
    </>
  );
}
