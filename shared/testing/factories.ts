import { releaseQuota, type GeneratedMenu, type ValidatedMenu } from "../contracts/generation.js";
import type { MenuResultViewModel } from "../contracts/menu-result.js";
import type { CurrentSafetyContext } from "../safety/context.js";
import { currentAllergenCatalogV1 } from "../safety/current-allergen-catalog.v1.js";
import { hardBeanAndReviewedNutRule } from "../safety/current-food-safety-rules.v1.js";
import { currentFoodSafetyRulesV1 } from "../safety/current-food-safety-rules.v1.js";
import type { GenerationContext } from "../safety/generation-context.js";

export { hardBeanAndReviewedNutRule } from "../safety/current-food-safety-rules.v1.js";

/** 利用状況の共有 fixture（usage-today 各層で再定義しない） */
export const availableUsageTodayFixture = {
  success: { consumed: 1, limit: releaseQuota.userDailySuccessLimit, remaining: 4 },
  attempts: { sent: 2, limit: releaseQuota.userDailyExternalCallLimit, remaining: 10 },
  shortWindow: {
    sent: 2,
    limit: releaseQuota.userShortWindowExternalCallLimit,
    remaining: 2,
    retryAt: null,
  },
  globalAvailable: true,
  retryAt: null,
} as const;

export const shortWindowBlockedUsageTodayFixture = {
  success: { consumed: 1, limit: releaseQuota.userDailySuccessLimit, remaining: 4 },
  attempts: { sent: 4, limit: releaseQuota.userDailyExternalCallLimit, remaining: 8 },
  shortWindow: {
    sent: 4,
    limit: releaseQuota.userShortWindowExternalCallLimit,
    remaining: 0,
    retryAt: "2026-07-11T09:10:00+09:00",
  },
  globalAvailable: true,
  retryAt: "2026-07-11T09:10:00+09:00",
} as const;

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
    allergenDictionary: {
      version: "jp-caa-2026-04.v1",
      catalog: currentAllergenCatalogV1.map((entry) => ({
        id: entry.id,
        displayName: entry.displayName,
        catalogVersion: entry.catalogVersion,
      })),
      aliases: currentAllergenCatalogV1.map((entry) => ({
        allergenId: entry.id,
        alias: entry.displayName,
        normalizedAlias: entry.displayName,
        aliasKind: "direct" as const,
        requiresLabelConfirmation: false,
        dictionaryVersion: entry.catalogVersion,
      })),
    },
    foodSafetyRules: [...currentFoodSafetyRulesV1],
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
      targetMode: "household",
      targetMemberIds: [memberId],
      servings: null,
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

