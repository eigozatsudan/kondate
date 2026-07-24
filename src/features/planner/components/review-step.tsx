import { useEffect, useRef, useState } from "react";
import type { PantryItem } from "@shared/contracts/pantry";
import { collectPlannerRequestText, type PlannerDraftInput } from "@shared/contracts/planner";
import { detectUnsupportedMedicalRequest } from "@shared/safety/medical-scope";
import type { PlannerAttempt } from "../expired-pantry-checks";
import { CurrentSafetySummary } from "../current-safety-summary";
import { cuisineGenreLabel, mealLabel } from "../model/planner-labels";
import { PantrySelector, type PantryItemsStatus } from "../pantry-selector";
import type { PlannerSafetyMember } from "../planner-safety-member";
import type { PlannerStepProps } from "./planner-wizard-props";

/** Plan 2 由来の医療・治療食依頼拒否コピー（旧 PlannerForm と同一文言） */
export const medicalRequestBlockedMessage =
  "離乳食、飲み込み・嚥下、治療食の依頼には対応できません。専門職の指示に従ってください。";

const avoidIngredientLimit = 20;
const avoidIngredientLengthLimit = 80;

/**
 * 既存 planner-page.tsx の parseAvoidIngredientInput をreview stepでも再利用する。
 * 全角/半角混在の区切り文字（、,）を正規化し、80文字制限・20件制限を維持する。
 */
function parseAvoidIngredientInput(rawValue: string): {
  text: string;
  items: string[];
  hasTooManyItems: boolean;
  hasTooLongItem: boolean;
} {
  const segments = rawValue.split(/[、,]/u).map((segment) => segment.normalize("NFKC"));
  const normalizedItems = segments.map((segment) => segment.trim()).filter((item) => item !== "");
  const hasTooManyItems = normalizedItems.length > avoidIngredientLimit;
  const hasTooLongItem = normalizedItems.some(
    (item) => Array.from(item).length > avoidIngredientLengthLimit,
  );
  const items = normalizedItems
    .slice(0, avoidIngredientLimit)
    .map((item) => Array.from(item).slice(0, avoidIngredientLengthLimit).join(""));
  if (hasTooManyItems) {
    return { text: items.join("、"), items, hasTooManyItems, hasTooLongItem };
  }
  return {
    text: segments
      .map((segment) => {
        const trimmed = segment.trim();
        if (Array.from(trimmed).length <= avoidIngredientLengthLimit) return segment;
        return Array.from(trimmed).slice(0, avoidIngredientLengthLimit).join("");
      })
      .join("、"),
    items,
    hasTooManyItems,
    hasTooLongItem,
  };
}

export type ReviewFieldErrors = Partial<
  Record<
    "timeLimitMinutes" | "budgetPreference" | "avoidIngredients" | "memo" | "pantrySelections",
    string
  >
>;

export type ReviewStepProps = PlannerStepProps<PlannerDraftInput> & {
  pantryItems: readonly PantryItem[];
  pantryItemsStatus: PantryItemsStatus;
  attempt: PlannerAttempt;
  onAttemptChange: (next: PlannerAttempt) => void;
  fieldErrors?: ReviewFieldErrors;
  summaryError?: string | null;
  hasAcceptedOrDeclinedPrivacy: boolean;
  onOpenPrivacyNotice: () => void;
  onSubmit: () => void;
  /** 家族モードの安全要約表示用。idea でも免責文を見せるため渡す。 */
  safetyMembers?: readonly PlannerSafetyMember[];
  /**
   * 設計 §5.1: AI を使わない緊急献立への導線。
   * route が flush→navigate を所有するため、ここはクリック通知だけを受け取る。
   * 未指定ならボタン自体を出さない（meal 等の step では渡さない）。
   */
  onOpenEmergencyMenus?: () => void;
};

