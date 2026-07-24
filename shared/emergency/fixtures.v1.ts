import type { AgeBand } from "../contracts/domain.js";
import { validatedMenuSchema, type ValidatedMenu } from "../contracts/generation.js";

export const emergencyFixtureVersion = "2026-07-11.v1" as const;

const allReviewedAgeBands = [
  "post_weaning_to_2",
  "age_3_5",
  "age_6_8",
  "age_9_12",
  "age_13_17",
  "adult",
  "senior",
] as const satisfies readonly AgeBand[];

const breakfastFixture = {
  schemaVersion: "2026-07-11.v1",
  menuId: "82000000-0000-4000-8000-000000000002",
  mealType: "breakfast",
  cuisineGenre: "japanese",
  servings: 2,
  totalElapsedMinutes: 15,
  // cut_small は料理単位で ingredient-bound の検証証拠が必要なため全皿に付与する
  safetyTags: ["remove_bones", "soften", "cut_small"],
  dishes: [
    {
      id: "82100000-0000-4000-8000-000000000011",
      role: "main",
      position: 1,
      name: "鮭おにぎり",
      description: "骨を除いた鮭を混ぜたおにぎり",
      cookingTimeMinutes: 10,
      ingredients: [
        {
          id: "82200000-0000-4000-8000-000000000011",
          position: 1,
          name: "ごはん",
          quantityValue: 300,
          quantityText: "300g",
          unit: "g",
          storeSection: "dry_goods",
          pantrySelectionId: null,
          labelConfirmationRequired: false,
        },
        {
          id: "82200000-0000-4000-8000-000000000012",
          position: 2,
          name: "鮭",
          quantityValue: 1,
          quantityText: "1切れ",
          unit: "切れ",
          storeSection: "meat_fish",
          pantrySelectionId: null,
          labelConfirmationRequired: false,
        },
      ],
      steps: [
        {
          id: "82300000-0000-4000-8000-000000000011",
          position: 1,
          // 除骨の肯定証拠は「除いて…ほぐす」形。cut_small 証拠は adaptation 側に置く
          instruction: "鮭を中心まで十分に焼き、骨を完全に除いて細かくほぐす",
        },
        {
          id: "82300000-0000-4000-8000-000000000012",
          position: 2,
          instruction: "ごはんに鮭を混ぜ、食べやすい大きさに握る",
        },
      ],
    },
    {
      id: "82100000-0000-4000-8000-000000000012",
      role: "side",
      position: 2,
      name: "やわらか野菜",
      description: "にんじんとキャベツをやわらかく煮た副菜",
      cookingTimeMinutes: 12,
      ingredients: [
        {
          id: "82200000-0000-4000-8000-000000000013",
          position: 1,
          name: "にんじん",
          quantityValue: 0.5,
          quantityText: "1/2本",
          unit: "本",
          storeSection: "produce",
          pantrySelectionId: null,
          labelConfirmationRequired: false,
        },
        {
          id: "82200000-0000-4000-8000-000000000014",
          position: 2,
          name: "キャベツ",
          quantityValue: 2,
          quantityText: "2枚",
          unit: "枚",
          storeSection: "produce",
          pantrySelectionId: null,
          labelConfirmationRequired: false,
        },
      ],
      steps: [
        {
          id: "82300000-0000-4000-8000-000000000013",
          position: 1,
          // 食材名を明示し cut_small の ingredient-bound 証拠にする
          instruction: "にんじんを小さく切り、鍋で歯ぐきでつぶせるやわらかさまで煮る",
        },
      ],
    },
  ],
  timeline: [
    {
      id: "82400000-0000-4000-8000-000000000011",
      position: 1,
      startMinute: 0,
      durationMinutes: 3,
      instruction: "鮭を焼き始め、にんじんを小さく切る",
      dishId: null,
      recipeStepId: null,
    },
    {
      id: "82400000-0000-4000-8000-000000000012",
      position: 2,
      startMinute: 3,
      durationMinutes: 9,
      instruction: "野菜を煮ながら鮭の骨を完全に除く",
      dishId: null,
      recipeStepId: null,
    },
    {
      id: "82400000-0000-4000-8000-000000000013",
      position: 3,
      startMinute: 12,
      durationMinutes: 3,
      instruction: "鮭をごはんに混ぜて握り、野菜を盛る",
      dishId: null,
      recipeStepId: null,
    },
  ],
  adaptations: [
    {
      id: "82500000-0000-4000-8000-000000000011",
      dishId: "82100000-0000-4000-8000-000000000011",
      anonymousMemberRef: "member_1",
      portionText: "年齢と食欲に合わせた量",
      branchBeforeRecipeStepId: "82300000-0000-4000-8000-000000000011",
      additionalCutting: "鮭を細かく刻む",
      additionalHeating: "鮭の中心まで十分に加熱する",
      additionalSeasoning: null,
      servingCheck: "鮭の骨が残っていないことを確認する",
      safetyTags: ["remove_bones", "cut_small"],
      safetyActions: [
        {
          kind: "remove_bones",
          dishId: "82100000-0000-4000-8000-000000000011",
          ingredientId: "82200000-0000-4000-8000-000000000012",
          anonymousMemberRef: "member_1",
          beforeRecipeStepId: "82300000-0000-4000-8000-000000000011",
          instruction: "鮭の小骨を完全に除く",
        },
        {
          kind: "cut_small",
          dishId: "82100000-0000-4000-8000-000000000011",
          ingredientId: "82200000-0000-4000-8000-000000000012",
          anonymousMemberRef: "member_1",
          beforeRecipeStepId: "82300000-0000-4000-8000-000000000011",
          instruction: "鮭を細かく刻む",
        },
      ],
    },
    {
      // 副菜にも cut_small を必須（missing-evidence は料理単位）
      id: "82500000-0000-4000-8000-000000000012",
      dishId: "82100000-0000-4000-8000-000000000012",
      anonymousMemberRef: "member_1",
      portionText: "年齢と食欲に合わせた量",
      branchBeforeRecipeStepId: "82300000-0000-4000-8000-000000000013",
      additionalCutting: "にんじんを小さく切る",
      additionalHeating: null,
      additionalSeasoning: null,
      servingCheck: "にんじんを小さく切ったことを確認する",
      safetyTags: ["cut_small"],
      safetyActions: [
        {
          kind: "cut_small",
          dishId: "82100000-0000-4000-8000-000000000012",
          ingredientId: "82200000-0000-4000-8000-000000000013",
          anonymousMemberRef: "member_1",
          beforeRecipeStepId: "82300000-0000-4000-8000-000000000013",
          instruction: "にんじんを小さく切る",
        },
      ],
    },
  ],
  pantryUsage: [],
  labelConfirmations: [],
} as const;

