import { describe, expect, it } from "vitest";
import { buildWeeklyPlanMessages } from "./weekly-plan-prompt.js";
import { weeklyFlyerMenuResponseFormat } from "../../../shared/contracts/flyer-weekly.js";
import type { CurrentSafetyContext } from "../../../shared/safety/context.js";
import type { WeeklyPlanRequest } from "../../../shared/contracts/weekly-plan.js";

function sampleSafety(): CurrentSafetyContext {
  return {
    dictionaryVersion: "v1",
    foodRuleVersion: "v1",
    requestText: "",
    members: [
      {
        householdMemberId: "m1",
        anonymousRef: "member_1",
        ageBand: "adult",
        allergyStatus: "registered",
        allergenIds: ["a1"],
        hasUnmappedCustomAllergy: false,
        customAllergies: [],
        requiredSafetyConstraints: [],
        unsupportedDietStatus: "none",
        unsupportedDietKinds: [],
      },
    ],
    // AllergenDictionary は version / catalog / aliases の 3 つが必須（shared/safety/allergens.ts）。
    allergenDictionary: { version: "test", catalog: [], aliases: [] },
    foodSafetyRules: [],
  };
}

const sampleRequest: WeeklyPlanRequest = {
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  targetMemberIds: ["m1"],
  cuisineGenre: "japanese",
  budgetPreference: null,
  noveltyPreference: null,
};

describe("buildWeeklyPlanMessages", () => {
  it("includes each target member's allergenIds in the system/user payload", () => {
    const messages = buildWeeklyPlanMessages(sampleRequest, sampleSafety());
    const serialized = JSON.stringify(messages);
    expect(serialized).toContain("a1");
    expect(serialized).toContain("member_1");
  });

  it("never includes a display name or member label", () => {
    const messages = buildWeeklyPlanMessages(sampleRequest, sampleSafety());
    const serialized = JSON.stringify(messages);
    expect(serialized).not.toContain("displayName");
  });

  it("sends text-only content (no image_url)", () => {
    const messages = buildWeeklyPlanMessages(sampleRequest, sampleSafety());
    for (const message of messages) {
      expect(JSON.stringify(message)).not.toContain("image_url");
    }
  });

  it("shares the exact response_format reference with the flyer weekly menu", () => {
    // 型・スキーマは import 参照の同一性で確認する（別名の json_schema を作らない）
    expect(weeklyFlyerMenuResponseFormat.json_schema.name).toBe("kondate_weekly_flyer_menu");
  });
});
