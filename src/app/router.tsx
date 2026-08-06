import { createBrowserRouter } from "react-router";
import { AppShell } from "./layouts/app-shell";
import { NotFoundPage } from "./not-found-page";
import { RouteErrorElement } from "./route-error-element";
import { RequireSession } from "@/features/auth/protected-routes";
import { RootGatePage } from "@/features/landing/root-gate-page";
import { PantryPage } from "@/features/pantry/pantry-page";
import { EmergencyMenuPage } from "@/features/emergency/emergency-menu-page";
import { PlannerRoutePage } from "@/features/planner/planner-route";
import { GenerationPage } from "@/features/generation/pages/generation-page";
import { MenuResultPage } from "@/features/generation/pages/menu-result-page";
import { HistoryDetailPage } from "@/features/history/pages/history-detail-page";
import { HistoryPage } from "@/features/history/pages/history-page";
import { ShoppingListPage } from "@/features/shopping/pages/shopping-list-page";

export type AppRouter = ReturnType<typeof createBrowserRouter>;

export function createAppRouter(): AppRouter {
  // L2: ルート階層の errorElement で描画 throw / lazy 失敗を日本語リカバリ UI に閉じる
  return createBrowserRouter([
    {
      errorElement: <RouteErrorElement />,
      children: [
        {
          path: "/login",
          lazy: async () => {
            const { LoginPage } = await import("@/features/auth/login-page");
            return { Component: LoginPage };
          },
        },
        {
          path: "/auth/callback",
          lazy: async () => {
            const { AuthCallbackPage } = await import("@/features/auth/auth-callback-page");
            return { Component: AuthCallbackPage };
          },
        },
        {
          // 後続 free-landing 設計（2026-07-30）がベースライン §168 の
          // 「未ログインは login + callback 以外不可」を改正し、公開 `/` を RootGate にした。
          // 保護ルート（/planner 等）は RequireSession のまま。機能は変えない（C12 doc drift 注記）。
          path: "/",
          element: <RootGatePage />,
          errorElement: <RouteErrorElement />,
        },
        {
          element: <RequireSession />,
          errorElement: <RouteErrorElement />,
          children: [
            {
              path: "/welcome",
              lazy: async () => {
                const { WelcomeRoutePage } = await import("@/features/welcome/welcome-route-page");
                return { Component: WelcomeRoutePage };
              },
            },
            {
              path: "/onboarding",
              lazy: async () => {
                const { HouseholdOnboardingPage } =
                  await import("@/features/household/household-onboarding-page");
                return { Component: HouseholdOnboardingPage };
              },
            },
            {
              path: "/privacy",
              lazy: async () => {
                const { PrivacyNoticePage } =
                  await import("@/features/privacy/privacy-notice-page");
                return { Component: PrivacyNoticePage };
              },
            },
            {
              element: <AppShell />,
              errorElement: <RouteErrorElement />,
              children: [
                {
                  path: "/emergency-menus",
                  element: <EmergencyMenuPage />,
                },
                {
                  path: "/planner",
                  element: <PlannerRoutePage />,
                },
                {
                  path: "/generation",
                  element: <GenerationPage />,
                },
                {
                  path: "/menus/:menuId",
                  element: <MenuResultPage />,
                },
                {
                  path: "/pantry",
                  element: <PantryPage />,
                },
                {
                  path: "/history",
                  element: <HistoryPage />,
                },
                {
                  path: "/history/:menuId",
                  element: <HistoryDetailPage />,
                },
                {
                  path: "/shopping",
                  element: <ShoppingListPage />,
                },
                {
                  path: "/settings",
                  lazy: async () => {
                    const { HouseholdSettingsPage } =
                      await import("@/features/household/household-settings-page");
                    return { Component: HouseholdSettingsPage };
                  },
                },
                {
                  path: "/plus",
                  lazy: async () => {
                    const { PlusLandingPage } =
                      await import("@/features/billing/plus-landing-page");
                    return { Component: PlusLandingPage };
                  },
                },
              ],
            },
          ],
        },
        {
          // L5: 未知 path は outlet 空にせず日本語 404 + ホーム導線。
          // RequireSession 外に置き、誤 URL だけでログイン強制しない。
          path: "*",
          element: <NotFoundPage />,
        },
      ],
    },
  ]);
}
