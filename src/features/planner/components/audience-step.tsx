import { useEffect, useRef } from "react";
import { Link } from "react-router";
import type { TargetMode } from "@shared/contracts/planner";
import { CurrentSafetySummary } from "../current-safety-summary";
import { normalizeAudienceForModeChange } from "../model/planner-wizard";
import { memberSafetyText, type PlannerSafetyMember } from "../planner-safety-member";
import type { PlannerStepProps } from "./planner-wizard-props";

const targetMemberLimit = 20;
const ideaButtonServings = [1, 2, 3, 4, 5, 6] as const;
/** 7〜20人。1〜6人はチップで選ぶため、プルダウンは7人以上だけを持つ。 */
const ideaSelectServings = Array.from({ length: 14 }, (_, index) => index + 7);

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
export function AudienceStep({
  value,
  onChange,
  onBack,
  onNext,
  disabled,
  eligibleMembers,
  fieldErrors,
  nextLabel = "次へ",
  backLabel = "戻る",
}: AudienceStepProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const servingsSelectRef = useRef<HTMLSelectElement>(null);
  const targetModeGroupRef = useRef<HTMLDivElement>(null);
  const membersGroupRef = useRef<HTMLDivElement>(null);
  // GP-I3: 親が fieldErrors を載せて step を戻したときは見出しではなく無効フィールドへ
  useEffect(() => {
    if (fieldErrors?.targetMode) {
      targetModeGroupRef.current?.querySelector<HTMLElement>("input,button,[tabindex]")?.focus();
      return;
    }
    if (fieldErrors?.targetMemberIds) {
      membersGroupRef.current?.querySelector<HTMLElement>("input,button,[tabindex]")?.focus();
      return;
    }
    if (fieldErrors?.servings) {
      servingsSelectRef.current?.focus();
      return;
    }
    headingRef.current?.focus();
    // マウント時のみ。fieldErrors の後続更新で連打 focus しない
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount focus only
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
  // 7人以上はプルダウンなので範囲外の値そのものが表現できない。残るservings errorは
  // 親（下書き復元・サーバ検証）由来のものだけで、その場合は該当fieldへfocusを移す。
  const servingsError = fieldErrors?.servings ?? null;
  const handleNext = (): void => {
    if (value.targetMode === "idea" && servingsError !== null) {
      servingsSelectRef.current?.focus();
      return;
    }
    onNext();
  };
  return (
    <section className="card stack" aria-labelledby="audience-step-title">
      <h2 id="audience-step-title" tabIndex={-1} ref={headingRef}>
        4. 作る相手
      </h2>
      {/* idea では家族安全条件を見せない（安全確認済みと誤認させない・C-I3 / §3.1）
          未選択で全員 blocked のときだけ理由一覧を出す（household 選択前の説明）。 */}
      {value.targetMode === "household" && eligibleMembers.length > 0 && (
        <CurrentSafetySummary members={eligibleMembers} />
      )}
      {value.targetMode === null &&
        eligibleMembers.length > 0 &&
        !hasEligibleMembers &&
        eligibleMembers.map((member) =>
          member.blockedReason !== null ? (
            <p key={member.id} role="alert">
              {member.displayName}: {member.blockedReason}
            </p>
          ) : null,
        )}
      <div
        ref={targetModeGroupRef}
        className="wizard-option-list"
        role="radiogroup"
        aria-describedby={fieldErrors?.targetMode != null ? targetModeErrorId : undefined}
      >
        <label className="wizard-option">
          <input
            type="radio"
            name="audience-mode"
            disabled={disabled || !hasEligibleMembers}
            checked={value.targetMode === "household"}
            aria-invalid={fieldErrors?.targetMode != null ? "true" : undefined}
            aria-describedby={
              !hasEligibleMembers
                ? "audience-household-disabled-reason"
                : fieldErrors?.targetMode != null
                  ? targetModeErrorId
                  : undefined
            }
            onChange={() => {
              setMode("household");
            }}
          />
          <span>家族に合わせて作る</span>
        </label>
        <label className="wizard-option">
          <input
            type="radio"
            name="audience-mode"
            disabled={disabled}
            checked={value.targetMode === "idea"}
            aria-invalid={fieldErrors?.targetMode != null ? "true" : undefined}
            onChange={() => {
              setMode("idea");
            }}
          />
          <span>人数だけ指定してアイデアを見る</span>
        </label>
      </div>
      {fieldErrors?.targetMode != null && (
        <p id={targetModeErrorId} role="alert">
          {fieldErrors.targetMode}
        </p>
      )}
      {!hasEligibleMembers && (
        <p id="audience-household-disabled-reason" className="wizard-disabled-reason" role="note">
          {eligibleMembers.length === 0
            ? "家族設定がまだないため、「家族に合わせて作る」は選べません。"
            : "献立に使える家族がいないため、「家族に合わせて作る」は選べません。アレルギー確認などが未完了の家族は下の一覧で理由を確認できます。"}{" "}
          <Link className="secondary-button min-h-11" to="/settings">
            家族を追加する
          </Link>
        </p>
      )}
      {value.targetMode === "household" && (
        <div
          ref={membersGroupRef}
          className="stack"
          aria-describedby={fieldErrors?.targetMemberIds != null ? membersErrorId : undefined}
        >
          {eligibleMembers.map((member) => {
            const isBlocked = member.blockedReason !== null;
            const descriptionId = `audience-member-${member.id}-description`;
            return (
              <div key={member.id} className="wizard-option-block">
                <label className="wizard-option">
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
                        ? [
                            ...value.targetMemberIds.filter((id) => selectableIds.has(id)),
                            member.id,
                          ]
                        : value.targetMemberIds.filter((id) => id !== member.id);
                      onChange({ ...value, targetMemberIds: nextIds });
                    }}
                  />
                  <span>
                    {member.displayName}
                    <span className="wizard-option-meta">（{memberSafetyText(member)}）</span>
                  </span>
                </label>
                <p id={descriptionId} className="wizard-option-description">
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
          <div className="wizard-chip-row" role="group" aria-label="人数（1〜6人）">
            {ideaButtonServings.map((count) => (
              <button
                key={count}
                className="wizard-chip"
                type="button"
                disabled={disabled}
                aria-pressed={value.servings === count}
                aria-invalid={servingsError !== null ? "true" : undefined}
                onClick={() => {
                  onChange({ ...value, servings: count });
                }}
              >
                {count}人
              </button>
            ))}
          </div>
          <label className="field">
            7人以上（20人まで）
            <select
              value={value.servings !== null && value.servings >= 7 ? String(value.servings) : ""}
              disabled={disabled}
              aria-invalid={servingsError !== null ? "true" : undefined}
              aria-describedby={servingsError !== null ? servingsErrorId : undefined}
              ref={servingsSelectRef}
              onChange={(event) => {
                const raw = event.target.value;
                onChange({ ...value, servings: raw === "" ? null : Number(raw) });
              }}
            >
              <option value="">選ばない</option>
              {ideaSelectServings.map((count) => (
                <option key={count} value={count}>
                  {count}人
                </option>
              ))}
            </select>
          </label>
          {servingsError !== null && (
            <p id={servingsErrorId} role="alert">
              {servingsError}
            </p>
          )}
        </div>
      )}
      <div className="wizard-actions">
        {onBack !== undefined && (
          <button
            className="wizard-action secondary-button"
            type="button"
            disabled={disabled}
            onClick={onBack}
          >
            {backLabel}
          </button>
        )}
        <button
          className="wizard-action primary-button"
          type="button"
          disabled={disabled || !isComplete}
          onClick={handleNext}
        >
          {nextLabel}
        </button>
      </div>
    </section>
  );
}
