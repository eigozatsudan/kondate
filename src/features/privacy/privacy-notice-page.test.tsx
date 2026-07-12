import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { PrivacyNoticeContent } from "./privacy-notice-page";

it("explains sent, unsent, and stored data before accepting", async () => {
  const user = userEvent.setup();
  const onAccept = vi.fn();
  render(<PrivacyNoticeContent saving={false} onAccept={onAccept} onSkip={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "AIへ送る情報" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "AIへ送らない情報" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "アプリに保存する情報" })).toBeInTheDocument();
  const accept = screen.getByRole("button", { name: "確認して進む" });
  expect(accept).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /説明を確認しました/ }));
  await user.click(accept);
  expect(onAccept).toHaveBeenCalledOnce();
});
