import { createBrowserRouter, Navigate } from "react-router";
import { AppShell } from "./layouts/app-shell";
import { RequireCompletedOnboarding, RequireSession } from "@/features/auth/protected-routes";
import { PantryPage } from "@/features/pantry/pantry-page";
import { EmergencyMenuPage } from "@/features/emergency/emergency-menu-page";
import { PlannerRoutePage } from "@/features/planner/planner-route";
import { GenerationPage } from "@/features/generation/pages/generation-page";
import { MenuResultPage } from "@/features/generation/pages/menu-result-page";
import { HistoryDetailPage } from "@/features/history/pages/history-detail-page";
import { HistoryPage } from "@/features/history/pages/history-page";
import { PlaceholderPage } from "@/shared/ui/placeholder-page";

export type AppRouter = ReturnType<typeof createBrowserRouter>;

export function createAppRouter(): AppRouter {
  return createBrowserRouter([
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
      element: <RequireSession />,
      children: [
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
            const { PrivacyNoticePage } = await import("@/features/privacy/privacy-notice-page");
            return { Component: PrivacyNoticePage };
          },
        },
        {
          element: <AppShell />,
          children: [
            {
              path: "/emergency-menus",
              element: <EmergencyMenuPage />,
            },
            {
              element: <RequireCompletedOnboarding />,
              children: [
                { path: "/", element: <Navigate to="/planner" replace /> },
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
                  element: (
                    <PlaceholderPage
                      title="買い物"
                      description="使用中の買い物リストを確認する画面です。"
                    />
                  ),
                },
                {
                  path: "/settings",
                  lazy: async () => {
                    const { HouseholdSettingsPage } =
                      await import("@/features/household/household-settings-page");
                    return { Component: HouseholdSettingsPage };
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ]);
}
