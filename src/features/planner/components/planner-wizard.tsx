import { useRef, useState } from "react";
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
  /** Plan 2 §5: 下書き競合中はローカル入力を保持し、明示解決UIだけを出す */
  hasDraftConflict?: boolean;
  draftConflictRefetchError?: boolean;
  canResolveDraftConflict?: boolean;
  onResolveDraftConflict?: () => void;
  onRetryDraftConflict?: () => void;
  /** 設計 §5.1: review からの緊急献立導線。route が flush→navigate を所有する */
  onOpenEmergencyMenus?: () => void;
  /**
   * idea 対象を audience で確定したときの onboarding skipped 書込。
   * 成功時のみ resolve。失敗は throw し、wizard は step を進めない。
   */
  onIdeaAudienceConfirmed?: () => Promise<void>;
};

/**
 * brief記載のPlannerWizardProps + review stepが必要とする追加情報（冷蔵庫・privacy）
 * を受け取る合成props。DB/APIを直接呼ばず、値変更とstep遷移だけを親（route層）へ通知する。
 */
export type PlannerWizardComponentProps = PlannerWizardProps & PlannerWizardExtraProps;

/**
 * 競合検知中の明示解決 chrome。取得完了だけでは value を置換せず、
 * 「最新の下書きを読み込む」押下後にだけ親の resolve を呼ぶ。
 */
function DraftConflictChrome({
  draftConflictRefetchError,
  canResolveDraftConflict,
  onResolveDraftConflict,
  onRetryDraftConflict,
}: {
  draftConflictRefetchError: boolean;
  canResolveDraftConflict: boolean;
  onResolveDraftConflict?: () => void;
  onRetryDraftConflict?: () => void;
}) {
  return (
    <section className="card stack" aria-labelledby="draft-conflict-title">
      <h2 id="draft-conflict-title">下書きが別の画面で更新されました</h2>
      <p>現在の入力を保持しています。内容を確認してから最新の下書きを読み込んでください。</p>
      {draftConflictRefetchError && (
        <>
          <p role="alert">最新の下書きを取得できませんでした。</p>
          {onRetryDraftConflict !== undefined && (
            <button type="button" onClick={onRetryDraftConflict}>
              再試行
            </button>
          )}
        </>
      )}
      <button type="button" disabled={!canResolveDraftConflict} onClick={onResolveDraftConflict}>
        最新の下書きを読み込む
      </button>
    </section>
  );
}

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
  hasDraftConflict = false,
  draftConflictRefetchError = false,
  canResolveDraftConflict = false,
  onResolveDraftConflict,
  onRetryDraftConflict,
  onOpenEmergencyMenus,
  onIdeaAudienceConfirmed,
}: PlannerWizardComponentProps) {
  // このref自体はfocus対象を探すためだけに使い、値そのものは保持しない。
  const containerRef = useRef<HTMLElement>(null);
  // idea audience 確定の single-flight。ref は同期ガード、state は disabled 表示用。
  const confirmingIdeaAudienceRef = useRef(false);
  const [confirmingIdeaAudience, setConfirmingIdeaAudience] = useState(false);

  const goToStep = (next: (typeof plannerSteps)[number]): void => {
    onStepChange(next);
  };

  // exactOptionalPropertyTypes: undefined を明示代入せず、定義済みキーだけ渡す。
  const conflictChrome = hasDraftConflict ? (
    <DraftConflictChrome
      draftConflictRefetchError={draftConflictRefetchError}
      canResolveDraftConflict={canResolveDraftConflict}
      {...(onResolveDraftConflict !== undefined ? { onResolveDraftConflict } : {})}
      {...(onRetryDraftConflict !== undefined ? { onRetryDraftConflict } : {})}
    />
  ) : null;

  // 各 step を <main> で包み、シェル外でも region / main ランドマーク契約を満たす。
  // AppShell 配下でも main はページ本文として1つ（nav は別ランドマーク）になる。
  if (step === "meal") {
    return (
      <main ref={containerRef} className="page-frame stack guided-planner-theme">
        {conflictChrome}
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
      </main>
    );
  }
  if (step === "ingredients") {
    return (
      <main ref={containerRef} className="page-frame stack guided-planner-theme">
        {conflictChrome}
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
      </main>
    );
  }
  if (step === "cuisine") {
    return (
      <main ref={containerRef} className="page-frame stack guided-planner-theme">
        {conflictChrome}
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
      </main>
    );
  }
  if (step === "audience") {
    return (
      <main ref={containerRef} className="page-frame stack guided-planner-theme">
        {conflictChrome}
        <AudienceStep
          value={{
            targetMode: draft.targetMode,
            targetMemberIds: draft.targetMemberIds,
            servings: draft.servings,
          }}
          onChange={(audience) => {
            // 確定中は mode/人数の変更を捨てる（await 中に household へ戻して二重確定を避ける）
            if (confirmingIdeaAudienceRef.current) return;
            onDraftChange({
              ...draft,
              ...audience,
              targetMemberIds: [...audience.targetMemberIds],
            });
          }}
          onBack={() => {
            if (confirmingIdeaAudienceRef.current) return;
            goToStep("cuisine");
          }}
          onNext={() => {
            // idea 確定は route の skipped 書込を await。失敗時は audience に留まる。
            // ref は await 前に同期で立て、disabled 再描画前の double-click を塞ぐ。
            if (confirmingIdeaAudienceRef.current) return;
            if (draft.targetMode === "idea" && onIdeaAudienceConfirmed !== undefined) {
              confirmingIdeaAudienceRef.current = true;
              setConfirmingIdeaAudience(true);
              void (async () => {
                try {
                  await onIdeaAudienceConfirmed();
                } catch {
                  confirmingIdeaAudienceRef.current = false;
                  setConfirmingIdeaAudience(false);
                  return;
                }
                confirmingIdeaAudienceRef.current = false;
                setConfirmingIdeaAudience(false);
                goToStep("review");
              })();
              return;
            }
            goToStep("review");
          }}
          disabled={isSaving || confirmingIdeaAudience}
          eligibleMembers={eligibleMembers}
          fieldErrors={{
            targetMode: fieldErrors.targetMode ?? null,
            targetMemberIds: fieldErrors.targetMemberIds ?? null,
            servings: fieldErrors.servings ?? null,
          }}
        />
        {error !== null && <p role="alert">{error}</p>}
      </main>
    );
  }
  // review
  return (
    <main ref={containerRef} className="page-frame stack guided-planner-theme">
      {conflictChrome}
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
        {...(onOpenEmergencyMenus !== undefined ? { onOpenEmergencyMenus } : {})}
        onSubmit={() => {
          void onSubmit();
        }}
      />
    </main>
  );
}
