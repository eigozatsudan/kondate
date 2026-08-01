import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { MenuResultViewModel } from "@shared/contracts/menu-result";
import {
  createShoppingListRequestSchema,
  reconcileShoppingListRequestSchema,
  type CreateShoppingListRequest,
  type ReconcileShoppingListRequest,
  type ShoppingDiff,
} from "@shared/contracts/shopping";
import { FlyerUpsellBanner } from "@/features/billing/flyer-upsell-banner";
import {
  EASE_SOFT_NOT_SWALLOW_DISCLAIMER,
  MENU_LABEL_DISCLAIMER,
} from "@/features/generation/components/idea-menu-safety-notice";
import {
  MENU_ACCEPT_NOTICE_SHOPPING_READY,
  MENU_ACCEPT_NOTICE_SHOPPING_WAIT,
  MENU_ACCEPT_NOTICE_TITLE,
  MenuResultActionBar,
} from "@/features/generation/components/menu-result-action-bar";
import { confirmLabelConfirmation } from "@/features/generation/api/confirm-label-api";
import { MenuResult, type MenuResultActions } from "@/features/generation/components/menu-result";
import { useUsageToday } from "@/features/generation/hooks/use-usage-today";
import { isRevalidationActionable } from "@/features/history/api/revalidation-api";
import {
  RegenerationSheet,
  type RegenerationReasonInput,
} from "@/features/history/components/regeneration-sheet";
import { MenuVersionSwitcher } from "@/features/history/components/menu-version-switcher";
import { useAcceptMenuVersion, useDerivationVersions } from "@/features/history/hooks/use-history";
import { useMenuRevalidation } from "@/features/history/hooks/use-menu-revalidation";
import { useRegeneration } from "@/features/history/hooks/use-regeneration";
import { derivationVersionUiState } from "@/features/history/model/derivation-version-ui";
import {
  hasMissingPantrySelectionsForRegeneration,
  listExpiredPantryForRegeneration,
} from "@/features/history/model/expired-pantry-for-regen";
import {
  createPantryItem,
  deletePantryItem,
  listPantryItems,
  pantryKeys,
  updatePantryItem,
} from "@/features/pantry/pantry-api";
import { createPlannerDraftFromMenu } from "@/features/planner/model/draft-from-menu";
import { getPlannerDraft, plannerKeys, savePlannerDraft } from "@/features/planner/planner-api";
import {
  clearShoppingCommand,
  fetchReconcilableMenuSource,
  persistedShoppingCommand,
  previewShoppingDiff,
} from "@/features/shopping/api/shopping-api";
import { CreateListSheet } from "@/features/shopping/components/create-list-sheet";
import { ReconcileListSheet } from "@/features/shopping/components/reconcile-list-sheet";
import {
  shoppingKeys,
  useCreateShoppingList,
  useReconcileShoppingList,
  useResumeShoppingCommand,
  useShoppingList,
  useShoppingSafetyGate,
} from "@/features/shopping/hooks/use-shopping-list";
import {
  hasPendingCreateCommand,
  hasShoppingDidAutoOpen,
  historyPathForShopping,
  isShoppingSheetExpected,
} from "@/features/shopping/shopping-intent";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import {
  type MenuDetailRevalidationView,
  type MenuDetailSurface,
} from "./menu-detail-types";
import { usageViewFromQuery } from "./usage-view-from-query";

export type HouseholdMenuDetailBodyProps = {
  result: MenuResultViewModel;
  menuId: string;
  userId: string | undefined;
  shoppingIntentActive: boolean;
  markShoppingAutoOpened: () => void;
  clearShoppingSheetExpected: () => void;
  clearShoppingCycle: () => void;
  injectedRevalidation?: MenuDetailRevalidationView;
  surface: MenuDetailSurface;
};

/**
 * household履歴の詳細本文。既存の家族安全再検証・採用・再生成・買い物・
 * 冷蔵庫連携をすべて維持する。買い物 intent の auto-open は MenuResultPage と同契約。
 */
