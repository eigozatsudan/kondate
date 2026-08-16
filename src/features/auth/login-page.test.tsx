import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COLD_START_SESSION_DEADLINE_MS } from "./auth-provider";
import { publishAuthContinuationCompletion } from "./auth-continuation-completion";
import type { AuthGateway } from "./auth-gateway";
import {
  LOGIN_EMAIL_HINT,
  LOGIN_PAGE_LEAD,
  LOGIN_PAGE_NOTE,
  LOGIN_PAGE_NOTE_WITH_EMAIL,
  LoginPage,
} from "./login-page";
import { useAuth } from "./use-auth";

const leftoverSignOut = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }));

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({
    auth: { signOut: leftoverSignOut },
  }),
}));

vi.mock("./use-auth", () => ({
  useAuth: vi.fn(() => ({ status: "unauthenticated", session: null })),
}));

/** マジックリンク操作テスト用（SHOW_EMAIL_LOGIN 時は /login でも可。クエリは互換のため残す） */
const emailLoginEntry = "/login?emailLogin=1";
const leftoverSessionStorageKey = "kondate.auth.supabase";

function renderLoginAt(entry: string, gateway: AuthGateway) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/login" element={<LoginPage gateway={gateway} />} />
        <Route path="/welcome" element={<p>welcome-dest</p>} />
        <Route path="/planner" element={<p>planner-dest</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  leftoverSignOut.mockReset();
  leftoverSignOut.mockResolvedValue({ error: null });
  window.localStorage.removeItem(leftoverSessionStorageKey);
  window.localStorage.removeItem(`${leftoverSessionStorageKey}-code-verifier`);
});

it("explains that first-time users can register on the same screen with Google and email", () => {
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn(),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };

  render(
    <MemoryRouter>
      <LoginPage gateway={gateway} />
    </MemoryRouter>,
  );

  expect(screen.getByText(LOGIN_PAGE_LEAD)).toBeVisible();
  expect(screen.getByText(LOGIN_PAGE_NOTE_WITH_EMAIL)).toBeVisible();
  expect(screen.getByText(LOGIN_EMAIL_HINT)).toBeVisible();
  expect(screen.getByLabelText("メールアドレス")).toBeVisible();
  expect(screen.getByText("Google アカウントではじめての方も、そのまま使えます。")).toBeVisible();
  expect(screen.getByRole("button", { name: "Googleで続ける" })).toBeVisible();
  expect(screen.getByRole("button", { name: "ログイン用メールを送る" })).toBeVisible();
  // Google のみ向けの短い注記は出さない
  expect(screen.queryByText(LOGIN_PAGE_NOTE)).toBeNull();
});

it("shows email magic-link form by default without emailLogin query", () => {
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn(),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };

  render(
    <MemoryRouter initialEntries={["/login"]}>
      <LoginPage gateway={gateway} />
    </MemoryRouter>,
  );

  expect(screen.getByText(LOGIN_PAGE_NOTE_WITH_EMAIL)).toBeVisible();
  expect(screen.getByText(LOGIN_EMAIL_HINT)).toBeVisible();
  expect(screen.getByRole("button", { name: "ログイン用メールを送る" })).toBeVisible();
});

it("places Google first and renders the complete sent state", async () => {
  const user = userEvent.setup();
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn().mockResolvedValue({
      flowId: "flow-1",
      email: "user@example.com",
      resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
    }),
    completeCallback: vi.fn(),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };

  render(
    <MemoryRouter initialEntries={[emailLoginEntry]}>
      <LoginPage gateway={gateway} />
    </MemoryRouter>,
  );

  const actions = screen.getAllByRole("button");
  expect(actions[0]).toHaveTextContent("Googleで続ける");
  await user.type(screen.getByLabelText("メールアドレス"), "user@example.com");
  await user.click(screen.getByRole("button", { name: "ログイン用メールを送る" }));

  expect(await screen.findByText("user@example.com に送りました")).toBeInTheDocument();
  expect(screen.getByText("迷惑メールフォルダも確認してください")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "メールアドレスを変更" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Googleに切り替える" })).toBeInTheDocument();
});

