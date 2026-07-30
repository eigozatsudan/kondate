import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import type { EntitlementData } from "@shared/contracts/billing";
import { planQuota } from "@shared/contracts/plan-quota";
import { useAuth } from "@/features/auth/use-auth";
import { createCheckoutSession, createPortalSession } from "./billing-api";
import {
  PAST_DUE_COPY,
  PORTAL_BUTTON_LABEL,
  SURFACES_CLOSED_COPY,
  TRIAL_END_WARNING,
} from "./billing-ui-copy";
import heroUrl from "./assets/plus-hero.webp";
import quotaUrl from "./assets/plus-benefit-quota.webp";
import qualityUrl from "./assets/plus-benefit-quality.webp";
import flyerUrl from "./assets/plus-benefit-flyer.webp";
import { CheckoutIntervalForm } from "./checkout-interval-form";
import { resolvePlusLandingView } from "./plus-landing-view";
import { useEntitlement } from "./use-entitlement";
import "./plus-landing-page.css";

/** Plus LP 固定コピー（テスト exact 用に export） */
export const PLUS_LP_H1 = "こんだて日和 Plus" as const;
export const PLUS_LP_LEAD = "献立づくりに、余裕を。" as const;
export const PLUS_LP_TRIAL = "はじめての方は 7 日間お試し（カード登録あり）" as const;
export const PLUS_LP_NEUTRAL_SUB = "Plus でできること" as const;
export const PLUS_LP_ACTIVE = "こんだて日和 Plus をご利用中です" as const;
export const PLUS_LP_INCOMPLETE =
  "お支払いの手続きが完了していません。設定から続きをご確認ください。" as const;
export const PLUS_LP_CANCEL = "お支払いをキャンセルしました" as const;
export const PLUS_LP_CHECKOUT_IN_PROGRESS =
  "お支払い手続きが進行中です。しばらくしてからお試しください" as const;
export const PLUS_LP_SETTINGS_LINK = "設定へ" as const;

const CHECKOUT_GENERIC_ERROR =
  "お支払い画面を開けませんでした。時間をおいてもう一度お試しください" as const;
const PORTAL_GENERIC_ERROR =
  "お支払い管理画面を開けませんでした。時間をおいてもう一度お試しください" as const;
const ENTITLED_KILL_NOTE = "一部機能は現在ご利用いただけません" as const;
const FLYER_PRIVACY_NOTE = "写真は長期保存しません" as const;

export type PlusLandingPageProps = {
  userId?: string;
  entitlement?: EntitlementData | null;
  entitlementLoading?: boolean;
  entitlementError?: boolean;
  onCheckout?: (interval: "month" | "year") => Promise<void>;
  onPortal?: () => Promise<void>;
};

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

/**
 * Plus ランディングページ（設計 2026-07-30）。
 * 表示分岐は resolvePlusLandingView のみ。Checkout は CheckoutIntervalForm 共有。
 * イラストは同一オリジン webp（装飾のため alt は空）。
 */
