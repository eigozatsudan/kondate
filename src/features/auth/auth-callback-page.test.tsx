import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { expect, it, vi } from "vitest";
import { createAuthGateway, type AuthCallbackResult, type AuthGateway } from "./auth-gateway";
import { AuthCallbackPage } from "./auth-callback-page";
import { publishAuthContinuationCompletion } from "./auth-continuation-completion";
import { startAuthContinuationRecovery } from "./auth-continuation-recovery";
import {
  clearAuthFlow,
  markAuthContinuationCallbackOwner,
  readAuthContinuationCallbackStartedAt,
} from "./auth-flow";

vi.mock("./auth-gateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auth-gateway")>();
  return { ...actual, createAuthGateway: vi.fn() };
});

vi.mock("./auth-continuation-completion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auth-continuation-completion")>();
  return { ...actual, publishAuthContinuationCompletion: vi.fn() };
});

vi.mock("./auth-continuation-recovery", () => ({
  startAuthContinuationRecovery: vi.fn(() => () => undefined),
}));

vi.mock("./auth-flow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auth-flow")>();
  return {
    ...actual,
    clearAuthFlow: vi.fn(),
    markAuthContinuationCallbackOwner: vi.fn(() => true),
    readAuthContinuationCallbackStartedAt: vi.fn(() => new Date().toISOString()),
  };
});

const createAuthGatewayMock = vi.mocked(createAuthGateway);
const startAuthContinuationRecoveryMock = vi.mocked(startAuthContinuationRecovery);

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
      "元のブラウザでログインを続けてください。この画面にログイン用の情報は保存されません",
    ),
  ).toBeInTheDocument();
  // B-C1: deposited にはやり直し CTA が必須（session は作らない）
  expect(screen.getByRole("button", { name: "最初からやり直す" })).toBeInTheDocument();
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
    [{ path: "/auth/callback", element: <AuthCallbackPage gateway={gateway} ttlMs={300_000} /> }],
    { initialEntries: ["/auth/callback"] },
  );
  render(<RouterProvider router={router} />);

  // モック関数はthisを参照しないため、呼び出し回数だけを検証する。
  // eslint-disable-next-line @typescript-eslint/unbound-method
  expect(gateway.completeCallback).toHaveBeenCalledTimes(1);
  expect(window.location.pathname + window.location.search + window.location.hash).toBe(
    "/auth/callback?flow=flow-1",
  );
  expect(markAuthContinuationCallbackOwner).toHaveBeenCalledWith(
    "flow-1",
    window.localStorage,
    expect.any(Date),
    300_000,
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
    "元のブラウザでログインを続けてください。この画面にログイン用の情報は保存されません",
  );
  expect(createAuthGatewayMock).toHaveBeenCalledTimes(1);
  // eslint-disable-next-line @typescript-eslint/unbound-method
  expect(gateway.completeCallback).toHaveBeenCalledTimes(1);
});

it("keeps waiting when another same-browser tab wins the one-time claim", async () => {
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn().mockResolvedValue({
      kind: "awaiting_completion",
      flowId: "flow-1",
      returnTo: "/onboarding",
    }),
    resumeFlow: vi.fn(),
  };
  const router = createMemoryRouter(
    [{ path: "/auth/callback", element: <AuthCallbackPage gateway={gateway} ttlMs={300_000} /> }],
    { initialEntries: ["/auth/callback?flow=flow-1"] },
  );

  render(<RouterProvider router={router} />);

  expect(await screen.findByRole("heading", { name: "ログインを確認中" })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/auth/callback");
});

it("uses completion published before the losing callback starts waiting", async () => {
  window.localStorage.setItem(
    "kondate.auth.supabase.continuation-complete",
    JSON.stringify({ flowId: "flow-1", returnTo: "/onboarding" }),
  );
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn().mockResolvedValue({
      kind: "awaiting_completion",
      flowId: "flow-1",
      returnTo: "/onboarding",
    }),
    // AUTH-01: awaiting 中は resumeFlow を 5s 間隔で叩くため Promise を返す
    resumeFlow: vi.fn().mockResolvedValue({
      kind: "awaiting_completion",
      flowId: "flow-1",
      returnTo: "/onboarding",
    }),
  };
  const router = createMemoryRouter(
    [
      {
        path: "/auth/callback",
        element: <AuthCallbackPage gateway={gateway} ttlMs={300_000} />,
      },
      { path: "/onboarding", element: <h1>家族の初回設定</h1> },
    ],
    { initialEntries: ["/auth/callback?flow=flow-1"] },
  );

  render(<RouterProvider router={router} />);

  expect(await screen.findByRole("heading", { name: "家族の初回設定" })).toBeInTheDocument();
});

