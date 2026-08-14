// @vitest-environment node

import { readFile } from "node:fs/promises";
import * as ts from "typescript";
import { expect, it } from "vitest";
import { makeValidatedMenu } from "../testing/factories.js";
import { emergencyMenusDataSchema } from "./contracts.js";

// contracts.ts 自身の境界: サーバ/DB/Node 専用モジュールを import 禁止
const forbiddenServerModulePattern =
  /filter-emergency-menus|idea-context|fixtures\.v1|validate-generated-menu|fingerprint|node:|netlify|supabase/u;

// browser feature が emergency サーバ専用モジュールを import していないこと
// （@/shared/lib/supabase 等の正当なブラウザ import は対象外）
const forbiddenEmergencyServerModulePattern =
  /filter-emergency-menus|idea-context|fixtures\.v1|validate-generated-menu/u;

function moduleSpecifiersFromSource(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    "module.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = node.arguments[0];
      if (specifier !== undefined && ts.isStringLiteralLike(specifier)) {
        specifiers.push(specifier.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return specifiers;
}

it("完全な緊急献立レスポンスを検証する", () => {
  const response = {
    fixtureVersion: "2026-07-11.v1",
    candidates: [
      {
        menu: makeValidatedMenu(),
        memberLabels: {},
        allergenLabels: {},
        labelWarnings: [],
      },
    ],
    message: "AIを使わない15分緊急献立です",
    consumesAiQuota: false,
    path: "household",
    matchMode: "none",
    emptyReason: null,
  };

  expect(emergencyMenusDataSchema.parse(response)).toEqual(response);
});

it("rejects missing path/matchMode/emptyReason on strict schema", () => {
  const base = {
    fixtureVersion: "2026-07-28.v1",
    candidates: [],
    message: "条件に合う緊急献立がありません",
    consumesAiQuota: false as const,
    // intentionally omit path / matchMode / emptyReason
  };
  expect(() => emergencyMenusDataSchema.parse(base)).toThrow();
});

it("rejects idea path with current_safety_unavailable", () => {
  expect(() =>
    emergencyMenusDataSchema.parse({
      fixtureVersion: "2026-07-28.v1",
      candidates: [],
      message: "条件に合う緊急献立がありません",
      consumesAiQuota: false,
      path: "idea",
      matchMode: null,
      emptyReason: "current_safety_unavailable",
    }),
  ).toThrow();
});

it("accepts empty household with allergen_missing", () => {
  expect(
    emergencyMenusDataSchema.parse({
      fixtureVersion: "2026-07-28.v1",
      candidates: [],
      message: "アレルギー情報の登録が必要です。家族の設定を確認してください。",
      consumesAiQuota: false,
      path: "household",
      matchMode: null,
      emptyReason: "allergen_missing",
    }).emptyReason,
  ).toBe("allergen_missing");
});

it("rejects idea path with allergen_missing", () => {
  expect(() =>
    emergencyMenusDataSchema.parse({
      fixtureVersion: "2026-07-28.v1",
      candidates: [],
      message: "アレルギー情報の登録が必要です。家族の設定を確認してください。",
      consumesAiQuota: false,
      path: "idea",
      matchMode: null,
      emptyReason: "allergen_missing",
    }),
  ).toThrow();
});

it("accepts empty household with no_matching_fixture", () => {
  expect(
    emergencyMenusDataSchema.parse({
      fixtureVersion: "2026-07-28.v1",
      candidates: [],
      message: "条件に合う緊急献立がありません",
      consumesAiQuota: false,
      path: "household",
      matchMode: null,
      emptyReason: "no_matching_fixture",
    }).emptyReason,
  ).toBe("no_matching_fixture");
});

// superRefine 不変条件（欠落フィールド以外）
it("rejects non-empty candidates when emptyReason is set", () => {
  expect(() =>
    emergencyMenusDataSchema.parse({
      fixtureVersion: "2026-07-28.v1",
      candidates: [
        {
          menu: makeValidatedMenu(),
          memberLabels: {},
          allergenLabels: {},
          labelWarnings: [],
        },
      ],
      message: "AIを使わない15分緊急献立です",
      consumesAiQuota: false,
      path: "household",
      matchMode: "none",
      emptyReason: "no_matching_fixture",
    }),
  ).toThrow();
});

it("rejects empty candidates when matchMode is non-null", () => {
  expect(() =>
    emergencyMenusDataSchema.parse({
      fixtureVersion: "2026-07-28.v1",
      candidates: [],
      message: "条件に合う緊急献立がありません",
      consumesAiQuota: false,
      path: "household",
      matchMode: "none",
      emptyReason: "no_matching_fixture",
    }),
  ).toThrow();
});

it("rejects idea empty with emptyReason null", () => {
  expect(() =>
    emergencyMenusDataSchema.parse({
      fixtureVersion: "2026-07-28.v1",
      candidates: [],
      message: "条件に合う緊急献立がありません",
      consumesAiQuota: false,
      path: "idea",
      matchMode: null,
      emptyReason: null,
    }),
  ).toThrow();
});

it("サーバー専用モジュールへ依存しない", async () => {
  const source = await readFile(new URL("./contracts.ts", import.meta.url), "utf8");
  for (const specifier of moduleSpecifiersFromSource(source)) {
    expect(specifier).not.toMatch(forbiddenServerModulePattern);
  }
});

it("browser emergency feature は contracts 以外の emergency サーバ専用モジュールを import しない", async () => {
  // src/features/emergency は filter / idea-context / fixtures を import しない
  const { readdir } = await import("node:fs/promises");
  const featureDir = new URL("../../src/features/emergency/", import.meta.url);
  const entries = await readdir(featureDir);
  const sources = entries.filter(
    (name) =>
      (name.endsWith(".ts") || name.endsWith(".tsx")) &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".test.tsx"),
  );
  expect(sources.length).toBeGreaterThan(0);
  for (const name of sources) {
    const source = await readFile(new URL(name, featureDir), "utf8");
    for (const specifier of moduleSpecifiersFromSource(source)) {
      expect(specifier, `${name} imports ${specifier}`).not.toMatch(
        forbiddenEmergencyServerModulePattern,
      );
    }
  }
});

it("禁止された静的import、export-from、dynamic importを検出する", () => {
  const source = `
    import { createHash } from "node:crypto";
    export { handler } from "@netlify/functions";
    void import("@supabase/supabase-js");
  `;

  expect(moduleSpecifiersFromSource(source)).toEqual([
    "node:crypto",
    "@netlify/functions",
    "@supabase/supabase-js",
  ]);
});

it("コメント、通常文字列、類似識別子をmodule specifierとして扱わない", () => {
  const source = `
    // import "node:crypto";
    const example = "export { handler } from '@netlify/functions'";
    const supabaseCompatible = true;
    export { supabaseCompatible };
  `;

  expect(moduleSpecifiersFromSource(source)).toEqual([]);
});
