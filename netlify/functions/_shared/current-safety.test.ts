import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { CurrentSafetyContext } from "../../../shared/safety/context.js";
import { currentAllergenCatalogV1 } from "../../../shared/safety/current-allergen-catalog.v1.js";
import { evaluateAllergens, foodTextContainsAlias } from "../../../shared/safety/allergens.js";
import {
  currentFoodRuleVersion,
  currentFoodSafetyRulesV1,
} from "../../../shared/safety/current-food-safety-rules.v1.js";
import { makeCurrentSafetyContext, makeValidatedMenu } from "../../../shared/testing/factories.js";
import type { AdminSupabaseClient } from "./supabase-admin.js";
import {
  currentAllergenAliasManifest,
  hasExactCurrentSafetyManifest,
  loadCurrentSafetyContext,
  loadEmergencyCurrentSafety,
  loadEmergencyInspectionSafety,
} from "./current-safety.js";

const userId = "70000000-0000-4000-8000-000000000001";
const firstMemberId = "71000000-0000-4000-8000-000000000001";
const secondMemberId = "71000000-0000-4000-8000-000000000002";
const dictionaryVersion = "jp-caa-2026-04.v1";
const foodRuleVersion = currentFoodRuleVersion;

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
  it("H7: foodRuleVersion is imported from the dictionary, not a second literal", async () => {
    const source = readFileSync("netlify/functions/_shared/current-safety.ts", "utf8");
    expect(source).toMatch(/currentFoodRuleVersion/);
    expect(source).not.toMatch(/const foodRuleVersion = "jp-caa-child-shape-2026-07\.v1"/u);
    expect(new Set(currentFoodSafetyRulesV1.map((rule) => rule.ruleVersion))).toEqual(
      new Set([currentFoodRuleVersion]),
    );

    const { admin } = adminWithRpc({ data: availableSnapshot(), error: null });
    await expect(
      loadCurrentSafetyContext(admin, userId, [secondMemberId, firstMemberId]),
    ).resolves.toMatchObject({ foodRuleVersion: currentFoodRuleVersion });
  });

  it("loads unconfirmed allergy members without failing closed (A-I3 relief path)", async () => {
    const snapshot = availableSnapshot([firstMemberId]);
    // ランタイム RPC は unconfirmed を返す。fixture ヘルパの型は complete 中心なので raw を差し替える。
    const unconfirmedMember = {
      ...snapshot.members[0]!,
      allergy_status: "unconfirmed",
      allergies: [] as const,
    };
    const data = {
      ...snapshot,
      members: [unconfirmedMember],
    };
    const { admin } = adminWithRpc({ data, error: null });

    const context = await loadCurrentSafetyContext(admin, userId, [firstMemberId]);
    expect(context.members).toHaveLength(1);
    expect(context.members[0]?.allergyStatus).toBe("unconfirmed");
  });

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
      // AGS-I2: 確認済みカスタムは name/aliases を評価用に載せる
      customAllergies: [{ name: "独自食材", aliases: ["別名A", "別名B"] }],
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

function thenableQuery(result: { data: unknown; error: unknown }) {
  const query: {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    then: (resolve: (value: { data: unknown; error: unknown }) => unknown) => Promise<unknown>;
  } = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    in: vi.fn(),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.in.mockReturnValue(query);
  return query;
}

const draftChildId = "71000000-0000-4000-8000-000000000099";

function adminWithSnapshotAndDrafts(options: {
  snapshot?: unknown;
  snapshotError?: unknown;
  draftMembers?: unknown;
  draftMembersError?: unknown;
  draftAllergies?: unknown;
  draftAllergiesError?: unknown;
}) {
  const rpc = vi.fn().mockResolvedValue({
    data: options.snapshot ?? availableSnapshot([secondMemberId]),
    error: options.snapshotError ?? null,
  });
  const draftMembersQuery = thenableQuery({
    data: options.draftMembers ?? [],
    error: options.draftMembersError ?? null,
  });
  const draftAllergiesQuery = thenableQuery({
    data: options.draftAllergies ?? [],
    error: options.draftAllergiesError ?? null,
  });
  const from = vi.fn((table: string) => {
    if (table === "member_allergies") return draftAllergiesQuery;
    return draftMembersQuery;
  });
  return {
    admin: { rpc, from } as unknown as AdminSupabaseClient,
    rpc,
    from,
  };
}

