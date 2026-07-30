import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { z } from "zod";
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
import {
  isRevalidationActionable,
  type RevalidationResult,
} from "@/features/history/api/revalidation-api";
import {
  RegenerationSheet,
  type RegenerationReasonInput,
  type RegenerationUsageView,
} from "@/features/history/components/regeneration-sheet";
import {
  useMenuRevalidation,
  type RevalidationPhaseName,
} from "@/features/history/hooks/use-menu-revalidation";
import { useAcceptMenuVersion, useToggleFavorite } from "@/features/history/hooks/use-history";
import { useRegeneration } from "@/features/history/hooks/use-regeneration";
import {
  createPantryItem,
  deletePantryItem,
  listPantryItems,
  pantryKeys,
  updatePantryItem,
} from "@/features/pantry/pantry-api";
import { listExpiredPantryForRegeneration } from "@/features/history/model/expired-pantry-for-regen";
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
import { confirmLabelConfirmation } from "../api/confirm-label-api";
import { getMenuResult } from "../api/menu-result-api";
import type { MenuResultViewModel } from "@shared/contracts/menu-result";
import { MenuResult, type MenuResultActions } from "../components/menu-result";
import { FlyerUpsellBanner } from "@/features/billing/flyer-upsell-banner";
import { useUsageToday } from "../hooks/use-usage-today";
import { clearPendingGeneration } from "../model/pending-generation";

function usageViewFromQuery(usage: ReturnType<typeof useUsageToday>): RegenerationUsageView {
  return {
    successRemaining: usage.isSuccess ? usage.data.success.remaining : null,
    attemptsRemaining: usage.isSuccess ? usage.data.attempts.remaining : null,
    shortWindowRemaining: usage.isSuccess ? usage.data.shortWindow.remaining : null,
    shortWindowRetryAt:
      usage.isSuccess && usage.data.shortWindow.remaining === 0
        ? usage.data.shortWindow.retryAt
        : null,
    loading: usage.isPending || usage.isFetching,
    error: usage.isError,
    plan: usage.isSuccess ? usage.data.plan : null,
  };
}

export type MenuResultPageRevalidationView = {
  phase: RevalidationPhaseName;
  result?: RevalidationResult;
  errorMessage?: string;
  refetch?: () => void;
  /** stale confirm 失敗時などに同期的にゲートを閉じる */
  beginRecheck?: () => void;
};

type MenuResultPageProps = {
  /** テスト注入用。省略時は useMenuRevalidation を使う。 */
  revalidation?: MenuResultPageRevalidationView;
};

