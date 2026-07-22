import { z } from "zod";
import { aiGeneratedMenuPayloadSchema } from "./ai-generation-output.js";
import { cuisineGenres, generationStatuses, mealTypes, privacyNoticeVersion } from "./domain.js";
import { generatedPantryUsageSchema, pantryUsageSchema } from "./pantry.js";

export const dishRoles = ["main", "side", "soup", "staple", "other"] as const;
export const storeSections = [
  "produce",
  "meat_fish",
  "dairy_eggs",
  "dry_goods",
  "seasonings",
  "other",
] as const;
export const labelSourceTypes = [
  "dish",
  "ingredient",
  "recipe_step",
  "adaptation",
  "timeline",
] as const;
const safetyTagSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);

function boundedCanonicalText(min: number, max: number) {
  return z
    .string()
    .trim()
    .refine(
      (value) => {
        const length = Array.from(value).length;
        return length >= min && length <= max;
      },
      { message: `${String(min)}〜${String(max)}文字で入力してください` },
    );
}

export const safetyActionKinds = [
  "remove_bones",
  "cut_small",
  "quarter_round_food",
  "soften",
  "heat_thoroughly",
] as const;
export const safetyActionSchema = z
  .object({
    kind: z.enum(safetyActionKinds),
    dishId: z.uuid(),
    ingredientId: z.uuid(),
    anonymousMemberRef: z.string().regex(/^member_[1-9][0-9]*$/),
    beforeRecipeStepId: z.uuid(),
    instruction: z.string().trim().min(1).max(300),
  })
  .strict();

export const dishIngredientSchema = z
  .object({
    id: z.uuid(),
    position: z.number().int().positive(),
    name: z.string().trim().min(1).max(100),
    quantityValue: z.number().positive().nullable(),
    quantityText: z.string().trim().min(1).max(60),
    unit: z.string().trim().min(1).max(24).nullable(),
    storeSection: z.enum(storeSections),
    pantrySelectionId: z.uuid().nullable(),
    labelConfirmationRequired: z.boolean(),
  })
  .strict();

export const recipeStepSchema = z
  .object({
    id: z.uuid(),
    position: z.number().int().positive(),
    instruction: z.string().trim().min(1).max(500),
  })
  .strict();

export const dishSchema = z
  .object({
    id: z.uuid(),
    role: z.enum(dishRoles),
    position: z.number().int().positive(),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(300),
    cookingTimeMinutes: z.number().int().positive().max(180),
    ingredients: z.array(dishIngredientSchema).min(1).max(50),
    steps: z.array(recipeStepSchema).min(1).max(30),
  })
  .strict();

export const menuTimelineStepSchema = z
  .object({
    id: z.uuid(),
    position: z.number().int().positive(),
    startMinute: z.number().int().nonnegative(),
    durationMinutes: z.number().int().positive(),
    instruction: z.string().trim().min(1).max(500),
    dishId: z.uuid().nullable(),
    recipeStepId: z.uuid().nullable(),
  })
  .strict();

export const menuMemberAdaptationSchema = z
  .object({
    id: z.uuid(),
    dishId: z.uuid(),
    anonymousMemberRef: z.string().regex(/^member_[1-9][0-9]*$/),
    portionText: z.string().trim().min(1).max(80),
    branchBeforeRecipeStepId: z.uuid(),
    additionalCutting: z.string().trim().min(1).max(300).nullable(),
    additionalHeating: z.string().trim().min(1).max(300).nullable(),
    additionalSeasoning: z.string().trim().min(1).max(300).nullable(),
    servingCheck: z.string().trim().min(1).max(300),
    safetyTags: z.array(safetyTagSchema),
    safetyActions: z.array(safetyActionSchema).max(20).default([]),
  })
  .strict();

const labelConfirmationBase = {
  sourceType: z.enum(labelSourceTypes),
  sourceId: z.uuid(),
  sourcePath: z.string().trim().min(1).max(200),
  sourceText: boundedCanonicalText(1, 500),
  allergenId: z.string().regex(/^[a-z][a-z0-9_]*$/),
  anonymousMemberRef: z.string().regex(/^member_[1-9][0-9]*$/),
  dictionaryVersion: z.string().trim().min(1).max(80),
};

export const generatedLabelConfirmationSchema = z
  .object({
    ...labelConfirmationBase,
    confirmationStatus: z.literal("pending"),
  })
  .strict();

