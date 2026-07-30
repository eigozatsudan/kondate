import { Link } from "react-router";
import heroUrl from "./assets/free-hero.webp";
import familyUrl from "./assets/free-benefit-family.webp";
import menuUrl from "./assets/free-benefit-menu.webp";
import pantryUrl from "./assets/free-benefit-pantry.webp";
import "./free-landing-page.css";

export const FREE_LP_BRAND = "こんだて日和" as const;
export const FREE_LP_H1 = "今日の献立、家族に合わせて。" as const;
export const FREE_LP_LEAD = "無料で、家族の好みや食材に寄り添った献立づくり。" as const;
export const FREE_LP_CTA = "無料ではじめる" as const;
export const FREE_LP_LOGIN = "ログイン" as const;
export const FREE_LP_FAMILY_TITLE = "家族の好みを登録できる" as const;
export const FREE_LP_FAMILY_BODY =
  "年齢・苦手なもの・アレルギーを登録して、献立の条件に使えます" as const;
export const FREE_LP_MENU_TITLE = "予算と時間に合わせて作成" as const;
export const FREE_LP_MENU_BODY = "今日の予算や調理時間を指定して、一食の献立を作れます" as const;
export const FREE_LP_PANTRY_TITLE = "冷蔵庫の食材から考える" as const;
export const FREE_LP_PANTRY_BODY = "食材リストを登録して、使い切りやすい献立につなげます" as const;
export const FREE_LP_CLOSING = "まずは無料ではじめられます" as const;
export const FREE_LP_EXISTING = "すでにアカウントがある方は" as const;

/**
 * 未ログイン向け無料訴求 LP（設計 2026-07-30）。
 * API / entitlement / Plus に触れない。CTA は /login のみ（returnTo なし）。
 */
export function FreeLandingPage() {
  return (
    <main className="page-frame free-landing stack gap-4">
      <p className="free-landing__brand">{FREE_LP_BRAND}</p>

      <div className="free-landing__hero stack gap-2">
        <img
          src={heroUrl}
          alt=""
          width={1280}
          height={720}
          className="free-landing__hero-img"
          decoding="async"
        />
        <h1>{FREE_LP_H1}</h1>
        <p className="free-landing__lead">{FREE_LP_LEAD}</p>
        <div className="free-landing__cta-row">
          <Link className="primary-button min-h-11" to="/login">
            {FREE_LP_CTA}
          </Link>
          <Link className="secondary-button min-h-11 free-landing__login-link" to="/login">
            {FREE_LP_LOGIN}
          </Link>
        </div>
      </div>

      <ul className="free-landing__cards stack gap-3" aria-label="できること">
        <li className="free-landing__card card stack gap-2">
          <img
            src={familyUrl}
            alt=""
            width={640}
            height={640}
            className="free-landing__card-img"
            decoding="async"
          />
          <h2>{FREE_LP_FAMILY_TITLE}</h2>
          <p>{FREE_LP_FAMILY_BODY}</p>
        </li>
        <li className="free-landing__card card stack gap-2">
          <img
            src={menuUrl}
            alt=""
            width={640}
            height={640}
            className="free-landing__card-img"
            decoding="async"
          />
          <h2>{FREE_LP_MENU_TITLE}</h2>
          <p>{FREE_LP_MENU_BODY}</p>
        </li>
        <li className="free-landing__card card stack gap-2">
          <img
            src={pantryUrl}
            alt=""
            width={640}
            height={640}
            className="free-landing__card-img"
            decoding="async"
          />
          <h2>{FREE_LP_PANTRY_TITLE}</h2>
          <p>{FREE_LP_PANTRY_BODY}</p>
        </li>
      </ul>

      <section className="stack gap-2" aria-labelledby="free-lp-closing">
        <p id="free-lp-closing">{FREE_LP_CLOSING}</p>
        <Link className="primary-button min-h-11" to="/login">
          {FREE_LP_CTA}
        </Link>
        <p className="type-small">{FREE_LP_EXISTING}</p>
        <Link className="secondary-button min-h-11 free-landing__login-link" to="/login">
          {FREE_LP_LOGIN}
        </Link>
      </section>
    </main>
  );
}
