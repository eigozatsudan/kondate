import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router";
import { z } from "zod";
import { MENU_LABEL_DISCLAIMER } from "@/features/generation/components/idea-menu-safety-notice";
import { getMenuResult } from "@/features/generation/api/menu-result-api";
import { useReconcileTerminalPendingOnMenu } from "@/features/generation/hooks/use-reconcile-terminal-pending-on-menu";
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
import { Inset, Stack } from "@/shared/ui/stack";
import { Surface } from "@/shared/ui/surface";

export type { HistoryDetailRevalidationView };

type HistoryDetailPageProps = {
  /** テスト注入用。省略時は useMenuRevalidation を使う。 */
  revalidation?: HistoryDetailRevalidationView;
};

/**
 * 履歴詳細。menu aggregate（権威ある targetMode）を取得した後に
 * menu-detail 共通 body へ分岐する。
 *
 * G2/C1: 進行中 pending を無条件 clear しない（別献立閲覧で recovery を焼かない）。
 * G-R1: 成功読込後に status GET し、pending key の succeeded.menuId が本ページと
 * 一致するときだけ clear（結果 URL と同型の key+menu 照合）。
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
  // G-R1: hooks は early return 前。無条件 clear はしない。
  useReconcileTerminalPendingOnMenu(userId, menuId, menuQuery.isSuccess);

  if (!parsed.success || menuId === null) return <Navigate to="/history" replace />;

  if (menuQuery.isPending) {
    return (
      <main className="page-frame menu-detail-page">
        <Stack gap={4}>
          <Surface tone="notice">
            <Inset pad={5}>
              <p className="menu-detail-disclaimer-strong">{MENU_LABEL_DISCLAIMER}</p>
            </Inset>
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
            <Inset pad={5}>
              <p className="menu-detail-disclaimer-strong">{MENU_LABEL_DISCLAIMER}</p>
            </Inset>
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
