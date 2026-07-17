import { mealTypes, type MealType } from "@shared/contracts/domain";
import { emergencyMenusDataSchema, type EmergencyMenusData } from "@shared/emergency/contracts";
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

const emergencyMenuRequestSchema = z
  .object({
    mealType: z.enum(mealTypes),
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
    targetMemberIds: readonly string[];
    pantryItemIds: readonly string[];
    householdSafetyRevision: string;
  }) =>
    [
      "emergency-menus",
      input.userId,
      input.mealType,
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
  targetMemberIds: readonly string[];
  pantryItemIds: readonly string[];
}): Promise<EmergencyMenusData> {
  const validatedInput = emergencyMenuRequestSchema.parse(input);
  const token = await requireAccessToken(getBrowserSupabaseClient());
  const query = new URLSearchParams({
    meal: validatedInput.mealType,
    targetMemberIds: validatedInput.targetMemberIds.join(","),
  });
  if (validatedInput.pantryItemIds.length > 0) {
    query.set("pantryItemIds", validatedInput.pantryItemIds.join(","));
  }
  const response = await fetch(`/api/emergency-menus?${query.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body: unknown = await response.json();
  return parseEmergencyMenusResponse(body);
}
