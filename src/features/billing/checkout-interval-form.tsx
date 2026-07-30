import { useState } from "react";
import { STRIPE_REDIRECT_NOTICE, YEARLY_CONFIRM_COPY } from "./billing-ui-copy";

export type CheckoutIntervalFormProps = {
  disabled?: boolean;
  pending?: boolean;
  onSubmit: (interval: "month" | "year") => void | Promise<void>;
};

/**
 * Checkout の月額/年額選択フォーム（設定と Plus LP で共有）。
 * plan-settings-section を import しない（循環・責務分離）。
 * 年額確認は form 内完結。pending/disabled は親が渡す。
 */
export function CheckoutIntervalForm({
  disabled = false,
  pending = false,
  onSubmit,
}: CheckoutIntervalFormProps) {
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [yearConfirmed, setYearConfirmed] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleClick(): Promise<void> {
    if (disabled || pending) return;
    // 年額は確認チェック必須。未チェック時は submit せずローカルエラーのみ。
    if (interval === "year" && !yearConfirmed) {
      setLocalError("年額のお支払いについて確認にチェックを入れてください");
      return;
    }
    setLocalError(null);
    await onSubmit(interval);
  }

  return (
    <div className="stack gap-3">
      <ul className="stack gap-1">
        <li>月額 580 円（税込）</li>
        <li>年額 5,800 円（税込・2か月分お得）</li>
      </ul>
      <fieldset className="stack gap-2" disabled={disabled || pending}>
        <legend className="font-semibold">お支払いの種類</legend>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="radio"
            name="billing-interval"
            value="month"
            checked={interval === "month"}
            onChange={() => {
              setInterval("month");
              setYearConfirmed(false);
              setLocalError(null);
            }}
          />
          <span>月額 580 円</span>
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="radio"
            name="billing-interval"
            value="year"
            checked={interval === "year"}
            onChange={() => {
              setInterval("year");
            }}
          />
          <span>年額 5,800 円</span>
        </label>
      </fieldset>
      {/* 年額選択時のみ返金不可の確認チェックを表示（設定と同じ文言） */}
      {interval === "year" ? (
        <label className="flex min-h-11 items-start gap-3">
          <input
            type="checkbox"
            checked={yearConfirmed}
            onChange={(event) => {
              setYearConfirmed(event.target.checked);
              setLocalError(null);
            }}
          />
          <span>{YEARLY_CONFIRM_COPY}</span>
        </label>
      ) : null}
      <p className="type-small">{STRIPE_REDIRECT_NOTICE}</p>
      <button
        type="button"
        className="primary-button min-h-11"
        disabled={disabled || pending}
        onClick={() => {
          void handleClick();
        }}
      >
        Plus をはじめる
      </button>
      {localError !== null ? (
        <p role="alert" className="error-message">
          {localError}
        </p>
      ) : null}
    </div>
  );
}
