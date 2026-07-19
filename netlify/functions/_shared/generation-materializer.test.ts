import { describe, expect, it } from "vitest";
import type { AiGeneratedMenuPayload } from "../../../shared/contracts/ai-generation-output.js";
import { generatedMenuSchema } from "../../../shared/contracts/generation.js";
import { validateGeneratedMenu } from "../../../shared/safety/validate-generated-menu.js";
import { makeGenerationContext } from "../../../shared/testing/factories.js";
import { materializeAiGeneratedMenu } from "./generation-materializer.js";
import { GenerationOutputError } from "./generation-repair.js";

const pantryItemId = "61000000-0000-4000-8000-000000000001";

function makeContext(quantity: number | null = 100) {
  const base = makeGenerationContext();
  return {
    ...base,
    submission: {
      ...base.submission,
      pantrySelections: [{ pantryItemId, priority: "must_use" as const }],
    },
    pantryItems: [
      {
        id: pantryItemId,
        userId: "62000000-0000-4000-8000-000000000001",
        name: "ごはん",
        quantity,
        unit: quantity === null ? null : "g",
        expiresOn: null,
        expirationType: null,
        openedState: null,
        createdAt: "2026-07-11T00:00:00.000Z",
        updatedAt: "2026-07-11T00:00:00.000Z",
      },
    ],
  };
}

function makePayload(): AiGeneratedMenuPayload {
  return {
    schemaVersion: "2026-07-11.v1",
    mealType: "breakfast",
    cuisineGenre: "japanese",
    servings: 2,
    totalElapsedMinutes: 15,
    safetyTags: [],
    dishes: [
      {
        dishRef: "dish_1",
        role: "main",
        position: 1,
        name: "塩おにぎり",
        description: "朝の主食",
        cookingTimeMinutes: 10,
        ingredients: [
          {
            ingredientRef: "ingredient_1",
            position: 1,
            name: "ごはん",
            quantityValue: 300,
            quantityText: "300g",
            unit: "g",
            storeSection: "dry_goods",
            pantryRef: "pantry_1",
            labelConfirmationRequired: false,
          },
        ],
        steps: [{ stepRef: "step_1", position: 1, instruction: "ごはんを握る" }],
      },
      {
        dishRef: "dish_2",
        role: "side",
        position: 2,
        name: "温野菜",
        description: "加熱した野菜",
        cookingTimeMinutes: 5,
        ingredients: [
          {
            ingredientRef: "ingredient_2",
            position: 1,
            name: "にんじん",
            quantityValue: 0.5,
            quantityText: "1/2本",
            unit: "本",
            storeSection: "produce",
            pantryRef: null,
            labelConfirmationRequired: false,
          },
        ],
        steps: [{ stepRef: "step_2", position: 1, instruction: "やわらかく加熱する" }],
      },
    ],
    timeline: [
      {
        timelineRef: "timeline_1",
        position: 1,
        startMinute: 0,
        durationMinutes: 10,
        instruction: "おにぎりを作る",
        dishRef: "dish_1",
        stepRef: "step_1",
      },
    ],
    adaptations: [
      {
        adaptationRef: "adaptation_1",
        dishRef: "dish_1",
        anonymousMemberRef: "member_1",
        portionText: "通常量",
        beforeStepRef: "step_1",
        additionalCutting: null,
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: "通常の取り分けを確認する",
        safetyTags: [],
        safetyActions: [],
      },
    ],
    pantryUsage: [
      {
        pantryRef: "pantry_1",
        priority: "must_use",
        usageStatus: "used",
        plannedQuantity: 300,
        unit: " g ",
        dishRefs: ["dish_1"],
        unusedReason: null,
      },
    ],
    labelConfirmations: [],
  };
}

function uuidFactory() {
  let value = 1;
  return () => `70000000-0000-4000-8000-${String(value++).padStart(12, "0")}`;
}

function expectOutputError(run: () => unknown, code: string) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(GenerationOutputError);
    if (error instanceof GenerationOutputError) {
      expect(error.issues.map((issue) => issue.code)).toContain(code);
    }
    return;
  }
  throw new Error("expected GenerationOutputError");
}

