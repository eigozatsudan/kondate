import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HomeGenerateCard } from "./home-generate-card";

describe("HomeGenerateCard", () => {
  it("renders the primary generation entry point", () => {
    render(<HomeGenerateCard remainingToday={2} onStart={vi.fn()} />);
    expect(screen.getByRole("button", { name: "今日の献立をつくる" })).toBeInTheDocument();
  });

  it("shows the remaining count for today", () => {
    render(<HomeGenerateCard remainingToday={2} onStart={vi.fn()} />);
    expect(screen.getByText(/あと2回/u)).toBeInTheDocument();
  });

  it("omits remaining copy when count is unknown", () => {
    render(<HomeGenerateCard remainingToday={null} onStart={vi.fn()} />);
    expect(screen.queryByText(/あと/u)).not.toBeInTheDocument();
  });

  it("calls onStart when the primary button is pressed", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<HomeGenerateCard remainingToday={1} onStart={onStart} />);
    await user.click(screen.getByRole("button", { name: "今日の献立をつくる" }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("surfaces pending resume as the priority action", async () => {
    const user = userEvent.setup();
    const onResumePending = vi.fn();
    render(
      <HomeGenerateCard
        remainingToday={2}
        onStart={vi.fn()}
        hasResumablePending
        onResumePending={onResumePending}
      />,
    );
    expect(screen.getByText(/作成中の献立があります/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "作成中の献立を続ける" }));
    expect(onResumePending).toHaveBeenCalledTimes(1);
  });

  it("P9: remainingToday===0 では新規開始 CTA を無効化し再開は残す", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    const onResumePending = vi.fn();
    const { rerender } = render(<HomeGenerateCard remainingToday={0} onStart={onStart} />);
    expect(screen.getByRole("button", { name: "今日の献立をつくる" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "今日の献立をつくる" }));
    expect(onStart).not.toHaveBeenCalled();

    rerender(
      <HomeGenerateCard
        remainingToday={0}
        onStart={onStart}
        hasResumablePending
        onResumePending={onResumePending}
      />,
    );
    expect(screen.getByRole("button", { name: "作成中の献立を続ける" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "今日の献立をつくる" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "作成中の献立を続ける" }));
    expect(onResumePending).toHaveBeenCalledTimes(1);
  });
});
