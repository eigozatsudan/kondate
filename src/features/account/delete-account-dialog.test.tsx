import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteAccountDialog } from "./delete-account-dialog";

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

describe("DeleteAccountDialog", () => {
  it("keeps the destructive submit disabled until the exact phrase is entered", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <DeleteAccountDialog
        open
        pending={false}
        errorMessage={null}
        onCancel={() => undefined}
        onConfirm={onConfirm}
      />,
    );

    const submit = screen.getByRole("button", { name: "完全に削除する" });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("確認のため「削除する」と入力"), "削除し");
    expect(submit).toBeDisabled();

    await user.clear(screen.getByLabelText("確認のため「削除する」と入力"));
    await user.type(screen.getByLabelText("確認のため「削除する」と入力"), "削除する");
    expect(submit).toBeEnabled();

    await user.click(submit);
    expect(onConfirm).toHaveBeenCalledWith("削除する");
  });

  it("shows pending copy and keeps the submit disabled while pending", () => {
    render(
      <DeleteAccountDialog
        open
        pending
        errorMessage={null}
        onCancel={() => undefined}
        onConfirm={() => Promise.resolve()}
      />,
    );
    expect(screen.getByRole("button", { name: "削除しています" })).toBeDisabled();
  });

  it("surfaces an error message and allows cancel without confirming", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <DeleteAccountDialog
        open
        pending={false}
        errorMessage="削除できませんでした。時間をおいてもう一度お試しください"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "削除できませんでした。時間をおいてもう一度お試しください",
    );
    await user.click(screen.getByRole("button", { name: "やめる" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows paid-plan cancellation copy on the dialog", () => {
    render(
      <DeleteAccountDialog
        open
        pending={false}
        errorMessage={null}
        onCancel={() => undefined}
        onConfirm={() => Promise.resolve()}
      />,
    );
    expect(screen.getByText(/先に解約が成功してからアカウントを削除します/)).toBeVisible();
    expect(screen.getByText(/解約できないときは削除を中止/)).toBeVisible();
  });

  it("AP4: discloses 方針 B anonymous share residual on the dialog", () => {
    render(
      <DeleteAccountDialog
        open
        pending={false}
        errorMessage={null}
        onCancel={() => undefined}
        onConfirm={() => Promise.resolve()}
      />,
    );
    expect(screen.getByText(/匿名一般化済みの緊急候補本文/)).toBeVisible();
    expect(screen.getByText(/削除後も他ユーザー向けに残る/)).toBeVisible();
  });

  it("maps Escape/cancel to onCancel without confirming", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <DeleteAccountDialog
        open
        pending={false}
        errorMessage={null}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "アカウントを削除しますか？" });
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
