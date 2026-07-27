import { describe, expect, it } from "vitest";
import { makeIdeaGenerationContext } from "../../../shared/testing/factories.js";
import {
  createBenchGenerationContext,
  createBenchPassingEnvelope,
  createBenchPassingMenuPayload,
  evaluateAppResponseGate,
} from "./benchmark-app-response-gate.js";

describe("evaluateAppResponseGate", () => {
  it("accepts a production-shaped success envelope that materializes and validates", () => {
    const modelId = "vendor/paid-a";
    const result = evaluateAppResponseGate(createBenchPassingEnvelope(modelId), modelId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detail).toBe("ok");
      expect(result.decoded.outcome).toBe("success");
    }
  });

  it("rejects missing envelope.model", () => {
    const envelope = createBenchPassingEnvelope("vendor/a") as {
      model?: string;
      choices: unknown;
    };
    delete envelope.model;
    const result = evaluateAppResponseGate(envelope, "vendor/a");
    expect(result.ok).toBe(false);
    expect(result.detail).toBe("envelope_model_missing");
  });

  it("rejects model mismatch against the requested modelId", () => {
    const result = evaluateAppResponseGate(
      createBenchPassingEnvelope("vendor/other"),
      "vendor/requested",
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toBe("envelope_model_mismatch");
  });

  it("rejects minimum-key shape that is not a full AI menu payload", () => {
    const envelope = {
      model: "vendor/a",
      choices: [
        {
          message: {
            content: JSON.stringify({
              outcome: "success",
              menu: {
                dishes: [
                  {
                    dishRef: "dish_1",
                    role: "main",
                    position: 1,
                    name: "ご飯",
                    description: "白飯",
                    cookingTimeMinutes: 5,
                    ingredients: [{ name: "米" }],
                    steps: [{ instruction: "炊く" }],
                  },
                ],
              },
            }),
          },
        },
      ],
    };
    const result = evaluateAppResponseGate(envelope, "vendor/a");
    expect(result.ok).toBe(false);
    expect(result.detail).toBe("ai_generation_schema_fail");
  });

  it("rejects constraint_conflict outcomes", () => {
    const envelope = {
      model: "vendor/a",
      choices: [
        {
          message: {
            content: JSON.stringify({
              outcome: "constraint_conflict",
              conflicts: [
                {
                  code: "must_use_conflict",
                  message: "必須食材と安全条件を同時に満たせません。",
                  conditionRefs: ["pantry_1"],
                },
              ],
            }),
          },
        },
      ],
    };
    const result = evaluateAppResponseGate(envelope, "vendor/a");
    expect(result.ok).toBe(false);
    expect(result.detail).toBe("outcome_not_success");
  });

  it("rejects when materialize/validate would fail on dangling pantry", () => {
    const menu = createBenchPassingMenuPayload();
    menu.pantryUsage = [];
    const envelope = {
      model: "vendor/a",
      choices: [
        {
          message: {
            content: JSON.stringify({ outcome: "success", menu }),
          },
        },
      ],
    };
    const result = evaluateAppResponseGate(envelope, "vendor/a", createBenchGenerationContext());
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/^materialize_fail/u);
  });

  it("rejects when validateGeneratedMenu alone fails after materialize", () => {
    // materialize は通し、idea の凍結人数だけを不一致にして validator の証跡を検査する。
    const menu = createBenchPassingMenuPayload();
    menu.servings = 3;
    menu.adaptations = [];
    menu.pantryUsage = [];
    menu.dishes[0]!.ingredients[0]!.pantryRef = null;
    const envelope = {
      model: "vendor/a",
      choices: [
        {
          message: {
            content: JSON.stringify({ outcome: "success", menu }),
          },
        },
      ],
    };
    const result = evaluateAppResponseGate(envelope, "vendor/a", makeIdeaGenerationContext());
    expect(result).toEqual({
      ok: false,
      detail: "validate_generated_menu_fail",
      validationCodes: ["servings_mismatch"],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("人数が指定と一致しません");
    expect(serialized).not.toContain('"path":');
    expect(serialized).not.toContain('"message":');
  });
});
