import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { CurrentSafetySummary } from "./current-safety-summary";

describe("CurrentSafetySummary", () => {
  it("communicates representative safety states with text and semantics", () => {
    render(
      <MemoryRouter>
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
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/卵/)).toBeVisible();
    expect(screen.getByText(/大人/)).toBeVisible();
    expect(screen.getByText(/幼児/)).toBeVisible();
    expect(screen.getByText(/要確認/)).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("年齢情報を確認してください");
    expect(screen.getByText(/AI生成だけでアレルギーの安全は保証できません/)).toBeVisible();
    const settingsLink = screen.getByRole("link", { name: "家族設定を変更" });
    expect(settingsLink).toHaveAttribute("href", "/settings");
    expect(settingsLink).toHaveClass("secondary-button", "min-h-11");
  });

  it("P9: disabled のとき設定 CTA は button で無効になる", () => {
    const onOpenSettings = vi.fn();
    render(
      <MemoryRouter>
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
          ]}
          disabled
          onOpenSettings={onOpenSettings}
        />
      </MemoryRouter>,
    );
    const settingsButton = screen.getByRole("button", { name: "家族設定を変更" });
    expect(settingsButton).toBeDisabled();
  });

  it("P10: members 空は固定 empty 本文と共通 disclaimer を出す", () => {
    render(
      <MemoryRouter>
        <CurrentSafetySummary members={[]} />
      </MemoryRouter>,
    );
    expect(screen.getByText("家族を選ぶと、その人の条件がここに表示されます。")).toBeVisible();
    expect(screen.getByText(/AI生成だけでアレルギーの安全は保証できません/)).toBeVisible();
    expect(screen.getByRole("heading", { name: "現在の家族・安全条件" })).toBeVisible();
  });
});
