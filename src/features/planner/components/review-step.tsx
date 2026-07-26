import { useEffect, useRef, useState } from "react";
import type { PantryItem } from "@shared/contracts/pantry";
import { collectPlannerRequestText, type PlannerDraftInput } from "@shared/contracts/planner";
import { detectUnsupportedMedicalRequest } from "@shared/safety/medical-scope";
import type { PlannerAttempt } from "../expired-pantry-checks";
import { CurrentSafetySummary } from "../current-safety-summary";
import { cuisineGenreLabel, mealLabel } from "../model/planner-labels";
import { PantrySelector, type PantryItemsStatus } from "../pantry-selector";
import type { PlannerSafetyMember } from "../planner-safety-member";
import type { PlannerStep } from "../model/planner-wizard";
import type { PlannerStepProps } from "./planner-wizard-props";

/** Plan 2 由来の医療・治療食依頼拒否コピー（旧 PlannerForm と同一文言） */
export const medicalRequestBlockedMessage =
  "離乳食、飲み込み・嚥下、治療食の依頼には対応できません。専門職の指示に従ってください。";

const avoidIngredientLimit = 20;
const avoidIngredientLengthLimit = 80;

/**
 * parseAvoidIngredientInput を review step でも共有する。
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
   * idea モードでは CTA を出さず案内文のみ（緊急献立は家族対象を要する）。
   */
  onOpenEmergencyMenus?: () => void;
  /** GET /api/usage/today の成功残数。未取得時は null（偽の残数を出さない） */
  usageRemaining?: number | null;
  /**
   * 日次 attempt 残（外部 AI 送信枠）。未取得は null。
   * C-I12 residual: 0 のとき主 CTA を止める。null では止めない。
   */
  attemptsRemaining?: number | null;
  /**
   * アプリ全体の受付可否。未取得は null。
   * C-I12 residual: false のとき主 CTA を止める。null では止めない。
   */
  globalAvailable?: boolean | null;
  /** short-window 残 0 のときの再開時刻 ISO。null なら短時間枠メッセージを出さない */
  shortWindowRetryAt?: string | null;
  /**
   * 確認画面から質問 step へ直接戻る。戻るボタン（1ページずつ）とは別に、
   * 食事・食材・ジャンル・対象をその場で直せるようにする。
   * review 自身への遷移は呼ばない。
   */
  onEditStep?: (step: Exclude<PlannerStep, "review">) => void;
};

/** privacy 未確認のまま生成を押したときのダイアログ本文 */
export const privacyNoticeRequiredMessage =
  "献立を作る前に、AI情報の説明を確認してください。「AI情報の説明を見る」を押してください。";

