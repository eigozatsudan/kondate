import { useEffect, useRef, useState } from "react";
import type { PantryItem } from "@shared/contracts/pantry";
import {
  excludeCanonicalMainIngredient,
  includesCanonicalMainIngredient,
  normalizeMainIngredient,
} from "../model/main-ingredient-options";
import type { PantryItemsStatus } from "../pantry-selector";
import type { PlannerStepProps } from "./planner-wizard-props";

const mainIngredientLimit = 8;
const mainIngredientLengthLimit = 80;

export type IngredientStepProps = PlannerStepProps<readonly string[]> & {
  errorMessage?: string | null;
  pantryItems: readonly PantryItem[];
  pantryItemsStatus: PantryItemsStatus;
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
  pantryItems,
  pantryItemsStatus,
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
      <div className="ingredient-entry-row">
        <label className="field ingredient-entry-field">
          メイン食材
          <input
            value={ingredient}
            disabled={disabled}
            aria-invalid={combinedError != null ? "true" : undefined}
            aria-describedby={combinedError != null ? errorId : undefined}
            onChange={(event) => {
              const rawValue = event.target.value;
              setIngredient(rawValue);
              if (
                Array.from(normalizeMainIngredient(rawValue)).length <= mainIngredientLengthLimit
              ) {
                setLocalError(null);
              } else {
                setLocalError("メイン食材は1件80文字までです。");
              }
            }}
          />
        </label>
        <button
          className="secondary-button ingredient-add-button"
          type="button"
          disabled={disabled}
          onClick={() => {
            const next = normalizeMainIngredient(ingredient);
            const alreadySelected = includesCanonicalMainIngredient(value, next);
            if (Array.from(next).length > mainIngredientLengthLimit) {
              setLocalError("メイン食材は1件80文字までです。");
              return;
            }
            if (next !== "" && !alreadySelected && value.length >= mainIngredientLimit) {
              setLocalError(`メイン食材は${String(mainIngredientLimit)}件までです。`);
              return;
            }
            if (next !== "" && !alreadySelected) {
              onChange([...value, next]);
            }
            setLocalError(null);
            setIngredient("");
          }}
        >
          追加
        </button>
      </div>
      {combinedError != null && (
        <p id={errorId} role="alert">
          {combinedError}
        </p>
      )}
      <div className="wizard-chip-row">
        {value.map((item) => (
          <button
            className="wizard-chip"
            type="button"
            key={item}
            disabled={disabled}
            onClick={() => {
              // 追加経路と同じ canonical 規則で解除する（厳密等価の経路分岐を残さない）
              onChange(excludeCanonicalMainIngredient(value, item));
            }}
          >
            {item}を外す
          </button>
        ))}
      </div>
      <section className="ingredient-pantry stack" aria-labelledby="ingredient-pantry-title">
        <div>
          <h3 id="ingredient-pantry-title">冷蔵庫から選ぶ</h3>
          <p>
            ここでは料理の中心にしたい食材を追加します。「必ず使う／使えれば使う」は確認画面で別に選べます。
          </p>
        </div>
        {pantryItemsStatus === "loading" && <p>冷蔵庫の食材を読み込んでいます…</p>}
        {pantryItemsStatus === "loaded" && pantryItems.length === 0 && (
          <p>冷蔵庫に登録した食材はありません。</p>
        )}
        {pantryItemsStatus === "loaded" && pantryItems.length > 0 && (
          <div className="wizard-chip-row">
            {pantryItems.map((item) => {
              const normalizedName = normalizeMainIngredient(item.name);
              const selected = includesCanonicalMainIngredient(value, normalizedName);
              return (
                <button
                  className="wizard-chip"
                  type="button"
                  key={item.id}
                  disabled={disabled || selected}
                  onClick={() => {
                    if (
                      normalizedName === "" ||
                      Array.from(normalizedName).length > mainIngredientLengthLimit
                    ) {
                      setLocalError("メイン食材は1件80文字までです。");
                      return;
                    }
                    if (value.length >= mainIngredientLimit) {
                      setLocalError(`メイン食材は${String(mainIngredientLimit)}件までです。`);
                      return;
                    }
                    onChange([...value, normalizedName]);
                    setLocalError(null);
                  }}
                >
                  {normalizedName}を追加
                </button>
              );
            })}
          </div>
        )}
      </section>
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
          disabled={disabled || value.length === 0}
          onClick={onNext}
        >
          次へ
        </button>
      </div>
    </section>
  );
}
