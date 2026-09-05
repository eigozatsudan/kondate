import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { WeeklyPlanEntryCard } from "./weekly-plan-entry-card.js";

vi.mock("@/features/planner/planner-leave-flush", () => ({
  navigateAfterPlannerLeaveFlush: vi.fn(),
  shouldInterceptPlannerLeaveClick: () => true,
}));

describe("WeeklyPlanEntryCard", () => {
  it("shows the create CTA for Plus users and routes through leave-flush", async () => {
    const { navigateAfterPlannerLeaveFlush } =
      await import("@/features/planner/planner-leave-flush");
    render(
      <MemoryRouter>
        <WeeklyPlanEntryCard plusEntitled={true} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("link", { name: "今週の献立をつくる" }));
    expect(navigateAfterPlannerLeaveFlush).toHaveBeenCalledWith(expect.any(Function), "/weekly");
  });

  it("shows a locked preview and a Plus CTA for Free users", () => {
    render(
      <MemoryRouter>
        <WeeklyPlanEntryCard plusEntitled={false} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("weekly-plan-locked")).toBeInTheDocument();
    expect(screen.getByText("今週の献立づくりは Plus の機能です")).toBeInTheDocument();
    expect(
      screen.getByText("作成できるかは Plus 契約をサーバーで確認します。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plus を見る" })).toHaveAttribute("href", "/plus");
  });
});
