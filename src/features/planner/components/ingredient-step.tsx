import { useEffect, useRef, useState } from "react";
import type { PantryItem } from "@shared/contracts/pantry";
import {
  commonMainIngredients,
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
 * 主食材を1件ずつ追加するstep。クイック選択・自由入力・冷蔵庫候補はすべて
 * 同じ canonical helper と onChange(mainIngredients) 経由で更新する。
 * 質問順・8件/80文字制限・pantrySelections 非干渉は既存契約を維持する。
 */
/** メイン食材ゼロのまま「次へ」したときに出す案内（dialog と role=alert で共用） */
export const mainIngredientRequiredMessage =
  "献立の中心になる食材を1つ以上選んでから「次へ」を押してください。";

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
  // 未選択のまま次へを押したときの案内。disabled だと押下フィードバックが無いため、
  // ボタンは有効のまま alertdialog で理由を伝える（privacy ゲートと同型）。
  const [emptyGateOpen, setEmptyGateOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const emptyGateCloseRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  useEffect(() => {
    if (emptyGateOpen) emptyGateCloseRef.current?.focus();
  }, [emptyGateOpen]);
  const errorId = "ingredient-step-error";
  const emptyGateDescriptionId = "ingredient-empty-gate-description";
  const combinedError = errorMessage ?? localError;
  const closeEmptyGate = (): void => {
    setEmptyGateOpen(false);
  };

  /**
   * 未選択の候補を1件追加する。重複・空・長さ超過・8件上限はここで一元判定する。
   * @returns "added" | "duplicate_or_empty" | "too_long" | "at_limit"
   */
  const tryAddIngredient = (
    raw: string,
  ): "added" | "duplicate_or_empty" | "too_long" | "at_limit" => {
    const next = normalizeMainIngredient(raw);
    if (next === "") {
      return "duplicate_or_empty";
    }
    if (Array.from(next).length > mainIngredientLengthLimit) {
      setLocalError("メイン食材は1件80文字までです。");
      return "too_long";
    }
    if (includesCanonicalMainIngredient(value, next)) {
      return "duplicate_or_empty";
    }
    if (value.length >= mainIngredientLimit) {
      setLocalError(`メイン食材は${String(mainIngredientLimit)}件までです。`);
      return "at_limit";
    }
    onChange([...value, next]);
    setLocalError(null);
    return "added";
  };

  /** クイック選択トグルと選択済みチップ解除の共通経路。excludeCanonical のみを使う。 */
  const removeIngredient = (candidate: string) => {
    onChange(excludeCanonicalMainIngredient(value, candidate));
    setLocalError(null);
  };

  const toggleQuickIngredient = (candidate: string) => {
    if (includesCanonicalMainIngredient(value, candidate)) {
      removeIngredient(candidate);
      return;
    }
    // 上限到達時も未選択チップは disabled にせず、押下でエラー表示だけにする
    tryAddIngredient(candidate);
  };

  return (
    <section className="card stack" aria-labelledby="ingredient-step-title">
      <h2 id="ingredient-step-title" tabIndex={-1} ref={headingRef}>
        2. メイン食材
      </h2>

      <section className="ingredient-quick-select stack" aria-labelledby="ingredient-quick-title">
        <h3 id="ingredient-quick-title">よく使う食材から選ぶ</h3>
        <div className="wizard-chip-row">
          {commonMainIngredients.map((candidate) => {
            const pressed = includesCanonicalMainIngredient(value, candidate);
            return (
              <button
                className="wizard-chip"
                type="button"
                key={candidate}
                disabled={disabled}
                aria-pressed={pressed}
                onClick={() => {
                  toggleQuickIngredient(candidate);
                }}
              >
                {candidate}
              </button>
            );
          })}
        </div>
      </section>

      <div className="ingredient-selected stack">
        <p className="ingredient-selected-count">
          選んだ食材（{String(value.length)}/{String(mainIngredientLimit)}）
        </p>
        <div className="wizard-chip-row">
          {value.map((item) => (
            <button
              className="wizard-chip"
              type="button"
              key={item}
              disabled={disabled}
              onClick={() => {
                // 追加経路と同じ canonical 規則で解除する（厳密等価の経路分岐を残さない）
                removeIngredient(item);
              }}
            >
              {item}を外す
            </button>
          ))}
        </div>
      </div>

      <section className="ingredient-free-input stack" aria-labelledby="ingredient-free-title">
        {/*
          セクション見出しと input の accessible name を分離する。
          label は「メイン食材」のままにし、既存 E2E / getByLabelText を壊さない。
        */}
        <h3 id="ingredient-free-title">一覧にない食材を入力</h3>
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
              // 既存挙動: 空・重複はエラーなしで入力クリア。長さ超過・上限はエラーを出して入力を残す。
              const result = tryAddIngredient(ingredient);
              if (result === "too_long" || result === "at_limit") {
                return;
              }
              setLocalError(null);
              setIngredient("");
            }}
          >
            追加
          </button>
        </div>
      </section>

      {combinedError != null && (
        <p id={errorId} role="alert">
          {combinedError}
        </p>
      )}

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
                    // 選択済みは disabled のためここには来ない。トグル解除しない（意図的非対称）。
                    tryAddIngredient(normalizedName);
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
          disabled={disabled}
          onClick={() => {
            if (value.length === 0) {
              setEmptyGateOpen(true);
              return;
            }
            closeEmptyGate();
            onNext();
          }}
        >
          次へ
        </button>
      </div>
      {emptyGateOpen && (
        <div
          className="pantry-expired-dialog-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeEmptyGate();
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ingredient-empty-gate-title"
            aria-describedby={emptyGateDescriptionId}
            className="card stack pantry-expired-dialog-panel"
            onClick={(event) => {
              event.stopPropagation();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeEmptyGate();
              }
            }}
          >
            <h2 id="ingredient-empty-gate-title">メイン食材を選んでください</h2>
            <p id={emptyGateDescriptionId}>{mainIngredientRequiredMessage}</p>
            <button
              ref={emptyGateCloseRef}
              className="wizard-action primary-button"
              type="button"
              onClick={closeEmptyGate}
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
