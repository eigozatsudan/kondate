import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { plannerDraftInputSchema } from "@shared/contracts/planner";
import type { PlannerDraftInput } from "@shared/contracts/planner";
import type { PantryItem } from "@shared/contracts/pantry";
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
      pantryItems={[]}
      pantryItemsStatus="loading"
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
      pantryItems={[]}
      pantryItemsStatus="loading"
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

it("安全条件の再取得で対象外になった家族を選択から除き生成を止める", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const completeValue: PlannerDraftInput = {
    ...initialValue,
    mealType: "dinner",
    mainIngredients: ["鶏肉"],
    cuisineGenre: "japanese",
  };
  const member = {
    id: initialValue.targetMemberIds[0]!,
    displayName: "子ども",
    ageBandLabel: "3〜5歳",
    allergyLabel: "アレルギーなし",
    safetyLabels: [],
    blockedReason: null,
  };
  const view = render(
    <PlannerForm
      initialValue={completeValue}
      members={[member]}
      pantryItems={[]}
      pantryItemsStatus="loading"
      saveState="saved"
      onChange={onChange}
      flush={vi.fn()}
      onGenerate={vi.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "献立を作る" })).toBeEnabled();
  view.rerender(
    <PlannerForm
      initialValue={completeValue}
      members={[]}
      pantryItems={[]}
      pantryItemsStatus="loading"
      saveState="saved"
      onChange={onChange}
      flush={vi.fn()}
      onGenerate={vi.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "献立を作れる家族がいません。家族設定を確認してください。",
  );
  await vi.waitFor(() => {
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ targetMemberIds: [] }));
  });
  await user.click(screen.getByRole("button", { name: "献立を作る" }));
});

it("メイン食材を8件までに制限し契約外の値を作らない", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <PlannerForm
      initialValue={{
        ...initialValue,
        mainIngredients: ["食材1", "食材2", "食材3", "食材4", "食材5", "食材6", "食材7", "食材8"],
      }}
      members={[]}
      pantryItems={[]}
      pantryItemsStatus="loading"
      saveState="saved"
      onChange={onChange}
    />,
  );

  await user.type(screen.getByLabelText("メイン食材"), "食材9");
  await user.click(screen.getByRole("button", { name: "追加" }));

  expect(screen.getByText("メイン食材は8件までです。")).toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalledWith(
    expect.objectContaining({
      mainIngredients: [
        "食材1",
        "食材2",
        "食材3",
        "食材4",
        "食材5",
        "食材6",
        "食材7",
        "食材8",
        "食材9",
      ],
    }),
  );
  expect(
    plannerDraftInputSchema.safeParse({
      ...initialValue,
      targetMemberIds: [],
      mainIngredients: ["食材1", "食材2", "食材3", "食材4", "食材5", "食材6", "食材7", "食材8"],
    }).success,
  ).toBe(true);
});

it("NFKC正規化後に80 Unicode code pointsを超えるメイン食材を追加しない", () => {
  const onChange = vi.fn();
  render(
    <PlannerForm
      initialValue={initialValue}
      members={[]}
      pantryItems={[]}
      pantryItemsStatus="loading"
      saveState="saved"
      onChange={onChange}
    />,
  );
  onChange.mockClear();

  fireEvent.change(screen.getByLabelText("メイン食材"), {
    target: { value: "㍍".repeat(80) },
  });
  fireEvent.click(screen.getByRole("button", { name: "追加" }));

  expect(screen.getByText("メイン食材は1件80文字までです。")).toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByLabelText("メイン食材")).toHaveValue("㍍".repeat(80));
});

