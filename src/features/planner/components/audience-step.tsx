import { useEffect, useRef, useState, type RefObject } from "react";
import type { TargetMode } from "@shared/contracts/planner";
import { CurrentSafetySummary } from "../current-safety-summary";
import { normalizeAudienceForModeChange } from "../model/planner-wizard";
import { memberSafetyText, type PlannerSafetyMember } from "../planner-safety-member";
import type { PlannerStepProps } from "./planner-wizard-props";

const targetMemberLimit = 20;
const ideaButtonServings = [1, 2, 3, 4, 5, 6] as const;

export type AudienceValue = {
  targetMode: TargetMode | null;
  targetMemberIds: readonly string[];
  servings: number | null;
};

export type AudienceStepProps = PlannerStepProps<AudienceValue> & {
  eligibleMembers: readonly PlannerSafetyMember[];
  fieldErrors?: {
    targetMode?: string | null;
    targetMemberIds?: string | null;
    servings?: string | null;
  };
};

/**
 * 「作る相手」を決めるstep。household（家族から選ぶ）とidea（人数だけ指定する）の
 * 2モードを切り替え可能にし、モード切替時は必ず normalizeAudienceForModeChange で
 * 3フィールドを整合させる（brief step 7の不変条件を再定義せずそのまま使う）。
 */
/**
 * 7〜20人のnumber input専用の入力補助。
 * valueをservings（親state）へ直結すると「1」入力直後に7未満として即座に
 * 表示をクリアしてしまい、続く桁の入力（例: "12"の"2"）が空欄から再開して
 * 意図した値にならない。入力中はローカルの文字列buffer側を正として表示し、
 * 7〜20の範囲内が確定した時点だけonServingsChangeへ反映する。
 */
function NumberInput({
  servings,
  disabled,
  hasError,
  servingsErrorId,
  inputRef,
  onRangeErrorChange,
  onServingsChange,
}: {
  servings: number | null;
  disabled: boolean;
  hasError: boolean;
  servingsErrorId: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onRangeErrorChange: (hasRangeError: boolean) => void;
  onServingsChange: (next: number | null) => void;
}) {
  const [text, setText] = useState(servings !== null && servings >= 7 ? String(servings) : "");
  return (
    <label>
      7人以上（20人まで）
      <input
        type="number"
        min={7}
        max={20}
        value={text}
        disabled={disabled}
        aria-invalid={hasError ? "true" : undefined}
        aria-describedby={hasError ? servingsErrorId : undefined}
        ref={inputRef}
        onChange={(event) => {
          const rawValue = event.target.value;
          setText(rawValue);
          if (rawValue === "") {
            onRangeErrorChange(false);
            onServingsChange(null);
            return;
          }
          const parsed = Number(rawValue);
          const isInRange = Number.isInteger(parsed) && parsed >= 7 && parsed <= 20;
          onRangeErrorChange(!isInRange);
          if (isInRange) onServingsChange(parsed);
        }}
      />
    </label>
  );
}