export const menuLabelConfirmationSchema = z.discriminatedUnion("confirmationStatus", [
  z
    .object({
      ...labelConfirmationBase,
      confirmationStatus: z.literal("pending"),
      confirmedAt: z.null(),
      confirmedBy: z.null(),
    })
    .strict(),
  z
    .object({
      ...labelConfirmationBase,
      confirmationStatus: z.literal("confirmed"),
      confirmedAt: z.iso.datetime({ offset: true }),
      confirmedBy: z.uuid(),
    })
    .strict(),
]);

const generatedMenuObjectSchema = z
  .object({
    schemaVersion: z.literal("2026-07-11.v1"),
    menuId: z.uuid(),
    mealType: z.enum(mealTypes),
    cuisineGenre: z.enum(cuisineGenres),
    servings: z.number().int().min(1).max(20),
    totalElapsedMinutes: z.number().int().min(1).max(180),
    safetyTags: z.array(safetyTagSchema),
    dishes: z.array(dishSchema).min(1).max(5),
    timeline: z.array(menuTimelineStepSchema).min(1).max(60),
    adaptations: z.array(menuMemberAdaptationSchema).max(100),
    pantryUsage: z.array(generatedPantryUsageSchema).max(50),
    labelConfirmations: z.array(generatedLabelConfirmationSchema).max(200),
  })
  .strict();

type MenuReferenceInput = Omit<z.infer<typeof generatedMenuObjectSchema>, "labelConfirmations"> & {
  labelConfirmations: readonly Pick<
    z.infer<typeof generatedLabelConfirmationSchema>,
    "sourceType" | "sourceId" | "sourcePath" | "sourceText"
  >[];
};

