import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps } from "react";
import { beforeAll, expect, it, vi } from "vitest";
import { IngredientDislikeDialog, INGREDIENT_DISLIKE_NOTE } from "./ingredient-dislike-dialog";
import {
  HOUSEHOLD_SAVED_REFRESH_FAILED,
  type SaveIngredientDislikesResult,
} from "./save-ingredient-dislikes";

beforeAll(() => {
  if (typeof HTMLDialogElement !== "undefined") {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});

const members = [
  { id: "member-a", displayName: "はな" },
  { id: "member-b", displayName: "名前未設定" },
];

function renderDialog(overrides: Partial<ComponentProps<typeof IngredientDislikeDialog>> = {}) {
  const save =
    overrides.save ??
    vi.fn<(input: unknown) => Promise<SaveIngredientDislikesResult>>(() =>
      Promise.resolve({
        kind: "saved",
        normalizedName: "にんじん",
        inserted: 1,
        alreadyPresent: 0,
        deleted: 0,
        refreshFailed: false,
      }),
    );
  const props: ComponentProps<typeof IngredientDislikeDialog> = {
    ingredientName: "にんじん",
    triggerId: "trigger",
    members,
    membersStatus: "ready",
    dislikesStatus: "ready",
    baselineEpoch: 1,
    baseline: [{ id: "row-a", memberId: "member-a", ingredientName: "にんじん" }],
    save,
    onClose: vi.fn(),
    onComplete: vi.fn(),
    onBaselineReconciled: vi.fn(),
    ...overrides,
  };
  const view = render(<IngredientDislikeDialog {...props} />);
  return { view, props };
}

it("prefills the ingredient name and checks members who already have it", () => {
  renderDialog();
  expect(screen.getByRole("dialog", { name: "苦手な食べ物" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "食べ物の名前" })).toHaveValue("にんじん");
  expect(screen.getByRole("checkbox", { name: "はな" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "名前未設定" })).not.toBeChecked();
  expect(screen.getByText(INGREDIENT_DISLIKE_NOTE)).toBeVisible();
});

it("does not reset checks when the name changes", async () => {
  const user = userEvent.setup();
  renderDialog();
  await user.clear(screen.getByRole("textbox", { name: "食べ物の名前" }));
  await user.type(screen.getByRole("textbox", { name: "食べ物の名前" }), "鶏肉");
  expect(screen.getByRole("checkbox", { name: "はな" })).toBeChecked();
});

it("disables save when nothing changed, the name is empty, or it is longer than 80", async () => {
  const user = userEvent.setup();
  const { view, props } = renderDialog();
  expect(screen.getByRole("button", { name: "保存する" })).toBeDisabled();

  await user.click(screen.getByRole("checkbox", { name: "名前未設定" }));
  expect(screen.getByRole("button", { name: "保存する" })).toBeEnabled();

  await user.clear(screen.getByRole("textbox", { name: "食べ物の名前" }));
  expect(screen.getByRole("button", { name: "保存する" })).toBeDisabled();
  expect(screen.queryByText("苦手食材は1〜80文字で入力してください")).not.toBeInTheDocument();

  await user.type(screen.getByRole("textbox", { name: "食べ物の名前" }), "あ".repeat(81));
  expect(screen.getByRole("button", { name: "保存する" })).toBeDisabled();
  expect(screen.getByText("苦手食材は1〜80文字で入力してください")).toBeVisible();

  view.rerender(
    <IngredientDislikeDialog {...props} membersStatus="error" dislikesStatus="error" />,
  );
  expect(screen.getByText("家族情報を読み込めませんでした")).toBeVisible();
  expect(screen.getByText("苦手食材を読み込めませんでした")).toBeVisible();
  expect(screen.getByRole("button", { name: "保存する" })).toBeDisabled();

  view.rerender(
    <IngredientDislikeDialog
      {...props}
      membersStatus="pending"
      dislikesStatus="pending"
      baselineEpoch={0}
    />,
  );
  expect(screen.queryByText("家族情報を読み込めませんでした")).not.toBeInTheDocument();
  expect(screen.queryByText("苦手食材を読み込めませんでした")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "保存する" })).toBeDisabled();
});

