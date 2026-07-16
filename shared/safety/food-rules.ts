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

type ActionEvidenceAlternative = {
  affirmativePattern: RegExp;
  negatedSuffixPattern: RegExp;
};

const actionEvidence: Record<SafetyAction["kind"], readonly ActionEvidenceAlternative[]> = {
  remove_bones: [
    {
      affirmativePattern: /骨を(?:完全に)?除/u,
      negatedSuffixPattern:
        /^(?:かない|かず|きません|けない|けません|去できない|去できません|くことができない|くことができません)/u,
    },
    {
      affirmativePattern: /骨を取り除/u,
      negatedSuffixPattern:
        /^(?:かない|かず|きません|けない|けません|くことができない|くことができません)/u,
    },
    {
      affirmativePattern: /骨がないことを確認/u,
      negatedSuffixPattern: /^(?:しない|せず|しません|できない|できません)/u,
    },
  ],
  cut_small: [
    {
      affirmativePattern: /小さく切/u,
      negatedSuffixPattern:
        /^(?!りすぎない)(?:らない|らず|れない|れません|りません|ることができない|ることができません)/u,
    },
    {
      affirmativePattern: /一口大以下/u,
      negatedSuffixPattern: /^(?:(?:に|には)?(?:しない|せず|しません|できない|できません))/u,
    },
    {
      affirmativePattern: /細かく刻/u,
      negatedSuffixPattern:
        /^(?:まない|まず|めない|めません|みません|むことができない|むことができません)/u,
    },
  ],
  quarter_round_food: [
    {
      affirmativePattern: /4等分/u,
      negatedSuffixPattern:
        /^(?:しない|せず|しません|できない|できません|することができない|することができません)/u,
    },
    {
      affirmativePattern: /四等分/u,
      negatedSuffixPattern:
        /^(?:しない|せず|しません|できない|できません|することができない|することができません)/u,
    },
    {
      affirmativePattern: /縦に4つ/u,
      negatedSuffixPattern:
        /^(?:に)?(?:しない|せず|しません|できない|できません|することができない|することができません)/u,
    },
  ],
  soften: [
    {
      affirmativePattern: /やわらかくなるまで/u,
      negatedSuffixPattern:
        /^(?:加熱(?:しない|しません|せず|できない|できません|することができない|することができません)|しない|しません|せず)/u,
    },
    {
      affirmativePattern: /舌でつぶせる/u,
      negatedSuffixPattern: /(?!)/u,
    },
    {
      affirmativePattern: /十分に煮/u,
      negatedSuffixPattern: /^(?:ない|ません|ることができない|ることができません)/u,
    },
  ],
  heat_thoroughly: [
    {
      affirmativePattern: /中心まで(?:十分に)?加熱/u,
      negatedSuffixPattern:
        /^(?:しない|しません|せず|できない|できません|することができない|することができません)/u,
    },
    {
      affirmativePattern: /中心温度/u,
      negatedSuffixPattern:
        /^(?:(?:を)?(?:確認)?(?:しない|しません|せず)|(?:を)?確認(?:できない|できません|することができない|することができません))/u,
    },
  ],
};

const independentContradictionPattern = /丸ごと|切らず|骨付きのまま|硬いまま/u;

function hasAffirmativeActionEvidence(text: string, kind: SafetyAction["kind"]): boolean {
  for (const alternative of actionEvidence[kind]) {
    const globalAffirmativePattern = new RegExp(
      alternative.affirmativePattern.source,
      `${alternative.affirmativePattern.flags}g`,
    );
    for (const match of text.matchAll(globalAffirmativePattern)) {
      const matchEnd = (match.index ?? 0) + match[0].length;
      if (!alternative.negatedSuffixPattern.test(text.slice(matchEnd))) return true;
    }
  }

  return false;
}

function hasActionContradiction(text: string, kind: SafetyAction["kind"]): boolean {
  if (independentContradictionPattern.test(text)) return true;

  // 否定は肯定語と同じ文節にだけ結び付け、後続の安全な代替条件で肯定工程を失効させない。
  return (
    actionEvidence[kind].some(({ affirmativePattern }) => affirmativePattern.test(text)) &&
    !hasAffirmativeActionEvidence(text, kind)
  );
}

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
        (text) =>
          hasAffirmativeActionEvidence(text, kind) &&
          normalizeFoodText(text).includes(expectedName),
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
      hasAffirmativeActionEvidence(action.instruction, kind) &&
      instructionNamesIngredient(action.instruction, ingredientId) &&
      adaptationEvidenceText(adaptation, kind, ingredientId) &&
      adaptationNamesIngredient(adaptation, ingredientId) &&
      ![
        ...(dishContradictionText.get(dishId) ?? []),
        ...adaptationContradictionText(dishId, memberRef),
      ].some((text) => hasActionContradiction(text, kind))
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
        const contradictory =
          requiredSafetyTag !== null &&
          [
            source.text,
            ...(dishContradictionText.get(source.dishId ?? "") ?? []),
            ...adaptationContradictionText(source.dishId ?? "", member.anonymousRef),
          ].some((text) => hasActionContradiction(text, requiredSafetyTag));
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
