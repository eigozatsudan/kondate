import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AllergenCatalogRow,
  HouseholdMemberRow,
  MemberAllergyRow,
} from "@/features/household/household-api";
import { loadHouseholdSafetyMembers } from "./planner-safety-data";

const listHouseholdMembersMock = vi.hoisted(() => vi.fn());
const listAllergenCatalogMock = vi.hoisted(() => vi.fn());
const listMemberAllergiesMock = vi.hoisted(() => vi.fn());
const getBrowserSupabaseClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: getBrowserSupabaseClientMock,
}));

vi.mock("@/features/household/household-api", () => ({
  listHouseholdMembers: listHouseholdMembersMock,
  listAllergenCatalog: listAllergenCatalogMock,
  listMemberAllergies: listMemberAllergiesMock,
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
  getBrowserSupabaseClientMock.mockReset();
  getBrowserSupabaseClientMock.mockReturnValue({});
  listAllergenCatalogMock.mockResolvedValue([] as AllergenCatalogRow[]);
  listMemberAllergiesMock.mockResolvedValue([] as MemberAllergyRow[]);
});

describe("loadHouseholdSafetyMembers", () => {
  it("excludes members that are not complete", async () => {
    listHouseholdMembersMock.mockResolvedValue([
      buildMember({ id: "m-complete", status: "complete" }),
      buildMember({ id: "m-incomplete", status: "draft" }),
    ]);

    const members = await loadHouseholdSafetyMembers("u1");

    expect(members.map((member) => member.id)).toEqual(["m-complete"]);
  });

  it("falls back to a positional display name when the name is blank", async () => {
    listHouseholdMembersMock.mockResolvedValue([
      buildMember({ id: "m-1", display_name: "  " }),
      buildMember({ id: "m-2", display_name: null }),
    ]);

    const members = await loadHouseholdSafetyMembers("u1");

    expect(members.map((member) => member.displayName)).toEqual(["家族1", "家族2"]);
  });

  it("translates age band and safety constraint labels", async () => {
    listHouseholdMembersMock.mockResolvedValue([
      buildMember({
        id: "m-1",
        age_band: "age_3_5",
        required_safety_constraints: ["cut_small", "remove_bones", "unknown_constraint"],
      }),
      buildMember({ id: "m-2", age_band: null }),
    ]);

    const members = await loadHouseholdSafetyMembers("u1");

    expect(members[0]?.ageBandLabel).toBe("3〜5歳");
    expect(members[0]?.safetyLabels).toEqual(["小さく切る", "骨を除く", "安全上の個別対応"]);
    expect(members[1]?.ageBandLabel).toBe("年齢未確認");
  });

  it("exposes raw required safety constraints for callers", async () => {
    listHouseholdMembersMock.mockResolvedValue([
      buildMember({ id: "m-1", required_safety_constraints: ["cut_small"] }),
    ]);

    const members = await loadHouseholdSafetyMembers("u1");

    expect(members[0]?.requiredSafetyConstraints).toEqual(["cut_small"]);
  });

  it("prefers the allergy blocked reason over the unsupported diet reasons", async () => {
    listHouseholdMembersMock.mockResolvedValue([
      buildMember({ id: "m-1", allergy_status: "unconfirmed", unsupported_diet_status: "present" }),
      buildMember({ id: "m-2", unsupported_diet_status: "unconfirmed" }),
      buildMember({ id: "m-3", unsupported_diet_status: "present" }),
      buildMember({ id: "m-4" }),
    ]);

    const members = await loadHouseholdSafetyMembers("u1");

    expect(members.map((member) => member.blockedReason)).toEqual([
      "アレルギー確認が完了していません",
      "対応対象の確認が完了していません",
      "離乳食・嚥下調整食・治療食には対応できません",
      null,
    ]);
  });

  it("keeps unresolved allergies out of the label without dropping them silently", async () => {
    listHouseholdMembersMock.mockResolvedValue([
      buildMember({ id: "m-1", allergy_status: "registered" }),
    ]);
    listAllergenCatalogMock.mockResolvedValue([
      { id: "a-egg", display_name: "卵" },
    ] as AllergenCatalogRow[]);
    listMemberAllergiesMock.mockResolvedValue([
      { allergen_id: "a-egg", custom_confirmed: false, custom_name: null },
      { allergen_id: "a-missing", custom_confirmed: false, custom_name: null },
    ]);

    const members = await loadHouseholdSafetyMembers("u1");

    expect(members[0]?.allergyLabel).not.toContain("a-missing");
    expect(members[0]?.blockedReason).not.toBeNull();
  });
});
