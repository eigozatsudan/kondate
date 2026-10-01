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

it("exposes a household dislike button without one in idea mode", () => {
  const result = makeMenuResultViewModel();
  const selected = result.menu.dishes[0];
  if (selected === undefined) throw new Error("fixture must contain a dish");
  const ingredient = selected.ingredients[0];
  if (ingredient === undefined) throw new Error("fixture must contain an ingredient");
  const onRegisterIngredientDislike = vi.fn();
  const props = {
    dishes: result.menu.dishes,
    selected,
    selectedId: selected.id,
    selectedAdaptations: [],
    memberLabels: result.memberLabels,
    labels: [],
    onSelectDish: vi.fn(),
    onTabKeyDown: vi.fn(),
    canConfirmLabel: false,
    confirmingId: null,
    busy: false,
    onConfirmLabel: vi.fn(),
    onRegisterIngredientDislike,
    registeredDislikes: [
      { displayName: "はな", identities: [ingredient.name.toLowerCase()] },
      { displayName: "たろう", identities: ["別の食べ物"] },
    ],
  };

  const { rerender } = render(<MenuDishes {...props} mode="household" />);
  const button = screen.getByRole("button", { name: `${ingredient.name}を苦手に登録` });
  expect(button).toHaveTextContent("苦手");
  expect(button).toHaveAttribute("id", `ingredient-dislike-trigger-${ingredient.id}`);
  expect(button.closest(".menu-result-ingredient-name")).not.toBeNull();
  expect(screen.getByText("はな")).toHaveClass("type-small");
  expect(screen.queryByText("たろう")).not.toBeInTheDocument();

  rerender(<MenuDishes {...props} mode="idea" />);
  expect(screen.queryByRole("button", { name: /を苦手に登録$/u })).not.toBeInTheDocument();
});

it("omits the registered-name hint when dislike identities are unavailable", () => {
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
      onRegisterIngredientDislike={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: /を苦手に登録$/u })).toBeVisible();
  expect(document.querySelector(".type-small")).toBeNull();
});
