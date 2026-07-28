import { mealTypes, type MealType } from "@shared/contracts/domain";
import {
  emergencyMainIngredientsSchema,
  emergencyMenusDataSchema,
  type EmergencyMenusData,
} from "@shared/emergency/contracts";
import { z } from "zod";
import { requireAccessToken } from "@/features/auth/session";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";

const emergencyResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: emergencyMenusDataSchema }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: z
        .object({
          code: z.string().min(1),
          message: z.string().min(1),
          details: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
    })
    .strict(),
]);

// Train A は household のみ実送。idea アームは Train B で discriminated union に拡張する。
const emergencyMenuRequestSchema = z
  .object({
    mealType: z.enum(mealTypes),
    mainIngredients: emergencyMainIngredientsSchema,
    targetMode: z.literal("household"),
    targetMemberIds: z
      .array(z.uuid())
      .min(1)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length),
    pantryItemIds: z
      .array(z.uuid())
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();

export const emergencyMenuKeys = {
  all: ["emergency-menus"] as const,
  candidates: (input: {
    userId: string;
    mealType: MealType;
    targetMode: "household" | "idea";
    mainIngredients: readonly string[];
    targetMemberIds: readonly string[];
    pantryItemIds: readonly string[];
    householdSafetyRevision: string;
  }) =>
    [
      "emergency-menus",
      input.userId,
      input.mealType,
      input.targetMode,
      [...input.mainIngredients],
      [...input.targetMemberIds],
      [...input.pantryItemIds],
      input.householdSafetyRevision,
    ] as const,
};

export function parseEmergencyMenusResponse(value: unknown): EmergencyMenusData {
  const envelope = emergencyResponseSchema.parse(value);
  if (!envelope.ok) throw new Error(envelope.error.message);
  return envelope.data;
}

export async function getEmergencyMenus(input: {
  mealType: MealType;
  mainIngredients: readonly string[];
  targetMode: "household";
  targetMemberIds: readonly string[];
  pantryItemIds: readonly string[];
}): Promise<EmergencyMenusData> {
  const validatedInput = emergencyMenuRequestSchema.parse(input);
  const token = await requireAccessToken(getBrowserSupabaseClient());
  const query = new URLSearchParams({
    meal: validatedInput.mealType,
    // Train A ship lock: 常に household を明示送信する（サーバ側 optional でも UI は省略しない）
    targetMode: validatedInput.targetMode,
    targetMemberIds: validatedInput.targetMemberIds.join(","),
  });
  for (const mainIngredient of validatedInput.mainIngredients) {
    query.append("mainIngredients", mainIngredient);
  }
  if (validatedInput.pantryItemIds.length > 0) {
    query.set("pantryItemIds", validatedInput.pantryItemIds.join(","));
  }
  const response = await fetch(`/api/emergency-menus?${query.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body: unknown = await response.json();
  return parseEmergencyMenusResponse(body);
}
