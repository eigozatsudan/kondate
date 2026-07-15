import { describe, expect, it } from "vitest";
import { currentFoodSafetyRulesV1 } from "../../../shared/safety/current-food-safety-rules.v1.js";
import {
  buildCurrentSafetyContext,
  captureMemberLabels,
  currentAllergenAliasManifest,
  currentAllergenCatalogIds,
  currentFoodSafetyRuleIds,
} from "./current-safety.js";

const userId = "70000000-0000-4000-8000-000000000001";
const firstMemberId = "71000000-0000-4000-8000-000000000001";
const secondMemberId = "71000000-0000-4000-8000-000000000002";

function completeMember(id: string, owner = userId, status = "complete") {
  return {
    id,
    user_id: owner,
    status,
    age_band: "adult",
    allergy_status: "none",
    required_safety_constraints: [],
    unsupported_diet_status: "none",
    unsupported_diet_kinds: [],
  };
}

function completeRows() {
  return {
    members: [completeMember(firstMemberId), completeMember(secondMemberId)],
    allergies: [],
    catalog: currentAllergenCatalogIds.map((id) => ({
      id,
      display_name: id,
      catalog_version: "jp-caa-2026-04.v1",
    })),
    aliases: currentAllergenAliasManifest.map((entry) => ({
      allergen_id: entry.allergenId,
      alias: entry.alias,
      normalized_alias: entry.normalizedAlias,
      alias_kind: entry.aliasKind,
      requires_label_confirmation: entry.requiresLabelConfirmation,
      dictionary_version: "jp-caa-2026-04.v1",
    })),
    rules: currentFoodSafetyRulesV1.map((rule) => ({
      id: rule.id,
      applies_to_age_bands: [...rule.appliesToAgeBands],
      match_terms: [...rule.matchTerms],
      rule_kind: rule.ruleKind,
      required_safety_tag: rule.requiredSafetyTag,
      user_message: rule.userMessage,
      rule_version: rule.ruleVersion,
    })),
  };
}

type SafetyRuleTestRow = {
  id: string;
  applies_to_age_bands: string[];
  match_terms: string[];
  rule_kind: string;
  required_safety_tag: string | null;
  user_message: string;
  rule_version: string;
};

function firstRule(rules: readonly SafetyRuleTestRow[]): SafetyRuleTestRow {
  const first = rules[0];
  if (first === undefined) throw new Error("canonical_food_safety_rules_missing");
  return first;
}

function expectSafetyRulesUnavailable(rules: readonly SafetyRuleTestRow[]): void {
  expect(() =>
    buildCurrentSafetyContext({
      userId,
      targetMemberIds: [firstMemberId, secondMemberId],
      rows: { ...completeRows(), rules },
    }),
  ).toThrow(expect.objectContaining({ status: 500, code: "safety_context_failed" }));
}

