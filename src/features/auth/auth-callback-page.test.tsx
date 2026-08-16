import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, expect, it, vi } from "vitest";
import { createAuthGateway, type AuthCallbackResult, type AuthGateway } from "./auth-gateway";
import { AuthCallbackPage } from "./auth-callback-page";
import { COLD_START_GET_SESSION_TIMEOUT_MS } from "./auth-provider";
import { publishAuthContinuationCompletion } from "./auth-continuation-completion";
import { startAuthContinuationRecovery } from "./auth-continuation-recovery";
import { resetAuthCallbackUrlCaptureForTests } from "./auth-callback-url-capture";
import {
  clearAuthFlow,
  markAuthContinuationCallbackOwner,
  readAuthContinuationCallbackStartedAt,
  resetAuthFlowUserDismissedMemoryForTests,
} from "./auth-flow";

const getSessionMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    data: { session: { access_token: "live-tok" } },
    error: null,
  }),
);

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({
    auth: { getSession: getSessionMock },
  }),
}));

vi.mock("./auth-gateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auth-gateway")>();
  return { ...actual, createAuthGateway: vi.fn() };
});

vi.mock("./auth-continuation-completion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auth-continuation-completion")>();
  return { ...actual, publishAuthContinuationCompletion: vi.fn() };
});

// C15/C9 hangWatchdog / failClosed が isAuthContinuationExchangeBusy を呼ぶ。
// 完全差し替え mock だと export 欠落で TypeError → leave 経路が壊れる。
vi.mock("./auth-continuation-recovery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auth-continuation-recovery")>();
  return {
    ...actual,
    startAuthContinuationRecovery: vi.fn(() => () => undefined),
  };
});

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

afterEach(() => {
  resetAuthCallbackUrlCaptureForTests();
  resetAuthFlowUserDismissedMemoryForTests();
  // C7 capture が window.history を見るため、前テストの replaceState が残ると flow UUID が混線する
  window.history.replaceState(null, "", "/");
  startAuthContinuationRecoveryMock.mockClear();
  vi.mocked(publishAuthContinuationCompletion).mockClear();
  vi.mocked(clearAuthFlow).mockClear();
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue({
    data: { session: { access_token: "live-tok" } },
    error: null,
  });
});

function renderCallback(
  gateway: AuthGateway,
  options?: {
    initialEntry?: string;
    ttlMs?: number;
    leaveAuthCallback?: (href: string) => void;
    strict?: boolean;
  },
) {
  const leaveAuthCallback = options?.leaveAuthCallback ?? vi.fn();
  // C7: captureAndStripAuthCallbackUrl は window.location を見る。
  // MemoryRouter の entry だけでは jsdom の location が更新されないため揃える。
  // 既に history を明示設定したテスト（code 付き URL 等）は上書きしない。
  const initialEntry = options?.initialEntry ?? "/auth/callback?flow=flow-1";
  if (!window.location.pathname.startsWith("/auth/callback")) {
    window.history.replaceState(null, "", initialEntry);
  }
  const callbackElement =
    options?.ttlMs === undefined ? (
      <AuthCallbackPage gateway={gateway} leaveAuthCallback={leaveAuthCallback} />
    ) : (
      <AuthCallbackPage
        gateway={gateway}
        ttlMs={options.ttlMs}
        leaveAuthCallback={leaveAuthCallback}
      />
    );
  const router = createMemoryRouter(
    [
      {
        path: "/auth/callback",
        element: callbackElement,
      },
      { path: "/onboarding", element: <h1>家族の初回設定</h1> },
      { path: "/login", element: <h1>ログイン</h1> },
      { path: "/planner", element: <h1>献立</h1> },
    ],
    { initialEntries: [initialEntry] },
  );
  const ui = options?.strict ? (
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  ) : (
    <RouterProvider router={router} />
  );
  const view = render(ui);
  return { leaveAuthCallback, router, view };
}

it("deposits in an isolated WebView and directs the user to the original browser", async () => {
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    sendEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
    completeCallback: vi.fn().mockResolvedValue({
      kind: "deposited",
      continuation: "original_browser",
      returnTo: "/onboarding",
      flowId: "flow-1",
    }),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };
  renderCallback(gateway);

  expect(
    await screen.findByText(
      "元のブラウザでログインを続けてください。この画面にログイン用の情報は保存されません",
    ),
  ).toBeInTheDocument();
  // B-C1: deposited にはやり直し CTA が必須（session は作らない）
  expect(screen.getByRole("button", { name: "最初からやり直す" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "家族の初回設定" })).not.toBeInTheDocument();
});

