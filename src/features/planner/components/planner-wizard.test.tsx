import { fireEvent, act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PantryItem } from "@shared/contracts/pantry";
import type { PlannerDraftInput } from "@shared/contracts/planner";
import { AppToastProvider } from "@/shared/ui/app-toast";
import { HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY } from "../household-safety-helper-copy";
import type { PlannerFieldName, PlannerStep } from "../model/planner-wizard";
import type { PlannerSafetyMember } from "../planner-safety-member";
import { createPlannerAttempt } from "../expired-pantry-checks";
import { commonMainIngredients } from "../model/main-ingredient-options";
import { buildPlannerSubmissionFieldErrors } from "../model/planner-wizard";
import { registerPlannerLeaveFlush } from "../planner-leave-flush";
import { PlannerWizard } from "./planner-wizard";

afterEach(() => {
  registerPlannerLeaveFlush(null);
});

const emptyDraft: PlannerDraftInput = {
  mealType: null,
  mainIngredients: [],
  cuisineGenre: null,
  targetMode: null,
  targetMemberIds: [],
  servings: null,
  timeLimitMinutes: null,
  budgetPreference: null,
  ingredientPreference: null,
  avoidIngredients: [],
  memo: "",
  pantrySelections: [],
};

const eligibleMember: PlannerSafetyMember = {
  id: "70000000-0000-4000-8000-000000000001",
  displayName: "子ども",
  ageBandLabel: "3〜5歳",
  allergyLabel: "アレルギーなし",
  safetyLabels: [],
  blockedReason: null,
};

/**
 * PlannerWizardは非制御コンポーネント的にstepとdraftを親から受け取るため、
 * テストでは薄い状態管理ラッパーを用意して実際の画面遷移を再現する。
 */
function Harness({
  initialStep = "meal",
  initialDraft = emptyDraft,
  eligibleMembers = [eligibleMember],
  fieldErrors = {},
  error = null,
  isSaving = false,
  onSubmit = vi.fn(),
  hasAcceptedOrDeclinedPrivacy = true,
  onOpenPrivacyNotice = vi.fn(),
  onOpenEmergencyMenus,
  onIdeaAudienceConfirmed,
  onReset,
  hasDraftConflict = false,
  canResolveDraftConflict = false,
  draftConflictRefetchError = false,
  onResolveDraftConflict,
  onRetryDraftConflict,
  pantryItems = [],
  pantryItemsStatus = "loaded",
  usageRemaining = null,
  plan = null,
  qualityAvailable = null,
  attemptsRemaining = null,
  globalAvailable = null,
  shortWindowRetryAt = null,
  autosaveState = "idle" as const,
  onRetryAutosave,
  hasResumablePendingGeneration = false,
  blockGenerationForStaleSafety = false,
}: {
  initialStep?: PlannerStep;
  initialDraft?: PlannerDraftInput;
  eligibleMembers?: readonly PlannerSafetyMember[];
  fieldErrors?: Partial<Record<PlannerFieldName, string>>;
  error?: string | null;
  isSaving?: boolean;
  onSubmit?: () => Promise<void>;
  hasAcceptedOrDeclinedPrivacy?: boolean;
  onOpenPrivacyNotice?: () => void;
  onOpenEmergencyMenus?: () => void;
  onIdeaAudienceConfirmed?: () => Promise<void>;
  onReset?: () => void;
  hasDraftConflict?: boolean;
  canResolveDraftConflict?: boolean;
  draftConflictRefetchError?: boolean;
  onResolveDraftConflict?: () => void;
  onRetryDraftConflict?: () => void;
  pantryItems?: readonly PantryItem[];
  pantryItemsStatus?: "loading" | "loaded";
  usageRemaining?: number | null;
  plan?: "free" | "plus" | null;
  qualityAvailable?: boolean | null;
  attemptsRemaining?: number | null;
  globalAvailable?: boolean | null;
  shortWindowRetryAt?: string | null;
  autosaveState?: "idle" | "saving" | "saved" | "error";
  onRetryAutosave?: () => void;
  hasResumablePendingGeneration?: boolean;
  blockGenerationForStaleSafety?: boolean;
}) {
  const [step, setStep] = useState<PlannerStep>(initialStep);
  const [draft, setDraft] = useState<PlannerDraftInput>(initialDraft);
  const [attempt, setAttempt] = useState(createPlannerAttempt());
  // Link（家族設定）のため MemoryRouter で包む（C-I2）
  // incomplete「次へ」が useAppToast を使うため AppToastProvider も必須
  return (
    <MemoryRouter>
      <AppToastProvider>
        <PlannerWizard
          draft={draft}
          step={step}
          eligibleMembers={eligibleMembers}
          isSaving={isSaving}
          error={error}
          fieldErrors={fieldErrors}
          onDraftChange={setDraft}
          onStepChange={setStep}
          onSubmit={onSubmit}
          pantryItems={pantryItems}
          pantryItemsStatus={pantryItemsStatus}
          attempt={attempt}
          onAttemptChange={setAttempt}
          hasAcceptedOrDeclinedPrivacy={hasAcceptedOrDeclinedPrivacy}
          onOpenPrivacyNotice={onOpenPrivacyNotice}
          hasDraftConflict={hasDraftConflict}
          canResolveDraftConflict={canResolveDraftConflict}
          draftConflictRefetchError={draftConflictRefetchError}
          usageRemaining={usageRemaining}
          plan={plan}
          qualityAvailable={qualityAvailable}
          attemptsRemaining={attemptsRemaining}
          globalAvailable={globalAvailable}
          shortWindowRetryAt={shortWindowRetryAt}
          autosaveState={autosaveState}
          hasResumablePendingGeneration={hasResumablePendingGeneration}
          blockGenerationForStaleSafety={blockGenerationForStaleSafety}
          {...(onOpenEmergencyMenus !== undefined ? { onOpenEmergencyMenus } : {})}
          {...(onIdeaAudienceConfirmed !== undefined ? { onIdeaAudienceConfirmed } : {})}
          {...(onReset !== undefined ? { onReset } : {})}
          {...(onResolveDraftConflict !== undefined ? { onResolveDraftConflict } : {})}
          {...(onRetryDraftConflict !== undefined ? { onRetryDraftConflict } : {})}
          {...(onRetryAutosave !== undefined ? { onRetryAutosave } : {})}
        />
      </AppToastProvider>
    </MemoryRouter>
  );
}

const reviewDraft: PlannerDraftInput = {
  ...emptyDraft,
  mealType: "dinner",
  mainIngredients: ["鶏肉"],
  cuisineGenre: "japanese",
  targetMode: "household",
  targetMemberIds: [eligibleMember.id],
};

