import { useEffect, useRef, useState } from "react";
import type { PantryItem } from "@shared/contracts/pantry";
import {
  PLANNER_INGREDIENT_TEXT_MAX,
  PLANNER_MAIN_INGREDIENT_LIMIT,
} from "@shared/contracts/planner";
import { useAppToast } from "@/shared/ui/app-toast";
import { Button } from "@/shared/ui/button";
import { Inset, Stack } from "@/shared/ui/stack";
import { Surface } from "@/shared/ui/surface";
import {
  commonMainIngredients,
  excludeCanonicalMainIngredient,
  includesCanonicalMainIngredient,
  normalizeMainIngredient,
} from "../model/main-ingredient-options";
import type { PantryItemsStatus } from "../pantry-selector";
import type { PlannerStepProps } from "./planner-wizard-props";

// schema / UI の上限は contracts の単一点定義（P11）
const mainIngredientLimit = PLANNER_MAIN_INGREDIENT_LIMIT;
const mainIngredientLengthLimit = PLANNER_INGREDIENT_TEXT_MAX;

export type IngredientStepProps = Omit<PlannerStepProps<readonly string[]>, "disabled"> & {
  /** 親の isSaving 等。incomplete 判定では使わず、押下可否はこれだけ */
  disabled?: boolean;
  errorMessage?: string | null;
  /**
   * true のとき incomplete 押下で toast を出さない（inline + focus のみ）。
   * wizard が autosaveState === "error" のとき渡す。
   */
  suppressValidationToast?: boolean;
  pantryItems?: readonly PantryItem[];
  pantryItemsStatus?: PantryItemsStatus;
};

/**
 * 主食材を1件ずつ追加するstep。クイック選択・自由入力・冷蔵庫候補はすべて
 * 同じ canonical helper と onChange(mainIngredients) 経由で更新する。
 * 質問順・8件/80文字制限・pantrySelections 非干渉は既存契約を維持する。
 * 0件のまま「次へ」は alertdialog ではなく toast + inline alert + text input focus。
 */
/** メイン食材ゼロのまま進もうとしたときに出す案内（toast と role=alert で共用） */
export const mainIngredientRequiredMessage = "メイン食材を1つ以上選んでください";

