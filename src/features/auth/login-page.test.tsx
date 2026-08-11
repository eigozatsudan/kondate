import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import type { AuthGateway } from "./auth-gateway";
import {
  LOGIN_EMAIL_HINT,
  LOGIN_PAGE_LEAD,
  LOGIN_PAGE_NOTE,
  LOGIN_PAGE_NOTE_WITH_EMAIL,
  LoginPage,
} from "./login-page";
import { useAuth } from "./use-auth";

vi.mock("./use-auth", () => ({
  useAuth: vi.fn(() => ({ status: "unauthenticated", session: null })),
}));

/** マジックリンク操作テスト用（SHOW_EMAIL_LOGIN 時は /login でも可。クエリは互換のため残す） */
const emailLoginEntry = "/login?emailLogin=1";

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
  expect(screen.queryByText("メールを確認してください")).not.toBeInTheDocument();
  sessionStorage.removeItem("kondate.auth.magicSentUi");
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
