import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
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
import { Skeleton } from "@/shared/ui/feedback";
import { PageHeader } from "@/shared/ui/page-header";
import { Stack } from "@/shared/ui/stack";
import { getMenuResult } from "../api/menu-result-api";
import { useReconcileTerminalPendingOnMenu } from "../hooks/use-reconcile-terminal-pending-on-menu";

export type { MenuResultPageRevalidationView };

type MenuResultPageProps = {
  /** テスト注入用。省略時は useMenuRevalidation を使う。 */
  revalidation?: MenuResultPageRevalidationView;
};

/**
 * 生成直後の献立結果。loader と surface 差分のみを持ち、
 * idea/household の操作は menu-detail 共通 body に委譲する。
 *
 * G2: 献立読込成功だけでは pending を clear しない。
 * /menus/:menuId は履歴・買い物 intent の共通入口であり、idempotencyKey 照合なしの
 * clear は offline/processing 中の別 key 復旧を焼く。
 * G-R1: 成功読込後に status GET し、pending key の succeeded.menuId が本ページと
 * 一致するときだけ clear（key+menu 照合。G2 の無条件 clear は戻さない）。
 * recovery の navigate clear（`?recovered=1`）も従来どおり有効。
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
  // G-R1: hooks は early return 前。失敗/読込中は menuLoaded=false で status を叩かない。
  useReconcileTerminalPendingOnMenu(userId, menuId, query.isSuccess);

  if (!parsed.success || menuId === null) return <Navigate to="/planner" replace />;
  if (query.isError)
    return (
      <main className="page-frame">
        <Stack gap={4}>
          <PageHeader title="献立を表示できません" lead="履歴からもう一度確認してください。" />
          {/* Link は <a> 相当のため Button 化しない。44px は min-h/w-11（ESLint 許可）で保証。 */}
          <Link to="/history" className="menu-result-history-link min-h-11 min-w-11">
            履歴を見る
          </Link>
        </Stack>
      </main>
    );
  // 読み込み中も main ランドマークを維持する（axe region 契約）。
  // Skeleton が role="status" / aria-live="polite" と文言 label を内部で持つ。
  if (query.isPending)
    return (
      <main className="page-frame">
        <Skeleton lines={3} label="献立を読み込んでいます" />
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
