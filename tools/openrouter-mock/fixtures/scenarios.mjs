const success = {
  outcome: "success",
  menu: {
    schemaVersion: "2026-07-11.v1",
    mealType: "breakfast",
    cuisineGenre: "japanese",
    servings: 2,
    totalElapsedMinutes: 15,
    safetyTags: ["cut_small"],
    dishes: [
      {
        dishRef: "dish_1",
        role: "main",
        position: 1,
        name: "鶏肉と白菜のやわらか煮",
        description: "朝の短時間煮物",
        cookingTimeMinutes: 15,
        ingredients: [
          {
            ingredientRef: "ingredient_1",
            position: 1,
            name: "鶏もも肉",
            quantityValue: 200,
            quantityText: "200g",
            unit: "g",
            storeSection: "meat_fish",
            pantryRef: null,
            labelConfirmationRequired: false,
          },
          {
            ingredientRef: "ingredient_2",
            position: 2,
            name: "しょうゆ",
            quantityValue: 1,
            quantityText: "小さじ1",
            unit: "tsp",
            storeSection: "seasonings",
            pantryRef: null,
            labelConfirmationRequired: true,
          },
        ],
        steps: [
          {
            stepRef: "step_1",
            position: 1,
            instruction: "鶏肉を小さく切り、白菜と十分に加熱する",
          },
        ],
      },
      {
        dishRef: "dish_2",
        role: "side",
        position: 2,
        name: "にんじんの温サラダ",
        description: "やわらかい副菜",
        cookingTimeMinutes: 8,
        ingredients: [
          {
            ingredientRef: "ingredient_3",
            position: 1,
            name: "にんじん",
            quantityValue: 1,
            quantityText: "1本",
            unit: "piece",
            storeSection: "produce",
            pantryRef: null,
            labelConfirmationRequired: false,
          },
        ],
        steps: [
          {
            stepRef: "step_2",
            position: 1,
            instruction: "にんじんを薄く切り、やわらかく加熱する",
          },
        ],
      },
    ],
    timeline: [
      {
        timelineRef: "timeline_1",
        position: 1,
        startMinute: 0,
        durationMinutes: 7,
        instruction: "主菜の材料を切って加熱を始める",
        dishRef: "dish_1",
        stepRef: "step_1",
      },
      {
        timelineRef: "timeline_2",
        position: 2,
        startMinute: 7,
        durationMinutes: 8,
        instruction: "主菜を煮ながら副菜を仕上げる",
        dishRef: "dish_2",
        stepRef: "step_2",
      },
    ],
    adaptations: [
      {
        adaptationRef: "adaptation_1",
        dishRef: "dish_1",
        anonymousMemberRef: "member_1",
        portionText: "1人分",
        beforeStepRef: "step_1",
        additionalCutting: "1cm角",
        additionalHeating: "中心まで十分に加熱",
        additionalSeasoning: null,
        servingCheck: "骨がないことを確認",
        safetyTags: ["cut_small"],
        safetyActions: [
          {
            kind: "remove_bones",
            dishRef: "dish_1",
            ingredientRef: "ingredient_1",
            anonymousMemberRef: "member_1",
            beforeStepRef: "step_1",
            instruction: "骨を完全に除く",
          },
        ],
      },
    ],
    pantryUsage: [],
    labelConfirmations: [
      {
        sourceType: "ingredient",
        sourceRef: "ingredient_2",
        sourcePath: "dishes.0.ingredients.1.name",
        allergenId: "wheat",
        anonymousMemberRef: "member_1",
        dictionaryVersion: "jp-caa-2026-04.v1",
        confirmationStatus: "pending",
      },
    ],
  },
};

const clone = () => structuredClone(success);
const directAllergen = clone();
directAllergen.menu.dishes[0].ingredients[0].name = "卵";
const aliasInStep = clone();
aliasInStep.menu.dishes[0].steps[0].instruction = "マヨネーズを混ぜる";
const missingLabel = clone();
missingLabel.menu.labelConfirmations = [];
const unsafeAge = clone();
unsafeAge.menu.dishes[1].ingredients[0].name = "丸ごとのミニトマト";
const badBranch = clone();
badBranch.menu.adaptations[0].beforeStepRef = "step_999";
const pantryMismatch = clone();
pantryMismatch.menu.dishes[0].ingredients[0].pantryRef = "pantry_1";
pantryMismatch.menu.pantryUsage = [
  {
    pantryRef: "pantry_1",
    priority: "must_use",
    usageStatus: "used",
    plannedQuantity: 300,
    unit: "g",
    dishRefs: ["dish_2"],
    unusedReason: null,
  },
];
const overTime = clone();
overTime.menu.totalElapsedMinutes = 30;

const recursivelyFreeze = (value) => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) recursivelyFreeze(child);
    Object.freeze(value);
  }
  return value;
};

export const scenarios = recursivelyFreeze({
  success,
  "constraint-conflict": {
    outcome: "constraint_conflict",
    conflicts: [
      {
        code: "must_use_conflict",
        message: "必須食材と安全条件を同時に満たせません。",
        conditionRefs: ["pantry_1"],
      },
    ],
  },
  "malformed-json": "{not-json",
  "direct-allergen": directAllergen,
  "alias-in-step": aliasInStep,
  "missing-label-confirmation": missingLabel,
  "unsafe-age-shape": unsafeAge,
  "invalid-adaptation-branch": badBranch,
  "invalid-pantry-dish-link": pantryMismatch,
  "over-time-limit": overTime,
});