describe("materializeAiGeneratedMenu", () => {
  it("allocates fresh IDs, resolves refs, and computes trusted shortage", () => {
    const context = makeContext();
    const menu = materializeAiGeneratedMenu(makePayload(), context, uuidFactory());
    expect(generatedMenuSchema.safeParse(menu).success).toBe(true);
    expect(menu.pantryUsage[0]).toMatchObject({
      pantryItemId,
      pantryItemName: "ごはん",
      inventoryQuantity: 100,
      plannedQuantity: 300,
      shortageQuantity: 200,
      unit: "g",
      dishIds: [menu.dishes[0]?.id],
    });
    expect(menu.dishes[0]?.ingredients[0]?.pantrySelectionId).toBe(
      menu.pantryUsage[0]?.selectionId,
    );
    expect(menu.timeline[0]).toMatchObject({
      dishId: menu.dishes[0]?.id,
      recipeStepId: menu.dishes[0]?.steps[0]?.id,
    });
    expect(validateGeneratedMenu(menu, context).ok).toBe(true);
  });

  it("rejects duplicate and dangling refs", () => {
    const duplicate = makePayload();
    duplicate.dishes[1]!.dishRef = "dish_1";
    expectOutputError(
      () => materializeAiGeneratedMenu(duplicate, makeContext(), uuidFactory()),
      "duplicate_ref",
    );
    const dangling = makePayload();
    dangling.timeline[0]!.dishRef = "dish_9";
    expectOutputError(
      () => materializeAiGeneratedMenu(dangling, makeContext(), uuidFactory()),
      "dangling_ref",
    );
  });

  it("owns polymorphic label wrong-kind validation", () => {
    const payload = makePayload();
    payload.labelConfirmations = [
      {
        sourceType: "dish",
        sourceRef: "ingredient_1",
        sourcePath: "dishes.0.ingredients.0.name",
        allergenId: "wheat",
        anonymousMemberRef: "member_1",
        dictionaryVersion: "jp-caa-2026-04.v1",
        confirmationStatus: "pending",
      },
    ];
    expectOutputError(
      () => materializeAiGeneratedMenu(payload, makeContext(), uuidFactory()),
      "wrong_kind_ref",
    );
  });

  it("rejects pantry priority, link, unit, precision, and null-inventory mismatches", () => {
    const cases: readonly [
      string,
      (payload: AiGeneratedMenuPayload) => void,
      ReturnType<typeof makeContext>,
    ][] = [
      [
        "pantry_priority_mismatch",
        (payload) => {
          payload.pantryUsage[0]!.priority = "prefer_use";
        },
        makeContext(),
      ],
      [
        "pantry_usage_link_mismatch",
        (payload) => {
          payload.pantryUsage[0]!.dishRefs = ["dish_2"];
        },
        makeContext(),
      ],
      [
        "pantry_unit_mismatch",
        (payload) => {
          payload.pantryUsage[0]!.unit = "kg";
        },
        makeContext(),
      ],
      [
        "pantry_unit_mismatch",
        (payload) => {
          payload.pantryUsage[0]!.unit = "G";
        },
        makeContext(),
      ],
      [
        "pantry_unit_mismatch",
        (payload) => {
          payload.pantryUsage[0]!.unit = "ｇ";
        },
        makeContext(),
      ],
      [
        "pantry_unit_mismatch",
        (payload) => {
          payload.pantryUsage[0]!.plannedQuantity = 0.0001;
        },
        makeContext(),
      ],
      ["pantry_unit_mismatch", () => undefined, makeContext(null)],
    ];
    for (const [code, mutate, context] of cases) {
      const payload = makePayload();
      mutate(payload);
      expectOutputError(() => materializeAiGeneratedMenu(payload, context, uuidFactory()), code);
    }
  });

  it("rejects unknown pantry/member refs, repeated usage, and missing must-use", () => {
    const unknownPantry = makePayload();
    unknownPantry.pantryUsage[0]!.pantryRef = "pantry_2";
    expectOutputError(
      () => materializeAiGeneratedMenu(unknownPantry, makeContext(), uuidFactory()),
      "unknown_pantry_ref",
    );
    const unknownMember = makePayload();
    unknownMember.adaptations[0]!.anonymousMemberRef = "member_2";
    expectOutputError(
      () => materializeAiGeneratedMenu(unknownMember, makeContext(), uuidFactory()),
      "unknown_member_ref",
    );
    const repeated = makePayload();
    repeated.pantryUsage = [...repeated.pantryUsage, repeated.pantryUsage[0]!];
    expectOutputError(
      () => materializeAiGeneratedMenu(repeated, makeContext(), uuidFactory()),
      "pantry_usage_duplicate",
    );
    const missing = makePayload();
    missing.pantryUsage = [];
    expectOutputError(
      () => materializeAiGeneratedMenu(missing, makeContext(), uuidFactory()),
      "must_use_missing",
    );
  });

  it("rejects UUID values and invalid label source paths", () => {
    const uuidValue = makePayload();
    uuidValue.dishes[0]!.name = "70000000-0000-4000-8000-000000000099";
    expectOutputError(
      () => materializeAiGeneratedMenu(uuidValue, makeContext(), uuidFactory()),
      "uuid_in_provider_output",
    );

    const invalidPath = makePayload();
    invalidPath.labelConfirmations = [
      {
        sourceType: "dish",
        sourceRef: "dish_1",
        sourcePath: "dishes.0.ingredients.0.name",
        allergenId: "wheat",
        anonymousMemberRef: "member_1",
        dictionaryVersion: "jp-caa-2026-04.v1",
        confirmationStatus: "pending",
      },
    ];
    expectOutputError(
      () => materializeAiGeneratedMenu(invalidPath, makeContext(), uuidFactory()),
      "label_source_invalid",
    );
  });

  it("uses the canonical food-name normalizer for pantry-backed label sources", () => {
    const payload = makePayload();
    payload.dishes[0]!.ingredients[0]!.name = "ご は ん";
    payload.labelConfirmations = [
      {
        sourceType: "ingredient",
        sourceRef: "ingredient_1",
        sourcePath: "dishes.0.ingredients.0.name",
        allergenId: "wheat",
        anonymousMemberRef: "member_1",
        dictionaryVersion: "jp-caa-2026-04.v1",
        confirmationStatus: "pending",
      },
    ];
    expect(() => materializeAiGeneratedMenu(payload, makeContext(), uuidFactory())).not.toThrow();

    payload.dishes[0]!.ingredients[0]!.name = "パン";
    expectOutputError(
      () => materializeAiGeneratedMenu(payload, makeContext(), uuidFactory()),
      "pantry_name_mismatch",
    );
  });

  it("checks every pantry-backed ingredient even when labels omit the mismatch", () => {
    const withoutLabels = makePayload();
    withoutLabels.dishes[0]!.ingredients[0]!.name = "パン";
    expectOutputError(
      () => materializeAiGeneratedMenu(withoutLabels, makeContext(), uuidFactory()),
      "pantry_name_mismatch",
    );

    const mixed = makePayload();
    mixed.dishes[0]!.ingredients.push({
      ...mixed.dishes[0]!.ingredients[0]!,
      ingredientRef: "ingredient_3",
      position: 2,
      name: "パン",
    });
    mixed.labelConfirmations = [
      {
        sourceType: "ingredient",
        sourceRef: "ingredient_1",
        sourcePath: "dishes.0.ingredients.0.name",
        allergenId: "wheat",
        anonymousMemberRef: "member_1",
        dictionaryVersion: "jp-caa-2026-04.v1",
        confirmationStatus: "pending",
      },
    ];
    expectOutputError(
      () => materializeAiGeneratedMenu(mixed, makeContext(), uuidFactory()),
      "pantry_name_mismatch",
    );
  });

  it.each([0.1, 0.2, 0.3, 1.001])("accepts exact thousandth quantity %s", (quantity) => {
    const payload = makePayload();
    payload.pantryUsage[0]!.plannedQuantity = quantity;
    expect(() =>
      materializeAiGeneratedMenu(payload, makeContext(quantity), uuidFactory()),
    ).not.toThrow();
  });

  it("distinguishes declared wrong-kind refs from undeclared refs", () => {
    const undeclared = makePayload();
    undeclared.labelConfirmations = [
      {
        sourceType: "dish",
        sourceRef: "ingredient_99",
        sourcePath: "dishes.0.name",
        allergenId: "wheat",
        anonymousMemberRef: "member_1",
        dictionaryVersion: "jp-caa-2026-04.v1",
        confirmationStatus: "pending",
      },
    ];
    expectOutputError(
      () => materializeAiGeneratedMenu(undeclared, makeContext(), uuidFactory()),
      "label_source_invalid",
    );

    const declared = makePayload();
    declared.labelConfirmations = [
      {
        ...undeclared.labelConfirmations[0]!,
        sourceRef: "ingredient_1",
      },
    ];
    expectOutputError(
      () => materializeAiGeneratedMenu(declared, makeContext(), uuidFactory()),
      "wrong_kind_ref",
    );
  });

  it("rejects a wrong prefix in a typed ref as invalid provider structure", () => {
    const payload = makePayload();
    payload.dishes[0]!.steps[0]!.stepRef = "dish_9";
    expectOutputError(
      () => materializeAiGeneratedMenu(payload, makeContext(), uuidFactory()),
      "invalid_provider_menu",
    );
  });

  it("resolves every safety action ref to the fresh internal graph", () => {
    const payload = makePayload();
    payload.adaptations[0]!.safetyActions = [
      {
        kind: "remove_bones",
        dishRef: "dish_1",
        ingredientRef: "ingredient_1",
        anonymousMemberRef: "member_1",
        beforeStepRef: "step_1",
        instruction: "骨を除く",
      },
    ];
    const menu = materializeAiGeneratedMenu(payload, makeContext(), uuidFactory());
    expect(menu.adaptations[0]?.safetyActions[0]).toMatchObject({
      dishId: menu.dishes[0]?.id,
      ingredientId: menu.dishes[0]?.ingredients[0]?.id,
      beforeRecipeStepId: menu.dishes[0]?.steps[0]?.id,
      anonymousMemberRef: "member_1",
    });
  });
});