it("token_hash URL does not show the magic-link confirm CTA", async () => {
  const confirmMagicLink = vi.fn();
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    sendEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
    completeCallback: vi.fn().mockResolvedValue({
      kind: "error",
      code: "unbound_callback",
      returnTo: "/planner",
    }),
    resumeFlow: vi.fn(),
    confirmMagicLink,
  };
  const { leaveAuthCallback } = renderCallback(gateway, {
    initialEntry: `/auth/callback?token_hash=${"a".repeat(40)}`,
  });

  await waitFor(() => {
    expect(leaveAuthCallback).toHaveBeenCalledWith(
      "/login?authError=unbound_callback&returnTo=%2Fplanner",
    );
  });
  expect(screen.queryByRole("button", { name: "ログインを完了する" })).toBeNull();
  expect(confirmMagicLink).not.toHaveBeenCalled();
});

it("needs_confirmation leftover result does not show confirm CTA or call confirmMagicLink", async () => {
  const confirmMagicLink = vi.fn();
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    sendEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
    completeCallback: vi.fn().mockResolvedValue({
      kind: "needs_confirmation",
      flowId: "flow-1",
      returnTo: "/onboarding",
      tokenHash: "a".repeat(40),
      otpType: "email",
      state: "A".repeat(43),
    }),
    resumeFlow: vi.fn(),
    confirmMagicLink,
  };
  const { leaveAuthCallback } = renderCallback(gateway);

  await waitFor(() => {
    expect(screen.queryByRole("button", { name: "ログインを完了する" })).toBeNull();
  });
  expect(confirmMagicLink).not.toHaveBeenCalled();
  expect(leaveAuthCallback).toHaveBeenCalledWith(
    "/login?authError=unbound_callback&returnTo=%2Fonboarding",
  );
});

it("removes callback credentials from the browser URL before completing the callback", () => {
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    sendEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
    completeCallback: vi.fn().mockImplementation(() => new Promise(() => undefined)),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };
  window.history.replaceState(
    null,
    "",
    "/auth/callback?flow=flow-1&state=state-1&code=code-1&error=server_error#access_token=secret",
  );

  renderCallback(gateway, { ttlMs: 300_000, initialEntry: "/auth/callback" });

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

it("C5: strips unknown query keys such as access_token from the visible URL", () => {
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    sendEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
    completeCallback: vi.fn().mockImplementation(() => new Promise(() => undefined)),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };
  window.history.replaceState(
    null,
    "",
    "/auth/callback?flow=flow-1&state=state-1&code=code-1&access_token=stolen&refresh_token=r",
  );

  renderCallback(gateway, { ttlMs: 300_000, initialEntry: "/auth/callback" });

  // eslint-disable-next-line @typescript-eslint/unbound-method
  expect(gateway.completeCallback).toHaveBeenCalledTimes(1);
  // 可視 URL は flow のみ。トークン系は history 現 entry からも消える
  expect(window.location.pathname + window.location.search + window.location.hash).toBe(
    "/auth/callback?flow=flow-1",
  );
  expect(window.location.search).not.toContain("access_token");
  expect(window.location.search).not.toContain("refresh_token");
});

it("creates the default gateway once and completes the callback once", async () => {
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    sendEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
    completeCallback: vi.fn().mockResolvedValue({
      kind: "deposited",
      continuation: "original_browser",
      returnTo: "/planner",
      flowId: "flow-1",
    }),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };
  createAuthGatewayMock.mockReturnValue(gateway);
  const leaveAuthCallback = vi.fn();
  const router = createMemoryRouter(
    [
      {
        path: "/auth/callback",
        element: <AuthCallbackPage leaveAuthCallback={leaveAuthCallback} />,
      },
    ],
    { initialEntries: ["/auth/callback?flow=flow-1"] },
  );

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
    sendEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
    completeCallback: vi.fn().mockResolvedValue({
      kind: "awaiting_completion",
      flowId: "flow-1",
      returnTo: "/onboarding",
    }),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };
  const { leaveAuthCallback, router } = renderCallback(gateway, { ttlMs: 300_000 });

  expect(await screen.findByRole("heading", { name: "ログインを確認中" })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/auth/callback");
  expect(leaveAuthCallback).not.toHaveBeenCalled();
});

