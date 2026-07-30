import { useEffect, useRef, useState } from "react";
import { mealTypes } from "@shared/contracts/domain";
import type { MealType } from "@shared/contracts/domain";
import { useAppToast } from "@/shared/ui/app-toast";
import { mealLabels } from "../model/planner-labels";
import type { PlannerStepProps } from "./planner-wizard-props";

/** incomplete「次へ」の toast / inline 共用文言（設計 §6.3 ロック） */
const mealIncompleteMessage = "食事の時間帯を選んでください";

export type MealStepProps = Omit<PlannerStepProps<MealType | null>, "disabled"> & {
  /** 親の isSaving 等。incomplete 判定では使わず、押下可否はこれだけ */
  disabled?: boolean;
  errorMessage?: string | null;
  /**
   * true のとき incomplete 押下で toast を出さない（inline + focus のみ）。
   * wizard が autosaveState === "error" のとき渡す。
   */
  suppressValidationToast?: boolean;
};

/**
 * 時間帯（食事）を選ぶ最初の質問step。
 * 初期状態は未選択のまま既定値を持たせず、incomplete でも「次へ」は押下可。
 * 未選択押下時は toast + inline alert + radiogroup 先頭 control へ focus。
 */
export function MealStep({
  value,
  onChange,
  onBack,
  onNext,
  disabled = false,
  errorMessage: externalErrorMessage,
  suppressValidationToast = false,
  nextLabel = "次へ",
  backLabel = "戻る",
}: MealStepProps) {
  const { show: showToast, dismiss: dismissToast } = useAppToast();
  const [incompleteError, setIncompleteError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const radioGroupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // step 表示直後にheadingへfocusし、キーボード・スクリーンリーダー利用者が
    // 質問の先頭から操作を続けられるようにする（brief: heading focus）。
    headingRef.current?.focus();
  }, []);

  // complete になったらインラインだけ必ず clear（toast は next 成功 / unmount で dismiss）
  useEffect(() => {
    if (value !== null) {
      setIncompleteError(null);
    }
  }, [value]);

  // step 離脱（unmount）で validation toast を残さない
  useEffect(() => {
    return () => {
      dismissToast();
    };
  }, [dismissToast]);

  const shownError = incompleteError ?? externalErrorMessage ?? null;
  const errorId = "meal-step-error";

  /** 設計 §6.3: 食事 radiogroup 内の先頭 input:not([disabled]) */
  const focusFirstEnabledRadio = (): void => {
    const first = radioGroupRef.current?.querySelector<HTMLInputElement>("input:not([disabled])");
    first?.focus();
  };

  const handleNext = (): void => {
    if (value === null) {
      setIncompleteError(mealIncompleteMessage);
      if (!suppressValidationToast) {
        showToast({ message: mealIncompleteMessage, tone: "error" });
      }
      focusFirstEnabledRadio();
      return;
    }
    setIncompleteError(null);
    dismissToast();
    onNext();
  };

  return (
    <section className="card stack" aria-labelledby="meal-step-title">
      <h2 id="meal-step-title" tabIndex={-1} ref={headingRef}>
        1. 食事
      </h2>
      <div
        ref={radioGroupRef}
        className="wizard-option-list"
        role="radiogroup"
        aria-describedby={shownError != null ? errorId : undefined}
      >
        {mealTypes.map((key) => (
          <label key={key} className="wizard-option">
            <input
              type="radio"
              name="meal"
              disabled={disabled}
              checked={value === key}
              aria-invalid={shownError != null ? "true" : undefined}
              onChange={() => {
                onChange(key);
              }}
            />
            <span>{mealLabels[key]}</span>
          </label>
        ))}
      </div>
      {shownError != null && (
        <p id={errorId} role="alert">
          {shownError}
        </p>
      )}
      <div className="wizard-actions">
        {onBack !== undefined && (
          <button
            className="wizard-action secondary-button"
            type="button"
            disabled={disabled}
            onClick={onBack}
          >
            {backLabel}
          </button>
        )}
        <button
          className="wizard-action primary-button"
          type="button"
          disabled={disabled}
          onClick={handleNext}
        >
          {nextLabel}
        </button>
      </div>
    </section>
  );
}
