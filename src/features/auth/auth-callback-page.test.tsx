import { render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { expect, it, vi } from "vitest";
import { createAuthGateway, type AuthCallbackResult, type AuthGateway } from "./auth-gateway";
import { AuthCallbackPage } from "./auth-callback-page";

vi.mock("./auth-gateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auth-gateway")>();
  return { ...actual, createAuthGateway: vi.fn() };
});

const createAuthGatewayMock = vi.mocked(createAuthGateway);

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

it("removes callback credentials from the browser URL before completing the callback", () => {
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn().mockImplementation(() => new Promise(() => undefined)),
    resumeFlow: vi.fn(),
  };
  window.history.replaceState(
    null,
    "",
    "/auth/callback?flow=flow-1&state=state-1&code=code-1&error=server_error#access_token=secret",
  );

  const router = createMemoryRouter(
    [{ path: "/auth/callback", element: <AuthCallbackPage gateway={gateway} /> }],
    { initialEntries: ["/auth/callback"] },
  );
  render(<RouterProvider router={router} />);

  // モック関数はthisを参照しないため、呼び出し回数だけを検証する。
  // eslint-disable-next-line @typescript-eslint/unbound-method
  expect(gateway.completeCallback).toHaveBeenCalledTimes(1);
  expect(window.location.pathname + window.location.search + window.location.hash).toBe(
    "/auth/callback?flow=flow-1",
  );
});

it("creates the default gateway once and completes the callback once", async () => {
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn().mockResolvedValue({
      kind: "deposited",
      continuation: "original_browser",
      returnTo: "/planner",
      flowId: "flow-1",
    }),
    resumeFlow: vi.fn(),
  };
  createAuthGatewayMock.mockReturnValue(gateway);
  const router = createMemoryRouter([{ path: "/auth/callback", element: <AuthCallbackPage /> }], {
    initialEntries: ["/auth/callback?flow=flow-1"],
  });

  render(<RouterProvider router={router} />);

  await screen.findByText(
    "元のブラウザでログインを続けてください。この画面に認証情報は保存されません",
  );
  expect(createAuthGatewayMock).toHaveBeenCalledTimes(1);
  // eslint-disable-next-line @typescript-eslint/unbound-method
  expect(gateway.completeCallback).toHaveBeenCalledTimes(1);
});

it("handles the original callback result after StrictMode remounts the effect", async () => {
  let resolveCallback: ((result: AuthCallbackResult) => void) | undefined;
  const callbackResult = new Promise<AuthCallbackResult>((resolve) => {
    resolveCallback = resolve;
  });
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn().mockReturnValue(callbackResult),
    resumeFlow: vi.fn(),
  };
  const router = createMemoryRouter(
    [
      { path: "/auth/callback", element: <AuthCallbackPage gateway={gateway} /> },
      { path: "/onboarding", element: <h1>家族の初回設定</h1> },
    ],
    { initialEntries: ["/auth/callback?code=code-1&state=state-1"] },
  );

  render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  resolveCallback?.({
    kind: "complete",
    continuation: "same_browser",
    returnTo: "/onboarding",
    flowId: "flow-1",
  });

  expect(await screen.findByRole("heading", { name: "家族の初回設定" })).toBeInTheDocument();
  // StrictModeでも認証コードを二重交換しないことを保証する。
  // eslint-disable-next-line @typescript-eslint/unbound-method
  expect(gateway.completeCallback).toHaveBeenCalledTimes(1);
});