it("returns a synthetic 404 handoff to a safe error at the existing flow TTL", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn().mockResolvedValue({
      kind: "awaiting_completion",
      flowId: "flow-1",
      returnTo: "/onboarding",
    }),
    resumeFlow: vi.fn().mockResolvedValue({
      kind: "awaiting_completion",
      flowId: "flow-1",
      returnTo: "/onboarding",
    }),
  };
  const router = createMemoryRouter(
    [
      {
        path: "/auth/callback",
        element: <AuthCallbackPage gateway={gateway} ttlMs={300_000} />,
      },
      { path: "/login", element: <h1>ログイン</h1> },
    ],
    { initialEntries: ["/auth/callback?flow=flow-1"] },
  );
  const view = render(<RouterProvider router={router} />);
  await act(async () => Promise.resolve());

  await act(() => vi.advanceTimersByTime(300_000));

  expect(router.state.location.pathname).toBe("/login");
  expect(router.state.location.state).toEqual({ authError: "unbound_callback" });
  view.unmount();
  vi.useRealTimers();
});

it("normalizes a callback-only future flow and stops retries at one fixed TTL", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
  const actualFlow = await vi.importActual<typeof import("./auth-flow")>("./auth-flow");
  vi.mocked(markAuthContinuationCallbackOwner).mockImplementation(
    actualFlow.markAuthContinuationCallbackOwner,
  );
  vi.mocked(readAuthContinuationCallbackStartedAt).mockImplementation(
    actualFlow.readAuthContinuationCallbackStartedAt,
  );
  const flowId = "10000000-0000-4000-8000-000000000001";
  window.history.replaceState(null, "", `/auth/callback?flow=${flowId}`);
  window.localStorage.setItem(
    `kondate.auth.flow.${flowId}`,
    JSON.stringify({
      id: flowId,
      secret: "A".repeat(43),
      state: "B".repeat(43),
      origin: window.location.origin,
      returnTo: "/onboarding",
      sessionExchange: "supabase",
      startedAt: "2026-07-13T00:10:00.000Z",
    }),
  );
  const resumeFlow = vi.fn().mockResolvedValue({
    kind: "awaiting_completion",
    flowId,
    returnTo: "/onboarding",
  });
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn().mockResolvedValue({
      kind: "awaiting_completion",
      flowId,
      returnTo: "/onboarding",
    }),
    resumeFlow,
  };
  const stopRecovery = vi.fn();
  startAuthContinuationRecoveryMock.mockImplementationOnce(() => stopRecovery);
  const router = createMemoryRouter(
    [
      {
        path: "/auth/callback",
        element: <AuthCallbackPage gateway={gateway} ttlMs={300_000} />,
      },
      { path: "/login", element: <h1>ログイン</h1> },
    ],
    { initialEntries: [`/auth/callback?flow=${flowId}`] },
  );
  const view = render(<RouterProvider router={router} />);
  await act(async () => Promise.resolve());

  await act(async () => {
    await vi.advanceTimersByTimeAsync(300_000);
  });
  const recoveryCallsAtExpiry = startAuthContinuationRecoveryMock.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  const finalPath = router.state.location.pathname;
  const finalRecoveryCallCount = startAuthContinuationRecoveryMock.mock.calls.length;
  const marker = JSON.parse(
    window.localStorage.getItem(`kondate.auth.supabase.clock-rebase.${flowId}`) ?? "null",
  ) as unknown;
  view.unmount();
  window.localStorage.clear();
  vi.mocked(markAuthContinuationCallbackOwner).mockImplementation(() => true);
  vi.mocked(readAuthContinuationCallbackStartedAt).mockImplementation(() =>
    new Date().toISOString(),
  );
  vi.useRealTimers();

  expect(finalPath).toBe("/login");
  expect(recoveryCallsAtExpiry).toBeGreaterThan(0);
  expect(finalRecoveryCallCount).toBe(recoveryCallsAtExpiry);
  expect(stopRecovery).toHaveBeenCalledOnce();
  expect(marker).toEqual({
    rebasedAt: "2026-07-13T00:00:00.000Z",
    deadlineAt: "2026-07-13T00:05:00.000Z",
  });
});

