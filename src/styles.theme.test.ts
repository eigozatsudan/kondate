import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { describe, expect, it } from "vitest";

// Tailwind v4 は未定義のカラーユーティリティを「無音で」CSSごと出力しない。
// 例えば @theme に --color-terracotta-700 が無い状態で bg-terracotta-700 と
// text-white を併記すると、白背景に白文字が乗って操作不能になるが、
// typecheck・lint・単体テストのどれも失敗しない。実際にこの不具合が
// 献立結果・履歴詳細・履歴カードの主操作ボタン11箇所で発生していた。
// このテストはビルド成果物を待たずに同じ事故を検出する。

const projectRoot = process.cwd();
const css = readFileSync(resolve(projectRoot, "src/styles.css"), "utf8");

/** Tailwind v4 に標準搭載されているパレット名。@theme での定義を必要としない。 */
const builtinPalettes = new Set([
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
]);

/** 色を取るユーティリティの接頭辞。`border-2` のような非色ユーティリティは数値段階を持たない。 */
const colorUtilityPrefixes = [
  "bg",
  "text",
  "border",
  "divide",
  "ring",
  "outline",
  "decoration",
  "shadow",
  "accent",
  "caret",
  "fill",
  "stroke",
  "from",
  "via",
  "to",
];

const utilityPattern = new RegExp(
  String.raw`\b(?:${colorUtilityPrefixes.join("|")})-([a-z][a-z0-9]*)-(\d{2,3})\b`,
  "gu",
);

function collectTsxFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectTsxFiles(full));
      continue;
    }
    // テストファイル自身の期待値文字列を走査対象に含めない
    if (full.endsWith(".tsx") && !full.endsWith(".test.tsx")) files.push(full);
  }
  return files;
}

/** @theme ブロック本文を連結して返す。ブロックが無ければ空文字。 */
function themeBlockBody(source: string): string {
  const bodies: string[] = [];
  const pattern = /@theme[^{]*\{/gu;
  let match = pattern.exec(source);
  while (match !== null) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (index < source.length && depth > 0) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}") depth -= 1;
      index += 1;
    }
    bodies.push(source.slice(start, index - 1));
    pattern.lastIndex = index;
    match = pattern.exec(source);
  }
  return bodies.join("\n");
}

interface CustomColorUsage {
  readonly palette: string;
  readonly shade: string;
  readonly file: string;
}

function findCustomColorUsages(): CustomColorUsage[] {
  const usages: CustomColorUsage[] = [];
  for (const file of collectTsxFiles(resolve(projectRoot, "src"))) {
    const contents = readFileSync(file, "utf8");
    for (const match of contents.matchAll(utilityPattern)) {
      const [, palette, shade] = match;
      if (palette === undefined || shade === undefined) continue;
      if (builtinPalettes.has(palette)) continue;
      usages.push({ palette, shade, file: file.slice(projectRoot.length + 1) });
    }
  }
  return usages;
}

describe("tailwind theme colour definitions", () => {
  it("defines every non-builtin colour utility used in the browser code", () => {
    const theme = themeBlockBody(css);
    const missing = findCustomColorUsages()
      .filter((usage) => !theme.includes(`--color-${usage.palette}-${usage.shade}`))
      .map((usage) => `${usage.palette}-${usage.shade} (${usage.file})`);

    expect([...new Set(missing)].sort()).toEqual([]);
  });

  it("still finds the utilities it is meant to guard", () => {
    // 走査そのものが壊れて空振りしていないことを確認する。
    const usages = findCustomColorUsages();
    expect(usages.length).toBeGreaterThan(0);
  });
});
