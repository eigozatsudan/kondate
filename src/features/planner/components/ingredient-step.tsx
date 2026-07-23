import { useEffect, useRef, useState } from "react";
import type { PlannerStepProps } from "./planner-wizard-props";

const mainIngredientLimit = 8;
const mainIngredientLengthLimit = 80;

export type IngredientStepProps = PlannerStepProps<readonly string[]> & {
  errorMessage?: string | null;
};

/**
 * 主食材を1件ずつ追加するstep。既存 PlannerForm の8件/80文字制限をそのまま維持し、
 * 戻る操作をしても選択済みの主食材が失われないことをテストで固定する。
 */
export function IngredientStep({
  value,
  onChange,
  onBack,
  onNext,
  disabled,
  errorMessage,
}: IngredientStepProps) {
  const [ingredient, setIngredient] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const errorId = "ingredient-step-error";
  const combinedError = errorMessage ?? localError;
  return (
    <section className="card stack" aria-labelledby="ingredient-step-title">
      <h2 id="ingredient-step-title" tabIndex={-1} ref={headingRef}>
        2. メイン食材
      </h2>
      <label>
        メイン食材
        <input
          value={ingredient}
          disabled={disabled}
          aria-invalid={combinedError != null ? "true" : undefined}
          aria-describedby={combinedError != null ? errorId : undefined}
          onChange={(event) => {
            const rawValue = event.target.value;
            setIngredient(rawValue);
            if (Array.from(rawValue.normalize("NFKC").trim()).length <= mainIngredientLengthLimit) {
              setLocalError(null);
            } else {
              setLocalError("メイン食材は1件80文字までです。");
            }
          }}
        />
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          const next = ingredient.normalize("NFKC").trim();
          if (Array.from(next).length > mainIngredientLengthLimit) {
            setLocalError("メイン食材は1件80文字までです。");
            return;
          }
          if (next !== "" && !value.includes(next) && value.length >= mainIngredientLimit) {
            setLocalError(`メイン食材は${String(mainIngredientLimit)}件までです。`);
            return;
          }
          if (next !== "" && !value.includes(next)) {
            onChange([...value, next]);
          }
          setLocalError(null);
          setIngredient("");
        }}
      >
        追加
      </button>
      {combinedError != null && (
        <p id={errorId} role="alert">
          {combinedError}
        </p>
      )}
      <div>
        {value.map((item) => (
          <button
            type="button"
            key={item}
            disabled={disabled}
            onClick={() => {
              onChange(value.filter((current) => current !== item));
            }}
          >
            {item}を外す
          </button>
        ))}
      </div>
      <div className="stack-row">
        {onBack !== undefined && (
          <button type="button" disabled={disabled} onClick={onBack}>
            戻る
          </button>
        )}
        <button
          className="primary-button"
          type="button"
          disabled={disabled || value.length === 0}
          onClick={onNext}
        >
          次へ
        </button>
      </div>
    </section>
  );
}
