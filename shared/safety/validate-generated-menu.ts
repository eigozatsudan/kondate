import {
  type GeneratedLabelConfirmation,
  type MenuLabelConfirmation,
  type MenuValidationIssue,
  type MenuValidationResult,
  generatedMenuSchema,
  validatedMenuSchema,
} from "../contracts/generation.js";
import { collectMenuTextSources, evaluateAllergens, normalizeFoodText } from "./allergens.js";
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
  if (!sameSet(targetIds, requestedTargetIds) || !sameSet(targetRefs, safetyRefs)) {
    issues.push({
      code: "target_member_mismatch",
      path: "targetMembers",
      message: "対象メンバーが生成条件と一致しません",
    });
  }
  const returnedRefs = new Set(generated.adaptations.map((item) => item.anonymousMemberRef));
  if ([...returnedRefs].some((memberRef) => !targetRefs.has(memberRef))) {
    issues.push({
      code: "target_member_mismatch",
      path: "adaptations",
      message: "対象外メンバーの取り分けが含まれています",
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

  const foodText = collectMenuTextSources(generated)
    .map((source) => normalizeFoodText(source.text))
    .join("\u0000");
  for (const requested of context.submission.mainIngredients) {
    if (!foodText.includes(normalizeFoodText(requested))) {
      issues.push({
        code: "main_ingredient_missing",
        path: "dishes",
        message: `${requested} が含まれていません`,
      });
    }
  }
  for (const avoided of context.submission.avoidIngredients) {
    if (foodText.includes(normalizeFoodText(avoided))) {
      issues.push({
        code: "avoid_ingredient_used",
        path: "dishes",
        message: `${avoided} は使用できません`,
      });
    }
  }

  const linkedDishIds = new Map<string, Set<string>>();
  for (const dish of generated.dishes) {
    for (const ingredient of dish.ingredients) {
      if (ingredient.pantrySelectionId !== null) {
        const dishIds = linkedDishIds.get(ingredient.pantrySelectionId) ?? new Set<string>();
        dishIds.add(dish.id);
        linkedDishIds.set(ingredient.pantrySelectionId, dishIds);
      }
    }
  }
  for (const usage of generated.pantryUsage) {
    if (usage.usageStatus !== "used") continue;
    const linked = linkedDishIds.get(usage.selectionId) ?? new Set<string>();
    if (!sameSet(linked, new Set(usage.dishIds))) {
      issues.push({
        code: "pantry_usage_link_mismatch",
        path: `pantryUsage.${usage.selectionId}`,
        message: "在庫使用先と料理食材の参照が一致しません",
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
