import { z } from "zod";
import { changeReasons, pantryPriorities } from "./domain.js";
import {
  dishIngredientSchema,
  dishSchema,
  generatedLabelConfirmationSchema,
  menuMemberAdaptationSchema,
  menuTimelineStepSchema,
  recipeStepSchema,
  safetyActionSchema,
} from "./generation.js";
import { pantryUsageStatuses } from "./pantry.js";

// UI / feature 側は generation の正本スキーマを再 export 経由で import する（二重定義しない）
export {
  regenerateDishRequestSchema,
  regenerateMenuRequestSchema,
  type RegenerateDishRequest,
  type RegenerateMenuRequest,
} from "./generation.js";

/**
 * request-local ref の総称。UUID はどの参照葉でも拒否する。
 * フィールドごとの schema はさらに prefix を固定する。
 */
const requestLocalRefSchema = z
  .string()
  .regex(/^(dish|ingredient|step|timeline|adaptation|pantry|label)_[1-9][0-9]*$/u);

const dishRefSchema = z.string().regex(/^dish_[1-9][0-9]*$/u);
const ingredientRefSchema = z.string().regex(/^ingredient_[1-9][0-9]*$/u);
const stepRefSchema = z.string().regex(/^step_[1-9][0-9]*$/u);
const timelineRefSchema = z.string().regex(/^timeline_[1-9][0-9]*$/u);
const adaptationRefSchema = z.string().regex(/^adaptation_[1-9][0-9]*$/u);
const pantryRefSchema = z.string().regex(/^pantry_[1-9][0-9]*$/u);
const labelRefSchema = z.string().regex(/^label_[1-9][0-9]*$/u);
const labelSourceRefSchema = z.union([
  dishRefSchema,
  ingredientRefSchema,
  stepRefSchema,
  timelineRefSchema,
  adaptationRefSchema,
]);

const localIngredientSchema = dishIngredientSchema
  .omit({ id: true, pantrySelectionId: true })
  .extend({
    ingredientRef: ingredientRefSchema,
    pantryRef: pantryRefSchema.nullable(),
  })
  .strict();

const localStepSchema = recipeStepSchema
  .omit({ id: true })
  .extend({
    stepRef: stepRefSchema,
  })
  .strict();

const localRefDishSchema = dishSchema
  .omit({ id: true, ingredients: true, steps: true })
  .extend({
    dishRef: dishRefSchema,
    ingredients: z.array(localIngredientSchema).min(1).max(50),
    steps: z.array(localStepSchema).min(1).max(30),
  })
  .strict();

const localRefTimelineStepSchema = menuTimelineStepSchema
  .omit({ id: true, dishId: true, recipeStepId: true })
  .extend({
    timelineRef: timelineRefSchema,
    dishRef: dishRefSchema.nullable(),
    stepRef: stepRefSchema.nullable(),
  })
  .strict();

const localSafetyActionSchema = safetyActionSchema
  .omit({ dishId: true, ingredientId: true, beforeRecipeStepId: true })
  .extend({
    dishRef: dishRefSchema,
    ingredientRef: ingredientRefSchema,
    beforeStepRef: stepRefSchema,
  })
  .strict();

const localRefAdaptationSchema = menuMemberAdaptationSchema
  .omit({ id: true, dishId: true, branchBeforeRecipeStepId: true, safetyActions: true })
  .extend({
    adaptationRef: adaptationRefSchema,
    dishRef: dishRefSchema,
    beforeStepRef: stepRefSchema,
    safetyActions: z.array(localSafetyActionSchema).max(20),
  })
  .strict();

/**
 * Plan 2 の pantryUsage 葉を request-local に置き換えた形。
 * pantryUsageSchema は superRefine 付きのため .omit できず、同一フィールド上限で再構成する。
 * persist が materialize 後に拒否する意味 refine（must_use+unused / used+空 dishRefs /
 * used+unusedReason）だけここで掛ける。不足量・単位は materialize が trusted から
 * 再計算するので AI 境界では見ない。dishRefs.max(5) は上げない。
 */
