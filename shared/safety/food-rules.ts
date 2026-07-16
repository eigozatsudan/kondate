import type { AgeBand } from "../contracts/domain.js";
import type {
  GeneratedMenu,
  MenuValidationIssue,
  SafetyAction,
  ValidatedMenu,
} from "../contracts/generation.js";
import { collectMenuTextSources, normalizeFoodText, type MenuTextSource } from "./allergens.js";
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
  stemPattern: RegExp;
  affirmativeSuffixPattern: RegExp;
  negatedSuffixPattern: RegExp;
};

const actionEvidence: Record<SafetyAction["kind"], readonly ActionEvidenceAlternative[]> = {
  remove_bones: [
    {
      stemPattern: /骨を(?:完全に)?除/u,
      affirmativeSuffixPattern:
        /^(?:く(?:ことを確認(?:する|した|してください))?|いた(?:ことを確認(?:する|した))?|(?:き|いて)(?:(?:細かく)?ほぐす|骨がないことを確認(?:できない|できません)場合は(?:提供|配膳|盛り付け)(?:を)?しない)?|去(?:する|した))$/u,
      negatedSuffixPattern:
        /^(?:かない|かず|きません|けない|けません|去できない|去できません|くことができない|くことができません)/u,
    },
    {
      stemPattern: /骨を取り除/u,
      affirmativeSuffixPattern:
        /^(?:く(?:ことを確認(?:する|した|してください))?|いた(?:ことを確認(?:する|した))?|(?:き|いて)(?:(?:細かく)?ほぐす|骨がないことを確認(?:できない|できません)場合は(?:提供|配膳|盛り付け)(?:を)?しない)?)$/u,
      negatedSuffixPattern:
        /^(?:かない|かず|きません|けない|けません|くことができない|くことができません)/u,
    },
    {
      stemPattern: /骨がないことを確認/u,
      affirmativeSuffixPattern: /^(?:する|した|できた)$/u,
      negatedSuffixPattern: /^(?:しない|せず|しません|できない|できません)/u,
    },
  ],
  cut_small: [
    {
      stemPattern: /小さく切/u,
      affirmativeSuffixPattern:
        /^(?:る(?:ことを確認(?:する|した))?|ったことを確認(?:する|した)|り(?:すぎないように調整する)?)$/u,
      negatedSuffixPattern:
        /^(?!りすぎない)(?:らない|らず|れない|れません|りません|ることができない|ることができません)/u,
    },
    {
      stemPattern: /一口大以下/u,
      affirmativeSuffixPattern: /^(?:に(?:切る|する)|)$/u,
      negatedSuffixPattern: /^(?:(?:に|には)?(?:しない|せず|しません|できない|できません))/u,
    },
    {
      stemPattern: /細かく刻/u,
      affirmativeSuffixPattern: /^(?:む|んだ|み)$/u,
      negatedSuffixPattern:
        /^(?:まない|まず|めない|めません|みません|むことができない|むことができません)/u,
    },
  ],
  quarter_round_food: [
    {
      stemPattern: /4等分/u,
      affirmativeSuffixPattern: /^(?:する|した)?$/u,
      negatedSuffixPattern:
        /^(?:しない|せず|しません|できない|できません|することができない|することができません)/u,
    },
    {
      stemPattern: /四等分/u,
      affirmativeSuffixPattern: /^(?:する|した)?$/u,
      negatedSuffixPattern:
        /^(?:しない|せず|しません|できない|できません|することができない|することができません)/u,
    },
    {
      stemPattern: /縦に4つ/u,
      affirmativeSuffixPattern: /^(?:に切る|にする)?$/u,
      negatedSuffixPattern:
        /^(?:に)?(?:しない|せず|しません|できない|できません|することができない|することができません)/u,
    },
  ],
  soften: [
    {
      stemPattern: /やわらかくなるまで/u,
      affirmativeSuffixPattern: /^(?:加熱する|煮る)$/u,
      negatedSuffixPattern:
        /^(?:加熱(?:しない|しません|せず|できない|できません|することができない|することができません)|しない|しません|せず)/u,
    },
    {
      stemPattern: /舌でつぶせる/u,
      affirmativeSuffixPattern: /^(?:やわらかさまで(?:加熱する|煮る))?$/u,
      negatedSuffixPattern: /(?!)/u,
    },
    {
      stemPattern: /十分に煮/u,
      affirmativeSuffixPattern: /^(?:る|た)$/u,
      negatedSuffixPattern: /^(?:ない|ません|ることができない|ることができません)/u,
    },
  ],
  heat_thoroughly: [
    {
      stemPattern: /中心まで(?:十分に)?加熱/u,
      affirmativeSuffixPattern: /^(?:する|した)$/u,
      negatedSuffixPattern:
        /^(?:しない|しません|せず|できない|できません|することができない|することができません)/u,
    },
    {
      stemPattern: /中心温度/u,
      affirmativeSuffixPattern: /^(?:を確認(?:する|した))$/u,
      negatedSuffixPattern:
        /^(?:(?:を)?(?:確認)?(?:しない|しません|せず)|(?:を)?確認(?:できない|できません|することができない|することができません))/u,
    },
  ],
};

