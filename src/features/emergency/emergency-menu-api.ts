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

// household / idea を targetMode で判別。idea は targetMemberIds を空 tuple のみ許可。
const emergencyMenuRequestSchema = z.discriminatedUnion("targetMode", [
  z
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
    .strict(),
  z
    .object({
      mealType: z.enum(mealTypes),
      mainIngredients: emergencyMainIngredientsSchema,
      targetMode: z.literal("idea"),
      // 長さ 0 のみ。非空はクライアント schema で拒否し query に載せない
      targetMemberIds: z.tuple([]),
      pantryItemIds: z
        .array(z.uuid())
        .max(50)
        .refine((ids) => new Set(ids).size === ids.length),
    })
    .strict(),
]);

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

export function parseEmergencyMenusResponse(
  value: unknown,
  expectedPath?: "household" | "idea",
): EmergencyMenusData {
  const envelope = emergencyResponseSchema.parse(value);
  if (!envelope.ok) throw new Error(envelope.error.message);
  // expectedPath 指定時は wire path と不一致なら fail-closed（将来 caller の足場）。
  if (expectedPath !== undefined && envelope.data.path !== expectedPath) {
    throw new Error("緊急献立の応答経路が要求と一致しません");
  }
  return envelope.data;
}

export async function getEmergencyMenus(input: {
  mealType: MealType;
  mainIngredients: readonly string[];
  targetMode: "household" | "idea";
  targetMemberIds: readonly string[];
  pantryItemIds: readonly string[];
}): Promise<EmergencyMenusData> {
  const validatedInput = emergencyMenuRequestSchema.parse(input);
  const token = await requireAccessToken(getBrowserSupabaseClient());
  // targetMode は household / idea とも常に明示送信（サーバ optional でも省略しない）
  const query = new URLSearchParams({
    meal: validatedInput.mealType,
    targetMode: validatedInput.targetMode,
  });
  // idea では targetMemberIds キー自体を省略（サーバ: キー未送出のみ許可）
  if (validatedInput.targetMode === "household") {
    query.set("targetMemberIds", validatedInput.targetMemberIds.join(","));
  }
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
  // path 相関は parse 側に寄せる（household chrome の誤表示を防ぐ防御）。
  return parseEmergencyMenusResponse(body, validatedInput.targetMode);
}