describe("loadEmergencyInspectionSafety", () => {
  it("PE2: unions draft confirmed standard allergen needles without sending draft IDs to snapshot", async () => {
    // complete 親だけが RPC 対象。draft 子の卵針は検査 union で載せる（SQL を緩めない）。
    const { admin, rpc, from } = adminWithSnapshotAndDrafts({
      draftMembers: [
        {
          id: draftChildId,
          age_band: "age_3_5",
          required_safety_constraints: [],
        },
      ],
      draftAllergies: [
        {
          member_id: draftChildId,
          allergen_id: "egg",
          custom_name: null,
          custom_aliases: null,
          custom_confirmed: false,
        },
      ],
    });

    const result = await loadEmergencyInspectionSafety(admin, userId, [secondMemberId]);

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("get_current_safety_snapshot", {
      p_user_id: userId,
      p_target_member_ids: [secondMemberId],
    });
    expect(from).toHaveBeenCalledWith("household_members");
    expect(from).toHaveBeenCalledWith("member_allergies");
    expect(result.context.members.some((member) => member.allergenIds.includes("egg"))).toBe(true);
    expect(result.context.members.map((member) => member.householdMemberId)).toContain(
      draftChildId,
    );
    expect(result.memberLabels.member_1).toBe("大人");
    expect(result.memberLabels.member_2).toBe("家族2");
    expect(Object.isFrozen(result.memberLabels)).toBe(true);
  });

  it("PE2: empty drafts leave complete snapshot members unchanged", async () => {
    const { admin, from } = adminWithSnapshotAndDrafts({
      draftMembers: [],
    });

    const result = await loadEmergencyInspectionSafety(admin, userId, [secondMemberId]);

    expect(from).toHaveBeenCalledWith("household_members");
    expect(from).not.toHaveBeenCalledWith("member_allergies");
    expect(result.context.members).toHaveLength(1);
    expect(result.context.members[0]?.householdMemberId).toBe(secondMemberId);
    expect(result.context.members[0]?.allergenIds).toEqual([]);
  });

  it("PE2: fails closed when draft member rows cannot be read", async () => {
    const { admin } = adminWithSnapshotAndDrafts({
      draftMembersError: { message: "draft members unavailable" },
    });

    await expectClosedFailure(loadEmergencyInspectionSafety(admin, userId, [secondMemberId]));
  });

  it("PE2: fails closed when draft allergy rows cannot be read", async () => {
    const { admin } = adminWithSnapshotAndDrafts({
      draftMembers: [
        {
          id: draftChildId,
          age_band: null,
          required_safety_constraints: [],
        },
      ],
      draftAllergiesError: { message: "draft allergies unavailable" },
    });

    await expectClosedFailure(loadEmergencyInspectionSafety(admin, userId, [secondMemberId]));
  });
});

