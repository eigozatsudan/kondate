import {
  type GeneratedLabelConfirmation,
  type MenuLabelConfirmation,
  type MenuValidationIssue,
  type MenuValidationResult,
  generatedMenuSchema,
  validatedMenuSchema,
} from "../contracts/generation.js";
import { evaluateAllergens, normalizeFoodText } from "./allergens.js";
import { createCurrentSafetyFingerprint } from "./fingerprint.js";
import { evaluateFoodSafetyRules } from "./food-rules.js";
import type { GenerationContext } from "./generation-context.js";
import { detectUnsupportedMedicalRequest } from "./medical-scope.js";

type ConfirmationIdentity = Pick<
  GeneratedLabelConfirmation,
  | "sourceType"
  | "sourceId"
  | "sourcePath"
  | "allergenId"
  | "anonymousMemberRef"
  | "dictionaryVersion"
>;

const confirmationKey = (item: ConfirmationIdentity): string =>
  [
    item.sourceType,
    item.sourceId,
    item.sourcePath,
    item.allergenId,
    item.anonymousMemberRef,
    item.dictionaryVersion,
  ].join("\u0000");

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function memberPairKey(householdMemberId: string, anonymousRef: string): string {
  return `${householdMemberId}\u0000${anonymousRef}`;
}

