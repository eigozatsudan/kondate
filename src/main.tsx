import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { AppProviders } from "./app/providers";
import { RootErrorBoundary } from "./app/root-error-boundary";
import { createAppRouter } from "./app/router";
import { captureAndStripAuthCallbackUrl } from "./features/auth/auth-callback-url-capture";
import { AuthProvider } from "./features/auth/auth-provider";
import { listenForAndroidInstallPrompt } from "./features/pwa/android-install-prompt";
import { registerServiceWorker } from "./features/pwa/register-service-worker";
import "./styles.css";

// C7: React / lazy route より前に認可 code を可視 URL から除く（最短 strip）。
// エッジ access log の初回 URL はインフラ管轄。
captureAndStripAuthCallbackUrl();
// Android の beforeinstallprompt は createRoot より前に取る。フック mount を待たない。
listenForAndroidInstallPrompt();
// 本番だけ /sw.js を登録する。callback strip の後なので認可 query は SW に渡さない。
registerServiceWorker();

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Application root element was not found");
}

const router = createAppRouter();

createRoot(root).render(
  <StrictMode>
    {/* L3: Router 外（AuthProvider / getPublicEnv）の throw を日本語リカバリに閉じる */}
    <RootErrorBoundary>
      <AppProviders>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </AppProviders>
    </RootErrorBoundary>
  </StrictMode>,
);