it("uses completion published before the losing callback starts waiting", async () => {
  window.localStorage.setItem(
    "kondate.auth.supabase.continuation-complete.flow-1",
    JSON.stringify({
      flowId: "flow-1",
      returnTo: "/onboarding",
      completedAt: new Date().toISOString(),
    }),
  );
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    sendEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
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
    confirmMagicLink: vi.fn(),
  };
  const { leaveAuthCallback } = renderCallback(gateway, { ttlMs: 300_000 });

  await waitFor(() => {
    expect(leaveAuthCallback).toHaveBeenCalledWith("/onboarding");
  });
});

it("C6: awaiting_completion does not leaveSuccess on stale completion without a live session", async () => {
  getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
  window.localStorage.setItem(
    "kondate.auth.supabase.continuation-complete.flow-1",
    JSON.stringify({
      flowId: "flow-1",
      returnTo: "/onboarding",
      completedAt: new Date().toISOString(),
    }),
  );
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    sendEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
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
    confirmMagicLink: vi.fn(),
  };
  const { leaveAuthCallback } = renderCallback(gateway, { ttlMs: 300_000 });

  await act(async () => Promise.resolve());
  await act(async () => Promise.resolve());
  expect(leaveAuthCallback).not.toHaveBeenCalled();
  expect(
    window.localStorage.getItem("kondate.auth.supabase.continuation-complete.flow-1"),
  ).toBeNull();
});

it("returns a synthetic 404 handoff to a safe error at the existing flow TTL", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    sendEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
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
    confirmMagicLink: vi.fn(),
  };
  const { leaveAuthCallback, view } = renderCallback(gateway, { ttlMs: 300_000 });
  await act(async () => Promise.resolve());

  await act(() => vi.advanceTimersByTime(300_000));

  expect(leaveAuthCallback).toHaveBeenCalledWith(
    "/login?authError=unbound_callback&returnTo=%2Fonboarding",
  );
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
    sendEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
    completeCallback: vi.fn().mockResolvedValue({
      kind: "awaiting_completion",
      flowId,
      returnTo: "/onboarding",
    }),
    resumeFlow,
    confirmMagicLink: vi.fn(),
  };
  const stopRecovery = vi.fn();
  startAuthContinuationRecoveryMock.mockImplementationOnce(() => stopRecovery);
  const leaveAuthCallback = vi.fn();
  const { view } = renderCallback(gateway, {
    ttlMs: 300_000,
    initialEntry: `/auth/callback?flow=${flowId}`,
    leaveAuthCallback,
  });
  await act(async () => Promise.resolve());

  await act(async () => {
    await vi.advanceTimersByTimeAsync(300_000);
  });
  const recoveryCallsAtExpiry = startAuthContinuationRecoveryMock.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
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

  expect(leaveAuthCallback).toHaveBeenCalledWith(
    "/login?authError=unbound_callback&returnTo=%2Fonboarding",
  );
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
      sendEmailOtp: vi.fn(),
      verifyEmailOtp: vi.fn(),
      completeCallback: vi.fn().mockResolvedValue({
        kind: "awaiting_completion",
        flowId: "flow-1",
        returnTo: "/onboarding",
      }),
      resumeFlow,
      confirmMagicLink: vi.fn(),
    };
    const { leaveAuthCallback } = renderCallback(gateway, { ttlMs: 300_000 });
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
      await Promise.resolve();
    });
    expect(resumeFlow).not.toHaveBeenCalled();
    expect(leaveAuthCallback).toHaveBeenCalledWith("/onboarding");
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
    sendEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
    completeCallback: vi.fn().mockRejectedValue(rejection),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };
  const unhandled = vi.fn();
  window.addEventListener("unhandledrejection", unhandled);
  // 前テストの mock 呼び出しを捨て、本ケースだけの clear 有無を見る
  vi.mocked(clearAuthFlow).mockClear();
  const { leaveAuthCallback } = renderCallback(gateway, {
    initialEntry: `/auth/callback?flow=${flowId}`,
  });

  await act(async () => Promise.resolve());
  // catch 経路の synthetic returnTo=/login はループ防止のため login URL に載せない
  expect(leaveAuthCallback).toHaveBeenCalledWith("/login?authError=unbound_callback");

  expect(unhandled).not.toHaveBeenCalled();
  // AUTH-1: unbound では秘密を焼かない（state mismatch 等と同一ポリシー）
  expect(clearAuthFlow).not.toHaveBeenCalled();
  window.removeEventListener("unhandledrejection", unhandled);
});