export function validateGeneratedMenu(
  menu: unknown,
  context: GenerationContext,
): MenuValidationResult {
  const parsed = generatedMenuSchema.safeParse(menu);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "invalid_menu_structure",
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  const generated = parsed.data;
  const issues: MenuValidationIssue[] = [];
  const targetIds = new Set(context.targetMembers.map((member) => member.householdMemberId));
  const requestedTargetIds = new Set(context.submission.targetMemberIds);
  const targetRefs = new Set(context.targetMembers.map((member) => member.anonymousRef));
  const safetyRefs = new Set(context.safety.members.map((member) => member.anonymousRef));
  const targetPairs = new Set(
    context.targetMembers.map((member) =>
      memberPairKey(member.householdMemberId, member.anonymousRef),
    ),
  );
  const safetyPairs = new Set(
    context.safety.members.map((member) =>
      memberPairKey(member.householdMemberId, member.anonymousRef),
    ),
  );
  const preferencePairs = new Set(
    context.memberPreferences.map((member) =>
      memberPairKey(member.householdMemberId, member.anonymousMemberRef),
    ),
  );
  if (
    !sameSet(targetIds, requestedTargetIds) ||
    !sameSet(targetRefs, safetyRefs) ||
    !sameSet(targetPairs, safetyPairs)
  ) {
    issues.push({
      code: "target_member_mismatch",
      path: "targetMembers",
      message: "対象メンバーが生成条件と一致しません",
    });
  }
  const returnedRefs = new Set(generated.adaptations.map((item) => item.anonymousMemberRef));
  if (!sameSet(returnedRefs, targetRefs)) {
    issues.push({
      code: "target_member_mismatch",
      path: "adaptations",
      message: "対象メンバーの取り分けが生成条件と一致しません",
    });
  }
  if (!sameSet(targetPairs, preferencePairs)) {
    issues.push({
      code: "member_preference_mismatch",
      path: "memberPreferences",
      message: "対象メンバーの嗜好条件が不足または不整合です",
    });
  }

  const dictionary = context.safety.allergenDictionary;
  const registeredAllergenIds = new Set(
    context.safety.members.flatMap((member) =>
      member.allergyStatus === "registered" ? member.allergenIds : [],
    ),
  );
  const catalogIds = new Set(dictionary.catalog.map((entry) => entry.id));
  const aliasAllergenIds = new Set(dictionary.aliases.map((alias) => alias.allergenId));
  const dictionaryInvalid =
    context.safety.dictionaryVersion !== dictionary.version ||
    dictionary.catalog.some((entry) => entry.catalogVersion !== dictionary.version) ||
    dictionary.aliases.some((alias) => alias.dictionaryVersion !== dictionary.version) ||
    [...registeredAllergenIds].some(
      (allergenId) => !catalogIds.has(allergenId) || !aliasAllergenIds.has(allergenId),
    );
  const childAgeBands = new Set(["post_weaning_to_2", "age_3_5"]);
  const childRuleMissing = context.safety.members.some(
    (member) =>
      childAgeBands.has(member.ageBand) &&
      !context.safety.foodSafetyRules.some((rule) =>
        rule.appliesToAgeBands.includes(member.ageBand),
      ),
  );
  const foodRulesInvalid =
    childRuleMissing ||
    context.safety.foodSafetyRules.some(
      (rule) => rule.ruleVersion !== context.safety.foodRuleVersion,
    );
  if (dictionaryInvalid || foodRulesInvalid) {
    issues.push({
      code: "safety_context_incomplete",
      path: "safety",
      message: "最新の安全辞書または食品安全ルールを適用できません",
    });
  }

  for (const member of context.safety.members) {
    if (member.allergyStatus === "unconfirmed") {
      issues.push({
        code: "allergy_unconfirmed",
        path: member.anonymousRef,
        message: "アレルギー確認が必要です",
      });
    }
    if (member.allergyStatus === "registered" && member.allergenIds.length === 0) {
      issues.push({
        code: "allergen_missing",
        path: member.anonymousRef,
        message: "登録アレルゲンを選んでください",
      });
    }
    if (member.hasUnmappedCustomAllergy) {
      issues.push({
        code: "unmapped_custom_allergy",
        path: member.anonymousRef,
        message: "自由登録アレルギーを固定候補へ対応付けできません",
      });
    }
    if (member.unsupportedDietStatus === "unconfirmed") {
      issues.push({
        code: "unsupported_diet_unconfirmed",
        path: member.anonymousRef,
        message: "対象外条件の確認が必要です",
      });
    }
    if (member.unsupportedDietStatus === "present") {
      issues.push({
        code: "unsupported_diet_present",
        path: member.anonymousRef,
        message: "対象外条件のあるメンバーは対象にできません",
      });
    }
  }
  for (const kind of detectUnsupportedMedicalRequest(context.safety.requestText)) {
    issues.push({
      code: "unsupported_medical_request",
      path: "requestText",
      message: `${kind} には対応していません`,
    });
  }

  if (generated.mealType !== context.submission.mealType) {
    issues.push({
      code: "meal_type_mismatch",
      path: "mealType",
      message: "食事区分が指定と一致しません",
    });
  }
  if (
    context.submission.cuisineGenre !== "any" &&
    generated.cuisineGenre !== context.submission.cuisineGenre
  ) {
    issues.push({
      code: "genre_mismatch",
      path: "cuisineGenre",
      message: "料理ジャンルが指定と一致しません",
    });
  }
  if (
    context.submission.timeLimitMinutes !== null &&
    generated.totalElapsedMinutes > context.submission.timeLimitMinutes
  ) {
    issues.push({
      code: "time_limit_exceeded",
      path: "totalElapsedMinutes",
      message: "指定時間を超えています",
    });
  }
  const roles = new Set(generated.dishes.map((dish) => dish.role));
  const rolesValid =
    generated.mealType === "dinner"
      ? ["main", "side", "soup"].every((role) => roles.has(role as "main" | "side" | "soup"))
      : (roles.has("main") || roles.has("staple")) && roles.has("side");
  if (!rolesValid) {
    issues.push({
      code: "required_dish_role_missing",
      path: "dishes",
      message: "必要な料理区分が不足しています",
    });
  }

  const identityFoodText = generated.dishes
    .flatMap((dish) => [dish.name, dish.description, ...dish.ingredients.map(({ name }) => name)])
    .map(normalizeFoodText)
    .join("\u0000");
  for (const requested of context.submission.mainIngredients) {
    if (!identityFoodText.includes(normalizeFoodText(requested))) {
      issues.push({
        code: "main_ingredient_missing",
        path: "dishes",
        message: `${requested} が含まれていません`,
      });
    }
  }
  for (const avoided of context.submission.avoidIngredients) {
    if (identityFoodText.includes(normalizeFoodText(avoided))) {
      issues.push({
        code: "avoid_ingredient_used",
        path: "dishes",
        message: `${avoided} は使用できません`,
      });
    }
  }

  const linkedDishIds = new Map<string, Set<string>>();
  const linkedIngredientNames = new Map<string, string[]>();
  for (const dish of generated.dishes) {
    for (const ingredient of dish.ingredients) {
      if (ingredient.pantrySelectionId !== null) {
        const dishIds = linkedDishIds.get(ingredient.pantrySelectionId) ?? new Set<string>();
        dishIds.add(dish.id);
        linkedDishIds.set(ingredient.pantrySelectionId, dishIds);
        const names = linkedIngredientNames.get(ingredient.pantrySelectionId) ?? [];
        names.push(ingredient.name);
        linkedIngredientNames.set(ingredient.pantrySelectionId, names);
      }
    }
  }
  const requestedPantry = new Map(
    context.submission.pantrySelections.map((selection) => [selection.pantryItemId, selection]),
  );
  const trustedPantry = new Map(context.pantryItems.map((item) => [item.id, item]));
  const returnedPantryIds = new Set(
    generated.pantryUsage.flatMap((usage) =>
      usage.pantryItemId === null ? [] : [usage.pantryItemId],
    ),
  );
  if (
    !sameSet(new Set(requestedPantry.keys()), new Set(trustedPantry.keys())) ||
    !sameSet(new Set(requestedPantry.keys()), returnedPantryIds) ||
    generated.pantryUsage.some((usage) => usage.pantryItemId === null)
  ) {
    issues.push({
      code: "pantry_selection_mismatch",
      path: "pantryUsage",
      message: "在庫選択が生成条件と一致しません",
    });
  }
  for (const usage of generated.pantryUsage) {
    const requested =
      usage.pantryItemId === null ? undefined : requestedPantry.get(usage.pantryItemId);
    const trusted = usage.pantryItemId === null ? undefined : trustedPantry.get(usage.pantryItemId);
    if (
      requested?.priority === "prefer_use" &&
      usage.usageStatus === "unused" &&
      (usage.unusedReason === null || usage.unusedReason.trim() === "")
    ) {
      issues.push({
        code: "prefer_use_reason_missing",
        path: `pantryUsage.${usage.selectionId}`,
        message: "優先食材を使わない理由がありません",
      });
    }
    const linked = linkedDishIds.get(usage.selectionId) ?? new Set<string>();
    const trustedName = trusted === undefined ? null : normalizeFoodText(trusted.name);
    const linkedNames = linkedIngredientNames.get(usage.selectionId) ?? [];
    const hasTrustedIngredient =
      trustedName !== null && linkedNames.some((name) => normalizeFoodText(name) === trustedName);
    const commonProvenanceInvalid =
      requested === undefined ||
      trusted === undefined ||
      usage.priority !== requested.priority ||
      normalizeFoodText(usage.pantryItemName) !== trustedName;
    const linkageInvalid =
      usage.usageStatus === "used"
        ? !sameSet(linked, new Set(usage.dishIds)) || !hasTrustedIngredient
        : linked.size > 0 || usage.dishIds.length > 0;
    if (commonProvenanceInvalid || linkageInvalid) {
      issues.push({
        code: "pantry_usage_link_mismatch",
        path: `pantryUsage.${usage.selectionId}`,
        message: "在庫使用先と料理食材の参照が一致しません",
      });
    }
  }
  for (const selection of context.submission.pantrySelections) {
    const usage = generated.pantryUsage.find(
      (item) => item.pantryItemId === selection.pantryItemId,
    );
    if (selection.priority === "must_use" && usage?.usageStatus !== "used") {
      issues.push({
        code: "must_use_missing",
        path: `pantrySelections.${selection.pantryItemId}`,
        message: "必ず使う在庫食材が使用されていません",
      });
    }
  }

  const easeAction = {
    small_pieces: "cut_small",
    boneless: "remove_bones",
    soft: "soften",
  } as const;
  for (const preference of context.memberPreferences) {
    const adaptations = generated.adaptations.filter(
      (adaptation) => adaptation.anonymousMemberRef === preference.anonymousMemberRef,
    );
    const adaptationText = adaptations
      .flatMap((adaptation) => [
        adaptation.portionText,
        adaptation.additionalCutting,
        adaptation.additionalHeating,
        adaptation.additionalSeasoning,
        adaptation.servingCheck,
      ])
      .filter((text): text is string => text !== null)
      .join(" ");
    const portionMatches =
      preference.portionSize === "regular" ||
      (preference.portionSize === "small" && /少なめ|小盛り|少量/u.test(adaptationText)) ||
      (preference.portionSize === "large" && /多め|大盛り|増量/u.test(adaptationText));
    const spiceMatches =
      preference.spiceLevel === "regular" ||
      (preference.spiceLevel === "none" &&
        /辛味なし|香辛料なし|味付けなし|辛くしない/u.test(adaptationText)) ||
      (preference.spiceLevel === "mild" && /薄味|控えめ|甘口/u.test(adaptationText));
    const actions = adaptations.flatMap((adaptation) => adaptation.safetyActions);
    const easeMatches = preference.easePreferences.every((ease) =>
      actions.some((action) => action.kind === easeAction[ease]),
    );
    const dislikeUsed = preference.dislikes.some((dislike) =>
      identityFoodText.includes(normalizeFoodText(dislike)),
    );
    if (
      adaptations.length === 0 ||
      !portionMatches ||
      !spiceMatches ||
      !easeMatches ||
      dislikeUsed
    ) {
      issues.push({
        code: "member_preference_mismatch",
        path: `memberPreferences.${preference.anonymousMemberRef}`,
        message: "家族の取り分け条件が生成結果に反映されていません",
      });
    }
  }

  const allergenResult = evaluateAllergens(generated, context.safety);
  issues.push(...allergenResult.issues, ...evaluateFoodSafetyRules(generated, context.safety));
  const emitted = new Set(generated.labelConfirmations.map(confirmationKey));
  const required = new Set(allergenResult.labelConfirmations.map(confirmationKey));
  for (const confirmation of allergenResult.labelConfirmations) {
    if (!emitted.has(confirmationKey(confirmation))) {
      issues.push({
        code: "missing_label_confirmation",
        path: confirmation.sourcePath,
        message: "加工品のラベル確認が不足しています",
      });
    }
  }
  for (const confirmation of generated.labelConfirmations) {
    if (!required.has(confirmationKey(confirmation))) {
      issues.push({
        code: "unexpected_label_confirmation",
        path: confirmation.sourcePath,
        message: "不要なラベル確認が含まれています",
      });
    }
  }
  if (issues.length > 0) return { ok: false, issues };

  const canonicalLabelConfirmations: readonly MenuLabelConfirmation[] =
    allergenResult.labelConfirmations.map((item) => ({
      ...item,
      confirmationStatus: "pending" as const,
      confirmedAt: null,
      confirmedBy: null,
    }));
  const validated = validatedMenuSchema.safeParse({
    ...generated,
    labelConfirmations: canonicalLabelConfirmations,
  });
  if (!validated.success) {
    return {
      ok: false,
      issues: validated.error.issues.map((issue) => ({
        code: "invalid_menu_structure",
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }
  return {
    ok: true,
    menu: validated.data,
    labelConfirmations: validated.data.labelConfirmations,
    safetyFingerprint: createCurrentSafetyFingerprint(context.safety),
  };
}

export type { GenerationContext } from "./generation-context.js";
export type { CurrentSafetyContext, CurrentSafetyMember } from "./context.js";
export type { MenuValidationIssue, MenuValidationResult } from "../contracts/generation.js";
