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
  emptyReason:
    "current_safety_unavailable" | "main_ingredient_no_match" | "no_matching_fixture" | null;
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
    targetMode: "household",
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
    // 緊急献立の検証は真の安全条件（requiredSafetyConstraints / 食材ルール / アレルゲン）
    // だけでゲートする。safety 制約を easePreferences に写像すると structured action の
    // ease 経路を強制し、未検証の cut_small などで候補が空になるため写像しない。
    memberPreferences: context.members.map((member) => ({
      householdMemberId: member.householdMemberId,
      anonymousMemberRef: member.anonymousRef,
      portionSize: "regular",
      spiceLevel: "regular",
      easePreferences: [],
      dislikes: [],
    })),
    targetMembers: context.members.map((member, index) => ({
      householdMemberId: member.householdMemberId,
      anonymousRef: member.anonymousRef,
      displayNameSnapshot: memberLabels[member.anonymousRef] ?? `家族${String(index + 1)}`,
    })),
    allergenVersion: context.dictionaryVersion,
    foodRuleVersion: context.foodRuleVersion,
    expiredPantryChecks: [],
    idempotencyKey: "82600000-0000-4000-8000-000000000001",
    preferenceSnapshot: {},
    safetySnapshot: {},
  };
}

function normalizeMainIngredientForMatch(value: string): string {
  return value.normalize("NFKC").trim();
}

export function filterEmergencyMenus(input: {
  mealType: MealType;
  mainIngredients?: readonly string[];
  pantryNames: readonly string[];
  context: CurrentSafetyContext;
  memberLabels?: Readonly<Record<string, string>>;
}): EmergencyFilterResult {
  const mainIngredients = (input.mainIngredients ?? []).map(normalizeMainIngredientForMatch);
  if (
    input.context.members.length === 0 ||
    input.context.members.some(
      (member) =>
        member.allergyStatus === "unconfirmed" ||
        member.hasUnmappedCustomAllergy ||
        member.unsupportedDietStatus !== "none",
    )
  ) {
    return {
      menus: [],
      // 安全条件未充足が原因。メイン食材の有無で理由をすり替えない。
      emptyReason: "current_safety_unavailable",
    };
  }

  const pantry = input.pantryNames.map(normalizeFoodText).filter((name) => name !== "");
  const safetyCompatibleMenus = emergencyMenuFixturesV1
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
    });
  const menus = safetyCompatibleMenus
    .filter((menu) => {
      if (mainIngredients.length === 0) return true;
      // 自由文の手順や説明ではなく、料理名と材料名だけをメイン食材との対応根拠にする。
      const candidateNames = menu.dishes.flatMap((dish) => [
        normalizeMainIngredientForMatch(dish.name),
        ...dish.ingredients.map((ingredient) => normalizeMainIngredientForMatch(ingredient.name)),
      ]);
      // 候補がユーザー指定を含む方向だけを見る。
      // 逆方向（"塩鮭".includes("塩")）は調味料・短い総称語で過剰マッチするため使わない。
      return mainIngredients.every((mainIngredient) =>
        candidateNames.some((candidateName) => candidateName.includes(mainIngredient)),
      );
    })
    .sort((left, right) => {
      const score = (menu: ValidatedMenu) =>
        collectMenuTextSources(menu).filter((source) =>
          pantry.some((name) => normalizeFoodText(source.text).includes(name)),
        ).length;
      return score(right) - score(left) || left.menuId.localeCompare(right.menuId);
    });
  return {
    menus,
    emptyReason:
      menus.length > 0
        ? null
        : // 安全条件で候補が0のときはメイン食材不足と誤表示しない
          safetyCompatibleMenus.length === 0
          ? "no_matching_fixture"
          : mainIngredients.length > 0
            ? "main_ingredient_no_match"
            : "no_matching_fixture",
  };
}