function validateMenuReferences(menu: MenuReferenceInput, context: z.RefinementCtx): void {
  const requireUniqueIds = (
    entries: readonly { id: string; path: (string | number)[] }[],
    message: string,
  ) => {
    const seenIds = new Set<string>();
    for (const entry of entries) {
      if (seenIds.has(entry.id)) {
        context.addIssue({
          code: "custom",
          path: entry.path,
          message,
        });
      }
      seenIds.add(entry.id);
    }
  };
  requireUniqueIds(
    menu.dishes.map((dish, dishIndex) => ({
      id: dish.id,
      path: ["dishes", dishIndex, "id"],
    })),
    "料理IDが重複しています",
  );
  requireUniqueIds(
    menu.dishes.flatMap((dish, dishIndex) =>
      dish.ingredients.map((ingredient, ingredientIndex) => ({
        id: ingredient.id,
        path: ["dishes", dishIndex, "ingredients", ingredientIndex, "id"],
      })),
    ),
    "食材IDが重複しています",
  );
  requireUniqueIds(
    menu.dishes.flatMap((dish, dishIndex) =>
      dish.steps.map((step, stepIndex) => ({
        id: step.id,
        path: ["dishes", dishIndex, "steps", stepIndex, "id"],
      })),
    ),
    "工程IDが重複しています",
  );
  requireUniqueIds(
    menu.timeline.map((timeline, timelineIndex) => ({
      id: timeline.id,
      path: ["timeline", timelineIndex, "id"],
    })),
    "タイムラインIDが重複しています",
  );
  requireUniqueIds(
    menu.adaptations.map((adaptation, adaptationIndex) => ({
      id: adaptation.id,
      path: ["adaptations", adaptationIndex, "id"],
    })),
    "取り分けIDが重複しています",
  );
  requireUniqueIds(
    menu.pantryUsage.map((usage, usageIndex) => ({
      id: usage.selectionId,
      path: ["pantryUsage", usageIndex, "selectionId"],
    })),
    "在庫選択IDが重複しています",
  );

  const pantrySelectionIds = new Set(menu.pantryUsage.map((usage) => usage.selectionId));
  for (const [dishIndex, dish] of menu.dishes.entries()) {
    for (const [ingredientIndex, ingredient] of dish.ingredients.entries()) {
      if (
        ingredient.pantrySelectionId !== null &&
        !pantrySelectionIds.has(ingredient.pantrySelectionId)
      ) {
        context.addIssue({
          code: "custom",
          path: ["dishes", dishIndex, "ingredients", ingredientIndex, "pantrySelectionId"],
          message: "在庫選択の参照が不正です",
        });
      }
    }
  }

  const expectedDishCount = menu.mealType === "dinner" ? 3 : 2;
  if (menu.dishes.length !== expectedDishCount) {
    context.addIssue({
      code: "custom",
      path: ["dishes"],
      message: "食事区分の品数と一致しません",
    });
  }

  const dishIds = new Set(menu.dishes.map((dish) => dish.id));
  const stepOwner = new Map(
    menu.dishes.flatMap((dish) => dish.steps.map((step) => [step.id, dish.id] as const)),
  );
  for (const [index, timeline] of menu.timeline.entries()) {
    if (timeline.startMinute + timeline.durationMinutes > menu.totalElapsedMinutes) {
      context.addIssue({
        code: "custom",
        path: ["timeline", index],
        message: "全体時間を超えています",
      });
    }
    if (timeline.dishId !== null && !dishIds.has(timeline.dishId)) {
      context.addIssue({
        code: "custom",
        path: ["timeline", index, "dishId"],
        message: "料理参照が不正です",
      });
    }
    if (timeline.recipeStepId !== null && !stepOwner.has(timeline.recipeStepId)) {
      context.addIssue({
        code: "custom",
        path: ["timeline", index, "recipeStepId"],
        message: "工程参照が不正です",
      });
    }
    if (
      timeline.dishId !== null &&
      timeline.recipeStepId !== null &&
      stepOwner.get(timeline.recipeStepId) !== timeline.dishId
    ) {
      context.addIssue({
        code: "custom",
        path: ["timeline", index],
        message: "料理と工程の参照が一致しません",
      });
    }
  }

  const ingredientOwner = new Map(
    menu.dishes.flatMap((dish) =>
      dish.ingredients.map((ingredient) => [ingredient.id, dish.id] as const),
    ),
  );
  for (const [index, adaptation] of menu.adaptations.entries()) {
    if (stepOwner.get(adaptation.branchBeforeRecipeStepId) !== adaptation.dishId) {
      context.addIssue({
        code: "custom",
        path: ["adaptations", index, "branchBeforeRecipeStepId"],
        message: "取り分け分岐工程が対象料理に属していません",
      });
    }
    for (const [actionIndex, action] of adaptation.safetyActions.entries()) {
      if (
        action.dishId !== adaptation.dishId ||
        action.anonymousMemberRef !== adaptation.anonymousMemberRef ||
        ingredientOwner.get(action.ingredientId) !== adaptation.dishId ||
        stepOwner.get(action.beforeRecipeStepId) !== adaptation.dishId
      ) {
        context.addIssue({
          code: "custom",
          path: ["adaptations", index, "safetyActions", actionIndex],
          message: "安全工程の料理・食材・家族・事前工程参照が一致しません",
        });
      }
    }
  }

  const labelSources = new Map<string, Map<string, string>>();
  const addLabelSource = (sourceType: string, sourceId: string, path: string, text: string) => {
    const key = `${sourceType}:${sourceId}`;
    const paths = labelSources.get(key) ?? new Map<string, string>();
    paths.set(path, text);
    labelSources.set(key, paths);
  };
  for (const [dishIndex, dish] of menu.dishes.entries()) {
    addLabelSource("dish", dish.id, `dishes.${String(dishIndex)}.name`, dish.name);
    addLabelSource("dish", dish.id, `dishes.${String(dishIndex)}.description`, dish.description);
    for (const [ingredientIndex, ingredient] of dish.ingredients.entries()) {
      const path = `dishes.${String(dishIndex)}.ingredients.${String(ingredientIndex)}`;
      addLabelSource("ingredient", ingredient.id, `${path}.name`, ingredient.name);
      addLabelSource("ingredient", ingredient.id, `${path}.quantityText`, ingredient.quantityText);
      if (ingredient.unit !== null) {
        addLabelSource("ingredient", ingredient.id, `${path}.unit`, ingredient.unit);
      }
    }
    for (const [stepIndex, step] of dish.steps.entries()) {
      addLabelSource(
        "recipe_step",
        step.id,
        `dishes.${String(dishIndex)}.steps.${String(stepIndex)}.instruction`,
        step.instruction,
      );
    }
  }
  for (const [adaptationIndex, adaptation] of menu.adaptations.entries()) {
    const path = `adaptations.${String(adaptationIndex)}`;
    addLabelSource("adaptation", adaptation.id, `${path}.portionText`, adaptation.portionText);
    if (adaptation.additionalCutting !== null) {
      addLabelSource(
        "adaptation",
        adaptation.id,
        `${path}.additionalCutting`,
        adaptation.additionalCutting,
      );
    }
    if (adaptation.additionalHeating !== null) {
      addLabelSource(
        "adaptation",
        adaptation.id,
        `${path}.additionalHeating`,
        adaptation.additionalHeating,
      );
    }
    if (adaptation.additionalSeasoning !== null) {
      addLabelSource(
        "adaptation",
        adaptation.id,
        `${path}.additionalSeasoning`,
        adaptation.additionalSeasoning,
      );
    }
    addLabelSource("adaptation", adaptation.id, `${path}.servingCheck`, adaptation.servingCheck);
    for (const [actionIndex, action] of adaptation.safetyActions.entries()) {
      addLabelSource(
        "adaptation",
        adaptation.id,
        `${path}.safetyActions.${String(actionIndex)}.instruction`,
        action.instruction,
      );
    }
  }
  for (const [timelineIndex, timeline] of menu.timeline.entries()) {
    addLabelSource(
      "timeline",
      timeline.id,
      `timeline.${String(timelineIndex)}.instruction`,
      timeline.instruction,
    );
  }
  for (const [index, confirmation] of menu.labelConfirmations.entries()) {
    const source = labelSources.get(`${confirmation.sourceType}:${confirmation.sourceId}`);
    if (source === undefined) {
      context.addIssue({
        code: "custom",
        path: ["labelConfirmations", index, "sourceId"],
        message: "確認元が不正です",
      });
      continue;
    }
    if (!source.has(confirmation.sourcePath)) {
      context.addIssue({
        code: "custom",
        path: ["labelConfirmations", index, "sourcePath"],
        message: "確認元のパスが不正です",
      });
    }
  }

  for (const [usageIndex, usage] of menu.pantryUsage.entries()) {
    for (const [dishIdIndex, dishId] of usage.dishIds.entries()) {
      if (!dishIds.has(dishId)) {
        context.addIssue({
          code: "custom",
          path: ["pantryUsage", usageIndex, "dishIds", dishIdIndex],
          message: "使用先の料理参照が不正です",
        });
      }
    }
  }
}

