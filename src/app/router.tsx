import { createBrowserRouter } from "react-router";
import { AppShell } from "./layouts/app-shell";
import { RequireSession } from "@/features/auth/protected-routes";
import { RootEntryPage } from "@/features/auth/root-entry-page";
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
        { path: "/", element: <RootEntryPage /> },
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
          ],
        },
      ],
    },
  ]);
}
