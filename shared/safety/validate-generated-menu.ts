import {
  type GeneratedLabelConfirmation,
  type GeneratedMenu,
  type MenuLabelConfirmation,
  type MenuValidationIssue,
  type MenuValidationResult,
  type PreferenceGapNote,
  generatedMenuSchema,
  validatedMenuSchema,
} from "../contracts/generation.js";
import { collectPlannerRequestText } from "../contracts/planner.js";
import { evaluateAllergens, normalizeFoodText } from "./allergens.js";
import { createCurrentSafetyFingerprint } from "./fingerprint.js";
import { evaluateFoodSafetyRules } from "./food-rules.js";
import type {
  GenerationContext,
  HouseholdGenerationContext,
  IdeaGenerationContext,
} from "./generation-context.js";
import { createIdeaSafetyFingerprint } from "./idea-fingerprint.js";
import { detectUnsupportedMedicalRequest } from "./medical-scope.js";
import { collectDislikePreferenceGaps } from "./preference-gaps.js";

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

const reviewedMainIngredientSynonymGroups: readonly ReadonlySet<string>[] = [
  new Set(["鮭", "さけ", "しゃけ", "サーモン"].map(normalizeFoodText)),
];
const reviewedMainIngredientNonFoodContext = /^(?:の)?(?:風|香り|ふれーばー)/u;
const reviewedKanaMainIngredientAliases = new Set(["さけ", "しゃけ"].map(normalizeFoodText));
// 動詞連続（さける等）のみ除外する。先行ひらがなは「焼きさけ」「素材はさけ」まで落とすため使わない。
const reviewedKanaWordContinuation = /^(?:る|ない|ます|ました|て|た|れば|よう)/u;
// I3: 酒「おさけ」と色名「サーモンピンク」だけを狭く拒否する（一律左境界拒否はしない）
const reviewedSakeBeveragePrefix = normalizeFoodText("お");
const reviewedSalmonColorSuffix = /^(?:ぴんく|色)/u;
const reviewedSakeCandidate = normalizeFoodText("さけ");
const reviewedSalmonCandidate = normalizeFoodText("サーモン");

function containsReviewedMainIngredientOccurrence(sourceText: string, candidate: string): boolean {
  let from = 0;
  while (from <= sourceText.length - candidate.length) {
    const start = sourceText.indexOf(candidate, from);
    if (start === -1) return false;
    const prefix = sourceText.slice(0, start);
    const suffix = sourceText.slice(start + candidate.length);
    const embeddedKanaWord =
      reviewedKanaMainIngredientAliases.has(candidate) && reviewedKanaWordContinuation.test(suffix);
    // 「おさけ」= 酒。candidate さけ の直前が お のときだけ非食材扱い。
    const sakeBeverage =
      candidate === reviewedSakeCandidate && prefix.endsWith(reviewedSakeBeveragePrefix);
    // 「サーモンピンク」等。candidate さーもん の直後が ぴんく / 色。
    const salmonColorName =
      candidate === reviewedSalmonCandidate && reviewedSalmonColorSuffix.test(suffix);
    if (
      !reviewedMainIngredientNonFoodContext.test(suffix) &&
      !embeddedKanaWord &&
      !sakeBeverage &&
      !salmonColorName
    ) {
      return true;
    }
    from = start + 1;
  }
  return false;
}

function containsRequestedMainIngredient(
  identityFoodTexts: readonly string[],
  requested: string,
): boolean {
  const normalizedRequested = normalizeFoodText(requested);
  const reviewedGroup = reviewedMainIngredientSynonymGroups.find((group) =>
    group.has(normalizedRequested),
  );
  if (reviewedGroup === undefined) {
    return identityFoodTexts.some((sourceText) => sourceText.includes(normalizedRequested));
  }
  return [...reviewedGroup].some((candidate) =>
    identityFoodTexts.some((sourceText) =>
      containsReviewedMainIngredientOccurrence(sourceText, candidate),
    ),
  );
}