it("maps a targeted recovery expiry to the existing callback terminal flow", async () => {
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    sendEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
    completeCallback: vi.fn().mockResolvedValue({
      kind: "awaiting_completion",
      flowId: "flow-1",
      returnTo: "/onboarding",
    }),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };
  const { leaveAuthCallback } = renderCallback(gateway);

  await act(async () => Promise.resolve());
  const recoveryInput = startAuthContinuationRecoveryMock.mock.calls.at(-1)?.[0];
  await act(async () => {
    recoveryInput?.onResult?.({ kind: "expired" });
    await Promise.resolve();
  });

  expect(leaveAuthCallback).toHaveBeenCalledWith(
    "/login?authError=magic_link_expired&returnTo=%2Fonboarding",
  );
});

it("C5: code-less oauth_cancelled / expired results do not clear the terminal flow secret", async () => {
  const flowId = "10000000-0000-4000-8000-0000000000c5";
  for (const result of [
    {
      kind: "error" as const,
      code: "oauth_cancelled" as const,
      returnTo: "/onboarding",
      flowId,
    },
    { kind: "expired" as const, flowId, returnTo: "/onboarding" },
  ]) {
    vi.mocked(clearAuthFlow).mockClear();
    const gateway: AuthGateway = {
      signInWithGoogle: vi.fn(),
      sendMagicLink: vi.fn(),
      sendEmailOtp: vi.fn(),
      verifyEmailOtp: vi.fn(),
      completeCallback: vi.fn().mockResolvedValue(result),
      resumeFlow: vi.fn(),
      confirmMagicLink: vi.fn(),
    };
    const { leaveAuthCallback } = renderCallback(gateway, {
      initialEntry: `/auth/callback?flow=${flowId}`,
    });
    await act(async () => Promise.resolve());
    const expectedError = result.kind === "expired" ? "magic_link_expired" : "oauth_cancelled";
    expect(leaveAuthCallback).toHaveBeenCalledWith(
      `/login?authError=${expectedError}&returnTo=%2Fonboarding`,
    );
    // C5: state 一致の code 無し error/expired でも即 burn しない
    expect(clearAuthFlow).not.toHaveBeenCalled();
  }
});

it("C8: restart from deposited UI clears the flow secret", async () => {
  const user = userEvent.setup();
  const flowId = "10000000-0000-4000-8000-0000000000c8";
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    sendEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
    completeCallback: vi.fn().mockResolvedValue({
      kind: "deposited",
      continuation: "original_browser",
      returnTo: "/onboarding",
      flowId,
    }),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };
  const { leaveAuthCallback } = renderCallback(gateway, {
    initialEntry: `/auth/callback?flow=${flowId}`,
  });
  expect(await screen.findByRole("button", { name: "最初からやり直す" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "最初からやり直す" }));
  expect(clearAuthFlow).toHaveBeenCalledWith(flowId);
  expect(leaveAuthCallback).toHaveBeenCalledWith(
    "/login?authError=unbound_callback&returnTo=%2Fonboarding",
  );
});

it("handles the original callback result after StrictMode remounts the effect", async () => {
  let resolveCallback: ((result: AuthCallbackResult) => void) | undefined;
  const callbackResult = new Promise<AuthCallbackResult>((resolve) => {
    resolveCallback = resolve;
  });
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    sendEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
    completeCallback: vi.fn().mockReturnValue(callbackResult),
    resumeFlow: vi.fn().mockResolvedValue({
      kind: "awaiting_completion",
      flowId: "flow-1",
      returnTo: "/onboarding",
    }),
    confirmMagicLink: vi.fn(),
  };
  const { leaveAuthCallback } = renderCallback(gateway, {
    initialEntry: "/auth/callback?code=code-1&state=state-1",
    strict: true,
  });
  resolveCallback?.({
    kind: "complete",
    continuation: "same_browser",
    returnTo: "/onboarding",
    flowId: "flow-1",
  });

  await act(async () => Promise.resolve());
  expect(leaveAuthCallback).toHaveBeenCalledWith("/onboarding");
  // StrictModeでも認証コードを二重交換しないことを保証する。
  // eslint-disable-next-line @typescript-eslint/unbound-method
  expect(gateway.completeCallback).toHaveBeenCalledTimes(1);
  expect(publishAuthContinuationCompletion).toHaveBeenCalledWith({
    flowId: "flow-1",
    returnTo: "/onboarding",
  });
  // leave は二重に走らない
  expect(leaveAuthCallback).toHaveBeenCalledTimes(1);
});

