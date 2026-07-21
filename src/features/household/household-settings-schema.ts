import { z } from "zod";
import {
  ageBands,
  allergyStatuses,
  easePreferences,
  portionSizes,
  requiredSafetyConstraints,
  spiceLevels,
  unsupportedDietKinds,
  unsupportedDietStatuses,
} from "@shared/contracts/domain";

export const householdSettingsSchema = z
  .object({
    displayName: z.string().trim().min(1).max(30).nullable(),
    ageBand: z.enum(ageBands, "年齢のめやすを選んでください"),
    allergyStatus: z.enum(allergyStatuses, "アレルギーの確認を選んでください"),
    unsupportedDietStatus: z.enum(unsupportedDietStatuses, "食べない食事があるか選んでください"),
    unsupportedDietKinds: z.array(z.enum(unsupportedDietKinds)).max(3),
    requiredSafetyConstraints: z.array(z.enum(requiredSafetyConstraints)).max(2),
    portionSize: z.enum(portionSizes),
    spiceLevel: z.enum(spiceLevels),
    easePreferences: z.array(z.enum(easePreferences)).max(3),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.unsupportedDietStatus === "present" && value.unsupportedDietKinds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["unsupportedDietKinds"],
        message: "該当する項目を選んでください",
      });
    }
    if (value.unsupportedDietStatus !== "present" && value.unsupportedDietKinds.length !== 0) {
      context.addIssue({
        code: "custom",
        path: ["unsupportedDietKinds"],
        message: "対象外状態と項目を確認してください",
      });
    }
  });

export type HouseholdSettingsValue = z.infer<typeof householdSettingsSchema>;
export type HouseholdFieldErrors = Partial<Record<keyof HouseholdSettingsValue, string>>;

export function toHouseholdFieldErrors(
  error: z.ZodError<HouseholdSettingsValue>,
): HouseholdFieldErrors {
  const result: HouseholdFieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path.at(0);
    if (typeof field !== "string" || !(field in householdSettingsSchema.shape)) continue;
    const key = field as keyof HouseholdSettingsValue;
    result[key] ??= issue.message;
  }
  return result;
}
