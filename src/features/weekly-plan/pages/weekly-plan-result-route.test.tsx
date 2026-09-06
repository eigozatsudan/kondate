import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WeeklyPlanResultRoute } from "./weekly-plan-result-route";

const useAuthMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useParamsMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn(({ to }: { to: string }) => <div>navigate:{to}</div>));
const loadCurrentCompleteMemberIdsMock = vi.hoisted(() => vi.fn());
const weeklyPlanResultPageMock = vi.hoisted(() =>
  vi.fn((props: Record<string, unknown>) => {
    void props;
    return <div>result-page</div>;
  }),
);

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: useAuthMock,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: useQueryMock,
}));
vi.mock("react-router", () => ({
  useParams: useParamsMock,
  Navigate: navigateMock,
}));
vi.mock("../weekly-plan-eligibility.js", () => ({
  loadCurrentCompleteMemberIds: loadCurrentCompleteMemberIdsMock,
}));
vi.mock("./weekly-plan-result-page.js", () => ({
  WeeklyPlanResultPage: weeklyPlanResultPageMock,
}));

const VALID_UUID = "33333333-3333-4333-8333-333333333333";

describe("WeeklyPlanResultRoute", () => {
  it("navigates to /planner when weeklyPlanId is not a valid uuid", () => {
    useParamsMock.mockReturnValue({ weeklyPlanId: "not-a-uuid" });
    useAuthMock.mockReturnValue({
      session: { user: { id: "u1" }, access_token: "token-1" },
    });
    useQueryMock.mockReturnValue({ isPending: false, isError: false, data: ["m1"] });

    render(<WeeklyPlanResultRoute />);

    expect(screen.getByText("navigate:/planner")).toBeInTheDocument();
    expect(weeklyPlanResultPageMock).not.toHaveBeenCalled();
  });

  it("passes accessToken, weeklyPlanId, userId and currentCompleteMemberIds to WeeklyPlanResultPage", () => {
    useParamsMock.mockReturnValue({ weeklyPlanId: VALID_UUID });
    useAuthMock.mockReturnValue({
      session: { user: { id: "u1" }, access_token: "token-1" },
    });
    useQueryMock.mockReturnValue({ isPending: false, isError: false, data: ["m1", "m2"] });

    render(<WeeklyPlanResultRoute />);

    expect(weeklyPlanResultPageMock).toHaveBeenCalled();
    const props = weeklyPlanResultPageMock.mock.calls[0]?.[0];
    expect(props).toEqual({
      accessToken: "token-1",
      weeklyPlanId: VALID_UUID,
      userId: "u1",
      currentCompleteMemberIds: ["m1", "m2"],
    });
  });

  it("shows an alert when the complete-member-ids query fails", () => {
    useParamsMock.mockReturnValue({ weeklyPlanId: VALID_UUID });
    useAuthMock.mockReturnValue({
      session: { user: { id: "u1" }, access_token: "token-1" },
    });
    useQueryMock.mockReturnValue({ isPending: false, isError: true, data: undefined });

    render(<WeeklyPlanResultRoute />);

    expect(screen.getByRole("alert")).toHaveTextContent("家族情報を読み込めませんでした。");
  });
});