export function PlusLandingPage({
  userId: injectedUserId,
  entitlement: injected,
  entitlementLoading,
  entitlementError,
  onCheckout,
  onPortal,
}: PlusLandingPageProps = {}) {
  const auth = useAuth();
  const userId = injectedUserId ?? auth.session?.user.id ?? "";
  const query = useEntitlement(userId);
  const data = injected !== undefined ? injected : (query.data ?? null);
  const loading =
    entitlementLoading !== undefined ? entitlementLoading : query.isPending || query.isFetching;
  const error = entitlementError !== undefined ? entitlementError : query.isError;

  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // cancel メッセージは query 除去後も 1 回表示するため、初回読み取りを state に保持する
  const [showCancelMessage] = useState(() => searchParams.get("billing") === "cancel");

  useEffect(() => {
    if (searchParams.get("billing") !== "cancel") return;
    // 再訪で残らないよう replace で query を落とす（設計 M4）
    const next = new URLSearchParams(searchParams);
    next.delete("billing");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const view = resolvePlusLandingView({ loading, error, data });

  function onBack(): void {
    let sameOriginReferrer = false;
    try {
      const ref = document.referrer;
      sameOriginReferrer = ref.length > 0 && new URL(ref).origin === window.location.origin;
    } catch {
      sameOriginReferrer = false;
    }
    // SPA 内遷移、または生 a フルロード後でも同一 origin から来た場合は履歴を戻る（R-C1）
    if (location.key !== "default" || sameOriginReferrer) {
      void navigate(-1);
      return;
    }
    void navigate("/planner", { replace: true });
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
      setActionError(PORTAL_GENERIC_ERROR);
    } finally {
      setPending(false);
    }
  }

  async function runCheckout(interval: "month" | "year"): Promise<void> {
    if (pending) return;
    setPending(true);
    setActionError(null);
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
      if (code === "billing_checkout_in_progress") {
        setActionError(PLUS_LP_CHECKOUT_IN_PROGRESS);
      } else {
        setActionError(CHECKOUT_GENERIC_ERROR);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="page-frame plus-landing">
      <button
        type="button"
        className="secondary-button min-h-11 plus-landing__back"
        onClick={onBack}
      >
        戻る
      </button>

      {showCancelMessage ? (
        <p role="status" className="plus-landing__cancel">
          {PLUS_LP_CANCEL}
        </p>
      ) : null}

      {view.kind === "loading" ? <p role="status">プラン情報を確認しています…</p> : null}

      {view.kind === "error" ? (
        <p role="alert">プラン情報を確認できませんでした。再読み込みしてください。</p>
      ) : null}

      {view.kind === "past_due" ? (
        <div className="stack gap-3">
          <p role="alert">{PAST_DUE_COPY}</p>
          {view.surfacesOpen ? (
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
          ) : (
            <Link className="secondary-button min-h-11" to="/settings">
              {PLUS_LP_SETTINGS_LINK}
            </Link>
          )}
        </div>
      ) : null}

      {view.kind === "entitled" ? (
        <div className="stack gap-3">
          <h1>{PLUS_LP_ACTIVE}</h1>
          {view.trialing ? (
            <div className="stack gap-1">
              {formatTrialEnd(view.trialEnd) !== null ? (
                <p>無料期間の終了: {formatTrialEnd(view.trialEnd)}</p>
              ) : null}
              <p>{TRIAL_END_WARNING}</p>
            </div>
          ) : null}
          {!view.surfacesOpen ? <p role="status">{ENTITLED_KILL_NOTE}</p> : null}
          {view.surfacesOpen ? (
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
          ) : null}
          <Link className="secondary-button min-h-11" to="/settings">
            {PLUS_LP_SETTINGS_LINK}
          </Link>
        </div>
      ) : null}

      {view.kind === "incomplete" ? (
        <div className="stack gap-3">
          <p role="status">{PLUS_LP_INCOMPLETE}</p>
          {view.surfacesOpen ? (
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
          ) : null}
          <Link className="secondary-button min-h-11" to="/settings">
            {PLUS_LP_SETTINGS_LINK}
          </Link>
        </div>
      ) : null}

      {view.kind === "full" ? (
        <div className="stack gap-4 plus-landing__full">
          <div className="plus-landing__hero stack gap-2">
            <img
              src={heroUrl}
              alt=""
              width={1280}
              height={720}
              className="plus-landing__hero-img"
              decoding="async"
            />
            <h1>{PLUS_LP_H1}</h1>
            <p className="plus-landing__lead">{PLUS_LP_LEAD}</p>
            {view.checkoutEnabled ? (
              <p className="plus-landing__trial">{PLUS_LP_TRIAL}</p>
            ) : (
              <p className="plus-landing__neutral">{PLUS_LP_NEUTRAL_SUB}</p>
            )}
          </div>

          <ul className="plus-landing__cards stack gap-3">
            <li className="plus-landing__card card stack gap-2">
              <img
                src={quotaUrl}
                alt=""
                width={640}
                height={640}
                className="plus-landing__card-img"
                decoding="async"
              />
              <h2>枠の余裕</h2>
              <p>Plus なら 1 日最大 {planQuota.plus.successPerDay} 回まで作成</p>
            </li>
            <li className="plus-landing__card card stack gap-2">
              <img
                src={qualityUrl}
                alt=""
                width={640}
                height={640}
                className="plus-landing__card-img"
                decoding="async"
              />
              <h2>くわしく作る</h2>
              <p>「くわしく作る」でより丁寧な献立（回数に限りあり）</p>
            </li>
            <li className="plus-landing__card card stack gap-2">
              <img
                src={flyerUrl}
                alt=""
                width={640}
                height={640}
                className="plus-landing__card-img"
                decoding="async"
              />
              <h2>チラシから 1 週間</h2>
              <p>チラシ写真から 1 週間の献立</p>
              <p className="type-small">{FLYER_PRIVACY_NOTE}</p>
            </li>
          </ul>

          <section className="stack gap-2" aria-labelledby="plus-compare-title">
            <h2 id="plus-compare-title">Free との違い</h2>
            {/* 数字 assert は testid 配下で絞る（R-C3）。裸の 3/10 は planQuota から組み立て */}
            <table className="plus-landing__compare" data-testid="plus-compare">
              <thead>
                <tr>
                  <th scope="col">項目</th>
                  <th scope="col">Free</th>
                  <th scope="col">Plus</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">1 日の献立作成（成功）</th>
                  <td>{planQuota.free.successPerDay}</td>
                  <td>{planQuota.plus.successPerDay}</td>
                </tr>
                <tr>
                  <th scope="row">くわしく作る</th>
                  <td>なし</td>
                  <td>あり（回数に限りあり）</td>
                </tr>
                <tr>
                  <th scope="row">チラシから 1 週間</th>
                  <td>なし</td>
                  <td>あり</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="stack gap-3" aria-label="お支払い">
            {!view.checkoutEnabled ? <p role="status">{SURFACES_CLOSED_COPY}</p> : null}
            <CheckoutIntervalForm
              disabled={!view.checkoutEnabled}
              pending={pending}
              onSubmit={(interval) => {
                void runCheckout(interval);
              }}
            />
          </section>
        </div>
      ) : null}

      {actionError !== null ? (
        <p role="alert" className="error-message">
          {actionError}
        </p>
      ) : null}
    </main>
  );
}
