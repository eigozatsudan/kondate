import { z } from "zod";
import { cuisineGenres, mealTypes, pantryPriorities } from "./domain.js";
import { pantryUsageStatuses } from "./pantry.js";

const dishRef = z.string().regex(/^dish_[1-9][0-9]*$/u);
const ingredientRef = z.string().regex(/^ingredient_[1-9][0-9]*$/u);
const stepRef = z.string().regex(/^step_[1-9][0-9]*$/u);
const timelineRef = z.string().regex(/^timeline_[1-9][0-9]*$/u);
const adaptationRef = z.string().regex(/^adaptation_[1-9][0-9]*$/u);
const pantryRef = z.string().regex(/^pantry_[1-9][0-9]*$/u);
const memberRef = z.string().regex(/^member_[1-9][0-9]*$/u);
const safetyTag = z.string().regex(/^[a-z][a-z0-9_]*$/u);
const nullableQuantity = z.number().min(0).max(999_999).nullable();
const nullableUnit = z.string().trim().min(1).max(24).nullable();
const sourceRef = z.union([dishRef, ingredientRef, stepRef, timelineRef, adaptationRef]);

const aiIngredient = z
  .object({
    ingredientRef,
    position: z.number().int().positive(),
    name: z.string().trim().min(1).max(100),
    quantityValue: z.number().positive().nullable(),
    quantityText: z.string().trim().min(1).max(60),
    unit: nullableUnit,
    storeSection: z.enum([
      "produce",
      "meat_fish",
      "dairy_eggs",
      "dry_goods",
      "seasonings",
      "other",
    ]),
    pantryRef: pantryRef.nullable(),
    labelConfirmationRequired: z.boolean(),
  })
  .strict();

const aiStep = z
  .object({
    stepRef,
    position: z.number().int().positive(),
    instruction: z.string().trim().min(1).max(500),
  })
  .strict();

const aiDish = z
  .object({
    dishRef,
    role: z.enum(["main", "side", "soup", "staple", "other"]),
    position: z.number().int().positive(),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(300),
    cookingTimeMinutes: z.number().int().positive().max(180),
    ingredients: z.array(aiIngredient).min(1).max(50),
    steps: z.array(aiStep).min(1).max(30),
  })
  .strict();

const aiTimeline = z
  .object({
    timelineRef,
    position: z.number().int().positive(),
    startMinute: z.number().int().nonnegative(),
    durationMinutes: z.number().int().positive(),
    instruction: z.string().trim().min(1).max(500),
    dishRef: dishRef.nullable(),
    stepRef: stepRef.nullable(),
  })
  .strict();

const aiSafetyAction = z
  .object({
    kind: z.enum(["remove_bones", "cut_small", "quarter_round_food", "soften", "heat_thoroughly"]),
    dishRef,
    ingredientRef,
    anonymousMemberRef: memberRef,
    beforeStepRef: stepRef,
    instruction: z.string().trim().min(1).max(300),
  })
  .strict();

const aiAdaptation = z
  .object({
    adaptationRef,
    dishRef,
    anonymousMemberRef: memberRef,
    portionText: z.string().trim().min(1).max(80),
    beforeStepRef: stepRef,
    additionalCutting: z.string().trim().min(1).max(300).nullable(),
    additionalHeating: z.string().trim().min(1).max(300).nullable(),
    additionalSeasoning: z.string().trim().min(1).max(300).nullable(),
    servingCheck: z.string().trim().min(1).max(300),
    safetyTags: z.array(safetyTag),
    safetyActions: z.array(aiSafetyAction).max(20),
  })
  .strict();

const aiPantryUsage = z
  .object({
    pantryRef,
    priority: z.enum(pantryPriorities),
    usageStatus: z.enum(pantryUsageStatuses),
    plannedQuantity: nullableQuantity,
    unit: nullableUnit,
    dishRefs: z.array(dishRef).max(5),
    unusedReason: z.string().trim().min(1).max(200).nullable(),
  })
  .strict();

const aiLabel = z
  .object({
    sourceType: z.enum(["dish", "ingredient", "recipe_step", "adaptation", "timeline"]),
    sourceRef,
    sourcePath: z.string().trim().min(1).max(200),
    allergenId: z.string().regex(/^[a-z][a-z0-9_]*$/u),
    anonymousMemberRef: memberRef,
    dictionaryVersion: z.string().trim().min(1).max(80),
    confirmationStatus: z.literal("pending"),
  })
  .strict();

export const aiGeneratedMenuPayloadSchema = z
  .object({
    schemaVersion: z.literal("2026-07-11.v1"),
    mealType: z.enum(mealTypes),
    cuisineGenre: z.enum(cuisineGenres),
    servings: z.number().int().min(1).max(20),
    totalElapsedMinutes: z.number().int().min(1).max(180),
    safetyTags: z.array(safetyTag),
    dishes: z.array(aiDish).min(1).max(5),
    timeline: z.array(aiTimeline).min(1).max(60),
    adaptations: z.array(aiAdaptation).max(100),
    pantryUsage: z.array(aiPantryUsage).max(50),
    labelConfirmations: z.array(aiLabel).max(200),
  })
  .strict();

export type AiGeneratedMenuPayload = z.infer<typeof aiGeneratedMenuPayloadSchema>;
