import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { makeMenuResultViewModel } from "@shared/testing/factories";
import { MenuDishes } from "./menu-dishes";

it("exposes dish tablist and selected tabpanel accessible names", () => {
  const result = makeMenuResultViewModel();
  const selected = result.menu.dishes[0];
  if (selected === undefined) throw new Error("fixture must contain a dish");

  render(
    <MenuDishes
      dishes={result.menu.dishes}
      selected={selected}
      selectedId={selected.id}
      mode="household"
      selectedAdaptations={[]}
      memberLabels={result.memberLabels}
      labels={[]}
      onSelectDish={vi.fn()}
      onTabKeyDown={vi.fn()}
      canConfirmLabel={false}
      confirmingId={null}
      busy={false}
      onConfirmLabel={vi.fn()}
    />,
  );

  expect(screen.getByRole("tablist", { name: "料理" })).toBeVisible();
  expect(screen.getByRole("tab", { name: new RegExp(selected.name, "u") })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("tabpanel")).toBeVisible();
  expect(screen.getByRole("heading", { name: "材料" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "作り方" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "家族向けの取り分け" })).toBeVisible();
});