export const generatedMenuSchema = generatedMenuObjectSchema.superRefine(validateMenuReferences);

export const validatedMenuSchema = generatedMenuObjectSchema
  .extend({
    pantryUsage: z.array(pantryUsageSchema).max(50),
    labelConfirmations: z.array(menuLabelConfirmationSchema).max(200),
  })
  .superRefine(validateMenuReferences)
  .superRefine((menu, context) => {
    const sourceTextByPath = new Map<string, string>();
    menu.dishes.forEach((dish, dishIndex) => {
      const dishBase = `dishes.${String(dishIndex)}`;
      sourceTextByPath.set(`${dishBase}.name`, dish.name);
      sourceTextByPath.set(`${dishBase}.description`, dish.description);
      dish.ingredients.forEach((ingredient, ingredientIndex) => {
        const base = `${dishBase}.ingredients.${String(ingredientIndex)}`;
        sourceTextByPath.set(`${base}.name`, ingredient.name);
        sourceTextByPath.set(`${base}.quantityText`, ingredient.quantityText);
        if (ingredient.unit !== null) sourceTextByPath.set(`${base}.unit`, ingredient.unit);
      });
      dish.steps.forEach((step, stepIndex) => {
        sourceTextByPath.set(
          `${dishBase}.steps.${String(stepIndex)}.instruction`,
          step.instruction,
        );
      });
    });
    menu.timeline.forEach((step, index) => {
      sourceTextByPath.set(`timeline.${String(index)}.instruction`, step.instruction);
    });
    menu.adaptations.forEach((adaptation, index) => {
      const base = `adaptations.${String(index)}`;
      sourceTextByPath.set(`${base}.portionText`, adaptation.portionText);
      if (adaptation.additionalCutting !== null) {
        sourceTextByPath.set(`${base}.additionalCutting`, adaptation.additionalCutting);
      }
      if (adaptation.additionalHeating !== null) {
        sourceTextByPath.set(`${base}.additionalHeating`, adaptation.additionalHeating);
      }
      if (adaptation.additionalSeasoning !== null) {
        sourceTextByPath.set(`${base}.additionalSeasoning`, adaptation.additionalSeasoning);
      }
      sourceTextByPath.set(`${base}.servingCheck`, adaptation.servingCheck);
      adaptation.safetyActions.forEach((action, actionIndex) => {
        sourceTextByPath.set(
          `${base}.safetyActions.${String(actionIndex)}.instruction`,
          action.instruction,
        );
      });
    });
    menu.labelConfirmations.forEach((confirmation, index) => {
      if (sourceTextByPath.get(confirmation.sourcePath) !== confirmation.sourceText) {
        context.addIssue({
          code: "custom",
          path: ["labelConfirmations", index, "sourceText"],
          message: "確認元の本文と一致しません",
        });
      }
    });
  });

