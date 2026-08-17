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

export type PublicLandingAssets = {
  heroSrc: string;
  familySrc: string;
  menuSrc: string;
  pantrySrc: string;
};

export const PUBLIC_LANDING_ASSET_PATHS: PublicLandingAssets = {
  heroSrc: "/src/features/landing/assets/free-hero.webp",
  familySrc: "/src/features/landing/assets/free-benefit-family.webp",
  menuSrc: "/src/features/landing/assets/free-benefit-menu.webp",
  pantrySrc: "/src/features/landing/assets/free-benefit-pantry.webp",
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function featureBlock(input: {
  src: string;
  title: string;
  body: string;
  points: readonly string[];
}): string {
  const points = input.points.map((point) => `<li>${escapeHtml(point)}</li>`).join("");
  return `<li class="free-landing__feature"><div class="free-landing__feature-head"><img src="${escapeHtml(input.src)}" alt="" width="640" height="640" class="free-landing__feature-img" decoding="async" /><h3 class="free-landing__feature-title">${escapeHtml(input.title)}</h3></div><p class="free-landing__feature-body">${escapeHtml(input.body)}</p><ul class="free-landing__points">${points}</ul></li>`;
}

export function buildPublicLandingHtml(assets: PublicLandingAssets): string {
  const steps = FREE_LP_FLOW_STEPS.map(
    (step, index) =>
      `<li class="free-landing__flow-item"><span class="free-landing__flow-num">${escapeHtml(String(index + 1))}</span><span>${escapeHtml(step)}</span></li>`,
  ).join("");
  return `<main class="page-frame free-landing"><div class="free-landing__hero"><p class="free-landing__brand">${escapeHtml(FREE_LP_BRAND)}</p><h1 class="free-landing__title">${escapeHtml(FREE_LP_H1)}</h1><p class="free-landing__lead">${escapeHtml(FREE_LP_LEAD)}</p><p class="free-landing__lead-sub">${escapeHtml(FREE_LP_LEAD_SUB)}</p><div class="free-landing__cta-row"><a class="primary-button min-h-11" href="/login">${escapeHtml(FREE_LP_CTA)}</a><a class="secondary-button min-h-11 free-landing__login-link" href="/login">${escapeHtml(FREE_LP_LOGIN)}</a></div></div><img src="${escapeHtml(assets.heroSrc)}" alt="" width="1280" height="720" class="free-landing__hero-img" decoding="async" /><section class="free-landing__flow" aria-labelledby="free-lp-flow-title"><h2 id="free-lp-flow-title" class="free-landing__section-title">${escapeHtml(FREE_LP_FLOW_TITLE)}</h2><ol class="free-landing__flow-list">${steps}</ol></section><section class="free-landing__features" aria-labelledby="free-lp-features-title"><h2 id="free-lp-features-title" class="free-landing__section-title">${escapeHtml(FREE_LP_FEATURES_TITLE)}</h2><ul class="free-landing__feature-list" aria-label="できること">${featureBlock({ src: assets.familySrc, title: FREE_LP_FAMILY_TITLE, body: FREE_LP_FAMILY_BODY, points: FREE_LP_FAMILY_POINTS })}${featureBlock({ src: assets.menuSrc, title: FREE_LP_MENU_TITLE, body: FREE_LP_MENU_BODY, points: FREE_LP_MENU_POINTS })}${featureBlock({ src: assets.pantrySrc, title: FREE_LP_PANTRY_TITLE, body: FREE_LP_PANTRY_BODY, points: FREE_LP_PANTRY_POINTS })}</ul></section><section class="free-landing__closing" aria-labelledby="free-lp-closing"><p id="free-lp-closing" class="free-landing__closing-body">${escapeHtml(FREE_LP_CLOSING)}</p><a class="primary-button min-h-11" href="/login">${escapeHtml(FREE_LP_CTA)}</a><p class="free-landing__closing-note">${escapeHtml(FREE_LP_EXISTING)}</p><a class="secondary-button min-h-11 free-landing__login-link" href="/login">${escapeHtml(FREE_LP_LOGIN)}</a></section></main>`;
}

export function buildPublicLandingHeadHtml(): string {
  const lead = escapeHtml(FREE_LP_LEAD);
  const brand = escapeHtml(FREE_LP_BRAND);
  return `<meta name="description" content="${lead}" />
    <meta property="og:title" content="${brand}" />
    <meta property="og:description" content="${lead}" />
    <meta property="og:locale" content="ja_JP" />
    <meta name="twitter:card" content="summary" />
    <link rel="canonical" href="/" />`;
}
