import { render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { expect, it, vi } from "vitest";
import type { AuthGateway } from "./auth-gateway";
import { AuthCallbackPage } from "./auth-callback-page";

it("deposits in an isolated WebView and directs the user to the original browser", async () => {
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn().mockResolvedValue({
      kind: "deposited",
      continuation: "original_browser",
      returnTo: "/onboarding",
      flowId: "flow-1",
    }),
    resumeFlow: vi.fn(),
  };
  const router = createMemoryRouter(
    [
      { path: "/auth/callback", element: <AuthCallbackPage gateway={gateway} /> },
      { path: "/onboarding", element: <h1>家族設定</h1> },
    ],
    { initialEntries: ["/auth/callback?flow=flow-1"] },
  );

  render(<RouterProvider router={router} />);
  expect(
    await screen.findByText(
      "元のブラウザでログインを続けてください。この画面に認証情報は保存されません",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "家族設定" })).not.toBeInTheDocument();
});
