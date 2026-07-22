// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const cssWithoutImports = css.replace(/@import\s+[^;]+;/g, "");

type CssDeclarations = Map<string, string>;

type CssAtRule = {
  type: string;
  condition: string;
};

type CssRule = {
  selector: string;
  declarations: CssDeclarations;
  atRules: readonly CssAtRule[];
  sourceOrder: number;
};

/** jsdomのCSSOMを使い、functional pseudo内のcommaをselector-listと誤認しない。 */
function cssRules(source: string): CssRule[] {
  const parsedSource = source.replace(/@import\s+[^;]+;/g, "");
  const style = document.createElement("style");
  style.textContent = parsedSource;
  document.head.append(style);
  const sheet = style.sheet;
  if (sheet === null) throw new Error("stylesheet could not be parsed");
  const result: CssRule[] = [];

  let sourceOrder = 0;

  function collect(rules: CSSRuleList, atRules: readonly CssAtRule[]): void {
    for (const rule of Array.from(rules)) {
      if ("selectorText" in rule && "style" in rule) {
        const styleRule = rule as CSSStyleRule;
        const parsedDeclarations: CssDeclarations = new Map();
        for (let index = 0; index < styleRule.style.length; index += 1) {
          const property = styleRule.style.item(index);
          const priority = styleRule.style.getPropertyPriority(property);
          const value = styleRule.style.getPropertyValue(property).trim();
          parsedDeclarations.set(
            property,
            priority === "important" ? `${value} !important` : value,
          );
        }
        result.push({
          selector: styleRule.selectorText.replace(/\s+/g, " ").trim(),
          declarations: parsedDeclarations,
          atRules,
          sourceOrder,
        });
        sourceOrder += 1;
      } else if ("cssRules" in rule) {
        const groupingRule = rule as CSSGroupingRule;
        const type = /^@([\w-]+)/u.exec(rule.cssText.trim())?.[1]?.toLowerCase() ?? "unknown";
        const condition =
          "conditionText" in rule ? String(rule.conditionText).replace(/\s+/g, " ").trim() : "";
        collect(groupingRule.cssRules, [...atRules, { type, condition }]);
      }
    }
  }

  collect(sheet.cssRules, []);
  style.remove();
  return result;
}

const selectorGroups: Readonly<Record<string, readonly string[]>> = {
  body: ["html, body, #root"],
  button: ["button, a, input, select, textarea", "button, .button-link"],
  a: ["button, a, input, select, textarea"],
  input: ["button, a, input, select, textarea"],
  select: ["button, a, input, select, textarea"],
  textarea: ["button, a, input, select, textarea"],
  ".primary-button": [".primary-button, .secondary-button, .text-button"],
  ".secondary-button": [".primary-button, .secondary-button, .text-button"],
  ".text-button": [".primary-button, .secondary-button, .text-button"],
  ".field input": [".field input, .field select"],
  ".field select": [".field input, .field select"],
  ".wizard-title": [
    ".wizard-title, .wizard-description, .wizard-action, .choice-card > *, .inline-notice-title, .inline-notice-body, .review-row-label, .review-row-value",
  ],
  ".wizard-description": [
    ".wizard-title, .wizard-description, .wizard-action, .choice-card > *, .inline-notice-title, .inline-notice-body, .review-row-label, .review-row-value",
    ".wizard-description, .choice-card-description, .inline-notice-body",
  ],
  ".wizard-action": [
    ".wizard-title, .wizard-description, .wizard-action, .choice-card > *, .inline-notice-title, .inline-notice-body, .review-row-label, .review-row-value",
  ],
  ".choice-card > *": [
    ".wizard-title, .wizard-description, .wizard-action, .choice-card > *, .inline-notice-title, .inline-notice-body, .review-row-label, .review-row-value",
  ],
  ".choice-card-description": [
    ".guided-planner-theme",
    ".wizard-description, .choice-card-description, .inline-notice-body",
  ],
  '.choice-card[aria-pressed="true"]': [],
  ".choice-card-selection": [".guided-planner-theme"],
  ".progress-indicator": [".guided-planner-theme"],
  ".inline-notice-title": [
    ".guided-planner-theme",
    ".wizard-title, .wizard-description, .wizard-action, .choice-card > *, .inline-notice-title, .inline-notice-body, .review-row-label, .review-row-value",
    ".inline-notice-title, .inline-notice-body",
  ],
  ".inline-notice-body": [
    ".guided-planner-theme",
    ".wizard-title, .wizard-description, .wizard-action, .choice-card > *, .inline-notice-title, .inline-notice-body, .review-row-label, .review-row-value",
    ".wizard-description, .choice-card-description, .inline-notice-body",
    ".inline-notice-title, .inline-notice-body",
  ],
  ".inline-notice-error": [".guided-planner-theme"],
  ".review-row-label": [
    ".wizard-title, .wizard-description, .wizard-action, .choice-card > *, .inline-notice-title, .inline-notice-body, .review-row-label, .review-row-value",
    ".review-row-label, .review-row-value",
  ],
  ".review-row-value": [
    ".wizard-title, .wizard-description, .wizard-action, .choice-card > *, .inline-notice-title, .inline-notice-body, .review-row-label, .review-row-value",
    ".review-row-label, .review-row-value",
  ],
};

