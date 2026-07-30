import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppToastProvider } from "@/shared/ui/app-toast";
import { MealStep } from "./meal-step";

describe("MealStep incomplete UX", () => {
  it("meal incomplete next: toast+alert+focus, no onNext", async () => {
    const onNext = vi.fn();
    const user = userEvent.setup();
    render(
      <AppToastProvider>
        <MealStep value={null} onChange={vi.fn()} onNext={onNext} />
      </AppToastProvider>,
    );
    const next = screen.getByRole("button", { name: "次へ" });
    expect(next).not.toBeDisabled();
    await user.click(next);
    expect(onNext).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("食事の時間帯を選んでください");
    expect(screen.getByRole("status")).toHaveTextContent("食事の時間帯を選んでください");
    expect(screen.getByRole("radiogroup").querySelector("input:not([disabled])")).toHaveFocus();
  });

  it("meal incomplete with suppressValidationToast: alert+focus only, no status toast", async () => {
    const user = userEvent.setup();
    render(
      <AppToastProvider>
        <MealStep value={null} onChange={vi.fn()} onNext={vi.fn()} suppressValidationToast />
      </AppToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
