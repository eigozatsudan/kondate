import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { plannerDraftInputSchema } from "@shared/contracts/planner";
import type { PlannerDraftInput } from "@shared/contracts/planner";
import type { PantryItem } from "@shared/contracts/pantry";
import { PlannerForm } from "./planner-page";
import { DraftRevisionConflictError } from "./planner-api";

const initialValue: PlannerDraftInput = {
  mealType: null,
  mainIngredients: [],
  cuisineGenre: null,
  targetMode: "household",
  targetMemberIds: ["70000000-0000-0000-0000-000000000001"],
  servings: null,
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
  expect(screen.getAllByText("くるみ・小麦／3〜5歳／小さく切る・骨を除く")).toHaveLength(2);
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

it("選択状態や対象外理由にかかわらず各チェックボックス直下へ具体的な安全条件を表示する", () => {
  render(
    <PlannerForm
      initialValue={initialValue}
      members={[
        {
          id: initialValue.targetMemberIds[0]!,
          displayName: "選択中の子ども",
          ageBandLabel: "3〜5歳",
          allergyLabel: "くるみ・小麦",
          safetyLabels: ["小さく切る", "骨を除く"],
          blockedReason: null,
        },
        {
          id: "70000000-0000-0000-0000-000000000002",
          displayName: "未選択の大人",
          ageBandLabel: "成人",
          allergyLabel: "アレルギーなし",
          safetyLabels: [],
          blockedReason: null,
        },
        {
          id: "70000000-0000-0000-0000-000000000003",
          displayName: "対象外の祖父",
          ageBandLabel: "高齢者",
          allergyLabel: "アレルギー未確認",
          safetyLabels: ["骨を除く"],
          blockedReason: "アレルギー確認が完了していません",
        },
      ]}
      pantryItems={[]}
      pantryItemsStatus="loading"
      saveState="saved"
      onChange={vi.fn()}
    />,
  );

  const selectedRow = screen.getByRole("checkbox", { name: "選択中の子ども" }).closest("div");
  const excludedRow = screen.getByRole("checkbox", { name: "未選択の大人" }).closest("div");
  const blockedRow = screen.getByRole("checkbox", { name: "対象外の祖父" }).closest("div");
  expect(selectedRow).not.toBeNull();
  expect(excludedRow).not.toBeNull();
  expect(blockedRow).not.toBeNull();
  expect(
    within(selectedRow!).getByText("くるみ・小麦／3〜5歳／小さく切る・骨を除く"),
  ).toBeInTheDocument();
  expect(within(excludedRow!).getByText("アレルギーなし／成人")).toBeInTheDocument();
  expect(within(blockedRow!).getByText("アレルギー未確認／高齢者／骨を除く")).toBeInTheDocument();
  expect(within(blockedRow!).getByText("アレルギー確認が完了していません")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "選択中の子ども" })).toHaveAccessibleDescription(
    "くるみ・小麦／3〜5歳／小さく切る・骨を除く",
  );
  expect(screen.getByRole("checkbox", { name: "未選択の大人" })).toHaveAccessibleDescription(
    "アレルギーなし／成人",
  );
  expect(screen.getByRole("checkbox", { name: "対象外の祖父" })).toHaveAccessibleDescription(
    "アレルギー未確認／高齢者／骨を除く アレルギー確認が完了していません",
  );
  expect(screen.getByRole("checkbox", { name: "対象外の祖父" })).toBeDisabled();
  expect(document.body).not.toHaveTextContent("70000000-0000-0000-0000-000000000003");
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
      targetMode: null,
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
    screen.getByText("選べる家族は20人までです。誰かを外すと追加できます。"),
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

it("最後に選択していた家族を外すと targetMode と servings を未選択へ戻す", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <PlannerForm
      initialValue={initialValue}
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
      onChange={onChange}
    />,
  );

  await user.click(screen.getByRole("checkbox", { name: "子ども" }));

  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ targetMode: null, targetMemberIds: [], servings: null }),
  );
  expect(
    plannerDraftInputSchema.safeParse({
      ...initialValue,
      targetMode: null,
      targetMemberIds: [],
    }).success,
  ).toBe(true);
  // household + [] は矛盾するため一時状態としても保存対象にしない
  expect(plannerDraftInputSchema.safeParse({ ...initialValue, targetMemberIds: [] }).success).toBe(
    false,
  );
});