it("shows visible error copy when the callback arrives unbound to a known flow", () => {
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn(),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };

  render(
    <MemoryRouter
      initialEntries={[{ pathname: "/login", state: { authError: "unbound_callback" } }]}
    >
      <LoginPage gateway={gateway} />
    </MemoryRouter>,
  );

  expect(screen.getByRole("alert")).toHaveTextContent(
    "ログインの情報を確認できませんでした。最初からやり直してください。",
  );
});

it.each([
  {
    code: "unbound_callback" as const,
    copy: "ログインの情報を確認できませんでした。最初からやり直してください。",
  },
  {
    code: "oauth_cancelled" as const,
    copy: "Googleログインがキャンセルされました。もう一度試すか、別の方法を選べます。",
  },
  {
    code: "auth_callback_failed" as const,
    copy: "ログインを確認できませんでした。もう一度お試しください。",
  },
] as const)("shows authError=$code from query (full leave path)", ({ code, copy }) => {
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn(),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };

  render(
    <MemoryRouter initialEntries={[`/login?authError=${code}`]}>
      <LoginPage gateway={gateway} />
    </MemoryRouter>,
  );

  expect(screen.getByRole("alert")).toHaveTextContent(copy);
});

it("restores sent context when magic link expired and last email is known (B-I8)", () => {
  sessionStorage.setItem(
    "kondate.auth.lastMagicEmail",
    JSON.stringify({ email: "user@example.com", storedAt: new Date().toISOString() }),
  );
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn(),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };

  render(
    <MemoryRouter
      initialEntries={[{ pathname: "/login", state: { authError: "magic_link_expired" } }]}
    >
      <LoginPage gateway={gateway} />
    </MemoryRouter>,
  );

  expect(screen.getByRole("heading", { name: "リンクの期限が切れました" })).toBeInTheDocument();
  expect(screen.getByText("user@example.com に送りました")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "ログイン用メールを再送" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "メールアドレスを変更" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Googleに切り替える" })).toBeInTheDocument();
  sessionStorage.removeItem("kondate.auth.lastMagicEmail");
});

it("does not rehydrate sent UI when accountDeleted notice must show", () => {
  sessionStorage.setItem(
    "kondate.auth.magicSentUi",
    JSON.stringify({
      email: "user@example.com",
      flowId: "flow-rehydrate-1",
      resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
    }),
  );
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn(),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };

  render(
    <MemoryRouter initialEntries={["/login?accountDeleted=1"]}>
      <LoginPage gateway={gateway} />
    </MemoryRouter>,
  );

  expect(screen.getByRole("status")).toHaveTextContent("アカウントを削除しました");
  // AP8: 方針 B（匿名共有残存）を成功バナーでも再掲
  expect(screen.getByRole("status")).toHaveTextContent(/匿名一般化済みの緊急候補本文/);
  // AP9: dialog と単一ソースで Stripe / 他端末残存を再掲
  expect(screen.getByRole("status")).toHaveTextContent(/Stripe/);
  expect(screen.getByRole("status")).toHaveTextContent(/他の端末に残った下書き/);
  expect(screen.queryByText("メールを確認してください")).not.toBeInTheDocument();
  sessionStorage.removeItem("kondate.auth.magicSentUi");
});

it("AP8: accountDeleted banner mentions this-device residual when localResidual=1", () => {
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn(),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };

  render(
    <MemoryRouter initialEntries={["/login?accountDeleted=1&localResidual=1"]}>
      <LoginPage gateway={gateway} />
    </MemoryRouter>,
  );

  expect(screen.getByRole("status")).toHaveTextContent("この端末に下書きや一時データが残っている");
  expect(screen.getByRole("status")).toHaveTextContent(/Stripe/);
  expect(screen.getByRole("status")).toHaveTextContent(/他の端末に残った下書き/);
});

