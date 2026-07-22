// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf8");
const cssWithoutImports = css.replace(/@import\s+[^;]+;/g, "");

type CssDeclarations = Map<string, string>;

type CssRule = {
  selectors: string[];
  body: string;
};

type CascadedDeclaration = {
  value: string;
  important: boolean;
  specificity: number;
  order: number;
};

const rulePattern = /([^{}]+)\{([^{}]*)\}/g;

function cssRules(source: string): CssRule[] {
  return Array.from(source.matchAll(rulePattern), (match) => ({
    selectors: (match[1] ?? "")
      .split(",")
      .map((selector) => selector.trim())
      .filter((selector) => selector.length > 0 && !selector.startsWith("@")),
    body: match[2] ?? "",
  }));
}

function declarations(body: string): CssDeclarations {
  const result: CssDeclarations = new Map();
  for (const declaration of body.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    result.set(declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim());
  }
  return result;
}

/** 対象selectorへ最終的に適用される宣言を全ruleから順に畳み込み、後勝ちの回帰も検出する。 */
function effectiveDeclarations(selector: string): CssDeclarations {
  const result: CssDeclarations = new Map();
  for (const rule of cssRules(cssWithoutImports)) {
    if (!rule.selectors.includes(selector)) continue;
    for (const [property, value] of declarationsForRule(rule)) result.set(property, value);
  }

  return result;
}

function declarationsForRule(rule: CssRule): CssDeclarations {
  return declarations(rule.body);
}

function specificity(selector: string): number {
  const ids = selector.match(/#[\w-]+/g)?.length ?? 0;
  const classesAndPseudos = selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g)?.length ?? 0;
  const elements = selector.match(/(?:^|[>+~\s])(?:[a-z][\w-]*|:root)\b/gi)?.length ?? 0;
  return ids * 100 + classesAndPseudos * 10 + elements;
}

function cascadedDeclarations(
  source: string,
  matchesTarget: (selector: string) => boolean,
): CssDeclarations {
  const winners = new Map<string, CascadedDeclaration>();
  let order = 0;
  for (const rule of cssRules(source)) {
    for (const selector of rule.selectors) {
      order += 1;
      if (!matchesTarget(selector)) continue;
      for (const [property, rawValue] of declarationsForRule(rule)) {
        const important = /\s*!important\s*$/i.test(rawValue);
        const value = rawValue.replace(/\s*!important\s*$/i, "").trim();
        const candidate = { value, important, specificity: specificity(selector), order };
        const winner = winners.get(property);
        if (
          winner === undefined ||
          Number(candidate.important) > Number(winner.important) ||
          (candidate.important === winner.important &&
            (candidate.specificity > winner.specificity ||
              (candidate.specificity === winner.specificity && candidate.order > winner.order)))
        ) {
          winners.set(property, candidate);
        }
      }
    }
  }
  return new Map(Array.from(winners, ([property, winner]) => [property, winner.value]));
}

function finalDeclarations(source: string, target: string): CssDeclarations {
  return cascadedDeclarations(
    source,
    (selector) =>
      selector === target || selector.endsWith(` ${target}`) || target.endsWith(` ${selector}`),
  );
}

/** scope selector自身の全blockを順番に畳み込み、後置blockの最終tokenを返す。 */
function scopedDeclarations(source: string): CssDeclarations {
  return finalDeclarations(source, ".guided-planner-theme");
}

function isGuidedBranch(selector: string): boolean {
  return /(?:^|[>+~\s])\.guided-planner-theme(?:[.#:[>+~\s]|$)/.test(selector);
}

function findUnscopedDesignColorLeaks(source: string, colors: ReadonlySet<string>): string[] {
  const leaks: string[] = [];
  for (const rule of cssRules(source)) {
    const usedColors = rule.body.toLowerCase().match(/#[0-9a-f]{6}\b/g) ?? [];
    if (!usedColors.some((color) => colors.has(color))) continue;
    for (const selector of rule.selectors) {
      if (!isGuidedBranch(selector)) leaks.push(selector);
    }
  }
  return leaks;
}

function expectEffectiveDeclarations(selector: string, expected: Record<string, string>): void {
  const declarations = effectiveDeclarations(selector);
  for (const [property, value] of Object.entries(expected)) {
    expect(declarations.get(property), `${selector} ${property}`).toBe(value);
  }
}

function expectFinalDeclarations(selector: string, expected: Record<string, string>): void {
  const declarations = finalDeclarations(cssWithoutImports, selector);
  for (const [property, value] of Object.entries(expected)) {
    expect(declarations.get(property), `${selector} ${property}`).toBe(value);
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
  });

  it("detects adversarial global leaks in every selector-list branch", () => {
    const guidedPalette = new Set<string>(Object.values(expectedTokens));
    const fixture = `
      .guided-planner-theme .probe, body { color: #f7f2e9; }
      :root { --primary-hover: #cf947d; }
      .shell .primary-button { background: #cc927b; }
      .field input { color: #3b302b !important; }
    `;
    expect(findUnscopedDesignColorLeaks(fixture, guidedPalette)).toEqual([
      "body",
      ":root",
      ".shell .primary-button",
      ".field input",
    ]);
    expect(finalDeclarations(fixture, ".primary-button").get("background")).toBe("#cc927b");
    expect(finalDeclarations(fixture, ".field input").get("color")).toBe("#3b302b");
  });

  it("resolves later, more specific, and important scoped overrides", () => {
    const fixture = `
      .guided-planner-theme { --primary: #d9a48f; }
      .guided-planner-theme { --primary: #cc927b; }
      .host .guided-planner-theme { --primary: #cf947d !important; }
      .guided-planner-theme .primary-button:hover { background: var(--primary-hover); }
      .host .guided-planner-theme .primary-button:hover { background: #3b302b; }
    `;
    expect(scopedDeclarations(fixture).get("--primary")).toBe("#cf947d");
    expect(
      finalDeclarations(fixture, ".guided-planner-theme .primary-button:hover").get("background"),
    ).toBe("#3b302b");
  });

  it("keeps final scoped component colors connected to their tokens", () => {
    expectFinalDeclarations(".guided-planner-theme .primary-button", {
      color: "var(--primary-ink)",
      background: "var(--primary)",
    });
    expectFinalDeclarations(".guided-planner-theme .primary-button:hover", {
      background: "var(--primary-hover)",
    });
    expectFinalDeclarations(".guided-planner-theme .primary-button:active", {
      background: "var(--primary-active)",
    });
    expectFinalDeclarations('.choice-card[aria-pressed="true"]', {
      "border-color": "var(--primary-strong)",
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
    expectFinalDeclarations(".guided-planner-theme .wizard-title:focus-visible", {
      outline: "3px solid var(--focus)",
      "outline-offset": "2px",
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
