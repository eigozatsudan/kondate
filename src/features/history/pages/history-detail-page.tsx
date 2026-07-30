import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { z } from "zod";
import type { MenuResultViewModel } from "@shared/contracts/menu-result";
import {
  createShoppingListRequestSchema,
  reconcileShoppingListRequestSchema,
  type CreateShoppingListRequest,
  type ReconcileShoppingListRequest,
  type ShoppingDiff,
} from "@shared/contracts/shopping";
import {
  IdeaMenuSafetyNotice,
  MENU_LABEL_DISCLAIMER,
} from "@/features/generation/components/idea-menu-safety-notice";
import { useAuth } from "@/features/auth/use-auth";
import { confirmLabelConfirmation } from "@/features/generation/api/confirm-label-api";
import { getMenuResult } from "@/features/generation/api/menu-result-api";
import { MenuResult, type MenuResultActions } from "@/features/generation/components/menu-result";
import { useUsageToday } from "@/features/generation/hooks/use-usage-today";
import {
  createPantryItem,
  deletePantryItem,
  listPantryItems,
  pantryKeys,
  updatePantryItem,
} from "@/features/pantry/pantry-api";
import { listExpiredPantryForRegeneration } from "../model/expired-pantry-for-regen";
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
import { useShoppingCreateIntent } from "@/features/shopping/hooks/use-shopping-create-intent";
import {
  hasPendingCreateCommand,
  hasShoppingDidAutoOpen,
  historyPathForShopping,
  isShoppingSheetExpected,
} from "@/features/shopping/shopping-intent";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { isRevalidationActionable, type RevalidationResult } from "../api/revalidation-api";
import {
  RegenerationSheet,
  type RegenerationReasonInput,
  type RegenerationUsageView,
} from "../components/regeneration-sheet";
import { useAcceptMenuVersion, useToggleFavorite } from "../hooks/use-history";
import { useMenuRevalidation, type RevalidationPhaseName } from "../hooks/use-menu-revalidation";
import { useRegeneration } from "../hooks/use-regeneration";

function usageViewFromQuery(usage: ReturnType<typeof useUsageToday>): RegenerationUsageView {
  return {
    successRemaining: usage.isSuccess ? usage.data.success.remaining : null,
    attemptsRemaining: usage.isSuccess ? usage.data.attempts.remaining : null,
    shortWindowRemaining: usage.isSuccess ? usage.data.shortWindow.remaining : null,
    plan: usage.isSuccess ? usage.data.plan : null,
    shortWindowRetryAt:
      usage.isSuccess && usage.data.shortWindow.remaining === 0
        ? usage.data.shortWindow.retryAt
        : null,
    loading: usage.isPending || usage.isFetching,
    error: usage.isError,
  };
}

export type HistoryDetailRevalidationView = {
  phase: RevalidationPhaseName;
  result?: RevalidationResult;
  errorMessage?: string;
  refetch?: () => void;
  beginRecheck?: () => void;
};

type HistoryDetailPageProps = {
  /** テスト注入用。省略時は useMenuRevalidation を使う。 */
  revalidation?: HistoryDetailRevalidationView;
  /** テスト注入用の revalidateMenu 置換は useMenuRevalidation モック側で行う。 */
};

/**
 * 履歴詳細。menu aggregate（権威あるtargetMode）を取得した後にmode別
 * child componentへ分岐する。household child は現行安全再検証・採用・再生成・
 * 買い物・冷蔵庫を維持し、idea child は家族 revalidation/買い物を mount せず
 * 許可操作（採用・お気に入り・冷蔵庫・再生成）だけを有効化する。
 */