it("shows sessionExpired notice and does not rehydrate sent UI", () => {
  sessionStorage.setItem(
    "kondate.auth.magicSentUi",
    JSON.stringify({
      email: "user@example.com",
      flowId: "flow-rehydrate-1",
      resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
    }),
  );
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn(),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };

  render(
    <MemoryRouter initialEntries={["/login?sessionExpired=1&returnTo=%2Fplanner"]}>
      <LoginPage gateway={gateway} />
    </MemoryRouter>,
  );

  expect(screen.getByRole("status")).toHaveTextContent(
    "ログインの有効期限が切れたか、別の端末でログアウトされたため、もう一度ログインしてください。",
  );
  expect(screen.queryByText("メールを確認してください")).not.toBeInTheDocument();
  sessionStorage.removeItem("kondate.auth.magicSentUi");
});

it("U1-I2 rehydrates magic-link sent UI from sessionStorage after reload", async () => {
  const resendAvailableAt = new Date(Date.now() + 60_000).toISOString();
  sessionStorage.setItem(
    "kondate.auth.magicSentUi",
    JSON.stringify({
      email: "user@example.com",
      flowId: "flow-rehydrate-1",
      resendAvailableAt,
      storedAt: new Date().toISOString(),
    }),
  );
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn(),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };

  render(
    <MemoryRouter>
      <LoginPage gateway={gateway} />
    </MemoryRouter>,
  );

  expect(screen.getByText("user@example.com に送りました")).toBeInTheDocument();
  // クールダウン中は再送ボタンが無効（無意味な再送で secret を焼かない）
  expect(await screen.findByRole("button", { name: /秒後に再送できます/ })).toBeDisabled();
  sessionStorage.removeItem("kondate.auth.magicSentUi");
});