const lunchFixture = {
  schemaVersion: "2026-07-11.v1",
  menuId: "82000000-0000-4000-8000-000000000003",
  mealType: "lunch",
  cuisineGenre: "japanese",
  servings: 2,
  totalElapsedMinutes: 15,
  safetyTags: ["heat_thoroughly", "cut_small", "soften"],
  dishes: [
    {
      id: "82100000-0000-4000-8000-000000000021",
      role: "main",
      position: 1,
      name: "鶏そぼろ丼",
      description: "十分に加熱した鶏そぼろの丼",
      cookingTimeMinutes: 12,
      ingredients: [
        {
          id: "82200000-0000-4000-8000-000000000021",
          position: 1,
          name: "鶏ひき肉",
          quantityValue: 200,
          quantityText: "200g",
          unit: "g",
          storeSection: "meat_fish",
          pantrySelectionId: null,
          labelConfirmationRequired: false,
        },
        {
          id: "82200000-0000-4000-8000-000000000022",
          position: 2,
          name: "ごはん",
          quantityValue: 300,
          quantityText: "300g",
          unit: "g",
          storeSection: "dry_goods",
          pantrySelectionId: null,
          labelConfirmationRequired: false,
        },
      ],
      steps: [
        {
          id: "82300000-0000-4000-8000-000000000021",
          position: 1,
          instruction: "鶏ひき肉をほぐしながら中心まで十分に加熱する",
        },
        {
          id: "82300000-0000-4000-8000-000000000022",
          position: 2,
          instruction: "ごはんに鶏そぼろをのせる",
        },
      ],
    },
    {
      id: "82100000-0000-4000-8000-000000000022",
      role: "side",
      position: 2,
      name: "やわらか温野菜",
      description: "かぼちゃとにんじんの温野菜",
      cookingTimeMinutes: 10,
      ingredients: [
        {
          id: "82200000-0000-4000-8000-000000000023",
          position: 1,
          name: "かぼちゃ",
          quantityValue: 100,
          quantityText: "100g",
          unit: "g",
          storeSection: "produce",
          pantrySelectionId: null,
          labelConfirmationRequired: false,
        },
        {
          id: "82200000-0000-4000-8000-000000000024",
          position: 2,
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
          id: "82300000-0000-4000-8000-000000000023",
          position: 1,
          // 食材名を明示し cut_small の ingredient-bound 証拠にする
          instruction: "かぼちゃを小さく切り、歯ぐきでつぶせるやわらかさまで加熱する",
        },
      ],
    },
  ],
  timeline: [
    {
      id: "82400000-0000-4000-8000-000000000021",
      position: 1,
      startMinute: 0,
      durationMinutes: 4,
      instruction: "かぼちゃを小さく切り、鶏ひき肉を火にかける",
      dishId: null,
      recipeStepId: null,
    },
    {
      id: "82400000-0000-4000-8000-000000000022",
      position: 2,
      startMinute: 4,
      durationMinutes: 8,
      instruction: "鶏そぼろと温野菜を同時に十分加熱する",
      dishId: null,
      recipeStepId: null,
    },
    {
      id: "82400000-0000-4000-8000-000000000023",
      position: 3,
      startMinute: 12,
      durationMinutes: 3,
      instruction: "丼と温野菜を盛り付ける",
      dishId: null,
      recipeStepId: null,
    },
  ],
  adaptations: [
    {
      id: "82500000-0000-4000-8000-000000000021",
      dishId: "82100000-0000-4000-8000-000000000021",
      anonymousMemberRef: "member_1",
      portionText: "年齢と食欲に合わせた量",
      branchBeforeRecipeStepId: "82300000-0000-4000-8000-000000000021",
      additionalCutting: "鶏ひき肉を細かく刻む",
      additionalHeating: "鶏ひき肉の中心まで十分に加熱する",
      additionalSeasoning: null,
      servingCheck: "生焼けがないことを確認する",
      safetyTags: ["heat_thoroughly", "cut_small"],
      safetyActions: [
        {
          kind: "heat_thoroughly",
          dishId: "82100000-0000-4000-8000-000000000021",
          ingredientId: "82200000-0000-4000-8000-000000000021",
          anonymousMemberRef: "member_1",
          beforeRecipeStepId: "82300000-0000-4000-8000-000000000021",
          instruction: "鶏ひき肉の中心まで十分に加熱する",
        },
        {
          kind: "cut_small",
          dishId: "82100000-0000-4000-8000-000000000021",
          ingredientId: "82200000-0000-4000-8000-000000000021",
          anonymousMemberRef: "member_1",
          beforeRecipeStepId: "82300000-0000-4000-8000-000000000021",
          instruction: "鶏ひき肉を細かく刻む",
        },
      ],
    },
    {
      // 副菜の cut_small は adaptation の料理グラフに合わせ別行へ
      id: "82500000-0000-4000-8000-000000000022",
      dishId: "82100000-0000-4000-8000-000000000022",
      anonymousMemberRef: "member_1",
      portionText: "年齢と食欲に合わせた量",
      branchBeforeRecipeStepId: "82300000-0000-4000-8000-000000000023",
      additionalCutting: "かぼちゃを小さく切る",
      additionalHeating: null,
      additionalSeasoning: null,
      servingCheck: "かぼちゃを小さく切ったことを確認する",
      safetyTags: ["cut_small"],
      safetyActions: [
        {
          kind: "cut_small",
          dishId: "82100000-0000-4000-8000-000000000022",
          ingredientId: "82200000-0000-4000-8000-000000000023",
          anonymousMemberRef: "member_1",
          beforeRecipeStepId: "82300000-0000-4000-8000-000000000023",
          instruction: "かぼちゃを小さく切る",
        },
      ],
    },
  ],
  pantryUsage: [],
  labelConfirmations: [],
} as const;