describe("PlannerWizard 固定順とnavigation", () => {
  it.each([
    ["ｶﾚｰ", "カレー"],
    [" ㌔ ", "キロ"],
    ["　鶏肉　", "鶏肉"],
  ])("既存値 %s とcanonical等価な自由入力・冷蔵庫候補を重複追加しない", async (saved, input) => {
    const user = userEvent.setup();
    const pantryItem: PantryItem = {
      id: `pantry-${input}`,
      userId: eligibleMember.id,
      name: input,
      quantity: null,
      unit: null,
      expiresOn: null,
      expirationType: null,
      openedState: null,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };
    render(
      <Harness
        initialStep="ingredients"
        initialDraft={{ ...emptyDraft, mainIngredients: [saved] }}
        pantryItems={[pantryItem]}
      />,
    );

    expect(screen.getByRole("button", { name: `${input}を追加` })).toBeDisabled();
    await user.type(screen.getByLabelText("メイン食材"), input);
    await user.click(screen.getByRole("button", { name: "追加" }));

    const removeButtons = screen.getAllByRole("button", { name: /を外す$/u });
    expect(removeButtons).toHaveLength(1);
  });

  it("冷蔵庫候補にも8件上限と80 code point上限を適用する", async () => {
    const user = userEvent.setup();
    const pantryItem = {
      id: "pantry-limit",
      userId: eligibleMember.id,
      name: "追加候補",
      quantity: null,
      unit: null,
      expiresOn: null,
      expirationType: null,
      openedState: null,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    } satisfies PantryItem;
    const { rerender } = render(
      <Harness
        initialStep="ingredients"
        initialDraft={{
          ...emptyDraft,
          mainIngredients: Array.from({ length: 8 }, (_, index) => `食材${String(index + 1)}`),
        }}
        pantryItems={[pantryItem]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "追加候補を追加" }));
    expect(screen.getByRole("alert")).toHaveTextContent("メイン食材は8件までです。");

    rerender(
      <Harness
        initialStep="ingredients"
        pantryItems={[{ ...pantryItem, id: "pantry-long", name: "あ".repeat(81) }]}
      />,
    );
    await user.click(screen.getByRole("button", { name: `${"あ".repeat(81)}を追加` }));
    expect(screen.getByRole("alert")).toHaveTextContent("メイン食材は1件80文字までです。");
  });

  it("冷蔵庫の候補をメイン食材へ追加しても冷蔵庫の使用条件は変更しない", async () => {
    const user = userEvent.setup();
    const pantryItem: PantryItem = {
      id: "60000000-0000-4000-8000-000000000001",
      userId: "70000000-0000-4000-8000-000000000001",
      name: "　鶏肉　",
      quantity: 1,
      unit: "枚",
      expiresOn: null,
      expirationType: null,
      openedState: null,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };
    render(<Harness initialStep="ingredients" pantryItems={[pantryItem]} />);

    expect(screen.getByRole("heading", { name: "冷蔵庫から選ぶ" })).toBeVisible();
    expect(screen.getByText(/必ず使う／使えれば使う/u)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "鶏肉を追加" }));

    expect(screen.getByRole("button", { name: "鶏肉を外す" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "次へ" }));
    await user.click(screen.getByRole("radio", { name: "和食" }));
    await user.click(screen.getByRole("button", { name: "次へ" }));
    await user.click(screen.getByRole("radio", { name: "家族に合わせて作る" }));
    await user.click(screen.getByRole("checkbox", { name: /^子ども/u }));
    await user.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.getByRole("checkbox", { name: /鶏肉/u })).not.toBeChecked();
  });

  it("冷蔵庫候補の読み込み中と空状態を表示する", () => {
    const { rerender } = render(<Harness initialStep="ingredients" pantryItemsStatus="loading" />);
    expect(screen.getByText("冷蔵庫の食材を読み込んでいます…")).toBeVisible();

    rerender(<Harness initialStep="ingredients" pantryItemsStatus="loaded" pantryItems={[]} />);
    expect(screen.getByText("冷蔵庫に登録した食材はありません。")).toBeVisible();
  });

  it("メイン食材の入力と操作を狭い画面でも判別できる構造で表示する", () => {
    render(<Harness initialStep="ingredients" />);

    const input = screen.getByLabelText("メイン食材");
    const inputLabel = input.closest("label");
    const entryRow = inputLabel?.parentElement;
    const addButton = screen.getByRole("button", { name: "追加" });
    const backButton = screen.getByRole("button", { name: "戻る" });
    const nextButton = screen.getByRole("button", { name: "次へ" });

    expect(inputLabel).toHaveClass("field", "ingredient-entry-field");
    expect(entryRow).toHaveClass("ingredient-entry-row");
    expect(entryRow).toContainElement(addButton);
    // Phase 1: secondary-button 直書きを共有 Button に置換。role/名は不変。
    expect(addButton.className).toContain("ui-btn--secondary");
    expect(backButton.parentElement).toHaveClass("wizard-actions");
    expect(backButton.parentElement).not.toHaveClass("stack-row");
    expect(backButton.className).toContain("ui-btn--secondary");
    expect(nextButton.className).toContain("ui-btn--primary");
  });

  it("meal→ingredients→cuisine→audience→reviewの順で進み、戻ると回答を保持する", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByRole("heading", { name: "1. 食事" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "夕食" }));
    await user.click(screen.getByRole("button", { name: "次へ" }));

    expect(screen.getByRole("heading", { name: "2. メイン食材" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("メイン食材"), "鶏肉");
    await user.click(screen.getByRole("button", { name: "追加" }));
    await user.click(screen.getByRole("button", { name: "次へ" }));

    expect(screen.getByRole("heading", { name: "3. ジャンル" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "和食" }));
    await user.click(screen.getByRole("button", { name: "次へ" }));

    expect(screen.getByRole("heading", { name: "4. 作る相手" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "家族に合わせて作る" }));
    await user.click(screen.getByRole("checkbox", { name: /^子ども/ }));
    await user.click(screen.getByRole("button", { name: "次へ" }));

    expect(screen.getByRole("heading", { name: "5. 確認" })).toBeInTheDocument();

    // review→audience→...→mealへ戻っても回答が残ることを確認する。
    await user.click(screen.getByRole("button", { name: "戻る" }));
    expect(screen.getByRole("checkbox", { name: /^子ども/ })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "戻る" }));
    expect(screen.getByRole("radio", { name: "和食" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "戻る" }));
    expect(screen.getByText("鶏肉を外す")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "戻る" }));
    expect(screen.getByRole("radio", { name: "夕食" })).toBeChecked();
  });

  it("headingへ自動でfocusする", () => {
    render(<Harness />);
    expect(screen.getByRole("heading", { name: "1. 食事" })).toHaveFocus();
  });

  it("初期状態は未選択で既定値を持たない", () => {
    render(<Harness />);
    expect(screen.getByRole("radio", { name: "朝食" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "昼食" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "夕食" })).not.toBeChecked();
    // incomplete でも押下可（親 disabled 以外では止めない）
    expect(screen.getByRole("button", { name: "次へ" })).not.toBeDisabled();
  });

  it("食事ステップも wizard-actions と option list で狭幅向けに組む", () => {
    render(<Harness initialStep="meal" />);
    const nextButton = screen.getByRole("button", { name: "次へ" });
    expect(nextButton.parentElement).toHaveClass("wizard-actions");
    expect(nextButton.className).toContain("ui-btn--primary");
    const breakfast = screen.getByRole("radio", { name: "朝食" });
    expect(breakfast.closest("label")).toHaveClass("wizard-option");
    expect(breakfast.closest('[role="radiogroup"]')).toHaveClass("wizard-option-list");
  });

  it("入力をリセットは確認後に onReset を呼ぶ", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Harness onReset={onReset} />);
    await user.click(screen.getByRole("button", { name: "入力をリセット" }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onReset).toHaveBeenCalledOnce();
    confirmSpy.mockRestore();
  });

  it("入力をリセットをキャンセルすると onReset を呼ばない", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Harness onReset={onReset} />);
    await user.click(screen.getByRole("button", { name: "入力をリセット" }));
    expect(onReset).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe("PlannerWizard review の日本語表示", () => {
  it("食事とジャンルを日本語ラベルで表示する", () => {
    render(
      <Harness
        initialStep="review"
        initialDraft={{
          ...emptyDraft,
          mealType: "dinner",
          mainIngredients: ["鶏肉"],
          cuisineGenre: "japanese",
          targetMode: "household",
          targetMemberIds: [eligibleMember.id],
        }}
      />,
    );
    expect(screen.getByText("夕食")).toBeVisible();
    expect(screen.getByText("和食")).toBeVisible();
    expect(screen.queryByText("dinner")).not.toBeInTheDocument();
    expect(screen.queryByText("japanese")).not.toBeInTheDocument();
  });
});

describe("PlannerWizard audience step のmode不変条件", () => {
  it("利用可能家族が0件ならhousehold選択をdisabledにし、理由と家族追加linkを表示する", () => {
    render(<Harness initialStep="audience" eligibleMembers={[]} />);
    const household = screen.getByRole("radio", { name: "家族に合わせて作る" });
    expect(household).toBeDisabled();
    expect(household).toHaveAttribute("aria-describedby", "audience-household-disabled-reason");
    expect(
      screen.getByText(/家族設定がまだないため、「家族に合わせて作る」は選べません/u),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "家族を追加する" })).toBeInTheDocument();
  });

  it("blocked メンバーは選択不可で、利用可能0件相当としてhouseholdをdisabledにする", () => {
    const blocked: PlannerSafetyMember = {
      ...eligibleMember,
      id: "70000000-0000-4000-8000-000000000099",
      displayName: "未確認",
      blockedReason: "アレルギー確認が完了していません",
    };
    render(<Harness initialStep="audience" eligibleMembers={[blocked]} />);
    expect(screen.getByRole("radio", { name: "家族に合わせて作る" })).toBeDisabled();
    expect(
      screen.getByText(/献立に使える家族がいないため、「家族に合わせて作る」は選べません/u),
    ).toBeVisible();
    // targetMode 未選択時は CurrentSafetySummary を出さず、blocked 理由だけを出す（C-I3）
    expect(screen.getByText(/アレルギー確認が完了していません/u)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "現在の家族・安全条件" })).not.toBeInTheDocument();
  });

  it("idea人数は1〜6がbutton、7〜20はプルダウンで選ぶ", async () => {
    const user = userEvent.setup();
    render(<Harness initialStep="audience" />);
    await user.click(screen.getByRole("radio", { name: "人数だけ指定してアイデアを見る" }));

    await user.click(screen.getByRole("button", { name: "3人" }));
    expect(screen.getByRole("button", { name: "3人" })).toHaveAttribute("aria-pressed", "true");

    const servingsSelect = screen.getByLabelText("7人以上（20人まで）");
    await user.selectOptions(servingsSelect, "12");
    expect(servingsSelect).toHaveValue("12");
  });

  it("人数プルダウンは7〜20人だけを持ち、範囲外の人数を選べない", async () => {
    const user = userEvent.setup();
    render(<Harness initialStep="audience" />);
    await user.click(screen.getByRole("radio", { name: "人数だけ指定してアイデアを見る" }));

    // number input だった頃は21のような範囲外値を打ててしまい、field-local error で
    // 弾く必要があった。プルダウンでは範囲外がそもそも表現できないため、
    // 選択肢の集合そのものを fail-closed の担保として固定する。
    const servingsSelect = screen.getByLabelText("7人以上（20人まで）");
    const options = Array.from(servingsSelect.querySelectorAll("option")).map(
      (option) => option.value,
    );
    expect(options).toEqual([
      "",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
      "13",
      "14",
      "15",
      "16",
      "17",
      "18",
      "19",
      "20",
    ]);
  });

  it("household選択後に対象家族が0件になった場合はmode未選択へ戻り、ideaへ自動降格しない", () => {
    // household 選択済み draft を持つ Harness を eligibleMembers=[] のまま最初から
    // render する（=「利用可能家族が0件になった状態で audience を開き直した」相当）。
    // このとき household の見た目の選択は維持しつつ選択自体を disabled にし、
    // 「idea へ自動降格しない」（=idea の radio が checked にならない）ことを固定する。
    render(
      <Harness
        initialStep="audience"
        eligibleMembers={[]}
        initialDraft={{
          ...emptyDraft,
          targetMode: "household",
          targetMemberIds: [eligibleMember.id],
        }}
      />,
    );
    expect(screen.getByRole("radio", { name: "家族に合わせて作る" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "人数だけ指定してアイデアを見る" })).not.toBeChecked();
  });
});