it("allows retrying Google after switching from a magic link and a failed start", async () => {
  const user = userEvent.setup();
  const gateway: AuthGateway = {
    signInWithGoogle: vi
      .fn()
      .mockRejectedValueOnce(new Error("failed"))
      .mockResolvedValueOnce(undefined),
    sendMagicLink: vi.fn().mockResolvedValue({
      flowId: "flow-1",
      email: "user@example.com",
      resendAvailableAt: new Date(Date.now()).toISOString(),
    }),
    completeCallback: vi.fn(),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };

  render(
    <MemoryRouter initialEntries={[emailLoginEntry]}>
      <LoginPage gateway={gateway} />
    </MemoryRouter>,
  );

  await user.type(screen.getByLabelText("メールアドレス"), "user@example.com");
  await user.click(screen.getByRole("button", { name: "ログイン用メールを送る" }));
  await user.click(screen.getByRole("button", { name: "Googleに切り替える" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Googleログインを開始できませんでした。もう一度お試しください。",
  );

  await user.click(screen.getByRole("button", { name: "Googleに切り替える" }));
  // eslint-disable-next-line @typescript-eslint/unbound-method
  expect(gateway.signInWithGoogle).toHaveBeenCalledTimes(2);
});

it("uses /welcome for Google and magic link when returnTo is omitted", async () => {
  const user = userEvent.setup();
  const signInWithGoogle = vi.fn().mockResolvedValue(undefined);
  const sendMagicLink = vi.fn().mockResolvedValue({
    flowId: "flow-1",
    email: "user@example.com",
    resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const gateway: AuthGateway = {
    signInWithGoogle,
    sendMagicLink,
    completeCallback: vi.fn(),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };

  render(
    <MemoryRouter initialEntries={[emailLoginEntry]}>
      <LoginPage gateway={gateway} />
    </MemoryRouter>,
  );

  await user.click(screen.getByRole("button", { name: "Googleで続ける" }));
  expect(signInWithGoogle).toHaveBeenCalledWith("/welcome");

  await user.type(screen.getByLabelText("メールアドレス"), "user@example.com");
  await user.click(screen.getByRole("button", { name: "ログイン用メールを送る" }));
  expect(sendMagicLink).toHaveBeenCalledWith("user@example.com", "/welcome");
});

it("preserves an explicit safe returnTo for Google and magic link", async () => {
  const user = userEvent.setup();
  const signInWithGoogle = vi.fn().mockResolvedValue(undefined);
  const sendMagicLink = vi.fn().mockResolvedValue({
    flowId: "flow-1",
    email: "user@example.com",
    resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const gateway: AuthGateway = {
    signInWithGoogle,
    sendMagicLink,
    completeCallback: vi.fn(),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };

  render(
    <MemoryRouter initialEntries={["/login?emailLogin=1&returnTo=%2Fpantry"]}>
      <LoginPage gateway={gateway} />
    </MemoryRouter>,
  );

  await user.click(screen.getByRole("button", { name: "Googleで続ける" }));
  expect(signInWithGoogle).toHaveBeenCalledWith("/pantry");

  await user.type(screen.getByLabelText("メールアドレス"), "user@example.com");
  await user.click(screen.getByRole("button", { name: "ログイン用メールを送る" }));
  expect(sendMagicLink).toHaveBeenCalledWith("user@example.com", "/pantry");
});

it("C1: drops /login and /auth/callback returnTo for Google and magic link", async () => {
  const user = userEvent.setup();
  const signInWithGoogle = vi.fn().mockResolvedValue(undefined);
  const sendMagicLink = vi.fn().mockResolvedValue({
    flowId: "flow-1",
    email: "user@example.com",
    resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const gateway: AuthGateway = {
    signInWithGoogle,
    sendMagicLink,
    completeCallback: vi.fn(),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };

  const { unmount } = render(
    <MemoryRouter initialEntries={["/login?emailLogin=1&returnTo=%2Flogin"]}>
      <LoginPage gateway={gateway} />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole("button", { name: "Googleで続ける" }));
  expect(signInWithGoogle).toHaveBeenCalledWith("/welcome");
  unmount();

  signInWithGoogle.mockClear();
  render(
    <MemoryRouter initialEntries={["/login?emailLogin=1&returnTo=%2Fauth%2Fcallback"]}>
      <LoginPage gateway={gateway} />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole("button", { name: "Googleで続ける" }));
  expect(signInWithGoogle).toHaveBeenCalledWith("/welcome");
  await user.type(screen.getByLabelText("メールアドレス"), "user@example.com");
  await user.click(screen.getByRole("button", { name: "ログイン用メールを送る" }));
  expect(sendMagicLink).toHaveBeenCalledWith("user@example.com", "/welcome");
});

it("C13: discards stale magic-link residual sessionStorage past TTL", () => {
  // residual TTL は 60s。61s 前の snapshot は捨てる
  const staleAt = new Date(Date.now() - 61_000).toISOString();
  sessionStorage.setItem(
    "kondate.auth.lastMagicEmail",
    JSON.stringify({ email: "stale@example.com", storedAt: staleAt }),
  );
  sessionStorage.setItem(
    "kondate.auth.magicSentUi",
    JSON.stringify({
      email: "stale@example.com",
      flowId: "flow-stale",
      resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
      storedAt: staleAt,
    }),
  );
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn(),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };

  render(
    <MemoryRouter initialEntries={["/login"]}>
      <LoginPage gateway={gateway} />
    </MemoryRouter>,
  );

  // 期限切れ residual は復元せず、読み取り時に消す
  expect(screen.queryByText("stale@example.com に送りました")).not.toBeInTheDocument();
  expect(sessionStorage.getItem("kondate.auth.lastMagicEmail")).toBeNull();
  expect(sessionStorage.getItem("kondate.auth.magicSentUi")).toBeNull();
});

it("C2: authenticated login still shows oauth_cancelled instead of navigating away", () => {
  vi.mocked(useAuth).mockReturnValue({
    status: "authenticated",
    session: { user: { id: "user-magic" } } as never,
    refreshSession: vi.fn(),
    sessionProbeDegraded: false,
  });
  try {
    const gateway: AuthGateway = {
      signInWithGoogle: vi.fn(),
      sendMagicLink: vi.fn(),
      completeCallback: vi.fn(),
      resumeFlow: vi.fn(),
      confirmMagicLink: vi.fn(),
    };

    render(
      <MemoryRouter initialEntries={["/login?authError=oauth_cancelled"]}>
        <LoginPage gateway={gateway} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "こんだて日和" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Googleログインがキャンセルされました。もう一度試すか、別の方法を選べます。",
    );
    expect(screen.getByRole("button", { name: "Googleで続ける" })).toBeVisible();
  } finally {
    vi.mocked(useAuth).mockReturnValue({
      status: "unauthenticated",
      session: null,
      refreshSession: vi.fn(),
      sessionProbeDegraded: false,
    });
  }
});

it.each([
  {
    label: "unbound_callback query",
    entry: "/login?authError=unbound_callback",
    heading: "こんだて日和",
    copy: "ログインの情報を確認できませんでした。最初からやり直してください。",
    googleName: "Googleで続ける",
  },
  {
    label: "restart-style query-less /login",
    entry: "/login",
    heading: "こんだて日和",
    copy: null,
    googleName: "Googleで続ける",
  },
] as const)(
  "C-R2: authenticated login still shows leftover-capable $label instead of navigating away",
  ({ entry, heading, copy, googleName }) => {
    vi.mocked(useAuth).mockReturnValue({
      status: "authenticated",
      session: { user: { id: "user-magic" } } as never,
      refreshSession: vi.fn(),
      sessionProbeDegraded: false,
    });
    try {
      const gateway: AuthGateway = {
        signInWithGoogle: vi.fn(),
        sendMagicLink: vi.fn(),
        completeCallback: vi.fn(),
        resumeFlow: vi.fn(),
        confirmMagicLink: vi.fn(),
      };

      renderLoginAt(entry, gateway);

      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
      if (copy !== null) {
        expect(screen.getByRole("alert")).toHaveTextContent(copy);
      }
      expect(screen.getByRole("button", { name: googleName })).toBeVisible();
      expect(screen.queryByText("welcome-dest")).not.toBeInTheDocument();
      expect(screen.queryByText("planner-dest")).not.toBeInTheDocument();
    } finally {
      vi.mocked(useAuth).mockReturnValue({
        status: "unauthenticated",
        session: null,
        refreshSession: vi.fn(),
        sessionProbeDegraded: false,
      });
    }
  },
);

it.each([
  {
    label: "auth_callback_failed query",
    entry: "/login?authError=auth_callback_failed",
    heading: "こんだて日和",
    copy: "ログインを確認できませんでした。もう一度お試しください。",
    googleName: "Googleで続ける",
  },
  {
    label: "auth_callback_failed with returnTo",
    entry: "/login?authError=auth_callback_failed&returnTo=%2Fplanner",
    heading: "こんだて日和",
    copy: "ログインを確認できませんでした。もう一度お試しください。",
    googleName: "Googleで続ける",
  },
  {
    label: "magic_link_expired query",
    entry: "/login?authError=magic_link_expired",
    heading: "リンクの期限が切れました",
    copy: "このリンクは期限切れか、すでに使用されています。",
    googleName: "Googleに切り替える",
  },
  {
    label: "magic_link_expired with returnTo",
    entry: "/login?authError=magic_link_expired&returnTo=%2Fplanner",
    heading: "リンクの期限が切れました",
    copy: "このリンクは期限切れか、すでに使用されています。",
    googleName: "Googleに切り替える",
  },
] as const)(
  "C-R3: authenticated login still shows leftover-capable $label instead of navigating away",
  ({ entry, heading, copy, googleName }) => {
    vi.mocked(useAuth).mockReturnValue({
      status: "authenticated",
      session: { user: { id: "user-magic" } } as never,
      refreshSession: vi.fn(),
      sessionProbeDegraded: false,
    });
    try {
      const gateway: AuthGateway = {
        signInWithGoogle: vi.fn(),
        sendMagicLink: vi.fn(),
        completeCallback: vi.fn(),
        resumeFlow: vi.fn(),
        confirmMagicLink: vi.fn(),
      };

      renderLoginAt(entry, gateway);

      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent(copy);
      expect(screen.getByRole("button", { name: googleName })).toBeVisible();
      expect(screen.queryByText("welcome-dest")).not.toBeInTheDocument();
      expect(screen.queryByText("planner-dest")).not.toBeInTheDocument();
    } finally {
      vi.mocked(useAuth).mockReturnValue({
        status: "unauthenticated",
        session: null,
        refreshSession: vi.fn(),
        sessionProbeDegraded: false,
      });
    }
  },
);

it.each([
  {
    label: "unbound_callback leave",
    entry: "/login?authError=unbound_callback",
  },
  {
    label: "query-less restart",
    entry: "/login",
  },
] as const)(
  "C-R4: leftover-capable $label local-signs-out leftover when no sibling completion",
  async ({ entry }) => {
    window.localStorage.setItem(leftoverSessionStorageKey, "leftover-persist");
    vi.mocked(useAuth).mockReturnValue({
      status: "authenticated",
      session: { user: { id: "user-magic" } } as never,
      refreshSession: vi.fn(),
      sessionProbeDegraded: false,
    });
    try {
      const gateway: AuthGateway = {
        signInWithGoogle: vi.fn(),
        sendMagicLink: vi.fn(),
        completeCallback: vi.fn(),
        resumeFlow: vi.fn(),
        confirmMagicLink: vi.fn(),
      };

      render(
        <MemoryRouter initialEntries={[entry]}>
          <LoginPage gateway={gateway} />
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(leftoverSignOut).toHaveBeenCalledWith({ scope: "local" });
      });
      expect(window.localStorage.getItem(leftoverSessionStorageKey)).toBeNull();
    } finally {
      vi.mocked(useAuth).mockReturnValue({
        status: "unauthenticated",
        session: null,
        refreshSession: vi.fn(),
        sessionProbeDegraded: false,
      });
    }
  },
);

it.each([
  {
    label: "oauth_cancelled leave",
    entry: "/login?authError=oauth_cancelled",
    googleName: "Googleで続ける",
  },
  {
    label: "query-less restart",
    entry: "/login",
    googleName: "Googleで続ける",
  },
] as const)(
  "C2: leftover-capable $label waits for leftover signOut before Google start so PKCE verifier remains",
  async ({ entry, googleName }) => {
    const user = userEvent.setup();
    const pkceVerifierKey = `${leftoverSessionStorageKey}-code-verifier`;
    window.localStorage.setItem(leftoverSessionStorageKey, "leftover-persist");

    let releaseSignOut: (() => void) | undefined;
    leftoverSignOut.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseSignOut = () => {
            // auth-js _removeSession 相当: local signOut 完了時に PKCE verifier を消す
            window.localStorage.removeItem(pkceVerifierKey);
            resolve({ error: null });
          };
        }),
    );

    const signInWithGoogle = vi.fn().mockImplementation(() => {
      window.localStorage.setItem(pkceVerifierKey, "verifier-after-google-start");
      return Promise.resolve();
    });
    const gateway: AuthGateway = {
      signInWithGoogle,
      sendMagicLink: vi.fn(),
      completeCallback: vi.fn(),
      resumeFlow: vi.fn(),
      confirmMagicLink: vi.fn(),
    };

    render(
      <MemoryRouter initialEntries={[entry]}>
        <LoginPage gateway={gateway} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: googleName }));

    await waitFor(() => {
      expect(leftoverSignOut).toHaveBeenCalledWith({ scope: "local" });
    });
    // 掃除完了前は signInWithOAuth（verifier 書き込み）に入らない
    expect(signInWithGoogle).not.toHaveBeenCalled();

    act(() => {
      releaseSignOut?.();
    });

    await waitFor(() => {
      expect(signInWithGoogle).toHaveBeenCalled();
    });
    expect(window.localStorage.getItem(pkceVerifierKey)).toBe("verifier-after-google-start");
  },
);

it("C-R2: leftover-capable Google start keeps PKCE verifier when leftover signOut settles after 2s timeout", async () => {
  vi.useFakeTimers();
  const pkceVerifierKey = `${leftoverSessionStorageKey}-code-verifier`;
  window.localStorage.setItem(leftoverSessionStorageKey, "leftover-persist");

  let releaseSignOut: (() => void) | undefined;
  leftoverSignOut.mockImplementation(
    () =>
      new Promise((resolve) => {
        releaseSignOut = () => {
          // auth-js _removeSession 相当: local signOut 完了時に PKCE verifier を消す
          window.localStorage.removeItem(pkceVerifierKey);
          resolve({ error: null });
        };
      }),
  );

  const signInWithGoogle = vi.fn().mockImplementation(() => {
    window.localStorage.setItem(pkceVerifierKey, "verifier-after-google-start");
    return Promise.resolve();
  });
  const gateway: AuthGateway = {
    signInWithGoogle,
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn(),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
  };

  try {
    render(
      <MemoryRouter initialEntries={["/login?authError=oauth_cancelled"]}>
        <LoginPage gateway={gateway} />
      </MemoryRouter>,
    );

    expect(leftoverSignOut).toHaveBeenCalledWith({ scope: "local" });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Googleで続ける" }));
    });
    expect(signInWithGoogle).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    // 2s timeout 後も元 signOut が未完了なら verifier を書かない（C-R2）
    expect(signInWithGoogle).not.toHaveBeenCalled();

    await act(async () => {
      releaseSignOut?.();
      // leftoverCleanup → startGoogle の microtask を flush（fake timers 下の waitFor を使わない）
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });

    expect(signInWithGoogle).toHaveBeenCalled();
    expect(window.localStorage.getItem(pkceVerifierKey)).toBe("verifier-after-google-start");
  } finally {
    vi.useRealTimers();
  }
});