export function HouseholdMenuDetailBody({
  result,
  menuId,
  userId,
  shoppingIntentActive,
  markShoppingAutoOpened,
  clearShoppingSheetExpected,
  clearShoppingCycle,
  injectedRevalidation,
  surface,
}: HouseholdMenuDetailBodyProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const live = useMenuRevalidation(menuId);
  const liveView: MenuDetailRevalidationView = {
    phase: live.phase,
    ...(live.result !== undefined ? { result: live.result } : {}),
    ...(live.errorMessage !== undefined ? { errorMessage: live.errorMessage } : {}),
    isSoftRechecking: live.isSoftRechecking,
    refetch: () => {
      void live.refetch();
    },
    beginRecheck: live.beginRecheck,
  };
  const revalidation = injectedRevalidation ?? liveView;
  const isSoftRechecking = revalidation.isSoftRechecking ?? false;

  const usage = useUsageToday(userId ?? "");
  const usageView = usageViewFromQuery(usage);
  const pantryQuery = useQuery({
    queryKey: pantryKeys.list(userId ?? "missing"),
    queryFn: () => listPantryItems(getBrowserSupabaseClient(), userId ?? ""),
    enabled: userId !== undefined,
  });
  const expiredPantryItems = useMemo(
    () =>
      listExpiredPantryForRegeneration(result.sourceSubmission, pantryQuery.data ?? [], new Date()),
    [pantryQuery.data, result.sourceSubmission],
  );
  // HR5: live に無い selection は期限 UI に出ないため、欠落を別ゲートで塞ぐ
  // isSuccess 時 data は確定するので ?? [] は不要（exact narrowing）
  const missingPantrySelections =
    pantryQuery.isSuccess &&
    hasMissingPantrySelectionsForRegeneration(result.sourceSubmission, pantryQuery.data);
  // HR-I1: 冷蔵庫未取得・失敗時は期限確認 UI を開かない
  // HR5: 欠落 selection があるときは再生成 CTA を閉じる（server 422 を先回り）
  const pantryGateReady = pantryQuery.isSuccess && !missingPantrySelections;
  const pantryGateMessage = pantryQuery.isError
    ? "冷蔵庫を確認できません。通信を確認してから別案を作り直してください。"
    : pantryQuery.isPending
      ? "冷蔵庫を確認しています…"
      : missingPantrySelections
        ? "作成時に選んだ冷蔵庫の食材がありません。条件を変えて作り直してください。"
        : null;
  const regeneration = useRegeneration({
    targetMode: "household",
    menuId,
    phase: revalidation.phase,
    result: revalidation.result,
    isSoftRechecking,
  });
  const accept = useAcceptMenuVersion();
  const versionsQuery = useDerivationVersions(result.derivationGroupId);
  const siblingVersions = versionsQuery.data ?? [];
  const { confirmedSingle, versionsFailed } = derivationVersionUiState(versionsQuery);
  const [sheetMode, setSheetMode] = useState<"whole" | "dish" | null>(null);
  const [postCookOpen, setPostCookOpen] = useState(false);
  const [selectedDishId, setSelectedDishId] = useState<string | null>(null);
  /** 採用成功後は買い物リスト作成を主操作に昇格。is_selected も hydrate。 */
  const [accepted, setAccepted] = useState(result.isSelected);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [retargetError, setRetargetError] = useState<string | null>(null);
  const [retargetPending, setRetargetPending] = useState(false);

  useEffect(() => {
    setAccepted(result.isSelected);
  }, [menuId]);
  useEffect(() => {
    if (result.isSelected) setAccepted(true);
  }, [result.isSelected]);

  // gateOpen: 本文表示（soft 飛行中も直前 checked を維持 = focus 点滅防止）
  const gateOpen =
    revalidation.phase === "checked" &&
    revalidation.result !== undefined &&
    isRevalidationActionable(revalidation.result);
  // actionsEnabled: 採用/再生成/買い物 mutation（HR1: soft 飛行中は閉じる）
  const actionsEnabled = gateOpen && !isSoftRechecking;
  // HR4: retarget は checking/error 中は閉じる。checked なら invalid でも許可
  // （使えない献立から条件を変えて作り直す escape hatch）。accept/regen は actionsEnabled。
  // soft 飛行中も retarget は許可（条件変更の escape を閉じない）。
  const retargetEnabled = revalidation.phase === "checked";
  const canUpdatePostCook = result.pantryPostCookTargets.length > 0;

  // D-M7: 安全再検査で操作が閉じたらシート・在庫ダイアログも閉じる（開いたまま送信して unhandled reject しない）
  // soft 飛行中も actionsEnabled=false でシートを閉じる（HR1）。
  useEffect(() => {
    if (!actionsEnabled && sheetMode !== null) {
      setSheetMode(null);
    }
    if (!actionsEnabled && postCookOpen) {
      setPostCookOpen(false);
    }
  }, [actionsEnabled, postCookOpen, sheetMode]);

  // 結果画面と同等: 買い物は献立再検証と買い物ゲートの両方が通るまで組み立てない
  const shoppingList = useShoppingList();
  const shoppingGate = useShoppingSafetyGate();
  const createList = useCreateShoppingList();
  const reconcileList = useReconcileShoppingList();
  const [shoppingSheet, setShoppingSheet] = useState<"create" | "reconcile" | null>(null);
  const [shoppingDiff, setShoppingDiff] = useState<ShoppingDiff | null>(null);
  const [shoppingError, setShoppingError] = useState<string | null>(null);
  const activeList = shoppingList.data ?? null;
  // 使用中リストの操作（差分反映など）は safety gate で止める。
  // ただし mode=new の新規作成は、削除済み献立で gate が恒久 blocked でも可能にする（D-C1）。
  // isFetching（裏 refetch）では busy にしない。success 済みならシートを開いたままにする。
  const shoppingListBusy =
    menuId.length === 0 ||
    (!shoppingList.isSuccess && (shoppingList.isPending || shoppingList.isLoading));
  const shoppingMutateBlocked =
    !actionsEnabled || shoppingGate.blocked || shoppingListBusy || shoppingList.isFetching;
  // 開く条件（ボタン disabled / auto-open）。閉じる条件とは分離（L8）
  const canOpenCreateSheet = actionsEnabled && !shoppingListBusy && !createList.isPending;
  // 一時的な phase=checking ではシートを閉じない（invalid/error のみ fail-closed）
  const mustCloseCreateSheet =
    revalidation.phase === "error" ||
    (revalidation.phase === "checked" &&
      revalidation.result !== undefined &&
      !isRevalidationActionable(revalidation.result));
  // soft 飛行中は CTA を閉じるが、reconcile シートは invalid/error のみ fail-closed で閉じる
  // （focus soft だけでシートが点滅して消えないように。送信は safetyBlocked で止める）
  const mustCloseReconcileSheet = mustCloseCreateSheet || shoppingGate.blocked;
  const canCreateShoppingList = canOpenCreateSheet;
  const nonRemovedCount =
    activeList === null ? 0 : activeList.items.filter((item) => !item.isRemovedByUser).length;

  // 安全 fail-closed: create/reconcile シートを閉じる（isPending では閉じない）
  useEffect(() => {
    if (mustCloseCreateSheet && shoppingSheet === "create") {
      setShoppingSheet(null);
      clearShoppingSheetExpected();
    }
    if (mustCloseReconcileSheet && shoppingSheet === "reconcile") {
      setShoppingSheet(null);
    }
  }, [mustCloseCreateSheet, mustCloseReconcileSheet, shoppingSheet, clearShoppingSheetExpected]);

  // auto-open / StrictMode sheetExpected 復帰
  useEffect(() => {
    if (menuId.length === 0) return;
    if (shoppingSheet !== null) return;
    if (hasPendingCreateCommand(menuId)) return;
    if (!canOpenCreateSheet) return;

    const restore = isShoppingSheetExpected(menuId);
    const firstOpen = shoppingIntentActive && !hasShoppingDidAutoOpen(menuId);
    if (!restore && !firstOpen) return;

    setShoppingSheet("create");
    if (firstOpen) {
      markShoppingAutoOpened();
    }
    requestAnimationFrame(() => {
      const el = document.getElementById("create-list-title");
      el?.scrollIntoView({ block: "nearest" });
      el?.focus();
    });
  }, [menuId, shoppingSheet, canOpenCreateSheet, shoppingIntentActive, markShoppingAutoOpened]);

  const queryKey = useMemo(
    () => ["menu-result", userId ?? "missing", menuId] as const,
    [menuId, userId],
  );

  const ownerId = userId ?? "missing";
  const reconcileTarget = useQuery({
    queryKey: shoppingKeys.reconcileTarget(ownerId, menuId, activeList?.id ?? "none"),
    queryFn: () => fetchReconcilableMenuSource(menuId, activeList?.id ?? "none"),
    enabled: activeList !== null && actionsEnabled,
    staleTime: 30_000,
  });

  const finishShoppingCommand = async (kind: "create" | "reconcile", targetId: string) => {
    await queryClient.invalidateQueries({ queryKey: shoppingKeys.active(ownerId) });
    await queryClient.invalidateQueries({ queryKey: ["shopping", "reconcile-target"] });
    clearShoppingCommand(kind, targetId);
    setShoppingSheet(null);
    setShoppingDiff(null);
  };
  const failShoppingCommand = (kind: "create" | "reconcile", targetId: string, error: unknown) => {
    if (error instanceof Error && "code" in error) {
      clearShoppingCommand(kind, targetId);
      void queryClient.invalidateQueries({ queryKey: shoppingKeys.active(ownerId) });
      void queryClient.invalidateQueries({ queryKey });
      setShoppingSheet(null);
      setShoppingDiff(null);
      // 意図的クローズ後に sheetExpected 復帰で再 open しない
      clearShoppingSheetExpected();
      setShoppingError("買い物リストの状態が変わりました。もう一度確認してください");
      return;
    }
    setShoppingError("買い物リストを更新できませんでした。通信が戻ると自動で送り直します");
  };

  const submitCreate = async (command: CreateShoppingListRequest) => {
    try {
      await createList.mutateAsync(command);
      await finishShoppingCommand("create", command.menuId);
      clearShoppingCycle();
      void navigate("/shopping");
    } catch (error) {
      failShoppingCommand("create", command.menuId, error);
    }
  };
  const submitReconcile = async (listId: string, command: ReconcileShoppingListRequest) => {
    try {
      await reconcileList.mutateAsync({ listId, input: command });
      await finishShoppingCommand("reconcile", listId);
      void navigate("/shopping");
    } catch (error) {
      failShoppingCommand("reconcile", listId, error);
    }
  };

  useResumeShoppingCommand({
    kind: "create",
    targetId: menuId,
    schema: createShoppingListRequestSchema,
    submit: submitCreate,
  });
  useResumeShoppingCommand({
    kind: "reconcile",
    targetId: activeList?.id ?? null,
    schema: reconcileShoppingListRequestSchema,
    submit: (command: ReconcileShoppingListRequest) =>
      submitReconcile(activeList?.id ?? "", command),
  });

  const firstDishId = result.menu.dishes[0]?.id ?? null;
  const dishIdForRegen = selectedDishId ?? firstDishId;

  const actions = useMemo((): MenuResultActions | undefined => {
    if (userId === undefined || revalidation.result === undefined) {
      return undefined;
    }
    const client = getBrowserSupabaseClient();
    const safetyFingerprint = revalidation.result.safetyFingerprint;
    // beginRecheck は live gate 由来で安定。注入テストで未指定なら no-op。
    // レンダーごとに作るフォールバック関数を deps に載せない（exhaustive-deps 警告回避）。
    const beginRecheck = revalidation.beginRecheck;
    return {
      menuId,
      userId,
      onConfirmLabel: async (confirmationId, expectedSafetyFingerprint) => {
        try {
          await confirmLabelConfirmation(
            menuId,
            confirmationId,
            expectedSafetyFingerprint || safetyFingerprint,
          );
          await queryClient.invalidateQueries({ queryKey });
          beginRecheck?.();
        } catch (error) {
          beginRecheck?.();
          throw error;
        }
      },
      onDeletePantry: async (row) => {
        await deletePantryItem(client, userId, row.id, row.updatedAt);
        await queryClient.invalidateQueries({ queryKey: pantryKeys.list(userId) });
      },
      onUpdatePantry: async (row, input) => {
        await updatePantryItem(client, userId, row.id, row.updatedAt, input);
        await queryClient.invalidateQueries({ queryKey: pantryKeys.list(userId) });
      },
      onCreatePantry: async (input) => {
        await createPantryItem(client, userId, input);
        await queryClient.invalidateQueries({ queryKey: pantryKeys.list(userId) });
      },
      onRefetchResult: async () => {
        await queryClient.invalidateQueries({ queryKey });
      },
    };
  }, [menuId, queryClient, queryKey, revalidation.beginRecheck, revalidation.result, userId]);

  const statusCopy = useMemo(() => {
    if (revalidation.phase === "checking") return "現在の家族設定で確認しています";
    if (revalidation.phase === "error") return revalidation.errorMessage ?? "確認できませんでした";
    // HR1: soft 飛行中は本文を維持しつつ「再確認中」を示し CTA だけ閉じる
    if (isSoftRechecking) return "いまの家族設定を再確認しています";
    if (revalidation.result?.status === "changed") {
      return "現在の家族設定で確認しました。作成時から条件が変わっています";
    }
    if (revalidation.result?.status === "valid") return "現在の家族設定で確認しました";
    return null;
  }, [isSoftRechecking, revalidation]);

  // HR-I2: changedDetails を日本語で明示（§9.1）。
  const changedDetailLines = useMemo(() => {
    if (revalidation.result?.status !== "changed") return [];
    const labelByCode = {
      pantry_item_removed: "冷蔵庫の食材が削除されています",
      pantry_quantity_changed: "在庫量が変わっています",
      preference_changed: "好みの設定が変わっています",
    } as const;
    const labels = new Set<string>();
    for (const code of revalidation.result.changedDetails) {
      labels.add(labelByCode[code]);
    }
    return [...labels];
  }, [revalidation.result]);

  const onSubmitReason = async (value: RegenerationReasonInput) => {
    if (sheetMode === "dish") {
      if (dishIdForRegen === null) return;
      await regeneration.startDish(dishIdForRegen, value);
    } else {
      await regeneration.startWhole(value);
    }
    setSheetMode(null);
  };

  const onRetarget = async () => {
    // HR4: checking/error 中は下書き上書きを始めない
    if (!retargetEnabled || result.sourceSubmission === null || userId === undefined) return;
    setRetargetError(null);
    setRetargetPending(true);
    try {
      const client = getBrowserSupabaseClient();
      const existing = await getPlannerDraft(client, userId);
      const draft = createPlannerDraftFromMenu(result.sourceSubmission);
      await savePlannerDraft(client, userId, draft, existing?.revision ?? 0);
      await queryClient.invalidateQueries({ queryKey: plannerKeys.draft(userId) });
      void navigate("/planner?resume=audience");
    } catch {
      setRetargetError("献立条件を引き継げませんでした。もう一度お試しください");
    } finally {
      setRetargetPending(false);
    }
  };

  return (
    <main className="page-frame guided-planner-theme min-w-0 overflow-x-hidden break-words text-ink [overflow-wrap:anywhere]">
      <p className="rounded-xl border border-amber-700 p-3 font-semibold">
        {MENU_LABEL_DISCLAIMER}
      </p>
      <p className="type-small text-ink/80">{EASE_SOFT_NOT_SWALLOW_DISCLAIMER}</p>
      {surface.showFlyerUpsell && usage.isSuccess && !usage.data.plusEntitled ? (
        <div className="mt-4">
          <FlyerUpsellBanner plusEntitled={false} />
        </div>
      ) : null}

      {revalidation.phase === "checking" && (
        <div
          className="revalidation-checking-overlay"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="revalidation-checking-panel">
            <div className="gen-status-indicator" aria-hidden="true" />
            <p>現在の家族設定で確認しています</p>
          </div>
        </div>
      )}

      {revalidation.phase === "error" && (
        <div className="mt-4 stack gap-2">
          <p role="alert">{statusCopy}</p>
          <button
            type="button"
            className="min-h-11 rounded-lg border-2 border-terracotta-700 px-4 font-semibold"
            onClick={() => {
              revalidation.refetch?.();
            }}
          >
            もう一度確認
          </button>
        </div>
      )}

      {revalidation.phase === "checked" && revalidation.result?.status === "invalid" && (
        <div className="mt-4 stack gap-2" role="alert">
          <p>現在の家族設定ではこの献立を利用できません</p>
          <ul className="list-disc pl-5">
            {revalidation.result.issues.map((issue) => (
              <li key={`${issue.code}:${issue.path}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      <MenuVersionSwitcher
        versions={siblingVersions}
        currentMenuId={menuId}
        pathForMenuId={surface.pathForMenuId}
      />
      {versionsFailed ? (
        <p className="mb-2" role="alert">
          案の一覧を読み込めませんでした。
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => {
              void versionsQuery.refetch();
            }}
          >
            もう一度読み込む
          </button>
        </p>
      ) : null}

      {gateOpen && revalidation.result !== undefined && (
        <>
          <div
            className="menu-result-gate-status sticky top-0 z-10 bg-canvas/95 py-2"
            role="status"
          >
            <p className="m-0">{statusCopy}</p>
            {changedDetailLines.length > 0 && (
              <ul className="mt-1 list-disc pl-5 type-small">
                {changedDetailLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
          {actions === undefined ? (
            <MenuResult
              result={result}
              mode="household"
              currentLabelWarnings={revalidation.result.currentLabelWarnings}
              currentSafetyFingerprint={revalidation.result.safetyFingerprint}
              postCookOpen={postCookOpen}
              onPostCookClose={() => {
                setPostCookOpen(false);
              }}
              onSelectedDishChange={setSelectedDishId}
              onRegenerateSelectedDish={() => {
                // HR1/HR5: soft 飛行中・pantry ゲート未通過では皿別案を開かない
                if (!actionsEnabled || !pantryGateReady) return;
                setSheetMode("dish");
              }}
              regenerateSelectedDishDisabled={
                dishIdForRegen === null || !pantryGateReady || !actionsEnabled
              }
            />
          ) : (
            <MenuResult
              result={result}
              mode="household"
              actions={actions}
              currentLabelWarnings={revalidation.result.currentLabelWarnings}
              currentSafetyFingerprint={revalidation.result.safetyFingerprint}
              postCookOpen={postCookOpen}
              onPostCookClose={() => {
                setPostCookOpen(false);
              }}
              onSelectedDishChange={setSelectedDishId}
              onRegenerateSelectedDish={() => {
                if (!actionsEnabled || !pantryGateReady) return;
                setSheetMode("dish");
              }}
              regenerateSelectedDishDisabled={
                dishIdForRegen === null || !pantryGateReady || !actionsEnabled
              }
            />
          )}
          {acceptError !== null && (
            <p className="mt-2" role="alert">
              {acceptError}
            </p>
          )}
          {pantryGateMessage !== null && (
            <p className="mt-2" role="status">
              {pantryGateMessage}
            </p>
          )}
        </>
      )}

      <MenuResultActionBar
        notice={
          accepted ? (
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
          // 単一案の採用降格は買い物が作れるときだけ（C5 / 再検証中の死んだ主操作防止）
          accepted || (confirmedSingle && canCreateShoppingList) ? (
            <button
              type="button"
              className={
                canCreateShoppingList ? "primary-button min-h-11" : "secondary-button min-h-11"
              }
              disabled={!canCreateShoppingList}
              onClick={() => {
                setShoppingError(null);
                setShoppingSheet("create");
              }}
            >
              材料の買い物リストを作る
            </button>
          ) : (
            <button
              type="button"
              className="primary-button min-h-11"
              disabled={!actionsEnabled || accept.isPending}
              onClick={() => {
                // HR3: RPC は所有権のみ。クライアントで checked+actionable を再確認してから呼ぶ
                if (!actionsEnabled) return;
                setAcceptError(null);
                accept.mutate(menuId, {
                  onSuccess: () => {
                    setAccepted(true);
                  },
                  onError: () => {
                    setAcceptError("採用を保存できませんでした。もう一度お試しください");
                  },
                });
              }}
            >
              この献立にする
            </button>
          )
        }
        next={
          accepted || (confirmedSingle && canCreateShoppingList) ? null : (
            <button
              type="button"
              className="secondary-button min-h-11"
              disabled={!canCreateShoppingList}
              onClick={() => {
                setShoppingError(null);
                setShoppingSheet("create");
              }}
            >
              材料の買い物リストを作る
            </button>
          )
        }
        auxiliaries={
          <>
            {!accepted && confirmedSingle && canCreateShoppingList ? (
              <button
                type="button"
                className="secondary-button min-h-11"
                // canCreateShoppingList 成立時は actionsEnabled（再 render で外れる）
                disabled={accept.isPending}
                onClick={() => {
                  setAcceptError(null);
                  accept.mutate(menuId, {
                    onSuccess: () => {
                      setAccepted(true);
                    },
                    onError: () => {
                      setAcceptError("採用を保存できませんでした。もう一度お試しください");
                    },
                  });
                }}
              >
                この献立にする
              </button>
            ) : null}
            <button
              type="button"
              className="secondary-button min-h-11"
              disabled={!actionsEnabled || !pantryGateReady}
              onClick={() => {
                if (!pantryGateReady) return;
                setSheetMode("whole");
              }}
            >
              この案を元に別の献立を作り直す
            </button>
            {reconcileTarget.data !== null && reconcileTarget.data !== undefined ? (
              <button
                type="button"
                className="secondary-button min-h-11"
                disabled={shoppingMutateBlocked || reconcileList.isPending}
                onClick={() => {
                  const target = reconcileTarget.data;
                  if (activeList === null || target === null) return;
                  setShoppingError(null);
                  previewShoppingDiff(menuId, target.sourceMenuVersion, activeList)
                    .then((diff) => {
                      setShoppingDiff(diff);
                      setShoppingSheet("reconcile");
                    })
                    .catch(() => {
                      setShoppingError("差分を確認できませんでした");
                    });
                }}
              >
                買い物リストの差分を見る
              </button>
            ) : null}
            {canUpdatePostCook ? (
              <button
                type="button"
                className="secondary-button min-h-11"
                disabled={!actionsEnabled}
                onClick={() => {
                  setPostCookOpen(true);
                }}
              >
                使った食材の在庫を更新
              </button>
            ) : null}
            {result.sourceSubmission !== null ? (
              <button
                type="button"
                className="secondary-button min-h-11"
                disabled={!retargetEnabled || retargetPending}
                onClick={() => {
                  if (!retargetEnabled) return;
                  void onRetarget();
                }}
              >
                条件を変えて作り直す
              </button>
            ) : null}
          </>
        }
      />

      {retargetError !== null && (
        <p role="alert" className="mt-4">
          {retargetError}
        </p>
      )}

      {shoppingError !== null && (
        <p role="alert" className="mt-4">
          {shoppingError}
        </p>
      )}

      {shoppingIntentActive && actionsEnabled ? (
        <p className="mt-4" role="status">
          この献立で買い物リストを作れます
        </p>
      ) : null}
      {shoppingIntentActive && revalidation.phase === "checking" ? (
        <p className="mt-4" role="status">
          買い物リストを作る前に、いまの家族設定を確認しています
        </p>
      ) : null}
      {/* HR1: soft 飛行中は恒久拒否ではなく再確認待ち（invalid アラートと混同しない） */}
      {shoppingIntentActive && isSoftRechecking ? (
        <p className="mt-4" role="status">
          買い物リストを作る前に、いまの家族設定を再確認しています
        </p>
      ) : null}
      {shoppingIntentActive &&
      (revalidation.phase === "error" || (revalidation.phase === "checked" && !gateOpen)) ? (
        <section className="card stack mt-4" role="alert">
          <p>
            {revalidation.errorMessage ?? "現在の家族設定ではこの献立から買い物リストを作れません"}
          </p>
          <Link className="secondary-button min-h-11" to={historyPathForShopping()}>
            履歴に戻る
          </Link>
          <Link className="secondary-button min-h-11" to="/shopping">
            買い物に戻る
          </Link>
        </section>
      ) : null}

      {shoppingSheet === "create" && (
        <CreateListSheet
          key={`${activeList?.id ?? "none"}-${String(activeList?.version ?? 0)}`}
          activeList={
            activeList === null
              ? null
              : {
                  id: activeList.id,
                  version: activeList.version,
                  itemCount: nonRemovedCount,
                }
          }
          pending={createList.isPending}
          // L8: 開く条件 (canOpenCreateSheet) に isFetching を含むため、
          // 表示中の再取得で「作成する」が disable 点滅しないよう送信は actionsEnabled のみ見る。
          safetyBlocked={!actionsEnabled}
          forceNewMode={shoppingGate.blocked}
          onSubmit={(input) => {
            // 表示中 isFetching では止めない（safetyBlocked と同じく actions のみ）
            if (!actionsEnabled || createList.isPending) return;
            const command = persistedShoppingCommand(
              "create",
              menuId,
              createShoppingListRequestSchema,
              (idempotencyKey) => ({
                menuId,
                mode: input.mode,
                // mode=new でも active があるときは SQL がアーカイブ用に正確な id/version を要求する。
                // append 専用に null へ落とすと list_version_conflict になり「新しいリストにする」が常に失敗する。
                activeListId: input.activeListId,
                expectedListVersion: input.expectedListVersion,
                idempotencyKey,
              }),
            );
            void submitCreate(command);
          }}
          onCancel={() => {
            setShoppingSheet(null);
            clearShoppingCycle();
          }}
        />
      )}

      {shoppingSheet === "reconcile" &&
        shoppingDiff !== null &&
        activeList !== null &&
        reconcileTarget.data !== null &&
        reconcileTarget.data !== undefined && (
          <ReconcileListSheet
            diff={shoppingDiff}
            pending={reconcileList.isPending}
            safetyBlocked={shoppingMutateBlocked}
            onApply={(approval) => {
              const target = reconcileTarget.data;
              if (shoppingMutateBlocked || target === null) return;
              const listId = activeList.id;
              const command = persistedShoppingCommand(
                "reconcile",
                listId,
                reconcileShoppingListRequestSchema,
                (idempotencyKey) => ({
                  expectedListVersion: activeList.version,
                  sourceMenuId: menuId,
                  sourceMenuVersion: target.sourceMenuVersion,
                  idempotencyKey,
                  approval,
                }),
              );
              void submitReconcile(listId, command);
            }}
            onCancel={() => {
              setShoppingSheet(null);
              setShoppingDiff(null);
            }}
          />
        )}

      {sheetMode !== null && (
        <RegenerationSheet
          targetMode="household"
          usage={usageView}
          actionsEnabled={actionsEnabled}
          expiredPantryItems={expiredPantryItems}
          onSubmit={onSubmitReason}
          onCancel={() => {
            setSheetMode(null);
          }}
        />
      )}
    </main>
  );
}
