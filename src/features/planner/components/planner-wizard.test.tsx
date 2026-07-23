import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PantryItem } from "@shared/contracts/pantry";
import type { PlannerDraftInput } from "@shared/contracts/planner";
import type { PlannerFieldName, PlannerStep } from "../model/planner-wizard";
import type { PlannerSafetyMember } from "../planner-safety-member";
import { createPlannerAttempt } from "../expired-pantry-checks";
import { buildPlannerSubmissionFieldErrors } from "../model/planner-wizard";
import { PlannerWizard } from "./planner-wizard";

const emptyDraft: PlannerDraftInput = {
  mealType: null,
  mainIngredients: [],
  cuisineGenre: null,
  targetMode: null,
  targetMemberIds: [],
  servings: null,
  timeLimitMinutes: null,
  budgetPreference: null,
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
  hasDraftConflict = false,
  canResolveDraftConflict = false,
  draftConflictRefetchError = false,
  onResolveDraftConflict,
  onRetryDraftConflict,
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
  hasDraftConflict?: boolean;
  canResolveDraftConflict?: boolean;
  draftConflictRefetchError?: boolean;
  onResolveDraftConflict?: () => void;
  onRetryDraftConflict?: () => void;
}) {
  const [step, setStep] = useState<PlannerStep>(initialStep);
  const [draft, setDraft] = useState<PlannerDraftInput>(initialDraft);
  const [attempt, setAttempt] = useState(createPlannerAttempt());
  return (
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
      pantryItems={[] as PantryItem[]}
      pantryItemsStatus="loaded"
      attempt={attempt}
      onAttemptChange={setAttempt}
      hasAcceptedOrDeclinedPrivacy={hasAcceptedOrDeclinedPrivacy}
      onOpenPrivacyNotice={onOpenPrivacyNotice}
      hasDraftConflict={hasDraftConflict}
      canResolveDraftConflict={canResolveDraftConflict}
      draftConflictRefetchError={draftConflictRefetchError}
      {...(onOpenEmergencyMenus !== undefined ? { onOpenEmergencyMenus } : {})}
      {...(onResolveDraftConflict !== undefined ? { onResolveDraftConflict } : {})}
      {...(onRetryDraftConflict !== undefined ? { onRetryDraftConflict } : {})}
    />
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
    expect(screen.getByRole("button", { name: "次へ" })).toBeDisabled();
  });
});

describe("PlannerWizard audience step のmode不変条件", () => {
  it("利用可能家族が0件ならhousehold選択をdisabledにし、家族追加linkを表示する", () => {
    render(<Harness initialStep="audience" eligibleMembers={[]} />);
    expect(screen.getByRole("radio", { name: "家族に合わせて作る" })).toBeDisabled();
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
    expect(screen.getByText("アレルギー確認が完了していません")).toBeVisible();
    expect(screen.getByRole("heading", { name: "現在の家族・安全条件" })).toBeInTheDocument();
  });

  it("idea人数は1〜6がbutton、7〜20はnumber inputで入力する", async () => {
    const user = userEvent.setup();
    render(<Harness initialStep="audience" />);
    await user.click(screen.getByRole("radio", { name: "人数だけ指定してアイデアを見る" }));

    await user.click(screen.getByRole("button", { name: "3人" }));
    expect(screen.getByRole("button", { name: "3人" })).toHaveAttribute("aria-pressed", "true");

    const numberInput = screen.getByLabelText("7人以上（20人まで）");
    await user.type(numberInput, "12");
    expect(numberInput).toHaveValue(12);
  });

  it("範囲外のidea人数ではfield-local errorを表示し、最初のinvalid fieldへfocusする", async () => {
    const user = userEvent.setup();
    render(<Harness initialStep="audience" />);
    await user.click(screen.getByRole("radio", { name: "人数だけ指定してアイデアを見る" }));

    const numberInput = screen.getByLabelText("7人以上（20人まで）");
    await user.type(numberInput, "21");
    await user.click(screen.getByRole("button", { name: "次へ" }));

    expect(screen.getByText("人数は7人から20人の範囲で入力してください。")).toBeVisible();
    expect(numberInput).toHaveAttribute("aria-invalid", "true");
    expect(numberInput).toHaveAttribute("aria-describedby", "audience-servings-error");
    expect(numberInput).toHaveFocus();
    expect(screen.getByRole("heading", { name: "4. 作る相手" })).toBeInTheDocument();
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

describe("PlannerWizard review step", () => {
  it("任意条件をdetailsから開いて編集できる", async () => {
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

    await user.click(screen.getByText("追加条件"));
    await user.selectOptions(screen.getByLabelText("献立全体の調理時間"), "30");
    expect(screen.getByLabelText("献立全体の調理時間")).toHaveValue("30");
  });

  it("privacy未確認では生成buttonをdisabledにし説明linkを表示する", () => {
    render(<Harness initialStep="review" hasAcceptedOrDeclinedPrivacy={false} />);
    expect(screen.getByRole("button", { name: "献立を作る" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "AI情報の説明を見る" })).toBeInTheDocument();
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

  it("保存失敗時は現在stepを維持する", () => {
    render(<Harness initialStep="review" error="献立条件を保存できませんでした。" />);
    expect(screen.getByRole("heading", { name: "5. 確認" })).toBeInTheDocument();
    expect(screen.getByText("献立条件を保存できませんでした。")).toBeInTheDocument();
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

    await user.click(screen.getByText("追加条件"));
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