it("C-R4: leftover-capable login does not signOut leftover when sibling completion exists", async () => {
  window.localStorage.setItem(leftoverSessionStorageKey, "winner-persist");
  publishAuthContinuationCompletion({
    flowId: "google-winner",
    returnTo: "/planner",
  });
  vi.mocked(useAuth).mockReturnValue({
    status: "authenticated",
    session: { user: { id: "user-magic" } } as never,
    refreshSession: vi.fn(),
    sessionProbeDegraded: false,
  });
  try {
    const gateway: AuthGateway = {
      signInWithGoogle: vi.fn(),
      sendMagicLink: vi.fn(),
      completeCallback: vi.fn(),
      resumeFlow: vi.fn(),
      confirmMagicLink: vi.fn(),
    };

    render(
      <MemoryRouter initialEntries={["/login?authError=unbound_callback"]}>
        <LoginPage gateway={gateway} />
      </MemoryRouter>,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(leftoverSignOut).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(leftoverSessionStorageKey)).toBe("winner-persist");
  } finally {
    vi.mocked(useAuth).mockReturnValue({
      status: "unauthenticated",
      session: null,
      refreshSession: vi.fn(),
      sessionProbeDegraded: false,
    });
    window.localStorage.removeItem("kondate.auth.supabase.continuation-complete.google-winner");
  }
});

