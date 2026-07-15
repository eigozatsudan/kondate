import { z } from "zod";
import { cuisineGenres, mealTypes } from "./domain.js";
import { pantrySelectionDraftSchema } from "./pantry.js";

export const plannerTimeLimits = [15, 30, 45] as const;
export const budgetPreferences = ["economy", "standard"] as const;

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

const draftShape = {
  mealType: z.enum(mealTypes).nullable(),
  mainIngredients: z.array(boundedCanonicalText(1, 80)).max(8),
  cuisineGenre: z.enum(cuisineGenres).nullable(),
  targetMemberIds: z.array(z.uuid()).max(20),
  timeLimitMinutes: z.union([z.literal(15), z.literal(30), z.literal(45)]).nullable(),
  budgetPreference: z.enum(budgetPreferences).nullable(),
  avoidIngredients: z.array(boundedCanonicalText(1, 80)).max(20),
  memo: boundedCanonicalText(0, 200),
  pantrySelections: z.array(pantrySelectionDraftSchema).max(50),
} satisfies z.ZodRawShape;

export const plannerDraftInputSchema = z.object(draftShape).strict();
export const plannerDraftSchema = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    ...draftShape,
    revision: z.number().int().nonnegative(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const plannerSubmissionSchema = z
  .object({
    mealType: z.enum(mealTypes),
    mainIngredients: z.array(boundedCanonicalText(1, 80)).min(1).max(8),
    cuisineGenre: z.enum(cuisineGenres),
    targetMemberIds: z.array(z.uuid()).min(1).max(20),
    timeLimitMinutes: z.union([z.literal(15), z.literal(30), z.literal(45)]).nullable(),
    budgetPreference: z.enum(budgetPreferences).nullable(),
    avoidIngredients: z.array(boundedCanonicalText(1, 80)).max(20),
    memo: boundedCanonicalText(0, 200),
    pantrySelections: z.array(pantrySelectionDraftSchema).max(50),
  })
  .strict();

export type BudgetPreference = (typeof budgetPreferences)[number];
export type PlannerDraftInput = z.infer<typeof plannerDraftInputSchema>;
export type PlannerDraft = z.infer<typeof plannerDraftSchema>;
export type PlannerSubmission = z.infer<typeof plannerSubmissionSchema>;
