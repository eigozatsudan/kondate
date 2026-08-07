import { useEffect, useState } from "react";
import type { EntitlementData } from "@shared/contracts/billing";
import { createCheckoutSession, createPortalSession } from "./billing-api";
import {
  INCOMPLETE_COPY,
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
  INCOMPLETE_COPY,
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
  // interval / yearConfirmed は form 内完結。親は pending と API 結果エラーのみ持つ。
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // B9: Checkout が Stripe live を検出したとき（use_portal / incomplete / already_entitled）
  // Free 枝でも Portal CTA を出し、管理導線を閉じない。サーバ Portal は live 確認で許可する。
  const [portalCtaFromCheckoutBlock, setPortalCtaFromCheckoutBlock] = useState(false);
  // B9: poll 期限後も Free のとき query 除去後も Portal 導線を残す（COMING_SOON で再 Checkout 不能でも管理可能）
  const [portalCtaAfterSuccessPoll, setPortalCtaAfterSuccessPoll] = useState(false);

  const query = useEntitlement(userId, {
    pollAfterCheckoutSuccess,
    onCheckoutPollSettled: () => {
      // poll 終了後も Free 枝に Portal を残す（親が billing=success を外しても導線維持）
      setPortalCtaAfterSuccessPoll(true);
      onCheckoutPollSettled?.();
    },
  });
  const data = injected !== undefined ? injected : (query.data ?? null);
  const loading =
    entitlementLoading !== undefined ? entitlementLoading : query.isPending || query.isFetching;
  const error = entitlementError !== undefined ? entitlementError : query.isError;

  const surfacesOpen = data?.productSurfacesOpen === true;
  // B6: error 時は stale Plus を出さない（サーバ再検証までの fail-closed 表示）
  const entitled = !error && data?.plusEntitled === true;
  const isTrialing = data?.status === "trialing";
  const isPastDue = data?.status === "past_due" || data?.pastDueGrace === true;
  // B1: incomplete は Checkout 409 が Portal 完了を指示。Checkout フォームではなく Portal CTA を出す
  const isIncomplete = data?.status === "incomplete";
  const trialEndLabel = formatTrialEnd(data?.trialEnd ?? null);
  // Checkout 成功後の webhook 遅延待ち中・期限後も Portal を出せる（両閉じ回避）
  const showPortalOnFreeBranch =
    surfacesOpen &&
    (portalCtaFromCheckoutBlock || pollAfterCheckoutSuccess || portalCtaAfterSuccessPoll);

  // 新しい success poll 開始で期限後 CTA をリセット。Plus 反映で不要になる。
  useEffect(() => {
    if (pollAfterCheckoutSuccess) {
      setPortalCtaAfterSuccessPoll(false);
    }
  }, [pollAfterCheckoutSuccess]);
  useEffect(() => {
    if (entitled) {
      setPortalCtaAfterSuccessPoll(false);
      setPortalCtaFromCheckoutBlock(false);
    }
  }, [entitled]);

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

          {/* B1: incomplete は LP 同様 Portal で完了。Checkout/COMING_SOON 枝に落とさない */}
          {isIncomplete ? (
            <div className="stack gap-2">
              <p role="status">{INCOMPLETE_COPY}</p>
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

          {!entitled && surfacesOpen && !isIncomplete ? (
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
                    setPortalCtaFromCheckoutBlock(false);
                    try {
                      if (onCheckout !== undefined) {
                        await onCheckout(interval);
                      } else {
                        const { url } = await createCheckoutSession({ interval });
                        window.location.assign(url);
                      }
                    } catch (err) {
                      // billing-api は envelope.error.code を Error.message に載せる
                      const code = err instanceof Error ? err.message : "";
                      if (code === "billing_checkout_incomplete") {
                        setActionError(INCOMPLETE_COPY);
                        setPortalCtaFromCheckoutBlock(true);
                      } else if (
                        code === "billing_checkout_use_portal" ||
                        code === "billing_already_entitled"
                      ) {
                        // B9/B10: Stripe live 検出。Portal CTA を出し新規 Checkout は閉じる
                        setActionError(
                          "お支払い管理から手続きしてください。新規のお申し込みはできません",
                        );
                        setPortalCtaFromCheckoutBlock(true);
                      } else {
                        setActionError(
                          "お支払い画面を開けませんでした。時間をおいてもう一度お試しください",
                        );
                      }
                    } finally {
                      setPending(false);
                    }
                  }}
                />
              )}
              {/* B9: Free 枝でも Stripe live / 成功 poll 中は Portal 導線を残す */}
              {showPortalOnFreeBranch ? (
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
