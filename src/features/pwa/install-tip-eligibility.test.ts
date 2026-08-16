import { describe, expect, it } from "vitest";
import { shouldShowInstallTip } from "./install-tip-eligibility";

const eligible = {
  hasSession: true,
  pathname: "/planner",
  surface: "ios" as const,
  standalone: false,
  dismissed: false,
};

describe("shouldShowInstallTip", () => {
  it("shows on /planner for a signed-in iOS browser that has not dismissed", () => {
    expect(shouldShowInstallTip(eligible)).toBe(true);
  });

  it("hides when there is no session", () => {
    expect(shouldShowInstallTip({ ...eligible, hasSession: false })).toBe(false);
  });

  it("hides in standalone display mode", () => {
    expect(shouldShowInstallTip({ ...eligible, standalone: true })).toBe(false);
  });

  it("hides when dismissed", () => {
    expect(shouldShowInstallTip({ ...eligible, dismissed: true })).toBe(false);
  });

  it("hides on other surfaces", () => {
    expect(shouldShowInstallTip({ ...eligible, surface: "other" })).toBe(false);
  });

  it("hides on settings, welcome, root, onboarding, and privacy", () => {
    for (const pathname of ["/settings", "/welcome", "/", "/onboarding", "/privacy"]) {
      expect(shouldShowInstallTip({ ...eligible, pathname })).toBe(false);
    }
  });

  it("shows on menu detail, plus, and emergency menu paths", () => {
    for (const pathname of ["/menus/x", "/plus", "/emergency-menus", "/emergency-menus/x"]) {
      expect(shouldShowInstallTip({ ...eligible, pathname })).toBe(true);
    }
  });
});