const independentContradictionPattern = /丸ごと|切らず|骨付きのまま|硬いまま/u;
const actionSpecificContradictionPattern: Partial<Record<SafetyAction["kind"], RegExp>> = {
  remove_bones: /骨(?:を残(?:す|して)|が残(?:る|ったまま))/u,
};
const periphrasticNegationPattern =
  /^(?:(?:く|る|む|する|にする|を確認する)?ことなく|いたりはしない|(?:(?:く|る|む|する|にする|を確認する)?(?:という)?(?:予定|必要|つもり)(?:では|は|が)?(?:ない|ないです|ありません)))/u;
const sentenceBoundaryPattern = /[。！？!?；;\r\n]+/u;
const localClauseBoundaryPattern = /[、,，:：]+/u;
const safeFallbackConsequencePattern = /^場合は(?:提供|配膳|盛り付け)(?:を)?しない/u;

function isNegatedActionSuffix(suffix: string, alternative: ActionEvidenceAlternative): boolean {
  return alternative.negatedSuffixPattern.test(suffix) || periphrasticNegationPattern.test(suffix);
}

function isSafeFallbackSuffix(suffix: string, alternative: ActionEvidenceAlternative): boolean {
  for (const pattern of [alternative.negatedSuffixPattern, periphrasticNegationPattern]) {
    const match = pattern.exec(suffix);
    if (match !== null && safeFallbackConsequencePattern.test(suffix.slice(match[0].length))) {
      return true;
    }
  }

  return false;
}

type TextOccurrence = {
  index: number;
  length: number;
};

function findPatternOccurrences(text: string, pattern: RegExp): readonly TextOccurrence[] {
  const globalPattern = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
  return [...text.matchAll(globalPattern)].map((match) => ({
    index: match.index,
    length: match[0].length,
  }));
}

function findAffirmativeActionOccurrences(
  text: string,
  kind: SafetyAction["kind"],
): readonly TextOccurrence[] {
  const normalizedText = normalizeFoodText(text);
  const occurrences: TextOccurrence[] = [];

  for (const alternative of actionEvidence[kind]) {
    for (const occurrence of findPatternOccurrences(normalizedText, alternative.stemPattern)) {
      const suffix = normalizedText.slice(occurrence.index + occurrence.length);
      const suffixMatch = alternative.affirmativeSuffixPattern.exec(suffix);
      if (suffixMatch !== null) {
        occurrences.push({
          index: occurrence.index,
          length: occurrence.length + suffixMatch[0].length,
        });
      }
    }
  }

  return occurrences;
}

function findNegatedActionOccurrences(
  text: string,
  kind: SafetyAction["kind"],
): readonly TextOccurrence[] {
  const normalizedText = normalizeFoodText(text);
  const occurrences: TextOccurrence[] = [];

  for (const alternative of actionEvidence[kind]) {
    for (const occurrence of findPatternOccurrences(normalizedText, alternative.stemPattern)) {
      const suffix = normalizedText.slice(occurrence.index + occurrence.length);
      if (
        isNegatedActionSuffix(suffix, alternative) &&
        !isSafeFallbackSuffix(suffix, alternative)
      ) {
        occurrences.push(occurrence);
      }
    }
  }

  return occurrences;
}

