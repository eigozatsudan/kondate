import { render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it } from "vitest";
import {
  FREE_LP_BRAND,
  FREE_LP_CLOSING,
  FREE_LP_EXISTING,
  FREE_LP_FAMILY_BODY,
  FREE_LP_FAMILY_TITLE,
  FREE_LP_FEATURES_TITLE,
  FREE_LP_FLOW_STEPS,
  FREE_LP_FLOW_TITLE,
  FREE_LP_H1,
  FREE_LP_LEAD,
  FREE_LP_LEAD_SUB,
  FREE_LP_MENU_TITLE,
  FREE_LP_PANTRY_TITLE,
} from "./free-landing-copy";
import {
  PUBLIC_LANDING_ASSET_PATHS,
  buildPublicLandingHeadHtml,
  buildPublicLandingHtml,
  escapeHtml,
} from "./build-public-landing-html";
import { FreeLandingPage } from "./free-landing-page";

const FORBIDDEN = ["Plus", "plus", "安全", "絶対", "保証", "無制限", "何回でも"] as const;

// React textContent はブロック境界に空白を入れず、stripTags はタグを空白にする。
// 可視文言の一致だけを見るため空白差は潰す。
function flattenText(value: string): string {
  return value.replace(/\s+/gu, "").trim();
}

function stripTags(html: string): string {
  return flattenText(html.replace(/<[^>]+>/gu, " "));
}

describe("escapeHtml", () => {
  it("escapes ampersand first then markup characters", () => {
    expect(escapeHtml(`&<>"`)).toBe("&amp;&lt;&gt;&quot;");
  });
});

describe("buildPublicLandingHtml", () => {
  it("includes copy, login hrefs, four images, and no forbidden words", () => {
    const html = buildPublicLandingHtml(PUBLIC_LANDING_ASSET_PATHS);
    expect(html).toContain(FREE_LP_H1);
    expect(html).toContain(FREE_LP_LEAD);
    expect(html).toContain(FREE_LP_LEAD_SUB);
    expect(html).toContain(FREE_LP_FLOW_TITLE);
    for (const step of FREE_LP_FLOW_STEPS) expect(html).toContain(step);
    expect(html).toContain(FREE_LP_FEATURES_TITLE);
    expect(html).toContain(FREE_LP_FAMILY_TITLE);
    expect(html).toContain(FREE_LP_FAMILY_BODY);
    expect(html).toContain(FREE_LP_MENU_TITLE);
    expect(html).toContain(FREE_LP_PANTRY_TITLE);
    expect(html).toContain(FREE_LP_CLOSING);
    expect(html).toContain(FREE_LP_EXISTING);
    expect(html).toContain('href="/login"');
    expect(html).not.toMatch(/\bhidden\b/u);
    expect(html).not.toContain("aria-hidden");
    expect(html).not.toContain("style=");
    expect(html).not.toContain("display:none");
    for (const word of FORBIDDEN) expect(html).not.toContain(word);

    const imgs = [...html.matchAll(/<img\b([^>]*)>/gu)].map((match) => match[1] ?? "");
    expect(imgs).toHaveLength(4);
    expect(imgs[0]).toContain(`src="${PUBLIC_LANDING_ASSET_PATHS.heroSrc}"`);
    expect(imgs[0]).toContain('alt=""');
    expect(imgs[0]).toContain('width="1280"');
    expect(imgs[0]).toContain('height="720"');
    for (const attrs of imgs.slice(1)) {
      expect(attrs).toContain('alt=""');
      expect(attrs).toContain('width="640"');
      expect(attrs).toContain('height="640"');
    }
  });

  it("matches FreeLandingPage visible text", () => {
    const router = createMemoryRouter(
      [
        { path: "/", element: <FreeLandingPage /> },
        { path: "/login", element: <h1>ログイン画面</h1> },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByRole("heading", { level: 1, name: FREE_LP_H1 })).toBeVisible();
    const reactText = flattenText(document.body.textContent ?? "");
    const staticText = stripTags(buildPublicLandingHtml(PUBLIC_LANDING_ASSET_PATHS));
    expect(staticText).toBe(reactText);
  });
});

describe("buildPublicLandingHeadHtml", () => {
  it("uses escaped lead and relative canonical", () => {
    const head = buildPublicLandingHeadHtml();
    expect(head).toContain(`content="${escapeHtml(FREE_LP_LEAD)}"`);
    expect(head).toContain(`content="${escapeHtml(FREE_LP_BRAND)}"`);
    expect(head).toContain('property="og:locale" content="ja_JP"');
    expect(head).toContain('name="twitter:card" content="summary"');
    expect(head).toContain('rel="canonical" href="/"');
    expect(head).not.toContain("og:url");
    expect(head).not.toContain("og:image");
  });
});