export type DishIngredient = z.infer<typeof dishIngredientSchema>;
export type RecipeStep = z.infer<typeof recipeStepSchema>;
export type Dish = z.infer<typeof dishSchema>;
export type MenuTimelineStep = z.infer<typeof menuTimelineStepSchema>;
export type MenuMemberAdaptation = z.infer<typeof menuMemberAdaptationSchema>;
export type SafetyAction = z.infer<typeof safetyActionSchema>;
export type GeneratedLabelConfirmation = z.infer<typeof generatedLabelConfirmationSchema>;
export type MenuLabelConfirmation = z.infer<typeof menuLabelConfirmationSchema>;
export type ValidatedMenu = z.infer<typeof validatedMenuSchema>;
export type GeneratedMenu = z.infer<typeof generatedMenuSchema>;
export type MenuValidationIssue = { code: string; path: string; message: string };
export type MenuValidationResult =
  | {
      ok: true;
      menu: ValidatedMenu;
      labelConfirmations: readonly MenuLabelConfirmation[];
      safetyFingerprint: string;
    }
  | { ok: false; issues: readonly MenuValidationIssue[] };

const uuidSchema = z.uuid();
const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const releaseQuota = {
  userDailySuccessLimit: 5,
  userDailyExternalCallLimit: 12,
  userShortWindowExternalCallLimit: 4,
  userShortWindowSeconds: 600,
} as const;

export const generationFailureCodes = [
  "consent_required",
  "draft_not_found",
  "invalid_request",
  "generation_in_progress",
  "user_daily_limit",
  "user_attempt_limit",
  "user_short_window_limit",
  "global_daily_limit",
  "allergy_unconfirmed",
  "allergen_missing",
  "unmapped_custom_allergy",
  "unsupported_diet_unconfirmed",
  "regeneration_not_implemented",
  "unsupported_diet",
  "allergy_conflict",
  "expired_pantry_unconfirmed",
  "model_unavailable",
  "invalid_ai_response",
  "generation_timeout",
  "internal_error",
  // Plan 4 再生成・重複・現行安全条件向けの閉じた失敗コード
  "duplicate_output",
  "idempotency_payload_mismatch",
  "current_safety_revalidation_required",
  "current_target_member_required",
  "source_menu_not_found",
  "replace_dish_not_found",
  // Plan 7: 予約時に凍結した元献立 version と live source の不一致
  "source_menu_changed",
] as const;
export type GenerationFailureCode = (typeof generationFailureCodes)[number];

export const generationConflictCodes = [
  "must_use_conflict",
  "allergen_pantry_conflict",
  "dish_count_conflict",
  "mandatory_safety_conflict",
  "current_safety_changed",
] as const;
export type GenerationConflictCode = (typeof generationConflictCodes)[number];

export const generationConflictCopy = {
  must_use_conflict: "必須食材と安全条件を同時に満たせません。",
  allergen_pantry_conflict: "アレルギー条件と選択した食材を同時に満たせません。",
  dish_count_conflict: "指定した品数と条件を同時に満たせません。",
  mandatory_safety_conflict: "必須の安全条件を満たす献立を作成できません。",
  current_safety_changed: "安全条件が更新されました。もう一度作成してください。",
} as const satisfies Record<GenerationConflictCode, string>;

export const quotaLimitKinds = ["user", "global", "provider"] as const;
export type QuotaLimitKind = (typeof quotaLimitKinds)[number];

export const expiredPantryConfirmationSchema = z
  .object({
    pantryItemId: uuidSchema,
    checkedAt: isoDateTimeSchema,
  })
  .strict();
export type ExpiredPantryConfirmation = z.infer<typeof expiredPantryConfirmationSchema>;