describe("PlannerWizard idea audience onIdeaAudienceConfirmed", () => {
  const ideaAudienceDraft: PlannerDraftInput = {
    ...emptyDraft,
    mealType: "dinner",
    mainIngredients: ["鶏肉"],
    cuisineGenre: "japanese",
    targetMode: "idea",
    targetMemberIds: [],
    servings: 2,
  };

  it("awaits onIdeaAudienceConfirmed before advancing idea audience to review", async () => {
    const user = userEvent.setup();
    let resolveConfirm: (() => void) | undefined;
    const onIdeaAudienceConfirmed = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    render(
      <Harness
        initialStep="audience"
        initialDraft={ideaAudienceDraft}
        onIdeaAudienceConfirmed={onIdeaAudienceConfirmed}
      />,
    );

    await user.click(screen.getByRole("button", { name: "次へ" }));
    expect(onIdeaAudienceConfirmed).toHaveBeenCalledTimes(1);
    // await 中は review へ進まない
    expect(screen.getByRole("heading", { name: "4. 作る相手" })).toBeInTheDocument();

    // resolve 後の onNext 継続（goToStep）まで act 内で microtask を消化する
    await act(async () => {
      resolveConfirm?.();
      await Promise.resolve();
    });
    expect(screen.getByRole("heading", { name: "5. 確認" })).toBeInTheDocument();
  });

  it("stays on audience when onIdeaAudienceConfirmed throws", async () => {
    const user = userEvent.setup();
    const onIdeaAudienceConfirmed = vi.fn().mockRejectedValue(new Error("blocked"));
    render(
      <Harness
        initialStep="audience"
        initialDraft={ideaAudienceDraft}
        onIdeaAudienceConfirmed={onIdeaAudienceConfirmed}
      />,
    );

    await user.click(screen.getByRole("button", { name: "次へ" }));
    await vi.waitFor(() => {
      expect(onIdeaAudienceConfirmed).toHaveBeenCalled();
    });
    expect(screen.getByRole("heading", { name: "4. 作る相手" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "5. 確認" })).not.toBeInTheDocument();
  });

  it("does not call onIdeaAudienceConfirmed for household audience next", async () => {
    const user = userEvent.setup();
    const onIdeaAudienceConfirmed = vi.fn().mockResolvedValue(undefined);
    render(
      <Harness
        initialStep="audience"
        initialDraft={{
          ...ideaAudienceDraft,
          targetMode: "household",
          targetMemberIds: [eligibleMember.id],
          servings: null,
        }}
        onIdeaAudienceConfirmed={onIdeaAudienceConfirmed}
      />,
    );

    await user.click(screen.getByRole("button", { name: "次へ" }));
    await vi.waitFor(() => {
      expect(screen.getByRole("heading", { name: "5. 確認" })).toBeInTheDocument();
    });
    expect(onIdeaAudienceConfirmed).not.toHaveBeenCalled();
  });

  it("disables audience next while idea confirm is in flight to prevent double submit", async () => {
    const user = userEvent.setup();
    let resolveConfirm: (() => void) | undefined;
    const onIdeaAudienceConfirmed = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    render(
      <Harness
        initialStep="audience"
        initialDraft={ideaAudienceDraft}
        onIdeaAudienceConfirmed={onIdeaAudienceConfirmed}
      />,
    );

    const nextButton = screen.getByRole("button", { name: "次へ" });
    await user.click(nextButton);
    expect(onIdeaAudienceConfirmed).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(nextButton).toBeDisabled();
    });
    // mode ラジオも disabled（await 中の切替を塞ぐ）
    expect(screen.getByRole("radio", { name: "家族に合わせて作る" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "人数だけ指定してアイデアを見る" })).toBeDisabled();

    // 二重クリックしても in-flight 中は追加呼び出ししない
    await user.click(nextButton);
    expect(onIdeaAudienceConfirmed).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveConfirm?.();
      await Promise.resolve();
    });
    expect(screen.getByRole("heading", { name: "5. 確認" })).toBeInTheDocument();
  });

  it("P1: idea confirm 中は入力リセットを disabled にする", async () => {
    const user = userEvent.setup();
    let resolveConfirm: (() => void) | undefined;
    const onIdeaAudienceConfirmed = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    render(
      <Harness
        initialStep="audience"
        initialDraft={ideaAudienceDraft}
        onIdeaAudienceConfirmed={onIdeaAudienceConfirmed}
        onReset={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "次へ" }));
    expect(onIdeaAudienceConfirmed).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "入力をリセット" })).toBeDisabled();
    });

    await act(async () => {
      resolveConfirm?.();
      await Promise.resolve();
    });
    expect(screen.getByRole("heading", { name: "5. 確認" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "入力をリセット" })).toBeEnabled();
  });

  it("P1: idea confirm await 中に wizard が remount されたら resolve 後も review へ進まない", async () => {
    const user = userEvent.setup();
    let resolveConfirm: (() => void) | undefined;
    const onIdeaAudienceConfirmed = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    const steps: PlannerStep[] = [];

    function RemountHarness({ wizardKey }: { wizardKey: number }) {
      const [step, setStep] = useState<PlannerStep>("audience");
      const [draft, setDraft] = useState<PlannerDraftInput>(ideaAudienceDraft);
      const [attempt, setAttempt] = useState(createPlannerAttempt());
      return (
        <MemoryRouter>
          <AppToastProvider>
            <PlannerWizard
              key={wizardKey}
              draft={draft}
              step={step}
              eligibleMembers={[eligibleMember]}
              isSaving={false}
              error={null}
              fieldErrors={{}}
              onDraftChange={setDraft}
              onStepChange={(next) => {
                steps.push(next);
                setStep(next);
              }}
              onSubmit={vi.fn()}
              pantryItems={[]}
              pantryItemsStatus="loaded"
              attempt={attempt}
              onAttemptChange={setAttempt}
              hasAcceptedOrDeclinedPrivacy
              onOpenPrivacyNotice={vi.fn()}
              onIdeaAudienceConfirmed={onIdeaAudienceConfirmed}
            />
          </AppToastProvider>
        </MemoryRouter>
      );
    }

    const { rerender } = render(<RemountHarness wizardKey={0} />);
    await user.click(screen.getByRole("button", { name: "次へ" }));
    expect(onIdeaAudienceConfirmed).toHaveBeenCalledTimes(1);

    // resetToken 相当の remount（親 step は meal へ戻した想定だが、旧 async が review を押し込むのを防ぐ）
    rerender(<RemountHarness wizardKey={1} />);
    expect(screen.getByRole("heading", { name: "4. 作る相手" })).toBeInTheDocument();

    await act(async () => {
      resolveConfirm?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 旧 wizard クロージャの goToStep("review") が発火していない
    expect(steps).not.toContain("review");
    expect(screen.queryByRole("heading", { name: "5. 確認" })).not.toBeInTheDocument();
  });
});

