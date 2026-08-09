import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { MenuActions } from "./menu-actions";

const baseProps = {
  accepted: false,
  gateOpen: true,
  canCreateShoppingList: true,
  shoppingAsPrimary: false,
  actionsEnabled: true,
  acceptPending: false,
  confirmedSingle: false,
  pantryGateReady: true,
  showReconcile: false,
  reconcileDisabled: true,
  canUpdatePostCook: false,
  showRetarget: false,
  retargetEnabled: false,
  retargetPending: false,
  retargetError: null,
  shoppingError: null,
  shoppingIntentActive: false,
  revalidationPhase: "checked" as const,
  isSoftRechecking: false,
  shoppingRejectedMessage: null,
  onAccept: vi.fn(),
  onOpenCreateShopping: vi.fn(),
  onOpenWholeRegen: vi.fn(),
  onOpenReconcile: vi.fn(),
  onOpenPostCook: vi.fn(),
  onRetarget: vi.fn(),
};

function renderActions(overrides: Partial<typeof baseProps> = {}) {
  return render(
    <MemoryRouter>
      <MenuActions {...baseProps} {...overrides} />
    </MemoryRouter>,
  );
}

it("exposes primary accept and regenerate controls by accessible name", () => {
  renderActions();
  expect(screen.getByRole("button", { name: "この献立にする" })).toBeVisible();
  expect(screen.getByRole("button", { name: "この案を元に別の献立を作り直す" })).toBeVisible();
  expect(screen.getByRole("button", { name: "材料の買い物リストを作る" })).toBeVisible();
});

it("promotes shopping to primary after accept and keeps role=status notice", () => {
  renderActions({
    accepted: true,
    shoppingAsPrimary: true,
    canCreateShoppingList: true,
  });
  expect(screen.getByRole("status")).toHaveTextContent("この献立にしました");
  expect(screen.getByRole("button", { name: "材料の買い物リストを作る" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "この献立にする" })).not.toBeInTheDocument();
});

it("exposes shopping intent rejection as role=alert", () => {
  render(
    <MemoryRouter>
      <MenuActions
        {...baseProps}
        shoppingIntentActive
        gateOpen={false}
        revalidationPhase="checked"
        shoppingRejectedMessage="現在の家族設定ではこの献立から買い物リストを作れません"
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "現在の家族設定ではこの献立から買い物リストを作れません",
  );
  expect(screen.getByRole("link", { name: "履歴に戻る" })).toBeVisible();
  expect(screen.getByRole("link", { name: "買い物に戻る" })).toBeVisible();
});
