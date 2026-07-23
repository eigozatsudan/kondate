import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { z } from "zod";
import type { MenuResultViewModel } from "@shared/contracts/menu-result";
import { InlineNotice } from "@/shared/ui/wizard/inline-notice";
import { useAuth } from "@/features/auth/use-auth";
import { getMenuResult } from "@/features/generation/api/menu-result-api";
import { MenuResult, type MenuResultActions } from "@/features/generation/components/menu-result";
import { useUsageToday } from "@/features/generation/hooks/use-usage-today";
import {
  createPantryItem,
  deletePantryItem,
  pantryKeys,
  updatePantryItem,
} from "@/features/pantry/pantry-api";
import { createPlannerDraftFromMenu } from "@/features/planner/model/draft-from-menu";
import { getPlannerDraft, plannerKeys, savePlannerDraft } from "@/features/planner/planner-api";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { isRevalidationActionable, type RevalidationResult } from "../api/revalidation-api";
import { RegenerationSheet, type RegenerationReasonInput } from "../components/regeneration-sheet";
import { useAcceptMenuVersion, useToggleFavorite } from "../hooks/use-history";
import { useMenuRevalidation, type RevalidationPhaseName } from "../hooks/use-menu-revalidation";
import { useRegeneration } from "../hooks/use-regeneration";

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

const DISCLAIMER =
  "加工品はラベル確認が必要です。AI生成レシピだけでアレルギー対応を保証するものではありません。";

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

  const menuQuery = useQuery({
    queryKey: ["menu-result", userId ?? "missing", menuId ?? "invalid"] as const,
    queryFn: () => getMenuResult(menuId ?? "invalid"),
    enabled: menuId !== null && auth.status === "authenticated" && userId !== undefined,
    staleTime: 30_000,
  });

  if (!parsed.success || menuId === null) return <Navigate to="/history" replace />;

  if (menuQuery.isPending) {
    return (
      <main className="mx-auto w-full max-w-full overflow-x-hidden break-words px-4 pb-28 pt-6 text-stone-900 sm:max-w-3xl">
        <p className="rounded-xl border border-amber-700 p-3 font-semibold">{DISCLAIMER}</p>
        <p role="status" className="mt-4">
          献立を読み込んでいます
        </p>
      </main>
    );
  }

  if (menuQuery.isError) {
    return (
      <main className="mx-auto w-full max-w-full overflow-x-hidden break-words px-4 pb-28 pt-6 text-stone-900 sm:max-w-3xl">
        <p className="rounded-xl border border-amber-700 p-3 font-semibold">{DISCLAIMER}</p>
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
    return <IdeaDetailBody result={menuQuery.data} menuId={menuId} userId={userId} />;
  }
  return (
    <HouseholdDetailBody
      result={menuQuery.data}
      menuId={menuId}
      userId={userId}
      {...(injected !== undefined ? { injectedRevalidation: injected } : {})}
    />
  );
}

type IdeaDetailBodyProps = {
  result: MenuResultViewModel;
  menuId: string;
  userId: string | undefined;
};

/**
 * idea履歴の詳細本文。
 * 家族安全再検証・買い物は mount せず、常時noticeと許可操作を表示する。
 */
