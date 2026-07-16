import { describe, expect, it, vi } from "vitest";
import { currentAllergenCatalogV1 } from "../../../shared/safety/current-allergen-catalog.v1.js";
import { currentFoodSafetyRulesV1 } from "../../../shared/safety/current-food-safety-rules.v1.js";
import type { AdminSupabaseClient } from "./supabase-admin.js";
import {
  currentAllergenAliasManifest,
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
});