it("leaves after immediate completion even when publishing completion fails", async () => {
  const secretError = new Error(`secret:${"A".repeat(43)}`);
  vi.mocked(publishAuthContinuationCompletion).mockImplementationOnce(() => {
    throw secretError;
  });
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    sendEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
    completeCallback: vi.fn().mockResolvedValue({
      kind: "complete",
      continuation: "same_browser",
      flowId: "flow-1",
      returnTo: "/onboarding",
    }),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };

  try {
    const { leaveAuthCallback } = renderCallback(gateway);
    await act(async () => Promise.resolve());
    expect(leaveAuthCallback).toHaveBeenCalledWith("/onboarding");
    expect(consoleError).not.toHaveBeenCalled();
  } finally {
    consoleError.mockRestore();
  }
});

it("cleans up and leaves after recovery completion when publishing fails", async () => {
  const secretError = new Error(`secret:${"A".repeat(43)}`);
  vi.mocked(publishAuthContinuationCompletion).mockImplementationOnce(() => {
    throw secretError;
  });
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const stopRecovery = vi.fn();
  startAuthContinuationRecoveryMock.mockImplementationOnce(() => stopRecovery);
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    sendEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
    completeCallback: vi.fn().mockResolvedValue({
      kind: "awaiting_completion",
      flowId: "flow-1",
      returnTo: "/onboarding",
    }),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };

  try {
    const { leaveAuthCallback } = renderCallback(gateway);
    await act(async () => Promise.resolve());
    const recoveryInput = startAuthContinuationRecoveryMock.mock.calls.at(-1)?.[0];
    await act(async () => {
      recoveryInput?.onComplete({
        kind: "complete",
        flowId: "flow-1",
        returnTo: "/onboarding",
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(leaveAuthCallback).toHaveBeenCalledWith("/onboarding");
    });
    expect(stopRecovery).toHaveBeenCalledOnce();
    expect(consoleError).not.toHaveBeenCalled();
  } finally {
    consoleError.mockRestore();
  }
});

it("uses full-page leave for success so SPA navigate is not required", async () => {
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    sendEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
    completeCallback: vi.fn().mockResolvedValue({
      kind: "complete",
      continuation: "same_browser",
      flowId: "flow-1",
      returnTo: "/welcome",
    }),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };
  const { leaveAuthCallback } = renderCallback(gateway);
  await act(async () => Promise.resolve());
  expect(leaveAuthCallback).toHaveBeenCalledWith("/welcome");
  // MemoryRouter 上には留まっても、本番は location.replace 相当が呼ばれる
  expect(leaveAuthCallback).toHaveBeenCalledTimes(1);
});

it("fails closed when completeCallback never settles past the continuation TTL", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
  try {
    const gateway: AuthGateway = {
      signInWithGoogle: vi.fn(),
      sendMagicLink: vi.fn(),
      sendEmailOtp: vi.fn(),
      verifyEmailOtp: vi.fn(),
      completeCallback: vi.fn().mockImplementation(() => new Promise(() => undefined)),
      resumeFlow: vi.fn(),
      confirmMagicLink: vi.fn(),
    };
    const { leaveAuthCallback } = renderCallback(gateway, { ttlMs: 300_000 });
    await act(async () => Promise.resolve());
    expect(leaveAuthCallback).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(leaveAuthCallback).toHaveBeenCalledWith("/login?authError=unbound_callback");
  } finally {
    vi.useRealTimers();
  }
});

