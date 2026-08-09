import { useEffect, useRef, useState } from "react";
import { cuisineGenres } from "@shared/contracts/domain";
import type { CuisineGenre } from "@shared/contracts/domain";
import { useAppToast } from "@/shared/ui/app-toast";
import { Button } from "@/shared/ui/button";
import { Inset, Stack } from "@/shared/ui/stack";
import { Surface } from "@/shared/ui/surface";
import { cuisineGenreLabels } from "../model/planner-labels";
import type { PlannerStepProps } from "./planner-wizard-props";

/** incomplete「次へ」の toast / inline 共用文言（設計 §6.3 ロック） */
const cuisineIncompleteMessage = "ジャンルを選んでください";

export type CuisineStepProps = Omit<PlannerStepProps<CuisineGenre | null>, "disabled"> & {
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
 * ジャンルを選ぶstep。初期未選択・戻る/進むでの値保持・heading focus に加え、
 * incomplete「次へ」では toast + inline alert + radiogroup 先頭 control へ focus。
 */
export function CuisineStep({
  value,
  onChange,
  onBack,
  onNext,
  disabled = false,
  errorMessage: externalErrorMessage,
  suppressValidationToast = false,
  nextLabel = "次へ",
  backLabel = "戻る",
}: CuisineStepProps) {
  const { show: showToast, dismiss: dismissToast } = useAppToast();
  const [incompleteError, setIncompleteError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const radioGroupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (value !== null) {
      setIncompleteError(null);
    }
  }, [value]);

  useEffect(() => {
    return () => {
      dismissToast();
    };
  }, [dismissToast]);

  const shownError = incompleteError ?? externalErrorMessage ?? null;
  const errorId = "cuisine-step-error";

  /** 設計 §6.3: ジャンル radiogroup 内の先頭 input:not([disabled]) */
  const focusFirstEnabledRadio = (): void => {
    const first = radioGroupRef.current?.querySelector<HTMLInputElement>("input:not([disabled])");
    first?.focus();
  };

  const handleNext = (): void => {
    if (value === null) {
      setIncompleteError(cuisineIncompleteMessage);
      if (!suppressValidationToast) {
        showToast({ message: cuisineIncompleteMessage, tone: "error" });
      }
      focusFirstEnabledRadio();
      return;
    }
    setIncompleteError(null);
    dismissToast();
    onNext();
  };

  return (
    <section aria-labelledby="cuisine-step-title">
      <Surface>
        <Inset pad={5}>
          <Stack gap={5}>
            <h2 id="cuisine-step-title" tabIndex={-1} ref={headingRef}>
              3. ジャンル
            </h2>
            <div
              ref={radioGroupRef}
              className="wizard-option-list"
              role="radiogroup"
              aria-describedby={shownError != null ? errorId : undefined}
            >
              {cuisineGenres.map((key) => (
                <label key={key} className="wizard-option">
                  <input
                    type="radio"
                    name="genre"
                    disabled={disabled}
                    checked={value === key}
                    aria-invalid={shownError != null ? "true" : undefined}
                    onChange={() => {
                      onChange(key);
                    }}
                  />
                  <span>{cuisineGenreLabels[key]}</span>
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
