import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router";
import { z } from "zod";
import { MENU_LABEL_DISCLAIMER } from "@/features/generation/components/idea-menu-safety-notice";
import { getMenuResult } from "@/features/generation/api/menu-result-api";
import { useAuth } from "@/features/auth/use-auth";
import { HouseholdMenuDetailBody } from "@/features/menu-detail/household-menu-detail-body";
import { IdeaMenuDetailBody } from "@/features/menu-detail/idea-menu-detail-body";
import {
  historyMenuDetailSurface,
  type HistoryDetailRevalidationView,
} from "@/features/menu-detail/menu-detail-types";
import { useShoppingCreateIntent } from "@/features/shopping/hooks/use-shopping-create-intent";
import { Skeleton } from "@/shared/ui/feedback";
import { PageHeader } from "@/shared/ui/page-header";
import { Stack } from "@/shared/ui/stack";
import { Surface } from "@/shared/ui/surface";

export type { HistoryDetailRevalidationView };

type HistoryDetailPageProps = {
  /** テスト注入用。省略時は useMenuRevalidation を使う。 */
  revalidation?: HistoryDetailRevalidationView;
};

/**
 * 履歴詳細。menu aggregate（権威ある targetMode）を取得した後に
 * menu-detail 共通 body へ分岐する。
 */
export function HistoryDetailPage({ revalidation: injected }: HistoryDetailPageProps = {}) {
  const auth = useAuth();
  const userId = auth.session?.user.id;
  const parsed = z.uuid().safeParse(useParams().menuId);
  const menuId = parsed.success ? parsed.data : null;
  // early return より前: intent strip / L15（Rules of Hooks）
  const shoppingIntent = useShoppingCreateIntent(menuId ?? "");

  // A-I7: preferenceGaps は生成直後のみ。末尾に surface を付け
  // /menus と 30s キャッシュ共有しない。先頭 3 要素は invalidate プレフィックス互換（敵対的 C1）。
  const menuQuery = useQuery({
    queryKey: ["menu-result", userId ?? "missing", menuId ?? "invalid", "history"] as const,
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
      <main className="page-frame menu-detail-page">
        <Stack gap={4}>
          <Surface tone="notice">
            <p className="menu-detail-disclaimer-strong">{MENU_LABEL_DISCLAIMER}</p>
          </Surface>
          <Skeleton label="献立を読み込んでいます" lines={3} />
        </Stack>
      </main>
    );
  }

  if (menuQuery.isError) {
    return (
      <main className="page-frame menu-detail-page">
        <Stack gap={4}>
          <Surface tone="notice">
            <p className="menu-detail-disclaimer-strong">{MENU_LABEL_DISCLAIMER}</p>
          </Surface>
          <PageHeader title="献立を表示できません" />
          <Link to="/history" className="button-link">
            履歴へ戻る
          </Link>
        </Stack>
      </main>
    );
  }

  if (menuQuery.data.targetMode === "idea") {
    return (
      <IdeaMenuDetailBody
        key={menuId}
        result={menuQuery.data}
        menuId={menuId}
        userId={userId}
        shoppingIntentActive={shoppingIntent.shoppingIntentActive}
        clearShoppingCycle={shoppingIntent.clearCycle}
        surface={historyMenuDetailSurface}
      />
    );
  }
  return (
    <HouseholdMenuDetailBody
      key={menuId}
      result={menuQuery.data}
      menuId={menuId}
      userId={userId}
      shoppingIntentActive={shoppingIntent.shoppingIntentActive}
      markShoppingAutoOpened={shoppingIntent.markAutoOpened}
      clearShoppingSheetExpected={shoppingIntent.clearSheetExpected}
      clearShoppingCycle={shoppingIntent.clearCycle}
      surface={historyMenuDetailSurface}
      {...(injected !== undefined ? { injectedRevalidation: injected } : {})}
    />
  );
}
