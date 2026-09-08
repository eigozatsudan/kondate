import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AllergenCatalogRow,
  HouseholdMemberRow,
  MemberAllergyRow,
} from "@/features/household/household-api";
import {
  loadCurrentCompleteMemberIds,
  loadWeeklyPlanFormEligibility,
} from "./weekly-plan-eligibility";

const listHouseholdMembersMock = vi.hoisted(() => vi.fn());
const listAllergenCatalogMock = vi.hoisted(() => vi.fn());
const listMemberAllergiesMock = vi.hoisted(() => vi.fn());
const listFoodSafetyRulesMock = vi.hoisted(() => vi.fn());
const getBrowserSupabaseClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: getBrowserSupabaseClientMock,
}));

vi.mock("@/features/household/household-api", () => ({
  listHouseholdMembers: listHouseholdMembersMock,
  listAllergenCatalog: listAllergenCatalogMock,
  listMemberAllergies: listMemberAllergiesMock,
  listFoodSafetyRules: listFoodSafetyRulesMock,
}));

function buildMember(overrides: Partial<HouseholdMemberRow>): HouseholdMemberRow {
  return {
    id: "member-1",
    user_id: "u1",
    status: "complete",
    display_name: "たろう",
    age_band: "adult",
    portion_size: "standard",
    spice_level: "standard",
    ease_preferences: [],
    required_safety_constraints: [],
    allergy_status: "none",
    unsupported_diet_status: "absent",
    unsupported_diet_kinds: [],
    sort_order: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  listHouseholdMembersMock.mockReset();
  listAllergenCatalogMock.mockReset();
  listMemberAllergiesMock.mockReset();
  listFoodSafetyRulesMock.mockReset();
  getBrowserSupabaseClientMock.mockReset();
  getBrowserSupabaseClientMock.mockReturnValue({});
  listAllergenCatalogMock.mockResolvedValue([] as AllergenCatalogRow[]);
  listMemberAllergiesMock.mockResolvedValue([] as MemberAllergyRow[]);
  listFoodSafetyRulesMock.mockResolvedValue([]);
});

describe("loadWeeklyPlanFormEligibility", () => {
  it("excludes members that are not complete", async () => {
    listHouseholdMembersMock.mockResolvedValue([
      buildMember({ id: "m-complete", status: "complete" }),
      buildMember({ id: "m-incomplete", status: "draft" }),
    ]);

    const result = await loadWeeklyPlanFormEligibility("u1");

    expect(result.members.map((member) => member.id)).toEqual(["m-complete"]);
  });

  it("blocks a member whose allergy status is unconfirmed", async () => {
    listHouseholdMembersMock.mockResolvedValue([
      buildMember({ id: "m-unconfirmed", allergy_status: "unconfirmed" }),
    ]);

    const result = await loadWeeklyPlanFormEligibility("u1");

    expect(result.members[0]?.blockedReason).toBe("アレルギー確認が完了していません");
  });

  it("marks a complete member with cut_small as unsatisfiable", async () => {
    listHouseholdMembersMock.mockResolvedValue([
      buildMember({ id: "m-cut-small", required_safety_constraints: ["cut_small"] }),
      buildMember({ id: "m-plain" }),
    ]);

    const result = await loadWeeklyPlanFormEligibility("u1");

    expect(result.unsatisfiableMemberIds).toEqual(["m-cut-small"]);
  });

  it("marks a senior member as unsatisfiable when a requires_tag rule applies", async () => {
    listHouseholdMembersMock.mockResolvedValue([
      buildMember({
        id: "m-senior",
        age_band: "senior",
        required_safety_constraints: [],
      }),
      buildMember({ id: "m-adult", age_band: "adult" }),
    ]);
    listFoodSafetyRulesMock.mockResolvedValue([
      { rule_kind: "requires_tag", applies_to_age_bands: ["senior"] },
      { rule_kind: "forbidden", applies_to_age_bands: ["senior"] },
    ]);

    const result = await loadWeeklyPlanFormEligibility("u1");

    expect(result.unsatisfiableMemberIds).toEqual(["m-senior"]);
  });

  it("marks preschool members as unsatisfiable from requires_tag even without cut_small", async () => {
    listHouseholdMembersMock.mockResolvedValue([
      buildMember({
        id: "m-preschool",
        age_band: "age_3_5",
        required_safety_constraints: [],
      }),
    ]);
    listFoodSafetyRulesMock.mockResolvedValue([
      { rule_kind: "requires_tag", applies_to_age_bands: ["post_weaning_to_2", "age_3_5"] },
    ]);

    const result = await loadWeeklyPlanFormEligibility("u1");

    expect(result.unsatisfiableMemberIds).toEqual(["m-preschool"]);
  });
});

describe("loadCurrentCompleteMemberIds", () => {
  it("returns only complete member ids", async () => {
    listHouseholdMembersMock.mockResolvedValue([
      buildMember({ id: "m-complete", status: "complete" }),
      buildMember({ id: "m-incomplete", status: "draft" }),
    ]);

    const result = await loadCurrentCompleteMemberIds("u1");

    expect(result).toEqual(["m-complete"]);
  });
});
