import { z } from "zod";
import type { MealType } from "../contracts/domain.js";
import {
  labelSourceTypes,
  validatedMenuSchema,
  type ValidatedMenu,
} from "../contracts/generation.js";
import type { CurrentSafetyContext, CurrentSafetyMember } from "../safety/context.js";
import type { GenerationContext } from "../safety/generation-context.js";
import { collectMenuTextSources, normalizeFoodText } from "../safety/allergens.js";
import { validateGeneratedMenu } from "../safety/validate-generated-menu.js";
import { emergencyFixtureMetadataV1, emergencyMenuFixturesV1 } from "./fixtures.v1.js";

export type EmergencyFilterResult = {
  menus: readonly ValidatedMenu[];
  emptyReason: "current_safety_unavailable" | "no_matching_fixture" | null;
};

const memberRefSchema = z.string().regex(/^member_[1-9][0-9]*$/u);
const humanTextSchema = z.string().trim().min(1).max(300);

export const emergencyLabelWarningSchema = z
  .object({
    sourceType: z.enum(labelSourceTypes),
    sourceDisplayName: humanTextSchema,
    allergenDisplayName: humanTextSchema,
    memberDisplayName: humanTextSchema,
    dictionaryVersion: z.string().trim().min(1).max(80),
    confirmationStatus: z.literal("pending"),
  })
  .strict();

export const emergencyMenuCandidateSchema = z
  .object({
    menu: validatedMenuSchema,
    memberLabels: z.record(memberRefSchema, humanTextSchema),
    labelWarnings: z.array(emergencyLabelWarningSchema).max(200),
  })
  .strict()
  .superRefine((value, context) => {
    const requiredRefs = new Set(value.menu.adaptations.map((item) => item.anonymousMemberRef));
    for (const ref of requiredRefs) {
      if (value.memberLabels[ref] === undefined) {
        context.addIssue({
          code: "custom",
          path: ["memberLabels", ref],
          message: "対象者の表示名が必要です",
        });
      }
    }
    if (value.labelWarnings.length !== value.menu.labelConfirmations.length) {
      context.addIssue({
        code: "custom",
        path: ["labelWarnings"],
        message: "すべての原材料表示確認に人向け表示が必要です",
      });
    }
  });

export const emergencyMenusDataSchema = z
  .object({
    fixtureVersion: z.string().trim().min(1),
    candidates: z.array(emergencyMenuCandidateSchema),
    message: z.string().trim().min(1),
    consumesAiQuota: z.literal(false),
  })
  .strict();

export type EmergencyLabelWarning = z.infer<typeof emergencyLabelWarningSchema>;
export type EmergencyMenuCandidate = z.infer<typeof emergencyMenuCandidateSchema>;
export type EmergencyMenusData = z.infer<typeof emergencyMenusDataSchema>;

export function buildEmergencyMenuCandidate(input: {
  menu: ValidatedMenu;
  context: CurrentSafetyContext;
  memberLabels: Readonly<Record<string, string>>;
}): EmergencyMenuCandidate {
  const allergens = new Map(
    input.context.allergenDictionary.catalog.map((item) => [item.id, item.displayName] as const),
  );
  const labelWarnings = input.menu.labelConfirmations.map((confirmation) => {
    const allergenDisplayName = allergens.get(confirmation.allergenId);
    const memberDisplayName = input.memberLabels[confirmation.anonymousMemberRef];
    if (allergenDisplayName === undefined || memberDisplayName === undefined) {
      throw new Error("reviewed_emergency_label_mapping_failed");
    }
    return {
      sourceType: confirmation.sourceType,
      sourceDisplayName: confirmation.sourceText,
      allergenDisplayName,
      memberDisplayName,
      dictionaryVersion: confirmation.dictionaryVersion,
      confirmationStatus: "pending" as const,
    };
  });
  return emergencyMenuCandidateSchema.parse({
    menu: input.menu,
    memberLabels: input.memberLabels,
    labelWarnings,
  });
}

function emergencyContextForMember(
  menu: ValidatedMenu,
  context: CurrentSafetyContext,
  member: CurrentSafetyMember,
): GenerationContext {
  const normalizedMember = { ...member, anonymousRef: "member_1" };
  return {
    submission: {
      mealType: menu.mealType,
      mainIngredients: [],
      cuisineGenre: menu.cuisineGenre,
      targetMemberIds: [member.householdMemberId],
      timeLimitMinutes: 15,
      budgetPreference: "standard",
      avoidIngredients: [],
      memo: "",
      pantrySelections: [],
    },
    safety: { ...context, members: [normalizedMember] },
    pantryItems: [],
    memberPreferences: [
      {
        householdMemberId: member.householdMemberId,
        anonymousMemberRef: "member_1",
        portionSize: "regular",
        spiceLevel: "regular",
        easePreferences: member.requiredSafetyConstraints.map((constraint) =>
          constraint === "remove_bones" ? "boneless" : "small_pieces",
        ),
        dislikes: [],
      },
    ],
    targetMembers: [
      {
        householdMemberId: member.householdMemberId,
        anonymousRef: "member_1",
        displayNameSnapshot: "家族1",
      },
    ],
    expiredPantryChecks: [],
    idempotencyKey: "82600000-0000-4000-8000-000000000001",
    preferenceSnapshot: {},
    safetySnapshot: {},
  };
}

export function filterEmergencyMenus(input: {
  mealType: MealType;
  pantryNames: readonly string[];
  context: CurrentSafetyContext;
}): EmergencyFilterResult {
  if (
    input.context.members.length === 0 ||
    input.context.members.some(
      (member) =>
        member.allergyStatus === "unconfirmed" ||
        member.hasUnmappedCustomAllergy ||
        member.unsupportedDietStatus !== "none",
    )
  ) {
    return { menus: [], emptyReason: "current_safety_unavailable" };
  }

  const pantry = input.pantryNames.map(normalizeFoodText).filter((name) => name !== "");
  const menus = emergencyMenuFixturesV1
    .filter((menu) => menu.mealType === input.mealType)
    .filter((menu) => {
      const metadata = emergencyFixtureMetadataV1[menu.menuId];
      if (metadata === undefined) return false;
      return input.context.members.every(
        (member) =>
          metadata.eligibleAgeBands.includes(member.ageBand) &&
          !member.allergenIds.some((allergenId) =>
            metadata.standardAllergenIds.includes(allergenId),
          ) &&
          validateGeneratedMenu(menu, emergencyContextForMember(menu, input.context, member)).ok,
      );
    })
    .sort((left, right) => {
      const score = (menu: ValidatedMenu) =>
        collectMenuTextSources(menu).filter((source) =>
          pantry.some((name) => normalizeFoodText(source.text).includes(name)),
        ).length;
      return score(right) - score(left) || left.menuId.localeCompare(right.menuId);
    });
  return { menus, emptyReason: menus.length === 0 ? "no_matching_fixture" : null };
}
