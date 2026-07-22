import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CurrentSafetySummary } from "./current-safety-summary";

describe("CurrentSafetySummary", () => {
  it("communicates representative safety states with text and semantics", () => {
    render(
      <CurrentSafetySummary
        members={[
          {
            id: "member-1",
            displayName: "はな",
            ageBandLabel: "大人",
            allergyLabel: "卵",
            safetyLabels: [],
            blockedReason: null,
          },
          {
            id: "member-2",
            displayName: "そら",
            ageBandLabel: "幼児",
            allergyLabel: "アレルギーなし",
            safetyLabels: ["要確認"],
            blockedReason: "年齢情報を確認してください",
          },
        ]}
      />,
    );
    expect(screen.getByText(/卵/)).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("年齢情報を確認してください");
    expect(screen.getByText(/AI生成だけでアレルギーの安全は保証できません/)).toBeVisible();
  });
});
