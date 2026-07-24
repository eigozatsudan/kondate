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

type CssKeyframes = {
  name: string;
  steps: readonly CssRule[];
  atRules: readonly CssAtRule[];
};

function cssKeyframesRules(source: string): CssKeyframes[] {
  const style = document.createElement("style");
  style.textContent = source.replace(/@import\s+[^;]+;/g, "");
  document.head.append(style);
  const sheet = style.sheet;
  if (sheet === null) throw new Error("stylesheet could not be parsed");
  const result: CssKeyframes[] = [];

  function collect(rules: CSSRuleList, atRules: readonly CssAtRule[]): void {
    for (const rule of Array.from(rules)) {
      if (rule.cssText.trim().startsWith("@keyframes") && "cssRules" in rule) {
        const keyframesRule = rule as CSSKeyframesRule;
        const steps = Array.from(keyframesRule.cssRules).map((rule, sourceOrder) => {
          const step = rule as CSSKeyframeRule;
          const declarations: CssDeclarations = new Map();
          for (let index = 0; index < step.style.length; index += 1) {
            const property = step.style.item(index);
            declarations.set(property, step.style.getPropertyValue(property).trim());
          }
          return {
            selector: step.keyText.replace(/\s+/g, " ").trim(),
            declarations,
            atRules: [],
            sourceOrder,
          };
        });
        result.push({ name: keyframesRule.name, steps, atRules });
      } else if (!("selectorText" in rule) && "cssRules" in rule) {
        const type = /^@([\w-]+)/u.exec(rule.cssText.trim())?.[1]?.toLowerCase() ?? "unknown";
        const condition =
          "conditionText" in rule ? String(rule.conditionText).replace(/\s+/g, " ").trim() : "";
        collect((rule as CSSGroupingRule).cssRules, [...atRules, { type, condition }]);
      }
    }
  }

  collect(sheet.cssRules, []);
  style.remove();
  return result;
}

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
  ".field input": [".field input, .field select, .field textarea"],
  ".field select": [".field input, .field select, .field textarea"],
  ".field textarea": [".field input, .field select, .field textarea", ".field textarea"],
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
  // 主操作ボタン色は全タブで共有するため :root の primary 系 token を許可する
  ":root",
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
  ".guided-planner-theme .ingredient-entry-row",
  ".guided-planner-theme .ingredient-entry-field",
  ".guided-planner-theme .wizard-option-list",
  ".guided-planner-theme .wizard-option",
  ".guided-planner-theme .wizard-option:has(input:checked)",
  ".guided-planner-theme .wizard-option:has(input:disabled)",
  ".guided-planner-theme .wizard-option input",
  ".guided-planner-theme .wizard-option-block",
  ".guided-planner-theme .wizard-option-meta, .guided-planner-theme .wizard-option-description",
  ".guided-planner-theme .wizard-option-description",
  ".guided-planner-theme .wizard-chip-row",
  ".guided-planner-theme .wizard-chip",
  '.guided-planner-theme .wizard-chip[aria-pressed="true"]',
  ".guided-planner-theme .wizard-review-list",
  ".guided-planner-theme .wizard-review-item",
  ".guided-planner-theme .wizard-review-item dt",
  ".guided-planner-theme .wizard-review-item dd",
  ".guided-planner-theme .wizard-reset-row",
  ".guided-planner-theme .wizard-disabled-reason",
  ".guided-planner-theme .wizard-details",
  ".guided-planner-theme .wizard-details-summary",
  ".guided-planner-theme .wizard-details-summary::-webkit-details-marker",
  ".guided-planner-theme .wizard-details-summary::before",
  ".guided-planner-theme .wizard-details[open] > .wizard-details-summary::before",
  ".guided-planner-theme .wizard-details-body",
  ".guided-planner-theme .wizard-details-body .field",
  ".guided-planner-theme .wizard-details-body .field input, .guided-planner-theme .wizard-details-body .field select, .guided-planner-theme .wizard-details-body .field textarea",
  ".guided-planner-theme .wizard-details-body .card",
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
  ".progress-value-rect",
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
  ".primary-button:active",
  ".secondary-button",
  ".text-button",
  ".field",
  ".field input, .field select, .field textarea",
  ".field textarea",
]);

