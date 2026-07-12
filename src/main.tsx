import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { AppProviders } from "./app/providers";
import { createAppRouter } from "./app/router";
import { AuthProvider } from "./features/auth/auth-provider";
import "./styles.css";

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Application root element was not found");
}

const router = createAppRouter();

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </AppProviders>
  </StrictMode>,
);
