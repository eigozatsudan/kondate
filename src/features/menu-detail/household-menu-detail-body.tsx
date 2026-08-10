import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { MenuResultViewModel } from "@shared/contracts/menu-result";
import {
  createShoppingListRequestSchema,
  reconcileShoppingListRequestSchema,
  type CreateShoppingListRequest,
  type ReconcileShoppingListRequest,
  type ShoppingDiff,
} from "@shared/contracts/shopping";
import { FlyerUpsellBanner } from "@/features/billing/flyer-upsell-banner";
import { MenuActions } from "@/features/menu-detail/menu-actions";
import { MenuSafetyNotice } from "@/features/menu-detail/menu-safety-notice";
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
  claimShoppingCommand,
  clearShoppingCommand,
  fetchReconcilableMenuSource,
  isCreateShoppingStickyReusable,
  isReconcileShoppingStickyReusable,
  previewShoppingDiff,
  reconcileCommandTargetId,
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
  cancelPendingResumeSuppressClear,
  clearShoppingResumeSuppress,
  discardAppendCreateCommandIfPresent,
  hasPendingCreateCommand,
  hasShoppingDidAutoOpen,
  isShoppingResumeSuppressed,
  isShoppingSheetExpected,
  markShoppingResumeSuppress,
  scheduleResumeSuppressClear,
} from "@/features/shopping/shopping-intent";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { Button } from "@/shared/ui/button";
import { Stack } from "@/shared/ui/stack";
import { type MenuDetailRevalidationView, type MenuDetailSurface } from "./menu-detail-types";
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
    isOfflineHold: live.isOfflineHold,
    refetch: () => {
      void live.refetch();
    },
    beginRecheck: live.beginRecheck,
  };
  const revalidation = injectedRevalidation ?? liveView;
  const isSoftRechecking = revalidation.isSoftRechecking ?? false;
  const isOfflineHold = revalidation.isOfflineHold ?? false;

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
  // HR5: sourceSubmission 欠落は server が envelope 422 になるため UI で先に閉じる
  const sourceSubmissionMissing = result.sourceSubmission === null;
  // HR-I1: 冷蔵庫未取得・失敗時は期限確認 UI を開かない
  // HR5: 欠落 selection / null submission のときは再生成 CTA を閉じる（server 422 を先回り）
  const pantryGateReady =
    pantryQuery.isSuccess && !missingPantrySelections && !sourceSubmissionMissing;
  const pantryGateMessage = pantryQuery.isError
    ? "冷蔵庫を確認できません。通信を確認してから別案を作り直してください。"
    : pantryQuery.isPending
      ? "冷蔵庫を確認しています…"
      : sourceSubmissionMissing
        ? "作成時の条件を読み込めないため、別案を作り直せません。"
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

  // HR1/HR2: menuId 切替と isSelected 変化の両方で accepted を同期。
  // 兄弟案キャッシュの residual true は useAcceptMenuVersion 側で落とす（HR1）。
  // isSelected false でも accepted を残すと invalid 後に死んだ買い物 primary になる（HR2）。
  useEffect(() => {
    setAccepted(result.isSelected);
  }, [menuId, result.isSelected]);

  // gateOpen: 本文表示（soft 飛行中も直前 checked を維持 = focus 点滅防止）
  const gateOpen =
    revalidation.phase === "checked" &&
    revalidation.result !== undefined &&
    isRevalidationActionable(revalidation.result);
  // actionsEnabled: 採用/再生成/買い物 mutation（HR1: soft 飛行中は閉じる）
  const actionsEnabled = gateOpen && !isSoftRechecking;
  // HR8: soft 開始〜再描画のあいだ onClick クロージャが stale な actionsEnabled=true のまま
  // 残っても、最新値で RPC を止める（primary / 補助採用の両方）
  const actionsEnabledRef = useRef(actionsEnabled);
  actionsEnabledRef.current = actionsEnabled;
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
  // HR2: notice と同型に gateOpen を要求。invalid 後に disabled 買い物を primary に残さない。
  // soft 中は gateOpen 維持のまま canCreate が false → shopping 枝だが disabled（一時）。
  const shoppingAsPrimary = (accepted && gateOpen) || (confirmedSingle && canCreateShoppingList);
  const nonRemovedCount =
    activeList === null ? 0 : activeList.items.filter((item) => !item.isRemovedByUser).length;
  // HR3: preview/apply の await 後に最新 gate を読む（クロージャ stale を避ける）
  const shoppingMutateBlockedRef = useRef(shoppingMutateBlocked);
  shoppingMutateBlockedRef.current = shoppingMutateBlocked;
  const revalidationFingerprintRef = useRef<string | undefined>(
    revalidation.result?.safetyFingerprint,
  );
  revalidationFingerprintRef.current = revalidation.result?.safetyFingerprint;
  // HR3: preview 開始時 FP。Apply 前に照合して hard 後の stale diff 適用を閉じる
  const reconcileDiffFingerprintRef = useRef<string | null>(null);

  // 安全 fail-closed: create/reconcile シートを閉じる（isPending では閉じない）
  useEffect(() => {
    if (mustCloseCreateSheet && shoppingSheet === "create") {
      setShoppingSheet(null);
      clearShoppingSheetExpected();
      // 強制クローズはユーザーの選び直し中断とみなし suppress を落とす（復帰後 resume 可）
      clearShoppingResumeSuppress("create", menuId);
    }
    if (mustCloseReconcileSheet && shoppingSheet === "reconcile") {
      setShoppingSheet(null);
      setShoppingDiff(null);
      reconcileDiffFingerprintRef.current = null;
      if (activeList !== null) {
        clearShoppingResumeSuppress("reconcile", reconcileCommandTargetId(activeList.id, menuId));
      }
    }
  }, [
    mustCloseCreateSheet,
    mustCloseReconcileSheet,
    shoppingSheet,
    clearShoppingSheetExpected,
    menuId,
    activeList,
  ]);

  // SHOP1: menu-detail 真 unmount で create resume-suppress を遅延 clear。
  // Cancel なし abandon-navigate 後も sticky があるなら auto-resume を再開する。
  // StrictMode remount では cancel が先に走り SHOP6（選び直し中 suppress 保持）を壊さない。
  // sticky は触らない（SHOP2 pause-not-abandon）。
  useEffect(() => {
    if (menuId.length === 0) return;
    cancelPendingResumeSuppressClear("create", menuId);
    return () => {
      scheduleResumeSuppressClear("create", menuId);
    };
  }, [menuId]);

  // SHOP1 + SHOP9: reconcile suppress は listId:sourceMenuId 粒度。
  // create とは deps を分け、activeList 変化で create suppress を誤 clear しない。
  useEffect(() => {
    const listId = activeList?.id;
    if (listId === undefined || menuId.length === 0) return;
    const reconcileTargetId = reconcileCommandTargetId(listId, menuId);
    cancelPendingResumeSuppressClear("reconcile", reconcileTargetId);
    return () => {
      scheduleResumeSuppressClear("reconcile", reconcileTargetId);
    };
  }, [activeList?.id, menuId]);

  // SHOP2 + SHOP1: list gate が真に invalid/unverifiable（error=phase blocked）のときだけ
  // append sticky を捨てる。create resume は blocked（checking 含む）で止むが、checking 中の
  // hard recheck（focus / Realtime）で sticky を捨てると失応答 append 復旧が壊れる（SHOP1）。
  // forceNew 誘導と ready 復帰後の旧 append 自動再送防止は error 時のみ。
  useEffect(() => {
    if (!shoppingGate.error) return;
    if (menuId.length === 0) return;
    if (discardAppendCreateCommandIfPresent(menuId)) {
      setShoppingError(
        "今のリストは家族設定で確認できないため、追加ではなく新しいリストを作り直してください",
      );
    }
  }, [shoppingGate.error, menuId]);

  // auto-open / StrictMode sheetExpected 復帰
  useEffect(() => {
    if (menuId.length === 0) return;
    if (shoppingSheet !== null) return;
    if (hasPendingCreateCommand(menuId)) return;
    if (!canOpenCreateSheet) return;

    const restore = isShoppingSheetExpected(menuId);
    const firstOpen = shoppingIntentActive && !hasShoppingDidAutoOpen(menuId);
    if (!restore && !firstOpen) return;

    // SHOP6 + SHOP3: シート open を Storage に残し remount / 他タブでも旧 sticky resume を抑止
    markShoppingResumeSuppress("create", menuId);
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
    clearShoppingResumeSuppress(kind, targetId);
    setShoppingSheet(null);
    setShoppingDiff(null);
  };
  const failShoppingCommand = (kind: "create" | "reconcile", targetId: string, error: unknown) => {
    if (error instanceof Error && "code" in error) {
      const code = error.code;
      // SHOP1 (adversarial residual / fixable): list_version_conflict は server が
      // early find / concurrent find とも mutation 無しと確定した未適用 409。
      // 同一 key を keep すると expectedListVersion 固定のまま永久 409 になるため、
      // item 経路と同様 sticky+suppress を捨てる。次回 sheet は現行 version で新 key。
      // 適用済み+応答ロストは server が 200 replay するため client に 409 として来ない。
      // version rebuild（同一 key で expectedListVersion だけ載せ替え）は hash 変更で
      // dual-create を再発させるので行わない。isReusable の version 非照合は維持。
      //
      // current_safety_revalidation_required は sticky を保持する。
      // 適用済み create/reconcile + 応答ロスト後に safety が一時 invalid になると
      // replay が 409 になる。ここで clear するとユーザー再送が新 idempotency key になり、
      // mode=new は active を archive して第二リストを作る（進捗 wipe / dual-create）。
      // suppress で auto-resume の 409 ループは止め、safety 復帰後の同一 key 再送を残す。
      // 他 code（list_version_conflict 含む）は sticky+suppress clear。
      if (code === "current_safety_revalidation_required") {
        markShoppingResumeSuppress(kind, targetId);
      } else {
        clearShoppingCommand(kind, targetId);
        clearShoppingResumeSuppress(kind, targetId);
      }
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
    // HR9: soft/checking 中の resume でも mutate しない（pending は enabled 復帰で再試行）
    if (!actionsEnabled) return;
    // SHOP8 + SHOP1: list gate 非 ready 中の append は飛ばさない。
    // 真の invalid/unverifiable（error）だけ sticky を捨て forceNew へ誘導する。
    // checking 中は sticky を保持し ready 復帰後の同一 key 再送を残す（SHOP1）。
    // mode=new は D-C1 どおり blocked でも続行可。
    if (command.mode === "append" && shoppingGate.blocked) {
      if (shoppingGate.error) {
        clearShoppingCommand("create", command.menuId);
        setShoppingError(
          "今のリストは家族設定で確認できないため、追加ではなく新しいリストを作り直してください",
        );
      }
      return;
    }
    try {
      await createList.mutateAsync(command);
      await finishShoppingCommand("create", command.menuId);
      clearShoppingCycle();
      void navigate("/shopping");
    } catch (error) {
      failShoppingCommand("create", command.menuId, error);
    }
  };
  const submitReconcile = async (
    listId: string,
    command: ReconcileShoppingListRequest,
    stickyTargetId: string,
  ) => {
    // HR9: 献立 gate が閉じているあいだは resume も送らない
    if (!actionsEnabled || shoppingGate.blocked) return;
    try {
      await reconcileList.mutateAsync({ listId, input: command });
      await finishShoppingCommand("reconcile", stickyTargetId);
      void navigate("/shopping");
    } catch (error) {
      failShoppingCommand("reconcile", stickyTargetId, error);
    }
  };

  useResumeShoppingCommand({
    kind: "create",
    targetId: menuId,
    schema: createShoppingListRequestSchema,
    submit: submitCreate,
    // HR9: soft/hard 閉じ中は focus resume を止める。true 復帰で effect が再送。
    // SHOP8: list blocked 中は create resume 自体も止め、submit 内の append ガードと二重に閉じる。
    // mode=new の自動再開は gate 復帰後（またはシート手動送信）に委ねる。
    // SHOP1: create シート表示中は resume しない。sheet onSubmit の isReusable
    // （mode 照合 rebuild）を focus/online がすり抜けて旧 sticky を
    // 飛ばす dual-intent 窓を閉じる。シート閉じ後に enabled 復帰で再試行。
    // SHOP6: suppress は sessionStorage。remount で shoppingSheet が null でも
    // 選び直し中の旧 sticky 自動 POST を抑止する。
    // Cancel または menu-detail 真 unmount（SHOP1 遅延 clear）で suppress を落とし sticky 再送。
    enabled:
      actionsEnabled &&
      !shoppingGate.blocked &&
      shoppingSheet !== "create" &&
      !isShoppingResumeSuppressed("create", menuId),
  });
  useResumeShoppingCommand({
    kind: "reconcile",
    // SHOP9: listId だけでは MenuA sticky が MenuB 詳細から resume される。menu 粒度へ。
    targetId: activeList !== null ? reconcileCommandTargetId(activeList.id, menuId) : null,
    schema: reconcileShoppingListRequestSchema,
    submit: (command: ReconcileShoppingListRequest) => {
      if (activeList === null) return Promise.resolve();
      return submitReconcile(
        activeList.id,
        command,
        reconcileCommandTargetId(activeList.id, menuId),
      );
    },
    // SHOP1 + SHOP6: reconcile シート表示中 / suppress 中は resume しない。
    // suppress は Cancel または menu-detail 真 unmount の遅延 clear で落ちる。
    enabled:
      actionsEnabled &&
      !shoppingGate.blocked &&
      shoppingSheet !== "reconcile" &&
      (activeList === null ||
        !isShoppingResumeSuppressed("reconcile", reconcileCommandTargetId(activeList.id, menuId))),
  });

  const firstDishId = result.menu.dishes[0]?.id ?? null;
  const dishIdForRegen = selectedDishId ?? firstDishId;

  const actions = useMemo((): MenuResultActions | undefined => {
    // HR2: soft 飛行中はラベル確認・在庫 mutation も閉じる（action bar と同契約）
    if (userId === undefined || revalidation.result === undefined || isSoftRechecking) {
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
  }, [
    isSoftRechecking,
    menuId,
    queryClient,
    queryKey,
    revalidation.beginRecheck,
    revalidation.result,
    userId,
  ]);

  const statusCopy = useMemo(() => {
    // HR1: offline hold は shopping gate と同型の接続誘導（「確認中」で固まらない）
    if (revalidation.phase === "checking" && isOfflineHold) {
      return "ネット接続後に現在の家族設定を確認してください";
    }
    if (revalidation.phase === "checking") return "現在の家族設定で確認しています";
    if (revalidation.phase === "error") return revalidation.errorMessage ?? "確認できませんでした";
    // soft 飛行中は本文を維持しつつ「再確認中」を示し CTA だけ閉じる
    if (isSoftRechecking) return "いまの家族設定を再確認しています";
    if (revalidation.result?.status === "changed") {
      return "現在の家族設定で確認しました。作成時から条件が変わっています";
    }
    if (revalidation.result?.status === "valid") return "現在の家族設定で確認しました";
    return null;
  }, [isOfflineHold, isSoftRechecking, revalidation]);

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

  // 横はみ出し抑止と guided-planner 互換は .menu-detail-page 意味クラスへ退避。
  return (
    <main className="page-frame guided-planner-theme menu-detail-page">
      <Stack gap={4}>
        <MenuSafetyNotice
          section="disclaimers"
          phase={revalidation.phase}
          isOfflineHold={isOfflineHold}
          statusCopy={statusCopy}
        />
        {surface.showFlyerUpsell && usage.isSuccess && !usage.data.plusEntitled ? (
          <FlyerUpsellBanner plusEntitled={false} />
        ) : null}
        <MenuSafetyNotice
          section="revalidation"
          phase={revalidation.phase}
          isOfflineHold={isOfflineHold}
          statusCopy={statusCopy}
          invalidIssues={
            revalidation.phase === "checked" && revalidation.result?.status === "invalid"
              ? revalidation.result.issues
              : undefined
          }
          onRetry={() => {
            revalidation.refetch?.();
          }}
        />

        <MenuVersionSwitcher
          versions={siblingVersions}
          currentMenuId={menuId}
          pathForMenuId={surface.pathForMenuId}
        />
        {versionsFailed ? (
          <p role="alert">
            案の一覧を読み込めませんでした。{" "}
            <Button
              variant="ghost"
              onClick={() => {
                void versionsQuery.refetch();
              }}
            >
              もう一度読み込む
            </Button>
          </p>
        ) : null}

        {gateOpen && revalidation.result !== undefined && (
          <>
            <MenuSafetyNotice
              section="gate"
              phase={revalidation.phase}
              isOfflineHold={isOfflineHold}
              statusCopy={statusCopy}
              showGateStatus
              changedDetailLines={changedDetailLines}
            />
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
            {acceptError !== null && <p role="alert">{acceptError}</p>}
            {pantryGateMessage !== null && <p role="status">{pantryGateMessage}</p>}
          </>
        )}

        <MenuActions
          accepted={accepted}
          gateOpen={gateOpen}
          canCreateShoppingList={canCreateShoppingList}
          shoppingAsPrimary={shoppingAsPrimary}
          actionsEnabled={actionsEnabled}
          acceptPending={accept.isPending}
          confirmedSingle={confirmedSingle}
          pantryGateReady={pantryGateReady}
          showReconcile={reconcileTarget.data !== null && reconcileTarget.data !== undefined}
          reconcileDisabled={shoppingMutateBlocked || reconcileList.isPending}
          canUpdatePostCook={canUpdatePostCook}
          showRetarget={result.sourceSubmission !== null}
          retargetEnabled={retargetEnabled}
          retargetPending={retargetPending}
          retargetError={retargetError}
          shoppingError={shoppingError}
          shoppingIntentActive={shoppingIntentActive}
          revalidationPhase={revalidation.phase}
          isSoftRechecking={isSoftRechecking}
          shoppingRejectedMessage={
            revalidation.errorMessage ?? "現在の家族設定ではこの献立から買い物リストを作れません"
          }
          onAccept={() => {
            // HR3: RPC は所有権のみ。クライアントで checked+actionable を再確認してから呼ぶ
            // HR8: ref で soft-flight 中の stale クロージャも塞ぐ
            if (!actionsEnabledRef.current) return;
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
          onOpenCreateShopping={() => {
            setShoppingError(null);
            // SHOP6: シート open を永続化し remount 後の旧 sticky resume を抑止
            markShoppingResumeSuppress("create", menuId);
            setShoppingSheet("create");
          }}
          onOpenWholeRegen={() => {
            if (!pantryGateReady) return;
            setSheetMode("whole");
          }}
          onOpenReconcile={() => {
            const target = reconcileTarget.data;
            if (activeList === null || target === null || target === undefined) return;
            if (shoppingMutateBlocked) return;
            // HR3: preview 開始時の FP。await 後に gate / FP を再確認してから sheet を開く
            const fingerprintAtPreview = revalidation.result?.safetyFingerprint;
            setShoppingError(null);
            previewShoppingDiff(menuId, target.sourceMenuVersion, activeList)
              .then((diff) => {
                // soft/hard 飛行中や non-actionable になったら stale diff で開かない
                if (shoppingMutateBlockedRef.current) {
                  setShoppingError(
                    "家族設定の確認中です。確認が終わってから差分を開き直してください",
                  );
                  return;
                }
                if (fingerprintAtPreview !== revalidationFingerprintRef.current) {
                  setShoppingError("家族設定が変わったため、差分を開き直してください");
                  return;
                }
                reconcileDiffFingerprintRef.current = fingerprintAtPreview ?? null;
                setShoppingDiff(diff);
                // SHOP6 + SHOP9: reconcile シート open も list+menu 粒度で suppress を永続化
                markShoppingResumeSuppress(
                  "reconcile",
                  reconcileCommandTargetId(activeList.id, menuId),
                );
                setShoppingSheet("reconcile");
              })
              .catch(() => {
                setShoppingError("差分を確認できませんでした");
              });
          }}
          onOpenPostCook={() => {
            setPostCookOpen(true);
          }}
          onRetarget={() => {
            if (!retargetEnabled) return;
            void onRetarget();
          }}
        />

        {shoppingSheet === "create" && (
          <CreateListSheet
            // HR9: soft/hard 後に FP/status が変わったら form を再マウントし mode を既定へ戻す
            // （soft 開始前に選んだ mode のまま stale create しない）。list version 変化も同様。
            key={`${activeList?.id ?? "none"}-${String(activeList?.version ?? 0)}-${revalidation.result?.safetyFingerprint ?? "none"}-${revalidation.result?.status ?? "none"}`}
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
            forceNewMode={shoppingGate.error}
            // SHOP4: reconcilable 時は append を閉じ、差分 CTA へ誘導（mode=new は維持）
            disableAppend={reconcileTarget.data !== null && reconcileTarget.data !== undefined}
            onSubmit={(input) => {
              // 表示中 isFetching では止めない（safetyBlocked と同じく actions のみ）
              if (!actionsEnabled || createList.isPending) return;
              // SHOP2: mint を Web Locks で直列化し multi-tab 別 UUID を閉じる
              void claimShoppingCommand(
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
                // SHOP6: mode 変更だけ sticky を捨てて新 key。SHOP1: version/listId は照合しない。
                (saved) => isCreateShoppingStickyReusable(saved, { mode: input.mode }),
              ).then((command) => {
                void submitCreate(command);
              });
            }}
            onCancel={() => {
              // SHOP1: Cancel は sticky を捨てない。SHOP6 suppress だけ落とし resume を再武装する。
              clearShoppingResumeSuppress("create", menuId);
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
                // HR3: Apply 直前に gate と preview 時 FP を再確認（hard 後の stale diff 適用を閉じる）
                if (shoppingMutateBlocked || target === null) return;
                const stickyTargetId = reconcileCommandTargetId(activeList.id, menuId);
                if (
                  reconcileDiffFingerprintRef.current !== null &&
                  reconcileDiffFingerprintRef.current !== revalidation.result?.safetyFingerprint
                ) {
                  setShoppingError("家族設定が変わったため、差分を開き直してください");
                  clearShoppingResumeSuppress("reconcile", stickyTargetId);
                  setShoppingSheet(null);
                  setShoppingDiff(null);
                  reconcileDiffFingerprintRef.current = null;
                  return;
                }
                const listId = activeList.id;
                // SHOP2 + SHOP9: list+menu 粒度 sticky を Locks 付きで mint
                void claimShoppingCommand(
                  "reconcile",
                  stickyTargetId,
                  reconcileShoppingListRequestSchema,
                  (idempotencyKey) => ({
                    expectedListVersion: activeList.version,
                    sourceMenuId: menuId,
                    sourceMenuVersion: target.sourceMenuVersion,
                    idempotencyKey,
                    approval,
                  }),
                  // SHOP6: approval/source 変更だけ rebuild。SHOP1: expectedListVersion は照合しない。
                  (saved) =>
                    isReconcileShoppingStickyReusable(saved, {
                      sourceMenuId: menuId,
                      sourceMenuVersion: target.sourceMenuVersion,
                      approval,
                    }),
                ).then((command) => {
                  void submitReconcile(listId, command, stickyTargetId);
                });
              }}
              onCancel={() => {
                // SHOP1: sticky は残す。SHOP6 suppress だけ落として resume 再武装。
                clearShoppingResumeSuppress(
                  "reconcile",
                  reconcileCommandTargetId(activeList.id, menuId),
                );
                setShoppingSheet(null);
                setShoppingDiff(null);
                reconcileDiffFingerprintRef.current = null;
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
      </Stack>
    </main>
  );
}