it("保存競合中は入力を保持し、生成と緊急献立への移動を止めて明示解決だけを提供する", async () => {
  const user = userEvent.setup();
  const flush = vi.fn();
  const onGenerate = vi.fn();
  const onOpenEmergencyMenus = vi.fn();
  const onResolveDraftConflict = vi.fn();
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
      draftConflict
      canResolveDraftConflict
      onResolveDraftConflict={onResolveDraftConflict}
      onChange={vi.fn()}
      flush={flush}
      onGenerate={onGenerate}
      onOpenEmergencyMenus={onOpenEmergencyMenus}
    />,
  );

  expect(screen.getByLabelText("自由メモ")).toHaveValue("Aの入力");
  expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
  expect(screen.getByText(/別の画面で更新され/u)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "最新の下書きを読み込む" }));
  expect(onResolveDraftConflict).toHaveBeenCalledTimes(1);
  expect(flush).not.toHaveBeenCalled();
  expect(onGenerate).not.toHaveBeenCalled();
  expect(onOpenEmergencyMenus).not.toHaveBeenCalled();
});

it("緊急献立は進行中の保存完了を待ち、連打しても一度だけ移動する", async () => {
  let resolveFlush: ((draft: import("@shared/contracts/planner").PlannerDraft) => void) | undefined;
  const flush = vi.fn(
    () =>
      new Promise<import("@shared/contracts/planner").PlannerDraft>((resolve) => {
        resolveFlush = resolve;
      }),
  );
  const onOpenEmergencyMenus = vi.fn().mockResolvedValue(undefined);
  render(
    <PlannerForm
      initialValue={initialValue}
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
      saveState="saved"
      onChange={vi.fn()}
      flush={flush}
      onOpenEmergencyMenus={onOpenEmergencyMenus}
    />,
  );

  const button = screen.getByRole("button", { name: "AIを使わない緊急献立を見る" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(flush).toHaveBeenCalledTimes(1);
  expect(onOpenEmergencyMenus).not.toHaveBeenCalled();
  expect(button).toBeDisabled();

  await act(async () => {
    resolveFlush?.({
      id: "71000000-0000-0000-0000-000000000001",
      userId: "72000000-0000-0000-0000-000000000001",
      ...initialValue,
      revision: 1,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    await Promise.resolve();
  });
  expect(onOpenEmergencyMenus).toHaveBeenCalledTimes(1);
});

it("緊急献立の保存待ち中は生成を開始しない", () => {
  const deferredFlush = vi.fn(
    () =>
      new Promise<import("@shared/contracts/planner").PlannerDraft>(() => {
        // このテストでは未完了の保存を維持し、別操作が開始されないことだけを確認する。
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
      pantryItemsStatus="loaded"
      saveState="saved"
      onChange={vi.fn()}
      flush={deferredFlush}
      onGenerate={onGenerate}
      onOpenEmergencyMenus={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" }));

  const generateButton = screen.getByRole("button", { name: "献立を作る" });
  expect(generateButton).toBeDisabled();
  fireEvent.click(generateButton);
  expect(deferredFlush).toHaveBeenCalledTimes(1);
  expect(onGenerate).not.toHaveBeenCalled();
});

it("緊急献立の保存待ち中に対象家族が対象外になった場合は遷移を中止して選択を同期する", async () => {
  let resolveFlush: ((draft: import("@shared/contracts/planner").PlannerDraft) => void) | undefined;
  const flush = vi.fn(
    () =>
      new Promise<import("@shared/contracts/planner").PlannerDraft>((resolve) => {
        resolveFlush = resolve;
      }),
  );
  const onChange = vi.fn();
  const onOpenEmergencyMenus = vi.fn().mockResolvedValue(undefined);
  const member = {
    id: initialValue.targetMemberIds[0]!,
    displayName: "子ども",
    ageBandLabel: "3〜5歳",
    allergyLabel: "アレルギーなし",
    safetyLabels: [],
    blockedReason: null,
  };
  const { rerender } = render(
    <PlannerForm
      initialValue={initialValue}
      members={[member]}
      pantryItems={[]}
      pantryItemsStatus="loaded"
      saveState="saved"
      onChange={onChange}
      flush={flush}
      onOpenEmergencyMenus={onOpenEmergencyMenus}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" }));
  rerender(
    <PlannerForm
      initialValue={initialValue}
      members={[{ ...member, blockedReason: "対応対象の確認が完了していません" }]}
      pantryItems={[]}
      pantryItemsStatus="loaded"
      saveState="saved"
      onChange={onChange}
      flush={flush}
      onOpenEmergencyMenus={onOpenEmergencyMenus}
    />,
  );

  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ targetMemberIds: [] }));
  expect(
    screen.getByText("作る相手の条件が変わったため、緊急献立への移動を中止しました。"),
  ).toHaveAttribute("role", "alert");

  await act(async () => {
    resolveFlush?.({
      id: "71000000-0000-0000-0000-000000000001",
      userId: "72000000-0000-0000-0000-000000000001",
      ...initialValue,
      revision: 1,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    await Promise.resolve();
  });

  expect(onOpenEmergencyMenus).not.toHaveBeenCalled();
});

it("緊急献立の保存開始から遷移まで家族・医療入力を含む全条件を変更できない", async () => {
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
  const onChange = vi.fn();
  render(
    <PlannerForm
      initialValue={{
        ...initialValue,
        mainIngredients: ["鶏肉"],
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
      pantryItems={[pantryItem]}
      pantryItemsStatus="loaded"
      saveState="saved"
      attempt={{ idempotencyKey: "73000000-0000-0000-0000-000000000011", expiredPantryChecks: [] }}
      onAttemptChange={vi.fn()}
      onChange={onChange}
      flush={() =>
        new Promise(() => {
          // 保存待ちを維持し、遷移対象の条件が固定され続けることを確認する。
        })
      }
      onOpenEmergencyMenus={vi.fn()}
    />,
  );

  await userEvent.click(screen.getByText("追加条件"));
  fireEvent.click(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" }));

  expect(screen.getByRole("checkbox", { name: "子ども" })).toBeDisabled();
  expect(screen.getByRole("radio", { name: "夕食" })).toBeDisabled();
  expect(screen.getByLabelText("メイン食材")).toBeDisabled();
  expect(screen.getByRole("button", { name: "追加" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "鶏肉を外す" })).toBeDisabled();
  expect(screen.getByRole("radio", { name: "和食" })).toBeDisabled();
  expect(screen.getByLabelText("献立全体の調理時間")).toBeDisabled();
  expect(screen.getByLabelText("予算")).toBeDisabled();
  expect(screen.getByLabelText("今回だけ避ける食材")).toBeDisabled();
  expect(screen.getByLabelText("自由メモ")).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "豆腐" })).toBeDisabled();
  expect(screen.getByLabelText("豆腐の使い方")).toBeDisabled();
  expect(onChange).not.toHaveBeenCalled();
});

it("生成中は緊急献立を開始しない", async () => {
  const generationMayComplete = new Promise<void>(() => {
    // 生成中の状態を維持し、逆方向の操作も相互排他になることを確認する。
  });
  const flush = vi.fn().mockResolvedValue({
    id: "71000000-0000-0000-0000-000000000001",
    userId: "72000000-0000-0000-0000-000000000001",
    ...initialValue,
    mealType: "dinner",
    mainIngredients: ["鶏肉"],
    cuisineGenre: "japanese",
    revision: 1,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  });
  const onOpenEmergencyMenus = vi.fn();
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
      pantryItemsStatus="loaded"
      saveState="saved"
      onChange={vi.fn()}
      flush={flush}
      onGenerate={() => generationMayComplete}
      onOpenEmergencyMenus={onOpenEmergencyMenus}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "献立を作る" }));
  await act(async () => Promise.resolve());

  const emergencyButton = screen.getByRole("button", {
    name: "AIを使わない緊急献立を見る",
  });
  expect(emergencyButton).toBeDisabled();
  fireEvent.click(emergencyButton);
  expect(flush).toHaveBeenCalledTimes(1);
  expect(onOpenEmergencyMenus).not.toHaveBeenCalled();
});

it("緊急献立の保存待ち中に画面を離れた場合は遅れて移動しない", async () => {
  let resolveFlush: ((draft: import("@shared/contracts/planner").PlannerDraft) => void) | undefined;
  const flush = vi.fn(
    () =>
      new Promise<import("@shared/contracts/planner").PlannerDraft>((resolve) => {
        resolveFlush = resolve;
      }),
  );
  const onOpenEmergencyMenus = vi.fn();
  const view = render(
    <PlannerForm
      initialValue={initialValue}
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
      saveState="saved"
      onChange={vi.fn()}
      flush={flush}
      onOpenEmergencyMenus={onOpenEmergencyMenus}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" }));
  view.unmount();
  await act(async () => {
    resolveFlush?.({
      id: "71000000-0000-0000-0000-000000000001",
      userId: "72000000-0000-0000-0000-000000000001",
      ...initialValue,
      revision: 1,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    await Promise.resolve();
  });

  expect(onOpenEmergencyMenus).not.toHaveBeenCalled();
});

it.each([
  ["保存失敗", new Error("save failed")],
  ["revision conflict", new DraftRevisionConflictError()],
])("緊急献立への移動前の%sでは移動せず生成と同じ保存エラーを表示する", async (_, error) => {
  const onOpenEmergencyMenus = vi.fn();
  render(
    <PlannerForm
      initialValue={initialValue}
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
      saveState="saved"
      onChange={vi.fn()}
      flush={vi.fn().mockRejectedValue(error)}
      onOpenEmergencyMenus={onOpenEmergencyMenus}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" }));
  expect(onOpenEmergencyMenus).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "献立条件を保存できなかったため、生成を開始しませんでした。",
  );
});

it("競合先の取得完了前は最新下書きの反映操作を無効化する", () => {
  render(
    <PlannerForm
      initialValue={initialValue}
      members={[]}
      pantryItems={[]}
      pantryItemsStatus="loaded"
      saveState="error"
      draftConflict
      canResolveDraftConflict={false}
      onResolveDraftConflict={vi.fn()}
      onChange={vi.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "最新の下書きを読み込む" })).toBeDisabled();
});

it("競合先の再取得失敗時は入力を保持したまま再試行できる", async () => {
  const user = userEvent.setup();
  const onRetryDraftConflict = vi.fn();
  render(
    <PlannerForm
      initialValue={{ ...initialValue, memo: "Aの入力" }}
      members={[]}
      pantryItems={[]}
      pantryItemsStatus="loaded"
      saveState="error"
      draftConflict
      canResolveDraftConflict={false}
      draftConflictRefetchError
      onResolveDraftConflict={vi.fn()}
      onRetryDraftConflict={onRetryDraftConflict}
      onChange={vi.fn()}
    />,
  );

  expect(screen.getByLabelText("自由メモ")).toHaveValue("Aの入力");
  expect(screen.getByText("最新の下書きを取得できませんでした。")).toHaveAttribute("role", "alert");
  await user.click(screen.getByRole("button", { name: "再試行" }));
  expect(onRetryDraftConflict).toHaveBeenCalledTimes(1);
});

it.each<[string, Pick<PlannerDraftInput, "mainIngredients" | "avoidIngredients">]>([
  ["メイン食材", { mainIngredients: ["離乳食"], avoidIngredients: [] }],
  ["避ける食材", { mainIngredients: ["鶏肉"], avoidIngredients: ["嚥下食"] }],
])("%sだけに医療対象外依頼がある場合も警告を表示して生成を止める", (_, patch) => {
  render(
    <PlannerForm
      initialValue={{
        ...initialValue,
        mealType: "dinner",
        cuisineGenre: "japanese",
        ...patch,
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
      saveState="saved"
      onChange={vi.fn()}
      flush={vi.fn()}
      onGenerate={vi.fn()}
      onOpenEmergencyMenus={vi.fn()}
    />,
  );

  expect(screen.getByRole("alert")).toHaveTextContent(
    "離乳食、飲み込み・嚥下、治療食の依頼には対応できません。専門職の指示に従ってください。",
  );
  expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" })).toBeDisabled();
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
      targetMode: null,
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