export function HistoryDetailPage({ revalidation: injected }: HistoryDetailPageProps = {}) {
  const auth = useAuth();
  const userId = auth.session?.user.id;
  const parsed = z.uuid().safeParse(useParams().menuId);
  const menuId = parsed.success ? parsed.data : null;
  // early return より前: intent strip / L15（Rules of Hooks）。MenuResultPage と同契約。
  const shoppingIntent = useShoppingCreateIntent(menuId ?? "");

  const menuQuery = useQuery({
    queryKey: ["menu-result", userId ?? "missing", menuId ?? "invalid"] as const,
    queryFn: () => getMenuResult(menuId ?? "invalid"),
    enabled: menuId !== null && auth.status === "authenticated" && userId !== undefined,
    staleTime: 30_000,
  });
  // pending はここでは消さない。
  // 進行中の生成中に履歴詳細を開くと recovery ハンドルが消え /generation が idle→planner
  // に落ちる（敵対的レビュー C1）。terminal 掃除は RecoveryLinks / 成功 navigate /
  // use-regeneration 側に任せる。

  if (!parsed.success || menuId === null) return <Navigate to="/history" replace />;

  if (menuQuery.isPending) {
    return (
      <main className="page-frame min-w-0 overflow-x-hidden break-words text-ink [overflow-wrap:anywhere]">
        <p className="rounded-xl border border-amber-700 p-3 font-semibold">
          {MENU_LABEL_DISCLAIMER}
        </p>
        <p role="status" className="mt-4">
          献立を読み込んでいます
        </p>
      </main>
    );
  }

  if (menuQuery.isError) {
    return (
      <main className="page-frame min-w-0 overflow-x-hidden break-words text-ink [overflow-wrap:anywhere]">
        <p className="rounded-xl border border-amber-700 p-3 font-semibold">
          {MENU_LABEL_DISCLAIMER}
        </p>
        <div className="mt-4 stack gap-2">
          <h1>献立を表示できません</h1>
          <Link
            to="/history"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 font-semibold"
          >
            履歴へ戻る
          </Link>
        </div>
      </main>
    );
  }

  if (menuQuery.data.targetMode === "idea") {
    return (
      <IdeaDetailBody
        result={menuQuery.data}
        menuId={menuId}
        userId={userId}
        shoppingIntentActive={shoppingIntent.shoppingIntentActive}
        clearShoppingCycle={shoppingIntent.clearCycle}
      />
    );
  }
  return (
    <HouseholdDetailBody
      result={menuQuery.data}
      menuId={menuId}
      userId={userId}
      shoppingIntentActive={shoppingIntent.shoppingIntentActive}
      markShoppingAutoOpened={shoppingIntent.markAutoOpened}
      clearShoppingSheetExpected={shoppingIntent.clearSheetExpected}
      clearShoppingCycle={shoppingIntent.clearCycle}
      {...(injected !== undefined ? { injectedRevalidation: injected } : {})}
    />
  );
}

type IdeaDetailBodyProps = {
  result: MenuResultViewModel;
  menuId: string;
  userId: string | undefined;
  shoppingIntentActive: boolean;
  clearShoppingCycle: () => void;
};

/**
 * idea履歴の詳細本文。
 * 家族安全再検証・買い物 hook は mount せず、常時noticeと許可操作を表示する。
 * shopping intent は拒否メッセージのみ（list/create/resume は呼ばない）。
 */