function hasNegatedActionEvidence(text: string, kind: SafetyAction["kind"]): boolean {
  return findNegatedActionOccurrences(text, kind).length > 0;
}

function findUncoveredIngredientOccurrences(
  text: string,
  normalizedDishIngredientNames: readonly string[],
): readonly { name: string; index: number }[] {
  const uniqueNames = [...new Set(normalizedDishIngredientNames)];
  const occurrences: { name: string; index: number }[] = [];

  for (const name of uniqueNames) {
    let index = text.indexOf(name);
    while (index >= 0) {
      const end = index + name.length;
      const covered = uniqueNames.some((otherName) => {
        if (otherName.length <= name.length || !otherName.includes(name)) return false;
        let otherIndex = text.indexOf(otherName);
        while (otherIndex >= 0 && otherIndex <= index) {
          if (otherIndex + otherName.length >= end) return true;
          otherIndex = text.indexOf(otherName, otherIndex + 1);
        }
        return false;
      });
      if (!covered) occurrences.push({ name, index });
      index = text.indexOf(name, index + 1);
    }
  }

  return occurrences;
}

function resolveOccurrenceIngredientName(
  normalizedClause: string,
  occurrenceIndex: number,
  normalizedPreviousClause: string,
  normalizedDishIngredientNames: readonly string[],
): string | null {
  const localCandidates = findUncoveredIngredientOccurrences(
    normalizedClause,
    normalizedDishIngredientNames,
  ).filter((candidate) => candidate.index < occurrenceIndex);
  const nearestIndex = Math.max(...localCandidates.map((candidate) => candidate.index));
  const nearestNames = new Set(
    localCandidates
      .filter((candidate) => candidate.index === nearestIndex)
      .map((candidate) => candidate.name),
  );
  if (nearestNames.size === 1) return [...nearestNames][0] ?? null;
  if (localCandidates.length > 0) return null;

  // 読点後の省略主語は、直前節で対象食材が一意な場合に限って引き継ぐ。
  const previousNames = new Set(
    findUncoveredIngredientOccurrences(normalizedPreviousClause, normalizedDishIngredientNames).map(
      (candidate) => candidate.name,
    ),
  );
  return previousNames.size === 1 ? ([...previousNames][0] ?? null) : null;
}

function hasIngredientBoundActionEvidence(
  text: string,
  kind: SafetyAction["kind"],
  normalizedIngredientName: string,
  normalizedDishIngredientNames: readonly string[],
): boolean {
  return text.split(sentenceBoundaryPattern).some((sentence) => {
    const clauses = sentence.split(localClauseBoundaryPattern);
    return clauses.some((clause, index) => {
      const normalizedClause = normalizeFoodText(clause);
      const normalizedPreviousClause = normalizeFoodText(clauses[index - 1] ?? "");
      return findAffirmativeActionOccurrences(normalizedClause, kind).some(
        (occurrence) =>
          resolveOccurrenceIngredientName(
            normalizedClause,
            occurrence.index,
            normalizedPreviousClause,
            normalizedDishIngredientNames,
          ) === normalizedIngredientName,
      );
    });
  });
}

function hasActionContradiction(text: string, kind: SafetyAction["kind"]): boolean {
  const normalizedText = normalizeFoodText(text);
  if (independentContradictionPattern.test(normalizedText)) return true;
  if (actionSpecificContradictionPattern[kind]?.test(normalizedText) === true) return true;

  // 同じ文章に肯定工程があっても、後から明示された否定を相殺させない。
  return hasNegatedActionEvidence(text, kind);
}

