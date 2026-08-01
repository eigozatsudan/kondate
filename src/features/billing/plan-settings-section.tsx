import { useState } from "react";
import type { EntitlementData } from "@shared/contracts/billing";
import { createCheckoutSession, createPortalSession } from "./billing-api";
import {
  PAST_DUE_COPY,
  PORTAL_BUTTON_LABEL,
  STRIPE_REDIRECT_NOTICE,
  SURFACES_CLOSED_COPY,
  TRIAL_END_WARNING,
} from "./billing-ui-copy";
import { CheckoutIntervalForm } from "./checkout-interval-form";
import {
  PLUS_LP_COMING_SOON_BADGE,
  PLUS_LP_COMING_SOON_BODY,
  PLUS_LP_UPGRADE_COMING_SOON,
} from "./plus-upgrade-gate";
import { useEntitlement } from "./use-entitlement";

// 既存テストの import パスを壊さない re-export（正本は billing-ui-copy）
export {
  TRIAL_END_WARNING,
  YEARLY_CONFIRM_COPY,
  PORTAL_BUTTON_LABEL,
  STRIPE_REDIRECT_NOTICE,
  PAST_DUE_COPY,
  SURFACES_CLOSED_COPY,
} from "./billing-ui-copy";

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

function planLabel(data: EntitlementData, options: { trustPlus: boolean }): string {
  // trustPlus=false（error）時は Plus ラベルを出さない
  if (options.trustPlus && (data.plusEntitled || data.plan === "plus")) {
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
  /** Plus 反映 / 5 分 deadline / 連続失敗で poll 終了したとき（query 除去用）。 */
  onCheckoutPollSettled?: () => void;
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
 * Checkout 間隔 UI は CheckoutIntervalForm を共有利用する。
 */
export function PlanSettingsSection({
  userId,
  pollAfterCheckoutSuccess = false,
  onCheckoutPollSettled,
  entitlement: injected,
  entitlementLoading,
  entitlementError,
  onCheckout,
  onPortal,
}: PlanSettingsSectionProps) {
  const query = useEntitlement(userId, {
    pollAfterCheckoutSuccess,
    ...(onCheckoutPollSettled === undefined ? {} : { onCheckoutPollSettled }),
  });
  const data = injected !== undefined ? injected : (query.data ?? null);
  const loading =
    entitlementLoading !== undefined ? entitlementLoading : query.isPending || query.isFetching;
  const error = entitlementError !== undefined ? entitlementError : query.isError;

  // interval / yearConfirmed は form 内完結。親は pending と API 結果エラーのみ持つ。
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const surfacesOpen = data?.productSurfacesOpen === true;
  // B6: error 時は stale Plus を出さない（サーバ再検証までの fail-closed 表示）
  const entitled = !error && data?.plusEntitled === true;
  const isTrialing = data?.status === "trialing";
  const isPastDue = data?.status === "past_due" || data?.pastDueGrace === true;
  const trialEndLabel = formatTrialEnd(data?.trialEnd ?? null);

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
            いまのプラン: <strong>{planLabel(data, { trustPlus: !error })}</strong>
          </p>

          {!surfacesOpen ? <p role="status">{SURFACES_CLOSED_COPY}</p> : null}

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
              {/* BILL-1: LP の COMING_SOON と設定の Checkout を揃える（申込不可なのに Settings だけ課金可にしない） */}
              {PLUS_LP_UPGRADE_COMING_SOON ? (
                <div className="stack gap-2" role="status">
                  <p className="type-small">
                    <strong>{PLUS_LP_COMING_SOON_BADGE}</strong>
                  </p>
                  <p className="type-small">{PLUS_LP_COMING_SOON_BODY}</p>
                </div>
              ) : (
                <CheckoutIntervalForm
                  pending={pending}
                  onSubmit={async (interval) => {
                    // pending 管理は親のみ。form は onSubmit と年額確認に専念する。
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
                      setActionError(
                        "お支払い画面を開けませんでした。時間をおいてもう一度お試しください",
                      );
                    } finally {
                      setPending(false);
                    }
                  }}
                />
              )}
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