describe("PlannerWizard review step", () => {
  it("任意条件はデフォルトで開き、閉じたあと再度開いて編集できる", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialStep="review"
        initialDraft={{
          ...emptyDraft,
          mealType: "dinner",
          mainIngredients: ["鶏肉"],
          cuisineGenre: "japanese",
          targetMode: "household",
          targetMemberIds: [eligibleMember.id],
        }}
      />,
    );

    const summary = screen.getByText("追加条件");
    const details = summary.closest("details");
    expect(details).toHaveAttribute("open");
    // 開いた状態から閉じ、再度開いても編集できる
    await user.click(summary);
    expect(details).not.toHaveAttribute("open");
    await user.click(summary);
    expect(details).toHaveAttribute("open");
    await user.selectOptions(screen.getByLabelText("献立全体の調理時間"), "30");
    expect(screen.getByLabelText("献立全体の調理時間")).toHaveValue("30");
  });

  it("戻るで1つ前の質問へ、変更後の次へで確認へ直行できる", async () => {
    const user = userEvent.setup();
    const reviewDraftFilled = {
      ...emptyDraft,
      mealType: "dinner" as const,
      mainIngredients: ["鶏肉"],
      cuisineGenre: "japanese" as const,
      targetMode: "household" as const,
      targetMemberIds: [eligibleMember.id],
    };
    render(<Harness initialStep="review" initialDraft={reviewDraftFilled} />);

    // 1ページずつ戻る（順送り用の戻る。編集モードではない）
    await user.click(screen.getByRole("button", { name: "戻る" }));
    expect(screen.getByRole("heading", { name: "4. 作る相手" })).toBeInTheDocument();

    // 再度 review へ進んで直接編集
    await user.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.getByRole("heading", { name: "5. 確認" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "メイン食材を変更" }));
    expect(screen.getByRole("heading", { name: "2. メイン食材" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "鶏肉を外す" })).toBeVisible();

    // 確認からの変更中は「確認に戻る」と表示し、3.ジャンルではなく 5.確認 へ戻る
    expect(screen.queryByRole("button", { name: "次へ" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "確認に戻る" }));
    expect(screen.getByRole("heading", { name: "5. 確認" })).toBeInTheDocument();
    expect(screen.getByText("鶏肉")).toBeVisible();
  });

  it("確認画面から食事・ジャンル・対象へ飛び、確認に戻るで復帰できる", async () => {
    const user = userEvent.setup();
    const draft = {
      ...emptyDraft,
      mealType: "dinner" as const,
      mainIngredients: ["鶏肉"],
      cuisineGenre: "japanese" as const,
      targetMode: "household" as const,
      targetMemberIds: [eligibleMember.id],
    };

    render(<Harness initialStep="review" initialDraft={draft} />);
    await user.click(screen.getByRole("button", { name: "食事を変更" }));
    expect(screen.getByRole("heading", { name: "1. 食事" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "夕食" })).toBeChecked();
    // 食事 step には編集中止用の「やめる」が出る
    await user.click(screen.getByRole("button", { name: "やめる" }));
    expect(screen.getByRole("heading", { name: "5. 確認" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ジャンルを変更" }));
    expect(screen.getByRole("heading", { name: "3. ジャンル" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "確認に戻る" }));
    expect(screen.getByRole("heading", { name: "5. 確認" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "対象を変更" }));
    expect(screen.getByRole("heading", { name: "4. 作る相手" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "確認に戻る" }));
    expect(screen.getByRole("heading", { name: "5. 確認" })).toBeInTheDocument();
  });

  it("P2: 確認からの「やめる」は audience 未完成なら review に戻さない", async () => {
    const user = userEvent.setup();
    const draft = {
      ...emptyDraft,
      mealType: "dinner" as const,
      mainIngredients: ["鶏肉"],
      cuisineGenre: "japanese" as const,
      targetMode: "household" as const,
      targetMemberIds: [eligibleMember.id],
    };

    render(<Harness initialStep="review" initialDraft={draft} />);
    await user.click(screen.getByRole("button", { name: "対象を変更" }));
    expect(screen.getByRole("heading", { name: "4. 作る相手" })).toBeInTheDocument();

    // 対象を外して incomplete にする
    await user.click(screen.getByRole("checkbox", { name: /^子ども/u }));
    expect(screen.getByRole("checkbox", { name: /^子ども/u })).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "やめる" }));
    // incomplete のまま review へ戻らない（P2）
    expect(screen.queryByRole("heading", { name: "5. 確認" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "4. 作る相手" })).toBeInTheDocument();
  });

  it("P2: 確認からの「やめる」は mainIngredients 空なら review に戻さない", async () => {
    const user = userEvent.setup();
    const draft = {
      ...emptyDraft,
      mealType: "dinner" as const,
      mainIngredients: ["鶏肉"],
      cuisineGenre: "japanese" as const,
      targetMode: "household" as const,
      targetMemberIds: [eligibleMember.id],
    };

    render(<Harness initialStep="review" initialDraft={draft} />);
    await user.click(screen.getByRole("button", { name: "メイン食材を変更" }));
    expect(screen.getByRole("heading", { name: "2. メイン食材" })).toBeInTheDocument();

    // クイック選択の押下済みチップを外して 0 件にする
    const chickenChip = screen.getByRole("button", { name: "鶏肉", pressed: true });
    await user.click(chickenChip);
    expect(chickenChip).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "やめる" }));
    // 空 ingredients のまま review へ戻らない（P2）
    expect(screen.queryByRole("heading", { name: "5. 確認" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "2. メイン食材" })).toBeInTheDocument();
  });

  it("P2: review で mainIngredients 空なら主 CTA を無効化する", () => {
    render(
      <Harness
        initialStep="review"
        initialDraft={{
          ...emptyDraft,
          mealType: "dinner",
          mainIngredients: [],
          cuisineGenre: "japanese",
          targetMode: "household",
          targetMemberIds: [eligibleMember.id],
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
  });

  it("P7: review で選択 ID が非 eligible なら主 CTA を無効化する", () => {
    render(
      <Harness
        initialStep="review"
        initialDraft={{
          ...emptyDraft,
          mealType: "dinner",
          mainIngredients: ["鶏肉"],
          cuisineGenre: "japanese",
          targetMode: "household",
          targetMemberIds: [eligibleMember.id],
        }}
        eligibleMembers={[]}
      />,
    );
    expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
  });

  it("追加条件は field 縦積みで狭幅でも崩れない構造を持つ", () => {
    render(
      <Harness
        initialStep="review"
        initialDraft={{
          ...emptyDraft,
          mealType: "dinner",
          mainIngredients: ["鶏肉"],
          cuisineGenre: "japanese",
          targetMode: "household",
          targetMemberIds: [eligibleMember.id],
        }}
      />,
    );

    const summary = screen.getByText("追加条件");
    const details = summary.closest("details");
    expect(details).toHaveClass("wizard-details");
    expect(details).toHaveAttribute("open");
    expect(summary.closest("summary")).toHaveClass("wizard-details-summary");
    expect(screen.getByText("（任意）")).toBeInTheDocument();

    // デフォルト展開済み。クリックで閉じない前提で構造だけ確認する
    const timeSelect = screen.getByLabelText("献立全体の調理時間");
    const timeLabel = timeSelect.closest("label");
    const body = timeLabel?.parentElement;
    expect(timeLabel).toHaveClass("field");
    expect(body).toHaveClass("stack", "wizard-details-body");
    expect(body).toContainElement(screen.getByLabelText("予算"));
    expect(body).toContainElement(screen.getByLabelText("材料の使い方"));
    expect(body).toContainElement(screen.getByLabelText("今回だけ避ける食材"));
    expect(body).toContainElement(screen.getByLabelText("自由メモ"));
  });

  it("追加条件の材料の使い方を選び draft に反映できる", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialStep="review"
        initialDraft={{
          ...emptyDraft,
          mealType: "dinner",
          mainIngredients: ["鶏肉"],
          cuisineGenre: "japanese",
          targetMode: "household",
          targetMemberIds: [eligibleMember.id],
        }}
      />,
    );

    // デフォルトで開いているので summary クリック不要
    const select = screen.getByLabelText("材料の使い方");
    expect(select).toHaveValue("");
    // 4 値 + 指定なし。文言は planner-labels と一致させる。
    const selectEl = select as HTMLSelectElement;
    expect(within(selectEl).getByRole("option", { name: "指定なし" })).toBeEnabled();
    expect(within(selectEl).getByRole("option", { name: "多め" })).toBeEnabled();
    expect(within(selectEl).getByRole("option", { name: "少な目" })).toBeEnabled();
    expect(
      within(selectEl).getByRole("option", {
        name: "メイン食材と冷蔵庫の食材を優先（買い足しを控えめに）",
      }),
    ).toBeEnabled();
    expect(
      within(selectEl).getByRole("option", {
        name: "おまかせ（分量・範囲はモデル判断）",
      }),
    ).toBeEnabled();

    await user.selectOptions(select, "more");
    expect(select).toHaveValue("more");
    await user.selectOptions(select, "selected_only");
    expect(select).toHaveValue("selected_only");
    await user.selectOptions(select, "less");
    expect(select).toHaveValue("less");
    await user.selectOptions(select, "auto");
    expect(select).toHaveValue("auto");
    // ヒントが accessible description に載る
    expect(select).toHaveAccessibleDescription(/調味料の基本/);
  });

  it("進行中 pending がある確認画面では新条件破棄の再開注意を出す (P2)", () => {
    render(
      <Harness initialStep="review" initialDraft={reviewDraft} hasResumablePendingGeneration />,
    );
    // 生成押下前に「新条件では作り直さない」ことを明示（generation resumed 案内と同趣旨）
    const notice = screen.getByText(/すでに作成中の献立があります。「献立を作る」を押すと/u);
    expect(notice).toBeVisible();
    expect(notice).toHaveAttribute("role", "status");
    expect(notice).toHaveTextContent(/いま入力した条件では新しく作り直さず/u);
    expect(notice).toHaveTextContent(/入力をリセット/u);
  });

  it("privacy未確認では説明ボタンを表示し、生成押下でダイアログへ誘導する", async () => {
    const user = userEvent.setup();
    const onOpenPrivacyNotice = vi.fn();
    const onSubmit = vi.fn(() => Promise.resolve());
    render(
      <Harness
        initialStep="review"
        initialDraft={reviewDraft}
        hasAcceptedOrDeclinedPrivacy={false}
        onOpenPrivacyNotice={onOpenPrivacyNotice}
        onSubmit={onSubmit}
      />,
    );
    const generate = screen.getByRole("button", { name: "献立を作る" });
    const privacy = screen.getByRole("button", { name: "AI情報の説明を見る" });
    expect(generate).toBeEnabled();
    expect(privacy).toBeEnabled();
    expect(privacy.className).toContain("ui-btn--secondary");
    await user.click(generate);
    expect(onSubmit).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog", { name: "AI情報の説明の確認" });
    expect(dialog).toHaveTextContent(
      "献立を作る前に、AI情報の説明を確認してください。「AI情報の説明を見る」を押してください。",
    );
    const dialogPrimary = within(dialog).getByRole("button", { name: "AI情報の説明を見る" });
    expect(dialogPrimary).toHaveFocus();
    await user.click(dialogPrimary);
    expect(onOpenPrivacyNotice).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("医療・治療食 free-text があるとき生成を止め、Plan 2 の拒否文言を表示する", () => {
    render(
      <Harness
        initialStep="review"
        initialDraft={{
          ...emptyDraft,
          mealType: "dinner",
          mainIngredients: ["離乳食"],
          cuisineGenre: "japanese",
          targetMode: "idea",
          servings: 2,
        }}
      />,
    );
    expect(
      screen.getByText(
        "離乳食、飲み込み・嚥下、治療食の依頼には対応できません。専門職の指示に従ってください。",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
  });

  it("P4: soft safety/pantry 失敗中は献立を作る CTA を disable する", () => {
    render(
      <Harness initialStep="review" initialDraft={reviewDraft} blockGenerationForStaleSafety />,
    );
    expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
  });

  it("idea 確認では家族安全未確認の案内と対象人数を表示する", () => {
    render(
      <Harness
        initialStep="review"
        initialDraft={{
          ...emptyDraft,
          mealType: "dinner",
          mainIngredients: ["鶏肉"],
          cuisineGenre: "japanese",
          targetMode: "idea",
          servings: 1,
        }}
      />,
    );
    expect(screen.getByText(/家族の年齢・アレルギーは確認されません/u)).toBeVisible();
    expect(screen.getByText("アイデア・1人分")).toBeVisible();
  });

  // 設計 §5.3: idea 注意は主操作「献立を作る」の直前。visible だけでは順序を固定できない。
  it("places idea safety note immediately before the generate primary action", () => {
    render(
      <Harness
        initialStep="review"
        initialDraft={{
          ...emptyDraft,
          mealType: "dinner",
          mainIngredients: ["鶏肉"],
          cuisineGenre: "japanese",
          targetMode: "idea",
          servings: 1,
        }}
      />,
    );
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(/家族の年齢・アレルギーは確認されません/);
    const generate = screen.getByRole("button", { name: "献立を作る" });
    expect(note.compareDocumentPosition(generate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // primary ボタン行（wizard-actions）の直前 sibling が note であること
    expect(generate.parentElement).toHaveClass("wizard-actions");
    expect(generate.parentElement?.previousElementSibling).toBe(note);
    // 注意枠トーン（平文と同色並びを避ける）
    expect(note).toHaveClass("review-idea-caution");
  });

  it("distinguishes review meta tones for season, usage, quality, and idea caution", () => {
    render(
      <Harness
        initialStep="review"
        initialDraft={{
          ...emptyDraft,
          mealType: "dinner",
          mainIngredients: ["鶏肉"],
          cuisineGenre: "japanese",
          targetMode: "idea",
          servings: 1,
        }}
        usageRemaining={3}
        plan="free"
      />,
    );
    expect(screen.getByText(/いまは.+の食材を優先して提案します/u).className).toMatch(
      /review-season-hint/,
    );
    expect(screen.getByText("無料版は本日あと3回まで献立の作成を受け付けます")).toHaveClass(
      "review-usage-status",
    );
    expect(screen.getByText("くわしく作る").closest("label")).toHaveClass("quality-mode-toggle");
    expect(screen.getByRole("note")).toHaveClass("review-idea-caution");
  });

  it("disables quality mode toggle on Free with Plus gate copy and link (L10-4)", () => {
    render(
      <Harness initialStep="review" initialDraft={reviewDraft} usageRemaining={3} plan="free" />,
    );
    // label 全文が accessible name になるため部分一致で取る
    const checkbox = screen.getByRole("checkbox", { name: /くわしく作る/u });
    expect(checkbox).toBeDisabled();
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText("くわしい AI での作成は Plus で使えます")).toBeVisible();
    expect(screen.getByText("くわしく作る").closest("label")).toHaveClass(
      "quality-mode-toggle--locked",
    );
    // 硬上限 CTA が無いので Plus を見るは品質リンク 1 本
    expect(screen.getByRole("link", { name: "Plus を見る" })).toHaveAttribute("href", "/plus");
  });

  it("enables quality mode toggle on Plus when quality.available", () => {
    render(
      <Harness
        initialStep="review"
        initialDraft={reviewDraft}
        usageRemaining={5}
        plan="plus"
        qualityAvailable
      />,
    );
    const checkbox = screen.getByRole("checkbox", { name: /くわしく作る/u });
    expect(checkbox).toBeEnabled();
    expect(screen.getByText(/Plus のくわしい AI で、より丁寧な献立を作ります/u)).toBeVisible();
    expect(screen.getByText("くわしく作る").closest("label")).not.toHaveClass(
      "quality-mode-toggle--locked",
    );
  });

  it("P5: Plus でも quality.available=false なら品質トグルをロックする", () => {
    render(
      <Harness
        initialStep="review"
        initialDraft={reviewDraft}
        usageRemaining={5}
        plan="plus"
        qualityAvailable={false}
      />,
    );
    const checkbox = screen.getByRole("checkbox", { name: /くわしく作る/u });
    expect(checkbox).toBeDisabled();
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText(/くわしい作成の回数の上限に達しました/u)).toBeVisible();
    expect(screen.queryByRole("link", { name: "Plus を見る" })).not.toBeInTheDocument();
  });

  it("避ける食材の件数超過は silent truncate せずエラー表示し生成を止める (P4)", () => {
    render(
      <Harness
        initialStep="review"
        initialDraft={{
          ...emptyDraft,
          mealType: "dinner",
          mainIngredients: ["鶏肉"],
          cuisineGenre: "japanese",
          targetMode: "household",
          targetMemberIds: [eligibleMember.id],
        }}
        usageRemaining={3}
        plan="free"
      />,
    );
    const input = screen.getByLabelText("今回だけ避ける食材");
    const tooMany = Array.from({ length: 21 }, (_, i) => `食材${String(i + 1)}`).join("、");
    fireEvent.change(input, { target: { value: tooMany } });
    expect(screen.getByRole("alert")).toHaveTextContent(/避ける食材は20件まで/u);
    expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
  });

  it("household 確認では現在の家族・安全条件の免責を表示する", () => {
    render(
      <Harness
        initialStep="review"
        initialDraft={{
          ...emptyDraft,
          mealType: "dinner",
          mainIngredients: ["鶏肉"],
          cuisineGenre: "japanese",
          targetMode: "household",
          targetMemberIds: [eligibleMember.id],
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "現在の家族・安全条件" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "AI生成だけでアレルギーの安全は保証できません。加工品の表示と家庭内の混入を確認してください。",
      ),
    ).toBeVisible();
  });

  it("P3: idea 確認でも共有安全免責を表示する", () => {
    render(
      <Harness
        initialStep="review"
        initialDraft={{
          ...emptyDraft,
          mealType: "dinner",
          mainIngredients: ["鶏肉"],
          cuisineGenre: "japanese",
          targetMode: "idea",
          servings: 1,
        }}
      />,
    );
    expect(
      screen.getByText(
        "AI生成だけでアレルギーの安全は保証できません。加工品の表示と家庭内の混入を確認してください。",
      ),
    ).toBeVisible();
    // 既存の idea note（主操作直前）は維持
    expect(screen.getByRole("note")).toHaveTextContent(/家族の年齢・アレルギーは確認されません/);
  });

  it("household 確認の安全条件は対象に選んだ家族だけを出す", () => {
    const otherMember: PlannerSafetyMember = {
      id: "70000000-0000-4000-8000-000000000099",
      displayName: "大人",
      ageBandLabel: "大人",
      allergyLabel: "卵アレルギー",
      safetyLabels: [],
      blockedReason: null,
    };
    render(
      <Harness
        initialStep="review"
        eligibleMembers={[eligibleMember, otherMember]}
        initialDraft={{
          ...emptyDraft,
          mealType: "dinner",
          mainIngredients: ["鶏肉"],
          cuisineGenre: "japanese",
          targetMode: "household",
          // 子どもだけが対象。大人は eligible でも要約に出さない。
          targetMemberIds: [eligibleMember.id],
        }}
      />,
    );
    const summary = screen.getByRole("region", { name: "現在の家族・安全条件" });
    expect(within(summary).getByText("子ども")).toBeVisible();
    expect(within(summary).queryByText("大人")).not.toBeInTheDocument();
    expect(within(summary).queryByText("卵アレルギー")).not.toBeInTheDocument();
    // 補助文は CurrentSafetySummary の外（sibling）に1回
    expect(screen.getByText(HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY)).toBeInTheDocument();
    expect(
      within(summary).queryByText(HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY),
    ).not.toBeInTheDocument();
  });

  it("household review shows helper even when zero selected members", () => {
    render(
      <Harness
        initialStep="review"
        initialDraft={{
          ...emptyDraft,
          mealType: "dinner",
          mainIngredients: ["鶏肉"],
          cuisineGenre: "japanese",
          targetMode: "household",
          targetMemberIds: [],
        }}
      />,
    );
    expect(screen.queryByRole("region", { name: "現在の家族・安全条件" })).not.toBeInTheDocument();
    expect(screen.getByText(HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY)).toBeInTheDocument();
  });

  it("idea review does not show helper", () => {
    render(
      <Harness
        initialStep="review"
        initialDraft={{
          ...emptyDraft,
          mealType: "dinner",
          mainIngredients: ["鶏肉"],
          cuisineGenre: "japanese",
          targetMode: "idea",
          targetMemberIds: [],
          servings: 2,
        }}
      />,
    );
    expect(screen.queryByText(HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY)).not.toBeInTheDocument();
  });

  it("保存失敗時は現在stepを維持する", () => {
    render(<Harness initialStep="review" error="献立条件を保存できませんでした。" />);
    expect(screen.getByRole("heading", { name: "5. 確認" })).toBeInTheDocument();
    expect(screen.getByText("献立条件を保存できませんでした。")).toBeInTheDocument();
  });

  it("autosave は右上トーストで出し idle では非表示、失敗時は再試行を載せる", () => {
    vi.useFakeTimers();
    const onRetryAutosave = vi.fn();
    const { rerender } = render(<Harness autosaveState="idle" />);
    // 浮遊トーストは idle では DOM に出さず、本文を押し下げない
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(document.querySelector(".autosave-toast")).toBeNull();

    rerender(<Harness autosaveState="saved" />);
    const saved = screen.getByRole("status");
    expect(saved).toHaveTextContent("保存しました");
    expect(saved).toHaveClass("autosave-toast", "autosave-toast--saved");

    // 約 3 秒で自動消去（親が saved のままでも消える）
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    rerender(<Harness autosaveState="saving" />);
    expect(screen.getByRole("status")).toHaveTextContent("保存中…");
    expect(screen.getByRole("status")).toHaveClass("autosave-toast--saving");
    // 保存中はタイマーで消さない
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("保存中…");

    rerender(<Harness autosaveState="error" onRetryAutosave={onRetryAutosave} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("保存できませんでした");
    expect(alert).toHaveClass("autosave-toast--error");
    expect(within(alert).getByRole("button", { name: "再試行" })).toHaveClass("min-h-11");
    // 失敗は自動消去しない（再試行が消えて未保存のまま進めるのを防ぐ）
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("保存できませんでした");
    expect(within(screen.getByRole("alert")).getByRole("button", { name: "再試行" })).toBeVisible();
    // idle に戻ったら消える
    rerender(<Harness autosaveState="idle" onRetryAutosave={onRetryAutosave} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("P12: 未確認期限切れ pantry では緊急 CTA を一次押下できない", () => {
    const expiredPantry: PantryItem = {
      id: "74000000-0000-4000-8000-000000000099",
      userId: eligibleMember.id,
      name: "古い豆腐",
      quantity: 1,
      unit: "丁",
      expiresOn: "2020-01-01",
      expirationType: "use_by",
      openedState: "opened",
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    const onOpenEmergencyMenus = vi.fn();
    render(
      <Harness
        initialStep="review"
        initialDraft={{
          ...reviewDraft,
          pantrySelections: [{ pantryItemId: expiredPantry.id, priority: "prefer_use" }],
        }}
        pantryItems={[expiredPantry]}
        onOpenEmergencyMenus={onOpenEmergencyMenus}
      />,
    );

    expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "期限切れの食材が選ばれています。冷蔵庫の食材で確認してから献立を作ってください。",
    );
  });

  it("review では緊急献立導線を出し、保存中は無効化する", async () => {
    const user = userEvent.setup();
    const onOpenEmergencyMenus = vi.fn();
    const { rerender } = render(
      <Harness
        initialStep="review"
        initialDraft={reviewDraft}
        onOpenEmergencyMenus={onOpenEmergencyMenus}
      />,
    );

    const emergency = screen.getByRole("button", { name: "AIを使わない緊急献立を見る" });
    expect(emergency).toBeEnabled();
    await user.click(emergency);
    expect(onOpenEmergencyMenus).toHaveBeenCalledTimes(1);

    // isSaving は親から制御されるため、同じ step のまま disabled だけ差し替える。
    rerender(
      <Harness
        initialStep="review"
        initialDraft={reviewDraft}
        isSaving
        onOpenEmergencyMenus={onOpenEmergencyMenus}
      />,
    );
    expect(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" })).toBeDisabled();
  });

  it("review に成功残（受け付け口調）のみ出し shortWindow では待ち文と CTA 無効", () => {
    // short/global のみでは常時 success 行を残す（設計 D-I1 / P-I2）
    render(
      <Harness
        initialStep="review"
        initialDraft={reviewDraft}
        usageRemaining={3}
        attemptsRemaining={5}
        shortWindowRetryAt="2026-07-25T05:10:00.000Z"
      />,
    );
    expect(screen.getByText("無料版は本日あと3回まで献立の作成を受け付けます")).toBeVisible();
    expect(screen.queryByText(/AIへの問い合わせ/u)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
    const limit = screen.getByRole("alert");
    expect(limit).toHaveTextContent("いまは新しい献立を作れません");
    expect(limit).toHaveTextContent(/少し待つ必要があります/u);
    expect(limit).toHaveClass("usage-limit-banner");
  });

  it("C-I12: 成功残 0 のとき主 CTA を止め作成上限メッセージを出す", () => {
    render(
      <Harness initialStep="review" initialDraft={reviewDraft} usageRemaining={0} plan="free" />,
    );
    expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
    const limit = screen.getByRole("alert");
    expect(limit).toHaveTextContent("いまは新しい献立を作れません");
    expect(limit).toHaveTextContent(
      "無料版は本日の作成上限に達しています。明日0:00（日本時間）以降にお試しください。",
    );
    expect(limit).not.toHaveTextContent("作成回数の上限");
    expect(limit).not.toHaveTextContent("0時");
    expect(limit).toHaveClass("usage-limit-banner");
    expect(screen.queryByText(/本日あと.*受け付けます/u)).not.toBeInTheDocument();
  });

  it("shows Plus hard-limit CTA when Free success remaining is 0", () => {
    render(
      <Harness
        initialStep="review"
        initialDraft={reviewDraft}
        usageRemaining={0}
        attemptsRemaining={3}
        plan="free"
      />,
    );
    expect(screen.getByText(/Plus なら 1 日最大 10 回まで作成できます/)).toBeVisible();
    // Free では品質リンクも出るため同名が 2 本。硬上限は data-testid で限定する（R-B2）
    const hard = screen.getByTestId("plus-hard-limit-cta");
    expect(within(hard).getByRole("link", { name: "Plus を見る" })).toHaveAttribute(
      "href",
      "/plus",
    );
    // 品質ゲート側も /plus
    expect(
      screen
        .getAllByRole("link", { name: "Plus を見る" })
        .every((a) => a.getAttribute("href") === "/plus"),
    ).toBe(true);
  });

  it("C10: isSaving 中は品質 Plus リンクが leave-flush せず stay", async () => {
    const user = userEvent.setup();
    const flush = vi.fn().mockResolvedValue("proceed" as const);
    registerPlannerLeaveFlush(flush);
    render(
      <Harness
        initialStep="review"
        initialDraft={reviewDraft}
        usageRemaining={3}
        plan="free"
        isSaving
      />,
    );

    const link = screen.getByRole("link", { name: "Plus を見る" });
    expect(link).toHaveAttribute("aria-disabled", "true");
    await user.click(link);
    expect(flush).not.toHaveBeenCalled();
  });

  it("C10: isSaving 中は硬上限 Plus CTA が leave-flush せず stay", async () => {
    const user = userEvent.setup();
    const flush = vi.fn().mockResolvedValue("proceed" as const);
    registerPlannerLeaveFlush(flush);
    render(
      <Harness
        initialStep="review"
        initialDraft={reviewDraft}
        usageRemaining={0}
        attemptsRemaining={3}
        plan="free"
        isSaving
      />,
    );

    const hard = screen.getByTestId("plus-hard-limit-cta");
    const link = within(hard).getByRole("link", { name: "Plus を見る" });
    expect(hard.parentElement).toHaveClass("opacity-50");
    await user.click(link);
    expect(flush).not.toHaveBeenCalled();
  });

  it("shows soft one-remaining line without hard sell", () => {
    render(
      <Harness
        initialStep="review"
        initialDraft={reviewDraft}
        usageRemaining={1}
        attemptsRemaining={3}
        plan="free"
      />,
    );
    expect(screen.getByText("本日の無料回数が残り 1 回です")).toBeVisible();
    expect(screen.queryByText(/Plus なら 1 日最大 10 回/)).not.toBeInTheDocument();
  });

  it("does not prefix Plus remaining copy with 無料版は", () => {
    render(
      <Harness
        initialStep="review"
        initialDraft={reviewDraft}
        usageRemaining={2}
        attemptsRemaining={5}
        plan="plus"
      />,
    );
    expect(screen.queryByText(/無料版は/)).not.toBeInTheDocument();
    expect(screen.getByText("本日あと2回まで献立の作成を受け付けます")).toBeVisible();
  });

  it("success0 and attempts0 together show only the creation-limit body", () => {
    render(
      <Harness
        initialStep="review"
        initialDraft={reviewDraft}
        usageRemaining={0}
        attemptsRemaining={0}
      />,
    );
    expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
    const limit = screen.getByRole("alert");
    expect(limit).toHaveTextContent("いまは新しい献立を作れません");
    expect(limit).toHaveTextContent(
      "無料版は本日の作成上限に達しています。明日0:00（日本時間）以降にお試しください。",
    );
    expect(limit).not.toHaveTextContent("受け付けられません");
    expect(limit).not.toHaveTextContent("問い合わせ");
  });

  it("C-I12 residual: attempts 残 0 のとき主 CTA を止め受付停止メッセージを出す", () => {
    render(
      <Harness
        initialStep="review"
        initialDraft={reviewDraft}
        usageRemaining={3}
        attemptsRemaining={0}
      />,
    );
    expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
    expect(screen.queryByText(/本日あと.*受け付けます/u)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "無料版は今日は新しい献立の作成を受け付けられません。明日0:00（日本時間）以降にお試しください。",
      ),
    ).toBeVisible();
    const limit = screen.getByRole("alert");
    expect(limit).toHaveTextContent("いまは新しい献立を作れません");
    expect(limit).not.toHaveTextContent("AIへの問い合わせ");
  });

  it("C-I12 residual: global 不可のとき主 CTA を止め混雑メッセージを出す（無料版接頭なし）", () => {
    render(
      <Harness
        initialStep="review"
        initialDraft={reviewDraft}
        usageRemaining={3}
        attemptsRemaining={5}
        globalAvailable={false}
      />,
    );
    expect(screen.getByText("無料版は本日あと3回まで献立の作成を受け付けます")).toBeVisible();
    expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
    expect(
      screen.getByText("ただいま混雑しています。明日0:00（日本時間）以降にお試しください。"),
    ).toBeVisible();
    expect(
      screen.queryByText(
        "無料版はただいま混雑しています。明日0:00（日本時間）以降にお試しください。",
      ),
    ).not.toBeInTheDocument();
    const limit = screen.getByRole("alert");
    expect(limit).toHaveTextContent("いまは新しい献立を作れません");
  });

  it("C-I12 residual: null の attempts/global では誤って主 CTA を止めない", () => {
    render(
      <Harness
        initialStep="review"
        initialDraft={reviewDraft}
        usageRemaining={3}
        attemptsRemaining={null}
        globalAvailable={null}
      />,
    );
    // attemptsRemaining === null は未取得。常時 success 行は出してよい（誤停止しない）
    expect(screen.getByText("無料版は本日あと3回まで献立の作成を受け付けます")).toBeVisible();
    expect(screen.queryByText(/AIへの問い合わせ/u)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "献立を作る" })).toBeEnabled();
  });

  it("I2: shortWindow 残 0（retryAt あり）では成功・attempt 残があっても主 CTA を止める", () => {
    // shortWindowRetryAt は planner-route が remaining===0 のときだけ渡す。
    // 端末時計での再有効化はせず、usage 再取得で retryAt が消えたときだけ有効に戻る。
    // short のみでは常時受け付け行が残る（設計 P-I2）
    render(
      <Harness
        initialStep="review"
        initialDraft={reviewDraft}
        usageRemaining={3}
        attemptsRemaining={5}
        globalAvailable={true}
        shortWindowRetryAt="2026-07-25T05:10:00.000Z"
      />,
    );
    expect(screen.getByText("無料版は本日あと3回まで献立の作成を受け付けます")).toBeVisible();
    expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
    const limit = screen.getByRole("alert");
    expect(limit).toHaveTextContent("いまは新しい献立を作れません");
    expect(limit).toHaveTextContent(/少し待つ必要があります/u);
  });

  it("idea の review では個人向け緊急献立 CTA を出す", () => {
    // 設計 §5 / Task 8: idea でも household と同じ secondary CTA。旧切替案内は出さない。
    render(
      <Harness
        initialStep="review"
        initialDraft={{
          ...reviewDraft,
          targetMode: "idea",
          targetMemberIds: [],
          servings: 2,
        }}
        onOpenEmergencyMenus={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" })).toBeVisible();
    expect(
      screen.queryByText(
        /家族向けの緊急献立は、対象を「家族に合わせて作る」に切り替えたあとで使えます/,
      ),
    ).not.toBeInTheDocument();
  });

  it("P2/P8: audience 未完成の review では生成・緊急 CTA を disable する", () => {
    const onOpenEmergencyMenus = vi.fn();
    render(
      <Harness
        initialStep="review"
        initialDraft={{
          ...reviewDraft,
          targetMode: "household",
          targetMemberIds: [],
        }}
        onOpenEmergencyMenus={onOpenEmergencyMenus}
      />,
    );
    expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" })).toBeDisabled();
  });

  it("P8: idea 人数未設定の review でも生成 CTA を disable する", () => {
    render(
      <Harness
        initialStep="review"
        initialDraft={{
          ...reviewDraft,
          targetMode: "idea",
          targetMemberIds: [],
          servings: null,
        }}
        onOpenEmergencyMenus={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" })).toBeDisabled();
  });

  it("meal など review 以外の step では緊急献立ボタンを出さない", () => {
    render(
      <Harness initialStep="meal" initialDraft={reviewDraft} onOpenEmergencyMenus={vi.fn()} />,
    );
    expect(
      screen.queryByRole("button", { name: "AIを使わない緊急献立を見る" }),
    ).not.toBeInTheDocument();
  });

  it("下書き競合中は入力を保持し明示解決ボタンだけを提供する", async () => {
    const user = userEvent.setup();
    const onResolveDraftConflict = vi.fn();
    const onOpenEmergencyMenus = vi.fn();
    render(
      <Harness
        initialStep="review"
        initialDraft={{ ...reviewDraft, memo: "Aの入力" }}
        isSaving
        hasDraftConflict
        canResolveDraftConflict
        onResolveDraftConflict={onResolveDraftConflict}
        onOpenEmergencyMenus={onOpenEmergencyMenus}
      />,
    );

    // 追加条件はデフォルト展開のため summary クリック不要
    expect(screen.getByLabelText("自由メモ")).toHaveValue("Aの入力");
    expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "AIを使わない緊急献立を見る" })).toBeDisabled();
    expect(
      screen.getByRole("heading", { name: "下書きが別の画面で更新されました" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "最新の下書きを読み込む" }));
    expect(onResolveDraftConflict).toHaveBeenCalledTimes(1);
    expect(onOpenEmergencyMenus).not.toHaveBeenCalled();
  });

  it("競合先の再取得失敗時は再試行を提供し解決ボタンを無効のままにする", async () => {
    const user = userEvent.setup();
    const onRetryDraftConflict = vi.fn();
    render(
      <Harness
        initialStep="review"
        initialDraft={{ ...reviewDraft, memo: "Aの入力" }}
        isSaving
        hasDraftConflict
        canResolveDraftConflict={false}
        draftConflictRefetchError
        onResolveDraftConflict={vi.fn()}
        onRetryDraftConflict={onRetryDraftConflict}
        onOpenEmergencyMenus={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("最新の下書きを取得できませんでした。");
    expect(screen.getByRole("button", { name: "最新の下書きを読み込む" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "再試行" }));
    expect(onRetryDraftConflict).toHaveBeenCalledTimes(1);
  });
});

/**
 * メイン食材クイック選択（Plan 9 Task 2）。
 * 候補トグル・自由入力・冷蔵庫は同じ mainIngredients 契約と Task 1 helper 経由であること、
 * accessible name「メイン食材」と DOM 表示順を壊さないことを固定する。
 */
describe("IngredientStep quick select", () => {
  function makePantryItem(name: string, id = "60000000-0000-4000-8000-000000000001"): PantryItem {
    return {
      id,
      userId: eligibleMember.id,
      name,
      quantity: null,
      unit: null,
      expiresOn: null,
      expirationType: null,
      openedState: null,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };
  }

  function expectDocumentOrder(earlier: HTMLElement, later: HTMLElement) {
    // 320px 折返し前提でも document order が UI 契約どおりであることを構造証拠にする
    expect(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }

  it("shows eight approved quick-select candidates under よく使う食材から選ぶ", () => {
    render(<Harness initialStep="ingredients" />);

    expect(screen.getByRole("heading", { name: "よく使う食材から選ぶ" })).toBeVisible();
    for (const name of commonMainIngredients) {
      const chip = screen.getByRole("button", { name });
      expect(chip).toBeVisible();
      expect(chip).toHaveAttribute("aria-pressed", "false");
    }
    expect(commonMainIngredients).toHaveLength(8);
  });

  it("toggles a quick-select candidate on then off via aria-pressed", async () => {
    const user = userEvent.setup();
    render(<Harness initialStep="ingredients" />);

    const chicken = screen.getByRole("button", { name: "鶏肉" });
    expect(chicken).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("選んだ食材（0/8）")).toBeVisible();

    await user.click(chicken);
    expect(screen.getByRole("button", { name: "鶏肉" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "鶏肉を外す" })).toBeVisible();
    expect(screen.getByText("選んだ食材（1/8）")).toBeVisible();

    // 同じ候補をもう一度押すと excludeCanonical 相当の解除になる
    await user.click(screen.getByRole("button", { name: "鶏肉" }));
    expect(screen.getByRole("button", { name: "鶏肉" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "鶏肉を外す" })).not.toBeInTheDocument();
    expect(screen.getByText("選んだ食材（0/8）")).toBeVisible();
  });

  it("marks a quick candidate selected when free input adds a canonical match", async () => {
    const user = userEvent.setup();
    render(<Harness initialStep="ingredients" />);

    // 全角空白付きでも NFKC+trim 後に候補「鶏肉」と一致する
    await user.type(screen.getByLabelText("メイン食材"), "　鶏肉　");
    await user.click(screen.getByRole("button", { name: "追加" }));

    expect(screen.getByRole("button", { name: "鶏肉" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "鶏肉を外す" })).toBeVisible();
    expect(screen.getByText("選んだ食材（1/8）")).toBeVisible();
  });

  it("does not duplicate when quick-selecting a pantry-added canonical match", async () => {
    const user = userEvent.setup();
    render(<Harness initialStep="ingredients" pantryItems={[makePantryItem("　鶏肉　")]} />);

    await user.click(screen.getByRole("button", { name: "鶏肉を追加" }));
    expect(screen.getByRole("button", { name: "鶏肉" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("button", { name: /を外す$/u })).toHaveLength(1);

    // 既選択のクイック候補を押すとトグル解除（重複追加にならない）
    await user.click(screen.getByRole("button", { name: "鶏肉" }));
    expect(screen.queryByRole("button", { name: "鶏肉を外す" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "鶏肉" })).toHaveAttribute("aria-pressed", "false");
  });

  it("disables pantry add when quick-selected and re-enables after toggle off", async () => {
    const user = userEvent.setup();
    render(<Harness initialStep="ingredients" pantryItems={[makePantryItem("鶏肉")]} />);

    const pantryAdd = screen.getByRole("button", { name: "鶏肉を追加" });
    expect(pantryAdd).not.toBeDisabled();

    await user.click(screen.getByRole("button", { name: "鶏肉" }));
    expect(screen.getByRole("button", { name: "鶏肉を追加" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "鶏肉" }));
    expect(screen.getByRole("button", { name: "鶏肉を追加" })).not.toBeDisabled();
  });

  it("at 8 items shows limit alert for unselected quick chips without disabling them", async () => {
    const user = userEvent.setup();
    const filled = Array.from({ length: 8 }, (_, index) => `食材${String(index + 1)}`);
    render(
      <Harness
        initialStep="ingredients"
        initialDraft={{ ...emptyDraft, mainIngredients: filled }}
      />,
    );

    expect(screen.getByText("選んだ食材（8/8）")).toBeVisible();
    const chicken = screen.getByRole("button", { name: "鶏肉" });
    expect(chicken).not.toBeDisabled();
    expect(chicken).toHaveAttribute("aria-pressed", "false");

    await user.click(chicken);

    expect(screen.getByRole("alert")).toHaveTextContent("メイン食材は8件までです。");
    expect(screen.getByRole("button", { name: "鶏肉" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByRole("button", { name: /を外す$/u })).toHaveLength(8);
    expect(screen.getByText("選んだ食材（8/8）")).toBeVisible();
    // 未選択候補を disabled にして解除不能にしない
    expect(screen.getByRole("button", { name: "鶏肉" })).not.toBeDisabled();
  });

  it("allows removing a selected quick candidate and remove-chip while at the 8-item limit", async () => {
    const user = userEvent.setup();
    // 鶏肉 + 7 件の埋めで上限。選択済み候補のトグル解除と「を外す」は常に可能
    const filled = ["鶏肉", ...Array.from({ length: 7 }, (_, index) => `食材${String(index + 1)}`)];
    render(
      <Harness
        initialStep="ingredients"
        initialDraft={{ ...emptyDraft, mainIngredients: filled }}
      />,
    );

    expect(screen.getByText("選んだ食材（8/8）")).toBeVisible();
    const chicken = screen.getByRole("button", { name: "鶏肉" });
    expect(chicken).toHaveAttribute("aria-pressed", "true");
    expect(chicken).not.toBeDisabled();

    await user.click(chicken);
    expect(screen.getByRole("button", { name: "鶏肉" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("選んだ食材（7/8）")).toBeVisible();

    // 再度選んでから選択済みチップ「を外す」でも解除できる
    await user.click(screen.getByRole("button", { name: "鶏肉" }));
    expect(screen.getByText("選んだ食材（8/8）")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "鶏肉を外す" }));
    expect(screen.getByRole("button", { name: "鶏肉" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("選んだ食材（7/8）")).toBeVisible();
  });

  it("disables quick chips, free input, and remove chips while saving", () => {
    render(
      <Harness
        initialStep="ingredients"
        initialDraft={{ ...emptyDraft, mainIngredients: ["鶏肉"] }}
        isSaving
      />,
    );

    expect(screen.getByRole("button", { name: "鶏肉" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "豚肉" })).toBeDisabled();
    expect(screen.getByLabelText("メイン食材")).toBeDisabled();
    expect(screen.getByRole("button", { name: "追加" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "鶏肉を外す" })).toBeDisabled();
  });

  it("keeps free-input accessible name メイン食材 and allows advancing to the next step", async () => {
    const user = userEvent.setup();
    render(<Harness initialStep="ingredients" />);

    expect(screen.getByRole("heading", { name: "一覧にない食材を入力" })).toBeVisible();
    const input = screen.getByLabelText("メイン食材");
    expect(input).toBeVisible();
    expect(screen.getByRole("button", { name: "追加" })).toBeVisible();

    await user.type(input, "アスパラ");
    await user.click(screen.getByRole("button", { name: "追加" }));
    await user.click(screen.getByRole("button", { name: "次へ" }));

    expect(screen.getByRole("heading", { name: "3. ジャンル" })).toBeInTheDocument();
  });

  it("shows toast and inline alert when next is pressed without any main ingredient", async () => {
    const user = userEvent.setup();
    render(<Harness initialStep="ingredients" />);

    const nextButton = screen.getByRole("button", { name: "次へ" });
    expect(nextButton).toBeEnabled();
    await user.click(nextButton);

    // empty alertdialog は廃止。toast + inline alert + textbox focus に統一
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("メイン食材を1つ以上選んでください");
    expect(screen.getByRole("status")).toHaveTextContent("メイン食材を1つ以上選んでください");
    expect(screen.getByRole("textbox")).toHaveFocus();
    // step は進めない
    expect(screen.getByRole("heading", { name: "2. メイン食材" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "3. ジャンル" })).not.toBeInTheDocument();
  });

  it("suppresses validation toast on incomplete next while autosaveState is error", async () => {
    const user = userEvent.setup();
    render(<Harness autosaveState="error" onRetryAutosave={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "次へ" }));

    // autosave error の alert と incomplete inline が併存し得る（設計の受け入れ済み残留）
    // validation toast（status）は出さない
    expect(screen.getByText("食事の時間帯を選んでください")).toBeVisible();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("radiogroup").querySelector("input:not([disabled])")).toHaveFocus();
  });

  it("does not change pantrySelections when selecting a quick candidate", async () => {
    const user = userEvent.setup();
    const pantryItem = makePantryItem("玉ねぎ", "60000000-0000-4000-8000-000000000099");
    render(
      <Harness
        initialStep="ingredients"
        initialDraft={{
          ...emptyDraft,
          pantrySelections: [{ pantryItemId: pantryItem.id, priority: "must_use" }],
        }}
        pantryItems={[pantryItem]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "鶏肉" }));
    expect(screen.getByRole("button", { name: "鶏肉を外す" })).toBeVisible();

    // 確認画面まで進み、既存の pantrySelections（必ず使う）がクイック選択で消えないことを確認する
    await user.click(screen.getByRole("button", { name: "次へ" }));
    await user.click(screen.getByRole("radio", { name: "和食" }));
    await user.click(screen.getByRole("button", { name: "次へ" }));
    await user.click(screen.getByRole("radio", { name: "家族に合わせて作る" }));
    await user.click(screen.getByRole("checkbox", { name: /^子ども/u }));
    await user.click(screen.getByRole("button", { name: "次へ" }));

    expect(screen.getByRole("checkbox", { name: /玉ねぎ/u })).toBeChecked();
  });

  it("keeps document order: quick select → selected → free input → pantry → next", () => {
    render(<Harness initialStep="ingredients" pantryItems={[makePantryItem("玉ねぎ")]} />);

    const quickHeading = screen.getByRole("heading", { name: "よく使う食材から選ぶ" });
    const selectedLabel = screen.getByText("選んだ食材（0/8）");
    const freeHeading = screen.getByRole("heading", { name: "一覧にない食材を入力" });
    const pantryHeading = screen.getByRole("heading", { name: "冷蔵庫から選ぶ" });
    const nextButton = screen.getByRole("button", { name: "次へ" });

    expectDocumentOrder(quickHeading, selectedLabel);
    expectDocumentOrder(selectedLabel, freeHeading);
    expectDocumentOrder(freeHeading, pantryHeading);
    expectDocumentOrder(pantryHeading, nextButton);

    // 自由入力の accessible name は見出しではなく label「メイン食材」のまま
    expect(screen.getByLabelText("メイン食材")).toBeVisible();
    // クイック候補は chip 行に並ぶ（折返し用の構造クラス）
    const chicken = screen.getByRole("button", { name: "鶏肉" });
    expect(chicken.closest(".wizard-chip-row")).not.toBeNull();
    expect(
      within(chicken.closest(".wizard-chip-row") as HTMLElement).getByRole("button", {
        name: "豆腐",
      }),
    ).toBeVisible();
  });

  /**
   * Plan 9 Task 3: キーボード操作の a11y 証拠。
   * E2E の Tab 連鎖は step 見出しの初期 focus と auth fixture 依存で不安定なため、
   * 候補 button の Enter/Space トグルは component テストで固定する。
   */
  it("selects and deselects a quick-select chip with keyboard Enter", async () => {
    const user = userEvent.setup();
    render(<Harness initialStep="ingredients" />);

    const chicken = screen.getByRole("button", { name: "鶏肉" });
    expect(chicken).toHaveAttribute("aria-pressed", "false");

    chicken.focus();
    expect(chicken).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("button", { name: "鶏肉" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "鶏肉を外す" })).toBeVisible();
    expect(screen.getByText("選んだ食材（1/8）")).toBeVisible();

    // Space でもトグル解除できる（button の既定アクティベーション）
    screen.getByRole("button", { name: "鶏肉" }).focus();
    await user.keyboard(" ");

    expect(screen.getByRole("button", { name: "鶏肉" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "鶏肉を外す" })).not.toBeInTheDocument();
    expect(screen.getByText("選んだ食材（0/8）")).toBeVisible();
  });

  it("keeps focus on the quick-select chip after keyboard select (does not jump to step heading or 次へ)", async () => {
    const user = userEvent.setup();
    render(<Harness initialStep="ingredients" />);

    // マウント時の見出し focus が落ち着いた後に候補へ移動する
    const chicken = screen.getByRole("button", { name: "鶏肉" });
    chicken.focus();
    expect(chicken).toHaveFocus();

    await user.keyboard("{Enter}");

    const selectedChicken = screen.getByRole("button", { name: "鶏肉" });
    expect(selectedChicken).toHaveAttribute("aria-pressed", "true");
    // 選択後に focus が step 見出しや「次へ」へ飛ばないこと（チップ上に留まる）
    expect(selectedChicken).toHaveFocus();
    expect(screen.getByRole("heading", { name: "2. メイン食材" })).not.toHaveFocus();
    expect(screen.getByRole("button", { name: "次へ" })).not.toHaveFocus();
  });
});

describe("buildPlannerSubmissionFieldErrors", () => {
  it("mainIngredients.0のような配列indexをroot fieldへ正規化する", () => {
    const result = buildPlannerSubmissionFieldErrors([
      { path: ["mainIngredients", 0], message: "メイン食材が不正です" },
    ]);
    expect(result.fieldErrors.mainIngredients).toBe("メイン食材が不正です");
    expect(result.firstInvalidField).toBe("mainIngredients");
    expect(result.firstInvalidStep).toBe("ingredients");
  });

  it("複数issueでは質問順の最初のinvalid fieldをfirstInvalidFieldにする", () => {
    const result = buildPlannerSubmissionFieldErrors([
      { path: ["memo"], message: "メモが不正です" },
      { path: ["mealType"], message: "食事を選んでください" },
      { path: ["targetMemberIds"], message: "家族を選んでください" },
    ]);
    expect(result.firstInvalidField).toBe("mealType");
    expect(result.firstInvalidStep).toBe("meal");
  });

  it("未知pathはnullにし、summary/field-localどちらにも出さない", () => {
    const result = buildPlannerSubmissionFieldErrors([
      { path: ["unknownField"], message: "不明なフィールド" },
    ]);
    expect(result.fieldErrors).toEqual({});
    expect(result.firstInvalidField).toBeNull();
    expect(result.firstInvalidStep).toBeNull();
  });
});
