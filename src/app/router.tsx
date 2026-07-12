import { createBrowserRouter, Navigate } from "react-router";
import { AppShell } from "./layouts/app-shell";
import { AuthCallbackPage } from "@/features/auth/auth-callback-page";
import { LoginPage } from "@/features/auth/login-page";
import { RequireCompletedOnboarding, RequireSession } from "@/features/auth/protected-routes";
import { HouseholdOnboardingPage } from "@/features/household/household-onboarding-page";
import { PrivacyNoticePage } from "@/features/privacy/privacy-notice-page";
import { PlaceholderPage } from "@/shared/ui/placeholder-page";

export type AppRouter = ReturnType<typeof createBrowserRouter>;

export function createAppRouter(): AppRouter {
  return createBrowserRouter([
    { path: "/login", element: <LoginPage /> },
    { path: "/auth/callback", element: <AuthCallbackPage /> },
    {
      element: <RequireSession />,
      children: [
        { path: "/onboarding", element: <HouseholdOnboardingPage /> },
        { path: "/privacy", element: <PrivacyNoticePage /> },
        {
          element: <RequireCompletedOnboarding />,
          children: [
            {
              element: <AppShell />,
              children: [
                { path: "/", element: <Navigate to="/planner" replace /> },
                {
                  path: "/planner",
                  element: (
                    <PlaceholderPage
                      title="献立"
                      description="朝食・昼食・夕食から1食分の献立を作ります。"
                    />
                  ),
                },
                {
                  path: "/pantry",
                  element: (
                    <PlaceholderPage
                      title="冷蔵庫"
                      description="使いたい食材を登録する画面です。"
                    />
                  ),
                },
                {
                  path: "/history",
                  element: (
                    <PlaceholderPage
                      title="履歴"
                      description="完成した献立とお気に入りを確認する画面です。"
                    />
                  ),
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
                  element: (
                    <PlaceholderPage
                      title="設定"
                      description="家族情報とアカウントを管理する画面です。"
                    />
                  ),
                },
              ],
            },
          ],
        },
      ],
    },
  ]);
}