it("C9: clears magic-link residual sessionStorage when already authenticated", () => {
  sessionStorage.setItem(
    "kondate.auth.lastMagicEmail",
    JSON.stringify({ email: "user@example.com", storedAt: new Date().toISOString() }),
  );
  sessionStorage.setItem(
    "kondate.auth.magicSentUi",
    JSON.stringify({
      email: "user@example.com",
      flowId: "flow-1",
      resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
      storedAt: new Date().toISOString(),
    }),
  );
  vi.mocked(useAuth).mockReturnValue({
    status: "authenticated",
    session: { user: { id: "user-1" } } as never,
    refreshSession: vi.fn(),
    sessionProbeDegraded: false,
  });
  try {
    const gateway: AuthGateway = {
      signInWithGoogle: vi.fn(),
      sendMagicLink: vi.fn(),
      completeCallback: vi.fn(),
      resumeFlow: vi.fn(),
      confirmMagicLink: vi.fn(),
    };

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage gateway={gateway} />
      </MemoryRouter>,
    );

    expect(sessionStorage.getItem("kondate.auth.lastMagicEmail")).toBeNull();
    expect(sessionStorage.getItem("kondate.auth.magicSentUi")).toBeNull();
  } finally {
    vi.mocked(useAuth).mockReturnValue({
      status: "unauthenticated",
      session: null,
      refreshSession: vi.fn(),
      sessionProbeDegraded: false,
    });
    sessionStorage.removeItem("kondate.auth.lastMagicEmail");
    sessionStorage.removeItem("kondate.auth.magicSentUi");
  }
});

