import { useEffect, useRef } from "react";
import { cuisineGenres } from "@shared/contracts/domain";
import type { CuisineGenre } from "@shared/contracts/domain";
import type { PlannerStepProps } from "./planner-wizard-props";

// 既存 PlannerForm と同一の日本語ラベル。
const genreLabels: Readonly<Record<CuisineGenre, string>> = {
  japanese: "和食",
  western: "洋食",
  chinese: "中華",
  any: "おまかせ",
} as const;

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
      <div role="radiogroup" aria-describedby={errorMessage != null ? errorId : undefined}>
        {cuisineGenres.map((key) => (
          <label key={key}>
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
            {genreLabels[key]}
          </label>
        ))}
      </div>
      {errorMessage != null && (
        <p id={errorId} role="alert">
          {errorMessage}
        </p>
      )}
      <div className="stack-row">
        {onBack !== undefined && (
          <button type="button" disabled={disabled} onClick={onBack}>
            戻る
          </button>
        )}
        <button
          className="primary-button"
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
