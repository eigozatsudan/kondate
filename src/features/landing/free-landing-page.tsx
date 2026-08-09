import { Link } from "react-router";
import heroUrl from "./assets/free-hero.webp";
import familyUrl from "./assets/free-benefit-family.webp";
import menuUrl from "./assets/free-benefit-menu.webp";
import pantryUrl from "./assets/free-benefit-pantry.webp";
import "./free-landing-page.css";

export const FREE_LP_BRAND = "こんだて日和" as const;
export const FREE_LP_H1 = "今日の献立、家族に合わせて。" as const;
export const FREE_LP_LEAD =
  "こんだて日和は、家庭の献立づくりを助けるアプリです。家族の好みやアレルギー、今日の予算・時間、冷蔵庫の食材を条件にして、一食分の献立を無料で作れます。" as const;
export const FREE_LP_LEAD_SUB =
  "難しい設定は不要です。まずは下の「無料ではじめる」からアカウントをつくり、気になるところだけ登録して使えます。" as const;
export const FREE_LP_CTA = "無料ではじめる" as const;
export const FREE_LP_LOGIN = "ログイン" as const;

export const FREE_LP_FLOW_TITLE = "はじめての使い方" as const;
export const FREE_LP_FLOW_STEPS = [
  "ログインして、家族の情報を登録する（あとからでも大丈夫）",
  "今日の予算・調理時間・食べたいものを選ぶ",
  "一食分の献立を作成し、買い物や作り方の目安を確認する",
] as const;

export const FREE_LP_FEATURES_TITLE = "無料でできること" as const;

export const FREE_LP_FAMILY_TITLE = "家族の好みを登録できる" as const;
export const FREE_LP_FAMILY_BODY =
  "献立をつくるとき、毎回ゼロから説明する必要がありません。登録した内容が条件として使われます。" as const;
export const FREE_LP_FAMILY_POINTS = [
  "年齢のめやすを選べます",
  "苦手なもの・食べないものを登録できます",
  "アレルギー情報を登録し、献立の条件に使えます",
] as const;

export const FREE_LP_MENU_TITLE = "予算と時間に合わせて作成" as const;
export const FREE_LP_MENU_BODY =
  "「今日は急いでいる」「買い出しは抑えめに」など、その日の都合に合わせて一食分の献立を作れます。" as const;
export const FREE_LP_MENU_POINTS = [
  "今日の予算のめやすを指定できます",
  "調理に使える時間を指定できます",
  "食べたいもの・避けたいものの希望を入れられます",
] as const;

export const FREE_LP_PANTRY_TITLE = "冷蔵庫の食材から考える" as const;
export const FREE_LP_PANTRY_BODY =
  "余っている食材をリストにしておくと、使い切りを意識した献立づくりにつなげやすくなります。" as const;
export const FREE_LP_PANTRY_POINTS = [
  "食材リストに手元の材料を登録できます",
  "使いたい食材を選んで献立に活かせます",
  "ムダを減らしやすい流れで買い物にもつなげられます",
] as const;

export const FREE_LP_CLOSING =
  "アカウント登録は無料です。家族の登録はあとからでも始められます。まずは一度、献立づくりを試してみてください。" as const;
export const FREE_LP_EXISTING = "すでにアカウントがある方は" as const;

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
