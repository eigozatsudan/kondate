import { useEffect, useRef } from "react";
import { mealTypes } from "@shared/contracts/domain";
import type { MealType } from "@shared/contracts/domain";
import type { PlannerStepProps } from "./planner-wizard-props";

// 既存 PlannerForm と同一の日本語ラベルを使い、wizard 化しても利用者が見る文言を変えない。
const mealLabels: Readonly<Record<MealType, string>> = {
  breakfast: "朝食",
  lunch: "昼食",
  dinner: "夕食",
} as const;

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
      <div role="radiogroup" aria-describedby={errorMessage != null ? errorId : undefined}>
        {mealTypes.map((key) => (
          <label key={key}>
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
            {mealLabels[key]}
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