/** 競合selectorは禁止済みなので、許可済みexact ruleだけをsource orderで合成する。 */
function declarationsForSelector(
  source: string,
  selector: string,
  media: string | null = null,
): CssDeclarations {
  const result: CssDeclarations = new Map();
  const acceptedSelectors = new Set([selector, ...(selectorGroups[selector] ?? [])]);
  for (const rule of cssRules(source)) {
    const expectedAtRules =
      media === null ? [] : [{ type: "media", condition: media.replace(/\s+/g, " ").trim() }];
    if (
      JSON.stringify(rule.atRules) !== JSON.stringify(expectedAtRules) ||
      !acceptedSelectors.has(rule.selector)
    )
      continue;
    for (const [property, value] of rule.declarations) result.set(property, value);
  }
  return result;
}

/** reduce環境で成立するtop-levelと単独mediaを、実際のsource orderどおり合成する。 */
function reducedMotionDeclarations(source: string, selector: string): CssDeclarations {
  const result: CssDeclarations = new Map();
  for (const rule of cssRules(source).sort((a, b) => a.sourceOrder - b.sourceOrder)) {
    const applies =
      rule.atRules.length === 0 ||
      (rule.atRules.length === 1 &&
        rule.atRules[0]?.type === "media" &&
        rule.atRules[0].condition === "(prefers-reduced-motion: reduce)");
    if (!applies || rule.selector !== selector) continue;
    for (const [property, value] of rule.declarations) result.set(property, value);
  }
  return result;
}

/** scope selector自身の全blockを順番に畳み込み、後置blockの最終tokenを返す。 */
function scopedDeclarations(source: string): CssDeclarations {
  return declarationsForSelector(source, ".guided-planner-theme");
}

const allowedGuidedSelectors = new Set([
  ".guided-planner-theme",
  ".guided-planner-theme :is(button, a, input, select, textarea):focus-visible",
  ".guided-planner-theme .wizard-title:focus-visible",
  ".guided-planner-theme .primary-button",
  ".guided-planner-theme .primary-button:hover",
  ".guided-planner-theme .primary-button:active",
]);

function findUnscopedDesignColorLeaks(source: string, colors: ReadonlySet<string>): string[] {
  const leaks: string[] = [];
  const canonicalColors = new Set(
    Array.from(colors).flatMap((color) => [color, canonicalCssValue("color", color)]),
  );
  for (const rule of cssRules(source)) {
    const usesDesignColor = Array.from(rule.declarations.values()).some((value) =>
      Array.from(canonicalColors).some((color) => value.toLowerCase().includes(color)),
    );
    if (!usesDesignColor) continue;
    if (!allowedGuidedSelectors.has(rule.selector)) leaks.push(rule.selector);
  }
  return leaks;
}

function canonicalCssValue(property: string, value: string): string {
  const element = document.createElement("div");
  element.style.setProperty(property, value);
  return element.style.getPropertyValue(property).trim();
}

const protectedSelectorFragments = [
  ".guided-planner-theme",
  ".wizard-",
  ".choice-card",
  ".progress-",
  ".inline-notice",
  ".review-row",
  ".primary-button",
  ".secondary-button",
  ".text-button",
  ".field",
  ".app-section",
  ":root",
] as const;

