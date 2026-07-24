import { useEffect, useRef } from "react";
import { mealTypes } from "@shared/contracts/domain";
import type { MealType } from "@shared/contracts/domain";
import { mealLabels } from "../model/planner-labels";
import type { PlannerStepProps } from "./planner-wizard-props";

export type MealStepProps = PlannerStepProps<MealType | null> & {
  errorMessage?: string | null;
};

/**
 * 時間帯（食事）を選ぶ最初の質問step。
 * 初期状態は未選択のまま既定値を持たせず、選択後に次へ進めるようにする。
 */
export function MealStep({
  value,
  onChange,
  onBack,
  onNext,
  disabled,
  errorMessage,
}: MealStepProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // step 表示直後にheadingへfocusし、キーボード・スクリーンリーダー利用者が
    // 質問の先頭から操作を続けられるようにする（brief: heading focus）。
    headingRef.current?.focus();
  }, []);
  const errorId = "meal-step-error";
  return (
    <section className="card stack" aria-labelledby="meal-step-title">
      <h2 id="meal-step-title" tabIndex={-1} ref={headingRef}>
        1. 食事
      </h2>
      <div
        className="wizard-option-list"
        role="radiogroup"
        aria-describedby={errorMessage != null ? errorId : undefined}
      >
        {mealTypes.map((key) => (
          <label key={key} className="wizard-option">
            <input
              type="radio"
              name="meal"
              disabled={disabled}
              checked={value === key}
              aria-invalid={errorMessage != null ? "true" : undefined}
              onChange={() => {
                onChange(key);
              }}
            />
            <span>{mealLabels[key]}</span>
          </label>
        ))}
      </div>
      {errorMessage != null && (
        <p id={errorId} role="alert">
          {errorMessage}
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
            戻る
          </button>
        )}
        <button
          className="wizard-action primary-button"
          type="button"
          disabled={disabled || value === null}
          onClick={onNext}
        >
          次へ
        </button>
      </div>
    </section>
  );
}
