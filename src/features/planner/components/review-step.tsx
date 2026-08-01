import { useEffect, useRef, useState } from "react";
import type { PantryItem } from "@shared/contracts/pantry";
import { collectPlannerRequestText, type PlannerDraftInput } from "@shared/contracts/planner";
import { formatPlanQuotaCopy } from "@shared/copy/plan-tier";
import type { PlanCode } from "@shared/contracts/plan-quota";
import { detectUnsupportedMedicalRequest } from "@shared/safety-pure/medical-scope";
import { getJstSeasonContext, type SeasonContext } from "@shared/season/jst-season";
import { PlusHardLimitCta } from "@/features/billing/plus-cta";
import {
  hasCurrentExpiredConfirmation,
  isPastEnteredExpiry,
  type PlannerAttempt,
} from "../expired-pantry-checks";
import { CurrentSafetySummary } from "../current-safety-summary";
import { HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY } from "../household-safety-helper-copy";
import {
  cuisineGenreLabel,
  ingredientPreferenceLabel,
  ingredientPreferenceLabels,
  mealLabel,
} from "../model/planner-labels";
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
    | "timeLimitMinutes"
    | "budgetPreference"
    | "ingredientPreference"
    | "avoidIngredients"
    | "memo"
    | "pantrySelections",
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
   * 設計 §5.1 / 緊急献立対応力改善 §5: AI を使わない緊急献立への導線。
   * route が flush→navigate を所有するため、ここはクリック通知だけを受け取る。
   * 未指定ならボタン自体を出さない（meal 等の step では渡さない）。
   * household / idea とも同一 secondary CTA（idea は個人固定候補パス）。
   */
  onOpenEmergencyMenus?: () => void;
  /** GET /api/usage/today の成功残数。未取得時は null（偽の残数を出さない） */
  usageRemaining?: number | null;
  /**
   * usage.plan。個人枠コピー接頭（無料版は）の切替に使う。未取得は free 扱いしないよう null。
   * null のときは残数行自体を出さない既存契約を維持するため、残数表示時は plan も必須。
   */
  plan?: PlanCode | null;
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
  /**
   * 季節表示（端末時計 best-effort）。未指定時は getJstSeasonContext(new Date())。
   * 生成の権威ある季節はサーバー側プロンプトのみ。
   */
  seasonContext?: SeasonContext;
};

/** privacy 未確認のまま生成を押したときのダイアログ本文 */
export const privacyNoticeRequiredMessage =
  "献立を作る前に、AI情報の説明を確認してください。「AI情報の説明を見る」を押してください。";

