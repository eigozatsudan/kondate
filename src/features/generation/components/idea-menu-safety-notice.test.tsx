import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
  IDEA_SAFETY_DETAILS_BUTTON_LABEL,
  IdeaMenuSafetyNotice,
  EASE_SOFT_NOT_SWALLOW_DISCLAIMER,
  MENU_LABEL_DISCLAIMER,
} from "./idea-menu-safety-notice";

beforeEach(() => {
  // jsdom 向け native dialog ポリフィル
  if (typeof HTMLDialogElement !== "undefined") {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});

describe("IdeaMenuSafetyNotice", () => {
  it("shows locked mandatory phrases always-visible with details control", () => {
    const { container } = render(<IdeaMenuSafetyNotice />);
    expect(screen.getByText("ご確認ください")).toBeVisible();
    // 設計 §5.4: 必須2文は常時表示（dialog 内コピーと区別し dialog 外ノードを見る）
    const alwaysVisibleFamily = screen
      .getAllByText("家族条件を使用していません")
      .find((node) => !node.closest("dialog"));
    expect(alwaysVisibleFamily).toBeDefined();
    expect(alwaysVisibleFamily).toBeVisible();
    const alwaysVisibleAge = screen
      .getAllByText("年齢・アレルギーへの適合は確認されていません")
      .find((node) => !node.closest("dialog"));
    expect(alwaysVisibleAge).toBeDefined();
    expect(alwaysVisibleAge).toBeVisible();
    expect(screen.getByRole("button", { name: IDEA_SAFETY_DETAILS_BUTTON_LABEL })).toBeVisible();
    // アイコンは装飾（aria-hidden）として存在する
    expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    // AI/ラベル長文は閉じた dialog 側。a11y 上の dialog としても見えない
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(MENU_LABEL_DISCLAIMER)).not.toBeVisible();
  });

  it("opens a dialog with every locked mandatory phrase", async () => {
    render(<IdeaMenuSafetyNotice />);
    await userEvent.click(screen.getByRole("button", { name: IDEA_SAFETY_DETAILS_BUTTON_LABEL }));

    const dialog = screen.getByRole("dialog", { name: "この献立はアイデアとして作成しました" });
    expect(dialog).toBeVisible();
    expect(within(dialog).getByText("家族条件を使用していません")).toBeVisible();
    expect(within(dialog).getByText("年齢・アレルギーへの適合は確認されていません")).toBeVisible();
    expect(within(dialog).getByText(/AIが作成した献立です/u)).toBeVisible();
    expect(within(dialog).getByText(MENU_LABEL_DISCLAIMER)).toBeVisible();
    expect(within(dialog).getByText(EASE_SOFT_NOT_SWALLOW_DISCLAIMER)).toBeVisible();
  });

  it("closes from 閉じる and from the dialog cancel event", async () => {
    render(<IdeaMenuSafetyNotice />);
    await userEvent.click(screen.getByRole("button", { name: IDEA_SAFETY_DETAILS_BUTTON_LABEL }));
    const dialog = screen.getByRole("dialog", { name: "この献立はアイデアとして作成しました" });

    await userEvent.click(within(dialog).getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: IDEA_SAFETY_DETAILS_BUTTON_LABEL }));
    const reopened = screen.getByRole("dialog", { name: "この献立はアイデアとして作成しました" });
    fireEvent(reopened, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
