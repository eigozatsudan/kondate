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
  /丸ごと|切らず|骨付きのまま|硬いまま|小さく切ら(?:ない|ないで)|小さく切れない|小さく切りません|細かく刻ま(?:ない|ないで)|細かく刻みません|4等分(?:しない|せず|しません)|四等分(?:しない|せず|しません)|縦に4つに(?:しない|せず|しません)|十分に煮(?:ない|ません)|やわらかくなるまで(?:加熱)?(?:しない|しません|せず)|中心まで(?:十分に)?加熱(?:しない|しません|せず)|骨を(?:完全に)?除(?:かない|かないで|きません)|骨を取り除(?:かない|かないで|きません)/u;

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
  const dishContradictionText = new Map(
    menu.dishes.map((dish) => [
      dish.id,
      sources
        .filter((source) => source.dishId === dish.id && source.sourceType !== "adaptation")
        .map((source) => source.text),
    ]),
  );
  const adaptationContradictionText = (dishId: string, anonymousMemberRef: string): string[] =>
    menu.adaptations
      .filter(
        (adaptation) =>
          adaptation.dishId === dishId && adaptation.anonymousMemberRef === anonymousMemberRef,
      )
      .flatMap((adaptation) => [
        adaptation.portionText,
        adaptation.additionalCutting,
        adaptation.additionalHeating,
        adaptation.additionalSeasoning,
        adaptation.servingCheck,
        ...adaptation.safetyActions.map((action) => action.instruction),
      ])
      .filter((text): text is string => text !== null);
  const ingredientName = new Map(
    menu.dishes.flatMap((dish) =>
      dish.ingredients.map((ingredient) => [ingredient.id, normalizeFoodText(ingredient.name)]),
    ),
  );
  const ingredientOwner = new Map(
    menu.dishes.flatMap((dish) =>
      dish.ingredients.map((ingredient) => [ingredient.id, dish.id] as const),
    ),
  );
  const instructionNamesIngredient = (instruction: string, ingredientId: string): boolean => {
    const expectedName = ingredientName.get(ingredientId);
    return expectedName !== undefined && normalizeFoodText(instruction).includes(expectedName);
  };
  const adaptationNamesIngredient = (
    adaptation: (typeof menu.adaptations)[number],
    ingredientId: string,
  ): boolean => {
    const expectedName = ingredientName.get(ingredientId);
    if (expectedName === undefined) return false;
    return normalizeFoodText(
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
    ).includes(expectedName);
  };
  const adaptationEvidenceText = (
    adaptation: (typeof menu.adaptations)[number],
    kind: SafetyAction["kind"],
    ingredientId: string,
  ): boolean => {
    const expectedName = ingredientName.get(ingredientId);
    if (expectedName === undefined) return false;
    return [
      ...(dishText.get(adaptation.dishId) ?? []),
      adaptation.portionText,
      adaptation.additionalCutting,
      adaptation.additionalHeating,
      adaptation.additionalSeasoning,
      adaptation.servingCheck,
    ]
      .filter((text): text is string => text !== null)
      .some(
        (text) => actionEvidence[kind].test(text) && normalizeFoodText(text).includes(expectedName),
      );
  };
  const isVerifiedAction = (
    entry: {
      action: SafetyAction;
      adaptation: (typeof menu.adaptations)[number];
    },
    memberRef: string,
    kind: SafetyAction["kind"],
    dishId: string,
    ingredientId: string,
  ): boolean => {
    const { action, adaptation } = entry;
    return (
      action.kind === kind &&
      action.dishId === dishId &&
      action.ingredientId === ingredientId &&
      action.anonymousMemberRef === memberRef &&
      adaptation.dishId === dishId &&
      adaptation.anonymousMemberRef === memberRef &&
      ingredientOwner.get(ingredientId) === dishId &&
      stepOwner.get(action.beforeRecipeStepId) === dishId &&
      stepOwner.get(adaptation.branchBeforeRecipeStepId) === dishId &&
      actionEvidence[kind].test(action.instruction) &&
      instructionNamesIngredient(action.instruction, ingredientId) &&
      adaptationEvidenceText(adaptation, kind, ingredientId) &&
      adaptationNamesIngredient(adaptation, ingredientId) &&
      !contradictionPattern.test(
        [
          ...(dishContradictionText.get(dishId) ?? []),
          ...adaptationContradictionText(dishId, memberRef),
        ].join(" "),
      )
    );
  };
  for (const member of context.members) {
    const memberActions = menu.adaptations
      .filter((adaptation) => adaptation.anonymousMemberRef === member.anonymousRef)
      .flatMap((adaptation) => adaptation.safetyActions.map((action) => ({ action, adaptation })));
    for (const required of member.requiredSafetyConstraints) {
      const applicableSources = sources.filter(
        (source) =>
          source.sourceType === "ingredient" &&
          source.dishId !== null &&
          source.ingredientId !== null &&
          context.foodSafetyRules.some(
            (rule) =>
              rule.appliesToAgeBands.includes(member.ageBand) &&
              rule.requiredSafetyTag === required &&
              rule.matchTerms.some((term) =>
                normalizeFoodText(source.text).includes(normalizeFoodText(term)),
              ),
          ),
      );
      const requiredPairs = new Map<string, { dishId: string; ingredientId: string }>();
      for (const source of applicableSources) {
        if (source.dishId === null || source.ingredientId === null) continue;
        requiredPairs.set(`${source.dishId}\u0000${source.ingredientId}`, {
          dishId: source.dishId,
          ingredientId: source.ingredientId,
        });
      }
      const missingEvidence =
        required === "cut_small"
          ? menu.dishes.some((dish) =>
              dish.ingredients.every((ingredient) =>
                memberActions.every(
                  (entry) =>
                    !isVerifiedAction(entry, member.anonymousRef, required, dish.id, ingredient.id),
                ),
              ),
            )
          : [...requiredPairs.values()].some(({ dishId, ingredientId }) =>
              memberActions.every(
                (entry) =>
                  !isVerifiedAction(entry, member.anonymousRef, required, dishId, ingredientId),
              ),
            );
      if (missingEvidence) {
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
        const requiredSafetyTag = rule.requiredSafetyTag;
        const sourceDishId = source.dishId;
        const sourceIngredientId = source.ingredientId;
        const matchingIngredientSources = matchedSources.filter(
          (candidate) =>
            candidate.sourceType === "ingredient" &&
            candidate.dishId === sourceDishId &&
            candidate.ingredientId !== null,
        );
        const hasEvidence =
          sourceDishId !== null &&
          requiredSafetyTag !== null &&
          (sourceIngredientId !== null
            ? matchingIngredientSources.some(
                (candidate) => candidate.ingredientId === sourceIngredientId,
              ) &&
              memberActions.some((entry) =>
                isVerifiedAction(
                  entry,
                  member.anonymousRef,
                  requiredSafetyTag,
                  sourceDishId,
                  sourceIngredientId,
                ),
              )
            : matchingIngredientSources.length > 0 &&
              matchingIngredientSources.every((candidate) => {
                const ingredientId = candidate.ingredientId;
                return (
                  ingredientId !== null &&
                  memberActions.some((entry) =>
                    isVerifiedAction(
                      entry,
                      member.anonymousRef,
                      requiredSafetyTag,
                      sourceDishId,
                      ingredientId,
                    ),
                  )
                );
              }));
        const contradictory = contradictionPattern.test(
          [
            source.text,
            ...(dishContradictionText.get(source.dishId ?? "") ?? []),
            ...adaptationContradictionText(source.dishId ?? "", member.anonymousRef),
          ].join(" "),
        );
        if (rule.ruleKind === "requires_tag" && contradictory) {
          issues.push({
            code: "safety_action_contradiction",
            path: source.sourcePath,
            message: "安全対応と料理手順が矛盾しています",
          });
        } else if (rule.ruleKind === "forbidden" || !hasEvidence) {
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