/**
 * 任意条件（時間・予算・材料の使い方・避ける食材・memo・pantry選択）をdetailsから開き、
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
  plan = null,
  attemptsRemaining = null,
  globalAvailable = null,
  shortWindowRetryAt = null,
  onEditStep,
  seasonContext = getJstSeasonContext(new Date()),
}: ReviewStepProps) {
  // 残数行用の plan。未取得なら free 接頭を避けず free として扱う（usage 未取得では行自体非表示）。
  const quotaPlan: PlanCode = plan ?? "free";
  // 品質トグルは Plus 確定時のみ操作可。null（usage 未取得）も Free 同様にロック（fail-closed）。
  const qualityModeLocked = plan !== "plus";
  const [avoidIngredientText, setAvoidIngredientText] = useState(value.avoidIngredients.join("、"));
  // P4: 上限超過を silent truncate せずローカルエラーで止める（schema fieldErrors と別経路）
  const [avoidIngredientLocalError, setAvoidIngredientLocalError] = useState<string | null>(null);
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
  // PLAN-1: 下書き復元・日付跨ぎで期限切れが既選択のとき、新規選択時と同じ確認が要る
  const nowForExpiry = new Date();
  const hasUnconfirmedExpiredPantry =
    pantryItemsStatus === "loaded" &&
    value.pantrySelections.some((selection) => {
      const item = pantryItems.find((entry) => entry.id === selection.pantryItemId);
      if (item === undefined) return false;
      return (
        isPastEnteredExpiry(item, nowForExpiry) &&
        !hasCurrentExpiredConfirmation(attempt, item.id, nowForExpiry)
      );
    });
  // Plan 2: AI 送信前のクライアント医療境界。サーバー preflight と同一 detector を使う。
  const medicalBlocked =
    detectUnsupportedMedicalRequest(collectPlannerRequestText(value)).length > 0;
  // privacy 未確認だけでは disabled にしない（押下で案内を出す）。
  // C-I12 residual: 成功残 0 / attempt 残 0 / global 不可で主 CTA を止める。
  // I2: shortWindowRetryAt は route が remaining===0 のときだけ渡す active blocker。
  // 端末時計での再有効化はせず、usage 再取得で retryAt が消えたときだけ有効に戻す。
  // null/未取得では誤って止めない。
  const hasActiveUsageBlocker =
    usageRemaining === 0 ||
    attemptsRemaining === 0 ||
    globalAvailable === false ||
    shortWindowRetryAt !== null;
  // 設計 2026-07-29: dual 常時残数を supersede。常時は success 残の1行のみ。
  // attemptsRemaining === null（未取得）では行を出してよい。0 のときだけ隠す。
  const showSuccessRemaining =
    usageRemaining !== null && usageRemaining > 0 && attemptsRemaining !== 0;
  const generateDisabled =
    disabled ||
    hasUnavailablePantrySelections ||
    hasUnconfirmedExpiredPantry ||
    medicalBlocked ||
    hasActiveUsageBlocker ||
    avoidIngredientLocalError != null;
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
      {/*
        household では選択 0 人でも補助文を常時出す（サマリー無しでも安全ブロック領域に単独表示）。
        共有 CurrentSafetySummary 本体には埋め込まず sibling 直下に置く（設計 §6.2）。
      */}
      {value.targetMode === "household" && (
        <>
          {targetSafetyMembers.length > 0 ? (
            <CurrentSafetySummary members={targetSafetyMembers} />
          ) : null}
          <p>{HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY}</p>
        </>
      )}
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
          hasUnconfirmedExpiredPantry ||
          medicalBlocked ||
          fieldErrors?.timeLimitMinutes != null ||
          fieldErrors?.budgetPreference != null ||
          fieldErrors?.ingredientPreference != null ||
          fieldErrors?.avoidIngredients != null ||
          avoidIngredientLocalError != null ||
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
            材料の使い方
            <select
              value={value.ingredientPreference ?? ""}
              disabled={disabled}
              aria-invalid={fieldErrors?.ingredientPreference != null ? "true" : undefined}
              aria-describedby={
                fieldErrors?.ingredientPreference != null
                  ? "review-ingredient-preference-error"
                  : "review-ingredient-preference-hint"
              }
              onChange={(event) => {
                const selected = event.target.value;
                onChange({
                  ...value,
                  ingredientPreference:
                    selected === "more"
                      ? "more"
                      : selected === "less"
                        ? "less"
                        : selected === "selected_only"
                          ? "selected_only"
                          : selected === "auto"
                            ? "auto"
                            : null,
                });
              }}
            >
              <option value="">{ingredientPreferenceLabel(null)}</option>
              <option value="more">{ingredientPreferenceLabels.more}</option>
              <option value="less">{ingredientPreferenceLabels.less}</option>
              <option value="selected_only">{ingredientPreferenceLabels.selected_only}</option>
              <option value="auto">{ingredientPreferenceLabels.auto}</option>
            </select>
          </label>
          <p id="review-ingredient-preference-hint" className="type-small">
            材料の量や、買い足しの範囲の目安です。調味料の基本（塩・しょうゆ・油など）はどの選択でも使えます。
          </p>
          {fieldErrors?.ingredientPreference != null && (
            <p id="review-ingredient-preference-error" role="alert">
              {fieldErrors.ingredientPreference}
            </p>
          )}
          <label className="field">
            今回だけ避ける食材
            <input
              value={avoidIngredientText}
              disabled={disabled}
              aria-invalid={
                fieldErrors?.avoidIngredients != null || avoidIngredientLocalError != null
                  ? "true"
                  : undefined
              }
              aria-describedby={
                fieldErrors?.avoidIngredients != null || avoidIngredientLocalError != null
                  ? "review-avoid-ingredients-error"
                  : undefined
              }
              onChange={(event) => {
                const raw = event.target.value;
                const parsed = parseAvoidIngredientInput(raw);
                // P4: 件数・長さ超過は切り詰め反映せずエラー表示（入力全文は保持して直せるようにする）
                if (parsed.hasTooManyItems || parsed.hasTooLongItem) {
                  setAvoidIngredientText(raw);
                  setAvoidIngredientLocalError(
                    parsed.hasTooManyItems
                      ? `避ける食材は${String(avoidIngredientLimit)}件までです。`
                      : `避ける食材は1件${String(avoidIngredientLengthLimit)}文字までです。`,
                  );
                  return;
                }
                setAvoidIngredientLocalError(null);
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
          {(fieldErrors?.avoidIngredients != null || avoidIngredientLocalError != null) && (
            <p id="review-avoid-ingredients-error" role="alert">
              {fieldErrors?.avoidIngredients ?? avoidIngredientLocalError}
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
      {hasUnconfirmedExpiredPantry && (
        <p role="alert">
          期限切れの食材が選ばれています。冷蔵庫の食材で確認してから献立を作ってください。
        </p>
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
      {/*
        確認末尾のメタ情報は意味ごとにトーンを分ける（同色の平文並びを避ける）。
        1) 季節 = 弱い補足  2) 残数 = 情報ストリップ  3) 上限 = 既存 danger バナー
        4) くわしく作る = 操作カード  5) idea 注意 = 主 CTA 直前の注意枠
        idea 注意文の直前配置契約を壊さないよう、usage / 品質 / 主 CTA より上に季節を置く。
      */}
      <p role="status" className="review-season-hint type-small">
        いまは{seasonContext.labelJa}（{String(seasonContext.month)}月）の食材を優先して提案します
      </p>
      {/* 設計 2026-07-29: dual 常時残数を supersede。常時は success 残の受け付け口調1行のみ。
          attempt 常時行は置かない。blocker 時は行動文（明日0:00 / 待ち）だけ。
          success0∧attempts0 は作成上限文のみ（attempts0 文は出さない）。
          個人枠は formatPlanQuotaCopy（Free 接頭 / Plus 接頭なし）。global 混雑文には付けない。
          L10-2: Free かつ remaining===1 のときソフト1行を続ける。
          hasActiveUsageBlocker 判定ロジックは維持。 */}
      {showSuccessRemaining ? (
        <p role="status" className="review-usage-status">
          {formatPlanQuotaCopy(
            `本日あと${String(usageRemaining)}回まで献立の作成を受け付けます`,
            quotaPlan,
          )}
        </p>
      ) : null}
      {showSuccessRemaining && quotaPlan === "free" && usageRemaining === 1 ? (
        <p role="status" className="review-usage-status review-usage-status--soft-limit">
          本日の無料回数が残り 1 回です
        </p>
      ) : null}
      {hasActiveUsageBlocker && (
        <div className="usage-limit-banner" role="alert">
          <strong className="usage-limit-banner-title">いまは新しい献立を作れません</strong>
          {usageRemaining === 0 && (
            <p className="usage-limit-banner-body">
              {formatPlanQuotaCopy(
                "本日の作成上限に達しています。明日0:00（日本時間）以降にお試しください。",
                quotaPlan,
              )}
            </p>
          )}
          {attemptsRemaining === 0 && usageRemaining !== 0 && (
            <p className="usage-limit-banner-body">
              {formatPlanQuotaCopy(
                "今日は新しい献立の作成を受け付けられません。明日0:00（日本時間）以降にお試しください。",
                quotaPlan,
              )}
            </p>
          )}
          {globalAvailable === false && (
            <p className="usage-limit-banner-body">
              ただいま混雑しています。明日0:00（日本時間）以降にお試しください。
            </p>
          )}
          {shortWindowRetryAt !== null && (
            <p className="usage-limit-banner-body">
              {formatPlanQuotaCopy(
                `短い時間に何度も作成を試したため、少し待つ必要があります。${new Intl.DateTimeFormat(
                  "ja-JP",
                  {
                    timeZone: "Asia/Tokyo",
                    dateStyle: "short",
                    timeStyle: "short",
                  },
                ).format(new Date(shortWindowRetryAt))}以降に再試行してください。`,
                quotaPlan,
              )}
            </p>
          )}
          {/* L10-1: Free 硬上限（成功残 0 または attempt 残 0）で Plus CTA */}
          {quotaPlan === "free" && (usageRemaining === 0 || attemptsRemaining === 0) ? (
            <PlusHardLimitCta />
          ) : null}
        </div>
      )}
      {/* Q4: Plus 品質モード。Free / plan 未取得はトグル不可（L10-4）。
          Plus のみ操作可。サーバは Free の true を quality_mode_requires_plus で拒否する。
          idea 注意（§5.3）より前に置き、注意が wizard-actions の直前 sibling を保つ。 */}
      <label
        className={
          qualityModeLocked
            ? "quality-mode-toggle quality-mode-toggle--locked"
            : "quality-mode-toggle"
        }
      >
        <span className="control-label quality-mode-toggle-row">
          <input
            type="checkbox"
            checked={qualityModeLocked ? false : attempt.qualityMode}
            disabled={disabled || qualityModeLocked}
            onChange={(event) => {
              // Free では disabled だが、念のため true を捨てる
              if (qualityModeLocked) return;
              onAttemptChange({ ...attempt, qualityMode: event.target.checked });
            }}
            aria-describedby="quality-mode-hint"
          />
          <span className="quality-mode-label">くわしく作る</span>
        </span>
        <span id="quality-mode-hint" className="quality-mode-hint">
          {qualityModeLocked
            ? "くわしい AI での作成は Plus で使えます"
            : "Plus のくわしい AI で、より丁寧な献立を作ります（1 日の回数に限りがあります）"}
        </span>
      </label>
      {/* quality の </label> の直後。idea の role=note より前。note と wizard-actions の間に置かない。
          label 内に入れない（checkbox の accessible name 汚染防止）。生 a で Harness が Router 外でも可。 */}
      {qualityModeLocked ? (
        <p className="quality-mode-plus-link-wrap">
          <a href="/plus" className="inline-flex min-h-11 items-center font-semibold underline">
            Plus を見る
          </a>
        </p>
      ) : null}
      {/* 設計 §5.3: idea 注意は主操作直前（wizard-actions の直前 sibling）。
          role=note の要素自体が直前 sibling である契約を維持する（ラップしない）。 */}
      {value.targetMode === "idea" && (
        <p role="note" className="review-idea-caution">
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
      {/* household / idea とも同一 CTA。旧 idea 切替案内「家族向けの緊急献立は…」は削除。 */}
      {(value.targetMode === "household" || value.targetMode === "idea") &&
        onOpenEmergencyMenus !== undefined && (
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