export function AudienceStep({
  value,
  onChange,
  onBack,
  onNext,
  disabled,
  eligibleMembers,
  fieldErrors,
}: AudienceStepProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const servingsInputRef = useRef<HTMLInputElement>(null);
  const [hasServingsRangeError, setHasServingsRangeError] = useState(false);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  // Plan 2: blockedReason があるメンバーは「利用可能」ではない（allergy/食事制限未完了など）。
  const selectableMembers = eligibleMembers.filter((member) => member.blockedReason === null);
  const selectableIds = new Set(selectableMembers.map((member) => member.id));
  const hasEligibleMembers = selectableMembers.length > 0;
  const draftLike = {
    // normalizeAudienceForModeChange は PlannerDraftInput 全体を受け取るため、
    // audience 以外のフィールドはこのstepでは使わないダミー値で満たす。
    mealType: null,
    mainIngredients: [],
    cuisineGenre: null,
    timeLimitMinutes: null,
    budgetPreference: null,
    avoidIngredients: [],
    memo: "",
    pantrySelections: [],
    ...value,
    targetMemberIds: [...value.targetMemberIds],
  };
  const setMode = (nextMode: TargetMode | null): void => {
    const normalized = normalizeAudienceForModeChange(draftLike, nextMode, {
      eligibleMemberCount: selectableMembers.length,
    });
    onChange({
      targetMode: normalized.targetMode,
      targetMemberIds: normalized.targetMemberIds,
      servings: normalized.servings,
    });
  };
  const selectedSelectableCount = value.targetMemberIds.filter((id) =>
    selectableIds.has(id),
  ).length;
  const isComplete =
    (value.targetMode === "household" && selectedSelectableCount > 0) ||
    (value.targetMode === "idea" && value.servings !== null);
  const targetModeErrorId = "audience-target-mode-error";
  const membersErrorId = "audience-members-error";
  const servingsErrorId = "audience-servings-error";
  const servingsError =
    fieldErrors?.servings ??
    (hasServingsRangeError ? "人数は7人から20人の範囲で入力してください。" : null);
  const canAttemptInvalidServingsNext = value.targetMode === "idea" && hasServingsRangeError;
  const handleNext = (): void => {
    if (hasServingsRangeError) {
      // 範囲外値は親の下書きへ保存しないため、この入力自身を最初のinvalid fieldとして
      // focusし、field-local errorとの対応を支援技術にも明示する。
      servingsInputRef.current?.focus();
      return;
    }
    onNext();
  };
  return (
    <section className="card stack" aria-labelledby="audience-step-title">
      <h2 id="audience-step-title" tabIndex={-1} ref={headingRef}>
        4. 作る相手
      </h2>
      {eligibleMembers.length > 0 && <CurrentSafetySummary members={eligibleMembers} />}
      <div
        role="radiogroup"
        aria-describedby={fieldErrors?.targetMode != null ? targetModeErrorId : undefined}
      >
        <label>
          <input
            type="radio"
            name="audience-mode"
            disabled={disabled || !hasEligibleMembers}
            checked={value.targetMode === "household"}
            aria-invalid={fieldErrors?.targetMode != null ? "true" : undefined}
            onChange={() => {
              setHasServingsRangeError(false);
              setMode("household");
            }}
          />
          家族に合わせて作る
        </label>
        <label>
          <input
            type="radio"
            name="audience-mode"
            disabled={disabled}
            checked={value.targetMode === "idea"}
            aria-invalid={fieldErrors?.targetMode != null ? "true" : undefined}
            onChange={() => {
              setHasServingsRangeError(false);
              setMode("idea");
            }}
          />
          人数だけ指定してアイデアを見る
        </label>
      </div>
      {fieldErrors?.targetMode != null && (
        <p id={targetModeErrorId} role="alert">
          {fieldErrors.targetMode}
        </p>
      )}
      {!hasEligibleMembers && (
        <p>
          献立を作れる家族がいません。
          <a href="/settings">家族を追加する</a>
        </p>
      )}
      {value.targetMode === "household" && (
        <div
          className="stack"
          aria-describedby={fieldErrors?.targetMemberIds != null ? membersErrorId : undefined}
        >
          {eligibleMembers.map((member) => {
            const isBlocked = member.blockedReason !== null;
            const descriptionId = `audience-member-${member.id}-description`;
            return (
              <div key={member.id}>
                <label>
                  <input
                    type="checkbox"
                    disabled={
                      disabled ||
                      isBlocked ||
                      (!value.targetMemberIds.includes(member.id) &&
                        selectedSelectableCount >= targetMemberLimit)
                    }
                    aria-describedby={descriptionId}
                    aria-invalid={fieldErrors?.targetMemberIds != null ? "true" : undefined}
                    checked={value.targetMemberIds.includes(member.id) && !isBlocked}
                    onChange={(event) => {
                      if (isBlocked) return;
                      const nextIds = event.target.checked
                        ? [...value.targetMemberIds.filter((id) => selectableIds.has(id)), member.id]
                        : value.targetMemberIds.filter((id) => id !== member.id);
                      onChange({ ...value, targetMemberIds: nextIds });
                    }}
                  />
                  {member.displayName}
                  <span>（{memberSafetyText(member)}）</span>
                </label>
                <p id={descriptionId}>
                  {isBlocked ? member.blockedReason : memberSafetyText(member)}
                </p>
              </div>
            );
          })}
          {fieldErrors?.targetMemberIds != null && (
            <p id={membersErrorId} role="alert">
              {fieldErrors.targetMemberIds}
            </p>
          )}
        </div>
      )}
      {value.targetMode === "idea" && (
        <div
          className="stack"
          aria-describedby={servingsError !== null ? servingsErrorId : undefined}
        >
          <p>人数</p>
          <div role="group" aria-label="人数（1〜6人）">
            {ideaButtonServings.map((count) => (
              <button
                key={count}
                type="button"
                disabled={disabled}
                aria-pressed={value.servings === count}
                aria-invalid={servingsError !== null ? "true" : undefined}
                onClick={() => {
                  setHasServingsRangeError(false);
                  onChange({ ...value, servings: count });
                }}
              >
                {count}人
              </button>
            ))}
          </div>
          <NumberInput
            key={value.servings ?? "empty"}
            disabled={disabled}
            servings={value.servings}
            hasError={servingsError !== null}
            servingsErrorId={servingsErrorId}
            inputRef={servingsInputRef}
            onRangeErrorChange={setHasServingsRangeError}
            onServingsChange={(next) => {
              onChange({ ...value, servings: next });
            }}
          />
          {servingsError !== null && (
            <p id={servingsErrorId} role="alert">
              {servingsError}
            </p>
          )}
        </div>
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
          disabled={disabled || (!isComplete && !canAttemptInvalidServingsNext)}
          onClick={handleNext}
        >
          次へ
        </button>
      </div>
    </section>
  );
}
