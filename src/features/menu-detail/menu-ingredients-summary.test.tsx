import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { makeMenuResultViewModel } from "@shared/testing/factories";
import { MenuIngredientsSummary } from "./menu-ingredients-summary";

it("renders store-section headings and ingredient rows from dishes", () => {
  const result = makeMenuResultViewModel();
  render(<MenuIngredientsSummary dishes={result.menu.dishes} />);
  // makeMenuResultViewModel: しょうゆ(dry_goods) + 乳成分入りドレッシング(produce)
  // storeSections 順で produce が先
  expect(screen.getByRole("heading", { name: "野菜" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "乾物" })).toBeVisible();
  // 区分は div（region landmark にしない）。見出しの親 div を掴む
  const produceHeading = screen.getByRole("heading", { name: "野菜" });
  const produce = produceHeading.parentElement;
  if (!(produce instanceof HTMLElement)) throw new Error("produce block required");
  expect(produce.tagName).toBe("DIV");
  expect(within(produce).getByText("乳成分入りドレッシング")).toBeVisible();
  // 名前付き section/region を増やしていない
  expect(screen.queryByRole("region", { name: "野菜" })).toBeNull();
});
