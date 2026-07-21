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
