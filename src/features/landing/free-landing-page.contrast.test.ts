import { describe, expect, it } from "vitest";

/** WCAG 2.x の相対輝度。styles.contrast.test.ts:1131 と同じ式を LP 用に持つ。 */
function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => {
    const raw = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return raw <= 0.04045 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = channels as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** src/styles.css の :root と同じ値。ここが動いたら LP 側も追随が要る。 */
const TEXT = "#26211e";
const MUTED = "#57504b";
const PRIMARY = "#b85033";
const PRIMARY_STRONG = "#a13d24";
const WHITE = "#ffffff";
const SUNKEN = "#f2efec";
const CANVAS = "#faf9f8";

describe("free landing contrast", () => {
  it("keeps body text readable on both page grounds", () => {
    expect(contrast(TEXT, WHITE)).toBeGreaterThanOrEqual(4.5); // 実測 15.92
    expect(contrast(MUTED, WHITE)).toBeGreaterThanOrEqual(4.5); // 実測 7.91
    expect(contrast(MUTED, SUNKEN)).toBeGreaterThanOrEqual(4.5); // 実測 6.91
  });

  it("uses primary-strong for the flow number so tinted grounds still pass AA", () => {
    expect(contrast(PRIMARY_STRONG, WHITE)).toBeGreaterThanOrEqual(4.5); // 実測 6.55
    expect(contrast(PRIMARY_STRONG, SUNKEN)).toBeGreaterThanOrEqual(4.5); // 実測 5.71
  });

  it("documents why --primary itself is not allowed as a text colour here", () => {
    // 白地では辛うじて通るが、地色が付いた瞬間に本文 AA を割る。
    // フロー番号に --primary を使ってはならない理由をここで固定する。
    expect(contrast(PRIMARY, WHITE)).toBeGreaterThanOrEqual(4.5); // 実測 4.96
    expect(contrast(PRIMARY, SUNKEN)).toBeLessThan(4.5); // 実測 4.33
  });

  it("holds for the canvas ground too, in case the page ground is ever painted", () => {
    // 現在ページ地を塗る規則は無い（styles.css に html/body/#root/.page-frame の
    // background 宣言が無く var(--canvas) 参照も 0 件）。将来塗られたときに
    // 黙って割れないよう先に固定する。
    expect(contrast(TEXT, CANVAS)).toBeGreaterThanOrEqual(4.5); // 実測 15.14
    expect(contrast(MUTED, CANVAS)).toBeGreaterThanOrEqual(4.5); // 実測 7.52
    expect(contrast(PRIMARY_STRONG, CANVAS)).toBeGreaterThanOrEqual(4.5); // 実測 6.22
  });
});