it("keeps the dialog open and shows the stopped message", async () => {
  const user = userEvent.setup();
  const save = vi.fn<() => Promise<SaveIngredientDislikesResult>>(() =>
    Promise.resolve({
      kind: "stopped",
      normalizedName: "にんじん",
      inserted: 1,
      alreadyPresent: 0,
      deleted: 0,
      refreshFailed: false,
      message:
        "登録に失敗しました 一部は保存済みです。チェックを確認して、もう一度保存してください。",
      nextCheckedMemberIds: ["member-a"],
      nextBaseline: [{ id: "row-a", memberId: "member-a", ingredientName: "にんじん" }],
    }),
  );
  const onBaselineReconciled = vi.fn();
  const onClose = vi.fn();
  renderDialog({ save, onBaselineReconciled, onClose });
  await user.click(screen.getByRole("checkbox", { name: "名前未設定" }));
  await user.click(screen.getByRole("button", { name: "保存する" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("一部は保存済みです");
  expect(onClose).not.toHaveBeenCalled();
  expect(onBaselineReconciled).toHaveBeenCalledWith([
    { id: "row-a", memberId: "member-a", ingredientName: "にんじん" },
  ]);
});

it("reports only the refresh failure sentence and closes when the save fully succeeded", async () => {
  const user = userEvent.setup();
  const onComplete = vi.fn();
  const onClose = vi.fn();
  renderDialog({
    onComplete,
    onClose,
    save: vi.fn<() => Promise<SaveIngredientDislikesResult>>(() =>
      Promise.resolve({
        kind: "saved",
        normalizedName: "にんじん",
        inserted: 0,
        alreadyPresent: 0,
        deleted: 1,
        refreshFailed: true,
      }),
    ),
  });
  await user.click(screen.getByRole("checkbox", { name: "はな" }));
  await user.click(screen.getByRole("button", { name: "保存する" }));
  expect(onComplete).toHaveBeenCalledWith(HOUSEHOLD_SAVED_REFRESH_FAILED);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("does not close while the save is in flight", async () => {
  const user = userEvent.setup();
  let resolveSave: (result: SaveIngredientDislikesResult) => void = () => {};
  const save = vi.fn(
    () =>
      new Promise<SaveIngredientDislikesResult>((resolve) => {
        resolveSave = resolve;
      }),
  );
  const onClose = vi.fn();
  renderDialog({ save, onClose });
  await user.click(screen.getByRole("checkbox", { name: "名前未設定" }));
  await user.click(screen.getByRole("button", { name: "保存する" }));
  expect(screen.getByRole("button", { name: "保存しています" })).toBeDisabled();
  fireEvent(
    screen.getByRole("dialog", { name: "苦手な食べ物" }),
    new Event("cancel", { cancelable: true }),
  );
  expect(onClose).not.toHaveBeenCalled();
  resolveSave({
    kind: "stopped",
    normalizedName: "にんじん",
    inserted: 0,
    alreadyPresent: 0,
    deleted: 0,
    refreshFailed: false,
    message: "登録に失敗しました",
    nextCheckedMemberIds: null,
    nextBaseline: null,
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("登録に失敗しました");
  expect(onClose).not.toHaveBeenCalled();
});

it("passes the opened name and the open baseline when the field is edited", async () => {
  const user = userEvent.setup();
  const save = vi.fn<(input: unknown) => Promise<SaveIngredientDislikesResult>>(() =>
    Promise.resolve({
      kind: "no_diff",
    }),
  );
  const baseline = [{ id: "row-a", memberId: "member-a", ingredientName: "にんじん" }];
  renderDialog({ save, baseline });
  const name = screen.getByRole("textbox", { name: "食べ物の名前" });
  await user.clear(name);
  await user.type(name, "鶏肉");
  await user.click(screen.getByRole("checkbox", { name: "名前未設定" }));
  await user.click(screen.getByRole("button", { name: "保存する" }));
  expect(save).toHaveBeenCalledWith({
    openedName: "にんじん",
    currentName: "鶏肉",
    memberIds: ["member-a", "member-b"],
    checkedMemberIds: new Set(["member-a", "member-b"]),
    baseline,
  });
});

it("returns focus to the ingredient button when it is still mounted", () => {
  const { rerender } = render(
    <>
      <button id="trigger" type="button">
        苦手
      </button>
      <IngredientDislikeDialog
        ingredientName="にんじん"
        triggerId="trigger"
        members={members}
        membersStatus="ready"
        dislikesStatus="ready"
        baselineEpoch={1}
        baseline={[]}
        save={vi.fn()}
        onClose={vi.fn()}
        onComplete={vi.fn()}
        onBaselineReconciled={vi.fn()}
      />
    </>,
  );
  rerender(
    <button id="trigger" type="button">
      苦手
    </button>,
  );
  expect(document.getElementById("trigger")).toHaveFocus();
});

it("does not move focus when the ingredient button is already gone", () => {
  const { rerender } = render(
    <IngredientDislikeDialog
      ingredientName="にんじん"
      triggerId="missing"
      members={members}
      membersStatus="ready"
      dislikesStatus="ready"
      baselineEpoch={1}
      baseline={[]}
      save={vi.fn()}
      onClose={vi.fn()}
      onComplete={vi.fn()}
      onBaselineReconciled={vi.fn()}
    />,
  );
  rerender(<p>閉じました</p>);
  expect(document.activeElement).toBe(document.body);
});
