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
