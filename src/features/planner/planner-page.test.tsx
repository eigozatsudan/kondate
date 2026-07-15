import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { PlannerDraftInput } from "@shared/contracts/planner";
import { PlannerForm } from "./planner-page";

const initialValue: PlannerDraftInput = {
  mealType: null,
  mainIngredients: [],
  cuisineGenre: null,
  targetMemberIds: ["70000000-0000-0000-0000-000000000001"],
  timeLimitMinutes: null,
  budgetPreference: null,
  avoidIngredients: [],
  memo: "",
  pantrySelections: [],
};

it("三つの基本条件と追加条件を更新し、人間向け安全情報だけを表示する", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <PlannerForm
      initialValue={initialValue}
      members={[
        {
          id: "70000000-0000-0000-0000-000000000001",
          displayName: "子ども",
          ageBandLabel: "3〜5歳",
          allergyLabel: "くるみ・小麦",
          safetyLabels: ["小さく切る", "骨を除く"],
          blockedReason: null,
        },
        {
          id: "70000000-0000-0000-0000-000000000002",
          displayName: "祖父",
          ageBandLabel: "高齢者",
          allergyLabel: "アレルギー未確認",
          safetyLabels: [],
          blockedReason: "アレルギー確認が完了していません",
        },
      ]}
      saveState="saved"
      onChange={onChange}
      onGenerate={vi.fn()}
    />,
  );

  expect(screen.getByText("現在の家族・安全条件")).toBeInTheDocument();
  expect(screen.getByText("くるみ・小麦／3〜5歳／小さく切る・骨を除く")).toBeInTheDocument();
  expect(screen.queryByText(/member_1/u)).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "子ども" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "祖父" })).toBeDisabled();
  expect(screen.getAllByText("アレルギー確認が完了していません")).toHaveLength(2);

  await user.click(screen.getByRole("radio", { name: "夕食" }));
  await user.type(screen.getByLabelText("メイン食材"), "鶏肉");
  await user.click(screen.getByRole("button", { name: "追加" }));
  await user.click(screen.getByRole("radio", { name: "和食" }));
  await user.click(screen.getByText("追加条件"));
  await user.type(screen.getByLabelText("自由メモ"), "野菜を多めに");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      mealType: "dinner",
      mainIngredients: ["鶏肉"],
      cuisineGenre: "japanese",
      memo: "野菜を多めに",
    }),
  );
});

it("献立生成は autosave flush の完了後にだけ開始する", async () => {
  const user = userEvent.setup();
  let resolveFlush: (() => void) | undefined;
  const flush = vi.fn(
    () =>
      new Promise<import("@shared/contracts/planner").PlannerDraft>((resolve) => {
        resolveFlush = () => {
          resolve({
            id: "71000000-0000-0000-0000-000000000001",
            userId: "72000000-0000-0000-0000-000000000001",
            ...initialValue,
            mealType: "dinner",
            mainIngredients: ["鶏肉"],
            cuisineGenre: "japanese",
            revision: 3,
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
          });
        };
      }),
  );
  const onGenerate = vi.fn();
  render(
    <PlannerForm
      initialValue={{
        ...initialValue,
        mealType: "dinner",
        mainIngredients: ["鶏肉"],
        cuisineGenre: "japanese",
      }}
      members={[
        {
          id: initialValue.targetMemberIds[0]!,
          displayName: "子ども",
          ageBandLabel: "3〜5歳",
          allergyLabel: "アレルギーなし",
          safetyLabels: [],
          blockedReason: null,
        },
      ]}
      saveState="saved"
      onChange={vi.fn()}
      flush={flush}
      onGenerate={onGenerate}
    />,
  );

  await user.click(screen.getByRole("button", { name: "献立を作る" }));
  expect(onGenerate).not.toHaveBeenCalled();
  await act(async () => {
    resolveFlush?.();
    await Promise.resolve();
  });
  await vi.waitFor(() => {
    expect(onGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "71000000-0000-0000-0000-000000000001",
        revision: 3,
      }),
      undefined,
    );
  });
});
