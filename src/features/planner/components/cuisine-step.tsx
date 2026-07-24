import { useEffect, useRef } from "react";
import { cuisineGenres } from "@shared/contracts/domain";
import type { CuisineGenre } from "@shared/contracts/domain";
import { cuisineGenreLabels } from "../model/planner-labels";
import type { PlannerStepProps } from "./planner-wizard-props";

export type CuisineStepProps = PlannerStepProps<CuisineGenre | null> & {
  errorMessage?: string | null;
};

/**
 * ジャンルを選ぶstep。目的は他stepと同様、初期未選択・戻る/進むでの値保持・
 * headingへのfocusをUIレベルで固定すること。
 */
export function CuisineStep({
  value,
  onChange,
  onBack,
  onNext,
  disabled,
  errorMessage,
}: CuisineStepProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const errorId = "cuisine-step-error";
  return (
    <section className="card stack" aria-labelledby="cuisine-step-title">
      <h2 id="cuisine-step-title" tabIndex={-1} ref={headingRef}>
        3. ジャンル
      </h2>
      <div
        className="wizard-option-list"
        role="radiogroup"
        aria-describedby={errorMessage != null ? errorId : undefined}
      >
        {cuisineGenres.map((key) => (
          <label key={key} className="wizard-option">
            <input
              type="radio"
              name="genre"
              disabled={disabled}
              checked={value === key}
              aria-invalid={errorMessage != null ? "true" : undefined}
              onChange={() => {
                onChange(key);
              }}
            />
            <span>{cuisineGenreLabels[key]}</span>
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
