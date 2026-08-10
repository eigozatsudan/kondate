import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PlannerAttempt } from "../expired-pantry-checks";
import type { PantryItemsStatus } from "../pantry-selector";
import type { PantryItem } from "@shared/contracts/pantry";
import {
  firstIncompletePlannerStep,
  isAudienceComplete,
  plannerSteps,
  type PlannerFieldName,
} from "../model/planner-wizard";
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
  if (fieldErrors.ingredientPreference !== undefined)
    result.ingredientPreference = fieldErrors.ingredientPreference;
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
  /** AP5: privacy 読取失敗時 true（ReviewStep へ透過） */
  privacyConsentLoadFailed?: boolean;
  onRetryPrivacyConsent?: () => void;
  onOpenPrivacyNotice: () => void;
  /**
   * 家族設定へ遷移する。route が flush 完了後に navigate する（P5）。
   * 未指定時は step 内の Link 直遷移にフォールバックする。
   */
  onOpenSettings?: () => void;
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
  /** usage.plan。formatPlanQuotaCopy / L10 CTA 用（未取得は null） */
  plan?: "free" | "plus" | null;
  /**
   * usage.quality.available。Plus 品質トグル用（未取得は null）。
   * false のときは「くわしく作る」をロックし qualityMode を落とす（P5）。
   */
  qualityAvailable?: boolean | null;
  /** C-I12 residual: 日次 attempt 残（未取得は null） */
  attemptsRemaining?: number | null;
  /** C-I12 residual: アプリ全体の受付可否（未取得は null） */
  globalAvailable?: boolean | null;
  /** short-window 残 0 時の再開時刻 ISO（未該当は null） */
  shortWindowRetryAt?: string | null;
  /** 下書き autosave の短い状態表示（C-I9） */
  autosaveState?: "idle" | "saving" | "saved" | "error";
  /** autosave 失敗時の再試行（flush） */
  onRetryAutosave?: () => void;
  /**
   * 進行中 generation pending があるとき true。
   * review で「新条件は送らず再開」を押下前に明示する（P2）。
   */
  hasResumablePendingGeneration?: boolean;
  /**
   * P4: safety/pantry 背景 refetch soft 失敗中 true。
   * 主 CTA のみ止める（編集は previous data で継続）。onSubmit 側でも再ゲートする。
   */
  blockGenerationForStaleSafety?: boolean;
  /**
   * 各 step の page-frame 末尾に置く追加 UI（L10-3 チラシ入口など）。
   * page-frame 外に置くと幅・余白が崩れるため、main 内に描画する。
   */
  footer?: ReactNode;
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
  privacyConsentLoadFailed = false,
  onRetryPrivacyConsent,
  onOpenPrivacyNotice,
  onOpenSettings,
  hasDraftConflict = false,
  draftConflictRefetchError = false,
  canResolveDraftConflict = false,
  onResolveDraftConflict,
  onRetryDraftConflict,
  onOpenEmergencyMenus,
  onIdeaAudienceConfirmed,
  onReset,
  usageRemaining = null,
  plan = null,
  qualityAvailable = null,
  attemptsRemaining = null,
  globalAvailable = null,
  shortWindowRetryAt = null,
  autosaveState = "idle",
  onRetryAutosave,
  hasResumablePendingGeneration = false,
  blockGenerationForStaleSafety = false,
  footer = null,
}: PlannerWizardComponentProps) {
  // このref自体はfocus対象を探すためだけに使い、値そのものは保持しない。
  const containerRef = useRef<HTMLElement>(null);
  // P7: CTA / 編集戻りで eligibility を同期判定（strip effect 前の偽 complete を抑止）
  const eligibleMemberIdSet = useMemo(
    () =>
      new Set(
        eligibleMembers
          .filter((member) => member.blockedReason === null)
          .map((member) => member.id),
      ),
    [eligibleMembers],
  );

  // 前 step の scrollY が残ると短い step の「次へ」が fixed bottom-nav 下に重なる（iPhone SE）。
  // heading focus だけでは preventScroll 系やレイアウト前 focus で足りないことがあるため明示する。
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);
  // idea audience 確定の single-flight。ref は同期ガード、state は disabled 表示用。
  const confirmingIdeaAudienceRef = useRef(false);
  const [confirmingIdeaAudience, setConfirmingIdeaAudience] = useState(false);
  // P1: await 中の reset/unmount で親 onStepChange("review") を捨てる世代トークン
  const ideaConfirmGenerationRef = useRef(0);
  // 確認画面の「変更」から飛んだとき true。次へ／戻るで確認へ直行する。
  const [returnToReviewAfterEdit, setReturnToReviewAfterEdit] = useState(false);
  // 浮遊トーストの表示。親の autosaveState が "saved" のままでも 3 秒で消す。
  const [autosaveToastOpen, setAutosaveToastOpen] = useState(false);

  useEffect(() => {
    if (autosaveState === "idle") {
      setAutosaveToastOpen(false);
      return undefined;
    }
    setAutosaveToastOpen(true);
    // 保存中・失敗は完了/回復まで出し続ける（error を消すと再試行が消えて未保存のまま進める）。
    // saved だけ約 3 秒で自動消去。
    if (autosaveState === "saving" || autosaveState === "error") return undefined;
    const timer = window.setTimeout(() => {
      setAutosaveToastOpen(false);
    }, 3_000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [autosaveState]);

  // P1: unmount（resetToken remount 含む）で in-flight idea 確定の goToStep を無効化する
  useEffect(() => {
    return () => {
      ideaConfirmGenerationRef.current += 1;
    };
  }, []);

  const goToStep = (next: (typeof plannerSteps)[number]): void => {
    onStepChange(next);
  };

  /**
   * 確認からの編集戻り先。必須質問（meal/ingredients/cuisine/audience+eligibility）が
   * 未完成のまま review に戻さない（P2/P7）。
   * firstIncomplete が review のときだけ確認へ戻し、空 mainIngredients や
   * 非 eligible 対象でも生成 CTA が有効になる経路を塞ぐ。
   */
  const returnToReviewIfQuestionsComplete = (): void => {
    setReturnToReviewAfterEdit(false);
    const incomplete = firstIncompletePlannerStep(draft, eligibleMemberIdSet);
    goToStep(incomplete);
  };

  /** 通常の順送り先。確認からの編集中なら review へ戻す。 */
  const advanceFromEditOr = (sequentialNext: (typeof plannerSteps)[number]): void => {
    if (returnToReviewAfterEdit) {
      returnToReviewIfQuestionsComplete();
      return;
    }
    goToStep(sequentialNext);
  };

  /** 通常の戻り先。確認からの編集中なら review へ戻す（編集をやめる）。 */
  const backFromEditOr = (sequentialBack: (typeof plannerSteps)[number]): void => {
    if (returnToReviewAfterEdit) {
      returnToReviewIfQuestionsComplete();
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

  // 競合 chrome とは別に、debounce 保存の成否を右上の浮遊トーストで出す（C-I9 / MVP §7.2）。
  // fixed 配置なので本文レイアウトを動かさない。idle / 自動消去後は非表示。
  const autosaveChrome =
    !autosaveToastOpen || autosaveState === "idle" ? null : autosaveState === "error" ? (
      <div className="autosave-toast autosave-toast--error" role="alert">
        <svg
          className="autosave-toast-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5" />
          <path d="M12 16h.01" />
        </svg>
        <span className="autosave-toast-label">保存できませんでした</span>
        {onRetryAutosave !== undefined && (
          <button type="button" className="autosave-toast-retry min-h-11" onClick={onRetryAutosave}>
            再試行
          </button>
        )}
      </div>
    ) : (
      <div
        className={
          autosaveState === "saving"
            ? "autosave-toast autosave-toast--saving"
            : "autosave-toast autosave-toast--saved"
        }
        role="status"
        aria-live="polite"
      >
        {autosaveState === "saving" ? (
          <svg
            className="autosave-toast-icon autosave-toast-icon--spin"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M12 3a9 9 0 1 0 9 9" />
          </svg>
        ) : (
          <svg
            className="autosave-toast-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
        <span className="autosave-toast-label">
          {autosaveState === "saving" ? "保存中…" : "保存しました"}
        </span>
      </div>
    );

  const resetChrome =
    onReset !== undefined ? (
      <div className="wizard-reset-row">
        <button
          className="wizard-reset-button"
          type="button"
          // P1: idea 確定 await 中は reset を塞ぎ、空下書き + 遅延 review 遷移の競合を避ける
          disabled={isSaving || confirmingIdeaAudience}
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
          suppressValidationToast={autosaveState === "error"}
          {...editReturnActionLabels}
        />
        {error !== null && <p role="alert">{error}</p>}
        {footer}
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
          suppressValidationToast={autosaveState === "error"}
          pantryItems={pantryItems}
          pantryItemsStatus={pantryItemsStatus}
          {...editReturnActionLabels}
        />
        {error !== null && <p role="alert">{error}</p>}
        {footer}
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
          suppressValidationToast={autosaveState === "error"}
          {...editReturnActionLabels}
        />
        {error !== null && <p role="alert">{error}</p>}
        {footer}
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
              // P1: reset/unmount で generation が進んだら goToStep しない
              const confirmGeneration = ++ideaConfirmGenerationRef.current;
              void (async () => {
                try {
                  await onIdeaAudienceConfirmed();
                } catch {
                  if (confirmGeneration !== ideaConfirmGenerationRef.current) return;
                  confirmingIdeaAudienceRef.current = false;
                  setConfirmingIdeaAudience(false);
                  return;
                }
                if (confirmGeneration !== ideaConfirmGenerationRef.current) return;
                confirmingIdeaAudienceRef.current = false;
                setConfirmingIdeaAudience(false);
                // idea の next 先は常に review（編集戻りでも同じ）
                setReturnToReviewAfterEdit(false);
                goToStep("review");
              })();
              return;
            }
            setReturnToReviewAfterEdit(false);
            // household 等: 未完成 audience / 非 eligible のまま review へ進めない（P2/P7）
            if (!isAudienceComplete(draft, eligibleMemberIdSet)) {
              goToStep(firstIncompletePlannerStep(draft, eligibleMemberIdSet));
              return;
            }
            goToStep("review");
          }}
          disabled={isSaving || confirmingIdeaAudience}
          eligibleMembers={eligibleMembers}
          suppressValidationToast={autosaveState === "error"}
          fieldErrors={{
            targetMode: fieldErrors.targetMode ?? null,
            targetMemberIds: fieldErrors.targetMemberIds ?? null,
            servings: fieldErrors.servings ?? null,
          }}
          {...(onOpenSettings !== undefined ? { onOpenSettings } : {})}
          {...editReturnActionLabels}
        />
        {error !== null && <p role="alert">{error}</p>}
        {footer}
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
        privacyConsentLoadFailed={privacyConsentLoadFailed}
        {...(onRetryPrivacyConsent !== undefined ? { onRetryPrivacyConsent } : {})}
        onOpenPrivacyNotice={onOpenPrivacyNotice}
        safetyMembers={eligibleMembers}
        {...(onOpenEmergencyMenus !== undefined ? { onOpenEmergencyMenus } : {})}
        {...(onOpenSettings !== undefined ? { onOpenSettings } : {})}
        usageRemaining={usageRemaining}
        plan={plan}
        qualityAvailable={qualityAvailable}
        attemptsRemaining={attemptsRemaining}
        globalAvailable={globalAvailable}
        shortWindowRetryAt={shortWindowRetryAt}
        hasResumablePendingGeneration={hasResumablePendingGeneration}
        blockGenerationForStaleSafety={blockGenerationForStaleSafety}
        onSubmit={() => {
          void onSubmit();
        }}
      />
      {footer}
    </main>
  );
}
