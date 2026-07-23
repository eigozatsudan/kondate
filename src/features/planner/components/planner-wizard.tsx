import { useRef } from "react";
import type { PlannerAttempt } from "../expired-pantry-checks";
import type { PantryItemsStatus } from "../pantry-selector";
import type { PantryItem } from "@shared/contracts/pantry";
import { plannerSteps, type PlannerFieldName } from "../model/planner-wizard";
import { AudienceStep } from "./audience-step";
import { CuisineStep } from "./cuisine-step";
import { IngredientStep } from "./ingredient-step";
import { MealStep } from "./meal-step";
import type { PlannerWizardProps } from "./planner-wizard-props";
import { ReviewStep } from "./review-step";
import type { ReviewFieldErrors } from "./review-step";

/**
 * exactOptionalPropertyTypes下ではundefinedを明示的に持つプロパティを
 * オプショナル型へ代入できないため、値が定義されているキーだけを
 * 抽出してReviewFieldErrorsを組み立てる。
 */
function buildReviewFieldErrors(
  fieldErrors: Partial<Record<PlannerFieldName, string>>,
): ReviewFieldErrors {
  const result: ReviewFieldErrors = {};
  if (fieldErrors.timeLimitMinutes !== undefined)
    result.timeLimitMinutes = fieldErrors.timeLimitMinutes;
  if (fieldErrors.budgetPreference !== undefined)
    result.budgetPreference = fieldErrors.budgetPreference;
  if (fieldErrors.avoidIngredients !== undefined)
    result.avoidIngredients = fieldErrors.avoidIngredients;
  if (fieldErrors.memo !== undefined) result.memo = fieldErrors.memo;
  if (fieldErrors.pantrySelections !== undefined)
    result.pantrySelections = fieldErrors.pantrySelections;
  return result;
}

export type PlannerWizardExtraProps = {
  pantryItems: readonly PantryItem[];
  pantryItemsStatus: PantryItemsStatus;
  attempt: PlannerAttempt;
  onAttemptChange: (next: PlannerAttempt) => void;
  hasAcceptedOrDeclinedPrivacy: boolean;
  onOpenPrivacyNotice: () => void;
};

/**
 * brief記載のPlannerWizardProps + review stepが必要とする追加情報（冷蔵庫・privacy）
 * を受け取る合成props。DB/APIを直接呼ばず、値変更とstep遷移だけを親（route層）へ通知する。
 */
export type PlannerWizardComponentProps = PlannerWizardProps & PlannerWizardExtraProps;

export function PlannerWizard({
  draft,
  step,
  eligibleMembers,
  isSaving,
  error,
  fieldErrors,
  onDraftChange,
  onStepChange,
  onSubmit,
  pantryItems,
  pantryItemsStatus,
  attempt,
  onAttemptChange,
  hasAcceptedOrDeclinedPrivacy,
  onOpenPrivacyNotice,
}: PlannerWizardComponentProps) {
  // このref自体はfocus対象を探すためだけに使い、値そのものは保持しない。
  const containerRef = useRef<HTMLDivElement>(null);

  const goToStep = (next: (typeof plannerSteps)[number]): void => {
    onStepChange(next);
  };

  if (step === "meal") {
    return (
      <div ref={containerRef}>
        <MealStep
          value={draft.mealType}
          onChange={(mealType) => {
            onDraftChange({ ...draft, mealType });
          }}
          onNext={() => {
            goToStep("ingredients");
          }}
          disabled={isSaving}
          errorMessage={fieldErrors.mealType ?? null}
        />
        {error !== null && <p role="alert">{error}</p>}
      </div>
    );
  }
  if (step === "ingredients") {
    return (
      <div ref={containerRef}>
        <IngredientStep
          value={draft.mainIngredients}
          onChange={(mainIngredients) => {
            onDraftChange({ ...draft, mainIngredients: [...mainIngredients] });
          }}
          onBack={() => {
            goToStep("meal");
          }}
          onNext={() => {
            goToStep("cuisine");
          }}
          disabled={isSaving}
          errorMessage={fieldErrors.mainIngredients ?? null}
        />
        {error !== null && <p role="alert">{error}</p>}
      </div>
    );
  }
  if (step === "cuisine") {
    return (
      <div ref={containerRef}>
        <CuisineStep
          value={draft.cuisineGenre}
          onChange={(cuisineGenre) => {
            onDraftChange({ ...draft, cuisineGenre });
          }}
          onBack={() => {
            goToStep("ingredients");
          }}
          onNext={() => {
            goToStep("audience");
          }}
          disabled={isSaving}
          errorMessage={fieldErrors.cuisineGenre ?? null}
        />
        {error !== null && <p role="alert">{error}</p>}
      </div>
    );
  }
  if (step === "audience") {
    return (
      <div ref={containerRef}>
        <AudienceStep
          value={{
            targetMode: draft.targetMode,
            targetMemberIds: draft.targetMemberIds,
            servings: draft.servings,
          }}
          onChange={(audience) => {
            onDraftChange({
              ...draft,
              ...audience,
              targetMemberIds: [...audience.targetMemberIds],
            });
          }}
          onBack={() => {
            goToStep("cuisine");
          }}
          onNext={() => {
            goToStep("review");
          }}
          disabled={isSaving}
          eligibleMembers={eligibleMembers}
          fieldErrors={{
            targetMode: fieldErrors.targetMode ?? null,
            targetMemberIds: fieldErrors.targetMemberIds ?? null,
            servings: fieldErrors.servings ?? null,
          }}
        />
        {error !== null && <p role="alert">{error}</p>}
      </div>
    );
  }
  // review
  return (
    <div ref={containerRef}>
      <ReviewStep
        value={draft}
        onChange={(next) => {
          onDraftChange(next);
        }}
        onBack={() => {
          goToStep("audience");
        }}
        onNext={() => {
          // review step自体には「次へ」はなく、明示的な献立生成buttonがonSubmitを呼ぶ。
        }}
        disabled={isSaving}
        pantryItems={pantryItems}
        pantryItemsStatus={pantryItemsStatus}
        attempt={attempt}
        onAttemptChange={onAttemptChange}
        fieldErrors={buildReviewFieldErrors(fieldErrors)}
        summaryError={error}
        hasAcceptedOrDeclinedPrivacy={hasAcceptedOrDeclinedPrivacy}
        onOpenPrivacyNotice={onOpenPrivacyNotice}
        safetyMembers={eligibleMembers}
        onSubmit={() => {
          void onSubmit();
        }}
      />
    </div>
  );
}
