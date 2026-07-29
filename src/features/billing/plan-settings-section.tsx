import { useState } from "react";
import type { EntitlementData } from "@shared/contracts/billing";
import { createCheckoutSession, createPortalSession } from "./billing-api";
import { useEntitlement } from "./use-entitlement";

/** 設定 UI 固定コピー（テスト exact）。 */
export const TRIAL_END_WARNING =
  "無料期間が終わると、登録したお支払い方法に料金がかかります" as const;
export const YEARLY_CONFIRM_COPY =
  "1 年分まとめてのお支払いです。途中解約しても残り期間の返金はありません（法令に従う場合を除く）" as const;
export const PORTAL_BUTTON_LABEL = "お支払い・解約の管理" as const;
export const STRIPE_REDIRECT_NOTICE = "カード入力画面に移ります" as const;
export const PAST_DUE_COPY = "お支払いの更新が必要です" as const;

function formatTrialEnd(iso: string | null): string | null {
  if (iso === null) return null;
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      dateStyle: "long",
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

function planLabel(data: EntitlementData): string {
  if (data.plusEntitled || data.plan === "plus") {
    if (data.status === "trialing") return "こんだて日和 Plus（無料期間中）";
    if (data.pastDueGrace || data.status === "past_due")
      return "こんだて日和 Plus（お支払い確認中）";
    return "こんだて日和 Plus";
  }
  return "無料プラン";
}

export type PlanSettingsSectionProps = {
  userId: string;
  /** ?billing=success のとき webhook 遅延待ち re-fetch。 */
  pollAfterCheckoutSuccess?: boolean;
  /** テスト注入。省略時は useEntitlement。 */
  entitlement?: EntitlementData | null;
  entitlementLoading?: boolean;
  entitlementError?: boolean;
  onCheckout?: (interval: "month" | "year") => Promise<void>;
  onPortal?: () => Promise<void>;
};

/**
 * 設定のプラン管理（L10-5）。
 * ブラウザは /api/billing/* のみ。Price ID / sk_ は出さない。
 */
export function PlanSettingsSection({
  userId,
  pollAfterCheckoutSuccess = false,
  entitlement: injected,
  entitlementLoading,
  entitlementError,
  onCheckout,
  onPortal,
}: PlanSettingsSectionProps) {
  const query = useEntitlement(userId, { pollAfterCheckoutSuccess });
  const data = injected !== undefined ? injected : (query.data ?? null);
  const loading =
    entitlementLoading !== undefined ? entitlementLoading : query.isPending || query.isFetching;
  const error = entitlementError !== undefined ? entitlementError : query.isError;

  const [interval, setInterval] = useState<"month" | "year">("month");
  const [yearConfirmed, setYearConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const surfacesOpen = data?.productSurfacesOpen === true;
  const entitled = data?.plusEntitled === true;
  const isTrialing = data?.status === "trialing";
  const isPastDue = data?.status === "past_due" || data?.pastDueGrace === true;
  const trialEndLabel = formatTrialEnd(data?.trialEnd ?? null);

  async function runCheckout(): Promise<void> {
    if (pending) return;
    if (interval === "year" && !yearConfirmed) {
      setActionError("年額のお支払いについて確認にチェックを入れてください");
      return;
    }
    setPending(true);
    setActionError(null);
    try {
      if (onCheckout !== undefined) {
        await onCheckout(interval);
      } else {
        const { url } = await createCheckoutSession({ interval });
        window.location.assign(url);
      }
    } catch {
      setActionError("お支払い画面を開けませんでした。時間をおいてもう一度お試しください");
    } finally {
      setPending(false);
    }
  }

  async function runPortal(): Promise<void> {
    if (pending) return;
    setPending(true);
    setActionError(null);
    try {
      if (onPortal !== undefined) {
        await onPortal();
      } else {
        const { url } = await createPortalSession();
        window.location.assign(url);
      }
    } catch {
      setActionError("お支払い管理画面を開けませんでした。時間をおいてもう一度お試しください");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="card stack settings-section" aria-labelledby="plan-settings-title">
      <h2 id="plan-settings-title" className="settings-section-title">
        プラン
      </h2>

      {loading && data === null ? <p role="status">プラン情報を確認しています…</p> : null}
      {error && data === null ? (
        <p role="alert">プラン情報を確認できませんでした。再読み込みしてください。</p>
      ) : null}

      {data !== null ? (
        <>
          <p>
            いまのプラン: <strong>{planLabel(data)}</strong>
          </p>

          {!surfacesOpen ? <p role="status">お支払い管理は現在ご利用いただけません。</p> : null}

          {isTrialing ? (
            <div className="stack gap-1">
              {trialEndLabel !== null ? <p>無料期間の終了: {trialEndLabel}</p> : null}
              <p>{TRIAL_END_WARNING}</p>
            </div>
          ) : null}

          {isPastDue ? (
            <div className="stack gap-2">
              <p role="alert">{PAST_DUE_COPY}</p>
              {surfacesOpen ? (
                <button
                  type="button"
                  className="primary-button min-h-11"
                  disabled={pending}
                  onClick={() => {
                    void runPortal();
                  }}
                >
                  {PORTAL_BUTTON_LABEL}
                </button>
              ) : null}
            </div>
          ) : null}

          {!entitled && surfacesOpen ? (
            <div className="stack gap-3">
              <p>こんだて日和 Plus なら、1 日最大 10 回まで献立を作れます。</p>
              <ul className="stack gap-1">
                <li>月額 580 円（税込）</li>
                <li>年額 5,800 円（税込・2か月分お得）</li>
              </ul>
              <fieldset className="stack gap-2">
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
              {interval === "year" ? (
                <label className="flex min-h-11 items-start gap-3">
                  <input
                    type="checkbox"
                    checked={yearConfirmed}
                    onChange={(event) => {
                      setYearConfirmed(event.target.checked);
                      setActionError(null);
                    }}
                  />
                  <span>{YEARLY_CONFIRM_COPY}</span>
                </label>
              ) : null}
              <p className="type-small">{STRIPE_REDIRECT_NOTICE}</p>
              <button
                type="button"
                className="primary-button min-h-11"
                disabled={pending}
                onClick={() => {
                  void runCheckout();
                }}
              >
                Plus をはじめる
              </button>
            </div>
          ) : null}

          {entitled && surfacesOpen && !isPastDue ? (
            <div className="stack gap-2">
              <p className="type-small">{STRIPE_REDIRECT_NOTICE}</p>
              <button
                type="button"
                className="secondary-button min-h-11"
                disabled={pending}
                onClick={() => {
                  void runPortal();
                }}
              >
                {PORTAL_BUTTON_LABEL}
              </button>
            </div>
          ) : null}

          {pollAfterCheckoutSuccess && !entitled ? (
            <p role="status">お支払いの反映を確認しています。数十秒かかることがあります。</p>
          ) : null}
        </>
      ) : null}

      {actionError !== null ? (
        <p role="alert" className="error-message">
          {actionError}
        </p>
      ) : null}
    </section>
  );
}
