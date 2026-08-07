/**
 * idea ベンチ固定入力（鶏もも肉・2人・朝食・空 pantry）での
 * invalid_provider_menu / invalid_menu_structure 本筋の mock 再現。
 *
 * 有料 raw は保持しない。closed code と fixture 変異だけを固定する。
 */
import { describe, expect, it } from "vitest";
import type { AiGeneratedMenuPayload } from "../../../shared/contracts/ai-generation-output.js";
import type { IdeaGenerationContext } from "../../../shared/safety/generation-context.js";
import { ideaSafetySnapshot } from "../../../shared/safety/idea-fingerprint.js";
import { scenarios } from "../../../tools/openrouter-mock/fixtures/scenarios.mjs";
import { diagnoseClosedComposeCodes } from "./paid-openrouter-benchmark-harness.js";
import type { OpenRouterGenerationResult } from "./openrouter.js";

/** paid harness と同型の idea 固定コンテキスト */
function ideaBenchContext(): IdeaGenerationContext {
  return {
    targetMode: "idea",
    submission: {
      mealType: "breakfast",
      mainIngredients: ["鶏もも肉"],
      cuisineGenre: "japanese",
      targetMode: "idea",
      targetMemberIds: [],
      servings: 2,
      timeLimitMinutes: 15,
      budgetPreference: "standard",
      ingredientPreference: null,
      avoidIngredients: [],
      memo: "",
      pantrySelections: [],
    },
    safety: null,
    pantryItems: [],
    memberPreferences: [],
    targetMembers: [],
    allergenVersion: null,
    foodRuleVersion: null,
    expiredPantryChecks: [],
    idempotencyKey: "91000000-0000-4000-8000-000000000002",
    preferenceSnapshot: {},
    safetySnapshot: ideaSafetySnapshot,
  };
}

function uuidFactory(): () => string {
  let counter = 10;
  return () => {
    counter += 1;
    return `92000000-0000-4000-8000-${counter.toString().padStart(12, "0")}`;
  };
}

function fullMenuSuccess(menu: AiGeneratedMenuPayload): OpenRouterGenerationResult {
  return {
    mode: "full_menu",
    modelId: "mock/idea-bench",
    output: { outcome: "success", menu },
  };
}

function ideaServings2Menu(): AiGeneratedMenuPayload {
  const fixture = structuredClone(scenarios["idea-servings-2"]) as {
    outcome: "success";
    menu: AiGeneratedMenuPayload;
  };
  return fixture.menu;
}

describe("idea-bench invalid_provider_menu / invalid_menu_structure mock repro", () => {
  it("accepts the mock idea-servings-2 fixture with empty diagnostic codes", () => {
    const codes = diagnoseClosedComposeCodes(
      fullMenuSuccess(ideaServings2Menu()),
      ideaBenchContext(),
      uuidFactory(),
    );
    expect(codes).toEqual([]);
  });

  it("maps breakfast with 1 dish (common model shape) to invalid_provider_menu", () => {
    // S11: mealType 下限を wire schema で閉じるため materializer 前に invalid_provider_menu
    const menu = ideaServings2Menu();
    menu.dishes = [menu.dishes[0]!];
    menu.timeline = menu.timeline.filter((entry) => entry.dishRef === "dish_1");
    const codes = diagnoseClosedComposeCodes(
      fullMenuSuccess(menu),
      ideaBenchContext(),
      uuidFactory(),
    );
    expect(codes).toContain("invalid_provider_menu");
  });

  it("accepts breakfast with 3 dishes within max (no longer exact count 2)", () => {
    // メイン食材分散のため朝/昼も最低2〜最大5を許容。3品は invalid_menu_structure にしない。
    const menu = ideaServings2Menu();
    menu.dishes = [
      ...menu.dishes,
      {
        dishRef: "dish_3",
        role: "soup",
        position: 3,
        name: "味噌汁",
        description: "朝の汁物",
        cookingTimeMinutes: 5,
        ingredients: [
          {
            ingredientRef: "ingredient_9",
            position: 1,
            name: "みそ",
            quantityValue: 1,
            quantityText: "大さじ1",
            unit: "大さじ",
            storeSection: "seasonings",
            pantryRef: null,
            labelConfirmationRequired: false,
          },
        ],
        steps: [
          {
            stepRef: "step_9",
            position: 1,
            instruction: "みそを溶く",
          },
        ],
      },
    ];
    const codes = diagnoseClosedComposeCodes(
      fullMenuSuccess(menu),
      ideaBenchContext(),
      uuidFactory(),
    );
    expect(codes).not.toContain("invalid_menu_structure");
  });

  it("maps idea adaptations with member refs to unknown_member_ref (not invalid_provider_menu)", () => {
    const menu = ideaServings2Menu();
    const withAdaptations = structuredClone(scenarios.success) as {
      outcome: "success";
      menu: AiGeneratedMenuPayload;
    };
    menu.adaptations = withAdaptations.menu.adaptations;
    const codes = diagnoseClosedComposeCodes(
      fullMenuSuccess(menu),
      ideaBenchContext(),
      uuidFactory(),
    );
    expect(codes).toContain("unknown_member_ref");
    expect(codes).not.toContain("invalid_provider_menu");
  });

  it("maps invented pantryRef on empty pantry to dangling_ref or unknown_pantry_ref", () => {
    const menu = ideaServings2Menu();
    menu.dishes[0]!.ingredients[0]!.pantryRef = "pantry_1";
    menu.pantryUsage = [
      {
        pantryRef: "pantry_1",
        priority: "prefer_use",
        usageStatus: "used",
        plannedQuantity: 200,
        unit: "g",
        dishRefs: ["dish_1"],
        unusedReason: null,
      },
    ];
    const codes = diagnoseClosedComposeCodes(
      fullMenuSuccess(menu),
      ideaBenchContext(),
      uuidFactory(),
    );
    expect(codes.some((code) => code === "unknown_pantry_ref" || code === "dangling_ref")).toBe(
      true,
    );
    expect(codes).not.toContain("invalid_provider_menu");
  });

  it("maps missing main ingredient to main_ingredient_missing after structure passes", () => {
    const menu = ideaServings2Menu();
    menu.dishes[0]!.name = "野菜炒め";
    menu.dishes[0]!.description = "野菜だけの炒め物";
    menu.dishes[0]!.ingredients[0]!.name = "キャベツ";
    const codes = diagnoseClosedComposeCodes(
      fullMenuSuccess(menu),
      ideaBenchContext(),
      uuidFactory(),
    );
    expect(codes).toContain("main_ingredient_missing");
  });
});