const taskRuleDeclarations: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  ".guided-planner-theme": {
    color: "#423a32",
    background: "#f7f2e9",
    "font-family":
      '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", system-ui, sans-serif',
    "font-synthesis": "none",
    "text-rendering": "optimizeLegibility",
    "--app-background": "#f7f2e9",
    "--surface": "#fffdf8",
    "--text": "#423a32",
    "--muted": "#6b5e52",
    "--primary": "#d9a48f",
    "--primary-hover": "#cf947d",
    "--primary-active": "#cc927b",
    "--primary-ink": "#3b302b",
    "--primary-strong": "#8b4e3b",
    "--selection": "#f4e6df",
    "--notice": "#f8ece7",
    "--border": "#d8c9bc",
    "--focus": "#8b4e3b",
    "--pantry": "#416b5a",
    "--danger": "#9f342c",
    "--question-font": '"Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", serif',
  },
  ".guided-planner-theme :is(button, a, input, select, textarea):focus-visible": {
    outline: "3px solid var(--focus)",
    "outline-offset": "2px",
  },
  ".guided-planner-theme .wizard-title:focus-visible": {
    outline: "3px solid var(--focus)",
    "outline-offset": "2px",
  },
  ".guided-planner-theme .primary-button": {
    "border-color": "var(--primary)",
    color: "var(--primary-ink)",
    background: "var(--primary)",
  },
  ".guided-planner-theme .primary-button:hover": {
    "border-color": "var(--primary-hover)",
    color: "var(--primary-ink)",
    background: "var(--primary-hover)",
  },
  ".guided-planner-theme .primary-button:active": {
    "border-color": "var(--primary-active)",
    color: "var(--primary-ink)",
    background: "var(--primary-active)",
  },
  ".guided-planner-theme .ingredient-entry-row": {
    display: "grid",
    "min-width": "0",
    "grid-template-columns": "minmax(0, 1fr) auto",
    "align-items": "end",
    gap: "12px",
  },
  ".guided-planner-theme .ingredient-entry-field": {
    "min-width": "0",
  },
  ".guided-planner-theme .wizard-option-list": {
    display: "grid",
    "min-width": "0",
    gap: "12px",
  },
  ".guided-planner-theme .wizard-option": {
    display: "flex",
    "min-width": "0",
    "min-height": "44px",
    "align-items": "center",
    gap: "12px",
    border: "1px solid var(--border)",
    "border-radius": "18px",
    color: "var(--text)",
    background: "var(--surface)",
    padding: "16px",
    "overflow-wrap": "anywhere",
  },
  ".guided-planner-theme .wizard-option:has(input:checked)": {
    "border-color": "var(--primary-strong)",
    background: "var(--selection)",
  },
  ".guided-planner-theme .wizard-option:has(input:disabled)": {
    opacity: "0.56",
  },
  ".guided-planner-theme .wizard-option input": {
    flex: "0 0 auto",
  },
  ".guided-planner-theme .wizard-option-block": {
    display: "grid",
    "min-width": "0",
    gap: "6px",
  },
  ".guided-planner-theme .wizard-option-meta, .guided-planner-theme .wizard-option-description": {
    color: "var(--muted)",
    "overflow-wrap": "anywhere",
  },
  ".guided-planner-theme .wizard-option-description": {
    margin: "0",
    "padding-inline": "4px",
    "font-size": "0.95rem",
  },
  ".guided-planner-theme .wizard-chip-row": {
    display: "flex",
    "min-width": "0",
    "flex-wrap": "wrap",
    gap: "8px",
  },
  ".guided-planner-theme .wizard-chip": {
    "min-height": "44px",
    border: "1px solid var(--border)",
    "border-radius": "999px",
    color: "var(--text)",
    background: "var(--surface)",
    padding: "8px 14px",
    "font-weight": "700",
  },
  '.guided-planner-theme .wizard-chip[aria-pressed="true"]': {
    "border-color": "var(--primary-strong)",
    background: "var(--selection)",
  },
  ".guided-planner-theme .wizard-review-list": {
    display: "grid",
    "min-width": "0",
    margin: "0",
    gap: "0",
  },
  ".guided-planner-theme .wizard-review-item": {
    display: "grid",
    "grid-template-columns": "minmax(0, auto) minmax(0, 1fr)",
    gap: "8px 16px",
    "border-bottom": "1px solid var(--border)",
    "padding-block": "12px",
  },
  ".guided-planner-theme .wizard-review-item dt": {
    margin: "0",
    color: "var(--muted)",
    "font-weight": "700",
  },
  ".guided-planner-theme .wizard-review-item dd": {
    margin: "0",
    "min-width": "0",
    "overflow-wrap": "anywhere",
  },
  ".guided-planner-theme .wizard-reset-row": {
    display: "flex",
    "min-width": "0",
    "justify-content": "flex-end",
  },
  ".guided-planner-theme .wizard-disabled-reason": {
    margin: "0",
    color: "var(--muted)",
    "overflow-wrap": "anywhere",
  },
  ".guided-planner-theme .wizard-details": {
    "min-width": "0",
    overflow: "hidden",
    border: "1px solid var(--border)",
    "border-radius": "18px",
    background: "var(--surface)",
    "box-shadow": "0 4px 16px rgb(66 58 50 / 8%)",
  },
  ".guided-planner-theme .wizard-details-summary": {
    display: "flex",
    "min-width": "0",
    "min-height": "44px",
    cursor: "pointer",
    "align-items": "center",
    gap: "8px",
    padding: "12px 16px",
    color: "var(--text)",
    "font-weight": "700",
    "list-style": "none",
    "overflow-wrap": "anywhere",
  },
  ".guided-planner-theme .wizard-details-summary::-webkit-details-marker": {
    display: "none",
  },
  ".guided-planner-theme .wizard-details-summary::before": {
    content: '"▸"',
    flex: "0 0 auto",
    color: "var(--primary-strong)",
  },
  ".guided-planner-theme .wizard-details[open] > .wizard-details-summary::before": {
    content: '"▾"',
  },
  ".guided-planner-theme .wizard-details-body": {
    "min-width": "0",
    "border-top": "1px solid var(--border)",
    padding: "16px",
  },
  ".guided-planner-theme .wizard-details-body .field": {
    "min-width": "0",
  },
  ".guided-planner-theme .wizard-details-body .field input, .guided-planner-theme .wizard-details-body .field select, .guided-planner-theme .wizard-details-body .field textarea":
    {
      width: "100%",
      "max-width": "100%",
      "min-width": "0",
      "box-sizing": "border-box",
    },
  ".guided-planner-theme .wizard-details-body .card": {
    "min-width": "0",
  },
  ".wizard-frame": { display: "grid", gap: "20px", "min-width": "0" },
  ".wizard-header, .wizard-content, .wizard-actions": { "min-width": "0" },
  ".wizard-title": {
    margin: "0",
    color: "var(--text)",
    "font-family": "var(--question-font)",
    "line-height": "1.4",
    "overflow-wrap": "anywhere",
  },
  ".wizard-title, .wizard-description, .wizard-action, .choice-card > *, .inline-notice-title, .inline-notice-body, .review-row-label, .review-row-value":
    {
      "min-width": "0",
      "max-width": "100%",
      "overflow-wrap": "anywhere",
    },
  ".wizard-description, .choice-card-description, .inline-notice-body": {
    color: "var(--muted)",
  },
  ".wizard-actions": {
    display: "flex",
    "flex-wrap": "wrap",
    "justify-content": "space-between",
    gap: "12px",
  },
  ".wizard-action": { "min-height": "44px" },
  ".choice-card": {
    display: "grid",
    width: "100%",
    "min-width": "0",
    "min-height": "44px",
    gap: "4px",
    border: "1px solid var(--border)",
    "border-radius": "18px",
    color: "var(--text)",
    background: "var(--surface)",
    padding: "16px",
    "text-align": "left",
    "box-shadow": "0 4px 16px rgb(66 58 50 / 8%)",
    cursor: "pointer",
  },
  ".choice-card:disabled": { opacity: "0.56", cursor: "not-allowed" },
  '.choice-card[aria-pressed="true"]': {
    "border-color": "var(--primary-strong)",
    color: "var(--text)",
    background: "var(--selection)",
  },
  '.choice-card[aria-pressed="true"] > strong': { color: "var(--text)" },
  '.choice-card[aria-pressed="true"] .choice-card-description': { color: "var(--muted)" },
  ".choice-card-selection": { color: "var(--primary-strong)", "font-weight": "700" },
  ".progress-indicator": { display: "grid", gap: "8px", color: "var(--muted)" },
  ".progress-track": {
    height: "6px",
    overflow: "hidden",
    "border-radius": "999px",
    background: "var(--border)",
  },
  ".progress-value": {
    display: "block",
    width: "100%",
    height: "100%",
    "border-radius": "inherit",
  },
  ".progress-value-rect": {
    fill: "var(--primary-strong)",
  },
  ".inline-notice": {
    border: "1px solid var(--border)",
    "border-radius": "18px",
    background: "var(--notice)",
    padding: "16px",
  },
  ".inline-notice-error": { color: "var(--danger)" },
  ".inline-notice-error .inline-notice-title, .inline-notice-error .inline-notice-body": {
    color: "var(--danger)",
  },
  ".inline-notice-title, .inline-notice-body": { margin: "0" },
  ".inline-notice-title": { color: "var(--text)" },
  ".review-row": {
    display: "grid",
    "grid-template-columns": "minmax(0, 1fr) auto",
    gap: "12px",
    "align-items": "center",
    "border-bottom": "1px solid var(--border)",
    "padding-block": "12px",
  },
  ".review-row-label, .review-row-value": { margin: "0", "overflow-wrap": "anywhere" },
  ".wizard-transition": { animation: "wizard-enter 180ms ease-out" },
};

