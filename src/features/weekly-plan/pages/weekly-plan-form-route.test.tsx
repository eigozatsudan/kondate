import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WeeklyPlanFormRoute } from "./weekly-plan-form-route";

const useAuthMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const loadWeeklyPlanFormEligibilityMock = vi.hoisted(() => vi.fn());
const weeklyPlanFormPageMock = vi.hoisted(() =>
  vi.fn((props: Record<string, unknown>) => {
    void props;
    return <div>form-page</div>;
  }),
);

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: useAuthMock,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: useQueryMock,
}));
vi.mock("../weekly-plan-eligibility.js", () => ({
  loadWeeklyPlanFormEligibility: loadWeeklyPlanFormEligibilityMock,
}));
vi.mock("./weekly-plan-form-page.js", () => ({
  WeeklyPlanFormPage: weeklyPlanFormPageMock,
}));

describe("WeeklyPlanFormRoute", () => {
  it("shows a pending main while the session is not resolved", () => {
    useAuthMock.mockReturnValue({ session: null });
    useQueryMock.mockReturnValue({ isPending: true, isError: false, data: undefined });

    render(<WeeklyPlanFormRoute />);

    expect(screen.getByText("読み込んでいます…")).toBeInTheDocument();
    expect(weeklyPlanFormPageMock).not.toHaveBeenCalled();
  });

  it("passes accessToken, userId, eligibleMembers and unsatisfiableMemberIds to WeeklyPlanFormPage", () => {
    useAuthMock.mockReturnValue({
      session: { user: { id: "u1" }, access_token: "token-1" },
    });
    const members = [
      {
        id: "m1",
        displayName: "たろう",
        ageBandLabel: "大人",
        allergyLabel: "アレルギーなし",
        safetyLabels: [],
        blockedReason: null,
      },
    ];
    useQueryMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: { members, unsatisfiableMemberIds: ["m2"] },
    });

    render(<WeeklyPlanFormRoute />);

    expect(weeklyPlanFormPageMock).toHaveBeenCalled();
    const props = weeklyPlanFormPageMock.mock.calls[0]?.[0];
    expect(props).toEqual({
      accessToken: "token-1",
      userId: "u1",
      eligibleMembers: members,
      unsatisfiableMemberIds: ["m2"],
    });
  });

  it("shows an alert when the eligibility query fails", () => {
    useAuthMock.mockReturnValue({
      session: { user: { id: "u1" }, access_token: "token-1" },
    });
    useQueryMock.mockReturnValue({ isPending: false, isError: true, data: undefined });

    render(<WeeklyPlanFormRoute />);

    expect(screen.getByRole("alert")).toHaveTextContent("家族情報を読み込めませんでした。");
  });
});
