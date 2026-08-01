import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { Link, Navigate, useParams } from "react-router";
import { z } from "zod";
import { useAuth } from "@/features/auth/use-auth";
import { HouseholdMenuDetailBody } from "@/features/menu-detail/household-menu-detail-body";
import { IdeaMenuDetailBody } from "@/features/menu-detail/idea-menu-detail-body";
import {
  generationMenuDetailSurface,
  type MenuResultPageRevalidationView,
} from "@/features/menu-detail/menu-detail-types";
import { useShoppingCreateIntent } from "@/features/shopping/hooks/use-shopping-create-intent";
import { getMenuResult } from "../api/menu-result-api";
import { clearPendingGeneration } from "../model/pending-generation";

export type { MenuResultPageRevalidationView };

type MenuResultPageProps = {
  /** テスト注入用。省略時は useMenuRevalidation を使う。 */
  revalidation?: MenuResultPageRevalidationView;
};

/**
 * 生成直後の献立結果。loader と surface 差分のみを持ち、
 * idea/household の操作は menu-detail 共通 body に委譲する。
 */
export function MenuResultPage({ revalidation: injected }: MenuResultPageProps = {}) {
  const auth = useAuth();
  const userId = auth.session?.user.id;
  const parsed = z.uuid().safeParse(useParams().menuId);
  const menuId = parsed.success ? parsed.data : null;
  // early return より前: intent strip / L15（Rules of Hooks）
  const shoppingIntent = useShoppingCreateIntent(menuId ?? "");
  // A-I7: preferenceGaps は生成直後のみ。末尾に surface を付け
  // /history と 30s キャッシュ共有しない。先頭 3 要素は invalidate プレフィックス互換（敵対的 C1）。
  const queryKey = useMemo(
    () => ["menu-result", userId ?? "missing", menuId ?? "invalid", "generation"] as const,
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

  if (!parsed.success || menuId === null) return <Navigate to="/planner" replace />;
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

  if (query.data.targetMode === "idea") {
    return (
      <IdeaMenuDetailBody
        key={menuId}
        result={query.data}
        menuId={menuId}
        userId={userId}
        shoppingIntentActive={shoppingIntent.shoppingIntentActive}
        clearShoppingCycle={shoppingIntent.clearCycle}
        surface={generationMenuDetailSurface}
      />
    );
  }
  return (
    <HouseholdMenuDetailBody
      key={menuId}
      result={query.data}
      menuId={menuId}
      userId={userId}
      shoppingIntentActive={shoppingIntent.shoppingIntentActive}
      markShoppingAutoOpened={shoppingIntent.markAutoOpened}
      clearShoppingSheetExpected={shoppingIntent.clearSheetExpected}
      clearShoppingCycle={shoppingIntent.clearCycle}
      surface={generationMenuDetailSurface}
      {...(injected !== undefined ? { injectedRevalidation: injected } : {})}
    />
  );
}