const globalRuleDeclarations: Readonly<
  Record<string, readonly Readonly<Record<string, string>>[]>
> = {
  "*": [{ "box-sizing": "border-box" }],
  ":root": [
    {
      color: "#1e293b",
      background: "#f8fafc",
      "font-family":
        '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", system-ui, sans-serif',
      "font-synthesis": "none",
      "text-rendering": "optimizeLegibility",
      "--surface": "#ffffff",
      "--text": "#1e293b",
      "--muted": "#475569",
      "--primary": "#d9a48f",
      "--primary-hover": "#cf947d",
      "--primary-active": "#cc927b",
      "--primary-ink": "#3b302b",
      "--primary-strong": "#8b4e3b",
      "--pantry": "#0f766e",
      "--danger": "#dc2626",
      "--border": "#e2e8f0",
    },
    { "--section-tint": "#f8fafc" },
  ],
  "html, body, #root": [{ "min-width": "320px", "min-height": "100%", margin: "0" }],
  body: [{ "min-height": "100vh", "font-size": "16px", "line-height": "1.6" }],
  "button, a, input, select, textarea": [{ font: "inherit" }],
  "button, .button-link": [{ "min-width": "44px", "min-height": "44px" }],
  "button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible":
    [{ outline: "3px solid #3f6f88", "outline-offset": "2px" }],
  ".primary-button, .secondary-button, .text-button": [
    {
      display: "inline-flex",
      "align-items": "center",
      "justify-content": "center",
      "border-radius": "12px",
      padding: "10px 16px",
      "font-weight": "700",
      "text-decoration": "none",
      cursor: "pointer",
    },
  ],
  ".primary-button": [
    {
      border: "1px solid var(--primary)",
      color: "var(--primary-ink)",
      background: "var(--primary)",
    },
  ],
  ".primary-button:hover": [
    {
      "border-color": "var(--primary-hover)",
      color: "var(--primary-ink)",
      background: "var(--primary-hover)",
    },
  ],
  ".primary-button:active": [
    {
      "border-color": "var(--primary-active)",
      color: "var(--primary-ink)",
      background: "var(--primary-active)",
    },
  ],
  ".secondary-button": [
    {
      border: "1px solid var(--primary)",
      color: "var(--primary-strong)",
      background: "transparent",
    },
  ],
  ".text-button": [
    {
      border: "0",
      color: "var(--primary-strong)",
      background: "transparent",
      "text-decoration": "underline",
    },
  ],
  ".field": [{ display: "grid", gap: "6px" }],
  ".field input, .field select, .field textarea": [
    {
      width: "100%",
      "min-height": "48px",
      border: "1px solid var(--border)",
      "border-radius": "10px",
      background: "#fff",
      padding: "10px 12px",
    },
  ],
  ".field textarea": [{ "min-height": "96px", resize: "vertical" }],
  ".app-section": [{ "min-height": "100vh", background: "var(--section-tint)" }],
};