it.each([
  ["empty", "/login?emailLogin=1&returnTo=", "/planner"],
  // B-I5: 裸 "/" は RootEntry へ戻すために許可する
  ["bare slash", "/login?emailLogin=1&returnTo=%2F", "/"],
  ["external URL", "/login?emailLogin=1&returnTo=https%3A%2F%2Fattacker.example", "/planner"],
  ["protocol-relative URL", "/login?emailLogin=1&returnTo=%2F%2Fattacker.example", "/planner"],
])(
  "sanitizes an explicit %s returnTo for Google and magic link",
  async (_label, entry, expected) => {
    const user = userEvent.setup();
    const signInWithGoogle = vi.fn().mockResolvedValue(undefined);
    const sendMagicLink = vi.fn().mockResolvedValue({
      flowId: "flow-1",
      email: "user@example.com",
      resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const gateway: AuthGateway = {
      signInWithGoogle,
      sendMagicLink,
      completeCallback: vi.fn(),
      resumeFlow: vi.fn(),
      confirmMagicLink: vi.fn(),
    };

    render(
      <MemoryRouter initialEntries={[entry]}>
        <LoginPage gateway={gateway} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Googleで続ける" }));
    expect(signInWithGoogle).toHaveBeenCalledWith(expected);

    await user.type(screen.getByLabelText("メールアドレス"), "user@example.com");
    await user.click(screen.getByRole("button", { name: "ログイン用メールを送る" }));
    expect(sendMagicLink).toHaveBeenCalledWith("user@example.com", expected);
  },
);

describe("C6: login form while auth is loading", () => {
  const useAuthMock = vi.mocked(useAuth);

  afterEach(() => {
    useAuthMock.mockReturnValue({
      status: "unauthenticated",
      session: null,
      refreshSession: vi.fn(),
      sessionProbeDegraded: false,
    });
    vi.useRealTimers();
  });

  it("does not show Google start CTA while status is loading past 15s", async () => {
    useAuthMock.mockReturnValue({
      status: "loading",
      session: null,
      refreshSession: vi.fn(),
      sessionProbeDegraded: false,
    });
    vi.useFakeTimers();
    const gateway: AuthGateway = {
      signInWithGoogle: vi.fn(),
      sendMagicLink: vi.fn(),
      completeCallback: vi.fn(),
      resumeFlow: vi.fn(),
      confirmMagicLink: vi.fn(),
    };

    render(
      <MemoryRouter>
        <LoginPage gateway={gateway} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("button", { name: "Googleで続ける" })).toBeNull();
    expect(screen.getByText("読み込み中…")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS + 1_000);
    });

    expect(screen.queryByRole("button", { name: "Googleで続ける" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ログイン用メールを送る" })).toBeNull();
    expect(screen.getByText("読み込み中…")).toBeInTheDocument();
  });

  it("shows Google start CTA when unauthenticated", () => {
    useAuthMock.mockReturnValue({
      status: "unauthenticated",
      session: null,
      refreshSession: vi.fn(),
      sessionProbeDegraded: false,
    });
    const gateway: AuthGateway = {
      signInWithGoogle: vi.fn(),
      sendMagicLink: vi.fn(),
      completeCallback: vi.fn(),
      resumeFlow: vi.fn(),
      confirmMagicLink: vi.fn(),
    };

    render(
      <MemoryRouter>
        <LoginPage gateway={gateway} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Googleで続ける" })).toBeVisible();
  });
});