export const newMenuGenerationRequestSchema = z
  .object({
    idempotencyKey: uuidSchema,
    draftId: uuidSchema,
    draftRevision: z.number().int().positive(),
    privacyNoticeVersion: z.literal(privacyNoticeVersion),
    expiredPantryConfirmations: z.array(expiredPantryConfirmationSchema).max(50),
  })
  .strict();
export type NewMenuGenerationRequest = z.infer<typeof newMenuGenerationRequestSchema>;

const regenerationBase = {
  idempotencyKey: uuidSchema,
  sourceMenuId: uuidSchema,
  changeReason: z.enum([
    "simpler",
    "different_ingredient",
    "child_friendly",
    "different_flavor",
    "custom",
  ]),
  changeReasonCustom: z.string().trim().min(1).max(200).nullable(),
  expiredPantryConfirmations: z.array(expiredPantryConfirmationSchema).max(50),
};

const refineRegenerationRequest = (
  value: {
    changeReason: string;
    changeReasonCustom: string | null;
    expiredPantryConfirmations: readonly ExpiredPantryConfirmation[];
  },
  context: z.RefinementCtx,
) => {
  if ((value.changeReason === "custom") !== (value.changeReasonCustom !== null)) {
    context.addIssue({
      code: "custom",
      path: ["changeReasonCustom"],
      message: "custom reason mismatch",
    });
  }
  const ids = value.expiredPantryConfirmations.map((item) => item.pantryItemId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: "custom",
      path: ["expiredPantryConfirmations"],
      message: "duplicate pantry checks",
    });
  }
};

export const regenerateMenuRequestSchema = z
  .object(regenerationBase)
  .strict()
  .superRefine(refineRegenerationRequest);
export const regenerateDishRequestSchema = z
  .object({ ...regenerationBase, dishId: uuidSchema })
  .strict()
  .superRefine(refineRegenerationRequest);

/** 生成コマンド wire / pending / HMAC の唯一の版。v1 は未デプロイのため削除済み。 */
export const generationCommandVersionV2 = "generation-command.v2" as const;

export const generationCommandV2Schema = z.discriminatedUnion("kind", [
  z
    .object({
      commandVersion: z.literal(generationCommandVersionV2),
      kind: z.literal("new_menu"),
      request: newMenuGenerationRequestSchema,
    })
    .strict(),
  z
    .object({
      commandVersion: z.literal(generationCommandVersionV2),
      kind: z.literal("regenerate_menu"),
      request: regenerateMenuRequestSchema,
    })
    .strict(),
  z
    .object({
      commandVersion: z.literal(generationCommandVersionV2),
      kind: z.literal("regenerate_dish"),
      request: regenerateDishRequestSchema,
    })
    .strict(),
]);

/** 後方互換の別名。実体は v2 のみ。 */
export const generationCommandSchema = generationCommandV2Schema;

export type RegenerateMenuRequest = z.infer<typeof regenerateMenuRequestSchema>;
export type RegenerateDishRequest = z.infer<typeof regenerateDishRequestSchema>;
export type GenerationCommandV2 = z.infer<typeof generationCommandV2Schema>;
export type GenerationCommand = GenerationCommandV2;

/**
 * サーバー権威の整合性コンテキスト。クライアントから mode/servings/memberIds/source version を受け取らない。
 * kind × targetMode の判別可能 union で household 空 / idea 非空を型で禁止する。
 */
export type GenerationIntegrityContextV2 =
  | {
      kind: "new_menu";
      targetMode: "household";
      servings: null;
      targetMemberIds: readonly [string, ...string[]];
      sourceMenuVersion: null;
    }
  | {
      kind: "new_menu";
      targetMode: "idea";
      servings: number;
      targetMemberIds: readonly [];
      sourceMenuVersion: null;
    }
  | {
      kind: "regenerate_menu" | "regenerate_dish";
      targetMode: "household";
      servings: number;
      targetMemberIds: readonly [string, ...string[]];
      sourceMenuVersion: number;
    }
  | {
      kind: "regenerate_menu" | "regenerate_dish";
      targetMode: "idea";
      servings: number;
      targetMemberIds: readonly [];
      sourceMenuVersion: number;
    };

export type GenerationRequestLookup =
  | { kind: "miss" }
  | {
      kind: "hit";
      requestId: string;
      requestHmacVersion: "generation-command.v2";
      integrity: GenerationIntegrityContextV2;
    };

