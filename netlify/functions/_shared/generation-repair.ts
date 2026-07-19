import { z } from "zod";

export const generationRepairCodes = [
  "invalid_provider_menu",
  "uuid_in_provider_output",
  "duplicate_ref",
  "dangling_ref",
  "wrong_kind_ref",
  "unknown_member_ref",
  "unknown_pantry_ref",
  "pantry_priority_mismatch",
  "pantry_usage_duplicate",
  "must_use_missing",
  "pantry_usage_link_mismatch",
  "label_source_invalid",
  "pantry_name_mismatch",
  "pantry_unit_mismatch",
  "invalid_menu_structure",
  "target_member_mismatch",
  "member_preference_mismatch",
  "safety_context_incomplete",
  "allergy_unconfirmed",
  "allergen_missing",
  "unmapped_custom_allergy",
  "unsupported_diet_unconfirmed",
  "unsupported_diet_present",
  "unsupported_medical_request",
  "meal_type_mismatch",
  "genre_mismatch",
  "time_limit_exceeded",
  "required_dish_role_missing",
  "main_ingredient_missing",
  "avoid_ingredient_used",
  "pantry_selection_mismatch",
  "prefer_use_reason_missing",
  "direct_allergen_match",
  "missing_label_confirmation",
  "unexpected_label_confirmation",
  "age_shape_rule",
  "required_safety_action",
  "safety_action_contradiction",
] as const;

export type GenerationRepairCode = (typeof generationRepairCodes)[number];
export type GenerationRepairDiagnostic = Readonly<{
  code: GenerationRepairCode;
  path: string;
}>;

export const repairPathByCode = {
  invalid_provider_menu: "menu",
  uuid_in_provider_output: "menu",
  duplicate_ref: "menu.references",
  dangling_ref: "menu.references",
  wrong_kind_ref: "menu.labelConfirmations.source",
  unknown_member_ref: "menu.members",
  unknown_pantry_ref: "menu.pantryUsage",
  pantry_priority_mismatch: "menu.pantryUsage.priority",
  pantry_usage_duplicate: "menu.pantryUsage",
  must_use_missing: "menu.pantryUsage",
  pantry_usage_link_mismatch: "menu.pantryUsage.dishRefs",
  label_source_invalid: "menu.labelConfirmations.source",
  pantry_name_mismatch: "menu.labelConfirmations.sourceText",
  pantry_unit_mismatch: "menu.pantryUsage.unit",
  invalid_menu_structure: "menu",
  target_member_mismatch: "menu.members",
  member_preference_mismatch: "menu.adaptations",
  safety_context_incomplete: "menu.safety",
  allergy_unconfirmed: "menu.safety",
  allergen_missing: "menu.safety",
  unmapped_custom_allergy: "menu.safety",
  unsupported_diet_unconfirmed: "menu.safety",
  unsupported_diet_present: "menu.safety",
  unsupported_medical_request: "menu.safety",
  meal_type_mismatch: "menu.mealType",
  genre_mismatch: "menu.cuisineGenre",
  time_limit_exceeded: "menu.timeline",
  required_dish_role_missing: "menu.dishes",
  main_ingredient_missing: "menu.dishes",
  avoid_ingredient_used: "menu.dishes.ingredients",
  pantry_selection_mismatch: "menu.pantryUsage",
  prefer_use_reason_missing: "menu.pantryUsage.unusedReason",
  direct_allergen_match: "menu.dishes.ingredients",
  missing_label_confirmation: "menu.labelConfirmations",
  unexpected_label_confirmation: "menu.labelConfirmations",
  age_shape_rule: "menu.safetyActions",
  required_safety_action: "menu.safetyActions",
  safety_action_contradiction: "menu.safetyActions",
} as const satisfies Record<GenerationRepairCode, string>;

const generationRepairCodeSchema = z.enum(generationRepairCodes);

export function toRepairDiagnostics(
  issues: readonly { code: string; path?: string; message?: string }[],
): readonly GenerationRepairDiagnostic[] {
  const seen = new Set<GenerationRepairCode>();
  const diagnostics: GenerationRepairDiagnostic[] = [];
  for (const issue of issues) {
    const parsed = generationRepairCodeSchema.safeParse(issue.code);
    const code: GenerationRepairCode = parsed.success ? parsed.data : "invalid_provider_menu";
    if (seen.has(code)) continue;
    seen.add(code);
    diagnostics.push({ code, path: repairPathByCode[code] });
    if (diagnostics.length === 64) break;
  }
  return diagnostics;
}

export class GenerationOutputError extends Error {
  readonly issues: readonly GenerationRepairDiagnostic[];

  constructor(codes: readonly GenerationRepairCode[]) {
    super("invalid_generation_output");
    this.name = "GenerationOutputError";
    this.issues = toRepairDiagnostics(codes.map((code) => ({ code })));
  }
}
