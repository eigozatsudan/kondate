// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  aiGenerationResponseSchema,
  menuResponseFormat,
} from "../../../shared/contracts/generation.js";
import { scenarios } from "../../../tools/openrouter-mock/fixtures/scenarios.mjs";

it("keeps every required adversarial scenario fixed in source control", () => {
  expect(Object.keys(scenarios).sort()).toEqual([
    "alias-in-step",
    "alternate-menu",
    "constraint-conflict",
    "direct-allergen",
    "dish-replacement",
    "duplicate-menu",
    "idea-alternate-menu-1",
    "idea-dish-replacement-1",
    "idea-servings-1",
    "idea-servings-2",
    "idea-servings-20",
    "invalid-adaptation-branch",
    "invalid-pantry-dish-link",
    "malformed-json",
    "missing-label-confirmation",
    "over-time-limit",
    "success",
    "unsafe-age-shape",
  ]);
});

it("keeps provider fixtures free of persistent identifiers and trusted inventory results", () => {
  const serialized = JSON.stringify(scenarios);
  expect(serialized).not.toMatch(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu,
  );
  expect(serialized).not.toContain("inventoryQuantity");
  expect(serialized).not.toContain("shortageQuantity");
});

describe("schema-valid fixed outputs", () => {
  const schemaValidScenarioNames = [
    "success",
    "idea-servings-1",
    "idea-servings-20",
    "duplicate-menu",
    "alternate-menu",
    "constraint-conflict",
    "direct-allergen",
    "alias-in-step",
    "missing-label-confirmation",
    "unsafe-age-shape",
    "invalid-adaptation-branch",
    "invalid-pantry-dish-link",
    "over-time-limit",
  ] as const;

  it.each(schemaValidScenarioNames)("parses %s at the provider boundary", (name) => {
    expect(aiGenerationResponseSchema.safeParse(scenarios[name]).success).toBe(true);
  });
});

it("keeps the standalone mock response format equal to the checked contract", async () => {
  const artifact = JSON.parse(
    await readFile(
      new URL("../../../tools/openrouter-mock/fixtures/menu-response-format.json", import.meta.url),
      "utf8",
    ),
  ) as unknown;
  expect(artifact).toEqual(menuResponseFormat);
});
