import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppToastProvider } from "@/shared/ui/app-toast";
import { CuisineStep } from "./cuisine-step";

describe("CuisineStep incomplete UX", () => {
  it("cuisine incomplete next: toast+alert+focus", async () => {
    const onNext = vi.fn();
    const user = userEvent.setup();
    render(
      <AppToastProvider>
        <CuisineStep value={null} onChange={vi.fn()} onNext={onNext} />
      </AppToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "次へ" }));
    expect(onNext).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("ジャンルを選んでください");
    expect(screen.getByRole("status")).toHaveTextContent("ジャンルを選んでください");
    expect(screen.getByRole("radiogroup").querySelector("input:not([disabled])")).toHaveFocus();
  });
});
