import { z } from "zod";
import { cuisineGenres, mealTypes } from "./domain.js";
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