export const generationQuotaSchema = z
  .object({
    consumed: z.boolean(),
    remaining: z.number().int().min(0).max(releaseQuota.userDailySuccessLimit),
    userDailyLimit: z.literal(releaseQuota.userDailySuccessLimit),
    limitKind: z.enum(quotaLimitKinds).nullable(),
    retryAt: isoDateTimeSchema.nullable(),
  })
  .strict();
export type GenerationQuota = z.infer<typeof generationQuotaSchema>;

export const generationConflictSchema = z
  .object({
    code: z.enum(generationConflictCodes),
    message: z.string().min(1).max(200),
    conditionRefs: z.array(z.string().min(1).max(80)).max(24),
  })
  .strict();

const statusBase = {
  idempotencyKey: uuidSchema,
  quota: generationQuotaSchema,
} as const;

export const generationStatusDataSchema = z.discriminatedUnion("status", [
  z.object({ ...statusBase, status: z.literal(generationStatuses[0]) }).strict(),
  z
    .object({
      ...statusBase,
      status: z.literal(generationStatuses[1]),
      requestId: uuidSchema,
      startedAt: isoDateTimeSchema,
    })
    .strict(),
  z
    .object({
      ...statusBase,
      status: z.literal(generationStatuses[2]),
      requestId: uuidSchema,
      menuId: uuidSchema,
      completedAt: isoDateTimeSchema,
    })
    .strict(),
  z
    .object({
      ...statusBase,
      status: z.literal(generationStatuses[3]),
      requestId: uuidSchema,
      error: z
        .object({
          code: z.enum(generationFailureCodes),
          message: z.string().min(1).max(200),
          retryable: z.boolean(),
        })
        .strict(),
      completedAt: isoDateTimeSchema,
    })
    .strict(),
  z
    .object({
      ...statusBase,
      status: z.literal(generationStatuses[4]),
      requestId: uuidSchema,
      conflicts: z.array(generationConflictSchema).min(1).max(12),
      completedAt: isoDateTimeSchema,
    })
    .strict(),
]);
export type GenerationStatusData = z.infer<typeof generationStatusDataSchema>;

