// @vitest-environment node

import { readFile } from "node:fs/promises";
import * as ts from "typescript";
import { expect, it } from "vitest";
import { makeValidatedMenu } from "../testing/factories.js";
import { emergencyMenusDataSchema } from "./contracts.js";

const forbiddenServerModulePattern =
  /filter-emergency-menus|validate-generated-menu|fingerprint|node:|netlify|supabase/u;

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
  expect(
    emergencyMenusDataSchema.parse({
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
    }).candidates,
  ).toHaveLength(1);
});

it("サーバー専用モジュールへ依存しない", async () => {
  const source = await readFile(new URL("./contracts.ts", import.meta.url), "utf8");
  for (const specifier of moduleSpecifiersFromSource(source)) {
    expect(specifier).not.toMatch(forbiddenServerModulePattern);
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