const dinnerFixture = {
  schemaVersion: "2026-07-11.v1",
  menuId: "82000000-0000-4000-8000-000000000001",
  mealType: "dinner",
  cuisineGenre: "japanese",
  servings: 2,
  totalElapsedMinutes: 15,
  safetyTags: ["heat_thoroughly", "cut_small"],
  dishes: [
    {
      id: "82100000-0000-4000-8000-000000000001",
      role: "main",
      position: 1,
      name: "鶏肉とキャベツの塩蒸し",
      description: "フライパンで蒸す主菜",
      cookingTimeMinutes: 12,
      ingredients: [
        {
          id: "82200000-0000-4000-8000-000000000001",
          position: 1,
          name: "鶏肉",
          quantityValue: 250,
          quantityText: "250g",
          unit: "g",
          storeSection: "meat_fish",
          pantrySelectionId: null,
          labelConfirmationRequired: false,
        },
        {
          id: "82200000-0000-4000-8000-000000000002",
          position: 2,
          name: "キャベツ",
          quantityValue: 0.25,
          quantityText: "1/4個",
          unit: "個",
          storeSection: "produce",
          pantrySelectionId: null,
          labelConfirmationRequired: false,
        },
        {
          id: "82200000-0000-4000-8000-000000000003",
          position: 3,
          name: "塩",
          quantityValue: null,
          quantityText: "少々",
          unit: null,
          storeSection: "seasonings",
          pantrySelectionId: null,
          labelConfirmationRequired: false,
        },
      ],
      steps: [
        {
          id: "82300000-0000-4000-8000-000000000001",
          position: 1,
          // 「一口大以下に切る」は cut_small の肯定 stem（「一口大」だけでは不一致）
          instruction: "鶏肉を一口大以下に切り、キャベツを食べやすい大きさに切る",
        },
        {
          id: "82300000-0000-4000-8000-000000000002",
          position: 2,
          instruction: "フライパンに入れて塩を振り、ふたをして中心まで十分に加熱する",
        },
      ],
    },
    {
      id: "82100000-0000-4000-8000-000000000002",
      role: "side",
      position: 2,
      name: "きゅうりの塩もみ",
      description: "小さく切った副菜",
      cookingTimeMinutes: 5,
      ingredients: [
        {
          id: "82200000-0000-4000-8000-000000000004",
          position: 1,
          name: "きゅうり",
          quantityValue: 1,
          quantityText: "1本",
          unit: "本",
          storeSection: "produce",
          pantrySelectionId: null,
          labelConfirmationRequired: false,
        },
      ],
      steps: [
        {
          id: "82300000-0000-4000-8000-000000000003",
          position: 1,
          instruction: "きゅうりを小さく切り、塩でもみ、水気を絞る",
        },
      ],
    },
    {
      id: "82100000-0000-4000-8000-000000000003",
      role: "soup",
      position: 3,
      name: "玉ねぎの塩スープ",
      description: "短時間で煮る汁物",
      cookingTimeMinutes: 10,
      ingredients: [
        {
          id: "82200000-0000-4000-8000-000000000005",
          position: 1,
          name: "玉ねぎ",
          quantityValue: 0.5,
          quantityText: "1/2個",
          unit: "個",
          storeSection: "produce",
          pantrySelectionId: null,
          labelConfirmationRequired: false,
        },
      ],
      steps: [
        {
          id: "82300000-0000-4000-8000-000000000004",
          position: 1,
          instruction: "玉ねぎを小さく切り、水でやわらかく煮、塩で味を整える",
        },
      ],
    },
  ],
  timeline: [
    {
      id: "82400000-0000-4000-8000-000000000001",
      position: 1,
      startMinute: 0,
      durationMinutes: 3,
      instruction: "湯を沸かしながら材料を一口大以下に切る",
      dishId: null,
      recipeStepId: null,
    },
    {
      id: "82400000-0000-4000-8000-000000000002",
      position: 2,
      startMinute: 3,
      durationMinutes: 10,
      instruction: "主菜を蒸し、同時にスープを煮る",
      dishId: "82100000-0000-4000-8000-000000000001",
      recipeStepId: "82300000-0000-4000-8000-000000000002",
    },
    {
      id: "82400000-0000-4000-8000-000000000003",
      position: 3,
      startMinute: 13,
      durationMinutes: 2,
      instruction: "副菜の水気を絞って盛り付ける",
      dishId: "82100000-0000-4000-8000-000000000002",
      recipeStepId: "82300000-0000-4000-8000-000000000003",
    },
  ],
  adaptations: [
    {
      id: "82500000-0000-4000-8000-000000000001",
      dishId: "82100000-0000-4000-8000-000000000001",
      anonymousMemberRef: "member_1",
      portionText: "年齢と食欲に合わせた量",
      // heat_thoroughly の beforeRecipeStepId と一致させ binding 検証を保つ
      branchBeforeRecipeStepId: "82300000-0000-4000-8000-000000000002",
      additionalCutting: "鶏肉を一口大以下に切る",
      additionalHeating: "鶏肉の中心まで十分に加熱する",
      additionalSeasoning: null,
      servingCheck: "生焼けがないことを確認する",
      safetyTags: ["heat_thoroughly", "cut_small"],
      safetyActions: [
        {
          kind: "heat_thoroughly",
          dishId: "82100000-0000-4000-8000-000000000001",
          ingredientId: "82200000-0000-4000-8000-000000000001",
          anonymousMemberRef: "member_1",
          beforeRecipeStepId: "82300000-0000-4000-8000-000000000002",
          instruction: "鶏肉の中心まで十分に加熱する",
        },
        {
          kind: "cut_small",
          dishId: "82100000-0000-4000-8000-000000000001",
          ingredientId: "82200000-0000-4000-8000-000000000001",
          anonymousMemberRef: "member_1",
          beforeRecipeStepId: "82300000-0000-4000-8000-000000000001",
          instruction: "鶏肉を一口大以下に切る",
        },
      ],
    },
    {
      id: "82500000-0000-4000-8000-000000000002",
      dishId: "82100000-0000-4000-8000-000000000002",
      anonymousMemberRef: "member_1",
      portionText: "年齢と食欲に合わせた量",
      branchBeforeRecipeStepId: "82300000-0000-4000-8000-000000000003",
      additionalCutting: "きゅうりを小さく切る",
      additionalHeating: null,
      additionalSeasoning: null,
      servingCheck: "きゅうりを小さく切ったことを確認する",
      safetyTags: ["cut_small"],
      safetyActions: [
        {
          kind: "cut_small",
          dishId: "82100000-0000-4000-8000-000000000002",
          ingredientId: "82200000-0000-4000-8000-000000000004",
          anonymousMemberRef: "member_1",
          beforeRecipeStepId: "82300000-0000-4000-8000-000000000003",
          instruction: "きゅうりを小さく切る",
        },
      ],
    },
    {
      id: "82500000-0000-4000-8000-000000000003",
      dishId: "82100000-0000-4000-8000-000000000003",
      anonymousMemberRef: "member_1",
      portionText: "年齢と食欲に合わせた量",
      branchBeforeRecipeStepId: "82300000-0000-4000-8000-000000000004",
      additionalCutting: "玉ねぎを小さく切る",
      additionalHeating: null,
      additionalSeasoning: null,
      servingCheck: "玉ねぎを小さく切ったことを確認する",
      safetyTags: ["cut_small"],
      safetyActions: [
        {
          kind: "cut_small",
          dishId: "82100000-0000-4000-8000-000000000003",
          ingredientId: "82200000-0000-4000-8000-000000000005",
          anonymousMemberRef: "member_1",
          beforeRecipeStepId: "82300000-0000-4000-8000-000000000004",
          instruction: "玉ねぎを小さく切る",
        },
      ],
    },
  ],
  pantryUsage: [],
  labelConfirmations: [],
} as const;