function IdeaDetailBody({
  result,
  menuId,
  userId,
  shoppingIntentActive,
  clearShoppingCycle,
}: IdeaDetailBodyProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // storage clear 後もメッセージを残す（設計 I5・MenuResultPage と同順）
  const [showIdeaShoppingRejected, setShowIdeaShoppingRejected] = useState(false);
  useEffect(() => {
    if (!shoppingIntentActive) return;
    setShowIdeaShoppingRejected(true);
    clearShoppingCycle();
  }, [shoppingIntentActive, clearShoppingCycle]);
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
  // HR-I1: 冷蔵庫未取得・失敗時は期限確認 UI を開かない（空配列 fail-open を防ぐ）
  const pantryGateReady = pantryQuery.isSuccess;
  const pantryGateMessage = pantryQuery.isError
    ? "冷蔵庫を確認できません。通信を確認してから別案を作り直してください。"
    : pantryQuery.isPending
      ? "冷蔵庫を確認しています…"
      : null;
  const regeneration = useRegeneration({
    targetMode: "idea",
    menuId,
    phase: null,
    result: null,
  });
  const accept = useAcceptMenuVersion();
  const favorite = useToggleFavorite();
  const [sheetMode, setSheetMode] = useState<"whole" | "dish" | null>(null);
  const [postCookOpen, setPostCookOpen] = useState(false);
  const [selectedDishId, setSelectedDishId] = useState<string | null>(null);
  // DB hydrate: query の isFavorite を初期値にし、同一 route での再取得も useEffect で同期する
  const [isFavorite, setIsFavorite] = useState(result.isFavorite);
  const [acceptFeedback, setAcceptFeedback] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [retargetError, setRetargetError] = useState<string | null>(null);
  const [retargetPending, setRetargetPending] = useState(false);

  useEffect(() => {
    setIsFavorite(result.isFavorite);
  }, [result.isFavorite]);

  const firstDishId = result.menu.dishes[0]?.id ?? null;
  const dishIdForRegen = selectedDishId ?? firstDishId;
  const canUpdatePostCook = result.pantryPostCookTargets.length > 0;
  const queryKey = useMemo(
    () => ["menu-result", userId ?? "missing", menuId] as const,
    [menuId, userId],
  );

  const actions = useMemo((): MenuResultActions | undefined => {
    if (userId === undefined) return undefined;
    const client = getBrowserSupabaseClient();
    return {
      menuId,
      userId,
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
  }, [menuId, queryClient, queryKey, userId]);

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
    if (result.sourceSubmission === null || userId === undefined) return;
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

  // idea の必須注意は 1 枠に集約（免責・家族未使用・AI 作成を別枠で重ねない）。
  return (
    <main className="page-frame guided-planner-theme min-w-0 overflow-x-hidden break-words text-ink [overflow-wrap:anywhere]">
      <IdeaMenuSafetyNotice />
      {showIdeaShoppingRejected ? (
        <section className="card stack mb-4" role="status">
          <p>アイデア献立は買い物リストに使えません。家族に合わせた献立を選んでください</p>
          <Link className="secondary-button min-h-11" to={historyPathForShopping()}>
            履歴に戻る
          </Link>
          <Link className="secondary-button min-h-11" to="/shopping">
            買い物に戻る
          </Link>
        </section>
      ) : null}
      {actions === undefined ? (
        <MenuResult
          result={result}
          mode="idea"
          postCookOpen={postCookOpen}
          onPostCookClose={() => {
            setPostCookOpen(false);
          }}
          onSelectedDishChange={setSelectedDishId}
          onRegenerateSelectedDish={() => {
            if (!pantryGateReady) return;
            setSheetMode("dish");
          }}
          regenerateSelectedDishDisabled={dishIdForRegen === null || !pantryGateReady}
        />
      ) : (
        <MenuResult
          result={result}
          mode="idea"
          actions={actions}
          postCookOpen={postCookOpen}
          onPostCookClose={() => {
            setPostCookOpen(false);
          }}
          onSelectedDishChange={setSelectedDishId}
          onRegenerateSelectedDish={() => {
            if (!pantryGateReady) return;
            setSheetMode("dish");
          }}
          regenerateSelectedDishDisabled={dishIdForRegen === null || !pantryGateReady}
        />
      )}
      {acceptFeedback !== null && (
        <p className="mt-2" role="status">
          {acceptFeedback}
        </p>
      )}
      {acceptError !== null && (
        <p className="mt-2" role="alert">
          {acceptError}
        </p>
      )}
      {favoriteError !== null && (
        <p className="mt-2" role="alert">
          {favoriteError}
        </p>
      )}
      {pantryGateMessage !== null && (
        <p className="mt-2" role="status">
          {pantryGateMessage}
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg border-2 border-terracotta-700 px-4 font-semibold"
          disabled={!pantryGateReady}
          onClick={() => {
            if (!pantryGateReady) return;
            setSheetMode("whole");
          }}
        >
          献立をまるごと別案にする
        </button>
        {canUpdatePostCook && (
          <button
            type="button"
            className="min-h-11 min-w-11 rounded-lg border-2 border-terracotta-700 px-4 font-semibold"
            onClick={() => {
              setPostCookOpen(true);
            }}
          >
            使った食材の在庫を更新
          </button>
        )}
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg border-2 border-terracotta-700 px-4 font-semibold"
          disabled={favorite.isPending}
          aria-pressed={isFavorite}
          aria-label={isFavorite ? "お気に入りを外す" : "お気に入りに追加"}
          onClick={() => {
            const next = !isFavorite;
            setFavoriteError(null);
            favorite.mutate(
              { menuId, isFavorite: next },
              {
                onSuccess: () => {
                  setIsFavorite(next);
                },
                onError: () => {
                  setFavoriteError("お気に入りを更新できませんでした");
                },
              },
            );
          }}
        >
          {isFavorite ? "★ お気に入り" : "☆ お気に入り"}
        </button>
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg bg-terracotta-700 px-4 font-semibold text-white"
          disabled={accept.isPending}
          onClick={() => {
            setAcceptFeedback(null);
            setAcceptError(null);
            accept.mutate(menuId, {
              onSuccess: () => {
                setAcceptFeedback("この案を採用しました");
              },
              onError: () => {
                setAcceptError("採用を保存できませんでした。もう一度お試しください");
              },
            });
          }}
        >
          これに決めた
        </button>
        {result.sourceSubmission !== null && (
          <button
            type="button"
            className="min-h-11 min-w-11 rounded-lg border-2 border-terracotta-700 px-4 font-semibold"
            disabled={retargetPending}
            onClick={() => {
              void onRetarget();
            }}
          >
            対象を変えて新しく作る
          </button>
        )}
      </div>

      {retargetError !== null && (
        <p role="alert" className="mt-4">
          {retargetError}
        </p>
      )}

      {sheetMode !== null && (
        <RegenerationSheet
          targetMode="idea"
          usage={usageView}
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

type HouseholdDetailBodyProps = {
  result: MenuResultViewModel;
  menuId: string;
  userId: string | undefined;
  shoppingIntentActive: boolean;
  markShoppingAutoOpened: () => void;
  clearShoppingSheetExpected: () => void;
  clearShoppingCycle: () => void;
  injectedRevalidation?: HistoryDetailRevalidationView;
};

/**
 * household履歴の詳細本文。既存の家族安全再検証・採用・再生成・買い物・
 * 冷蔵庫連携をすべて維持する。買い物 intent の auto-open は MenuResultPage と同契約。
 */
function HouseholdDetailBody({
  result,
  menuId,
  userId,
  shoppingIntentActive,
  markShoppingAutoOpened,
  clearShoppingSheetExpected,
  clearShoppingCycle,
  injectedRevalidation,
}: HouseholdDetailBodyProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const live = useMenuRevalidation(menuId);
  const liveView: HistoryDetailRevalidationView = {
    phase: live.phase,
    ...(live.result !== undefined ? { result: live.result } : {}),
    ...(live.errorMessage !== undefined ? { errorMessage: live.errorMessage } : {}),
    refetch: () => {
      void live.refetch();
    },
    beginRecheck: live.beginRecheck,
  };
  const revalidation = injectedRevalidation ?? liveView;

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
  // HR-I1: 冷蔵庫未取得・失敗時は期限確認 UI を開かない
  const pantryGateReady = pantryQuery.isSuccess;
  const pantryGateMessage = pantryQuery.isError
    ? "冷蔵庫を確認できません。通信を確認してから別案を作り直してください。"
    : pantryQuery.isPending
      ? "冷蔵庫を確認しています…"
      : null;
  const regeneration = useRegeneration({
    targetMode: "household",
    menuId,
    phase: revalidation.phase,
    result: revalidation.result,
  });
  const accept = useAcceptMenuVersion();
  const [sheetMode, setSheetMode] = useState<"whole" | "dish" | null>(null);
  const [postCookOpen, setPostCookOpen] = useState(false);
  const [selectedDishId, setSelectedDishId] = useState<string | null>(null);
  const [acceptFeedback, setAcceptFeedback] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [retargetError, setRetargetError] = useState<string | null>(null);
  const [retargetPending, setRetargetPending] = useState(false);

  const actionsEnabled =
    revalidation.phase === "checked" &&
    revalidation.result !== undefined &&
    isRevalidationActionable(revalidation.result);
  const canUpdatePostCook = result.pantryPostCookTargets.length > 0;

  // D-M7: 安全再検査で操作が閉じたらシート・在庫ダイアログも閉じる（開いたまま送信して unhandled reject しない）
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
  const shoppingListBusy =
    shoppingList.isFetching || !shoppingList.isSuccess || menuId.length === 0;
  const shoppingMutateBlocked = !actionsEnabled || shoppingGate.blocked || shoppingListBusy;
  // 開く条件（ボタン disabled / auto-open）。閉じる条件とは分離（L8）
  const canOpenCreateSheet = actionsEnabled && !shoppingListBusy && !createList.isPending;
  const mustCloseCreateSheet = !actionsEnabled;
  const mustCloseReconcileSheet = !actionsEnabled || shoppingGate.blocked;
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
    if (revalidation.result?.status === "changed") {
      return "現在の家族設定で確認しました。作成時から条件が変わっています";
    }
    if (revalidation.result?.status === "valid") return "現在の家族設定で確認しました";
    return null;
  }, [revalidation]);

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
    if (result.sourceSubmission === null || userId === undefined) return;
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

      {revalidation.phase === "checking" && (
        <p role="status" className="mt-4">
          現在の家族設定で確認しています
        </p>
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

      {actionsEnabled && revalidation.result !== undefined && (
        <>
          <div className="mt-4 sticky top-0 z-10 bg-white/95 py-2" role="status">
            <p>{statusCopy}</p>
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
                if (!pantryGateReady) return;
                setSheetMode("dish");
              }}
              regenerateSelectedDishDisabled={dishIdForRegen === null || !pantryGateReady}
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
                if (!pantryGateReady) return;
                setSheetMode("dish");
              }}
              regenerateSelectedDishDisabled={dishIdForRegen === null || !pantryGateReady}
            />
          )}
          {acceptFeedback !== null && (
            <p className="mt-2" role="status">
              {acceptFeedback}
            </p>
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

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg border-2 border-terracotta-700 px-4 font-semibold"
          disabled={!actionsEnabled || !pantryGateReady}
          onClick={() => {
            if (!pantryGateReady) return;
            setSheetMode("whole");
          }}
        >
          献立をまるごと別案にする
        </button>
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg border-2 border-terracotta-700 px-4 font-semibold"
          disabled={!canCreateShoppingList}
          onClick={() => {
            setShoppingError(null);
            setShoppingSheet("create");
          }}
        >
          買い物リストを作る
        </button>
        {reconcileTarget.data !== null && reconcileTarget.data !== undefined && (
          <button
            type="button"
            className="min-h-11 min-w-11 rounded-lg border-2 border-terracotta-700 px-4 font-semibold"
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
            買い物リストとの差分を確認
          </button>
        )}
        {canUpdatePostCook && (
          <button
            type="button"
            className="min-h-11 min-w-11 rounded-lg border-2 border-terracotta-700 px-4 font-semibold"
            disabled={!actionsEnabled}
            onClick={() => {
              setPostCookOpen(true);
            }}
          >
            使った食材の在庫を更新
          </button>
        )}
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg bg-terracotta-700 px-4 font-semibold text-white"
          disabled={!actionsEnabled || accept.isPending}
          onClick={() => {
            setAcceptFeedback(null);
            setAcceptError(null);
            accept.mutate(menuId, {
              onSuccess: () => {
                setAcceptFeedback("この案を採用しました");
              },
              onError: () => {
                setAcceptError("採用を保存できませんでした。もう一度お試しください");
              },
            });
          }}
        >
          これに決めた
        </button>
        {result.sourceSubmission !== null && (
          <button
            type="button"
            className="min-h-11 min-w-11 rounded-lg border-2 border-terracotta-700 px-4 font-semibold"
            disabled={retargetPending}
            onClick={() => {
              void onRetarget();
            }}
          >
            対象を変えて新しく作る
          </button>
        )}
      </div>

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
      {shoppingIntentActive &&
      (revalidation.phase === "error" || (revalidation.phase === "checked" && !actionsEnabled)) ? (
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
          safetyBlocked={!canOpenCreateSheet}
          forceNewMode={shoppingGate.blocked}
          onSubmit={(input) => {
            if (!canOpenCreateSheet) return;
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
