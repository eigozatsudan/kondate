import type { AgeBand } from "../contracts/domain.js";
import type {
  GeneratedMenu,
  MenuValidationIssue,
  SafetyAction,
  ValidatedMenu,
} from "../contracts/generation.js";
import { collectMenuTextSources, normalizeFoodText } from "./allergens.js";
import type { CurrentSafetyContext } from "./context.js";

export type FoodSafetyRule = {
  id: string;
  appliesToAgeBands: readonly AgeBand[];
  matchTerms: readonly string[];
  ruleKind: "forbidden" | "requires_tag";
  requiredSafetyTag: SafetyAction["kind"] | null;
  userMessage: string;
  ruleVersion: string;
};

const actionEvidence: Record<SafetyAction["kind"], RegExp> = {
  remove_bones: /骨を(?:完全に)?除|骨を取り除|骨がないことを確認/u,
  cut_small: /小さく切|一口大以下|細かく刻/u,
  quarter_round_food: /4等分|四等分|縦に4つ/u,
  soften: /やわらかくなるまで|舌でつぶせる|十分に煮る/u,
  heat_thoroughly: /中心まで(?:十分に)?加熱|中心温度/u,
};

const contradictionPattern =
  /丸ごと|切らず|骨付きのまま|硬いまま|小さく切らない|細かく刻まない|4等分しない|四等分しない|縦に4つにしない|十分に煮ない|中心まで(?:十分に)?加熱しない|骨を(?:完全に)?除かない|骨を取り除かない/u;

export function evaluateFoodSafetyRules(
  menu: GeneratedMenu | ValidatedMenu,
  context: CurrentSafetyContext,
): readonly MenuValidationIssue[] {
  const sources = collectMenuTextSources(menu);
  const issues: MenuValidationIssue[] = [];
  const stepOwner = new Map(
    menu.dishes.flatMap((dish) => dish.steps.map((step) => [step.id, dish.id] as const)),
  );
  const dishText = new Map(
    menu.dishes.map((dish) => [
      dish.id,
      [dish.name, dish.description, ...dish.steps.map((step) => step.instruction)],
    ]),
  );
  const ingredientName = new Map(
    menu.dishes.flatMap((dish) =>
      dish.ingredients.map((ingredient) => [ingredient.id, normalizeFoodText(ingredient.name)]),
    ),
  );
  const instructionNamesIngredient = (instruction: string, ingredientId: string): boolean => {
    const expectedName = ingredientName.get(ingredientId);
    return expectedName !== undefined && normalizeFoodText(instruction).includes(expectedName);
  };
  const adaptationEvidenceText = (
    adaptation: (typeof menu.adaptations)[number],
    kind: SafetyAction["kind"],
  ): boolean =>
    actionEvidence[kind].test(
      [
        ...(dishText.get(adaptation.dishId) ?? []),
        adaptation.portionText,
        adaptation.additionalCutting,
        adaptation.additionalHeating,
        adaptation.additionalSeasoning,
        adaptation.servingCheck,
      ]
        .filter((text): text is string => text !== null)
        .join(" "),
    );
  for (const member of context.members) {
    const memberActions = menu.adaptations
      .filter((adaptation) => adaptation.anonymousMemberRef === member.anonymousRef)
      .flatMap((adaptation) => adaptation.safetyActions.map((action) => ({ action, adaptation })));
    for (const required of member.requiredSafetyConstraints) {
      const hasEvidence = memberActions.some(
        ({ action, adaptation }) =>
          action.kind === required &&
          action.anonymousMemberRef === member.anonymousRef &&
          stepOwner.get(action.beforeRecipeStepId) === action.dishId &&
          actionEvidence[action.kind].test(action.instruction) &&
          adaptationEvidenceText(adaptation, action.kind) &&
          !contradictionPattern.test(
            [
              ...(dishText.get(action.dishId) ?? []),
              adaptation.portionText,
              adaptation.additionalCutting,
              adaptation.additionalHeating,
              adaptation.additionalSeasoning,
              adaptation.servingCheck,
              ...adaptation.safetyActions.map((item) => item.instruction),
            ]
              .filter((text): text is string => text !== null)
              .join(" "),
          ),
      );
      if (!hasEvidence) {
        issues.push({
          code: "required_safety_action",
          path: `members.${member.anonymousRef}.requiredSafetyConstraints`,
          message: `${required} を満たす工程がありません`,
        });
      }
    }
    for (const rule of context.foodSafetyRules) {
      if (!rule.appliesToAgeBands.includes(member.ageBand)) continue;
      const matchedSources = sources.filter((item) =>
        rule.matchTerms.some((term) =>
          normalizeFoodText(item.text).includes(normalizeFoodText(term)),
        ),
      );
      for (const source of matchedSources) {
        const evidence =
          source.ingredientId === null || source.dishId === null || rule.requiredSafetyTag === null
            ? undefined
            : memberActions.find(
                ({ action, adaptation }) =>
                  action.kind === rule.requiredSafetyTag &&
                  action.dishId === source.dishId &&
                  action.ingredientId === source.ingredientId &&
                  action.anonymousMemberRef === member.anonymousRef &&
                  stepOwner.get(action.beforeRecipeStepId) === source.dishId &&
                  actionEvidence[action.kind].test(action.instruction) &&
                  instructionNamesIngredient(action.instruction, source.ingredientId) &&
                  adaptationEvidenceText(adaptation, action.kind),
              );
        const adaptationText = memberActions
          .filter(({ action }) => action.dishId === source.dishId)
          .flatMap(({ adaptation }) => [
            adaptation.portionText,
            adaptation.additionalCutting,
            adaptation.additionalHeating,
            adaptation.additionalSeasoning,
            adaptation.servingCheck,
            ...adaptation.safetyActions.map((action) => action.instruction),
          ])
          .filter((text): text is string => text !== null);
        const contradictory = contradictionPattern.test(
          [source.text, ...(dishText.get(source.dishId ?? "") ?? []), ...adaptationText].join(" "),
        );
        if (rule.ruleKind === "forbidden" || evidence === undefined || contradictory) {
          issues.push({
            code: "age_shape_rule",
            path: source.sourcePath,
            message: rule.userMessage,
          });
        }
      }
    }
  }
  return issues;
}
