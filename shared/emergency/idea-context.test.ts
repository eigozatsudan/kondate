import { describe, expect, it } from "vitest";
import { emergencyMenuFixturesV1 } from "./fixtures.v1.js";
import { emergencyGenerationContext, filterEmergencyMenus } from "./filter-emergency-menus.js";
import { buildIdeaPersonalSafetyContext } from "./idea-context.js";

describe("buildIdeaPersonalSafetyContext", () => {
  it("builds adult none-allergy context with fixed synthetic member id", () => {
    const { context, memberLabels } = buildIdeaPersonalSafetyContext();
    expect(context.members).toHaveLength(1);
    expect(context.members[0]!.householdMemberId).toBe("83000000-0000-4000-8000-000000000001");
    expect(context.members[0]!.allergyStatus).toBe("none");
    expect(context.members[0]!.ageBand).toBe("adult");
    expect(context.members[0]!.anonymousRef).toBe("member_1");
    expect(context.members[0]!.hasUnmappedCustomAllergy).toBe(false);
    expect(context.members[0]!.requiredSafetyConstraints).toEqual([]);
    expect(context.members[0]!.unsupportedDietStatus).toBe("none");
    expect(context.foodRuleVersion).toBe("jp-caa-child-shape-2026-07.v1");
    expect(memberLabels.member_1).toBe("あなた");
  });

  it("idea personal filter returns ≥1 per mealType", () => {
    for (const mealType of ["breakfast", "lunch", "dinner"] as const) {
      const { context, memberLabels } = buildIdeaPersonalSafetyContext();
      const result = filterEmergencyMenus({
        mealType,
        pantryNames: [],
        context,
        memberLabels,
      });
      expect(result.menus.length, mealType).toBeGreaterThan(0);
      expect(result.emptyReason).toBeNull();
    }
  });

  it("idea filter validates fixtures with generation context targetMode household", () => {
    // 方針 A: export した emergencyGenerationContext の契約で targetMode === "household"
    // idea パスで validateIdeaMenu 分岐に入らないこと
    const { context, memberLabels } = buildIdeaPersonalSafetyContext();
    const gen = emergencyGenerationContext(emergencyMenuFixturesV1[0]!, context, memberLabels);
    expect(gen.targetMode).toBe("household");
    expect(gen.submission.targetMode).toBe("household");
  });
});
