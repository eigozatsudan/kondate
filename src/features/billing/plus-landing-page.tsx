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
export const PLUS_LP_LEAD_BODY =
  "無料プランでも毎日の一食は十分使えます。Plus は、作成回数に余裕を持たせたり、より丁寧な献立を試したり、チラシ写真から 1 週間の献立をつくったりしたい方向けです。" as const;
export const PLUS_LP_LEAD_SUB =
  "月額・年額のどちらかを選び、画面の案内に沿ってお支払いへ進めます。難しい設定は不要です。" as const;
export const PLUS_LP_TRIAL = "はじめての方は 7 日間お試し（カード登録あり）" as const;
export const PLUS_LP_NEUTRAL_SUB = "Plus でできること" as const;
export const PLUS_LP_FEATURES_TITLE = "Plus の 3 つのメリット" as const;
export const PLUS_LP_ACTIVE = "こんだて日和 Plus をご利用中です" as const;
export const PLUS_LP_INCOMPLETE =
  "お支払いの手続きが完了していません。設定から続きをご確認ください。" as const;
export const PLUS_LP_CANCEL = "お支払いをキャンセルしました" as const;
export const PLUS_LP_CHECKOUT_IN_PROGRESS =
  "お支払い手続きが進行中です。しばらくしてからお試しください" as const;
export const PLUS_LP_SETTINGS_LINK = "設定へ" as const;

export const PLUS_LP_QUOTA_TITLE = "枠の余裕" as const;
export const PLUS_LP_QUOTA_BODY =
  "無料プランより多く、その日のうちに献立を作り直せます。家族の都合でやり直しが必要な日にも安心です。" as const;
export const PLUS_LP_QUALITY_TITLE = "くわしく作る" as const;
export const PLUS_LP_QUALITY_BODY =
  "献立作成時に「くわしく作る」を選ぶと、より丁寧な献立を目指せます。使える回数には上限があります。" as const;
export const PLUS_LP_FLYER_TITLE = "チラシから 1 週間" as const;
export const PLUS_LP_FLYER_BODY =
  "スーパーのチラシ写真を送ると、その特売を踏まえた 1 週間分の献立づくりに進めます（Plus だけの機能です）。" as const;

