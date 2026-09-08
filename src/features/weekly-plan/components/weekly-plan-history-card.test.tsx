import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { WeeklyPlanHistoryCard } from "./weekly-plan-history-card.js";

const basePlan = {
  id: "33333333-3333-4333-8333-333333333333",
  week_start: "2026-09-07",
  created_at: "2026-09-01T00:00:00Z",
  preference_snapshot: { targetMemberIds: ["m1", "m2"] },
};

describe("WeeklyPlanHistoryCard", () => {
  it("shows the latest plan and marks partialHousehold by exact ID-set match (not count)", () => {
    render(
      <MemoryRouter>
        <WeeklyPlanHistoryCard plans={[basePlan]} currentCompleteMemberIds={["m1", "m3"]} />
      </MemoryRouter>,
    );
    // 同数(2人)でも別メンバーなら partialHousehold（R-06）
    expect(screen.getByText("2 人分")).toBeInTheDocument();
    expect(screen.getByText("外した家族の条件は見ていません")).toBeInTheDocument();
  });

  it("does not show the partial notice when the ID sets match exactly", () => {
    render(
      <MemoryRouter>
        <WeeklyPlanHistoryCard plans={[basePlan]} currentCompleteMemberIds={["m1", "m2"]} />
      </MemoryRouter>,
    );
    expect(screen.queryByText("外した家族の条件は見ていません")).not.toBeInTheDocument();
  });

  it("gives the past-weeks summary a 44px touch target", () => {
    render(
      <MemoryRouter>
        <WeeklyPlanHistoryCard
          plans={[
            basePlan,
            {
              ...basePlan,
              id: "44444444-4444-4444-8444-444444444444",
              week_start: "2026-08-31",
            },
          ]}
          currentCompleteMemberIds={["m1", "m2"]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("これまでの週献立")).toHaveClass("min-h-11");
  });

  it("shows nothing when there are no plans", () => {
    const { container } = render(
      <MemoryRouter>
        <WeeklyPlanHistoryCard plans={[]} currentCompleteMemberIds={[]} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
