// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  aiGenerationResponseSchema,
  menuResponseFormat,
} from "../../../shared/contracts/generation.js";
import { scenarios } from "../../../tools/openrouter-mock/fixtures/scenarios.mjs";

it("keeps every required adversarial scenario fixed in source control", () => {
  // Plan 6 Task 6 追加分（senior-texture / medical / pantry omission 等）を含む exact inventory
  expect(Object.keys(scenarios).sort()).toEqual([
    "alias-in-step",
    "allergen-alias",
    "alternate-menu",
    "constraint-conflict",
    "direct-allergen",
    "dish-replacement",
    "duplicate-dish-regeneration",
    "duplicate-menu",
    "fallback-model-success",
    "idea-alternate-menu-1",
    "idea-dish-replacement-1",
    "idea-servings-1",
    "idea-servings-2",
    "idea-servings-20",
    "invalid-adaptation-branch",
    "invalid-pantry-dish-link",
    "malformed-json",
    "missing-label-confirmation",
    "missing-portion-branch",
    "must-use-pantry-omission",
    "over-time-limit",
    "processed-label-confirmation",
    "senior-texture-adaptation",
    "success",
    "unavailable-pantry-quantity",
    "unsafe-age-shape",
    "unsafe-child-shape",
    "unsupported-medical",
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
    "senior-texture-adaptation",
    "must-use-pantry-omission",
    "fallback-model-success",
  ] as const;

  it.each(schemaValidScenarioNames)("parses %s at the provider boundary", (name) => {
    expect(aiGenerationResponseSchema.safeParse(scenarios[name]).success).toBe(true);
  });

  it("unsupported-medical is a closed conflict outcome (not a success menu)", () => {
    const medical = scenarios["unsupported-medical"] as {
      outcome?: string;
      conflicts?: Array<{ code: string }>;
    };
    expect(medical.outcome).toBe("constraint_conflict");
    expect(medical.conflicts?.some((c) => c.code === "unsupported_medical_request")).toBe(true);
  });

  it("malformed-json stays a non-object fixture for provider rejection", () => {
    expect(typeof scenarios["malformed-json"]).toBe("string");
  });

  it("must-use-pantry-omission keeps unused must_use pantry usage without inventoryQuantity", () => {
    const body = scenarios["must-use-pantry-omission"] as {
      menu?: { pantryUsage?: Array<{ priority: string; usageStatus: string }> };
    };
    expect(
      body.menu?.pantryUsage?.some((p) => p.priority === "must_use" && p.usageStatus === "unused"),
    ).toBe(true);
    expect(JSON.stringify(body)).not.toContain("inventoryQuantity");
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