const reviewedFixtures = [breakfastFixture, lunchFixture, dinnerFixture] as const;

export const emergencyMenuFixturesV1: readonly ValidatedMenu[] = reviewedFixtures.map((fixture) =>
  validatedMenuSchema.parse(fixture),
);

if (new Set(emergencyMenuFixturesV1.map((menu) => menu.mealType)).size !== 3) {
  throw new Error("Emergency fixtures must cover breakfast, lunch, and dinner");
}

export const emergencyFixtureMetadataV1: Readonly<
  Record<
    string,
    {
      standardAllergenIds: readonly string[];
      eligibleAgeBands: readonly AgeBand[];
      safetyTags: readonly string[];
      reviewedAt: string;
    }
  >
> = {
  [breakfastFixture.menuId]: {
    standardAllergenIds: ["salmon"],
    eligibleAgeBands: allReviewedAgeBands,
    safetyTags: ["remove_bones", "cut_small", "soften"],
    reviewedAt: "2026-07-11",
  },
  [lunchFixture.menuId]: {
    standardAllergenIds: ["chicken"],
    eligibleAgeBands: allReviewedAgeBands,
    safetyTags: ["heat_thoroughly", "cut_small", "soften"],
    reviewedAt: "2026-07-11",
  },
  [dinnerFixture.menuId]: {
    standardAllergenIds: ["chicken"],
    eligibleAgeBands: allReviewedAgeBands,
    safetyTags: ["heat_thoroughly", "cut_small"],
    reviewedAt: "2026-07-11",
  },
};
