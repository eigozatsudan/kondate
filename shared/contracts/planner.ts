import { z } from "zod";
import { cuisineGenres, mealTypes } from "./domain.js";
import { pantrySelectionDraftSchema } from "./pantry.js";

export const plannerTimeLimits = [15, 30, 45] as const;
export const budgetPreferences = ["economy", "standard"] as const;
/**
 * 材料の使い方（量・範囲）。確認画面の任意条件。
 * more=多め / less=少な目 / selected_only=メイン食材と冷蔵庫から使う食材のみ /
 * auto=おまかせ。null は未指定（モデル側の既定判断）。
 */
export const ingredientPreferences = ["more", "less", "selected_only", "auto"] as const;
/**
 * 献立のひねり。standard=いつもの / twist=ひねりたい。
 * null は未指定で、挙動は standard と同一（プロンプト段落なし）。
 * null を残すのは導入前 snapshot の互換読み込みのためだけ。
 */
export const noveltyPreferences = ["standard", "twist"] as const;
export const targetModes = ["household", "idea"] as const;
export type TargetMode = (typeof targetModes)[number];

/**
 * 1 世帯あたりの「作る相手」家族人数上限。
 * UI の checkbox disable・hydrate sanitize・draft/submission schema で単一点定義する（P9）。
 */
export const PLANNER_TARGET_MEMBER_LIMIT = 20;

/**
 * 献立下書きの件数・文字上限。
 * schema の .max と UI ガードで単一点定義し、magic number の二重管理を避ける（adversarial P11）。
 */
export const PLANNER_MAIN_INGREDIENT_LIMIT = 8;
export const PLANNER_AVOID_INGREDIENT_LIMIT = 20;
export const PLANNER_PANTRY_SELECTION_LIMIT = 50;
/** メイン/避ける食材 1 件あたりの code point 上限（boundedCanonicalText と UI で共有）。 */
export const PLANNER_INGREDIENT_TEXT_MAX = 80;
/** メモ欄の code point 上限。 */
export const PLANNER_MEMO_TEXT_MAX = 200;

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

export const targetModeSchema = z.enum(targetModes);

/**
 * 家族/人数の整合を強制する。household は家族1〜PLANNER_TARGET_MEMBER_LIMIT 人・人数指定なし、
 * idea は家族0人・人数1〜PLANNER_TARGET_MEMBER_LIMIT、未選択は両方とも空のままにする。
 * ブラウザ・サーバーいずれの層でも targetMemberIds の空配列だけから
 * mode を推測しない（household + [] を一時状態としても許容しない）。
 */
function refineTargetAndServings(
  value: {
    targetMode: TargetMode | null;
    targetMemberIds: readonly string[];
    servings: number | null;
  },
  ctx: z.RefinementCtx,
): void {
  const issue = (path: string, message: string): void => {
    ctx.addIssue({ code: "custom", path: [path], message });
  };
  if (value.targetMode === "household") {
    if (value.targetMemberIds.length === 0) issue("targetMemberIds", "家族を選んでください");
    if (value.servings !== null) issue("servings", "家族モードでは人数を直接指定できません");
  }
  if (value.targetMode === "idea") {
    if (value.targetMemberIds.length !== 0)
      issue("targetMemberIds", "アイデアモードでは家族を指定できません");
    if (value.servings === null) issue("servings", "人数を指定してください");
  }
  if (value.targetMode === null) {
    if (value.targetMemberIds.length !== 0) issue("targetMemberIds", "対象を選び直してください");
    if (value.servings !== null) issue("servings", "対象を選んでから人数を指定してください");
  }
}