// BILL-1: ゲート定数は Settings と共有（LP 専用モジュールに閉じない）
import {
  PLUS_LP_COMING_SOON_BADGE,
  PLUS_LP_COMING_SOON_BODY,
  PLUS_LP_UPGRADE_COMING_SOON,
} from "./plus-upgrade-gate";
export { PLUS_LP_COMING_SOON_BADGE, PLUS_LP_COMING_SOON_BODY, PLUS_LP_UPGRADE_COMING_SOON };

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
  const fetching =
    entitlementLoading !== undefined ? entitlementLoading : query.isPending || query.isFetching;
  // B2: cache がある再 fetch（focus / 30s stale）では loading 短形に落とさない。
  // resolvePlusLandingView は loading なら data を捨てる（B6 入力契約）。
  // Settings は loading && data === null だけスピナー（plan-settings-section）。
  const loading = fetching && data === null;
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
  // B18: Checkout が use_portal / incomplete / already_entitled を返したとき Portal CTA を出す
  // （Settings の portalCtaFromCheckoutBlock と同型。COMING_SOON 解除後の非対称を閉じる）
  const [portalCtaFromCheckoutBlock, setPortalCtaFromCheckoutBlock] = useState(false);

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
    setPortalCtaFromCheckoutBlock(false);
    try {
      if (onCheckout !== undefined) {
        await onCheckout(interval);
      } else {
        // B4: 年額は form の確認後のみここに来る。API 契約へ同意を載せる。
        const { url } = await createCheckoutSession(
          interval === "year"
            ? { interval: "year", yearlyRefundAcknowledged: true }
            : { interval: "month" },
        );
        window.location.assign(url);
      }
    } catch (err) {
      // billing-api は envelope.error.code を Error.message に載せる
      const code = err instanceof Error ? err.message : "";
      if (code === "billing_checkout_in_progress") {
        setActionError(PLUS_LP_CHECKOUT_IN_PROGRESS);
      } else if (code === "billing_checkout_incomplete") {
        // B18: Settings と同型。Portal で手続き完了を促す
        setActionError(PLUS_LP_INCOMPLETE);
        setPortalCtaFromCheckoutBlock(true);
      } else if (code === "billing_checkout_use_portal" || code === "billing_already_entitled") {
        setActionError("お支払い管理から手続きしてください。新規のお申し込みはできません");
        setPortalCtaFromCheckoutBlock(true);
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
        <div className="stack gap-5 plus-landing__full">
          <div className="plus-landing__hero stack gap-3">
            <img
              src={heroUrl}
              alt=""
              width={1280}
              height={480}
              className="plus-landing__hero-img"
              decoding="async"
            />
            <h1>{PLUS_LP_H1}</h1>
            <p className="plus-landing__lead">{PLUS_LP_LEAD}</p>
            <p className="plus-landing__lead-body">{PLUS_LP_LEAD_BODY}</p>
            <p className="plus-landing__lead-sub">{PLUS_LP_LEAD_SUB}</p>
            {view.checkoutEnabled && !PLUS_LP_UPGRADE_COMING_SOON ? (
              <p className="plus-landing__trial">{PLUS_LP_TRIAL}</p>
            ) : (
              <p className="plus-landing__neutral">{PLUS_LP_NEUTRAL_SUB}</p>
            )}
          </div>

          <section className="stack gap-3" aria-labelledby="plus-features-title">
            <h2 id="plus-features-title" className="plus-landing__section-title">
              {PLUS_LP_FEATURES_TITLE}
            </h2>
            <ul className="plus-landing__cards stack gap-3" aria-label="Plus のメリット">
              <li className="plus-landing__card card stack gap-2">
                <div className="plus-landing__card-header">
                  <img
                    src={quotaUrl}
                    alt=""
                    width={160}
                    height={160}
                    className="plus-landing__card-img"
                    decoding="async"
                  />
                  <h3 className="plus-landing__card-title">{PLUS_LP_QUOTA_TITLE}</h3>
                </div>
                <p>{PLUS_LP_QUOTA_BODY}</p>
                <ul className="plus-landing__points">
                  <li>1 日の献立作成（成功）は最大 {planQuota.plus.successPerDay} 回まで</li>
                  <li>無料プラン（最大 {planQuota.free.successPerDay} 回）より余裕があります</li>
                  <li>作り直しが多い日でも、上限まで試せます</li>
                </ul>
              </li>
              <li className="plus-landing__card card stack gap-2">
                <div className="plus-landing__card-header">
                  <img
                    src={qualityUrl}
                    alt=""
                    width={160}
                    height={160}
                    className="plus-landing__card-img"
                    decoding="async"
                  />
                  <h3 className="plus-landing__card-title">{PLUS_LP_QUALITY_TITLE}</h3>
                </div>
                <p>{PLUS_LP_QUALITY_BODY}</p>
                <ul className="plus-landing__points">
                  <li>献立の質問の途中で「くわしく作る」を選べます</li>
                  <li>いつもより丁寧な献立を目指す方向けです</li>
                  <li>使える回数には上限があります（使い切ると通常の作成になります）</li>
                </ul>
              </li>
              <li className="plus-landing__card card stack gap-2">
                <div className="plus-landing__card-header">
                  <img
                    src={flyerUrl}
                    alt=""
                    width={160}
                    height={160}
                    className="plus-landing__card-img"
                    decoding="async"
                  />
                  <h3 className="plus-landing__card-title">{PLUS_LP_FLYER_TITLE}</h3>
                </div>
                <p>{PLUS_LP_FLYER_BODY}</p>
                <ul className="plus-landing__points">
                  <li>チラシの写真をアプリに送ります</li>
                  <li>1 週間分の献立づくりの入口になります</li>
                  <li>{FLYER_PRIVACY_NOTE}</li>
                </ul>
              </li>
            </ul>
          </section>

          <section className="stack gap-2" aria-labelledby="plus-compare-title">
            <h2 id="plus-compare-title" className="plus-landing__section-title">
              Free との違い
            </h2>
            <p className="type-small">
              無料のまま使える機能はそのまま残ります。Plus で増えるのは、次の 3 点です。
            </p>
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
            <h2 className="plus-landing__section-title">お支払いについて</h2>
            {PLUS_LP_UPGRADE_COMING_SOON ? (
              <p className="type-small">
                月額・年額の料金は下記のとおりです。アップグレードのお申し込みは公開後にご利用いただけます。
              </p>
            ) : (
              <p className="type-small">
                月額または年額を選び、「Plus
                をはじめる」を押すとカード入力の画面へ移ります。解約や領収の確認は、加入後に設定から行えます。
              </p>
            )}
            {PLUS_LP_UPGRADE_COMING_SOON ? (
              <div
                className="plus-landing__coming-soon"
                role="status"
                data-testid="plus-coming-soon"
              >
                <span className="plus-landing__coming-soon-badge" aria-hidden="true">
                  ✨ {PLUS_LP_COMING_SOON_BADGE}
                </span>
                <p className="plus-landing__coming-soon-body">{PLUS_LP_COMING_SOON_BODY}</p>
              </div>
            ) : null}
            {!view.checkoutEnabled && !PLUS_LP_UPGRADE_COMING_SOON ? (
              <p role="status">{SURFACES_CLOSED_COPY}</p>
            ) : null}
            <CheckoutIntervalForm
              disabled={!view.checkoutEnabled || PLUS_LP_UPGRADE_COMING_SOON}
              pending={pending}
              onSubmit={(interval) => {
                void runCheckout(interval);
              }}
            />
            {/* B18: use_portal / incomplete 等で Settings と同様に Portal CTA を出す */}
            {portalCtaFromCheckoutBlock && view.checkoutEnabled ? (
              <div className="stack gap-2">
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
