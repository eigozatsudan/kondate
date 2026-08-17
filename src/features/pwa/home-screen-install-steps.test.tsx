import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomeScreenInstallSteps } from "./home-screen-install-steps";

describe("HomeScreenInstallSteps", () => {
  it("renders three iOS listitems with exact accessible names and no digits", () => {
    render(<HomeScreenInstallSteps kind="ios" />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveAccessibleName("共有");
    expect(items[1]).toHaveAccessibleName("ホーム画面に追加");
    expect(items[2]).toHaveAccessibleName("追加");
    for (const item of items) {
      expect(item).not.toHaveAccessibleName(/[0-9]/u);
    }
    expect(screen.getByRole("list")).toHaveAttribute("role", "list");
    expect(screen.getByRole("list").className).toContain("home-screen-install-steps");
    expect(screen.getByRole("list").className).not.toContain("whitespace-nowrap");
    expect(screen.getByRole("list").tagName).toBe("OL");
    expect(items[0]?.querySelector("span:not([aria-hidden])")?.tagName).toBe("SPAN");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    const icons = screen.getByRole("list").querySelectorAll("svg[aria-hidden='true']");
    expect(icons).toHaveLength(3);
    expect(icons[0]).toHaveAttribute("data-icon", "ios-share");
    expect(icons[1]).toHaveAttribute("data-icon", "ios-add-home");
    expect(icons[2]).toHaveAttribute("data-icon", "ios-confirm-bar");
    const confirm = icons[2];
    expect(confirm?.querySelector("path,line,polyline")).toBeNull();
    expect(confirm?.querySelector("rect")).not.toBeNull();
    for (const svg of icons) {
      for (const node of svg.querySelectorAll("[fill],[stroke]")) {
        const fill = node.getAttribute("fill");
        const stroke = node.getAttribute("stroke");
        if (fill !== null) expect(["currentColor", "none"]).toContain(fill);
        if (stroke !== null) expect(["currentColor", "none"]).toContain(stroke);
      }
    }
  });

  it("renders two Android listitems with exact names", () => {
    render(<HomeScreenInstallSteps kind="android" />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAccessibleName("メニュー");
    expect(items[1]).toHaveAccessibleName("ホーム画面に追加");
    const icons = screen.getByRole("list").querySelectorAll("svg[aria-hidden='true']");
    expect(icons[0]).toHaveAttribute("data-icon", "android-menu");
    expect(icons[1]).toHaveAttribute("data-icon", "android-add-home");
  });

  it("renders nothing for none", () => {
    const { container } = render(<HomeScreenInstallSteps kind="none" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