const draftShape = {
  mealType: z.enum(mealTypes).nullable(),
  mainIngredients: z
    .array(boundedCanonicalText(1, PLANNER_INGREDIENT_TEXT_MAX))
    .max(PLANNER_MAIN_INGREDIENT_LIMIT),
  cuisineGenre: z.enum(cuisineGenres).nullable(),
  targetMode: targetModeSchema.nullable(),
  targetMemberIds: z.array(z.uuid()).max(PLANNER_TARGET_MEMBER_LIMIT),
  servings: z.number().int().min(1).max(PLANNER_TARGET_MEMBER_LIMIT).nullable(),
  timeLimitMinutes: z.union([z.literal(15), z.literal(30), z.literal(45)]).nullable(),
  budgetPreference: z.enum(budgetPreferences).nullable(),
  // default(null): 導入前の preference_snapshot / 下書き JSON にキーが無くても
  // 再生成・条件引き継ぎが 422 にならないよう欠損を未指定として読む。
  ingredientPreference: z.enum(ingredientPreferences).nullable().default(null),
  // default(null): 導入前の preference_snapshot / 下書き JSON にキーが無くても
  // 再生成・条件引き継ぎが 422 にならないよう欠損を未指定として読む。
  noveltyPreference: z.enum(noveltyPreferences).nullable().default(null),
  avoidIngredients: z
    .array(boundedCanonicalText(1, PLANNER_INGREDIENT_TEXT_MAX))
    .max(PLANNER_AVOID_INGREDIENT_LIMIT),
  memo: boundedCanonicalText(0, PLANNER_MEMO_TEXT_MAX),
  pantrySelections: z.array(pantrySelectionDraftSchema).max(PLANNER_PANTRY_SELECTION_LIMIT),
} satisfies z.ZodRawShape;

export const plannerDraftInputSchema = z
  .object(draftShape)
  .strict()
  .superRefine(refineTargetAndServings);
export const plannerDraftSchema = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    ...draftShape,
    revision: z.number().int().nonnegative(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine(refineTargetAndServings);

const submissionCommonShape = {
  mealType: z.enum(mealTypes),
  mainIngredients: z
    .array(boundedCanonicalText(1, PLANNER_INGREDIENT_TEXT_MAX))
    .min(1)
    .max(PLANNER_MAIN_INGREDIENT_LIMIT),
  cuisineGenre: z.enum(cuisineGenres),
  timeLimitMinutes: z.union([z.literal(15), z.literal(30), z.literal(45)]).nullable(),
  budgetPreference: z.enum(budgetPreferences).nullable(),
  // 同上: 導入前 snapshot の欠損キーを null（未指定）へ正規化する
  ingredientPreference: z.enum(ingredientPreferences).nullable().default(null),
  // default(null): 導入前の preference_snapshot / 下書き JSON にキーが無くても
  // 再生成・条件引き継ぎが 422 にならないよう欠損を未指定として読む。
  noveltyPreference: z.enum(noveltyPreferences).nullable().default(null),
  avoidIngredients: z
    .array(boundedCanonicalText(1, PLANNER_INGREDIENT_TEXT_MAX))
    .max(PLANNER_AVOID_INGREDIENT_LIMIT),
  memo: boundedCanonicalText(0, PLANNER_MEMO_TEXT_MAX),
  pantrySelections: z.array(pantrySelectionDraftSchema).max(PLANNER_PANTRY_SELECTION_LIMIT),
} satisfies z.ZodRawShape;

export const plannerSubmissionSchema = z.discriminatedUnion("targetMode", [
  z
    .object({
      ...submissionCommonShape,
      targetMode: z.literal("household"),
      targetMemberIds: z.array(z.uuid()).min(1).max(PLANNER_TARGET_MEMBER_LIMIT),
      servings: z.null(),
    })
    .strict(),
  z
    .object({
      ...submissionCommonShape,
      targetMode: z.literal("idea"),
      targetMemberIds: z.array(z.uuid()).max(0),
      servings: z.number().int().min(1).max(PLANNER_TARGET_MEMBER_LIMIT),
    })
    .strict(),
]);

export type BudgetPreference = (typeof budgetPreferences)[number];
export type IngredientPreference = (typeof ingredientPreferences)[number];
export type NoveltyPreference = (typeof noveltyPreferences)[number];
export type PlannerDraftInput = z.infer<typeof plannerDraftInputSchema>;
export type PlannerDraft = z.infer<typeof plannerDraftSchema>;
export type PlannerSubmission = z.infer<typeof plannerSubmissionSchema>;

export function collectPlannerRequestText(
  input: Pick<PlannerDraftInput, "mainIngredients" | "avoidIngredients" | "memo">,
): string {
  return [...input.mainIngredients, ...input.avoidIngredients, input.memo]
    .map((value) => value.normalize("NFKC").trim())
    .filter((value) => value.length > 0)
    .join("\n");
}
