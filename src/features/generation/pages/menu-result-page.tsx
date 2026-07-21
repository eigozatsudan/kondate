import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { z } from "zod";
import { useAuth } from "@/features/auth/use-auth";
import {
  isRevalidationActionable,
  type RevalidationResult,
} from "@/features/history/api/revalidation-api";
import {
  RegenerationSheet,
  type RegenerationReasonInput,
} from "@/features/history/components/regeneration-sheet";
import {
  useMenuRevalidation,
  type RevalidationPhaseName,
} from "@/features/history/hooks/use-menu-revalidation";
import { useRegeneration } from "@/features/history/hooks/use-regeneration";
import {
  createPantryItem,
  deletePantryItem,
  pantryKeys,
  updatePantryItem,
} from "@/features/pantry/pantry-api";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { confirmLabelConfirmation } from "../api/confirm-label-api";
import { getMenuResult } from "../api/menu-result-api";
import { MenuResult, type MenuResultActions } from "../components/menu-result";
import { useUsageToday } from "../hooks/use-usage-today";
import { clearPendingGeneration } from "../model/pending-generation";

const DISCLAIMER =
  "加工品はラベル確認が必要です。AI生成レシピだけでアレルギー対応を保証するものではありません。";

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
  const queryClient = useQueryClient();
  const parsed = z.uuid().safeParse(useParams().menuId);
  const menuId = parsed.success ? parsed.data : null;
  const queryKey = useMemo(
    () => ["menu-result", userId ?? "missing", menuId ?? "invalid"] as const,
    [menuId, userId],
  );
  const query = useQuery({
    queryKey,
    queryFn: () => getMenuResult(menuId ?? "invalid"),
    enabled: menuId !== null && auth.status === "authenticated" && userId !== undefined,
    staleTime: 30_000,
  });
  useEffect(() => {
    if (query.data) clearPendingGeneration();
  }, [query.data]);

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
  const revalidation = injected ?? liveView;

  const usage = useUsageToday(userId ?? "");
  const remaining = usage.data?.success.remaining ?? 0;
  const regeneration = useRegeneration({
    menuId: menuId ?? "00000000-0000-4000-8000-000000000000",
    phase: revalidation.phase,
    result: revalidation.result,
  });
  const [sheetMode, setSheetMode] = useState<"whole" | "dish" | null>(null);
  const [selectedDishId, setSelectedDishId] = useState<string | null>(null);
  const [fridgeOpen, setFridgeOpen] = useState(false);

  const actionsEnabled =
    revalidation.phase === "checked" &&
    revalidation.result !== undefined &&
    isRevalidationActionable(revalidation.result);

  const firstDishId = query.data?.menu.dishes[0]?.id ?? null;
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

  if (!parsed.success) return <Navigate to="/planner" replace />;
  if (query.isError)
    return (
      <main className="p-4">
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
  // 献立読み込み中でも操作バー枠は出さず、中立ステータスのみ
  if (query.isPending)
    return (
      <p role="status" className="p-4">
        献立を読み込んでいます
      </p>
    );

  const onSubmitReason = async (value: RegenerationReasonInput) => {
    if (sheetMode === "dish") {
      if (dishIdForRegen === null) return;
      await regeneration.startDish(dishIdForRegen, value);
    } else {
      await regeneration.startWhole(value);
    }
    setSheetMode(null);
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

  return (
    <div className="mx-auto w-full max-w-full overflow-x-hidden break-words px-4 pb-28 pt-6 text-stone-900 sm:max-w-3xl">
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

      {actionsEnabled && revalidation.result !== undefined && (
        <>
          <p className="mt-4" role="status">
            {statusCopy}
          </p>
          {actions === undefined ? (
            <MenuResult
              result={query.data}
              currentLabelWarnings={revalidation.result.currentLabelWarnings}
              currentSafetyFingerprint={revalidation.result.safetyFingerprint}
              onSelectedDishChange={setSelectedDishId}
            />
          ) : (
            <MenuResult
              result={query.data}
              actions={actions}
              currentLabelWarnings={revalidation.result.currentLabelWarnings}
              currentSafetyFingerprint={revalidation.result.safetyFingerprint}
              onSelectedDishChange={setSelectedDishId}
            />
          )}
          {fridgeOpen && (
            <p className="mt-2 text-sm text-stone-700">
              調理後の冷蔵庫操作は献立本文の「調理後の冷蔵庫」から行えます。
            </p>
          )}
        </>
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
          onClick={() => {
            setFridgeOpen(true);
          }}
        >
          冷蔵庫へ反映
        </button>
      </div>

      {sheetMode !== null && (
        <section
          className="mt-6 rounded-2xl border bg-white p-4 shadow-sm"
          aria-label="再生成の理由"
        >
          <RegenerationSheet
            remaining={remaining}
            onSubmit={onSubmitReason}
            onCancel={() => {
              setSheetMode(null);
            }}
          />
        </section>
      )}
    </div>
  );
}
