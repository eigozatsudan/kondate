import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { PLANNER_TARGET_MEMBER_LIMIT, type TargetMode } from "@shared/contracts/planner";
import { useAppToast } from "@/shared/ui/app-toast";
import { Button } from "@/shared/ui/button";
import { Inset, Stack } from "@/shared/ui/stack";
import { Surface } from "@/shared/ui/surface";
import { CurrentSafetySummary } from "../current-safety-summary";
import { normalizeAudienceForModeChange } from "../model/planner-wizard";
import { memberSafetyText, type PlannerSafetyMember } from "../planner-safety-member";
import type { PlannerStepProps } from "./planner-wizard-props";
const ideaButtonServings = [1, 2, 3, 4, 5, 6] as const;
/** 7〜20人。1〜6人はチップで選ぶため、プルダウンは7人以上だけを持つ。 */
const ideaSelectServings = Array.from({ length: 14 }, (_, index) => index + 7);

/** incomplete「次へ」の toast / inline 共用文言（設計 §6.3 ロック） */
const modeIncompleteMessage = "作る相手の選び方を選んでください";
const householdZeroMessage = "献立に合わせる家族を1人以上選んでください";
const servingsIncompleteMessage = "人数を選んでください";

/** チェック一覧の判断用注記（設計 §6.2） */
const listReferenceNote =
  "一覧の表示は選ぶときの参考です。チェックしていない人の条件は献立に入りません。";
/** 選択 1 人以上のサマリー注記（CurrentSafetySummary 本体には埋め込まず sibling） */
const selectedOnlyNote =
  "ここに出ている条件だけが献立に使われます。選んでいない家族は含まれません。";

type IncompleteField = "targetMode" | "targetMemberIds" | "servings";

export type AudienceValue = {
  targetMode: TargetMode | null;
  targetMemberIds: readonly string[];
  servings: number | null;
};

export type AudienceStepProps = Omit<PlannerStepProps<AudienceValue>, "disabled"> & {
  eligibleMembers: readonly PlannerSafetyMember[];
  /** 親の isSaving 等。incomplete 判定では使わず、押下可否はこれだけ */
  disabled?: boolean;
  fieldErrors?: {
    targetMode?: string | null;
    targetMemberIds?: string | null;
    servings?: string | null;
  };
  /**
   * true のとき incomplete 押下で toast を出さない（inline + focus のみ）。
   * wizard が autosaveState === "error" のとき渡す。
   */
  suppressValidationToast?: boolean;
  /**
   * 家族設定へ遷移。route が flush 後 navigate する（P5）。
   * 未指定時は Link 直遷移。
   */
  onOpenSettings?: () => void;
};

/**
 * 「作る相手」を決めるstep。household（家族から選ぶ）とidea（人数だけ指定する）の
 * 2モードを切り替え可能にし、モード切替時は必ず normalizeAudienceForModeChange で
 * 3フィールドを整合させる。DOM 順は idea → household →（household 時）ヒント → チェック →
 * 選択中のみの安全サマリー（設計 L9 / §6.2）。
 */