/** 食事区分・ジャンル・時間・主食材・回避・在庫の共通検査（両 mode） */
function collectCommonMenuIssues(
  generated: GeneratedMenu,
  context: GenerationContext,
): MenuValidationIssue[] {
  const issues: MenuValidationIssue[] = [];
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

  const identityFoodTexts = generated.dishes
    .flatMap((dish) => [dish.name, dish.description, ...dish.ingredients.map(({ name }) => name)])
    .map(normalizeFoodText);
  const identityFoodText = identityFoodTexts.join("\u0000");
  for (const requested of context.submission.mainIngredients) {
    if (!containsRequestedMainIngredient(identityFoodTexts, requested)) {
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

  const requestText =
    context.targetMode === "idea"
      ? collectPlannerRequestText(context.submission)
      : context.safety.requestText;
  for (const kind of detectUnsupportedMedicalRequest(requestText)) {
    issues.push({
      code: "unsupported_medical_request",
      path: "requestText",
      message: `${kind} には対応していません`,
    });
  }
  return issues;
}

function finalizeValidated(
  generated: GeneratedMenu,
  labelConfirmations: readonly MenuLabelConfirmation[],
  safetyFingerprint: string,
  preferenceGaps: readonly PreferenceGapNote[] = [],
): MenuValidationResult {
  const validated = validatedMenuSchema.safeParse({
    ...generated,
    labelConfirmations,
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
    safetyFingerprint,
    preferenceGaps,
  };
}

/**
 * idea 出力: 家族向け取り分け・ラベル確認・family safety action を 0 件にし、
 * 人数は凍結提出の servings と一致させる。家族安全辞書は使わない。
 */
function validateIdeaMenu(
  generated: GeneratedMenu,
  context: IdeaGenerationContext,
): MenuValidationResult {
  const issues: MenuValidationIssue[] = [];
  if (generated.adaptations.length !== 0) {
    issues.push({
      code: "target_member_mismatch",
      path: "adaptations",
      message: "アイデア献立に家族向け取り分けは含められません",
    });
  }
  if (generated.labelConfirmations.length !== 0) {
    issues.push({
      code: "unexpected_label_confirmation",
      path: "labelConfirmations",
      message: "アイデア献立にラベル確認は含められません",
    });
  }
  const familyActions = generated.adaptations.flatMap((adaptation) => adaptation.safetyActions);
  if (familyActions.length !== 0) {
    issues.push({
      code: "target_member_mismatch",
      path: "adaptations.safetyActions",
      message: "アイデア献立に家族向け安全手順は含められません",
    });
  }
  if (generated.servings !== context.submission.servings) {
    issues.push({
      code: "servings_mismatch",
      path: "servings",
      message: "人数が指定と一致しません",
    });
  }
  // idea 型上 targetMembers / targetMemberIds は空固定。家族子行は adaptations 側で拒否済み
  issues.push(...collectCommonMenuIssues(generated, context));
  if (issues.length > 0) return { ok: false, issues };
  return finalizeValidated(generated, [], createIdeaSafetyFingerprint());
}

function validateHouseholdMenu(
  generated: GeneratedMenu,
  context: HouseholdGenerationContext,
): MenuValidationResult {
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
  const dictionaryInvalid =
    context.safety.dictionaryVersion !== dictionary.version ||
    dictionary.catalog.some((entry) => entry.catalogVersion !== dictionary.version) ||
    dictionary.aliases.some((alias) => alias.dictionaryVersion !== dictionary.version) ||
    [...registeredAllergenIds].some((allergenId) => {
      const catalogEntry = dictionary.catalog.find((entry) => entry.id === allergenId);
      return (
        catalogEntry === undefined ||
        !dictionary.aliases.some(
          (alias) =>
            alias.allergenId === allergenId &&
            alias.aliasKind === "direct" &&
            !alias.requiresLabelConfirmation &&
            normalizeFoodText(alias.normalizedAlias) ===
              normalizeFoodText(catalogEntry.displayName),
        )
      );
    });
  const foodRulesInvalid = context.safety.foodSafetyRules.some(
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

  issues.push(...collectCommonMenuIssues(generated, context));

  const easeAction = {
    small_pieces: "cut_small",
    boneless: "remove_bones",
    soft: "soften",
  } as const;
  // 量・辛さ hard 照合: AI がよく使う言い回しを許容する（過広義は避けつつ表記ゆれを吸収）。
  const portionSmallPattern =
    /少なめ|少な目|少なめに|少なめの|小盛り|小盛|少量|量を控|控えめの量|ひかえめの量|半分程度|半分くらい/u;
  const portionLargePattern =
    /多め|多めに|多めの|大盛り|大盛|増量|多め盛り|しっかりめ|多め量|多めに盛/u;
  const spiceNonePattern =
    /辛味なし|辛みなし|香辛料なし|スパイスなし|味付けなし|辛くしない|辛くなく|辛くない|辛いものを使わない|唐辛子なし|ピリ辛にしない|辛味を控|辛みを控|無香辛料|香辛料を使わない/u;
  const spiceMildPattern =
    /薄味|薄めの味|味を薄|薄味に|控えめ|味控えめ|塩分控えめ|甘口|少し甘め|あっさり|あっさりめ|ピリ辛を避/u;
  const identityFoodText = generated.dishes
    .flatMap((dish) => [dish.name, dish.description, ...dish.ingredients.map(({ name }) => name)])
    .map(normalizeFoodText)
    .join("\u0000");
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
      (preference.portionSize === "small" && portionSmallPattern.test(adaptationText)) ||
      (preference.portionSize === "large" && portionLargePattern.test(adaptationText));
    const spiceMatches =
      preference.spiceLevel === "regular" ||
      (preference.spiceLevel === "none" && spiceNonePattern.test(adaptationText)) ||
      (preference.spiceLevel === "mild" && spiceMildPattern.test(adaptationText));
    const actions = adaptations.flatMap((adaptation) => adaptation.safetyActions);
    const easeMatches = preference.easePreferences.every((ease) =>
      actions.some((action) => action.kind === easeAction[ease]),
    );
    // A-I7 方針: 量・辛さ・食べやすさは hard。苦手は soft gap（結果画面のみ表示）。
    if (adaptations.length === 0 || !portionMatches || !spiceMatches || !easeMatches) {
      issues.push({
        code: "member_preference_mismatch",
        path: `memberPreferences.${preference.anonymousMemberRef}`,
        message: "家族の取り分け条件が生成結果に反映されていません",
      });
    }
  }

  // A-C2 residual: 生成経路は targetMembers の表示名スナップショットを issue 本文に使う。
  const allergenMemberLabels = Object.fromEntries(
    context.targetMembers.map((member) => [member.anonymousRef, member.displayNameSnapshot.trim()]),
  );
  const allergenResult = evaluateAllergens(generated, context.safety, {
    memberLabels: allergenMemberLabels,
  });
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

  // hard を通過したあとだけ soft gap を集める（失敗時は結果画面に出ない）
  const preferenceGaps = collectDislikePreferenceGaps(generated, context.memberPreferences);

  const canonicalLabelConfirmations: readonly MenuLabelConfirmation[] =
    allergenResult.labelConfirmations.map((item) => ({
      ...item,
      confirmationStatus: "pending" as const,
      confirmedAt: null,
      confirmedBy: null,
    }));
  return finalizeValidated(
    generated,
    canonicalLabelConfirmations,
    createCurrentSafetyFingerprint(context.safety),
    preferenceGaps,
  );
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
  if (context.targetMode === "idea") {
    return validateIdeaMenu(parsed.data, context);
  }
  return validateHouseholdMenu(parsed.data, context);
}

export type { GenerationContext } from "./generation-context.js";
export type { CurrentSafetyContext, CurrentSafetyMember } from "./context.js";
export type { MenuValidationIssue, MenuValidationResult } from "../contracts/generation.js";
