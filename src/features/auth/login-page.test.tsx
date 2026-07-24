import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import type { AuthGateway } from "./auth-gateway";
import { LoginPage } from "./login-page";

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
