import { describe, expect, it, vi } from "vitest";
import type { CurrentSafetyContext } from "../../../shared/safety/context.js";
import { currentAllergenCatalogV1 } from "../../../shared/safety/current-allergen-catalog.v1.js";
import { currentFoodSafetyRulesV1 } from "../../../shared/safety/current-food-safety-rules.v1.js";
import type { AdminSupabaseClient } from "./supabase-admin.js";
import {
  currentAllergenAliasManifest,
  hasExactCurrentSafetyManifest,
  loadCurrentSafetyContext,
  loadEmergencyCurrentSafety,
} from "./current-safety.js";

const userId = "70000000-0000-4000-8000-000000000001";
const firstMemberId = "71000000-0000-4000-8000-000000000001";
const secondMemberId = "71000000-0000-4000-8000-000000000002";
const dictionaryVersion = "jp-caa-2026-04.v1";
const foodRuleVersion = "jp-caa-child-shape-2026-07.v1";

function member(id: string, displayName: string) {
  return {
    id,
    display_name: displayName,
    age_band: id === firstMemberId ? ("age_3_5" as const) : ("adult" as const),
    portion_size: id === firstMemberId ? ("small" as const) : null,
    spice_level: id === firstMemberId ? ("none" as const) : null,
    ease_preferences: id === firstMemberId ? (["small_pieces"] as const) : [],
    allergy_status: id === firstMemberId ? ("registered" as const) : ("none" as const),
    required_safety_constraints: id === firstMemberId ? (["cut_small"] as const) : [],
    unsupported_diet_status: id === firstMemberId ? ("none" as const) : ("present" as const),
    unsupported_diet_kinds: id === firstMemberId ? [] : (["therapeutic_diet"] as const),
    allergies:
      id === firstMemberId
        ? [
            { kind: "standard" as const, allergen_id: "egg" },
            { kind: "custom" as const, name: "独自食材", aliases: ["別名A", "別名B"] },
          ]
        : [],
  };
}