// 献立結果画面（MenuResult）のコンポーネント／ページ用フィクスチャ。
// makeValidatedMenu() の既定値（塩おにぎり／温野菜の2品、取り分けと在庫使用と
// ラベル確認はすべて空）はそのまま使わず、段取り・安全手順・在庫の不足と未使用理由・
// ラベル確認の各表示を一度に検証できるよう adaptations/pantryUsage/labelConfirmations
// を上書きする。
//
export function makeMenuResultViewModel(): MenuResultViewModel {
  const dish1Id = "50000000-0000-4000-8000-000000000001";
  const dish2Id = "50000000-0000-4000-8000-000000000002";
  const ingredient1Id = "53000000-0000-4000-8000-000000000001";
  const ingredient2Id = "53000000-0000-4000-8000-000000000002";
  const step1Id = "51000000-0000-4000-8000-000000000001";
  const baseMenu = makeValidatedMenu();
  const dishes = baseMenu.dishes.map((dish) => ({
    ...dish,
    ingredients: dish.ingredients.map((ingredient) =>
      ingredient.id === ingredient1Id
        ? { ...ingredient, name: "しょうゆ", labelConfirmationRequired: true }
        : ingredient.id === ingredient2Id
          ? {
              ...ingredient,
              name: "乳成分入りドレッシング",
              labelConfirmationRequired: true,
            }
          : ingredient,
    ),
    steps: [
      ...dish.steps,
      {
        id:
          dish.id === dish1Id
            ? "51000000-0000-4000-8000-000000000003"
            : "51000000-0000-4000-8000-000000000004",
        position: 2,
        instruction: dish.id === dish1Id ? "のりを巻く" : "器に盛る",
      },
    ],
  }));

  const menu = makeValidatedMenu({
    dishes,
    adaptations: [
      {
        id: "57000000-0000-4000-8000-000000000001",
        dishId: dish1Id,
        anonymousMemberRef: "member_1",
        portionText: "取り分け量を確認",
        branchBeforeRecipeStepId: step1Id,
        additionalCutting: "細かくほぐす",
        additionalHeating: "中心まで温める",
        additionalSeasoning: "薄味にする",
        servingCheck: "小さくちぎって渡す",
        safetyTags: [],
        safetyActions: [
          {
            kind: "cut_small",
            dishId: dish1Id,
            ingredientId: ingredient1Id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: step1Id,
            instruction: "食べやすい大きさにほぐしてください",
          },
        ],
      },
    ],
    pantryUsage: [
      {
        selectionId: "58000000-0000-4000-8000-000000000001",
        pantryItemId: "59000000-0000-4000-8000-000000000001",
        pantryItemName: "にんじん",
        priority: "prefer_use",
        usageStatus: "used",
        plannedQuantity: 100,
        inventoryQuantity: 60,
        shortageQuantity: 40,
        unit: "g",
        dishIds: [dish2Id],
        unusedReason: null,
      },
      {
        selectionId: "58000000-0000-4000-8000-000000000002",
        pantryItemId: "59000000-0000-4000-8000-000000000002",
        pantryItemName: "小松菜",
        priority: "prefer_use",
        usageStatus: "unused",
        plannedQuantity: null,
        inventoryQuantity: null,
        shortageQuantity: null,
        unit: null,
        dishIds: [],
        unusedReason: "傷んでいたため使わなかった",
      },
    ],
    labelConfirmations: [
      {
        sourceType: "ingredient",
        sourceId: ingredient1Id,
        sourcePath: "dishes.0.ingredients.0.name",
        sourceText: "しょうゆ",
        allergenId: "wheat",
        anonymousMemberRef: "member_2",
        dictionaryVersion: "jp-caa-2026-04.v1",
        confirmationStatus: "pending",
        confirmedAt: null,
        confirmedBy: null,
      },
      {
        sourceType: "ingredient",
        sourceId: ingredient2Id,
        sourcePath: "dishes.1.ingredients.0.name",
        sourceText: "乳成分入りドレッシング",
        allergenId: "milk",
        anonymousMemberRef: "member_1",
        dictionaryVersion: "jp-caa-2026-04.v1",
        confirmationStatus: "pending",
        confirmedAt: null,
        confirmedBy: null,
      },
    ],
  });

  return {
    menu,
    memberLabels: { member_1: "子ども", member_2: "大人" },
    labelConfirmations: [
      {
        confirmationId: "79000000-0000-4000-8000-000000000001",
        sourceType: "ingredient" as const,
        sourceId: ingredient1Id,
        sourcePath: "dishes.0.ingredients.0.name",
        sourceText: "しょうゆ",
        allergenName: "小麦",
        memberLabel: "大人",
        dictionaryVersion: "jp-caa-2026-04.v1",
        confirmationStatus: "pending" as const,
        requirementSafetyFingerprint: "a".repeat(64),
        isCurrent: true as const,
        confirmedAt: null,
        confirmedBy: null,
      },
      {
        confirmationId: "79000000-0000-4000-8000-000000000002",
        sourceType: "ingredient" as const,
        sourceId: ingredient2Id,
        sourcePath: "dishes.1.ingredients.0.name",
        sourceText: "乳成分入りドレッシング",
        allergenName: "乳",
        memberLabel: "子ども",
        dictionaryVersion: "jp-caa-2026-04.v1",
        confirmationStatus: "pending" as const,
        requirementSafetyFingerprint: "b".repeat(64),
        isCurrent: true as const,
        confirmedAt: null,
        confirmedBy: null,
      },
    ],
    pantryPostCookTargets: [
      {
        selectionId: "65000000-0000-4000-8000-000000000001",
        pantryItemId: "66000000-0000-4000-8000-000000000001",
        pantryItemName: "しょうゆ",
        plannedQuantity: 15,
        unit: "ml",
        currentPantryRow: {
          id: "66000000-0000-4000-8000-000000000001",
          name: "しょうゆ",
          quantity: 200,
          unit: "ml",
          expiresOn: "2026-12-01",
          expirationType: "best_before",
          openedState: "opened",
          updatedAt: "2026-07-11T00:00:00.000Z",
        },
      },
      {
        selectionId: "65000000-0000-4000-8000-000000000002",
        pantryItemId: null,
        pantryItemName: "消えた食材",
        plannedQuantity: 1,
        unit: "個",
        currentPantryRow: null,
      },
    ],
  };
}