it("C6: hangWatchdog fail-closes when getSession hangs despite a completion mark", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
  try {
    const flowId = "10000000-0000-4000-8000-0000000000c6";
    window.localStorage.setItem(
      `kondate.auth.flow.${flowId}`,
      JSON.stringify({
        id: flowId,
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "https://app.test",
        returnTo: "/onboarding",
        sessionExchange: "supabase",
        startedAt: "2026-07-13T00:00:00.000Z",
        expiresAt: "2026-07-13T00:00:30.000Z",
      }),
    );
    window.localStorage.setItem(
      `kondate.auth.supabase.callback-owner.${flowId}`,
      "2026-07-13T00:00:00.000Z",
    );
    window.localStorage.setItem(
      `kondate.auth.supabase.continuation-complete.${flowId}`,
      JSON.stringify({
        flowId,
        returnTo: "/onboarding",
        completedAt: "2026-07-13T00:00:00.000Z",
      }),
    );
    getSessionMock.mockReturnValue(new Promise(() => undefined));
    const gateway: AuthGateway = {
      signInWithGoogle: vi.fn(),
      sendMagicLink: vi.fn(),
      sendEmailOtp: vi.fn(),
      verifyEmailOtp: vi.fn(),
      completeCallback: vi.fn().mockImplementation(() => new Promise(() => undefined)),
      resumeFlow: vi.fn(),
      confirmMagicLink: vi.fn(),
    };
    const { leaveAuthCallback } = renderCallback(gateway, {
      ttlMs: 300_000,
      initialEntry: `/auth/callback?flow=${flowId}`,
    });
    await act(async () => Promise.resolve());
    expect(leaveAuthCallback).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    // hangWatchdog は発火済みだが getSession hang 中は leave できない
    expect(leaveAuthCallback).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLD_START_GET_SESSION_TIMEOUT_MS);
    });
    expect(leaveAuthCallback).toHaveBeenCalledWith(
      "/login?authError=unbound_callback&returnTo=%2Fonboarding",
    );
  } finally {
    vi.useRealTimers();
  }
});

it("C6: hangWatchdog fails closed at server expiresAt when shorter than local TTL", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
  try {
    const flowId = "10000000-0000-4000-8000-000000000001";
    window.localStorage.setItem(
      `kondate.auth.flow.${flowId}`,
      JSON.stringify({
        id: flowId,
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "https://app.test",
        returnTo: "/onboarding",
        sessionExchange: "supabase",
        startedAt: "2026-07-13T00:00:00.000Z",
        expiresAt: "2026-07-13T00:00:30.000Z",
      }),
    );
    window.localStorage.setItem(
      `kondate.auth.supabase.callback-owner.${flowId}`,
      "2026-07-13T00:00:00.000Z",
    );
    const gateway: AuthGateway = {
      signInWithGoogle: vi.fn(),
      sendMagicLink: vi.fn(),
      sendEmailOtp: vi.fn(),
      verifyEmailOtp: vi.fn(),
      completeCallback: vi.fn().mockImplementation(() => new Promise(() => undefined)),
      resumeFlow: vi.fn(),
      confirmMagicLink: vi.fn(),
    };
    const { leaveAuthCallback } = renderCallback(gateway, {
      ttlMs: 300_000,
      initialEntry: `/auth/callback?flow=${flowId}`,
    });
    await act(async () => Promise.resolve());
    expect(leaveAuthCallback).not.toHaveBeenCalled();
    // ローカル TTL 300s より前のサーバ 30s で fail-closed
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(leaveAuthCallback).toHaveBeenCalledWith(
      "/login?authError=unbound_callback&returnTo=%2Fonboarding",
    );
  } finally {
    vi.useRealTimers();
  }
});

it("C9: hangWatchdog does not clear secret while callback-prelease is held (post-claim gap)", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
  try {
    const flowId = "10000000-0000-4000-8000-0000000000c9";
    window.localStorage.setItem(
      `kondate.auth.flow.${flowId}`,
      JSON.stringify({
        id: flowId,
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "https://app.test",
        returnTo: "/onboarding",
        sessionExchange: "supabase",
        startedAt: "2026-07-13T00:00:00.000Z",
        expiresAt: "2026-07-13T00:00:30.000Z",
      }),
    );
    window.localStorage.setItem(
      `kondate.auth.supabase.callback-owner.${flowId}`,
      "2026-07-13T00:00:00.000Z",
    );
    // claim 成功〜exchange lease 前: exchange in-flight は無いが pre-lease が立つ
    window.localStorage.setItem(
      `kondate.auth.supabase.claim-poll-target-lease.${flowId}.callback-prelease`,
      JSON.stringify({
        flowId,
        instanceId: "callback-prelease",
        refreshedAt: Date.now(),
        pending: false,
      }),
    );
    const gateway: AuthGateway = {
      signInWithGoogle: vi.fn(),
      sendMagicLink: vi.fn(),
      sendEmailOtp: vi.fn(),
      verifyEmailOtp: vi.fn(),
      completeCallback: vi.fn().mockImplementation(() => new Promise(() => undefined)),
      resumeFlow: vi.fn(),
      confirmMagicLink: vi.fn(),
    };
    vi.mocked(clearAuthFlow).mockClear();
    const { leaveAuthCallback } = renderCallback(gateway, {
      ttlMs: 300_000,
      initialEntry: `/auth/callback?flow=${flowId}`,
    });
    await act(async () => Promise.resolve());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    // UI は unbound へ落ちるが secret は焼かない（late exchange / completion が救える）
    expect(leaveAuthCallback).toHaveBeenCalledWith(
      "/login?authError=unbound_callback&returnTo=%2Fonboarding",
    );
    expect(vi.mocked(clearAuthFlow)).not.toHaveBeenCalled();
  } finally {
    window.localStorage.clear();
    vi.useRealTimers();
  }
});