const localRefPantryUsageSchema = z
  .object({
    pantryRef: pantryRefSchema,
    pantryItemName: z.string().trim().min(1).max(80),
    priority: z.enum(pantryPriorities),
    usageStatus: z.enum(pantryUsageStatuses),
    plannedQuantity: z.number().positive().max(999_999).multipleOf(0.001).nullable(),
    inventoryQuantity: z.number().positive().max(999_999).multipleOf(0.001).nullable(),
    shortageQuantity: z.number().min(0).max(999_999).multipleOf(0.001).nullable(),
    unit: z.string().trim().min(1).max(24).nullable(),
    // persist dishIds.max(5) / 新規生成 AI dishRefs.max(5) と揃え、6〜10 で試行枠だけ焼かない
    dishRefs: z.array(dishRefSchema).max(5),
    unusedReason: z.string().trim().min(1).max(200).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.priority === "must_use" && value.usageStatus === "unused") {
      context.addIssue({
        code: "custom",
        path: ["usageStatus"],
        message: "必ず使う食材が未使用です",
      });
    }
    if (value.usageStatus === "used" && value.dishRefs.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["dishRefs"],
        message: "使用先の料理が必要です",
      });
    }
    if (value.usageStatus === "used" && value.unusedReason !== null) {
      context.addIssue({
        code: "custom",
        path: ["unusedReason"],
        message: "使用時に未使用理由は保存しません",
      });
    }
  });

const localRefGeneratedLabelSchema = generatedLabelConfirmationSchema
  .omit({ sourceId: true })
  .extend({
    labelRef: labelRefSchema,
    sourceRef: labelSourceRefSchema,
  })
  .strict();

/** 保持料理は localRefDish と同形。テキスト葉を欠落させない。 */
export const retainedDishPromptSchema = localRefDishSchema;

/**
 * prompt 除外シグネチャの契約上限。derivation 版数に天井は無いが、ここは上げない。
 * 超過分は load/buildMessages が capExcludedDishSignatures で畳む。
 */
export const excludedDishSignaturesMax = 200 as const;

/**
 * derivation 全体の flatMap は 200 を超え得る（版数天井なし × menuDishCountMax）。
 * schema 上限は上げず先頭 200 に畳み、ZodError → internal_error を避ける。
 * markSent 前なので attempt は焼かない。
 */
export function capExcludedDishSignatures(signatures: readonly string[]): readonly string[] {
  return signatures.length <= excludedDishSignaturesMax
    ? signatures
    : signatures.slice(0, excludedDishSignaturesMax);
}

export const wholeRegenerationPromptSchema = z
  .object({
    mode: z.literal("whole"),
    reason: z.enum(changeReasons),
    changeReasonCustom: z.string().trim().min(1).max(200).nullable(),
    excludedDishSignatures: z.array(z.string().min(1).max(2000)).max(excludedDishSignaturesMax),
  })
  .strict();

export const dishRegenerationPromptSchema = z
  .object({
    mode: z.literal("dish"),
    reason: z.enum(changeReasons),
    changeReasonCustom: z.string().trim().min(1).max(200).nullable(),
    replaceDishRef: dishRefSchema,
    sourceDishToReplace: retainedDishPromptSchema,
    retainedDishes: z.array(retainedDishPromptSchema).min(1).max(9),
    // generatedMenu / AI 生成 timeline.max(60) と揃え、既存 51〜60 件メニューを再生成できる
    sourceTimeline: z.array(localRefTimelineStepSchema).max(60),
    sourceAdaptations: z.array(localRefAdaptationSchema).max(100),
    sourcePantryUsage: z.array(localRefPantryUsageSchema).max(50),
    sourceLabelConfirmations: z.array(localRefGeneratedLabelSchema).max(200),
    excludedDishSignatures: z.array(z.string().min(1).max(2000)).max(excludedDishSignaturesMax),
  })
  .strict();

