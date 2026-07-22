import type { MealType } from "../contracts/domain.js";
import { validatedMenuSchema, type ValidatedMenu } from "../contracts/generation.js";
import type { CurrentSafetyContext, CurrentSafetyMember } from "../safety/context.js";
import type { GenerationContext } from "../safety/generation-context.js";
import { collectMenuTextSources, normalizeFoodText } from "../safety/allergens.js";
import { validateGeneratedMenu } from "../safety/validate-generated-menu.js";
import { emergencyMenuCandidateSchema, type EmergencyMenuCandidate } from "./contracts.js";
import { emergencyFixtureMetadataV1, emergencyMenuFixturesV1 } from "./fixtures.v1.js";

export type {
  EmergencyLabelWarning,
  EmergencyMenuCandidate,
  EmergencyMenusData,
} from "./contracts.js";

export type EmergencyFilterResult = {
  menus: readonly ValidatedMenu[];
  emptyReason: "current_safety_unavailable" | "no_matching_fixture" | null;
};

export function buildEmergencyMenuCandidate(input: {
  menu: ValidatedMenu;
  context: CurrentSafetyContext;
  memberLabels: Readonly<Record<string, string>>;
}): EmergencyMenuCandidate {
  const allergens = new Map(
    input.context.allergenDictionary.catalog.map((item) => [item.id, item.displayName] as const),
  );
  const allergenLabels = Object.fromEntries(
    [...new Set(input.menu.labelConfirmations.map((item) => item.allergenId))].map((allergenId) => {
      const displayName = allergens.get(allergenId);
      if (displayName === undefined) throw new Error("reviewed_emergency_label_mapping_failed");
      return [allergenId, displayName] as const;
    }),
  );
  const labelWarnings = input.menu.labelConfirmations.map((confirmation) => {
    const allergenDisplayName = allergenLabels[confirmation.allergenId];
    const memberDisplayName = input.memberLabels[confirmation.anonymousMemberRef];
    if (allergenDisplayName === undefined || memberDisplayName === undefined) {
      throw new Error("reviewed_emergency_label_mapping_failed");
    }
    return {
      sourceType: confirmation.sourceType,
      sourceId: confirmation.sourceId,
      sourcePath: confirmation.sourcePath,
      sourceDisplayName: confirmation.sourceText,
      allergenId: confirmation.allergenId,
      allergenDisplayName,
      anonymousMemberRef: confirmation.anonymousMemberRef,
      memberDisplayName,
      dictionaryVersion: confirmation.dictionaryVersion,
      confirmationStatus: "pending" as const,
    };
  });
  return emergencyMenuCandidateSchema.parse({
    menu: input.menu,
    memberLabels: input.memberLabels,
    allergenLabels,
    labelWarnings,
  });
}

function remapUuidForMember(id: string, memberIndex: number): string {
  if (memberIndex === 0) return id;
  const suffix = BigInt(`0x${id.slice(-12)}`);
  const remapped = (suffix + BigInt(memberIndex) * 0x100000000n) % 0x1000000000000n;
  return `${id.slice(0, -12)}${remapped.toString(16).padStart(12, "0")}`;
}

function remapFixtureForMembers(
  menu: ValidatedMenu,
  members: readonly CurrentSafetyMember[],
): ValidatedMenu {
  return validatedMenuSchema.parse({
    ...menu,
    adaptations: members.flatMap((member, memberIndex) =>
      menu.adaptations.map((adaptation) => ({
        ...adaptation,
        id: remapUuidForMember(adaptation.id, memberIndex),
        anonymousMemberRef: member.anonymousRef,
        safetyActions: adaptation.safetyActions.map((action) => ({
          ...action,
          anonymousMemberRef: member.anonymousRef,
        })),
      })),
    ),
  });
}

function emergencyGenerationContext(
  menu: ValidatedMenu,
  context: CurrentSafetyContext,
  memberLabels: Readonly<Record<string, string>>,
): GenerationContext {
  return {
    submission: {
      mealType: menu.mealType,
      mainIngredients: [],
      cuisineGenre: menu.cuisineGenre,
      targetMode: "household",
      targetMemberIds: context.members.map((member) => member.householdMemberId),
      servings: null,
      timeLimitMinutes: 15,
      budgetPreference: "standard",
      avoidIngredients: [],
      memo: "",
      pantrySelections: [],
    },
    safety: context,
    pantryItems: [],
    memberPreferences: context.members.map((member) => ({
      householdMemberId: member.householdMemberId,
      anonymousMemberRef: member.anonymousRef,
      portionSize: "regular",
      spiceLevel: "regular",
      easePreferences: member.requiredSafetyConstraints.map((constraint) =>
        constraint === "remove_bones" ? "boneless" : "small_pieces",
      ),
      dislikes: [],
    })),
    targetMembers: context.members.map((member, index) => ({
      householdMemberId: member.householdMemberId,
      anonymousRef: member.anonymousRef,
      displayNameSnapshot: memberLabels[member.anonymousRef] ?? `家族${String(index + 1)}`,
    })),
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
  memberLabels?: Readonly<Record<string, string>>;
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
    .flatMap((menu) => {
      const metadata = emergencyFixtureMetadataV1[menu.menuId];
      if (
        metadata === undefined ||
        input.context.members.some(
          (member) =>
            !metadata.eligibleAgeBands.includes(member.ageBand) ||
            member.allergenIds.some((allergenId) =>
              metadata.standardAllergenIds.includes(allergenId),
            ),
        )
      ) {
        return [];
      }
      const remapped = remapFixtureForMembers(menu, input.context.members);
      const validated = validateGeneratedMenu(
        remapped,
        emergencyGenerationContext(remapped, input.context, input.memberLabels ?? {}),
      );
      return validated.ok ? [validated.menu] : [];
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
