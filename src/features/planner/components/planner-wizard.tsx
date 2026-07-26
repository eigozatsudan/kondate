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
  /** 入力内容を空に戻し step を meal へ戻す。route が draft / autosave を所有する */
  onReset?: () => void;
  /** 設計 §10.3: review の生成ボタン近くに出す成功残数（未取得は null） */
  usageRemaining?: number | null;
  /** short-window 残 0 時の再開時刻 ISO（未該当は null） */
  shortWindowRetryAt?: string | null;
  /** 下書き autosave の短い状態表示（C-I9） */
  autosaveState?: "idle" | "saving" | "saved" | "error";
  /** autosave 失敗時の再試行（flush） */
  onRetryAutosave?: () => void;
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
  onReset,
  usageRemaining = null,
  shortWindowRetryAt = null,
  autosaveState = "idle",
  onRetryAutosave,
}: PlannerWizardComponentProps) {
  // このref自体はfocus対象を探すためだけに使い、値そのものは保持しない。
  const containerRef = useRef<HTMLElement>(null);
  // idea audience 確定の single-flight。ref は同期ガード、state は disabled 表示用。
  const confirmingIdeaAudienceRef = useRef(false);
  const [confirmingIdeaAudience, setConfirmingIdeaAudience] = useState(false);
  // 確認画面の「変更」から飛んだとき true。次へ／戻るで確認へ直行する。
  const [returnToReviewAfterEdit, setReturnToReviewAfterEdit] = useState(false);

  const goToStep = (next: (typeof plannerSteps)[number]): void => {
    onStepChange(next);
  };

  /** 通常の順送り先。確認からの編集中なら review へ戻す。 */
  const advanceFromEditOr = (sequentialNext: (typeof plannerSteps)[number]): void => {
    if (returnToReviewAfterEdit) {
      setReturnToReviewAfterEdit(false);
      goToStep("review");
      return;
    }
    goToStep(sequentialNext);
  };

  /** 通常の戻り先。確認からの編集中なら review へ戻す（編集をやめる）。 */
  const backFromEditOr = (sequentialBack: (typeof plannerSteps)[number]): void => {
    if (returnToReviewAfterEdit) {
      setReturnToReviewAfterEdit(false);
      goToStep("review");
      return;
    }
    goToStep(sequentialBack);
  };

  // 確認の「変更」経由時だけボタン文言を差し替え、順送りの「次へ」と混同させない。
  const editReturnActionLabels = returnToReviewAfterEdit
    ? { nextLabel: "確認に戻る", backLabel: "やめる" }
    : {};

  // exactOptionalPropertyTypes: undefined を明示代入せず、定義済みキーだけ渡す。
  const conflictChrome = hasDraftConflict ? (
    <DraftConflictChrome
      draftConflictRefetchError={draftConflictRefetchError}
      canResolveDraftConflict={canResolveDraftConflict}
      {...(onResolveDraftConflict !== undefined ? { onResolveDraftConflict } : {})}
      {...(onRetryDraftConflict !== undefined ? { onRetryDraftConflict } : {})}
    />
  ) : null;

  // 競合 chrome とは別に、debounce 保存の成否を短く出す（C-I9 / MVP §7.2）
  const autosaveChrome =
    autosaveState === "saving" ? (
      <p role="status" className="type-small">
        保存中…
      </p>
    ) : autosaveState === "saved" ? (
      <p role="status" className="type-small">
        保存しました
      </p>
    ) : autosaveState === "error" ? (
      <div className="stack" role="alert">
        <p className="error-message">下書きを保存できませんでした。</p>
        {onRetryAutosave !== undefined && (
          <button type="button" className="secondary-button min-h-11" onClick={onRetryAutosave}>
            再試行
          </button>
        )}
      </div>
    ) : null;

  const resetChrome =
    onReset !== undefined ? (
      <div className="wizard-reset-row">
        <button
          className="wizard-reset-button"
          type="button"
          disabled={isSaving}
          onClick={() => {
            // 誤タップで下書きを消さないよう、ブラウザ確認後にだけ route へ委譲する
            if (
              typeof window !== "undefined" &&
              !window.confirm(
                "入力した献立条件をすべて消して最初からやり直します。よろしいですか？",
              )
            ) {
              return;
            }
            onReset();
          }}
        >
          {/* 破壊的操作なので下線リンクではなく実体のあるボタンにする。矢印は装飾で、
              ラベルが操作内容を担うため支援技術からは隠す。 */}
          <svg
            className="wizard-reset-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M20 12a8 8 0 1 1-2.6-5.9" />
            <path d="M20 4v4h-4" />
          </svg>
          入力をリセット
        </button>
      </div>
    ) : null;

  // 各 step を <main> で包み、シェル外でも region / main ランドマーク契約を満たす。
  // AppShell 配下でも main はページ本文として1つ（nav は別ランドマーク）になる。
  if (step === "meal") {
    return (
      <main ref={containerRef} className="page-frame stack guided-planner-theme">
        {conflictChrome}
        {autosaveChrome}
        {resetChrome}
        <MealStep
          value={draft.mealType}
          onChange={(mealType) => {
            onDraftChange({ ...draft, mealType });
          }}
          {...(returnToReviewAfterEdit
            ? {
                onBack: () => {
                  backFromEditOr("meal");
                },
              }
            : {})}
          onNext={() => {
            advanceFromEditOr("ingredients");
          }}
          disabled={isSaving}
          errorMessage={fieldErrors.mealType ?? null}
          {...editReturnActionLabels}
        />
        {error !== null && <p role="alert">{error}</p>}
      </main>
    );
  }
  if (step === "ingredients") {
    return (
      <main ref={containerRef} className="page-frame stack guided-planner-theme">
        {conflictChrome}
        {autosaveChrome}
        {resetChrome}
        <IngredientStep
          value={draft.mainIngredients}
          onChange={(mainIngredients) => {
            onDraftChange({ ...draft, mainIngredients: [...mainIngredients] });
          }}
          onBack={() => {
            backFromEditOr("meal");
          }}
          onNext={() => {
            advanceFromEditOr("cuisine");
          }}
          disabled={isSaving}
          errorMessage={fieldErrors.mainIngredients ?? null}
          pantryItems={pantryItems}
          pantryItemsStatus={pantryItemsStatus}
          {...editReturnActionLabels}
        />
        {error !== null && <p role="alert">{error}</p>}
      </main>
    );
  }
  if (step === "cuisine") {
    return (
      <main ref={containerRef} className="page-frame stack guided-planner-theme">
        {conflictChrome}
        {autosaveChrome}
        {resetChrome}
        <CuisineStep
          value={draft.cuisineGenre}
          onChange={(cuisineGenre) => {
            onDraftChange({ ...draft, cuisineGenre });
          }}
          onBack={() => {
            backFromEditOr("ingredients");
          }}
          onNext={() => {
            advanceFromEditOr("audience");
          }}
          disabled={isSaving}
          errorMessage={fieldErrors.cuisineGenre ?? null}
          {...editReturnActionLabels}
        />
        {error !== null && <p role="alert">{error}</p>}
      </main>
    );
  }
  if (step === "audience") {
    return (
      <main ref={containerRef} className="page-frame stack guided-planner-theme">
        {conflictChrome}
        {autosaveChrome}
        {resetChrome}
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
            backFromEditOr("cuisine");
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
                // idea の next 先は常に review（編集戻りでも同じ）
                setReturnToReviewAfterEdit(false);
                goToStep("review");
              })();
              return;
            }
            setReturnToReviewAfterEdit(false);
            goToStep("review");
          }}
          disabled={isSaving || confirmingIdeaAudience}
          eligibleMembers={eligibleMembers}
          fieldErrors={{
            targetMode: fieldErrors.targetMode ?? null,
            targetMemberIds: fieldErrors.targetMemberIds ?? null,
            servings: fieldErrors.servings ?? null,
          }}
          {...editReturnActionLabels}
        />
        {error !== null && <p role="alert">{error}</p>}
      </main>
    );
  }
  // review
  return (
    <main ref={containerRef} className="page-frame stack guided-planner-theme">
      {conflictChrome}
      {autosaveChrome}
      {resetChrome}
      <ReviewStep
        value={draft}
        onChange={(next) => {
          onDraftChange(next);
        }}
        onBack={() => {
          // 1ページずつ戻る（audience ← cuisine ← … は各 step の onBack が担う）
          setReturnToReviewAfterEdit(false);
          goToStep("audience");
        }}
        onNext={() => {
          // review step自体には「次へ」はなく、明示的な献立生成buttonがonSubmitを呼ぶ。
        }}
        onEditStep={(target) => {
          setReturnToReviewAfterEdit(true);
          goToStep(target);
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
        usageRemaining={usageRemaining}
        shortWindowRetryAt={shortWindowRetryAt}
        onSubmit={() => {
          void onSubmit();
        }}
      />
    </main>
  );
}
