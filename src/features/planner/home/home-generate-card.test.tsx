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
  it("U3: shows resume and restart actions with progress when a draft is in progress", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    const onResumeDraft = vi.fn();
    const onRestartDraft = vi.fn();
    render(
      <HomeGenerateCard
        remainingToday={2}
        onStart={onStart}
        draftProgress={{ answeredSteps: 3, totalSteps: 9, readyForReview: false }}
        onResumeDraft={onResumeDraft}
        onRestartDraft={onRestartDraft}
      />,
    );
    expect(screen.getByText("3 / 9 まで答えています")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "今日の献立をつくる" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "続きから答える" }));
    expect(onResumeDraft).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "最初から" }));
    expect(onRestartDraft).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("U3: pending resume keeps priority over draft progress", () => {
    render(
      <HomeGenerateCard
        remainingToday={2}
        onStart={vi.fn()}
        hasResumablePending
        onResumePending={vi.fn()}
        draftProgress={{ answeredSteps: 8, totalSteps: 9, readyForReview: true }}
        onResumeDraft={vi.fn()}
        onRestartDraft={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "作成中の献立を続ける" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "今日の献立をつくる" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "続きから答える" })).not.toBeInTheDocument();
    expect(screen.queryByText(/まで答えています/u)).not.toBeInTheDocument();
  });

  it("B-2: says the resume target is a question, not the review, when an answer was left open", () => {
    render(
      <HomeGenerateCard
        remainingToday={2}
        onStart={vi.fn()}
        draftProgress={{
          answeredSteps: 8,
          totalSteps: 9,
          readyForReview: true,
          continuesAtQuestion: true,
        }}
        onResumeDraft={vi.fn()}
        onRestartDraft={vi.fn()}
      />,
    );
    expect(
      screen.getByText("必須の質問はすべて答えています。答えかけの質問から続けられます。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/確認画面から続けられます/u)).not.toBeInTheDocument();
  });

  it("U3: disabled stops both draft actions", () => {
    render(
      <HomeGenerateCard
        remainingToday={2}
        onStart={vi.fn()}
        draftProgress={{ answeredSteps: 3, totalSteps: 9, readyForReview: false }}
        onResumeDraft={vi.fn()}
        onRestartDraft={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByRole("button", { name: "続きから答える" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "最初から" })).toBeDisabled();
  });
  it("U3: progress line is static text, not a live region", () => {
    render(
      <HomeGenerateCard
        remainingToday={null}
        onStart={vi.fn()}
        draftProgress={{ answeredSteps: 3, totalSteps: 9, readyForReview: false }}
        onResumeDraft={vi.fn()}
        onRestartDraft={vi.fn()}
      />,
    );
    expect(screen.getByText("3 / 9 まで答えています")).not.toHaveAttribute("role");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("U3: says all required questions are answered instead of 8 / 9 when resuming at review", () => {
    render(
      <HomeGenerateCard
        remainingToday={2}
        onStart={vi.fn()}
        draftProgress={{ answeredSteps: 8, totalSteps: 9, readyForReview: true }}
        onResumeDraft={vi.fn()}
        onRestartDraft={vi.fn()}
      />,
    );
    expect(
      screen.getByText("必須の質問はすべて答えています。確認画面から続けられます。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/8 \/ 9/u)).not.toBeInTheDocument();
  });

  it("U3/P9: remainingToday===0 keeps resume enabled and disables restart", async () => {
    const user = userEvent.setup();
    const onResumeDraft = vi.fn();
    const onRestartDraft = vi.fn();
    render(
      <HomeGenerateCard
        remainingToday={0}
        onStart={vi.fn()}
        draftProgress={{ answeredSteps: 3, totalSteps: 9, readyForReview: false }}
        onResumeDraft={onResumeDraft}
        onRestartDraft={onRestartDraft}
      />,
    );
    expect(screen.getByRole("button", { name: "続きから答える" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "最初から" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "最初から" }));
    expect(onRestartDraft).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "続きから答える" }));
    expect(onResumeDraft).toHaveBeenCalledTimes(1);
  });
});