export function MenuResultPage({ revalidation: injected }: MenuResultPageProps = {}) {
  const auth = useAuth();
  const userId = auth.session?.user.id;
  const parsed = z.uuid().safeParse(useParams().menuId);
  const menuId = parsed.success ? parsed.data : null;
  // early return より前: intent strip / L15（Rules of Hooks）
  const shoppingIntent = useShoppingCreateIntent(menuId ?? "");
  const queryKey = useMemo(
    () => ["menu-result", userId ?? "missing", menuId ?? "invalid"] as const,
    [menuId, userId],
  );
  const query = useQuery({
    queryKey,
    queryFn: () => getMenuResult(menuId ?? "invalid", { includePreferenceGaps: true }),
    enabled: menuId !== null && auth.status === "authenticated" && userId !== undefined,
    staleTime: 30_000,
  });
  useEffect(() => {
    if (query.data) clearPendingGeneration();
  }, [query.data]);

  if (!parsed.success) return <Navigate to="/planner" replace />;
  if (query.isError)
    return (
      <main className="page-frame stack">
        <h1>献立を表示できません</h1>
        <p>履歴からもう一度確認してください。</p>
        <Link
          to="/history"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 font-semibold"
        >
          履歴を見る
        </Link>
      </main>
    );
  // 読み込み中も main ランドマークを維持する（axe region / ルート a11y 契約）。
  // 操作バーは出さず、中立ステータス + 作成中と同系のインジケータのみ。
  // AI 成功直後の遷移では getMenuResult が数秒かかることがあり、テキストだけだと空白に見える。
  if (query.isPending)
    return (
      <main className="page-frame">
        <div className="gen-status-panel" data-phase="loading">
          <div className="gen-status-indicator" aria-hidden="true" />
          <p role="status" aria-live="polite">
            献立を読み込んでいます
          </p>
        </div>
      </main>
    );

  // targetMode をUI分岐の唯一の判定元とし、conditional hook呼び出しではなく
  // household/idea それぞれ専用のchild componentへ分岐する（brief step 11）。
  // household専用のuseMenuRevalidation・買い物hook・pending replayはidea側では
  // 一切importされたhookを呼ばない構造にするため、component自体を分ける。
  if (query.data.targetMode === "idea") {
    return (
      <IdeaResultBody
        result={query.data}
        menuId={menuId}
        userId={userId}
        queryKey={queryKey}
        shoppingIntentActive={shoppingIntent.shoppingIntentActive}
        clearShoppingCycle={shoppingIntent.clearCycle}
      />
    );
  }
  return (
    <HouseholdResultBody
      result={query.data}
      menuId={menuId}
      userId={userId}
      queryKey={queryKey}
      shoppingIntentActive={shoppingIntent.shoppingIntentActive}
      markShoppingAutoOpened={shoppingIntent.markAutoOpened}
      clearShoppingSheetExpected={shoppingIntent.clearSheetExpected}
      clearShoppingCycle={shoppingIntent.clearCycle}
      {...(injected !== undefined ? { injectedRevalidation: injected } : {})}
    />
  );
}

type IdeaResultBodyProps = {
  result: MenuResultViewModel;
  menuId: string | null;
  userId: string | undefined;
  queryKey: readonly ["menu-result", string, string];
  shoppingIntentActive: boolean;
  clearShoppingCycle: () => void;
};

/**
 * idea結果の本文。
 * 家族安全再検証・買い物hook/pending replayは mount しない。
 * 採用・お気に入り・所有者/version 付き冷蔵庫反映・whole/dish 再生成だけを許可する。
 * 採用は家族安全確認を意味しない。
 */
