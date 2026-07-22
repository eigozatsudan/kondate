import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChoiceCard } from "./choice-card";
import { InlineNotice } from "./inline-notice";
import { ProgressIndicator } from "./progress-indicator";
import { ReviewRow } from "./review-row";
import { WizardFrame } from "./wizard-frame";

describe("wizard UI", () => {
  it("moves focus to the question heading when the step changes", () => {
    const { rerender } = render(
      <WizardFrame
        stepKey="meal"
        currentStep={1}
        totalSteps={5}
        title="いつの食事ですか？"
        primaryAction={{ label: "次へ", onClick: vi.fn() }}
      >
        <p>選択肢</p>
      </WizardFrame>,
    );
    expect(screen.getByRole("heading", { name: "いつの食事ですか？" })).toHaveFocus();
    rerender(
      <WizardFrame
        stepKey="ingredient"
        currentStep={2}
        totalSteps={5}
        title="メインの食材は？"
        primaryAction={{ label: "次へ", onClick: vi.fn() }}
      >
        <p>選択肢</p>
      </WizardFrame>,
    );
    expect(screen.getByRole("heading", { name: "メインの食材は？" })).toHaveFocus();
  });

  it("exposes selection without relying on colour", async () => {
    const onSelect = vi.fn();
    render(<ChoiceCard title="夕食" selected selectionMode="single" onSelect={onSelect} />);
    const choice = screen.getByRole("button", { name: /夕食/ });
    expect(choice).toHaveAttribute("aria-pressed", "true");
    expect(within(choice).getByText("選択中")).toBeVisible();
    await userEvent.click(choice);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("renders progress as text and a bar", () => {
    render(<ProgressIndicator currentStep={2} totalSteps={5} />);
    expect(screen.getByText("質問 2 / 5")).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "質問 2 / 5" })).toHaveAttribute(
      "aria-valuenow",
      "2",
    );
  });

  it("keeps progress labels unique across multiple instances", () => {
    render(
      <>
        <ProgressIndicator currentStep={2} totalSteps={5} />
        <ProgressIndicator currentStep={2} totalSteps={5} />
      </>,
    );
    const progressbars = screen.getAllByRole("progressbar", { name: "質問 2 / 5" });
    const labelledBy = progressbars.map((progressbar) =>
      progressbar.getAttribute("aria-labelledby"),
    );
    expect(new Set(labelledBy).size).toBe(2);
    expect(screen.getAllByText("質問 2 / 5").every((label) => label.id.length > 0)).toBe(true);
  });

  it("normalizes invalid progress boundaries", () => {
    const { rerender } = render(<ProgressIndicator currentStep={0} totalSteps={0} />);
    expect(screen.getByText("質問 1 / 1")).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    rerender(<ProgressIndicator currentStep={9} totalSteps={5} />);
    expect(screen.getByText("質問 5 / 5")).toBeVisible();
    expect(screen.getByRole("progressbar").firstElementChild).toHaveStyle({ width: "100%" });
  });

  it("uses alert only for errors", () => {
    const { rerender } = render(
      <InlineNotice tone="notice" title="お知らせ">
        保存しました
      </InlineNotice>,
    );
    expect(screen.getByRole("note")).toHaveTextContent("保存しました");
    rerender(
      <InlineNotice tone="warning" title="確認してください">
        入力を見直してください
      </InlineNotice>,
    );
    expect(screen.getByRole("note")).toHaveTextContent("入力を見直してください");
    rerender(
      <InlineNotice tone="error" title="保存できません">
        再試行してください
      </InlineNotice>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("再試行してください");
  });

  it("keeps disabled choices visibly unavailable", () => {
    render(
      <ChoiceCard
        title="選べない候補"
        description="現在は利用できません"
        selected={false}
        selectionMode="multiple"
        disabled
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /選べない候補/ })).toBeDisabled();
  });

  it("accepts block content without nesting it in paragraphs", () => {
    render(
      <>
        <InlineNotice tone="notice" title="詳細">
          <div>お知らせのブロック要素</div>
        </InlineNotice>
        <ReviewRow label="食事" value={<div>確認行のブロック要素</div>} onEdit={vi.fn()} />
      </>,
    );
    expect(screen.getByText("お知らせのブロック要素").parentElement).toHaveClass(
      "inline-notice-body",
    );
    expect(screen.getByText("確認行のブロック要素").parentElement).toHaveClass("review-row-value");
  });

  it("gives review edit actions a contextual name", async () => {
    const onEdit = vi.fn();
    render(<ReviewRow label="食事" value="夕食" onEdit={onEdit} />);
    await userEvent.click(screen.getByRole("button", { name: "食事を変更" }));
    expect(onEdit).toHaveBeenCalledOnce();
  });
});