it("C-RR2: AUTH-R1 awaiting + pre-lease near-TTL failClosed does not clear secret", async () => {
  // C4/RR1 と同型の awaiting 期限経路に、AUTH-R1 が立てる pre-lease を載せたもの。
  // gateway テストが pre-lease 武装を固定。ここでは busy 時に clearAuthFlow しないことを固定。
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-13T00:01:00.000Z"));
  try {
    // UUID は hex のみ（z.uuid）。非 hex だと readAuthFlow が null になり期限クリップが外れる
    const flowId = "10000000-0000-4000-8000-0000000000c2";
    window.localStorage.setItem(
      `kondate.auth.flow.${flowId}`,
      JSON.stringify({
        id: flowId,
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "https://app.test",
        returnTo: "/onboarding",
        sessionExchange: "supabase",
        startedAt: "2026-07-13T00:00:00.000Z",
        expiresAt: "2026-07-13T00:00:30.000Z",
        clockSkewMs: 60_000,
      }),
    );
    window.localStorage.setItem(
      `kondate.auth.supabase.callback-owner.${flowId}`,
      "2026-07-13T00:00:00.000Z",
    );
    // AUTH-R1 が strip reload で立てる pre-lease（claim→exchange ギャップ保護）
    window.localStorage.setItem(
      `kondate.auth.supabase.claim-poll-target-lease.${flowId}.callback-prelease`,
      JSON.stringify({
        flowId,
        instanceId: "callback-prelease",
        refreshedAt: Date.now(),
        pending: false,
      }),
    );
    vi.mocked(clearAuthFlow).mockClear();
    const gateway: AuthGateway = {
      signInWithGoogle: vi.fn(),
      sendMagicLink: vi.fn(),
      sendEmailOtp: vi.fn(),
      verifyEmailOtp: vi.fn(),
      completeCallback: vi.fn().mockResolvedValue({
        kind: "awaiting_completion",
        flowId,
        returnTo: "/onboarding",
      }),
      resumeFlow: vi.fn().mockResolvedValue({
        kind: "awaiting_completion",
        flowId,
        returnTo: "/onboarding",
      }),
      confirmMagicLink: vi.fn(),
    };
    const { leaveAuthCallback } = renderCallback(gateway, {
      ttlMs: 300_000,
      initialEntry: `/auth/callback?flow=${flowId}`,
    });
    await act(async () => Promise.resolve());
    expect(leaveAuthCallback).not.toHaveBeenCalled();
    expect(vi.mocked(clearAuthFlow)).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    // UI は unbound へ。pre-lease busy のため secret は焼かない（C4/RR1 は clear される対照）
    expect(leaveAuthCallback).toHaveBeenCalledWith(
      "/login?authError=unbound_callback&returnTo=%2Fonboarding",
    );
    expect(vi.mocked(clearAuthFlow)).not.toHaveBeenCalled();
  } finally {
    window.localStorage.clear();
    vi.useRealTimers();
  }
});

