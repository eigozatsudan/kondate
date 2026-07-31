import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import type { AuthGateway } from "./auth-gateway";
import { LOGIN_EMAIL_HINT, LOGIN_PAGE_LEAD, LOGIN_PAGE_NOTE, LoginPage } from "./login-page";

vi.mock("./use-auth", () => ({
  useAuth: () => ({ status: "unauthenticated", session: null }),
}));

it("explains that first-time users can register on the same screen", () => {
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn(),
    resumeFlow: vi.fn(),
  };

  render(
    <MemoryRouter>
      <LoginPage gateway={gateway} />
    </MemoryRouter>,
  );

  expect(screen.getByText(LOGIN_PAGE_LEAD)).toBeVisible();
  expect(screen.getByText(LOGIN_PAGE_NOTE)).toBeVisible();
  expect(screen.getByText(LOGIN_EMAIL_HINT)).toBeVisible();
  expect(screen.getByText("Google アカウントではじめての方も、そのまま使えます。")).toBeVisible();
  expect(screen.getByRole("button", { name: "Googleで続ける" })).toBeVisible();
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
  };

  render(
    <MemoryRouter>
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

it("restores sent context when magic link expired and last email is known (B-I8)", () => {
  sessionStorage.setItem("kondate.auth.lastMagicEmail", "user@example.com");
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn(),
    resumeFlow: vi.fn(),
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
  };

  render(
    <MemoryRouter initialEntries={["/login?accountDeleted=1"]}>
      <LoginPage gateway={gateway} />
    </MemoryRouter>,
  );

  expect(screen.getByRole("status")).toHaveTextContent("アカウントを削除しました");
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
    }),
  );
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn(),
    resumeFlow: vi.fn(),
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
  };

  render(
    <MemoryRouter>
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
  };

  render(
    <MemoryRouter initialEntries={["/login"]}>
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
  };

  render(
    <MemoryRouter initialEntries={["/login?returnTo=%2Fpantry"]}>
      <LoginPage gateway={gateway} />
    </MemoryRouter>,
  );

  await user.click(screen.getByRole("button", { name: "Googleで続ける" }));
  expect(signInWithGoogle).toHaveBeenCalledWith("/pantry");

  await user.type(screen.getByLabelText("メールアドレス"), "user@example.com");
  await user.click(screen.getByRole("button", { name: "ログイン用メールを送る" }));
  expect(sendMagicLink).toHaveBeenCalledWith("user@example.com", "/pantry");
});

it.each([
  ["empty", "/login?returnTo=", "/planner"],
  // B-I5: 裸 "/" は RootEntry へ戻すために許可する
  ["bare slash", "/login?returnTo=%2F", "/"],
  ["external URL", "/login?returnTo=https%3A%2F%2Fattacker.example", "/planner"],
  ["protocol-relative URL", "/login?returnTo=%2F%2Fattacker.example", "/planner"],
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
