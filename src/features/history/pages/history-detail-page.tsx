import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router";
import { z } from "zod";
import { useAuth } from "@/features/auth/use-auth";
import { getMenuResult } from "@/features/generation/api/menu-result-api";
import { MenuResult } from "@/features/generation/components/menu-result";
import { useUsageToday } from "@/features/generation/hooks/use-usage-today";
import { isRevalidationActionable, type RevalidationResult } from "../api/revalidation-api";
import { RegenerationSheet, type RegenerationReasonInput } from "../components/regeneration-sheet";
import { useAcceptMenuVersion } from "../hooks/use-history";
import { useMenuRevalidation, type RevalidationPhaseName } from "../hooks/use-menu-revalidation";
import { useRegeneration } from "../hooks/use-regeneration";

export type HistoryDetailRevalidationView = {
  phase: RevalidationPhaseName;
  result?: RevalidationResult;
  errorMessage?: string;
  refetch?: () => void;
};

type HistoryDetailPageProps = {
  /** テスト注入用。省略時は useMenuRevalidation を使う。 */
  revalidation?: HistoryDetailRevalidationView;
  /** テスト注入用の revalidateMenu 置換は useMenuRevalidation モック側で行う。 */
};

const DISCLAIMER =
  "加工品はラベル確認が必要です。AI生成レシピだけでアレルギー対応を保証するものではありません。";

/**
 * 履歴詳細。現行安全再検証が終わるまで調理・再生成・買い物・採用を閉じる。
 * /menus/:menuId と同じ useMenuRevalidation を共有する。
 */
export function HistoryDetailPage({ revalidation: injected }: HistoryDetailPageProps = {}) {
  const auth = useAuth();
  const userId = auth.session?.user.id;
  const parsed = z.uuid().safeParse(useParams().menuId);
  const menuId = parsed.success ? parsed.data : null;
  const live = useMenuRevalidation(menuId ?? "");
  const liveView: HistoryDetailRevalidationView = {
    phase: live.phase,
    ...(live.result !== undefined ? { result: live.result } : {}),
    ...(live.errorMessage !== undefined ? { errorMessage: live.errorMessage } : {}),
    refetch: () => {
      void live.refetch();
    },
  };
  const revalidation = injected ?? liveView;

  const menuQuery = useQuery({
    queryKey: ["menu-result", userId ?? "missing", menuId ?? "invalid"] as const,
    queryFn: () => getMenuResult(menuId ?? "invalid"),
    enabled: menuId !== null && auth.status === "authenticated" && userId !== undefined,
    staleTime: 30_000,
  });

  const usage = useUsageToday(userId ?? "");
  const remaining = usage.data?.success.remaining ?? 0;
  const regeneration = useRegeneration({
    menuId: menuId ?? "00000000-0000-4000-8000-000000000000",
    phase: revalidation.phase,
    result: revalidation.result,
  });
  const accept = useAcceptMenuVersion();
  const [sheetMode, setSheetMode] = useState<"whole" | "dish" | null>(null);
  const [selectedDishId, setSelectedDishId] = useState<string | null>(null);

  const actionsEnabled =
    revalidation.phase === "checked" &&
    revalidation.result !== undefined &&
    isRevalidationActionable(revalidation.result);

  const firstDishId = menuQuery.data?.menu.dishes[0]?.id ?? null;
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

  if (!parsed.success || menuId === null) return <Navigate to="/history" replace />;

  const onSubmitReason = async (value: RegenerationReasonInput) => {
    if (sheetMode === "dish") {
      if (dishIdForRegen === null) return;
      await regeneration.startDish(dishIdForRegen, value);
    } else {
      await regeneration.startWhole(value);
    }
    setSheetMode(null);
  };

  return (
    <main className="mx-auto w-full max-w-full overflow-x-hidden break-words px-4 pb-28 pt-6 text-stone-900 sm:max-w-3xl">
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

      {menuQuery.isPending && (
        <p role="status" className="mt-4">
          献立を読み込んでいます
        </p>
      )}

      {menuQuery.isError && (
        <div className="mt-4 stack gap-2">
          <h1>献立を表示できません</h1>
          <Link
            to="/history"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 font-semibold"
          >
            履歴へ戻る
          </Link>
        </div>
      )}

      {actionsEnabled && menuQuery.data !== undefined && revalidation.result !== undefined && (
        <MenuResult
          result={menuQuery.data}
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
    </main>
  );
}