const allowedProtectedSelectors = new Set([
  ":root",
  ".guided-planner-theme",
  ".guided-planner-theme :is(button, a, input, select, textarea):focus-visible",
  ".guided-planner-theme .wizard-title:focus-visible",
  ".guided-planner-theme .primary-button",
  ".guided-planner-theme .primary-button:hover",
  ".guided-planner-theme .primary-button:active",
  ".wizard-frame",
  ".wizard-header, .wizard-content, .wizard-actions",
  ".wizard-title",
  ".wizard-title, .wizard-description, .wizard-action, .choice-card > *, .inline-notice-title, .inline-notice-body, .review-row-label, .review-row-value",
  ".wizard-description, .choice-card-description, .inline-notice-body",
  ".wizard-actions",
  ".wizard-action",
  ".choice-card",
  ".choice-card:disabled",
  '.choice-card[aria-pressed="true"]',
  '.choice-card[aria-pressed="true"] > strong',
  '.choice-card[aria-pressed="true"] .choice-card-description',
  ".choice-card-selection",
  ".progress-indicator",
  ".progress-track",
  ".progress-value",
  ".inline-notice",
  ".inline-notice-error",
  ".inline-notice-error .inline-notice-title, .inline-notice-error .inline-notice-body",
  ".inline-notice-title, .inline-notice-body",
  ".inline-notice-title",
  ".review-row",
  ".review-row-label, .review-row-value",
  ".wizard-transition",
  ".app-section",
  "html, body, #root",
  "body",
  "button, a, input, select, textarea",
  "button, .button-link",
  "button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible",
  ".primary-button, .secondary-button, .text-button",
  ".primary-button",
  ".primary-button:hover",
  ".secondary-button",
  ".text-button",
  ".field",
  ".field input, .field select",
]);

function touchesProtectedContract(selector: string): boolean {
  if (protectedSelectorFragments.some((fragment) => selector.includes(fragment))) return true;
  return /(?:^|[\s>+~,(])(?:body|button|a|input|select|textarea)(?=$|[\s>+~,.#:[\]()])/u.test(
    selector,
  );
}

function unexpectedProtectedSelectors(source: string): string[] {
  return cssRules(source)
    .filter((rule) => {
      if (!touchesProtectedContract(rule.selector)) return false;
      if (!allowedProtectedSelectors.has(rule.selector)) return true;
      if (Array.from(rule.declarations.values()).some((value) => value.endsWith(" !important"))) {
        return true;
      }
      if (rule.atRules.length === 0) return false;
      const reducedMotionException =
        rule.selector === ".wizard-transition" &&
        rule.atRules.length === 1 &&
        rule.atRules[0]?.type === "media" &&
        rule.atRules[0].condition === "(prefers-reduced-motion: reduce)" &&
        rule.declarations.size === 1 &&
        rule.declarations.get("animation") === "none";
      return !reducedMotionException;
    })
    .map((rule) => rule.selector);
}

function expectEffectiveDeclarations(selector: string, expected: Record<string, string>): void {
  const declarations = declarationsForSelector(cssWithoutImports, selector);
  for (const [property, value] of Object.entries(expected)) {
    expect(declarations.get(property), `${selector} ${property}`).toBe(
      canonicalCssValue(property, value),
    );
  }
}

function expectExactRuleDeclarations(
  selector: string,
  expected: Record<string, string>,
  media: string | null = null,
): void {
  const matchingRules = cssRules(cssWithoutImports).filter(
    (rule) =>
      rule.selector === selector &&
      JSON.stringify(rule.atRules) ===
        JSON.stringify(
          media === null ? [] : [{ type: "media", condition: media.replace(/\s+/g, " ").trim() }],
        ),
  );
  expect(matchingRules, selector).toHaveLength(1);
  const canonicalExpected = new Map(
    Object.entries(expected).map(([property, value]) => [
      property,
      canonicalCssValue(property, value),
    ]),
  );
  expect(matchingRules[0]?.declarations, selector).toEqual(canonicalExpected);
}

function expectFinalDeclarations(selector: string, expected: Record<string, string>): void {
  const declarations = declarationsForSelector(cssWithoutImports, selector);
  for (const [property, value] of Object.entries(expected)) {
    expect(declarations.get(property), `${selector} ${property}`).toBe(
      canonicalCssValue(property, value),
    );
  }
}

/** :root ブロックから `--name: #rrggbb;` を読み出す。 */
function token(name: string): string {
  const value = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1];
  if (value === undefined) throw new Error(`token --${name} not found`);
  return value;
}

function scopedToken(name: string): string {
  const value = scopedDeclarations(css).get(`--${name}`);
  if (value === undefined || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`scoped token --${name} not found`);
  }
  return value.toLowerCase();
}

