import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { makeMenuResultViewModel } from "@shared/testing/factories";
import { MenuResult } from "./menu-result";

it("shows the overall timeline before persistent dish tabs", () => {
  const { container } = render(<MenuResult result={makeMenuResultViewModel()} />);
  const timeline = screen.getByRole("heading", { name: "全体の段取り" });
  const tabs = screen.getByRole("tablist", { name: "料理" });
  expect(timeline.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(container).toHaveTextContent("AIが作成した献立です");
});

it("switches dishes and exposes structured preparation and label checks", async () => {
  const result = makeMenuResultViewModel();
  const menu = result.menu;
  const secondDish = menu.dishes[1];
  if (secondDish === undefined) throw new Error("fixture must contain a second dish");
  render(<MenuResult result={result} />);
  // タブの実際のアクセシブルネームは「区分・料理名」（例: 副菜・温野菜）で、
  // getByRoleのname照合は常に完全一致のため、料理名だけの完全一致にはならない。
  // 正規表現で部分一致させて該当タブを選択する。
  await userEvent.click(screen.getByRole("tab", { name: new RegExp(secondDish.name, "u") }));
  const panel = screen.getByRole("tabpanel");
  expect(within(panel).getByRole("heading", { name: "材料" })).toBeVisible();
  expect(within(panel).getByRole("heading", { name: "作り方" })).toBeVisible();
  expect(within(panel).getByRole("heading", { name: "家族向けの取り分け" })).toBeVisible();
  expect(screen.getByText("加工品は原材料表示を確認してください")).toBeVisible();
});

it("shows used amounts, shortages, and persisted unused reasons", () => {
  render(<MenuResult result={makeMenuResultViewModel()} />);
  expect(screen.getByRole("heading", { name: "冷蔵庫食材の使い方" })).toBeVisible();
  expect(screen.getByText(/不足/)).toBeVisible();
  expect(screen.getByText(/使わなかった理由/)).toBeVisible();
});

it("renders normalized structured safety actions returned by the aggregate loader", () => {
  const result = makeMenuResultViewModel();
  const menu = result.menu;
  const action = menu.adaptations.flatMap((item) => item.safetyActions).at(0);
  expect(action).toBeDefined();
  if (action === undefined) throw new Error("fixture must contain a safety action");
  render(<MenuResult result={result} />);
  expect(screen.getByText("安全のための手順")).toBeVisible();
  expect(screen.getByText(action.instruction)).toBeVisible();
});

it("renders confirmation ids through human source, allergen, and member labels", () => {
  const result = makeMenuResultViewModel();
  const confirmation = result.labelConfirmations.at(0);
  if (confirmation === undefined) throw new Error("fixture must contain a label confirmation");
  render(<MenuResult result={result} />);
  expect(confirmation.confirmationId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(screen.getByText(new RegExp(confirmation.sourceText, "u"))).toBeVisible();
  expect(screen.getByText(new RegExp(confirmation.allergenName, "u"))).toBeVisible();
  expect(screen.getByText(new RegExp(confirmation.memberLabel, "u"))).toBeVisible();
});