export const usageTodayDataSchema = z
  .object({
    success: z
      .object({
        consumed: z.number().int().min(0).max(releaseQuota.userDailySuccessLimit),
        limit: z.literal(releaseQuota.userDailySuccessLimit),
        remaining: z.number().int().min(0).max(releaseQuota.userDailySuccessLimit),
      })
      .strict(),
    attempts: z
      .object({
        sent: z.number().int().min(0).max(releaseQuota.userDailyExternalCallLimit),
        limit: z.literal(releaseQuota.userDailyExternalCallLimit),
        remaining: z.number().int().min(0).max(releaseQuota.userDailyExternalCallLimit),
      })
      .strict(),
    shortWindow: z
      .object({
        sent: z.number().int().min(0).max(releaseQuota.userShortWindowExternalCallLimit),
        limit: z.literal(releaseQuota.userShortWindowExternalCallLimit),
        remaining: z.number().int().min(0).max(releaseQuota.userShortWindowExternalCallLimit),
        retryAt: isoDateTimeSchema.nullable(),
      })
      .strict(),
    globalAvailable: z.boolean(),
    retryAt: isoDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((data, context) => {
    if (data.success.consumed + data.success.remaining !== data.success.limit) {
      context.addIssue({
        code: "custom",
        path: ["success", "remaining"],
        message: "success counts must balance",
      });
    }
    if (data.attempts.sent + data.attempts.remaining !== data.attempts.limit) {
      context.addIssue({
        code: "custom",
        path: ["attempts", "remaining"],
        message: "attempt counts must balance",
      });
    }
    if (data.shortWindow.sent + data.shortWindow.remaining !== data.shortWindow.limit) {
      context.addIssue({
        code: "custom",
        path: ["shortWindow", "remaining"],
        message: "window counts must balance",
      });
    }
    const blocked =
      data.success.remaining === 0 ||
      data.attempts.remaining === 0 ||
      data.shortWindow.remaining === 0 ||
      !data.globalAvailable;
    if ((data.retryAt !== null) !== blocked) {
      context.addIssue({
        code: "custom",
        path: ["retryAt"],
        message: "retryAt must identify an active blocker",
      });
    }
    if ((data.shortWindow.retryAt !== null) !== (data.shortWindow.remaining === 0)) {
      context.addIssue({
        code: "custom",
        path: ["shortWindow", "retryAt"],
        message: "shortWindow.retryAt is present only while its limit is exhausted",
      });
    }
    const onlyShortWindowBlocked =
      data.success.remaining > 0 &&
      data.attempts.remaining > 0 &&
      data.shortWindow.remaining === 0 &&
      data.globalAvailable;
    if (onlyShortWindowBlocked && data.retryAt !== data.shortWindow.retryAt) {
      context.addIssue({
        code: "custom",
        path: ["retryAt"],
        message: "top-level retryAt must equal the sole short-window blocker",
      });
    }
  });
export type UsageTodayData = z.infer<typeof usageTodayDataSchema>;

/** 生成失敗・衝突・quota を含む閉じた issue コード集合 */
export const generationIssueCodes = [
  ...generationFailureCodes,
  ...generationConflictCodes,
] as const;
export type GenerationIssueCode = (typeof generationIssueCodes)[number];

/** 非衝突コードの日本語。衝突5件は generationConflictCopy を import して共有する。 */
const nonConflictIssueMessages = {
  consent_required: "AIへ送る情報の説明を確認してください。",
  draft_not_found: "保存した献立条件が見つかりませんでした。",
  invalid_request: "献立条件を確認してください。",
  generation_in_progress: "別の献立を作成中です。",
  user_daily_limit: "今日は5回利用しました。明日0:00（日本時間）から利用できます",
  user_attempt_limit: "本日のAI通信試行上限に達しました。明日0:00（日本時間）から利用できます",
  user_short_window_limit: "10分間の通信試行上限に達しました。しばらくしてから再度お試しください",
  global_daily_limit:
    "本日分のAI受付がいっぱいです。成功回数には含まれません。明日0:00から再開します",
  allergy_unconfirmed: "アレルギー確認が必要な項目があります。確認してからもう一度お試しください。",
  allergen_missing: "アレルギー情報の登録が必要です。家族の設定を確認してください。",
  unmapped_custom_allergy:
    "登録されたアレルギー内容を確認できませんでした。家族の設定を確認してください。",
  unsupported_diet_unconfirmed: "離乳食・飲み込み/嚥下・治療食の確認が必要です。",
  regeneration_not_implemented: "再生成は次の計画で有効になります。",
  unsupported_diet: "離乳食、飲み込み・嚥下、治療食の依頼には対応できません。",
  allergy_conflict: "アレルギー食材が、使いたい食材に含まれています",
  expired_pantry_unconfirmed: "期限を過ぎた食材は、今回の実物確認が必要です。",
  model_unavailable: "AIが混み合っています。成功回数には含まれません。",
  invalid_ai_response: "献立を正しく確認できませんでした。成功回数には含まれません。",
  generation_timeout: "作成に時間がかかりました。成功回数には含まれません。",
  internal_error: "献立を作成できませんでした。成功回数には含まれません。",
  duplicate_output: "元の献立とほぼ同じ案だったため保存しませんでした。今回は回数に含まれません",
  idempotency_payload_mismatch: "前回と異なる内容で再送できません。もう一度操作してください",
  current_safety_revalidation_required: "現在の家族設定ではこの献立を利用できません",
  current_target_member_required: "現在の家族を1人以上選んでください",
  source_menu_not_found: "元の献立が見つかりません",
  replace_dish_not_found: "変更する料理が見つかりません",
  source_menu_changed: "元の献立が更新されたため、もう一度操作してください",
} as const satisfies Record<GenerationFailureCode, string>;

export const issueMessages = {
  ...nonConflictIssueMessages,
  ...generationConflictCopy,
} as const satisfies Record<GenerationIssueCode, string>;

export const aiGenerationResponseSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("success"),
      menu: aiGeneratedMenuPayloadSchema,
    })
    .strict(),
  z
    .object({
      outcome: z.literal("constraint_conflict"),
      conflicts: z.array(generationConflictSchema).min(1).max(12),
    })
    .strict(),
]);
export type AiGenerationResponse = z.infer<typeof aiGenerationResponseSchema>;

const aiGenerationJsonSchema = z.toJSONSchema(aiGenerationResponseSchema, {
  target: "draft-2020-12",
});

export const menuResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "kondate_menu_generation",
    strict: true,
    schema: aiGenerationJsonSchema,
  },
} as const;