/** 16進色の1チャンネル分をガンマ補正した値。offset は r=1, g=3, b=5。 */
function channel(hex: string, offset: number): number {
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** sRGB 16進色の相対輝度（WCAG 2.1 定義）。 */
function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

describe("color token contrast", () => {
  const white = "#ffffff";

  it("keeps body text readable on the page background", () => {
    expect(contrast(token("text"), "#f8fafc")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps muted text readable on card surfaces", () => {
    expect(contrast(token("muted"), token("surface"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps primary-button label readable on the primary fill", () => {
    expect(contrast(token("primary-ink"), token("primary"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps primary-coloured text readable on white", () => {
    expect(contrast(token("primary-strong"), white)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps error text readable on card surfaces", () => {
    expect(contrast(token("danger"), token("surface"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps pantry-accent text readable on card surfaces", () => {
    expect(contrast(token("pantry"), token("surface"))).toBeGreaterThanOrEqual(4.5);
  });

  const tints = {
    planner: "#fff1e6",
    pantry: "#e6f4f1",
    history: "#efebfb",
    shopping: "#fdf0f3",
    settings: "#f1f5f9",
  } as const;

  for (const [section, tint] of Object.entries(tints)) {
    it(`keeps body text readable on the ${section} tint`, () => {
      expect(contrast(token("text"), tint)).toBeGreaterThanOrEqual(4.5);
    });

    it(`keeps muted text readable on the ${section} tint`, () => {
      expect(contrast(token("muted"), tint)).toBeGreaterThanOrEqual(4.5);
    });

    it(`declares the ${section} tint in the stylesheet`, () => {
      expect(css).toContain(`[data-section="${section}"]`);
      expect(css.toLowerCase()).toContain(tint);
    });
  }
});

describe("guided planner theme", () => {
  const expectedTokens = {
    "app-background": "#f7f2e9",
    surface: "#fffdf8",
    text: "#423a32",
    muted: "#6b5e52",
    primary: "#d9a48f",
    "primary-hover": "#cf947d",
    "primary-active": "#cc927b",
    "primary-ink": "#3b302b",
    "primary-strong": "#8b4e3b",
    selection: "#f4e6df",
    notice: "#f8ece7",
    border: "#d8c9bc",
    focus: "#8b4e3b",
    pantry: "#416b5a",
    danger: "#9f342c",
  } as const;

  it("declares the exact scoped palette", () => {
    for (const [name, value] of Object.entries(expectedTokens)) {
      expect(scopedToken(name)).toBe(value);
    }
  });

  it("keeps all guided planner text combinations readable", () => {
    expect(contrast(scopedToken("text"), scopedToken("surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(scopedToken("muted"), scopedToken("surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(scopedToken("primary-ink"), scopedToken("primary"))).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(
      contrast(scopedToken("primary-ink"), scopedToken("primary-hover")),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(scopedToken("primary-ink"), scopedToken("primary-active")),
    ).toBeGreaterThanOrEqual(4.5);
    expect(contrast(scopedToken("text"), scopedToken("selection"))).toBeCloseTo(9.15, 1);
    expect(contrast(scopedToken("muted"), scopedToken("selection"))).toBeCloseTo(5.15, 1);
    expect(contrast(scopedToken("text"), scopedToken("notice"))).toBeCloseTo(9.64, 1);
    expect(contrast(scopedToken("muted"), scopedToken("notice"))).toBeCloseTo(5.42, 1);
    expect(contrast(scopedToken("danger"), scopedToken("notice"))).toBeCloseTo(6.04, 1);
    expect(contrast(scopedToken("pantry"), scopedToken("surface"))).toBeCloseTo(5.94, 1);
  });

  it("keeps the new palette scoped and fixes visual contracts", () => {
    expect(token("primary").toLowerCase()).toBe("#f97316");
    expect(css).toMatch(/body\s*\{[^}]*font-size:\s*16px/s);
    expect(css).toMatch(/\.app-section\s*\{[^}]*var\(--section-tint\)/s);
    expect(css).toMatch(/\.guided-planner-theme[^}]*--focus:\s*#8b4e3b/s);
    expect(css).toMatch(/\.choice-card\[aria-pressed="true"\][^}]*border-color:/s);
    expect(css).toMatch(/\.choice-card\s*\{[^}]*border-radius:\s*(18|19|20)px/s);
    expect(css).toMatch(/\.choice-card\s*\{[^}]*box-shadow:/s);
    expect(css).toMatch(/\.wizard-action[^}]*min-height:\s*44px/s);
    expect(css).toMatch(
      /\.guided-planner-theme \.wizard-title:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus\)[^}]*outline-offset:\s*2px/s,
    );
  });

  it("preserves every existing global appearance selector", () => {
    expectEffectiveDeclarations(":root", {
      color: "#1e293b",
      background: "#f8fafc",
      "font-family":
        '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", system-ui, sans-serif',
      "font-synthesis": "none",
      "text-rendering": "optimizeLegibility",
      "--surface": "#ffffff",
      "--text": "#1e293b",
      "--muted": "#475569",
      "--primary": "#f97316",
      "--primary-hover": "#ea580c",
      "--primary-ink": "#1e293b",
      "--primary-strong": "#c2410c",
      "--pantry": "#0f766e",
      "--danger": "#dc2626",
      "--border": "#e2e8f0",
      "--section-tint": "#f8fafc",
    });
    expectEffectiveDeclarations("body", {
      "min-width": "320px",
      "min-height": "100vh",
      margin: "0",
      "font-size": "16px",
      "line-height": "1.6",
    });
    for (const selector of ["button", "a", "input", "select", "textarea"]) {
      expectEffectiveDeclarations(selector, { font: "inherit" });
    }
    expectEffectiveDeclarations("button", { "min-width": "44px", "min-height": "44px" });
    expectEffectiveDeclarations(".primary-button", {
      display: "inline-flex",
      "align-items": "center",
      "justify-content": "center",
      "border-radius": "12px",
      padding: "10px 16px",
      "font-weight": "700",
      "text-decoration": "none",
      cursor: "pointer",
      border: "1px solid var(--primary)",
      color: "var(--primary-ink)",
      background: "var(--primary)",
    });
    expectEffectiveDeclarations(".primary-button:hover", {
      background: "var(--primary-hover)",
    });
    expectEffectiveDeclarations(".secondary-button", {
      display: "inline-flex",
      "align-items": "center",
      "justify-content": "center",
      "border-radius": "12px",
      padding: "10px 16px",
      "font-weight": "700",
      "text-decoration": "none",
      cursor: "pointer",
      border: "1px solid var(--primary)",
      color: "var(--primary-strong)",
      background: "transparent",
    });
    expectEffectiveDeclarations(".text-button", {
      display: "inline-flex",
      "align-items": "center",
      "justify-content": "center",
      "border-radius": "12px",
      padding: "10px 16px",
      "font-weight": "700",
      cursor: "pointer",
      border: "0",
      color: "var(--primary-strong)",
      background: "transparent",
      "text-decoration": "underline",
    });
    expectEffectiveDeclarations(".field", { display: "grid", gap: "6px" });
    for (const selector of [".field input", ".field select"]) {
      expectEffectiveDeclarations(selector, {
        width: "100%",
        "min-height": "48px",
        border: "1px solid var(--border)",
        "border-radius": "10px",
        background: "#fff",
        padding: "10px 12px",
      });
    }
    expectEffectiveDeclarations(".app-section", {
      "min-height": "100vh",
      background: "var(--section-tint)",
    });

    const guidedPalette = new Set<string>(Object.values(expectedTokens));
    expect(findUnscopedDesignColorLeaks(cssWithoutImports, guidedPalette)).toEqual([]);
    expect(unexpectedProtectedSelectors(cssWithoutImports)).toEqual([]);
  });

  it("detects adversarial global leaks without splitting functional selector lists", () => {
    const guidedPalette = new Set<string>(Object.values(expectedTokens));
    const fixture = `
      .guided-planner-theme .probe, body { color: #f7f2e9; }
      :root { --primary-hover: #cf947d; }
      .shell .primary-button { background: #cc927b; }
      .field input { color: #3b302b !important; }
    `;
    expect(findUnscopedDesignColorLeaks(fixture, guidedPalette)).toEqual([
      ".guided-planner-theme .probe, body",
      ":root",
      ".shell .primary-button",
      ".field input",
    ]);
  });

  it("rejects every non-allowlisted selector that can compete with protected styles", () => {
    const fixture = `
      .guided-planner-theme :is(.primary-button, .choice-card) { color: #fff; }
      .guided-planner-theme :not(.wizard-title) { color: #fff; }
      .guided-planner-theme :where(.inline-notice) { color: #fff; }
      .guided-planner-theme + .outside { color: #f7f2e9; }
      .guided-planner-theme .choice-card, body { color: #f7f2e9; }
      #app .guided-planner-theme .primary-button { color: #fff !important; }
      .guided-planner-theme .primary-button { color: #fff !important; }
    `;
    const guidedPalette = new Set<string>(Object.values(expectedTokens));

    expect(findUnscopedDesignColorLeaks(fixture, guidedPalette)).toEqual([
      ".guided-planner-theme + .outside",
      ".guided-planner-theme .choice-card, body",
    ]);
    expect(unexpectedProtectedSelectors(fixture)).toEqual([
      ".guided-planner-theme :is(.primary-button, .choice-card)",
      ".guided-planner-theme :not(.wizard-title)",
      ".guided-planner-theme :where(.inline-notice)",
      ".guided-planner-theme + .outside",
      ".guided-planner-theme .choice-card, body",
      "#app .guided-planner-theme .primary-button",
      ".guided-planner-theme .primary-button",
    ]);
  });

  it("rejects protected overrides in every conditional context", () => {
    const arbitraryMedia = `
      @media (min-width: 1px) {
        .guided-planner-theme .primary-button { color: transparent; }
      }
    `;
    const supportsMasqueradingAsReducedMotion = `
      @supports (prefers-reduced-motion: reduce) {
        .wizard-transition { animation: none; }
      }
    `;
    const nestedReducedMotion = `
      @supports (display: grid) {
        @media (prefers-reduced-motion: reduce) {
          .wizard-transition { animation: none; }
        }
      }
    `;

    expect(unexpectedProtectedSelectors(arbitraryMedia)).toEqual([
      ".guided-planner-theme .primary-button",
    ]);
    expect(unexpectedProtectedSelectors(supportsMasqueradingAsReducedMotion)).toEqual([
      ".wizard-transition",
    ]);
    expect(unexpectedProtectedSelectors(nestedReducedMotion)).toEqual([".wizard-transition"]);
  });

  it("detects a later top-level animation that re-enables reduced motion", () => {
    const fixture = `
      .wizard-transition { animation: wizard-enter 180ms ease-out; }
      @media (prefers-reduced-motion: reduce) {
        .wizard-transition { animation: none; }
      }
      .wizard-transition { animation: wizard-enter 180ms ease-out; }
    `;

    expect(reducedMotionDeclarations(fixture, ".wizard-transition").get("animation")).toBe(
      "wizard-enter 180ms ease-out",
    );
  });

  it("keeps final scoped component colors connected to their tokens", () => {
    expectExactRuleDeclarations(".guided-planner-theme .primary-button", {
      "border-color": "var(--primary)",
      color: "var(--primary-ink)",
      background: "var(--primary)",
    });
    expectExactRuleDeclarations(".guided-planner-theme .primary-button:hover", {
      "border-color": "var(--primary-hover)",
      color: "var(--primary-ink)",
      background: "var(--primary-hover)",
    });
    expectExactRuleDeclarations(".guided-planner-theme .primary-button:active", {
      "border-color": "var(--primary-active)",
      color: "var(--primary-ink)",
      background: "var(--primary-active)",
    });
    expectExactRuleDeclarations('.choice-card[aria-pressed="true"]', {
      "border-color": "var(--primary-strong)",
      color: "var(--text)",
      background: "var(--selection)",
    });
    expectFinalDeclarations(".choice-card", {
      color: "var(--text)",
      background: "var(--surface)",
    });
    expectFinalDeclarations(".choice-card-description", { color: "var(--muted)" });
    expectFinalDeclarations(".choice-card-selection", { color: "var(--primary-strong)" });
    expectFinalDeclarations(".inline-notice", { background: "var(--notice)" });
    expectFinalDeclarations(".inline-notice-body", { color: "var(--muted)" });
    expectFinalDeclarations(".inline-notice-error", { color: "var(--danger)" });
    expectExactRuleDeclarations(".guided-planner-theme .wizard-title:focus-visible", {
      outline: "3px solid var(--focus)",
      "outline-offset": "2px",
    });
    expectExactRuleDeclarations(
      ".guided-planner-theme :is(button, a, input, select, textarea):focus-visible",
      { outline: "3px solid var(--focus)", "outline-offset": "2px" },
    );
  });

  it("binds every visible wizard state to a readable foreground and background", () => {
    const bindings = [
      [".wizard-title", "color", "text", "app-background"],
      [".wizard-description", "color", "muted", "app-background"],
      [".progress-indicator", "color", "muted", "app-background"],
      [".guided-planner-theme .primary-button", "color", "primary-ink", "primary"],
      [".guided-planner-theme .primary-button:hover", "color", "primary-ink", "primary-hover"],
      [".guided-planner-theme .primary-button:active", "color", "primary-ink", "primary-active"],
      ['.choice-card[aria-pressed="true"] > strong', "color", "text", "selection"],
      ['.choice-card[aria-pressed="true"] .choice-card-description', "color", "muted", "selection"],
      [".choice-card-selection", "color", "primary-strong", "selection"],
      [".inline-notice-title", "color", "text", "notice"],
      [".inline-notice-body", "color", "muted", "notice"],
    ] as const;

    for (const [selector, property, foreground, background] of bindings) {
      expectFinalDeclarations(selector, { [property]: `var(--${foreground})` });
      expect(
        contrast(scopedToken(foreground), scopedToken(background)),
        selector,
      ).toBeGreaterThanOrEqual(4.5);
    }
    expectExactRuleDeclarations('.choice-card[aria-pressed="true"] > strong', {
      color: "var(--text)",
    });
    expectExactRuleDeclarations('.choice-card[aria-pressed="true"] .choice-card-description', {
      color: "var(--muted)",
    });
    expectExactRuleDeclarations(".inline-notice-title", { color: "var(--text)" });
    expectExactRuleDeclarations(
      ".inline-notice-error .inline-notice-title, .inline-notice-error .inline-notice-body",
      { color: "var(--danger)" },
    );
    expectFinalDeclarations(".progress-track", { background: "var(--border)" });
    expectFinalDeclarations(".progress-value", { background: "var(--primary-strong)" });
    expectFinalDeclarations(
      ".inline-notice-error .inline-notice-title, .inline-notice-error .inline-notice-body",
      { color: "var(--danger)" },
    );
    expect(contrast(scopedToken("danger"), scopedToken("notice"))).toBeGreaterThanOrEqual(4.5);
  });

  it("fixes the exact shadow and motion accessibility contract", () => {
    expectFinalDeclarations(".choice-card", {
      "box-shadow": "0 4px 16px rgb(66 58 50 / 8%)",
    });
    const normalMotion = declarationsForSelector(cssWithoutImports, ".wizard-transition");
    expect(normalMotion.get("animation")).toBe("wizard-enter 180ms ease-out");
    const reducedMotion = reducedMotionDeclarations(cssWithoutImports, ".wizard-transition");
    expect(reducedMotion.get("animation")).toBe("none");
    expectFinalDeclarations(".wizard-transition", {
      animation: "wizard-enter 180ms ease-out",
    });
  });

  it("keeps long wizard content inside a 320px viewport", () => {
    expect(css).toMatch(/\.choice-card\s*\{[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.choice-card:disabled\s*\{[^}]*opacity:[^}]*cursor:\s*not-allowed/s);
    for (const selector of [
      ".wizard-title",
      ".wizard-description",
      ".wizard-action",
      ".choice-card > *",
      ".inline-notice-title",
      ".inline-notice-body",
      ".review-row-label",
      ".review-row-value",
    ]) {
      expectEffectiveDeclarations(selector, {
        "min-width": "0",
        "max-width": "100%",
        "overflow-wrap": "anywhere",
      });
    }
  });
});
