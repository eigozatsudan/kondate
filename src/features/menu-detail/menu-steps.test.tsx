import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { makeMenuResultViewModel } from "@shared/testing/factories";
import { MenuSteps } from "./menu-steps";

it("exposes the overall timeline heading and list structure by default", () => {
  const result = makeMenuResultViewModel();
  const { container } = render(
    <MenuSteps timeline={result.menu.timeline} dishes={result.menu.dishes} />,
  );

  const heading = screen.getByRole("heading", { name: "全体の段取り" });
  expect(heading).toBeVisible();
  expect(heading.id).toBe("timeline-heading");
  // DOM ロック: h2 の親は .cook-timeline-panel
  expect(heading.parentElement?.classList.contains("cook-timeline-panel")).toBe(true);

  const stepsTablist = screen.getByRole("tablist", { name: "献立の段取りと材料" });
  expect(stepsTablist).toBeVisible();
  expect(screen.getByRole("tab", { name: "段取り" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: "材料まとめ" })).toHaveAttribute("aria-selected", "false");

  const timelinePanel = screen.getByRole("tabpanel", { name: "段取り" });
  const list = within(timelinePanel).getByRole("list");
  expect(list.tagName).toBe("OL");
  expect(list.className).toContain("cook-timeline");
  expect(screen.getAllByText(/分〜/u).length).toBeGreaterThan(0);
  // 材料まとめ panel は初期非表示（unmount なら heading 野菜が無い）
  expect(screen.queryByRole("heading", { name: "野菜" })).toBeNull();
  expect(container.querySelector(".cook-timeline-panel")).not.toBeNull();
});

it("switches to aggregated ingredients tab", async () => {
  const result = makeMenuResultViewModel();
  render(<MenuSteps timeline={result.menu.timeline} dishes={result.menu.dishes} />);
  await userEvent.click(screen.getByRole("tab", { name: "材料まとめ" }));
  expect(screen.getByRole("tab", { name: "材料まとめ" })).toHaveAttribute("aria-selected", "true");
  const panel = screen.getByRole("tabpanel", { name: "材料まとめ" });
  expect(within(panel).getByRole("heading", { name: "野菜" })).toBeVisible();
  // makeMenuResultViewModel の produce 行名
  expect(within(panel).getByText("乳成分入りドレッシング")).toBeVisible();
});

it("moves focus between steps tabs with arrow keys", async () => {
  const result = makeMenuResultViewModel();
  render(<MenuSteps timeline={result.menu.timeline} dishes={result.menu.dishes} />);
  const timelineTab = screen.getByRole("tab", { name: "段取り" });
  const ingredientsTab = screen.getByRole("tab", { name: "材料まとめ" });
  timelineTab.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(ingredientsTab).toHaveFocus();
  expect(ingredientsTab).toHaveAttribute("aria-selected", "true");
});

it("moves focus to first and last steps tabs with Home and End", async () => {
  const result = makeMenuResultViewModel();
  render(<MenuSteps timeline={result.menu.timeline} dishes={result.menu.dishes} />);
  const timelineTab = screen.getByRole("tab", { name: "段取り" });
  const ingredientsTab = screen.getByRole("tab", { name: "材料まとめ" });
  timelineTab.focus();
  await userEvent.keyboard("{End}");
  expect(ingredientsTab).toHaveFocus();
  expect(ingredientsTab).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{Home}");
  expect(timelineTab).toHaveFocus();
  expect(timelineTab).toHaveAttribute("aria-selected", "true");
});
