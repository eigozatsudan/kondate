import type { GeneratedMenu, ValidatedMenu } from "../contracts/generation.js";
import type { CurrentSafetyContext } from "../safety/context.js";
import { hardBeanAndReviewedNutRule } from "../safety/current-food-safety-rules.v1.js";
import type { GenerationContext } from "../safety/generation-context.js";

export { hardBeanAndReviewedNutRule } from "../safety/current-food-safety-rules.v1.js";

export function makeValidatedMenu(overrides: Partial<ValidatedMenu> = {}): ValidatedMenu {
  const dishId = "50000000-0000-4000-8000-000000000001";
  const stepId = "51000000-0000-4000-8000-000000000001";
  const base: ValidatedMenu = {
    schemaVersion: "2026-07-11.v1",
    menuId: "52000000-0000-4000-8000-000000000001",
    mealType: "breakfast",
    cuisineGenre: "japanese",
    servings: 2,
    totalElapsedMinutes: 15,
    safetyTags: [],
    dishes: [
      {
        id: dishId,
        role: "main",
        position: 1,
        name: "塩おにぎり",
        description: "朝の主食",
        cookingTimeMinutes: 10,
        ingredients: [
          {
            id: "53000000-0000-4000-8000-000000000001",
            position: 1,
            name: "ごはん",
            quantityValue: 300,
            quantityText: "300g",
            unit: "g",
            storeSection: "dry_goods",
            pantrySelectionId: null,
            labelConfirmationRequired: false,
          },
        ],
        steps: [{ id: stepId, position: 1, instruction: "ごはんを握る" }],
      },
      {
        id: "50000000-0000-4000-8000-000000000002",
        role: "side",
        position: 2,
        name: "温野菜",
        description: "加熱した野菜",
        cookingTimeMinutes: 5,
        ingredients: [
          {
            id: "53000000-0000-4000-8000-000000000002",
            position: 1,
            name: "にんじん",
            quantityValue: 0.5,
            quantityText: "1/2本",
            unit: "本",
            storeSection: "produce",
            pantrySelectionId: null,
            labelConfirmationRequired: false,
          },
        ],
        steps: [
          {
            id: "51000000-0000-4000-8000-000000000002",
            position: 1,
            instruction: "やわらかく加熱する",
          },
        ],
      },
    ],
    timeline: [
      {
        id: "54000000-0000-4000-8000-000000000001",
        position: 1,
        startMinute: 0,
        durationMinutes: 10,
        instruction: "野菜を加熱しながらおにぎりを作る",
        dishId,
        recipeStepId: stepId,
      },
    ],
    adaptations: [],
    pantryUsage: [],
    labelConfirmations: [],
  };
  return { ...base, ...overrides };
}

export function makeGeneratedMenu(overrides: Partial<GeneratedMenu> = {}): GeneratedMenu {
  const menu = makeValidatedMenu();
  const firstDish = menu.dishes.at(0);
  const firstStep = firstDish?.steps.at(0);
  if (firstDish === undefined || firstStep === undefined) {
    throw new Error("生成献立factoryに料理と工程が必要です");
  }
  const adaptations: GeneratedMenu["adaptations"] = [
    {
      id: "57000000-0000-4000-8000-000000000001",
      dishId: firstDish.id,
      anonymousMemberRef: "member_1",
      portionText: "通常量",
      branchBeforeRecipeStepId: firstStep.id,
      additionalCutting: null,
      additionalHeating: null,
      additionalSeasoning: null,
      servingCheck: "通常の取り分けを確認する",
      safetyTags: [],
      safetyActions: [],
    },
  ];
  return {
    ...menu,
    adaptations,
    ...overrides,
    labelConfirmations: overrides.labelConfirmations ?? [],
  };
}

export function makeCurrentSafetyContext(
  overrides: Partial<CurrentSafetyContext> = {},
): CurrentSafetyContext {
  const base: CurrentSafetyContext = {
    dictionaryVersion: "jp-caa-2026-04.v1",
    foodRuleVersion: "jp-caa-child-shape-2026-07.v1",
    requestText: "",
    members: [
      {
        householdMemberId: "55000000-0000-4000-8000-000000000001",
        anonymousRef: "member_1",
        ageBand: "adult",
        allergyStatus: "none",
        allergenIds: [],
        hasUnmappedCustomAllergy: false,
        requiredSafetyConstraints: [],
        unsupportedDietStatus: "none",
        unsupportedDietKinds: [],
      },
    ],
    allergenDictionary: { version: "jp-caa-2026-04.v1", catalog: [], aliases: [] },
    foodSafetyRules: [],
  };
  return { ...base, ...overrides };
}

export function makeGenerationContext(
  overrides: Partial<GenerationContext> = {},
): GenerationContext {
  const memberId = "55000000-0000-4000-8000-000000000001";
  const base: GenerationContext = {
    submission: {
      mealType: "breakfast",
      mainIngredients: ["ごはん"],
      cuisineGenre: "japanese",
      targetMemberIds: [memberId],
      timeLimitMinutes: 15,
      budgetPreference: "standard",
      avoidIngredients: [],
      memo: "",
      pantrySelections: [],
    },
    safety: makeCurrentSafetyContext(),
    pantryItems: [],
    memberPreferences: [
      {
        householdMemberId: memberId,
        anonymousMemberRef: "member_1",
        portionSize: "regular",
        spiceLevel: "regular",
        easePreferences: [],
        dislikes: [],
      },
    ],
    targetMembers: [
      {
        householdMemberId: memberId,
        anonymousRef: "member_1",
        displayNameSnapshot: "家族1",
      },
    ],
    expiredPantryChecks: [],
    idempotencyKey: "56000000-0000-4000-8000-000000000001",
    preferenceSnapshot: {},
    safetySnapshot: {},
  };
  return { ...base, ...overrides };
}

export function underSixHardBeanAndNutContext(): GenerationContext {
  const base = makeGenerationContext();
  return {
    ...base,
    safety: {
      ...base.safety,
      members: base.safety.members.map((member) => ({ ...member, ageBand: "age_3_5" })),
      foodSafetyRules: [hardBeanAndReviewedNutRule],
    },
  };
}