/**
 * 任意条件（時間・予算・避ける食材・memo・pantry選択）をdetailsから開き、
 * 生成直前の最終確認と送信を担うstep。
 * privacy確認が済んでいない場合は生成buttonをdisabledにし、説明linkを表示する
 * （brief step 9: 「reviewはprivacy query未確認なら生成buttonをdisabledにして説明linkを表示する」）。
 */
export function ReviewStep({
  value,
  onChange,
  onBack,
  disabled,
  pantryItems,
  pantryItemsStatus,
  attempt,
  onAttemptChange,
  fieldErrors,
  summaryError,
  hasAcceptedOrDeclinedPrivacy,
  onOpenPrivacyNotice,
  onSubmit,
  safetyMembers = [],
  onOpenEmergencyMenus,
}: ReviewStepProps) {
  const [avoidIngredientText, setAvoidIngredientText] = useState(value.avoidIngredients.join("、"));
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const pantryItemIds = new Set(pantryItems.map((item) => item.id));
  const hasUnavailablePantrySelections =
    pantryItemsStatus === "loaded" &&
    value.pantrySelections.some((selection) => !pantryItemIds.has(selection.pantryItemId));
  // Plan 2: AI 送信前のクライアント医療境界。サーバー preflight と同一 detector を使う。
  const medicalBlocked =
    detectUnsupportedMedicalRequest(collectPlannerRequestText(value)).length > 0;
  const generateDisabled =
    disabled || !hasAcceptedOrDeclinedPrivacy || hasUnavailablePantrySelections || medicalBlocked;
  return (
    <section className="card stack" aria-labelledby="review-step-title">
      <h2 id="review-step-title" tabIndex={-1} ref={headingRef}>
        5. 確認
      </h2>
      {value.targetMode === "household" && safetyMembers.length > 0 && (
        <CurrentSafetySummary members={safetyMembers} />
      )}
      <dl className="wizard-review-list">
        <div className="wizard-review-item">
          <dt>食事</dt>
          <dd>{mealLabel(value.mealType)}</dd>
        </div>
        <div className="wizard-review-item">
          <dt>メイン食材</dt>
          <dd>{value.mainIngredients.join("・")}</dd>
        </div>
        <div className="wizard-review-item">
          <dt>ジャンル</dt>
          <dd>{cuisineGenreLabel(value.cuisineGenre)}</dd>
        </div>
        <div className="wizard-review-item">
          <dt>対象</dt>
          <dd>
            {value.targetMode === "idea"
              ? value.servings === null
                ? "アイデア（人数未設定）"
                : `アイデア・${String(value.servings)}人分`
              : value.targetMode === "household"
                ? `家族に合わせる（${String(value.targetMemberIds.length)}人）`
                : "未選択"}
          </dd>
        </div>
      </dl>
      <details className="wizard-details">
        <summary className="wizard-details-summary">追加条件</summary>
        {/* summary 直下に stack を置き、label/input が横に流れないよう縦積みにする */}
        <div className="stack wizard-details-body">
          <label className="field">
            献立全体の調理時間
            <select
              value={value.timeLimitMinutes ?? ""}
              disabled={disabled}
              aria-invalid={fieldErrors?.timeLimitMinutes != null ? "true" : undefined}
              aria-describedby={
                fieldErrors?.timeLimitMinutes != null ? "review-time-limit-error" : undefined
              }
              onChange={(event) => {
                const selected = event.target.value;
                onChange({
                  ...value,
                  timeLimitMinutes:
                    selected === "" ? null : selected === "15" ? 15 : selected === "30" ? 30 : 45,
                });
              }}
            >
              <option value="">指定なし</option>
              <option value="15">15分以内</option>
              <option value="30">30分以内</option>
              <option value="45">45分以内</option>
            </select>
          </label>
          {fieldErrors?.timeLimitMinutes != null && (
            <p id="review-time-limit-error" role="alert">
              {fieldErrors.timeLimitMinutes}
            </p>
          )}
          <label className="field">
            予算
            <select
              value={value.budgetPreference ?? ""}
              disabled={disabled}
              aria-invalid={fieldErrors?.budgetPreference != null ? "true" : undefined}
              aria-describedby={
                fieldErrors?.budgetPreference != null ? "review-budget-error" : undefined
              }
              onChange={(event) => {
                onChange({
                  ...value,
                  budgetPreference:
                    event.target.value === "economy"
                      ? "economy"
                      : event.target.value === "standard"
                        ? "standard"
                        : null,
                });
              }}
            >
              <option value="">指定なし</option>
              <option value="economy">節約優先</option>
              <option value="standard">標準</option>
            </select>
          </label>
          {fieldErrors?.budgetPreference != null && (
            <p id="review-budget-error" role="alert">
              {fieldErrors.budgetPreference}
            </p>
          )}
          <label className="field">
            今回だけ避ける食材
            <input
              value={avoidIngredientText}
              disabled={disabled}
              aria-invalid={fieldErrors?.avoidIngredients != null ? "true" : undefined}
              aria-describedby={
                fieldErrors?.avoidIngredients != null ? "review-avoid-ingredients-error" : undefined
              }
              onChange={(event) => {
                const parsed = parseAvoidIngredientInput(event.target.value);
                setAvoidIngredientText(parsed.text);
                if (
                  parsed.items.length !== value.avoidIngredients.length ||
                  parsed.items.some((item, index) => item !== value.avoidIngredients[index])
                ) {
                  onChange({ ...value, avoidIngredients: parsed.items });
                }
              }}
            />
          </label>
          {fieldErrors?.avoidIngredients != null && (
            <p id="review-avoid-ingredients-error" role="alert">
              {fieldErrors.avoidIngredients}
            </p>
          )}
          <label className="field">
            自由メモ
            <textarea
              maxLength={200}
              value={value.memo}
              disabled={disabled}
              aria-invalid={fieldErrors?.memo != null ? "true" : undefined}
              aria-describedby={fieldErrors?.memo != null ? "review-memo-error" : undefined}
              onChange={(event) => {
                onChange({ ...value, memo: event.target.value });
              }}
            />
          </label>
          {fieldErrors?.memo != null && (
            <p id="review-memo-error" role="alert">
              {fieldErrors.memo}
            </p>
          )}
          <PantrySelector
            items={pantryItems}
            itemsStatus={pantryItemsStatus}
            selections={value.pantrySelections}
            attempt={attempt}
            onAttemptChange={onAttemptChange}
            disabled={disabled}
            onChange={(pantrySelections) => {
              onChange({ ...value, pantrySelections: [...pantrySelections] });
            }}
          />
          {fieldErrors?.pantrySelections != null && (
            <p id="review-pantry-selections-error" role="alert">
              {fieldErrors.pantrySelections}
            </p>
          )}
        </div>
      </details>
      {hasUnavailablePantrySelections && (
        <p role="alert">冷蔵庫から削除された食材の選択を解除してから献立を作ってください。</p>
      )}
      {medicalBlocked && <p role="alert">{medicalRequestBlockedMessage}</p>}
      {!hasAcceptedOrDeclinedPrivacy && (
        <p>
          AI情報の説明をまだ確認していません。
          <button type="button" onClick={onOpenPrivacyNotice}>
            AI情報の説明を見る
          </button>
        </p>
      )}
      {summaryError != null && <p role="alert">{summaryError}</p>}
      {/* 設計 §5.3: idea 注意は主操作直前。summary / 追加条件 / privacy より下に置く */}
      {value.targetMode === "idea" && (
        <p role="note">
          家族の年齢・アレルギーは確認されません。この献立はアイデアとして作成します。
        </p>
      )}
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
          disabled={generateDisabled}
          onClick={onSubmit}
        >
          献立を作る
        </button>
      </div>
      {onOpenEmergencyMenus !== undefined && (
        <button
          className="wizard-action secondary-button"
          type="button"
          disabled={disabled}
          onClick={onOpenEmergencyMenus}
        >
          AIを使わない緊急献立を見る
        </button>
      )}
    </section>
  );
}