function IdeaDetailBody({ result, menuId, userId }: IdeaDetailBodyProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const usage = useUsageToday(userId ?? "");
  const remaining = usage.data?.success.remaining ?? 0;
  const regeneration = useRegeneration({
    targetMode: "idea",
    menuId,
    phase: null,
    result: null,
  });
  const accept = useAcceptMenuVersion();
  const favorite = useToggleFavorite();
  const [sheetMode, setSheetMode] = useState<"whole" | "dish" | null>(null);
  const [selectedDishId, setSelectedDishId] = useState<string | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [fridgeOpen, setFridgeOpen] = useState(false);
  const [retargetError, setRetargetError] = useState<string | null>(null);
  const [retargetPending, setRetargetPending] = useState(false);

  const firstDishId = result.menu.dishes[0]?.id ?? null;
  const dishIdForRegen = selectedDishId ?? firstDishId;
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

  return (
    <main className="guided-planner-theme mx-auto w-full max-w-full overflow-x-hidden break-words px-4 pb-28 pt-6 text-stone-900 sm:max-w-3xl">
      <p className="rounded-xl border border-amber-700 p-3 font-semibold">{DISCLAIMER}</p>
      <InlineNotice tone="notice" title="この献立はアイデアとして作成しました">
        <p>家族条件を使用していません</p>
        <p>年齢・アレルギーへの適合は確認されていません</p>
      </InlineNotice>
      {actions === undefined ? (
        <MenuResult result={result} mode="idea" onSelectedDishChange={setSelectedDishId} />
      ) : (
        <MenuResult
          result={result}
          mode="idea"
          actions={actions}
          onSelectedDishChange={setSelectedDishId}
        />
      )}
      {fridgeOpen && (
        <p className="mt-2 text-sm text-stone-700">
          調理後の冷蔵庫操作は献立本文の「調理後の冷蔵庫」から行えます。
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg border-2 border-stone-800 px-4 font-semibold"
          onClick={() => {
            setSheetMode("whole");
          }}
        >
          献立をまるごと別案にする
        </button>
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg border-2 border-stone-800 px-4 font-semibold"
          disabled={dishIdForRegen === null}
          onClick={() => {
            setSheetMode("dish");
          }}
        >
          この一品だけ別案にする
        </button>
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg border-2 border-stone-800 px-4 font-semibold"
          onClick={() => {
            setFridgeOpen(true);
          }}
        >
          冷蔵庫へ反映
        </button>
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg border-2 border-stone-800 px-4 font-semibold"
          disabled={favorite.isPending}
          aria-pressed={isFavorite}
          aria-label={isFavorite ? "お気に入りを外す" : "お気に入りに追加"}
          onClick={() => {
            const next = !isFavorite;
            favorite.mutate(
              { menuId, isFavorite: next },
              {
                onSuccess: () => {
                  setIsFavorite(next);
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
            accept.mutate(menuId);
          }}
        >
          これに決めた
        </button>
        {result.sourceSubmission !== null && (
          <button
            type="button"
            className="min-h-11 min-w-11 rounded-lg border-2 border-stone-800 px-4 font-semibold"
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
        <section
          className="mt-6 rounded-2xl border bg-white p-4 shadow-sm"
          aria-label="再生成の理由"
        >
          <RegenerationSheet
            targetMode="idea"
            remaining={remaining}
            onSubmit={onSubmitReason}
            onCancel={() => {
              setSheetMode(null);
            }}
          />
        </section>
      )}
    </main>
  );
}

type HouseholdDetailBodyProps = {
  result: MenuResultViewModel;
  menuId: string;
  userId: string | undefined;
  injectedRevalidation?: HistoryDetailRevalidationView;
};

/**
 * household履歴の詳細本文。既存の家族安全再検証・採用・再生成・買い物・
 * 冷蔵庫連携をすべて維持する。
 */
function HouseholdDetailBody({
  result,
  menuId,
  userId,
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
  const remaining = usage.data?.success.remaining ?? 0;
  const regeneration = useRegeneration({
    targetMode: "household",
    menuId,
    phase: revalidation.phase,
    result: revalidation.result,
  });
  const accept = useAcceptMenuVersion();
  const [sheetMode, setSheetMode] = useState<"whole" | "dish" | null>(null);
  const [selectedDishId, setSelectedDishId] = useState<string | null>(null);
  const [retargetError, setRetargetError] = useState<string | null>(null);
  const [retargetPending, setRetargetPending] = useState(false);

  const actionsEnabled =
    revalidation.phase === "checked" &&
    revalidation.result !== undefined &&
    isRevalidationActionable(revalidation.result);

  const firstDishId = result.menu.dishes[0]?.id ?? null;
  const dishIdForRegen = selectedDishId ?? firstDishId;

  const statusCopy = useMemo(() => {
    if (revalidation.phase === "checking") return "現在の家族設定で確認しています";
    if (revalidation.phase === "error") return revalidation.errorMessage ?? "確認できませんでした";
    if (revalidation.result?.status === "changed") {
      return "現在の家族設定で確認しました。作成時から条件が変わっています";
    }
    if (revalidation.result?.status === "valid") return "現在の家族設定で確認しました";
    return null;
  }, [revalidation]);

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
    <main className="guided-planner-theme mx-auto w-full max-w-full overflow-x-hidden break-words px-4 pb-28 pt-6 text-stone-900 sm:max-w-3xl">
      <p className="rounded-xl border border-amber-700 p-3 font-semibold">{DISCLAIMER}</p>

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
            className="min-h-11 rounded-lg border-2 border-stone-800 px-4 font-semibold"
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

      {revalidation.phase === "checked" &&
        revalidation.result !== undefined &&
        isRevalidationActionable(revalidation.result) && (
          <p className="mt-4" role="status">
            {statusCopy}
          </p>
        )}

      {actionsEnabled && revalidation.result !== undefined && (
        <MenuResult
          result={result}
          mode="household"
          currentLabelWarnings={revalidation.result.currentLabelWarnings}
          currentSafetyFingerprint={revalidation.result.safetyFingerprint}
          onSelectedDishChange={setSelectedDishId}
        />
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg border-2 border-stone-800 px-4 font-semibold"
          disabled={!actionsEnabled}
          onClick={() => {
            setSheetMode("whole");
          }}
        >
          献立をまるごと別案にする
        </button>
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg border-2 border-stone-800 px-4 font-semibold"
          disabled={!actionsEnabled || dishIdForRegen === null}
          onClick={() => {
            setSheetMode("dish");
          }}
        >
          この一品だけ別案にする
        </button>
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg border-2 border-stone-800 px-4 font-semibold"
          disabled={!actionsEnabled}
        >
          買い物リストを作る
        </button>
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg border-2 border-stone-800 px-4 font-semibold"
          disabled={!actionsEnabled}
        >
          冷蔵庫へ反映
        </button>
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg bg-terracotta-700 px-4 font-semibold text-white"
          disabled={!actionsEnabled || accept.isPending}
          onClick={() => {
            accept.mutate(menuId);
          }}
        >
          これに決めた
        </button>
        {result.sourceSubmission !== null && (
          <button
            type="button"
            className="min-h-11 min-w-11 rounded-lg border-2 border-stone-800 px-4 font-semibold"
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
        <section
          className="mt-6 rounded-2xl border bg-white p-4 shadow-sm"
          aria-label="再生成の理由"
        >
          <RegenerationSheet
            targetMode="household"
            remaining={remaining}
            onSubmit={onSubmitReason}
            onCancel={() => {
              setSheetMode(null);
            }}
          />
        </section>
      )}
    </main>
  );
}