export function AudienceStep({
  value,
  onChange,
  onBack,
  onNext,
  disabled = false,
  eligibleMembers,
  fieldErrors,
  suppressValidationToast = false,
  onOpenSettings,
  nextLabel = "次へ",
  backLabel = "戻る",
}: AudienceStepProps) {
  const { show: showToast, dismiss: dismissToast } = useAppToast();
  const [incompleteField, setIncompleteField] = useState<IncompleteField | null>(null);
  const [incompleteMessage, setIncompleteMessage] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const servingsSelectRef = useRef<HTMLSelectElement>(null);
  const servingsChipRowRef = useRef<HTMLDivElement>(null);
  const targetModeGroupRef = useRef<HTMLDivElement>(null);
  const membersGroupRef = useRef<HTMLDivElement>(null);

  // GP-I3: 親が fieldErrors を載せて step を戻したときは見出しではなく無効フィールドへ
  useEffect(() => {
    if (fieldErrors?.targetMode) {
      targetModeGroupRef.current?.querySelector<HTMLElement>("input:not([disabled])")?.focus();
      return;
    }
    if (fieldErrors?.targetMemberIds) {
      membersGroupRef.current
        ?.querySelector<HTMLElement>("input[type=checkbox]:not([disabled])")
        ?.focus();
      return;
    }
    if (fieldErrors?.servings) {
      // 7+ は select 優先、それ以外はチップ先頭（設計 §6.3）
      if (value.servings !== null && value.servings >= 7) {
        servingsSelectRef.current?.focus();
      } else {
        servingsChipRowRef.current
          ?.querySelector<HTMLButtonElement>("button:not([disabled])")
          ?.focus();
      }
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
  const selectedSelectableCount = value.targetMemberIds.filter((id) =>
    selectableIds.has(id),
  ).length;
  // 確認画面と同じく「今回の対象」だけをサマリーに出す（eligible 全員は誤認源）
  const selectedSafetyMembers = selectableMembers.filter((member) =>
    value.targetMemberIds.includes(member.id),
  );

  // incomplete の原因が解消されたらインラインだけ clear（toast は next 成功 / unmount）
  useEffect(() => {
    if (incompleteField === null) return;
    if (incompleteField === "targetMode" && value.targetMode !== null) {
      setIncompleteField(null);
      setIncompleteMessage(null);
      return;
    }
    if (incompleteField === "targetMemberIds" && selectedSelectableCount > 0) {
      setIncompleteField(null);
      setIncompleteMessage(null);
      return;
    }
    if (incompleteField === "servings" && value.servings !== null) {
      setIncompleteField(null);
      setIncompleteMessage(null);
    }
  }, [value.targetMode, value.servings, selectedSelectableCount, incompleteField]);

  // step 離脱（unmount）で validation toast を残さない
  useEffect(() => {
    return () => {
      dismissToast();
    };
  }, [dismissToast]);

  const draftLike = {
    // normalizeAudienceForModeChange は PlannerDraftInput 全体を受け取るため、
    // audience 以外のフィールドはこのstepでは使わないダミー値で満たす。
    mealType: null,
    mainIngredients: [],
    cuisineGenre: null,
    timeLimitMinutes: null,
    budgetPreference: null,
    ingredientPreference: null,
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

  const targetModeErrorId = "audience-target-mode-error";
  const membersErrorId = "audience-members-error";
  const servingsErrorId = "audience-servings-error";
  const householdHintId = "audience-household-required-hint";
  const listNoteId = "audience-list-reference-note";

  const modeError =
    (incompleteField === "targetMode" ? incompleteMessage : null) ??
    fieldErrors?.targetMode ??
    null;
  const membersError =
    (incompleteField === "targetMemberIds" ? incompleteMessage : null) ??
    fieldErrors?.targetMemberIds ??
    null;
  // 7人以上はプルダウンなので範囲外の値そのものが表現できない。残るservings errorは
  // 親（下書き復元・サーバ検証）由来のものだけで、その場合は該当fieldへfocusを移す。
  const servingsError =
    (incompleteField === "servings" ? incompleteMessage : null) ?? fieldErrors?.servings ?? null;

  const focusFirstEnabledModeRadio = (): void => {
    targetModeGroupRef.current?.querySelector<HTMLInputElement>("input:not([disabled])")?.focus();
  };
  const focusFirstEnabledMemberCheckbox = (): void => {
    membersGroupRef.current
      ?.querySelector<HTMLInputElement>("input[type=checkbox]:not([disabled])")
      ?.focus();
  };
  const focusServingsControl = (): void => {
    // 設計 §6.3: servings null → チップ先頭。7+ 値なら select 優先。
    if (value.servings !== null && value.servings >= 7) {
      servingsSelectRef.current?.focus();
      return;
    }
    servingsChipRowRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
  };

  const reportIncomplete = (field: IncompleteField, message: string): void => {
    setIncompleteField(field);
    setIncompleteMessage(message);
    if (!suppressValidationToast) {
      showToast({ message, tone: "error" });
    }
  };

  const handleNext = (): void => {
    if (value.targetMode === null) {
      reportIncomplete("targetMode", modeIncompleteMessage);
      focusFirstEnabledModeRadio();
      return;
    }
    if (value.targetMode === "household" && selectedSelectableCount === 0) {
      reportIncomplete("targetMemberIds", householdZeroMessage);
      focusFirstEnabledMemberCheckbox();
      return;
    }
    if (value.targetMode === "idea" && value.servings === null) {
      reportIncomplete("servings", servingsIncompleteMessage);
      focusServingsControl();
      return;
    }
    // 親由来の servings 範囲エラーだけ残る場合は toast なしで select へ（既存 GP-I3）
    if (value.targetMode === "idea" && fieldErrors?.servings != null) {
      focusServingsControl();
      return;
    }
    setIncompleteField(null);
    setIncompleteMessage(null);
    dismissToast();
    onNext();
  };

  return (
    <section aria-labelledby="audience-step-title">
      <Surface>
        <Inset pad={5}>
          <Stack gap={5}>
            <h2 id="audience-step-title" tabIndex={-1} ref={headingRef}>
              4. 作る相手
            </h2>
            {/* idea では家族安全条件を見せない（安全確認済みと誤認させない・C-I3 / §3.1）
          未選択で全員 blocked のときだけ理由一覧を出す（household 選択前の説明）。 */}
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
              aria-describedby={modeError != null ? targetModeErrorId : undefined}
            >
              {/* 設計 L9: idea を上、household を下 */}
              <label className="wizard-option">
                <input
                  type="radio"
                  name="audience-mode"
                  disabled={disabled}
                  checked={value.targetMode === "idea"}
                  aria-invalid={modeError != null ? "true" : undefined}
                  onChange={() => {
                    setMode("idea");
                  }}
                />
                <span>人数だけ指定してアイデアを見る</span>
              </label>
              <label className="wizard-option">
                <input
                  type="radio"
                  name="audience-mode"
                  disabled={disabled || !hasEligibleMembers}
                  checked={value.targetMode === "household"}
                  aria-invalid={modeError != null ? "true" : undefined}
                  aria-describedby={
                    !hasEligibleMembers
                      ? "audience-household-disabled-reason"
                      : modeError != null
                        ? targetModeErrorId
                        : undefined
                  }
                  onChange={() => {
                    setMode("household");
                  }}
                />
                <span>家族に合わせて作る</span>
              </label>
            </div>
            {modeError != null && (
              <p id={targetModeErrorId} role="alert">
                {modeError}
              </p>
            )}
            {!hasEligibleMembers && (
              <p
                id="audience-household-disabled-reason"
                className="wizard-disabled-reason"
                role="note"
              >
                {eligibleMembers.length === 0
                  ? "家族設定がまだないため、「家族に合わせて作る」は選べません。"
                  : "献立に使える家族がいないため、「家族に合わせて作る」は選べません。アレルギー確認などが未完了の家族は下の一覧で理由を確認できます。"}{" "}
                {onOpenSettings !== undefined ? (
                  <Button variant="secondary" disabled={disabled} onClick={onOpenSettings}>
                    家族を追加する
                  </Button>
                ) : (
                  <Link className="secondary-button min-h-11" to="/settings">
                    家族を追加する
                  </Link>
                )}
              </p>
            )}
            {value.targetMode === "household" && (
              <>
                {/* 0 人: チェック必須を強調。1 人以上: 短い note に格下げ（§6.2 / U3-M3） */}
                <p
                  id={householdHintId}
                  className={
                    selectedSelectableCount === 0
                      ? "wizard-required-hint"
                      : "wizard-option-description"
                  }
                  role="note"
                >
                  {selectedSelectableCount === 0
                    ? householdZeroMessage
                    : "選んだ家族の条件で献立を作ります。"}
                </p>
                <div
                  ref={membersGroupRef}
                  className="ui-stack ui-stack--gap-4"
                  aria-describedby={
                    [householdHintId, listNoteId, membersError != null ? membersErrorId : null]
                      .filter((id): id is string => id != null)
                      .join(" ") || undefined
                  }
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
                                selectedSelectableCount >= PLANNER_TARGET_MEMBER_LIMIT)
                            }
                            aria-describedby={descriptionId}
                            aria-invalid={membersError != null ? "true" : undefined}
                            checked={value.targetMemberIds.includes(member.id) && !isBlocked}
                            onChange={(event) => {
                              if (isBlocked) return;
                              // P8: disable だけでなく live 配列も LIMIT で slice（hydrate sanitize と同型）。
                              // 連打・非 UI onDraftChange 注入で 21 件超が wizard state に残る窓を閉じる。
                              const nextIds = event.target.checked
                                ? [
                                    ...value.targetMemberIds.filter((id) => selectableIds.has(id)),
                                    member.id,
                                  ].slice(0, PLANNER_TARGET_MEMBER_LIMIT)
                                : value.targetMemberIds.filter((id) => id !== member.id);
                              onChange({ ...value, targetMemberIds: nextIds });
                            }}
                          />
                          <span>
                            {member.displayName}
                            <span className="wizard-option-meta">
                              （{memberSafetyText(member)}）
                            </span>
                          </span>
                        </label>
                        <p id={descriptionId} className="wizard-option-description">
                          {isBlocked ? member.blockedReason : memberSafetyText(member)}
                        </p>
                      </div>
                    );
                  })}
                  {membersError != null && (
                    <p id={membersErrorId} role="alert">
                      {membersError}
                    </p>
                  )}
                </div>
                <p id={listNoteId} className="wizard-option-description" role="note">
                  {listReferenceNote}
                </p>
                {/*
            ラジオ上の全員サマリーは削除。選択 0 件も CurrentSafetySummary の empty 本文へ寄せ、
            CTA disabled / disclaimer の drift を防ぐ（P9/P10）。selectedOnlyNote は sibling のみ。
          */}
                <CurrentSafetySummary
                  members={selectedSafetyMembers}
                  disabled={disabled}
                  {...(onOpenSettings !== undefined ? { onOpenSettings } : {})}
                />
                {selectedSafetyMembers.length > 0 ? (
                  <p className="wizard-option-description" role="note">
                    {selectedOnlyNote}
                  </p>
                ) : null}
              </>
            )}
            {value.targetMode === "idea" && (
              <div
                className="ui-stack ui-stack--gap-4"
                aria-describedby={servingsError !== null ? servingsErrorId : undefined}
              >
                <p>人数</p>
                <div
                  ref={servingsChipRowRef}
                  className="wizard-chip-row"
                  role="group"
                  aria-label="人数（1〜6人）"
                >
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
                    value={
                      value.servings !== null && value.servings >= 7 ? String(value.servings) : ""
                    }
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
                <Button variant="secondary" disabled={disabled} onClick={onBack}>
                  {backLabel}
                </Button>
              )}
              <Button
                variant="primary"
                // incomplete では止めない。親の isSaving / idea 確定中だけ disabled。
                disabled={disabled}
                onClick={handleNext}
              >
                {nextLabel}
              </Button>
            </div>
          </Stack>
        </Inset>
      </Surface>
    </section>
  );
}
