import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
  IDEA_SAFETY_DETAILS_BUTTON_LABEL,
  IdeaMenuSafetyNotice,
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
  it("shows a compact attention notice with icon and open control", () => {
    const { container } = render(<IdeaMenuSafetyNotice />);
    expect(screen.getByText("ご確認ください")).toBeVisible();
    expect(
      screen.getByText(
        "この献立はアイデアとして作成しました。家族条件は使っておらず、調理前に内容の確認が必要です。",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: IDEA_SAFETY_DETAILS_BUTTON_LABEL })).toBeVisible();
    // アイコンは装飾（aria-hidden）として存在する
    expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    // 必須文言は閉じた dialog 内にあり、a11y 上の dialog としても見えない
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("家族条件を使用していません")).not.toBeVisible();
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
