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

function usageView(remaining = 3, plan: "free" | "plus" = "free"): RegenerationUsageView {
  return {
    successRemaining: remaining,
    attemptsRemaining: 12,
    shortWindowRemaining: 4,
    shortWindowRetryAt: null,
    loading: false,
    error: false,
    plan,
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

  it("shows Plus hard-limit CTA when Free success remaining is 0", () => {
    render(
      <RegenerationSheet
        targetMode="household"
        usage={usageView(0, "free")}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/Plus なら 1 日最大 10 回まで作成できます/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Plus を見る" })).toHaveAttribute("href", "/settings");
  });

  it("does not prefix Plus remaining copy with 無料版は", () => {
    render(
      <RegenerationSheet
        targetMode="household"
        usage={usageView(2, "plus")}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByText(/無料版は/)).not.toBeInTheDocument();
    expect(screen.getByText("別の献立が完成した場合に1回使用・現在残り2回")).toBeVisible();
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

  // 設計 2026-07-29 案 A: attempts 0 / short window / null の事前ブロックと文言
  it("disables submit when attempts remaining is zero", () => {
    render(
      <RegenerationSheet
        targetMode="idea"
        usage={{
          successRemaining: 3,
          attemptsRemaining: 0,
          shortWindowRemaining: 4,
          shortWindowRetryAt: null,
          loading: false,
          error: false,
        }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        "無料版は今日は新しい献立の作成を受け付けられません。明日0:00（日本時間）以降にお試しください。",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "別案を作る" })).toBeDisabled();
    expect(screen.queryByText(/AIへの問い合わせ/u)).not.toBeInTheDocument();
    expect(screen.getByText(/別の献立が完成した場合に1回使用・現在残り3回/u)).toBeVisible();
  });

  it("disables submit when short window is blocked", () => {
    render(
      <RegenerationSheet
        targetMode="idea"
        usage={{
          successRemaining: 3,
          attemptsRemaining: 5,
          shortWindowRemaining: 0,
          shortWindowRetryAt: "2026-07-25T05:10:00.000Z",
          loading: false,
          error: false,
        }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "別案を作る" })).toBeDisabled();
    expect(screen.getByText(/しばらく続けて作成を試したため/u)).toBeVisible();
    expect(screen.getByText(/以降に再試行してください/u)).toBeVisible();
  });

  it("does not treat null attemptsRemaining as blocked", () => {
    render(
      <RegenerationSheet
        targetMode="idea"
        usage={{
          successRemaining: 3,
          attemptsRemaining: null,
          shortWindowRemaining: 4,
          shortWindowRetryAt: null,
          loading: false,
          error: false,
        }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // 理由未選択のため submit は押せる見た目だが、attempts 理由では止めない
    // disabled は form 理由不足ではなく attempts 以外 — 実装では attemptsBlocked false
    expect(screen.queryByText(/受け付けられません/u)).not.toBeInTheDocument();
  });
});