it("C9/C12: hangWatchdog does not extend past wall serverExpires via positive clockSkewMs", async () => {
  vi.useFakeTimers();
  // wall は既に serverExpires 超過。正 skew でも remaining は wall 上限で 0（安全側）。
  vi.setSystemTime(new Date("2026-07-13T00:01:00.000Z"));
  try {
    const flowId = "10000000-0000-4000-8000-000000000001";
    window.localStorage.setItem(
      `kondate.auth.flow.${flowId}`,
      JSON.stringify({
        id: flowId,
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "https://app.test",
        returnTo: "/onboarding",
        sessionExchange: "supabase",
        startedAt: "2026-07-13T00:00:00.000Z",
        expiresAt: "2026-07-13T00:00:30.000Z",
        clockSkewMs: 60_000,
      }),
    );
    window.localStorage.setItem(
      `kondate.auth.supabase.callback-owner.${flowId}`,
      "2026-07-13T00:00:00.000Z",
    );
    const gateway: AuthGateway = {
      signInWithGoogle: vi.fn(),
      sendMagicLink: vi.fn(),
      sendEmailOtp: vi.fn(),
      verifyEmailOtp: vi.fn(),
      completeCallback: vi.fn().mockImplementation(() => new Promise(() => undefined)),
      resumeFlow: vi.fn(),
      confirmMagicLink: vi.fn(),
    };
    const { leaveAuthCallback } = renderCallback(gateway, {
      ttlMs: 300_000,
      initialEntry: `/auth/callback?flow=${flowId}`,
    });
    await act(async () => Promise.resolve());
    // remaining 0 の setTimeout を発火
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // wall 超過時は即 leave（lease と同型の wall 基準）
    expect(leaveAuthCallback).toHaveBeenCalledWith(
      "/login?authError=unbound_callback&returnTo=%2Fonboarding",
    );
  } finally {
    vi.useRealTimers();
  }
});

it("C9/C12: awaiting_completion wait does not extend past wall serverExpires via positive clockSkewMs", async () => {
  vi.useFakeTimers();
  // hangWatchdog と同型: wall が serverExpires 超過なら正 skew でも即 failClosed。
  vi.setSystemTime(new Date("2026-07-13T00:01:00.000Z"));
  try {
    const flowId = "10000000-0000-4000-8000-000000000001";
    window.localStorage.setItem(
      `kondate.auth.flow.${flowId}`,
      JSON.stringify({
        id: flowId,
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "https://app.test",
        returnTo: "/onboarding",
        sessionExchange: "supabase",
        startedAt: "2026-07-13T00:00:00.000Z",
        expiresAt: "2026-07-13T00:00:30.000Z",
        clockSkewMs: 60_000,
      }),
    );
    window.localStorage.setItem(
      `kondate.auth.supabase.callback-owner.${flowId}`,
      "2026-07-13T00:00:00.000Z",
    );
    vi.mocked(clearAuthFlow).mockClear();
    const gateway: AuthGateway = {
      signInWithGoogle: vi.fn(),
      sendMagicLink: vi.fn(),
      sendEmailOtp: vi.fn(),
      verifyEmailOtp: vi.fn(),
      completeCallback: vi.fn().mockResolvedValue({
        kind: "awaiting_completion",
        flowId,
        returnTo: "/onboarding",
      }),
      resumeFlow: vi.fn().mockResolvedValue({
        kind: "awaiting_completion",
        flowId,
        returnTo: "/onboarding",
      }),
      confirmMagicLink: vi.fn(),
    };
    const { leaveAuthCallback } = renderCallback(gateway, {
      ttlMs: 300_000,
      initialEntry: `/auth/callback?flow=${flowId}`,
    });
    await act(async () => Promise.resolve());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // hangWatchdog が wall 超過で即 leave（completion wait も remaining 0）
    expect(leaveAuthCallback).toHaveBeenCalledWith(
      "/login?authError=unbound_callback&returnTo=%2Fonboarding",
    );
  } finally {
    vi.useRealTimers();
  }
});

it("C14: deposited WebView switches to expired retry UI after hang watchdog TTL", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
  try {
    const gateway: AuthGateway = {
      signInWithGoogle: vi.fn(),
      sendMagicLink: vi.fn(),
      sendEmailOtp: vi.fn(),
      verifyEmailOtp: vi.fn(),
      completeCallback: vi.fn().mockResolvedValue({
        kind: "deposited",
        continuation: "original_browser",
        flowId: "flow-1",
        returnTo: "/planner",
      }),
      resumeFlow: vi.fn(),
      confirmMagicLink: vi.fn(),
    };
    const { leaveAuthCallback } = renderCallback(gateway, { ttlMs: 300_000 });
    // fake timers 下では findBy* の wait が hang するため flush 後に getBy*
    await act(async () => Promise.resolve());
    expect(
      screen.getByText(
        "元のブラウザでログインを続けてください。この画面にログイン用の情報は保存されません",
      ),
    ).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    // C14: 強制 leave はせず、期限切れ・やり直す二次 UI へ切替
    expect(leaveAuthCallback).not.toHaveBeenCalled();
    expect(screen.getByText("ログインの引き継ぎ期限が切れました")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "最初からやり直す" })).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});