describe("meat aliases bound to currentAllergenAliasManifest (2026-09-23)", () => {
  // 個別 alias 文字列ではなく、実際に配線される currentAllergenAliasManifest から
  // 組み立てた辞書で evaluateAllergens を回す。各行は「その行を消すと一致が消える」
  // ことまで確かめ、行の削除・kind の取り違えがテストで落ちるようにする（I1）。
  type ManifestEntry = (typeof currentAllergenAliasManifest)[number];
  type MatchKind = "hard" | "label" | "none";

  const targetPath = "dishes.0.name";

  function contextFor(
    allergenIds: readonly string[],
    manifest: readonly ManifestEntry[] = currentAllergenAliasManifest,
  ): CurrentSafetyContext {
    const base = makeCurrentSafetyContext();
    const member = base.members[0];
    if (member === undefined) throw new Error("member fixture is empty");
    return {
      ...base,
      members: [{ ...member, allergyStatus: "registered", allergenIds }],
      allergenDictionary: {
        version: dictionaryVersion,
        catalog: currentAllergenCatalogV1.map((entry) => ({
          id: entry.id,
          displayName: entry.displayName,
          catalogVersion: entry.catalogVersion,
        })),
        aliases: manifest.map((entry) => ({
          allergenId: entry.allergenId,
          alias: entry.alias,
          normalizedAlias: entry.normalizedAlias,
          aliasKind: entry.aliasKind,
          requiresLabelConfirmation: entry.requiresLabelConfirmation,
          dictionaryVersion,
        })),
      },
    };
  }

  function menuWithDishName(name: string) {
    const base = makeValidatedMenu();
    return makeValidatedMenu({
      dishes: base.dishes.map((dish, index) => (index === 0 ? { ...dish, name } : dish)),
    });
  }

  // 1 品目の料理名（dishes.0.name）だけを見て、その allergenId 単独で hard / label / none を返す。
  // fixture の他の料理テキストの影響を受けないよう path で絞る。
  function classify(
    text: string,
    allergenId: string,
    manifest: readonly ManifestEntry[] = currentAllergenAliasManifest,
  ): MatchKind {
    const result = evaluateAllergens(menuWithDishName(text), contextFor([allergenId], manifest));
    if (result.issues.some((issue) => issue.path === targetPath)) return "hard";
    if (
      result.labelConfirmations.some(
        (confirmation) =>
          confirmation.sourcePath === targetPath && confirmation.allergenId === allergenId,
      )
    ) {
      return "label";
    }
    return "none";
  }

  function withoutRow(allergenId: string, alias: string): readonly ManifestEntry[] {
    const filtered = currentAllergenAliasManifest.filter(
      (entry) => !(entry.allergenId === allergenId && entry.alias === alias),
    );
    expect(filtered.length).toBe(currentAllergenAliasManifest.length - 1);
    return filtered;
  }

  // 20260923130000・20260923140000・20260923150000 で足した行（削除した行を除く）。
  // テキストには、その行自身が一字の漢字でない限り 豚・牛・鶏 の一字を含めない。
  // [allergenId, alias, 期待する kind, 実在の料理・食材テキスト]
  const addedRows: readonly (readonly [string, string, "hard" | "label", string])[] = [
    // 20260923130000
    ["chicken", "鶏", "hard", "鶏の照り焼き"],
    ["chicken", "手羽", "hard", "手羽先の塩焼き"],
    ["chicken", "砂肝", "hard", "砂肝のガーリック炒め"],
    ["chicken", "せせり", "hard", "せせり串"],
    ["chicken", "ぼんじり", "hard", "ぼんじりの塩焼き"],
    ["pork", "豚", "hard", "豚の生姜焼き"],
    ["pork", "とんかつ", "hard", "とんかつ定食"],
    ["pork", "チャーシュー", "hard", "チャーシュー麺"],
    ["pork", "叉焼", "hard", "叉焼チャーハン"],
    ["pork", "肩ロース", "hard", "肩ロースの塩焼き"],
    ["beef", "牛", "hard", "牛丼"],
    ["beef", "肩ロース", "hard", "肩ロースの塩焼き"],
    ["beef", "サーロイン", "hard", "サーロインステーキ"],
    ["beef", "カルビ", "hard", "カルビ焼肉"],
    ["beef", "ハラミ", "hard", "ハラミの塩焼き"],
    // 20260923140000
    ["chicken", "鳥もも", "hard", "鳥もも肉のグリル"],
    ["chicken", "鳥むね", "hard", "鳥むね肉のソテー"],
    ["chicken", "とりもも", "hard", "とりもも肉の照り焼き"],
    ["chicken", "とりむね", "hard", "とりむね肉のソテー"],
    ["chicken", "焼き鳥", "hard", "焼き鳥の盛り合わせ"],
    ["chicken", "焼鳥", "hard", "焼鳥丼"],
    ["chicken", "やきとり", "hard", "やきとり丼"],
    ["chicken", "とりにく", "hard", "とりにくの甘辛煮"],
    ["chicken", "鳥ガラ", "hard", "鳥ガラスープ"],
    ["chicken", "とりがら", "hard", "とりがらスープ"],
    ["pork", "合いびき", "hard", "合いびき肉のハンバーグ"],
    ["pork", "合挽", "hard", "合挽き肉のハンバーグ"],
    ["pork", "あいびき", "hard", "あいびき肉のそぼろ"],
    ["beef", "合いびき", "hard", "合いびき肉のハンバーグ"],
    ["beef", "合挽", "hard", "合挽き肉のハンバーグ"],
    ["beef", "あいびき", "hard", "あいびき肉のそぼろ"],
    ["pork", "ハム", "label", "ハムサンド"],
    ["chicken", "レバー", "label", "レバー炒め"],
    ["pork", "レバー", "label", "レバー炒め"],
    ["beef", "レバー", "label", "レバー炒め"],
    ["pork", "ホルモン", "label", "ホルモン焼き"],
    ["beef", "ホルモン", "label", "ホルモン焼き"],
    ["chicken", "コンソメ", "label", "コンソメスープ"],
    ["pork", "コンソメ", "label", "コンソメスープ"],
    ["beef", "コンソメ", "label", "コンソメスープ"],
    ["chicken", "ブイヨン", "label", "ブイヨンで煮る"],
    ["pork", "ブイヨン", "label", "ブイヨンで煮る"],
    ["beef", "ブイヨン", "label", "ブイヨンで煮る"],
    ["pork", "とんかつソース", "label", "とんかつソースをかけたキャベツ"],
    // 20260923150000
    ["pork", "合い挽き", "hard", "合い挽き肉のハンバーグ"],
    ["pork", "合びき", "hard", "合びき肉のメンチカツ"],
    ["pork", "あい挽き", "hard", "あい挽き肉のそぼろ"],
    ["beef", "合い挽き", "hard", "合い挽き肉のハンバーグ"],
    ["beef", "合びき", "hard", "合びき肉のメンチカツ"],
    ["beef", "あい挽き", "hard", "あい挽き肉のそぼろ"],
    ["chicken", "鳥ひき", "hard", "鳥ひき肉のそぼろ"],
    ["chicken", "鳥挽", "hard", "鳥挽き肉の団子"],
    ["chicken", "鳥皮", "hard", "鳥皮ポン酢"],
    ["chicken", "とりかわ", "hard", "とりかわ串"],
    ["chicken", "鳥つくね", "hard", "鳥つくね串"],
    ["chicken", "鳥の唐揚げ", "hard", "鳥の唐揚げ定食"],
    ["chicken", "鳥から", "hard", "鳥から弁当"],
    ["chicken", "焼きとり", "hard", "焼きとり丼"],
    ["chicken", "やき鳥", "hard", "やき鳥丼"],
    ["chicken", "鳥そぼろ", "hard", "鳥そぼろ丼"],
    ["pork", "もつ煮", "label", "もつ煮込み"],
    ["beef", "もつ煮", "label", "もつ煮込み"],
    ["pork", "もつ鍋", "label", "もつ鍋"],
    ["beef", "もつ鍋", "label", "もつ鍋"],
    ["pork", "もつ焼き", "label", "もつ焼き"],
    ["beef", "もつ焼き", "label", "もつ焼き"],
    ["pork", "豚カツソース", "label", "豚カツソースをかけたキャベツ"],
  ];

  it.each(addedRows)("binds %s row %s as %s via %s", (allergenId, alias, expectedKind, text) => {
    const row = currentAllergenAliasManifest.find(
      (entry) => entry.allergenId === allergenId && entry.alias === alias,
    );
    expect(row).toBeDefined();
    // label 確認行は processed + requiresLabelConfirmation、hard 行はその逆
    expect(row?.requiresLabelConfirmation).toBe(expectedKind === "label");
    expect(classify(text, allergenId)).toBe(expectedKind);
    // その行を消すと同じ kind では一致しなくなる（他の行の部分一致に隠れていない）
    expect(classify(text, allergenId, withoutRow(allergenId, alias))).not.toBe(expectedKind);
  });

  // 牛もつ・豚もつは一字の「牛」「豚」で hard 一致が先に立つため、label 行としては表に出ない。
  // 行が存在し label 確認として登録されていることと、実テキストが hard で止まることだけを固定する。
  it.each([
    ["beef", "牛もつ", "牛もつ煮込み"],
    ["pork", "豚もつ", "豚もつ炒め"],
  ])("keeps %s label row %s and still hard-matches %s", (allergenId, alias, text) => {
    const row = currentAllergenAliasManifest.find(
      (entry) => entry.allergenId === allergenId && entry.alias === alias,
    );
    expect(row?.requiresLabelConfirmation).toBe(true);
    expect(classify(text, allergenId)).toBe("hard");
  });

  it.each([
    ["合い挽き肉のハンバーグ"],
    ["合い挽きミンチ"],
    ["合びき肉"],
    ["あい挽き肉"],
    ["合挽き肉"],
    ["あいびき肉"],
  ])("hard-matches ground mixed meat %s for pork alone and beef alone (C1)", (text) => {
    expect(classify(text, "pork")).toBe("hard");
    expect(classify(text, "beef")).toBe("hard");
  });

  it.each([
    ["牛刀で切る", "beef"],
    ["鶏卵を溶く", "chicken"],
    ["牛乳を注ぐ", "beef"],
    ["牛蒡のきんぴら", "beef"],
    ["蝸牛の歩みで進める", "beef"],
    ["水牛のモッツァレラ", "beef"],
    ["河豚のから揚げ", "pork"],
    ["鮭ハラミの塩焼き", "beef"],
    ["さけハラミの塩焼き", "beef"],
    ["サーモンハラミの塩焼き", "beef"],
  ])("does not match exclusion context %s for %s", (text, allergenId) => {
    expect(classify(text, allergenId)).toBe("none");
  });

  it("keeps とんかつソース out of the pork hard match (豚・とんかつ) but asks for a label check", () => {
    expect(classify("とんかつソースをかけたキャベツ", "pork")).toBe("label");
    // 実際の豚が同じ文にあれば hard 一致する
    expect(classify("とんかつソースをかけた豚のしょうが焼き", "pork")).toBe("hard");
  });

  it("keeps 豚カツソース out of the pork hard match but hard-matches when real pork co-occurs (m3)", () => {
    expect(classify("豚カツソースをかけたキャベツ", "pork")).toBe("label");
    expect(classify("豚かつソースをかけたキャベツ", "pork")).toBe("label");
    expect(classify("豚カツソースと豚バラ", "pork")).toBe("hard");
  });

  it.each([["鳥ももの照り焼き"], ["とりももの照り焼き"]])(
    "matches %s for chicken but not for peach (もも)",
    (text) => {
      expect(classify(text, "chicken")).toBe("hard");
      expect(classify(text, "peach")).toBe("none");
    },
  );

  it.each([
    ["3日ほどもつ"],
    ["形をたもつ"],
    ["味がもつように保存する"],
    ["もつれないように混ぜる"],
    ["レバーを引く"],
    ["レバーをひいて火を止める"],
    ["レバー式のコンロ"],
    ["女性ホルモン"],
    ["成長ホルモン"],
    ["ホルモンバランスを整える"],
  ])("does not treat %s as meat for pork, beef or chicken (I3)", (text) => {
    expect(classify(text, "pork")).toBe("none");
    expect(classify(text, "beef")).toBe("none");
    expect(classify(text, "chicken")).toBe("none");
  });

  it.each([["もつ煮込み"], ["もつ鍋"], ["レバー炒め"], ["ホルモン焼き"]])(
    "asks for a label check (not a hard block) on %s for pork and beef (I3)",
    (text) => {
      expect(classify(text, "pork")).toBe("label");
      expect(classify(text, "beef")).toBe("label");
    },
  );

  it("removes the bare もつ rows (I3)", () => {
    expect(currentAllergenAliasManifest.filter((entry) => entry.alias === "もつ")).toEqual([]);
  });

  it("matches 鶏の照り焼き for chicken only through the 鶏 row (m5)", () => {
    const matched = currentAllergenAliasManifest
      .filter(
        (entry) =>
          entry.allergenId === "chicken" &&
          foodTextContainsAlias("鶏の照り焼き", entry.normalizedAlias),
      )
      .map((entry) => entry.alias);
    expect(matched).toEqual(["鶏"]);
  });
});