/**
 * 任意条件（時間・予算・避ける食材・memo・pantry選択）をdetailsから開き、
 * 生成直前の最終確認と送信を担うstep。
 * privacy 未確認時は「AI情報の説明を見る」を secondary ボタンで明示し、
 * 「献立を作る」押下では生成せず alertdialog で同じ操作へ誘導する
 * （disabled のままでは押下フィードバックが無いため、見た目有効＋ダイアログで案内する）。
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
  usageRemaining = null,
  attemptsRemaining = null,
  globalAvailable = null,
  shortWindowRetryAt = null,
  onEditStep,
}: ReviewStepProps) {
  const [avoidIngredientText, setAvoidIngredientText] = useState(value.avoidIngredients.join("、"));
  // 生成ボタン押下時の privacy 未確認ダイアログ。同意後や閉じる操作で消す。
  const [privacyGateOpen, setPrivacyGateOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const privacyNoticeButtonRef = useRef<HTMLButtonElement>(null);
  const privacyGatePrimaryRef = useRef<HTMLButtonElement>(null);
  const privacyGateCloseRef = useRef<HTMLButtonElement>(null);
  const privacyGateDescriptionId = "privacy-gate-description";
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  // 同意が付いたらダイアログを残さない
  useEffect(() => {
    if (hasAcceptedOrDeclinedPrivacy) setPrivacyGateOpen(false);
  }, [hasAcceptedOrDeclinedPrivacy]);
  // ダイアログ表示時は主ボタンへフォーカス（pantry 期限切れ alertdialog と同じ）
  useEffect(() => {
    if (privacyGateOpen) privacyGatePrimaryRef.current?.focus();
  }, [privacyGateOpen]);
  const pantryItemIds = new Set(pantryItems.map((item) => item.id));
  const hasUnavailablePantrySelections =
    pantryItemsStatus === "loaded" &&
    value.pantrySelections.some((selection) => !pantryItemIds.has(selection.pantryItemId));
  // Plan 2: AI 送信前のクライアント医療境界。サーバー preflight と同一 detector を使う。
  const medicalBlocked =
    detectUnsupportedMedicalRequest(collectPlannerRequestText(value)).length > 0;
  // privacy 未確認だけでは disabled にしない（押下で案内を出す）。
  // C-I12 residual: 成功残 0 / attempt 残 0 / global 不可で主 CTA を止める。
  // I2: shortWindowRetryAt は route が remaining===0 のときだけ渡す active blocker。
  // 端末時計での再有効化はせず、usage 再取得で retryAt が消えたときだけ有効に戻す。
  // null/未取得では誤って止めない。
  const generateDisabled =
    disabled ||
    hasUnavailablePantrySelections ||
    medicalBlocked ||
    usageRemaining === 0 ||
    attemptsRemaining === 0 ||
    globalAvailable === false ||
    shortWindowRetryAt !== null;
  const closePrivacyGate = (): void => {
    setPrivacyGateOpen(false);
  };
  // 確認では「今回の献立の対象」だけを出す。eligible 全員だと未選択の家族まで
  // 安全条件が並び、誰向けか誤読されやすい。
  const targetSafetyMembers =
    value.targetMode === "household"
      ? safetyMembers.filter((member) => value.targetMemberIds.includes(member.id))
      : [];
  return (
    <section className="card stack" aria-labelledby="review-step-title">
      <h2 id="review-step-title" tabIndex={-1} ref={headingRef}>
        5. 確認
      </h2>
      {targetSafetyMembers.length > 0 && <CurrentSafetySummary members={targetSafetyMembers} />}
      <dl className="wizard-review-list">
        {/*
          項目名 | 回答。変更ボタンは dd 内に置き definition-list を満たす。
          操作対象は aria-label で一意にする（getByRole 用）。
        */}
        <div className="wizard-review-item">
          <dt>食事</dt>
          <dd className="review-answer-cell">
            <span>{mealLabel(value.mealType)}</span>
            {onEditStep !== undefined && (
              <button
                className="text-button min-h-11 review-edit-action"
                type="button"
                disabled={disabled}
                aria-label="食事を変更"
                onClick={() => {
                  onEditStep("meal");
                }}
              >
                変更
              </button>
            )}
          </dd>
        </div>
        <div className="wizard-review-item">
          <dt>メイン食材</dt>
          <dd className="review-answer-cell">
            <span>
              {value.mainIngredients.length === 0 ? "未選択" : value.mainIngredients.join("・")}
            </span>
            {onEditStep !== undefined && (
              <button
                className="text-button min-h-11 review-edit-action"
                type="button"
                disabled={disabled}
                aria-label="メイン食材を変更"
                onClick={() => {
                  onEditStep("ingredients");
                }}
              >
                変更
              </button>
            )}
          </dd>
        </div>
        <div className="wizard-review-item">
          <dt>ジャンル</dt>
          <dd className="review-answer-cell">
            <span>{cuisineGenreLabel(value.cuisineGenre)}</span>
            {onEditStep !== undefined && (
              <button
                className="text-button min-h-11 review-edit-action"
                type="button"
                disabled={disabled}
                aria-label="ジャンルを変更"
                onClick={() => {
                  onEditStep("cuisine");
                }}
              >
                変更
              </button>
            )}
          </dd>
        </div>
        <div className="wizard-review-item">
          <dt>対象</dt>
          <dd className="review-answer-cell">
            <span>
              {value.targetMode === "idea"
                ? value.servings === null
                  ? "アイデア（人数未設定）"
                  : `アイデア・${String(value.servings)}人分`
                : value.targetMode === "household"
                  ? `家族に合わせる（${String(value.targetMemberIds.length)}人）`
                  : "未選択"}
            </span>
            {onEditStep !== undefined && (
              <button
                className="text-button min-h-11 review-edit-action"
                type="button"
                disabled={disabled}
                aria-label="対象を変更"
                onClick={() => {
                  onEditStep("audience");
                }}
              >
                変更
              </button>
            )}
          </dd>
        </div>
      </dl>
      {onEditStep !== undefined && (
        <p className="type-small">
          「戻る」で1つ前の質問へ、「変更」でその質問へ直接戻れます。直したあとは「確認に戻る」でこの画面に戻ります。
        </p>
      )}
      {/*
        C-C2: 生成を止めるエラーの直しどころ（pantry 解除・医療メモ）が閉じた details 内に
        隠れると操作不能に見える。ブロック中は open にして常に見えるようにする。
      */}
      <details
        className="wizard-details"
        open={
          hasUnavailablePantrySelections ||
          medicalBlocked ||
          fieldErrors?.timeLimitMinutes != null ||
          fieldErrors?.budgetPreference != null ||
          fieldErrors?.avoidIngredients != null ||
          fieldErrors?.memo != null ||
          fieldErrors?.pantrySelections != null
            ? true
            : undefined
        }
      >
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
        <div className="stack privacy-notice-gate">
          <p>AI情報の説明をまだ確認していません。献立を作る前に説明を確認してください。</p>
          <button
            ref={privacyNoticeButtonRef}
            className="wizard-action secondary-button"
            type="button"
            disabled={disabled}
            onClick={() => {
              closePrivacyGate();
              onOpenPrivacyNotice();
            }}
          >
            AI情報の説明を見る
          </button>
        </div>
      )}
      {summaryError != null && <p role="alert">{summaryError}</p>}
      {/* 設計 §5.3: idea 注意は主操作直前。summary / 追加条件 / privacy より下に置く */}
      {value.targetMode === "idea" && (
        <p role="note">
          家族の年齢・アレルギーは確認されません。この献立はアイデアとして作成します。
        </p>
      )}
      {/* 設計 §10.3: 生成ボタン近くにサーバー正の本日残数・attempt・global・短時間枠を平易表示 */}
      {usageRemaining !== null && (
        <p role="status">
          {usageRemaining === 0
            ? "本日の作成回数の上限に達しました。明日またお試しください。"
            : `本日あと${String(usageRemaining)}回作成できます`}
        </p>
      )}
      {attemptsRemaining !== null && (
        <p role="status">
          {attemptsRemaining === 0
            ? "AIへの問い合わせ回数の上限に達しました。明日またお試しください。"
            : `AIへの問い合わせは本日あと${String(attemptsRemaining)}回まで受け付けます`}
        </p>
      )}
      {globalAvailable === false && (
        <p role="status">ただいま混雑しているため、しばらくしてからお試しください。</p>
      )}
      {shortWindowRetryAt !== null && (
        <p role="status">
          しばらく続けて作成を試したため、少し待つ必要があります。
          {new Intl.DateTimeFormat("ja-JP", {
            timeZone: "Asia/Tokyo",
            dateStyle: "short",
            timeStyle: "short",
          }).format(new Date(shortWindowRetryAt))}
          以降に再試行してください
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
          onClick={() => {
            // 同意前は生成を開始せず、ダイアログで説明へ誘導する
            if (!hasAcceptedOrDeclinedPrivacy) {
              setPrivacyGateOpen(true);
              return;
            }
            closePrivacyGate();
            onSubmit();
          }}
        >
          献立を作る
        </button>
      </div>
      {privacyGateOpen && (
        <div
          className="pantry-expired-dialog-backdrop"
          onClick={(event) => {
            // 背景クリックで閉じる（パネル内クリックは伝播させない）
            if (event.target === event.currentTarget) closePrivacyGate();
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="privacy-gate-title"
            aria-describedby={privacyGateDescriptionId}
            className="card stack pantry-expired-dialog-panel"
            onClick={(event) => {
              event.stopPropagation();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closePrivacyGate();
                return;
              }
              if (event.key !== "Tab") return;
              // 2 ボタン間でフォーカストラップ（pantry 期限切れダイアログと同型）
              event.preventDefault();
              if (event.shiftKey) {
                if (document.activeElement === privacyGatePrimaryRef.current) {
                  privacyGateCloseRef.current?.focus();
                } else {
                  privacyGatePrimaryRef.current?.focus();
                }
              } else if (document.activeElement === privacyGateCloseRef.current) {
                privacyGatePrimaryRef.current?.focus();
              } else {
                privacyGateCloseRef.current?.focus();
              }
            }}
          >
            <h2 id="privacy-gate-title">AI情報の説明の確認</h2>
            <p id={privacyGateDescriptionId}>{privacyNoticeRequiredMessage}</p>
            <button
              ref={privacyGatePrimaryRef}
              className="wizard-action primary-button"
              type="button"
              disabled={disabled}
              onClick={() => {
                closePrivacyGate();
                onOpenPrivacyNotice();
              }}
            >
              AI情報の説明を見る
            </button>
            <button
              ref={privacyGateCloseRef}
              className="wizard-action secondary-button"
              type="button"
              onClick={closePrivacyGate}
            >
              閉じる
            </button>
          </div>
        </div>
      )}
      {value.targetMode === "household" && onOpenEmergencyMenus !== undefined && (
        <button
          className="wizard-action secondary-button"
          type="button"
          disabled={disabled}
          onClick={onOpenEmergencyMenus}
        >
          AIを使わない緊急献立を見る
        </button>
      )}
      {value.targetMode === "idea" && onOpenEmergencyMenus !== undefined && (
        <p role="note">
          家族向けの緊急献立は、対象を「家族に合わせて作る」に切り替えたあとで使えます。
        </p>
      )}
    </section>
  );
}