describe("current safety data boundary", () => {
  it("preserves requested member order and assigns anonymous refs in that order", () => {
    const context = buildCurrentSafetyContext({
      userId,
      targetMemberIds: [secondMemberId, firstMemberId],
      rows: completeRows(),
    });
    expect(
      context.members.map((member) => [member.householdMemberId, member.anonymousRef]),
    ).toEqual([
      [secondMemberId, "member_1"],
      [firstMemberId, "member_2"],
    ]);
  });

  it.each([
    ["missing", [completeMember(firstMemberId)]],
    [
      "foreign",
      [
        completeMember(firstMemberId),
        completeMember(secondMemberId, "70000000-0000-4000-8000-000000000002"),
      ],
    ],
    ["draft", [completeMember(firstMemberId), completeMember(secondMemberId, userId, "draft")]],
  ])("rejects a %s target member", (_name, members) => {
    expect(() =>
      buildCurrentSafetyContext({
        userId,
        targetMemberIds: [firstMemberId, secondMemberId],
        rows: { ...completeRows(), members },
      }),
    ).toThrow(expect.objectContaining({ status: 400, code: "invalid_target_members" }));
  });

  it("fails closed when the current catalog is incomplete", () => {
    const rows = completeRows();
    expectSafetyRulesUnavailable(rows.rules.slice(1));
  });

  it.each([
    [
      "applies_to_age_bands",
      () => {
        const rows = completeRows().rules;
        return rows.map((rule, index) =>
          index === 0 ? { ...rule, applies_to_age_bands: ["adult"] } : rule,
        );
      },
    ],
    [
      "match_terms",
      () => {
        const rows = completeRows().rules;
        return rows.map((rule, index) =>
          index === 0 ? { ...rule, match_terms: ["差し替えられた語句"] } : rule,
        );
      },
    ],
    [
      "applies_to_age_bands order",
      () => {
        const rows = completeRows().rules;
        return rows.map((rule, index) =>
          index === 0
            ? { ...rule, applies_to_age_bands: [...rule.applies_to_age_bands].reverse() }
            : rule,
        );
      },
    ],
    [
      "match_terms order",
      () => {
        const rows = completeRows().rules;
        return rows.map((rule, index) =>
          index === 0 ? { ...rule, match_terms: [...rule.match_terms].reverse() } : rule,
        );
      },
    ],
    [
      "rule_kind",
      () => {
        const rows = completeRows().rules;
        return rows.map((rule) =>
          rule.id === "grapes_under_6"
            ? { ...rule, rule_kind: "forbidden", required_safety_tag: null }
            : rule,
        );
      },
    ],
    [
      "required_safety_tag",
      () => {
        const rows = completeRows().rules;
        return rows.map((rule) =>
          rule.id === "grapes_under_6" ? { ...rule, required_safety_tag: "soften" } : rule,
        );
      },
    ],
    [
      "user_message",
      () => {
        const rows = completeRows().rules;
        return rows.map((rule, index) =>
          index === 0 ? { ...rule, user_message: "差し替えられた案内" } : rule,
        );
      },
    ],
    [
      "rule_version",
      () => {
        const rows = completeRows().rules;
        return rows.map((rule, index) =>
          index === 0 ? { ...rule, rule_version: "obsolete.v1" } : rule,
        );
      },
    ],
  ])("fails closed when a rule's %s differs from the canonical manifest", (_field, mutate) => {
    expectSafetyRulesUnavailable(mutate());
  });

  it.each([
    ["missing", () => completeRows().rules.slice(1)],
    [
      "extra",
      () => {
        const rules = completeRows().rules;
        return [...rules, { ...firstRule(rules), id: "unexpected_rule" }];
      },
    ],
    [
      "duplicate",
      () => {
        const rules = completeRows().rules;
        return [...rules, { ...firstRule(rules) }];
      },
    ],
  ])("fails closed when the rule set contains a %s row", (_case, mutate) => {
    expectSafetyRulesUnavailable(mutate());
  });

  it.each([
    [
      "missing required_safety_tag",
      (rule: SafetyRuleTestRow) => {
        Reflect.deleteProperty(rule, "required_safety_tag");
      },
    ],
    [
      "undefined required_safety_tag",
      (rule: SafetyRuleTestRow) => {
        Reflect.set(rule, "required_safety_tag", undefined);
      },
    ],
    [
      "non-string required_safety_tag",
      (rule: SafetyRuleTestRow) => {
        Reflect.set(rule, "required_safety_tag", Number.NaN);
      },
    ],
  ])("fails closed for a malformed rule row with %s", (_case, mutate) => {
    const rules = completeRows().rules;
    mutate(firstRule(rules));

    expectSafetyRulesUnavailable(rules);
  });

  it("accepts arbitrary database row order and returns the canonical rule order", () => {
    const rows = completeRows();
    const context = buildCurrentSafetyContext({
      userId,
      targetMemberIds: [firstMemberId, secondMemberId],
      rows: { ...rows, rules: [...rows.rules].reverse() },
    });

    expect(context.foodSafetyRules).toEqual(currentFoodSafetyRulesV1);
    expect(currentFoodSafetyRuleIds).toEqual([
      ...new Set(currentFoodSafetyRulesV1.map((rule) => rule.id)),
    ]);
  });

  it("returns an isolated canonical rule copy for every request", () => {
    const firstContext = buildCurrentSafetyContext({
      userId,
      targetMemberIds: [firstMemberId, secondMemberId],
      rows: completeRows(),
    });
    const canonicalRule = currentFoodSafetyRulesV1[0];
    const firstReturnedRule = firstContext.foodSafetyRules[0];
    if (canonicalRule === undefined || firstReturnedRule === undefined) {
      throw new Error("canonical_food_safety_rules_missing");
    }
    const canonicalSnapshot = {
      userMessage: canonicalRule.userMessage,
      appliesToAgeBands: [...canonicalRule.appliesToAgeBands],
      matchTerms: [...canonicalRule.matchTerms],
    };

    expect(firstContext.foodSafetyRules).not.toBe(currentFoodSafetyRulesV1);
    expect(firstReturnedRule).not.toBe(canonicalRule);
    expect(firstReturnedRule.appliesToAgeBands).not.toBe(canonicalRule.appliesToAgeBands);
    expect(firstReturnedRule.matchTerms).not.toBe(canonicalRule.matchTerms);

    Reflect.set(firstReturnedRule, "userMessage", "書き換えられた案内");
    Reflect.set(firstReturnedRule.appliesToAgeBands, 0, "senior");
    Reflect.set(firstReturnedRule.matchTerms, 0, "書き換えられた語句");

    const secondContext = buildCurrentSafetyContext({
      userId,
      targetMemberIds: [firstMemberId, secondMemberId],
      rows: completeRows(),
    });
    expect(currentFoodSafetyRulesV1[0]).toMatchObject(canonicalSnapshot);
    expect(secondContext.foodSafetyRules[0]).toMatchObject(canonicalSnapshot);
  });

  it("fails closed when only one direct alias per allergen is loaded", () => {
    const rows = completeRows();
    expect(() =>
      buildCurrentSafetyContext({
        userId,
        targetMemberIds: [firstMemberId, secondMemberId],
        rows: {
          ...rows,
          aliases: rows.aliases.filter(
            (alias, index, aliases) =>
              alias.alias_kind === "direct" &&
              !alias.requires_label_confirmation &&
              aliases.findIndex((candidate) => candidate.allergen_id === alias.allergen_id) ===
                index,
          ),
        },
      }),
    ).toThrow(expect.objectContaining({ status: 500, code: "safety_context_failed" }));
  });

  it("fails closed when an alias from another dictionary version is mixed in", () => {
    const rows = completeRows();
    expect(() =>
      buildCurrentSafetyContext({
        userId,
        targetMemberIds: [firstMemberId, secondMemberId],
        rows: {
          ...rows,
          aliases: [
            ...rows.aliases,
            {
              allergen_id: "wheat",
              alias: "カレールー",
              normalized_alias: "カレールー",
              alias_kind: "processed",
              requires_label_confirmation: true,
              dictionary_version: "obsolete.v1",
            },
          ],
        },
      }),
    ).toThrow(expect.objectContaining({ status: 500, code: "safety_context_failed" }));
  });

  it("captures immutable live names and uses an ordered fallback for a blank name", () => {
    const context = buildCurrentSafetyContext({
      userId,
      targetMemberIds: [firstMemberId, secondMemberId],
      rows: completeRows(),
    });
    const first = captureMemberLabels({
      context,
      userId,
      rows: [
        { id: firstMemberId, user_id: userId, status: "complete", display_name: "子ども" },
        { id: secondMemberId, user_id: userId, status: "complete", display_name: "  " },
      ],
    });
    const second = captureMemberLabels({
      context,
      userId,
      rows: [
        { id: firstMemberId, user_id: userId, status: "complete", display_name: "大人" },
        { id: secondMemberId, user_id: userId, status: "complete", display_name: "祖父" },
      ],
    });
    expect(first).toEqual({ member_1: "子ども", member_2: "家族2" });
    expect(second).toEqual({ member_1: "大人", member_2: "祖父" });
    expect(first.member_1).toBe("子ども");
    expect(Object.isFrozen(first)).toBe(true);
  });
});
