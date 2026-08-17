import { Link } from "react-router";
import heroUrl from "./assets/free-hero.webp";
import familyUrl from "./assets/free-benefit-family.webp";
import menuUrl from "./assets/free-benefit-menu.webp";
import pantryUrl from "./assets/free-benefit-pantry.webp";
import {
  FREE_LP_BRAND,
  FREE_LP_CLOSING,
  FREE_LP_CTA,
  FREE_LP_EXISTING,
  FREE_LP_FAMILY_BODY,
  FREE_LP_FAMILY_POINTS,
  FREE_LP_FAMILY_TITLE,
  FREE_LP_FEATURES_TITLE,
  FREE_LP_FLOW_STEPS,
  FREE_LP_FLOW_TITLE,
  FREE_LP_H1,
  FREE_LP_LEAD,
  FREE_LP_LEAD_SUB,
  FREE_LP_LOGIN,
  FREE_LP_MENU_BODY,
  FREE_LP_MENU_POINTS,
  FREE_LP_MENU_TITLE,
  FREE_LP_PANTRY_BODY,
  FREE_LP_PANTRY_POINTS,
  FREE_LP_PANTRY_TITLE,
} from "./free-landing-copy";
import "./free-landing-page.css";

export {
  FREE_LP_BRAND,
  FREE_LP_CLOSING,
  FREE_LP_CTA,
  FREE_LP_EXISTING,
  FREE_LP_FAMILY_BODY,
  FREE_LP_FAMILY_POINTS,
  FREE_LP_FAMILY_TITLE,
  FREE_LP_FEATURES_TITLE,
  FREE_LP_FLOW_STEPS,
  FREE_LP_FLOW_TITLE,
  FREE_LP_H1,
  FREE_LP_LEAD,
  FREE_LP_LEAD_SUB,
  FREE_LP_LOGIN,
  FREE_LP_MENU_BODY,
  FREE_LP_MENU_POINTS,
  FREE_LP_MENU_TITLE,
  FREE_LP_PANTRY_BODY,
  FREE_LP_PANTRY_POINTS,
  FREE_LP_PANTRY_TITLE,
} from "./free-landing-copy";

/**
 * 未ログイン向け無料訴求 LP（設計 2026-07-30）。
 * 画像は補助、説明文を主にする。API / entitlement / Plus に触れない。
 * CTA は /login のみ（returnTo なし）。
 */
export function FreeLandingPage() {
  return (
    <main className="page-frame free-landing">
      <div className="free-landing__hero">
        <p className="free-landing__brand">{FREE_LP_BRAND}</p>
        <h1 className="free-landing__title">{FREE_LP_H1}</h1>
        <p className="free-landing__lead">{FREE_LP_LEAD}</p>
        <p className="free-landing__lead-sub">{FREE_LP_LEAD_SUB}</p>
        <div className="free-landing__cta-row">
          <Link className="primary-button min-h-11" to="/login">
            {FREE_LP_CTA}
          </Link>
          <Link className="secondary-button min-h-11 free-landing__login-link" to="/login">
            {FREE_LP_LOGIN}
          </Link>
        </div>
      </div>

      <img
        src={heroUrl}
        alt=""
        width={1280}
        height={720}
        className="free-landing__hero-img"
        decoding="async"
      />

      <section className="free-landing__flow" aria-labelledby="free-lp-flow-title">
        <h2 id="free-lp-flow-title" className="free-landing__section-title">
          {FREE_LP_FLOW_TITLE}
        </h2>
        <ol className="free-landing__flow-list">
          {FREE_LP_FLOW_STEPS.map((step, index) => (
            <li key={step} className="free-landing__flow-item">
              <span className="free-landing__flow-num" aria-hidden="true">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="free-landing__features" aria-labelledby="free-lp-features-title">
        <h2 id="free-lp-features-title" className="free-landing__section-title">
          {FREE_LP_FEATURES_TITLE}
        </h2>
        <ul className="free-landing__feature-list" aria-label="できること">
          <li className="free-landing__feature">
            <div className="free-landing__feature-head">
              <img
                src={familyUrl}
                alt=""
                width={640}
                height={640}
                className="free-landing__feature-img"
                decoding="async"
              />
              <h3 className="free-landing__feature-title">{FREE_LP_FAMILY_TITLE}</h3>
            </div>
            <p className="free-landing__feature-body">{FREE_LP_FAMILY_BODY}</p>
            <ul className="free-landing__points">
              {FREE_LP_FAMILY_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </li>
          <li className="free-landing__feature">
            <div className="free-landing__feature-head">
              <img
                src={menuUrl}
                alt=""
                width={640}
                height={640}
                className="free-landing__feature-img"
                decoding="async"
              />
              <h3 className="free-landing__feature-title">{FREE_LP_MENU_TITLE}</h3>
            </div>
            <p className="free-landing__feature-body">{FREE_LP_MENU_BODY}</p>
            <ul className="free-landing__points">
              {FREE_LP_MENU_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </li>
          <li className="free-landing__feature">
            <div className="free-landing__feature-head">
              <img
                src={pantryUrl}
                alt=""
                width={640}
                height={640}
                className="free-landing__feature-img"
                decoding="async"
              />
              <h3 className="free-landing__feature-title">{FREE_LP_PANTRY_TITLE}</h3>
            </div>
            <p className="free-landing__feature-body">{FREE_LP_PANTRY_BODY}</p>
            <ul className="free-landing__points">
              {FREE_LP_PANTRY_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </li>
        </ul>
      </section>

      <section className="free-landing__closing" aria-labelledby="free-lp-closing">
        <p id="free-lp-closing" className="free-landing__closing-body">
          {FREE_LP_CLOSING}
        </p>
        <Link className="primary-button min-h-11" to="/login">
          {FREE_LP_CTA}
        </Link>
        <p className="free-landing__closing-note">{FREE_LP_EXISTING}</p>
        <Link className="secondary-button min-h-11 free-landing__login-link" to="/login">
          {FREE_LP_LOGIN}
        </Link>
      </section>
    </main>
  );
}