function hasExactDeclarations(
  declarations: CssDeclarations,
  expected: Readonly<Record<string, string>>,
): boolean {
  const element = document.createElement("div");
  for (const [property, value] of Object.entries(expected)) {
    element.style.setProperty(property, value);
  }
  const canonicalExpected: CssDeclarations = new Map();
  for (let index = 0; index < element.style.length; index += 1) {
    const property = element.style.item(index);
    canonicalExpected.set(property, element.style.getPropertyValue(property).trim());
  }
  return (
    declarations.size === canonicalExpected.size &&
    Array.from(canonicalExpected).every(([property, value]) => declarations.get(property) === value)
  );
}

function hasRequiredDeclarations(
  declarations: CssDeclarations,
  expected: Readonly<Record<string, string>>,
): boolean {
  const element = document.createElement("div");
  for (const [property, value] of Object.entries(expected)) {
    element.style.setProperty(property, value);
  }
  for (let index = 0; index < element.style.length; index += 1) {
    const property = element.style.item(index);
    if (declarations.get(property) !== element.style.getPropertyValue(property).trim())
      return false;
  }
  return true;
}

function touchesProtectedContract(selector: string): boolean {
  if (protectedSelectorFragments.some((fragment) => selector.includes(fragment))) return true;
  return /(?:^|[\s>+~,(])(?:body|button|a|input|select|textarea)(?=$|[\s>+~,.#:[\]()])/u.test(
    selector,
  );
}

function unexpectedProtectedSelectors(source: string, requireEveryTaskRule = false): string[] {
  const rules = cssRules(source);
  const unexpected = rules
    .filter((rule) => {
      if (!touchesProtectedContract(rule.selector)) return false;
      if (!allowedProtectedSelectors.has(rule.selector)) return true;
      const taskDeclarations = taskRuleDeclarations[rule.selector];
      if (taskDeclarations !== undefined) {
        const reducedMotionException =
          rule.selector === ".wizard-transition" &&
          rule.atRules.length === 1 &&
          rule.atRules[0]?.type === "media" &&
          rule.atRules[0].condition === "(prefers-reduced-motion: reduce)" &&
          hasExactDeclarations(rule.declarations, { animation: "none" });
        const topLevelContract =
          rule.atRules.length === 0 && hasExactDeclarations(rule.declarations, taskDeclarations);
        return !reducedMotionException && !topLevelContract;
      }
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
  for (const selector of Object.keys(taskRuleDeclarations)) {
    const topLevelCount = rules.filter(
      (rule) => rule.selector === selector && rule.atRules.length === 0,
    ).length;
    if (topLevelCount > 1 || (requireEveryTaskRule && topLevelCount !== 1)) {
      unexpected.push(selector);
    }
  }
  for (const [selector, expectedBlocks] of requireEveryTaskRule
    ? Object.entries(globalRuleDeclarations)
    : []) {
    const expectedDeclarations: Record<string, string> = {};
    for (const expectedBlock of expectedBlocks) {
      Object.assign(expectedDeclarations, expectedBlock);
    }
    const actualDeclarations = declarationsForSelector(source, selector);
    if (!hasRequiredDeclarations(actualDeclarations, expectedDeclarations)) {
      unexpected.push(selector);
    }
  }
  return Array.from(new Set(unexpected));
}

const motionProperties = /^(?:animation|transition)(?:-|$)/u;

function unexpectedMotionRules(source: string): string[] {
  const rules = cssRules(source);
  const unexpected = rules
    .filter((rule) =>
      Array.from(rule.declarations.keys()).some((property) => motionProperties.test(property)),
    )
    .filter(
      (rule) =>
        rule.selector.includes("wizard-transition") || selectorMatchesRepresentative(rule.selector),
    )
    .filter((rule) => {
      const isNormalAnimation =
        rule.selector === ".wizard-transition" &&
        rule.atRules.length === 0 &&
        rule.declarations.size === 1 &&
        rule.declarations.get("animation") === "wizard-enter 180ms ease-out";
      const isReducedAnimation =
        rule.selector === ".wizard-transition" &&
        rule.atRules.length === 1 &&
        rule.atRules[0]?.type === "media" &&
        rule.atRules[0].condition === "(prefers-reduced-motion: reduce)" &&
        rule.declarations.size === 1 &&
        rule.declarations.get("animation") === "none";
      return !isNormalAnimation && !isReducedAnimation;
    })
    .map((rule) => rule.selector);
  const normalRules = rules.filter(
    (rule) => rule.selector === ".wizard-transition" && rule.atRules.length === 0,
  );
  const reducedRules = rules.filter(
    (rule) =>
      rule.selector === ".wizard-transition" &&
      rule.atRules.length === 1 &&
      rule.atRules[0]?.type === "media" &&
      rule.atRules[0].condition === "(prefers-reduced-motion: reduce)",
  );
  if (normalRules.length > 1 || reducedRules.length > 1) unexpected.push(".wizard-transition");
  return Array.from(new Set(unexpected));
}

function representativeElements(): Element[] {
  const root = document.createElement("main");
  root.className = "guided-planner-theme";
  root.innerHTML = `
    <section class="wizard-frame wizard-transition">
      <header class="wizard-header"><h1 class="wizard-title" tabindex="-1">質問</h1></header>
      <div class="wizard-content">
        <p class="wizard-description">説明</p>
        <button class="choice-card" aria-pressed="true">
          <strong>候補</strong><span class="choice-card-description">補足</span>
          <span class="choice-card-selection">選択中</span>
        </button>
        <div class="progress-indicator"><div class="progress-track"><div class="progress-value"></div></div></div>
        <div class="inline-notice inline-notice-error"><strong class="inline-notice-title">注意</strong><div class="inline-notice-body">本文</div></div>
        <div class="review-row"><p class="review-row-label">項目</p><p class="review-row-value">値</p></div>
      </div>
      <footer class="wizard-actions"><button class="wizard-action primary-button">次へ</button></footer>
    </section>
  `;
  return [root, ...Array.from(root.querySelectorAll("*"))];
}

function selectorMatchesRepresentative(selector: string): boolean {
  const pseudoElement = /::([\w-]+)\s*$/u.exec(selector);
  const originSelector =
    pseudoElement === null ? selector : selector.slice(0, pseudoElement.index).trim();
  try {
    return representativeElements().some((element) => element.matches(originSelector));
  } catch {
    return false;
  }
}

function unexpectedRepresentativeOverrides(source: string): string[] {
  return cssRules(source)
    .filter((rule) => {
      const taskDeclarations = taskRuleDeclarations[rule.selector];
      if (taskDeclarations !== undefined) {
        const reducedMotionException =
          rule.selector === ".wizard-transition" &&
          rule.atRules.length === 1 &&
          rule.atRules[0]?.type === "media" &&
          rule.atRules[0].condition === "(prefers-reduced-motion: reduce)" &&
          hasExactDeclarations(rule.declarations, { animation: "none" });
        if (reducedMotionException) return false;
        return (
          rule.atRules.length !== 0 || !hasExactDeclarations(rule.declarations, taskDeclarations)
        );
      }
      const globalDeclarations = globalRuleDeclarations[rule.selector];
      if (globalDeclarations !== undefined) {
        if (rule.declarations.has("all")) return true;
        const protectedProperties = new Set(
          globalDeclarations.flatMap((expected) => Object.keys(expected)),
        );
        const touchesProtectedProperty = Array.from(rule.declarations.keys()).some((property) =>
          protectedProperties.has(property),
        );
        return (
          touchesProtectedProperty &&
          !globalDeclarations.some((expected) =>
            hasRequiredDeclarations(rule.declarations, expected),
          )
        );
      }

      const pseudoElement = /::([\w-]+)\s*$/u.exec(rule.selector);
      if (pseudoElement !== null && pseudoElement[1] !== "before" && pseudoElement[1] !== "after") {
        return true;
      }
      const originSelector =
        pseudoElement === null ? rule.selector : rule.selector.slice(0, pseudoElement.index).trim();
      try {
        return representativeElements().some((element) => element.matches(originSelector));
      } catch {
        return true;
      }
    })
    .map((rule) => rule.selector)
    .filter((selector, index, selectors) => selectors.indexOf(selector) === index);
}

function unexpectedKeyframesRules(source: string): string[] {
  const keyframes = cssKeyframesRules(source);
  const expectedSteps = [
    { selector: "from", declarations: { opacity: "0", transform: "translateY(4px)" } },
    { selector: "to", declarations: { opacity: "1", transform: "translateY(0)" } },
  ] as const;
  const unexpected = keyframes
    .filter((keyframesRule) => {
      if (keyframesRule.name !== "wizard-enter") return false;
      if (keyframesRule.atRules.length !== 0) return true;
      if (keyframesRule.steps.length !== expectedSteps.length) return true;
      return keyframesRule.steps.some((step, index) => {
        const expected = expectedSteps[index];
        return (
          expected === undefined ||
          step.selector !== expected.selector ||
          !hasExactDeclarations(step.declarations, expected.declarations)
        );
      });
    })
    .map((rule) => rule.name);
  if (keyframes.filter((rule) => rule.name === "wizard-enter").length !== 1) {
    unexpected.push("wizard-enter");
  }
  return Array.from(new Set(unexpected));
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
    // 全タブの主操作を献立タブと同じソフトクレイへ揃える
    expect(token("primary").toLowerCase()).toBe("#d9a48f");
    expect(token("primary-ink").toLowerCase()).toBe("#3b302b");
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

  it("keeps the ingredient entry visible inside the guided planner", () => {
    expectExactRuleDeclarations(".guided-planner-theme .ingredient-entry-row", {
      display: "grid",
      "min-width": "0",
      "grid-template-columns": "minmax(0, 1fr) auto",
      "align-items": "end",
      gap: "12px",
    });
    expectExactRuleDeclarations(".guided-planner-theme .ingredient-entry-field", {
      "min-width": "0",
    });
    expectEffectiveDeclarations(".field input", {
      width: "100%",
      "min-height": "48px",
      border: "1px solid var(--border)",
      background: "#fff",
      padding: "10px 12px",
    });
    expectEffectiveDeclarations(".secondary-button", {
      border: "1px solid var(--primary)",
      background: "transparent",
    });
  });

  it("keeps non-ingredient wizard steps laid out inside the guided planner", () => {
    // padding 等は CSSOM が longhand へ展開するため、鍵となる layout 契約だけを固定する
    expectFinalDeclarations(".guided-planner-theme .wizard-option-list", {
      display: "grid",
      "min-width": "0",
      gap: "12px",
    });
    expectFinalDeclarations(".guided-planner-theme .wizard-option", {
      display: "flex",
      "min-height": "44px",
      "border-radius": "18px",
      background: "var(--surface)",
    });
    expectFinalDeclarations(".guided-planner-theme .wizard-chip-row", {
      display: "flex",
      "flex-wrap": "wrap",
      gap: "8px",
    });
    expectFinalDeclarations(".guided-planner-theme .wizard-review-list", {
      display: "grid",
      margin: "0",
    });
    expectFinalDeclarations(".wizard-actions", {
      display: "flex",
      "flex-wrap": "wrap",
    });
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
      "--primary": "#d9a48f",
      "--primary-hover": "#cf947d",
      "--primary-active": "#cc927b",
      "--primary-ink": "#3b302b",
      "--primary-strong": "#8b4e3b",
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
      "border-color": "var(--primary-hover)",
      color: "var(--primary-ink)",
      background: "var(--primary-hover)",
    });
    expectEffectiveDeclarations(".primary-button:active", {
      "border-color": "var(--primary-active)",
      color: "var(--primary-ink)",
      background: "var(--primary-active)",
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
    for (const selector of [".field input", ".field select", ".field textarea"]) {
      expectEffectiveDeclarations(selector, {
        width: "100%",
        "min-height": selector === ".field textarea" ? "96px" : "48px",
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
    expect(unexpectedProtectedSelectors(cssWithoutImports, true)).toEqual([]);
  });

  it("detects adversarial global leaks without splitting functional selector lists", () => {
    const guidedPalette = new Set<string>(Object.values(expectedTokens));
    const fixture = `
      .guided-planner-theme .probe, body { color: #f7f2e9; }
      body { background: #f7f2e9; }
      .shell .primary-button { background: #cc927b; }
      .field input { color: #3b302b !important; }
    `;
    // :root の primary 系共有は許可。背景・本文色の body 流出は検出する。
    expect(findUnscopedDesignColorLeaks(fixture, guidedPalette)).toEqual([
      ".guided-planner-theme .probe, body",
      "body",
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

  it("rejects motion longhands and selector aliases that can re-enable motion", () => {
    const fixture = `
      .wizard-transition {
        animation: wizard-enter 180ms ease-out;
        animation-name: wizard-enter;
        transition-property: transform;
        transition-duration: 180ms;
      }
      @media (prefers-reduced-motion: reduce) {
        .wizard-transition { animation: none; }
        [class~="wizard-transition"] { animation-duration: 180ms; }
      }
    `;

    expect(unexpectedMotionRules(fixture)).toEqual([
      ".wizard-transition",
      '[class~="wizard-transition"]',
    ]);
    expect(unexpectedRepresentativeOverrides(fixture)).toEqual([
      ".wizard-transition",
      '[class~="wizard-transition"]',
    ]);
  });

  it("rejects extra longhands on task-owned selectors", () => {
    const fixture = `
      .choice-card { background: var(--surface); }
      .choice-card { background-color: transparent; }
      .wizard-transition { animation: wizard-enter 180ms ease-out; }
      .wizard-transition { transition: transform 180ms ease-out; }
    `;

    expect(unexpectedProtectedSelectors(fixture)).toEqual([".choice-card", ".wizard-transition"]);
    expect(unexpectedMotionRules(fixture)).toEqual([".wizard-transition"]);
  });

  it("allows unrelated motion, resets, keyframes, and global declaration additions", () => {
    const fixture = `${cssWithoutImports}
      :root { --unrelated: 1; }
      .unrelated { all: unset; transition: opacity 180ms; }
      @keyframes unrelated { from { opacity: 0; } to { opacity: 1; } }
    `;

    expect(unexpectedProtectedSelectors(fixture, true)).toEqual([]);
    expect(unexpectedMotionRules(fixture)).toEqual([]);
    expect(unexpectedRepresentativeOverrides(fixture)).toEqual([]);
    expect(unexpectedKeyframesRules(fixture)).toEqual([]);
  });

  it("rejects unknown representative selectors, resets, and pseudo-element content", () => {
    const fixture = `
      [aria-pressed="true"] {
        all: unset;
        background-image: linear-gradient(#000, #000);
        border-top-style: none;
        outline-style: none;
      }
      [aria-pressed="true"]::after { content: "未選択"; }
      .primary-button { all: unset; }
    `;

    expect(unexpectedRepresentativeOverrides(fixture)).toEqual([
      '[aria-pressed="true"]',
      '[aria-pressed="true"]::after',
      ".primary-button",
    ]);
  });

  it("fixes wizard-enter as one exact top-level keyframes rule", () => {
    const duplicate = `${cssWithoutImports}
      @keyframes wizard-enter { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    `;
    const nested = `
      @media (min-width: 1px) {
        @keyframes wizard-enter { from { opacity: 0; } to { opacity: 1; } }
      }
    `;
    const extra = `
      @keyframes wizard-enter { from { opacity: 0; transform: translateY(4px); color: red; } 50% { opacity: .5; } to { opacity: 1; transform: translateY(0); } }
    `;
    const unknown = `
      @keyframes other { from { opacity: 0; } to { opacity: 1; } }
    `;

    expect(unexpectedKeyframesRules(cssWithoutImports)).toEqual([]);
    expect(unexpectedKeyframesRules(duplicate)).toEqual(["wizard-enter"]);
    expect(unexpectedKeyframesRules(nested)).toEqual(["wizard-enter"]);
    expect(unexpectedKeyframesRules(extra)).toEqual(["wizard-enter"]);
    expect(unexpectedKeyframesRules(unknown)).toEqual(["wizard-enter"]);
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
    // 塗り色は SVG rect の fill（style-src 'self' 下で width を inline にしない）
    expectFinalDeclarations(".progress-value-rect", { fill: "var(--primary-strong)" });
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
    expect(unexpectedMotionRules(cssWithoutImports)).toEqual([]);
    expect(unexpectedKeyframesRules(cssWithoutImports)).toEqual([]);
    expect(unexpectedRepresentativeOverrides(cssWithoutImports)).toEqual([]);
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
