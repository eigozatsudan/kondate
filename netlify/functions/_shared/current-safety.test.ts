import { describe, expect, it } from "vitest";
import {
  buildCurrentSafetyContext,
  captureMemberLabels,
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
    aliases: currentAllergenCatalogIds.map((id) => ({
      allergen_id: id,
      alias: id,
      normalized_alias: id,
      alias_kind: "direct",
      requires_label_confirmation: false,
      dictionary_version: "jp-caa-2026-04.v1",
    })),
    rules: currentFoodSafetyRuleIds.map((id) => ({
      id,
      applies_to_age_bands: ["adult"],
      match_terms: ["確認用"],
      rule_kind: "forbidden",
      required_safety_tag: null,
      user_message: "確認用ルール",
      rule_version: "jp-caa-child-shape-2026-07.v1",
    })),
  };
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
    expect(() =>
      buildCurrentSafetyContext({
        userId,
        targetMemberIds: [firstMemberId, secondMemberId],
        rows: { ...rows, rules: rows.rules.slice(1) },
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