it("対象家族は20人を上限にし、超過候補を理由付きで無効化しつつ選択済みは外せる", async () => {
  const user = userEvent.setup();
  const members = Array.from({ length: 21 }, (_, index) => ({
    id: `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    displayName: `家族${String(index + 1)}`,
    ageBandLabel: "大人",
    allergyLabel: "アレルギーなし",
    safetyLabels: [],
    blockedReason: null,
  }));
  const selectedIds = members.slice(0, 20).map((member) => member.id);
  const onChange = vi.fn();
  render(
    <PlannerForm
      initialValue={{ ...initialValue, targetMemberIds: selectedIds }}
      members={members}
      pantryItems={[]}
      pantryItemsStatus="loading"
      saveState="saved"
      onChange={onChange}
    />,
  );

  expect(screen.getByRole("checkbox", { name: "家族21" })).toBeDisabled();
  expect(
    screen.getByText("対象家族は20人までです。選択中の家族を外すと追加できます。"),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("checkbox", { name: "家族1" }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ targetMemberIds: selectedIds.slice(1) }),
  );
  expect(
    plannerDraftInputSchema.safeParse({
      ...initialValue,
      targetMemberIds: selectedIds.slice(1),
    }).success,
  ).toBe(true);
});

it("保存競合中は入力を保持したまま生成を開始しない", () => {
  const flush = vi.fn();
  const onGenerate = vi.fn();
  render(
    <PlannerForm
      initialValue={{
        ...initialValue,
        mealType: "dinner",
        mainIngredients: ["鶏肉"],
        cuisineGenre: "japanese",
        memo: "Aの入力",
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
      pantryItems={[]}
      pantryItemsStatus="loading"
      saveState="error"
      onChange={vi.fn()}
      flush={flush}
      onGenerate={onGenerate}
    />,
  );

  expect(screen.getByLabelText("自由メモ")).toHaveValue("Aの入力");
  expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
  expect(flush).not.toHaveBeenCalled();
  expect(onGenerate).not.toHaveBeenCalled();
});

it("避ける食材を20件かつ各80 Unicode code points以内へ入力時に制限する", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <PlannerForm
      initialValue={initialValue}
      members={[]}
      pantryItems={[]}
      pantryItemsStatus="loading"
      saveState="saved"
      onChange={onChange}
    />,
  );

  await user.click(screen.getByText("追加条件"));
  const input = screen.getByLabelText("今回だけ避ける食材");
  fireEvent.change(input, {
    target: {
      value: Array.from({ length: 21 }, (_, index) => `食材${String(index + 1)}`).join("、"),
    },
  });
  expect(input).toHaveValue(
    Array.from({ length: 20 }, (_, index) => `食材${String(index + 1)}`).join("、"),
  );
  expect(screen.getByText("避ける食材は20件までです。")).toBeInTheDocument();

  await user.clear(input);
  await user.type(input, "😀".repeat(81));
  expect(input).toHaveValue("😀".repeat(80));
  expect(screen.getByText("避ける食材は1件80文字までです。")).toBeInTheDocument();
  expect(
    plannerDraftInputSchema.safeParse({
      ...initialValue,
      targetMemberIds: [],
      avoidIngredients: ["😀".repeat(80)],
    }).success,
  ).toBe(true);

  await user.clear(input);
  expect(input).toHaveValue("");
});

it.each(["卵,小麦", "卵、小麦"])(
  "避ける食材の逐次入力 %s は区切りを保持して2件を保存対象にする",
  async (typed) => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PlannerForm
        initialValue={initialValue}
        members={[]}
        pantryItems={[]}
        pantryItemsStatus="loading"
        saveState="saved"
        onChange={onChange}
      />,
    );

    await user.click(screen.getByText("追加条件"));
    const input = screen.getByLabelText("今回だけ避ける食材");
    await user.type(input, typed);

    expect(input).toHaveValue("卵、小麦");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ avoidIngredients: ["卵", "小麦"] }),
    );
  },
);

it("削除済みの冷蔵庫選択が残る間は理由を表示して生成を止める", () => {
  const pantryItem: PantryItem = {
    id: "71000000-0000-0000-0000-000000000001",
    userId: "72000000-0000-0000-0000-000000000001",
    name: "豆腐",
    quantity: 1,
    unit: "丁",
    expiresOn: null,
    expirationType: null,
    openedState: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
  render(
    <PlannerForm
      initialValue={{
        ...initialValue,
        mealType: "dinner",
        mainIngredients: ["鶏肉"],
        cuisineGenre: "japanese",
        pantrySelections: [{ pantryItemId: pantryItem.id, priority: "prefer_use" }],
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
      pantryItems={[]}
      pantryItemsStatus="loaded"
      attempt={{
        idempotencyKey: "73000000-0000-0000-0000-000000000011",
        expiredPantryChecks: [],
      }}
      onAttemptChange={vi.fn()}
      saveState="saved"
      onChange={vi.fn()}
      flush={vi.fn()}
      onGenerate={vi.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
  expect(
    screen.getByText("冷蔵庫から削除された食材の選択を解除してから献立を作ってください。"),
  ).toBeInTheDocument();
});
