import { z } from "zod";
import { cuisineGenres, mealTypes } from "./domain.js";
import { pantrySelectionDraftSchema } from "./pantry.js";

export const plannerTimeLimits = [15, 30, 45] as const;
export const budgetPreferences = ["economy", "standard"] as const;
export const targetModes = ["household", "idea"] as const;
export type TargetMode = (typeof targetModes)[number];

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
 * 家族/人数の整合を強制する。household は家族1〜20人・人数指定なし、
 * idea は家族0人・人数1〜20、未選択は両方とも空のままにする。
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
  mainIngredients: z.array(boundedCanonicalText(1, 80)).max(8),
  cuisineGenre: z.enum(cuisineGenres).nullable(),
  targetMode: targetModeSchema.nullable(),
  targetMemberIds: z.array(z.uuid()).max(20),
  servings: z.number().int().min(1).max(20).nullable(),
  timeLimitMinutes: z.union([z.literal(15), z.literal(30), z.literal(45)]).nullable(),
  budgetPreference: z.enum(budgetPreferences).nullable(),
  avoidIngredients: z.array(boundedCanonicalText(1, 80)).max(20),
  memo: boundedCanonicalText(0, 200),
  pantrySelections: z.array(pantrySelectionDraftSchema).max(50),
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
  mainIngredients: z.array(boundedCanonicalText(1, 80)).min(1).max(8),
  cuisineGenre: z.enum(cuisineGenres),
  timeLimitMinutes: z.union([z.literal(15), z.literal(30), z.literal(45)]).nullable(),
  budgetPreference: z.enum(budgetPreferences).nullable(),
  avoidIngredients: z.array(boundedCanonicalText(1, 80)).max(20),
  memo: boundedCanonicalText(0, 200),
  pantrySelections: z.array(pantrySelectionDraftSchema).max(50),
} satisfies z.ZodRawShape;

export const plannerSubmissionSchema = z.discriminatedUnion("targetMode", [
  z
    .object({
      ...submissionCommonShape,
      targetMode: z.literal("household"),
      targetMemberIds: z.array(z.uuid()).min(1).max(20),
      servings: z.null(),
    })
    .strict(),
  z
    .object({
      ...submissionCommonShape,
      targetMode: z.literal("idea"),
      targetMemberIds: z.array(z.uuid()).max(0),
      servings: z.number().int().min(1).max(20),
    })
    .strict(),
]);

export type BudgetPreference = (typeof budgetPreferences)[number];
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