it("AUTH-01: re-claims on the callback owner tab after a transient awaiting_completion", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
  try {
    const resumeFlow = vi.fn().mockResolvedValue({
      kind: "complete",
      continuation: "same_browser",
      flowId: "flow-1",
      returnTo: "/onboarding",
    });
    const gateway: AuthGateway = {
      signInWithGoogle: vi.fn(),
      sendMagicLink: vi.fn(),
      completeCallback: vi.fn().mockResolvedValue({
        kind: "awaiting_completion",
        flowId: "flow-1",
        returnTo: "/onboarding",
      }),
      resumeFlow,
    };
    const router = createMemoryRouter(
      [
        {
          path: "/auth/callback",
          element: <AuthCallbackPage gateway={gateway} ttlMs={300_000} />,
        },
        { path: "/onboarding", element: <h1>家族の初回設定</h1> },
      ],
      { initialEntries: ["/auth/callback?flow=flow-1"] },
    );
    render(<RouterProvider router={router} />);
    await act(async () => Promise.resolve());
    const recoveryInput = startAuthContinuationRecoveryMock.mock.calls.at(-1)?.[0];
    expect(recoveryInput).toMatchObject({
      gateway,
      storage: window.localStorage,
      targetFlowId: "flow-1",
    });
    await act(async () => {
      recoveryInput?.onComplete({
        kind: "complete",
        flowId: "flow-1",
        returnTo: "/onboarding",
      });
      await Promise.resolve();
    });
    expect(resumeFlow).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/onboarding");
    expect(publishAuthContinuationCompletion).toHaveBeenCalledWith({
      flowId: "flow-1",
      returnTo: "/onboarding",
    });
  } finally {
    vi.useRealTimers();
  }
});

it("fails closed when completeCallback rejects without leaking the rejection", async () => {
  const flowId = "10000000-0000-4000-8000-000000000001";
  const rejection = new Error(`secret:${"A".repeat(43)}`);
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn().mockRejectedValue(rejection),
    resumeFlow: vi.fn(),
  };
  const unhandled = vi.fn();
  window.addEventListener("unhandledrejection", unhandled);
  const router = createMemoryRouter(
    [
      { path: "/auth/callback", element: <AuthCallbackPage gateway={gateway} /> },
      { path: "/login", element: <h1>ログイン</h1> },
    ],
    { initialEntries: [`/auth/callback?flow=${flowId}`] },
  );

  render(<RouterProvider router={router} />);
  expect(await screen.findByRole("heading", { name: "ログイン" })).toBeInTheDocument();

  expect(unhandled).not.toHaveBeenCalled();
  expect(router.state.location.state).toEqual({ authError: "unbound_callback" });
  expect(clearAuthFlow).toHaveBeenCalledWith(flowId);
  window.removeEventListener("unhandledrejection", unhandled);
});

it("maps a targeted recovery expiry to the existing callback terminal flow", async () => {
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn().mockResolvedValue({
      kind: "awaiting_completion",
      flowId: "flow-1",
      returnTo: "/onboarding",
    }),
    resumeFlow: vi.fn(),
  };
  const router = createMemoryRouter(
    [
      { path: "/auth/callback", element: <AuthCallbackPage gateway={gateway} /> },
      { path: "/login", element: <h1>ログイン</h1> },
    ],
    { initialEntries: ["/auth/callback?flow=flow-1"] },
  );

  render(<RouterProvider router={router} />);
  await act(async () => Promise.resolve());
  const recoveryInput = startAuthContinuationRecoveryMock.mock.calls.at(-1)?.[0];
  await act(async () => {
    recoveryInput?.onResult?.({ kind: "expired" });
    await Promise.resolve();
  });

  expect(router.state.location.pathname).toBe("/login");
  expect(router.state.location.state).toEqual({ authError: "magic_link_expired" });
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
    resumeFlow: vi.fn().mockResolvedValue({
      kind: "awaiting_completion",
      flowId: "flow-1",
      returnTo: "/onboarding",
    }),
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
  expect(publishAuthContinuationCompletion).toHaveBeenCalledWith({
    flowId: "flow-1",
    returnTo: "/onboarding",
  });
});
