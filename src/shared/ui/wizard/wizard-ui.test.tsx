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

  it("uses alert only for errors", () => {
    const { rerender } = render(
      <InlineNotice tone="notice" title="お知らせ">
        保存しました
      </InlineNotice>,
    );
    expect(screen.getByRole("note")).toHaveTextContent("保存しました");
    rerender(
      <InlineNotice tone="error" title="保存できません">
        再試行してください
      </InlineNotice>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("再試行してください");
  });

  it("gives review edit actions a contextual name", async () => {
    const onEdit = vi.fn();
    render(<ReviewRow label="食事" value="夕食" onEdit={onEdit} />);
    await userEvent.click(screen.getByRole("button", { name: "食事を変更" }));
    expect(onEdit).toHaveBeenCalledOnce();
  });
});
