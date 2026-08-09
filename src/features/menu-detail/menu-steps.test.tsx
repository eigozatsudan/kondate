import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { makeMenuResultViewModel } from "@shared/testing/factories";
import { MenuSteps } from "./menu-steps";

it("exposes the overall timeline heading and list structure", () => {
  const result = makeMenuResultViewModel();
  render(<MenuSteps timeline={result.menu.timeline} dishes={result.menu.dishes} />);

  expect(screen.getByRole("heading", { name: "全体の段取り" })).toBeVisible();
  const list = screen.getByRole("list");
  expect(list.tagName).toBe("OL");
  expect(list.className).toContain("cook-timeline");
  // 少なくとも 1 件の段取り行がある
  expect(screen.getAllByText(/分〜/u).length).toBeGreaterThan(0);
});
