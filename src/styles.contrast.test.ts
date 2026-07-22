// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf8");

/** :root ブロックから `--name: #rrggbb;` を読み出す。 */
function token(name: string): string {
  const value = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1];
  if (value === undefined) throw new Error(`token --${name} not found`);
  return value;
}

function scopedToken(name: string): string {
  const scope = /\.guided-planner-theme\s*\{(?<body>[\s\S]*?)\}/.exec(css)?.groups?.body;
  if (scope === undefined) throw new Error(".guided-planner-theme not found");
  const value = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(scope)?.[1];
  if (value === undefined) throw new Error(`scoped token --${name} not found`);
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
    "primary-strong": "#8b4e3b",
    selection: "#f4e6df",
    notice: "#f8ece7",
    border: "#d8c9bc",
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
  });
});