function IdeaResultBody({
  result,
  menuId,
  userId,
  queryKey,
  shoppingIntentActive,
  clearShoppingCycle,
}: IdeaResultBodyProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // storage clear 後もメッセージを残す（設計 I5）
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
  const regeneration = useRegeneration({
    targetMode: "idea",
    menuId: menuId ?? "00000000-0000-4000-8000-000000000000",
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

  const actions = useMemo((): MenuResultActions | undefined => {
    if (userId === undefined || menuId === null) return undefined;
    const client = getBrowserSupabaseClient();
    // idea は label 確認 callback を作らない（家族 fingerprint 不要の操作だけ）
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
      // 再生成 lineage ではなく新規下書き。audience から再開する。
      void navigate("/planner?resume=audience");
    } catch {
      setRetargetError("献立条件を引き継げませんでした。もう一度お試しください");
    } finally {
      setRetargetPending(false);
    }
  };

  // 操作バー・注意書きを含めて1つの main で包む（MenuResult は本文 fragment のみ）。
  // idea の必須注意は 1 枠に集約（免責・家族未使用・AI 作成を別枠で重ねない）。
  // L10-6: Free 成功結果のときだけ週間 flyer upsell。
  const plusEntitled = usage.isSuccess ? usage.data.plusEntitled : false;
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
      {usage.isSuccess && !plusEntitled ? (
        <div className="mb-4">
          <FlyerUpsellBanner plusEntitled={false} />
        </div>
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
            setSheetMode("dish");
          }}
          regenerateSelectedDishDisabled={dishIdForRegen === null}
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
            setSheetMode("dish");
          }}
          regenerateSelectedDishDisabled={dishIdForRegen === null}
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

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg border-2 border-terracotta-700 px-4 font-semibold"
          onClick={() => {
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
          disabled={favorite.isPending || menuId === null}
          aria-pressed={isFavorite}
          aria-label={isFavorite ? "お気に入りを外す" : "お気に入りに追加"}
          onClick={() => {
            if (menuId === null) return;
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
          disabled={accept.isPending || menuId === null}
          onClick={() => {
            if (menuId === null) return;
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

type HouseholdResultBodyProps = {
  result: MenuResultViewModel;
  menuId: string | null;
  userId: string | undefined;
  queryKey: readonly ["menu-result", string, string];
  shoppingIntentActive: boolean;
  markShoppingAutoOpened: () => void;
  clearShoppingSheetExpected: () => void;
  clearShoppingCycle: () => void;
  injectedRevalidation?: MenuResultPageRevalidationView;
};

/**
 * household結果の本文。既存の家族安全再検証・買い物・冷蔵庫連携をすべて維持する。
 * Step 10までの実装をそのままこのcomponentへ移した（表示分岐のみをPageへ委譲）。
 */
function HouseholdResultBody({
  result,
  menuId,
  userId,
  queryKey,
  shoppingIntentActive,
  markShoppingAutoOpened,
  clearShoppingSheetExpected,
  clearShoppingCycle,
  injectedRevalidation,
}: HouseholdResultBodyProps) {
  const queryClient = useQueryClient();
  const live = useMenuRevalidation(menuId ?? "");
  const beginRecheck = live.beginRecheck;
  const liveView: MenuResultPageRevalidationView = {
    phase: live.phase,
    ...(live.result !== undefined ? { result: live.result } : {}),
    ...(live.errorMessage !== undefined ? { errorMessage: live.errorMessage } : {}),
    refetch: () => {
      void live.refetch();
    },
    beginRecheck,
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
  const regeneration = useRegeneration({
    targetMode: "household",
    menuId: menuId ?? "00000000-0000-4000-8000-000000000000",
    phase: revalidation.phase,
    result: revalidation.result,
  });
  // 履歴詳細と同じ「これに決めた」採用。再生成結果画面からもバージョンを確定できる。
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

  // D-M7: 安全再検査で操作が閉じたらシート・在庫ダイアログも閉じる
  useEffect(() => {
    if (!actionsEnabled && sheetMode !== null) {
      setSheetMode(null);
    }
    if (!actionsEnabled && postCookOpen) {
      setPostCookOpen(false);
    }
  }, [actionsEnabled, postCookOpen, sheetMode]);

  // 買い物リスト側の現行安全ゲート。献立側の再検証と両方が通るまで
  // create / reconcile のコマンドは組み立てない。
  const navigate = useNavigate();
  const shoppingList = useShoppingList();
  const shoppingGate = useShoppingSafetyGate();
  const createList = useCreateShoppingList();
  const reconcileList = useReconcileShoppingList();
  const [shoppingSheet, setShoppingSheet] = useState<"create" | "reconcile" | null>(null);
  const [shoppingDiff, setShoppingDiff] = useState<ShoppingDiff | null>(null);
  const [shoppingError, setShoppingError] = useState<string | null>(null);
  const activeList = shoppingList.data ?? null;
  // D-C1: 新規作成は active list の safety gate と分離（履歴詳細と同契約）
  const shoppingListBusy = shoppingList.isFetching || !shoppingList.isSuccess || menuId === null;
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
    if (menuId === null || menuId.length === 0) return;
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

  const ownerId = userId ?? "missing";
  const reconcileTarget = useQuery({
    queryKey: shoppingKeys.reconcileTarget(ownerId, menuId ?? "invalid", activeList?.id ?? "none"),
    queryFn: () => fetchReconcilableMenuSource(menuId ?? "invalid", activeList?.id ?? "none"),
    enabled: menuId !== null && activeList !== null && actionsEnabled,
    staleTime: 30_000,
  });

  const finishShoppingCommand = async (kind: "create" | "reconcile", targetId: string) => {
    await queryClient.invalidateQueries({ queryKey: shoppingKeys.active(ownerId) });
    // 反映後は「古い版を取り込んでいるか」の判定も作り直す（staleTime のあいだ
    // 反映済みリストに対して差分を出さないため）。
    await queryClient.invalidateQueries({
      queryKey: ["shopping", "reconcile-target"],
    });
    clearShoppingCommand(kind, targetId);
    setShoppingSheet(null);
    setShoppingDiff(null);
  };
  const failShoppingCommand = (kind: "create" | "reconcile", targetId: string, error: unknown) => {
    // code 付き（HTTP/ドメイン）失敗は自動再送しない。記録を捨てて承認をやり直す。
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
      // 作成時と同じく反映後は買い物リストへ移る（E2E・再送完了の到達点を揃える）
      void navigate("/shopping");
    } catch (error) {
      failShoppingCommand("reconcile", listId, error);
    }
  };

  // 応答を取り逃した送信は、再読込・復帰・オンライン復帰で同じバイト列のまま再送する。
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
    if (userId === undefined || menuId === null || revalidation.result === undefined) {
      return undefined;
    }
    const client = getBrowserSupabaseClient();
    const safetyFingerprint = revalidation.result.safetyFingerprint;
    return {
      menuId,
      userId,
      onConfirmLabel: async (confirmationId, expectedSafetyFingerprint) => {
        try {
          // ゲートが渡した fingerprint を優先し、呼び出し引数と一致させる
          await confirmLabelConfirmation(
            menuId,
            confirmationId,
            expectedSafetyFingerprint || safetyFingerprint,
          );
          await queryClient.invalidateQueries({ queryKey });
          // 成功後も fingerprint が変わり得るため再検証する（飛行中は checking）
          beginRecheck();
        } catch (error) {
          // stale / archived は閉じた not-found。invalidate を待たず同期的にゲートを閉じる
          beginRecheck();
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
  }, [beginRecheck, menuId, queryClient, queryKey, revalidation.result, userId]);

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

  const statusCopy =
    revalidation.phase === "checking"
      ? "現在の家族設定で確認しています"
      : revalidation.phase === "error"
        ? (revalidation.errorMessage ?? "確認できませんでした")
        : revalidation.result?.status === "changed"
          ? "現在の家族設定で確認しました。作成時から条件が変わっています"
          : revalidation.result?.status === "valid"
            ? "現在の家族設定で確認しました"
            : null;

  // 再検証ステータス・買い物操作を含めて1つの main で包む。
  // L10-6: Free 成功結果のときだけ週間 flyer upsell。
  const plusEntitled = usage.isSuccess ? usage.data.plusEntitled : false;
  return (
    <main className="page-frame guided-planner-theme min-w-0 overflow-x-hidden break-words text-ink [overflow-wrap:anywhere]">
      <p className="rounded-xl border border-amber-700 p-3 font-semibold break-words">
        {MENU_LABEL_DISCLAIMER}
      </p>
      {usage.isSuccess && !plusEntitled ? (
        <div className="mt-4">
          <FlyerUpsellBanner plusEntitled={false} />
        </div>
      ) : null}

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
          <p className="mt-4" role="status">
            {statusCopy}
          </p>
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
                setSheetMode("dish");
              }}
              regenerateSelectedDishDisabled={dishIdForRegen === null}
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
                setSheetMode("dish");
              }}
              regenerateSelectedDishDisabled={dishIdForRegen === null}
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
        </>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg border-2 border-terracotta-700 px-4 font-semibold"
          disabled={!actionsEnabled}
          onClick={() => {
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
              if (activeList === null || menuId === null || target === null) return;
              setShoppingError(null);
              // 表示専用のプレビュー。反映内容はサーバーが必ず計算し直す。
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
          disabled={!actionsEnabled || accept.isPending || menuId === null}
          onClick={() => {
            if (menuId === null) return;
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

      {shoppingSheet === "create" && menuId !== null && (
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
        menuId !== null &&
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
                  // 承認はキーとIDだけを運ぶ。解決済みの値はブラウザから送らない。
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