export function IngredientStep({
  value,
  onChange,
  onBack,
  onNext,
  disabled = false,
  errorMessage: externalErrorMessage,
  suppressValidationToast = false,
  pantryItems = [],
  pantryItemsStatus = "loaded",
  nextLabel = "次へ",
  backLabel = "戻る",
}: IngredientStepProps) {
  const { show: showToast, dismiss: dismissToast } = useAppToast();
  const [ingredient, setIngredient] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  // 未選択のまま次へを押したときの案内（empty alertdialog 廃止後の代替）
  const [incompleteError, setIncompleteError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const freeInputRef = useRef<HTMLInputElement>(null);
  const quickSelectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // 1件以上選んだら incomplete インラインを clear
  useEffect(() => {
    if (value.length > 0) {
      setIncompleteError(null);
    }
  }, [value]);

  // step 離脱で validation toast を残さない
  useEffect(() => {
    return () => {
      dismissToast();
    };
  }, [dismissToast]);

  const errorId = "ingredient-step-error";
  const combinedError = incompleteError ?? externalErrorMessage ?? localError;

  /**
   * 設計 §6.3: メイン食材の text input を優先。
   * 無ければ先頭の未選択クイック選択チップ button。
   */
  const focusMainIngredientControl = (): void => {
    const freeInput = freeInputRef.current;
    if (freeInput != null && !freeInput.disabled) {
      freeInput.focus();
      return;
    }
    const chips = quickSelectRef.current?.querySelectorAll<HTMLButtonElement>("button.wizard-chip");
    if (chips == null) return;
    for (const chip of chips) {
      if (chip.disabled) continue;
      // 未選択 = aria-pressed が true でない
      if (chip.getAttribute("aria-pressed") === "true") continue;
      chip.focus();
      return;
    }
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
      setLocalError(`メイン食材は1件${String(mainIngredientLengthLimit)}文字までです。`);
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

  const handleNext = (): void => {
    if (value.length === 0) {
      setIncompleteError(mainIngredientRequiredMessage);
      if (!suppressValidationToast) {
        showToast({ message: mainIngredientRequiredMessage, tone: "error" });
      }
      focusMainIngredientControl();
      return;
    }
    setIncompleteError(null);
    dismissToast();
    onNext();
  };

  return (
    <section aria-labelledby="ingredient-step-title">
      <Surface>
        <Inset pad={5}>
          <Stack gap={5}>
            <h2 id="ingredient-step-title" tabIndex={-1} ref={headingRef}>
              2. メイン食材
            </h2>

            <section
              className="ingredient-quick-select stack"
              aria-labelledby="ingredient-quick-title"
            >
              <h3 id="ingredient-quick-title">よく使う食材から選ぶ</h3>
              <div ref={quickSelectRef} className="wizard-chip-row">
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

            <section
              className="ingredient-free-input stack"
              aria-labelledby="ingredient-free-title"
            >
              {/*
          セクション見出しと input の accessible name を分離する。
          label は「メイン食材」のままにし、既存 E2E / getByLabelText を壊さない。
        */}
              <h3 id="ingredient-free-title">一覧にない食材を入力</h3>
              <div className="ingredient-entry-row">
                <label className="field ingredient-entry-field">
                  メイン食材
                  <input
                    ref={freeInputRef}
                    value={ingredient}
                    disabled={disabled}
                    aria-invalid={combinedError != null ? "true" : undefined}
                    aria-describedby={combinedError != null ? errorId : undefined}
                    onChange={(event) => {
                      const rawValue = event.target.value;
                      setIngredient(rawValue);
                      if (
                        Array.from(normalizeMainIngredient(rawValue)).length <=
                        mainIngredientLengthLimit
                      ) {
                        setLocalError(null);
                      } else {
                        setLocalError("メイン食材は1件80文字までです。");
                      }
                    }}
                    onKeyDown={(event) => {
                      // スマホ確定キー / Enter でも「追加」と同じ経路（C-I5）
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      if (disabled) return;
                      const result = tryAddIngredient(ingredient);
                      if (result === "too_long" || result === "at_limit") {
                        return;
                      }
                      if (result === "duplicate_or_empty") {
                        const trimmed = normalizeMainIngredient(ingredient);
                        setLocalError(
                          trimmed === ""
                            ? "食材名を入力してから追加してください。"
                            : "同じ食材はすでに追加されています。",
                        );
                        return;
                      }
                      setLocalError(null);
                      setIngredient("");
                    }}
                  />
                </label>
                <Button
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => {
                    const result = tryAddIngredient(ingredient);
                    if (result === "too_long" || result === "at_limit") {
                      return;
                    }
                    if (result === "duplicate_or_empty") {
                      const trimmed = normalizeMainIngredient(ingredient);
                      setLocalError(
                        trimmed === ""
                          ? "食材名を入力してから追加してください。"
                          : "同じ食材はすでに追加されています。",
                      );
                      return;
                    }
                    setLocalError(null);
                    setIngredient("");
                  }}
                >
                  追加
                </Button>
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
                <Stack gap={2}>
                  <p>冷蔵庫に登録した食材はありません。</p>
                  <p className="type-small">
                    食材を使いたいときは、下のメニュー「冷蔵庫」から食材リストに登録できます。登録なしでも献立は作れます。
                  </p>
                </Stack>
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
                <Button variant="secondary" disabled={disabled} onClick={onBack}>
                  {backLabel}
                </Button>
              )}
              <Button variant="primary" disabled={disabled} onClick={handleNext}>
                {nextLabel}
              </Button>
            </div>
          </Stack>
        </Inset>
      </Surface>
    </section>
  );
}