function findActionContradictionOccurrences(
  text: string,
  kind: SafetyAction["kind"],
): readonly TextOccurrence[] {
  const normalizedText = normalizeFoodText(text);
  const actionSpecificPattern = actionSpecificContradictionPattern[kind];
  return [
    ...findPatternOccurrences(normalizedText, independentContradictionPattern),
    ...(actionSpecificPattern === undefined
      ? []
      : findPatternOccurrences(normalizedText, actionSpecificPattern)),
    ...findNegatedActionOccurrences(normalizedText, kind),
  ];
}

function hasIngredientBoundActionContradiction(
  text: string,
  kind: SafetyAction["kind"],
  normalizedIngredientName: string,
  normalizedDishIngredientNames: readonly string[],
): boolean {
  return text.split(sentenceBoundaryPattern).some((sentence) => {
    const clauses = sentence.split(localClauseBoundaryPattern);
    return clauses.some((clause, index) => {
      const normalizedClause = normalizeFoodText(clause);
      const normalizedPreviousClause = normalizeFoodText(clauses[index - 1] ?? "");
      return findActionContradictionOccurrences(normalizedClause, kind).some(
        (occurrence) =>
          resolveOccurrenceIngredientName(
            normalizedClause,
            occurrence.index,
            normalizedPreviousClause,
            normalizedDishIngredientNames,
          ) === normalizedIngredientName,
      );
    });
  });
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
  const dishContradictionSources = new Map(
    menu.dishes.map((dish) => [
      dish.id,
      sources.filter((source) => source.dishId === dish.id && source.sourceType !== "adaptation"),
    ]),
  );
  const adaptationContradictionSources = (
    dishId: string,
    anonymousMemberRef: string,
  ): MenuTextSource[] => {
    const adaptationIds = new Set(
      menu.adaptations
        .filter(
          (adaptation) =>
            adaptation.dishId === dishId && adaptation.anonymousMemberRef === anonymousMemberRef,
        )
        .map((adaptation) => adaptation.id),
    );
    return sources.filter(
      (source) => source.sourceType === "adaptation" && adaptationIds.has(source.sourceId),
    );
  };
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
  const dishIngredientIds = new Map(
    menu.dishes.map((dish) => [dish.id, dish.ingredients.map((ingredient) => ingredient.id)]),
  );
  const dishIngredientNames = new Map(
    menu.dishes.map((dish) => [
      dish.id,
      dish.ingredients.map((ingredient) => normalizeFoodText(ingredient.name)),
    ]),
  );
  const sourceContradictsIngredient = (
    source: MenuTextSource,
    kind: SafetyAction["kind"],
    dishId: string,
    ingredientId: string,
  ): boolean => {
    const expectedName = ingredientName.get(ingredientId);
    if (expectedName === undefined) return false;
    if (source.ingredientId !== null) {
      if (source.ingredientId !== ingredientId) return false;
      if (source.sourceType === "ingredient") return hasActionContradiction(source.text, kind);

      const normalizedDishNames = dishIngredientNames.get(dishId) ?? [];
      if (
        hasIngredientBoundActionContradiction(source.text, kind, expectedName, normalizedDishNames)
      ) {
        return true;
      }

      // 対象IDだけを持つ工程では対象名の省略を許すが、別食材を明記した矛盾は対象へ転嫁しない。
      const normalizedSource = normalizeFoodText(source.text);
      return (
        !normalizedDishNames.some((name) => normalizedSource.includes(name)) &&
        hasActionContradiction(source.text, kind)
      );
    }
    if (
      hasIngredientBoundActionContradiction(
        source.text,
        kind,
        expectedName,
        dishIngredientNames.get(dishId) ?? [],
      )
    ) {
      return true;
    }

    // 対象名を省略した矛盾は、料理内の食材が一意な場合だけその食材へ結び付ける。
    const candidateIds = dishIngredientIds.get(dishId) ?? [];
    return (
      candidateIds.length === 1 &&
      candidateIds[0] === ingredientId &&
      hasActionContradiction(source.text, kind)
    );
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
      .some((text) =>
        hasIngredientBoundActionEvidence(
          text,
          kind,
          expectedName,
          dishIngredientNames.get(adaptation.dishId) ?? [],
        ),
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
    const expectedIngredientName = ingredientName.get(ingredientId);
    return (
      expectedIngredientName !== undefined &&
      action.kind === kind &&
      action.dishId === dishId &&
      action.ingredientId === ingredientId &&
      action.anonymousMemberRef === memberRef &&
      adaptation.dishId === dishId &&
      adaptation.anonymousMemberRef === memberRef &&
      ingredientOwner.get(ingredientId) === dishId &&
      stepOwner.get(action.beforeRecipeStepId) === dishId &&
      stepOwner.get(adaptation.branchBeforeRecipeStepId) === dishId &&
      hasIngredientBoundActionEvidence(
        action.instruction,
        kind,
        expectedIngredientName,
        dishIngredientNames.get(dishId) ?? [],
      ) &&
      adaptationEvidenceText(adaptation, kind, ingredientId) &&
      ![
        ...(dishContradictionSources.get(dishId) ?? []),
        ...adaptationContradictionSources(dishId, memberRef),
      ].some((source) => sourceContradictsIngredient(source, kind, dishId, ingredientId))
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
      const normalizedMatchTerms = rule.matchTerms.map(normalizeFoodText);
      const matchedSources = sources.filter((item) =>
        normalizedMatchTerms.some((term) => normalizeFoodText(item.text).includes(term)),
      );
      for (const source of matchedSources) {
        const requiredSafetyTag = rule.requiredSafetyTag;
        const sourceDishId = source.dishId;
        const sourceIngredientId = source.ingredientId;
        const sourceMatchTerms = normalizedMatchTerms.filter((term) =>
          normalizeFoodText(source.text).includes(term),
        );
        const matchingIngredientSourcesForTerm = (term: string) =>
          matchedSources.filter(
            (candidate) =>
              candidate.sourceType === "ingredient" &&
              candidate.dishId !== null &&
              candidate.ingredientId !== null &&
              (sourceDishId === null || candidate.dishId === sourceDishId) &&
              // 所属料理のない工程は、同じ語で特定できる実食材だけへmenu全体で結合する。
              normalizeFoodText(candidate.text).includes(term),
          );
        const matchingIngredientSources = sourceMatchTerms.flatMap(
          matchingIngredientSourcesForTerm,
        );
        const hasEvidence =
          requiredSafetyTag !== null &&
          (sourceIngredientId !== null
            ? sourceDishId !== null &&
              matchingIngredientSources.some(
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
            : sourceMatchTerms.length > 0 &&
              sourceMatchTerms.every((term) => {
                const termCandidates = matchingIngredientSourcesForTerm(term);
                return (
                  termCandidates.length > 0 &&
                  termCandidates.every((candidate) => {
                    const dishId = candidate.dishId;
                    const ingredientId = candidate.ingredientId;
                    return (
                      dishId !== null &&
                      ingredientId !== null &&
                      memberActions.some((entry) =>
                        isVerifiedAction(
                          entry,
                          member.anonymousRef,
                          requiredSafetyTag,
                          dishId,
                          ingredientId,
                        ),
                      )
                    );
                  })
                );
              }));
        const contradictionPairs = new Map<string, { dishId: string; ingredientId: string }>();
        if (sourceDishId !== null && sourceIngredientId !== null) {
          contradictionPairs.set(`${sourceDishId}\u0000${sourceIngredientId}`, {
            dishId: sourceDishId,
            ingredientId: sourceIngredientId,
          });
        }
        for (const candidate of matchingIngredientSources) {
          if (candidate.dishId === null || candidate.ingredientId === null) continue;
          contradictionPairs.set(`${candidate.dishId}\u0000${candidate.ingredientId}`, {
            dishId: candidate.dishId,
            ingredientId: candidate.ingredientId,
          });
        }
        const contradictory =
          requiredSafetyTag !== null &&
          [...contradictionPairs.values()].some(({ dishId, ingredientId }) =>
            [
              source,
              ...(dishContradictionSources.get(dishId) ?? []),
              ...adaptationContradictionSources(dishId, member.anonymousRef),
            ].some((candidate) =>
              sourceContradictsIngredient(candidate, requiredSafetyTag, dishId, ingredientId),
            ),
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
