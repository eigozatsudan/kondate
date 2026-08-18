import type { MealType } from "@shared/contracts/domain";
import {
  emergencyMenusDataSchema,
  emergencyMenusRequestSchema,
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
  const validatedInput = emergencyMenusRequestSchema.parse(input);
  const token = await requireAccessToken(getBrowserSupabaseClient());
  // 自由文 mainIngredients を query に載せない。Observability は URL を保持する。
  const response = await fetch("/api/emergency-menus", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(validatedInput),
    cache: "no-store",
  });
  const body: unknown = await response.json();
  // path 相関は parse 側に寄せる（household chrome の誤表示を防ぐ防御）。
  return parseEmergencyMenusResponse(body, validatedInput.targetMode);
}
