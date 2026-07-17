// @vitest-environment node

import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { makeValidatedMenu } from "../testing/factories.js";
import { emergencyMenusDataSchema } from "./contracts.js";

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
  expect(source).not.toMatch(/filter-emergency-menus|validate-generated-menu|fingerprint|node:/u);
});