function availableSnapshot(ids: readonly string[] = [secondMemberId, firstMemberId]) {
  return {
    status: "available" as const,
    dictionary_version: dictionaryVersion,
    food_rule_version: foodRuleVersion,
    members: ids.map((id, index) => member(id, index === 0 ? "大人" : "子ども")),
    catalog: currentAllergenCatalogV1.map((entry) => ({
      id: entry.id,
      display_name: entry.displayName,
      regulatory_class: entry.regulatoryClass,
      catalog_version: entry.catalogVersion,
    })),
    aliases: currentAllergenAliasManifest.map((entry) => ({
      allergen_id: entry.allergenId,
      alias: entry.alias,
      normalized_alias: entry.normalizedAlias,
      alias_kind: entry.aliasKind,
      requires_label_confirmation: entry.requiresLabelConfirmation,
      dictionary_version: dictionaryVersion,
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

function adminWithRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  const from = vi.fn();
  return {
    admin: { rpc, from } as unknown as AdminSupabaseClient,
    rpc,
    from,
  };
}

function expectClosedFailure(action: Promise<unknown>): Promise<void> {
  return expect(action).rejects.toMatchObject({
    status: 500,
    code: "safety_context_failed",
  });
}

type CatalogEntry = CurrentSafetyContext["allergenDictionary"]["catalog"][number];
type AliasEntry = CurrentSafetyContext["allergenDictionary"]["aliases"][number];
type RuleEntry = CurrentSafetyContext["foodSafetyRules"][number];
type ManifestMutation = readonly [string, (context: CurrentSafetyContext) => CurrentSafetyContext];

function requireFirst<T>(values: readonly T[], fixture: string): T {
  const first = values.at(0);
  if (first === undefined) throw new Error(`${fixture} fixture is empty`);
  return first;
}

function withFirstCatalog(
  context: CurrentSafetyContext,
  mutate: (entry: CatalogEntry) => CatalogEntry,
): CurrentSafetyContext {
  const first = requireFirst(context.allergenDictionary.catalog, "catalog");
  return {
    ...context,
    allergenDictionary: {
      ...context.allergenDictionary,
      catalog: [mutate(first), ...context.allergenDictionary.catalog.slice(1)],
    },
  };
}

function withFirstAlias(
  context: CurrentSafetyContext,
  mutate: (entry: AliasEntry) => AliasEntry,
): CurrentSafetyContext {
  const first = requireFirst(context.allergenDictionary.aliases, "alias");
  return {
    ...context,
    allergenDictionary: {
      ...context.allergenDictionary,
      aliases: [mutate(first), ...context.allergenDictionary.aliases.slice(1)],
    },
  };
}

function withFirstRule(
  context: CurrentSafetyContext,
  mutate: (entry: RuleEntry) => RuleEntry,
): CurrentSafetyContext {
  const first = requireFirst(context.foodSafetyRules, "rule");
  return { ...context, foodSafetyRules: [mutate(first), ...context.foodSafetyRules.slice(1)] };
}

const manifestMutations: readonly ManifestMutation[] = [
  ["dictionary version", (context) => ({ ...context, dictionaryVersion: "obsolete" })],
  [
    "dictionary manifest version",
    (context) => ({
      ...context,
      allergenDictionary: { ...context.allergenDictionary, version: "obsolete" },
    }),
  ],
  ["food rule version", (context) => ({ ...context, foodRuleVersion: "obsolete" })],
  ["catalog id", (context) => withFirstCatalog(context, (entry) => ({ ...entry, id: "drift" }))],
  [
    "catalog display name",
    (context) => withFirstCatalog(context, (entry) => ({ ...entry, displayName: "改ざん名" })),
  ],
  [
    "catalog version",
    (context) => withFirstCatalog(context, (entry) => ({ ...entry, catalogVersion: "obsolete" })),
  ],
  [
    "alias allergen id",
    (context) => withFirstAlias(context, (entry) => ({ ...entry, allergenId: "drift" })),
  ],
  ["alias", (context) => withFirstAlias(context, (entry) => ({ ...entry, alias: "改ざん" }))],
  [
    "normalized alias",
    (context) => withFirstAlias(context, (entry) => ({ ...entry, normalizedAlias: "drift" })),
  ],
  [
    "alias kind",
    (context) =>
      withFirstAlias(context, (entry) => ({
        ...entry,
        aliasKind: entry.aliasKind === "direct" ? "processed" : "direct",
      })),
  ],
  [
    "alias confirmation flag",
    (context) =>
      withFirstAlias(context, (entry) => ({
        ...entry,
        requiresLabelConfirmation: !entry.requiresLabelConfirmation,
      })),
  ],
  [
    "alias dictionary version",
    (context) => withFirstAlias(context, (entry) => ({ ...entry, dictionaryVersion: "obsolete" })),
  ],
  ["rule id", (context) => withFirstRule(context, (entry) => ({ ...entry, id: "drift" }))],
  [
    "rule age bands",
    (context) =>
      withFirstRule(context, (entry) => ({
        ...entry,
        appliesToAgeBands: entry.appliesToAgeBands.includes("senior")
          ? (["adult"] as const)
          : (["senior"] as const),
      })),
  ],
  [
    "rule match terms",
    (context) =>
      withFirstRule(context, (entry) => ({
        ...entry,
        matchTerms: [...entry.matchTerms, "__drift__"],
      })),
  ],
  [
    "rule kind",
    (context) =>
      withFirstRule(context, (entry) => ({
        ...entry,
        ruleKind: entry.ruleKind === "forbidden" ? "requires_tag" : "forbidden",
      })),
  ],
  [
    "rule required safety tag",
    (context) =>
      withFirstRule(context, (entry) => ({
        ...entry,
        requiredSafetyTag: entry.requiredSafetyTag === null ? "cut_small" : null,
      })),
  ],
  [
    "rule user message",
    (context) => withFirstRule(context, (entry) => ({ ...entry, userMessage: "改ざん文" })),
  ],
  [
    "rule version",
    (context) => withFirstRule(context, (entry) => ({ ...entry, ruleVersion: "obsolete" })),
  ],
  [
    "missing catalog row",
    (context) => ({
      ...context,
      allergenDictionary: {
        ...context.allergenDictionary,
        catalog: context.allergenDictionary.catalog.slice(1),
      },
    }),
  ],
  [
    "extra catalog row",
    (context) => {
      const first = requireFirst(context.allergenDictionary.catalog, "catalog");
      return {
        ...context,
        allergenDictionary: {
          ...context.allergenDictionary,
          catalog: [...context.allergenDictionary.catalog, { ...first, id: "unexpected" }],
        },
      };
    },
  ],
  [
    "duplicate catalog row",
    (context) => {
      const first = requireFirst(context.allergenDictionary.catalog, "catalog");
      return {
        ...context,
        allergenDictionary: {
          ...context.allergenDictionary,
          catalog: [...context.allergenDictionary.catalog, first],
        },
      };
    },
  ],
  [
    "missing alias row",
    (context) => ({
      ...context,
      allergenDictionary: {
        ...context.allergenDictionary,
        aliases: context.allergenDictionary.aliases.slice(1),
      },
    }),
  ],
  [
    "extra alias row",
    (context) => {
      const first = requireFirst(context.allergenDictionary.aliases, "alias");
      return {
        ...context,
        allergenDictionary: {
          ...context.allergenDictionary,
          aliases: [...context.allergenDictionary.aliases, { ...first, alias: "unexpected" }],
        },
      };
    },
  ],
  [
    "duplicate alias row",
    (context) => {
      const first = requireFirst(context.allergenDictionary.aliases, "alias");
      return {
        ...context,
        allergenDictionary: {
          ...context.allergenDictionary,
          aliases: [...context.allergenDictionary.aliases, first],
        },
      };
    },
  ],
  [
    "missing rule row",
    (context) => ({ ...context, foodSafetyRules: context.foodSafetyRules.slice(1) }),
  ],
  [
    "extra rule row",
    (context) => {
      const first = requireFirst(context.foodSafetyRules, "rule");
      return {
        ...context,
        foodSafetyRules: [...context.foodSafetyRules, { ...first, id: "unexpected" }],
      };
    },
  ],
  [
    "duplicate rule row",
    (context) => {
      const first = requireFirst(context.foodSafetyRules, "rule");
      return { ...context, foodSafetyRules: [...context.foodSafetyRules, first] };
    },
  ],
];

describe("current safety snapshot RPC boundary", () => {
  it("loads context and labels from exactly one strict snapshot in requested order", async () => {
    const targetMemberIds = [secondMemberId, firstMemberId] as const;
    const { admin, rpc, from } = adminWithRpc({ data: availableSnapshot(), error: null });

    const result = await loadEmergencyCurrentSafety(admin, userId, targetMemberIds);

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("get_current_safety_snapshot", {
      p_user_id: userId,
      p_target_member_ids: [...targetMemberIds],
    });
    expect(from).not.toHaveBeenCalled();
    expect(
      result.context.members.map((entry) => [entry.householdMemberId, entry.anonymousRef]),
    ).toEqual([
      [secondMemberId, "member_1"],
      [firstMemberId, "member_2"],
    ]);
    expect(result.context.members[1]).toMatchObject({
      allergenIds: ["egg"],
      hasUnmappedCustomAllergy: true,
    });
    expect(result.memberLabels).toEqual({ member_1: "大人", member_2: "子ども" });
    expect(Object.isFrozen(result.memberLabels)).toBe(true);
  });

  it("uses the display-name fallback captured in the same snapshot", async () => {
    const snapshot = availableSnapshot();
    snapshot.members[0] = { ...snapshot.members[0]!, display_name: "   " };
    const { admin } = adminWithRpc({ data: snapshot, error: null });

    const result = await loadEmergencyCurrentSafety(admin, userId, [secondMemberId, firstMemberId]);

    expect(result.memberLabels).toEqual({ member_1: "家族1", member_2: "子ども" });
  });

  it.each([
    ["RPC error", { data: null, error: { message: "database unavailable" } }],
    ["null RPC data", { data: null, error: null }],
    ["unavailable status", { data: { status: "unavailable" }, error: null }],
    [
      "strict-shape violation",
      { data: { ...availableSnapshot(), unexpected: "must be rejected" }, error: null },
    ],
  ])("fails closed for %s without a table fallback", async (_case, rpcResult) => {
    const { admin, rpc, from } = adminWithRpc(rpcResult);

    await expectClosedFailure(
      loadCurrentSafetyContext(admin, userId, [secondMemberId, firstMemberId]),
    );
    expect(rpc).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalled();
  });

  it("fails closed when snapshot member identity or order differs from the request", async () => {
    const { admin, from } = adminWithRpc({
      data: availableSnapshot([firstMemberId, secondMemberId]),
      error: null,
    });

    await expectClosedFailure(
      loadCurrentSafetyContext(admin, userId, [secondMemberId, firstMemberId]),
    );
    expect(from).not.toHaveBeenCalled();
  });

  it("fails closed when a catalog row drifts from the top-level dictionary version", async () => {
    const snapshot = availableSnapshot();
    Reflect.set(snapshot.catalog[0]!, "catalog_version", "obsolete.v1");
    const { admin, from } = adminWithRpc({ data: snapshot, error: null });

    await expectClosedFailure(
      loadCurrentSafetyContext(admin, userId, [secondMemberId, firstMemberId]),
    );
    expect(from).not.toHaveBeenCalled();
  });

  it("fails closed when a raw catalog regulatory class drifts", async () => {
    const snapshot = availableSnapshot();
    const firstCatalog = snapshot.catalog.at(0);
    if (firstCatalog === undefined) throw new Error("catalog fixture is empty");
    snapshot.catalog[0] = {
      ...firstCatalog,
      regulatory_class: firstCatalog.regulatory_class === "mandatory" ? "recommended" : "mandatory",
    };
    const { admin, from } = adminWithRpc({ data: snapshot, error: null });

    await expectClosedFailure(
      loadCurrentSafetyContext(admin, userId, [secondMemberId, firstMemberId]),
    );
    expect(from).not.toHaveBeenCalled();
  });

  it.each(manifestMutations)("rejects canonical manifest drift for %s", async (_case, mutate) => {
    const { admin } = adminWithRpc({ data: availableSnapshot(), error: null });
    const context = await loadCurrentSafetyContext(admin, userId, [secondMemberId, firstMemberId]);

    expect(hasExactCurrentSafetyManifest(context)).toBe(true);
    expect(hasExactCurrentSafetyManifest(mutate(context))).toBe(false);
  });
});
