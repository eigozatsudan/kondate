import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TargetMode } from "@shared/contracts/planner";
import { RegenerationSheet, type RegenerationUsageView } from "./regeneration-sheet";

beforeEach(() => {
  // jsdom 向け native dialog ポリフィル（DeleteAccountDialog と同じ）
  if (typeof HTMLDialogElement !== "undefined") {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});

function usageView(remaining = 3): RegenerationUsageView {
  return {
    successRemaining: remaining,
    attemptsRemaining: 12,
    shortWindowRemaining: 4,
    shortWindowRetryAt: null,
    loading: false,
    error: false,
  };
}

function renderRegenerationSheet(targetMode: TargetMode = "household", remaining = 3) {
  const onSubmit = vi.fn(() => Promise.resolve());
  const onCancel = vi.fn();
  render(
    <RegenerationSheet
      targetMode={targetMode}
      usage={usageView(remaining)}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />,
  );
  return { onSubmit, onCancel };
}

describe("RegenerationSheet", () => {
  it("opens as a native dialog titled どのように変えますか？", () => {
    renderRegenerationSheet();
    const dialog = screen.getByRole("dialog", { name: "どのように変えますか？" });
    expect(dialog).toBeVisible();
    // display を変えるユーティリティを dialog 本体に載せない（閉じた状態の UA 規則を壊さない）
    expect(dialog.className.split(/\s+/u)).not.toContain("stack");
  });

  it("explains conditional quota use before regeneration", () => {
    renderRegenerationSheet();
    expect(screen.getByText("無料版は別の献立が完成した場合に1回使用・現在残り3回")).toBeVisible();
  });

  it("does not claim remaining 0 while usage is loading", () => {
    render(
      <RegenerationSheet
        targetMode="household"
        usage={{
          successRemaining: null,
          attemptsRemaining: null,
          shortWindowRemaining: null,
          shortWindowRetryAt: null,
          loading: true,
          error: false,
        }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("本日の作成回数を確認しています…")).toBeVisible();
    expect(screen.queryByText(/現在残り0回/u)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "別案を作る" })).toBeDisabled();
  });

  it("requires a reason before submit", async () => {
    const { onSubmit } = renderRegenerationSheet();
    await userEvent.click(screen.getByRole("button", { name: "別案を作る" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("理由を選んでください");
  });

  it("submits a preset reason with null custom text", async () => {
    const { onSubmit } = renderRegenerationSheet();
    await userEvent.click(screen.getByLabelText("もっと簡単に"));
    await userEvent.click(screen.getByRole("button", { name: "別案を作る" }));
    expect(onSubmit).toHaveBeenCalledWith({
      changeReason: "simpler",
      changeReasonCustom: null,
      expiredPantryConfirmations: [],
    });
  });

  it("requires custom text when その他 is selected", async () => {
    const { onSubmit } = renderRegenerationSheet();
    await userEvent.click(screen.getByLabelText("その他"));
    await userEvent.click(screen.getByRole("button", { name: "別案を作る" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("内容を入力してください");
    await userEvent.type(screen.getByRole("textbox"), "辛さを抑えて");
    await userEvent.click(screen.getByRole("button", { name: "別案を作る" }));
    expect(onSubmit).toHaveBeenCalledWith({
      changeReason: "custom",
      changeReasonCustom: "辛さを抑えて",
      expiredPantryConfirmations: [],
    });
  });

  it("HIST-I1 / §269: requires confirm checkboxes for expired pantry before submit", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    render(
      <RegenerationSheet
        targetMode="household"
        usage={usageView(3)}
        expiredPantryItems={[{ pantryItemId: "p1", name: "牛乳" }]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("期限を過ぎた食材の確認")).toBeVisible();
    expect(screen.getByRole("button", { name: "別案を作る" })).toBeDisabled();
    await userEvent.click(screen.getByLabelText("もっと簡単に"));
    expect(screen.getByRole("button", { name: "別案を作る" })).toBeDisabled();
    await userEvent.click(screen.getByLabelText("牛乳"));
    expect(screen.getByRole("button", { name: "別案を作る" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "別案を作る" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        changeReason: "simpler",
        expiredPantryConfirmations: [
          expect.objectContaining({
            pantryItemId: "p1",
            checkedAt: expect.any(String) as string,
          }),
        ],
      }),
    );
  });

  it("hides child_friendly for idea menus", () => {
    render(
      <RegenerationSheet
        targetMode="idea"
        usage={usageView(3)}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("radio", { name: "子どもが食べやすく" })).not.toBeInTheDocument();
    // 他の定型理由は idea でも選べる
    expect(screen.getByRole("radio", { name: "もっと簡単に" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "別の食材で" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "別の味に" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "その他" })).toBeInTheDocument();
  });

  it("keeps child_friendly available for household menus", () => {
    renderRegenerationSheet("household");
    expect(screen.getByRole("radio", { name: "子どもが食べやすく" })).toBeInTheDocument();
  });

  it("calls onCancel from やめる and from the dialog cancel event", async () => {
    const { onCancel } = renderRegenerationSheet();
    const dialog = screen.getByRole("dialog", { name: "どのように変えますか？" });
    await userEvent.click(within(dialog).getByRole("button", { name: "やめる" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    // Escape 相当の cancel イベント（送信中でなければ親へ委譲）
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