export const dishRegenerationAiOutputSchema = z
  .object({
    replacementDish: localRefDishSchema,
    // 生成側 timeline.max(60) と揃え、合法な 51〜60 ステップを再出力できる
    timeline: z.array(localRefTimelineStepSchema).min(1).max(60),
    adaptations: z.array(localRefAdaptationSchema).max(100),
    pantryUsage: z.array(localRefPantryUsageSchema).max(50),
    labelConfirmations: z.array(localRefGeneratedLabelSchema).max(200),
  })
  .strict()
  .superRefine((value, context) => {
    // persist totalElapsedMinutes.max(180)。葉の start/duration は各 180 まで合法なので
    // 合計 360 まで AI schema を通る。materialize が max(start+duration) をそのまま
    // persist に渡すと ZodError で試行枠だけ焼く。180 は上げず、ここで先に閉じる。
    for (const [index, step] of value.timeline.entries()) {
      if (step.startMinute + step.durationMinutes > 180) {
        context.addIssue({
          code: "custom",
          path: ["timeline", index],
          message: "全体時間を超えています",
        });
      }
    }
  });

export type RetainedDishPrompt = z.infer<typeof retainedDishPromptSchema>;
export type WholeRegenerationPrompt = z.infer<typeof wholeRegenerationPromptSchema>;
export type DishRegenerationPrompt = z.infer<typeof dishRegenerationPromptSchema>;
export type DishRegenerationAiOutput = z.infer<typeof dishRegenerationAiOutputSchema>;

export type LocalRefKind =
  "dish" | "ingredient" | "step" | "timeline" | "adaptation" | "pantry" | "label";

/**
 * プロンプト宣言側の request-local ref が一意であることを検証する。
 * UUID や member_ など許可外 prefix もここで落とす。
 */
export function assertUniqueLocalRefDeclarations(declarations: readonly string[]): void {
  const seen = new Set<string>();
  for (const ref of declarations) {
    const parsed = requestLocalRefSchema.safeParse(ref);
    if (!parsed.success) {
      throw new Error(`invalid local ref declaration: ${ref}`);
    }
    if (seen.has(ref)) {
      throw new Error(`duplicate local ref declaration: ${ref}`);
    }
    seen.add(ref);
  }
}

export type MaterializationReferencedRef = {
  expectedKind: LocalRefKind;
  ref: string;
};

export type MaterializationRefUnionInput = {
  /** サーバーが保持する retained 側の宣言 */
  serverKnownDeclarations: readonly string[];
  /** 置換料理側の宣言 */
  replacementDeclarations: readonly string[];
  /** タイムライン等からの参照（種別付き） */
  referencedRefs: readonly MaterializationReferencedRef[];
  /** ラベル sourceRef（dish/ingredient/step/timeline/adaptation のみ可） */
  labelSourceRefs: readonly string[];
};

/**
 * materialization 前に retained 宣言と replacement 宣言を合成し、
 * 衝突・ダングリング・種別不一致・不正な label source を UUID 割当前に拒否する。
 */
export function assertMaterializationRefUnion(input: MaterializationRefUnionInput): void {
  assertUniqueLocalRefDeclarations(input.serverKnownDeclarations);
  assertUniqueLocalRefDeclarations(input.replacementDeclarations);

  const serverSet = new Set(input.serverKnownDeclarations);
  for (const ref of input.replacementDeclarations) {
    if (serverSet.has(ref)) {
      throw new Error(`local ref collision: ${ref}`);
    }
  }

  const union = new Set([...input.serverKnownDeclarations, ...input.replacementDeclarations]);

  for (const { expectedKind, ref } of input.referencedRefs) {
    if (!ref.startsWith(`${expectedKind}_`)) {
      throw new Error(`wrong-kind local ref: expected ${expectedKind}, got ${ref}`);
    }
    if (!union.has(ref)) {
      throw new Error(`dangling local ref: ${ref}`);
    }
  }

  for (const ref of input.labelSourceRefs) {
    const allowed = labelSourceRefSchema.safeParse(ref);
    if (!allowed.success) {
      throw new Error(`label source outside allowed namespaces: ${ref}`);
    }
    if (!union.has(ref)) {
      throw new Error(`dangling label source ref: ${ref}`);
    }
  }
}
