import { describe, expect, it } from "vitest";
import { buildWeeklyPlanMessages } from "./weekly-plan-prompt.js";
import { WEEKLY_EFFORT_SENTENCE } from "./effort-hints.js";
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
  effortPreference: null,
  priorityIngredients: [],
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

  it("serializes priorityIngredients into the preferences payload", () => {
    const messages = buildWeeklyPlanMessages(
      { ...sampleRequest, priorityIngredients: ["鶏むね肉", "キャベツ"] },
      sampleSafety(),
    );
    const userMessage = messages[1];
    expect(userMessage?.role).toBe("user");
    const content = typeof userMessage?.content === "string" ? userMessage.content : "";
    const payload = JSON.parse(content.replace(/<\/?kondate_weekly_plan_input>/gu, "")) as {
      preferences: { priorityIngredients: string[] };
    };
    expect(payload.preferences.priorityIngredients).toEqual(["鶏むね肉", "キャベツ"]);
  });

  it("adds the weekly effort sentence and payload value only when easy is selected", () => {
    const easy = buildWeeklyPlanMessages(
      { ...sampleRequest, effortPreference: "easy" },
      sampleSafety(),
    );
    const easySystem = typeof easy[0]?.content === "string" ? easy[0].content : "";
    expect(easySystem).toContain(WEEKLY_EFFORT_SENTENCE);
    expect(WEEKLY_EFFORT_SENTENCE).toContain("生地");
    expect(WEEKLY_EFFORT_SENTENCE).toContain("包む");
    expect(WEEKLY_EFFORT_SENTENCE).toContain("安全条件・アレルギーと十分な加熱が常に優先です。");
    const easyUser = typeof easy[1]?.content === "string" ? easy[1].content : "";
    const easyPayload = JSON.parse(easyUser.replace(/<\/?kondate_weekly_plan_input>/gu, "")) as {
      preferences: Record<string, unknown>;
    };
    expect(easyPayload.preferences.effortPreference).toBe("easy");

    for (const effortPreference of ["standard", null] as const) {
      const messages = buildWeeklyPlanMessages(
        { ...sampleRequest, effortPreference },
        sampleSafety(),
      );
      const system = typeof messages[0]?.content === "string" ? messages[0].content : "";
      expect(system).not.toContain(WEEKLY_EFFORT_SENTENCE);
      const user = typeof messages[1]?.content === "string" ? messages[1].content : "";
      expect(user).not.toContain("effortPreference");
    }
  });

  it("places the weekly effort sentence right after the priorityIngredients sentence", () => {
    const messages = buildWeeklyPlanMessages(
      { ...sampleRequest, effortPreference: "easy" },
      sampleSafety(),
    );
    const system = typeof messages[0]?.content === "string" ? messages[0].content : "";
    const priorityEnd =
      system.indexOf("7日の献立に優先的に取り入れてください。") +
      "7日の献立に優先的に取り入れてください。".length;
    expect(system.indexOf(WEEKLY_EFFORT_SENTENCE)).toBe(priorityEnd);
  });

  it("instructs the model to prioritize priorityIngredients within safety limits", () => {
    const messages = buildWeeklyPlanMessages(sampleRequest, sampleSafety());
    const system = messages[0]?.content ?? "";
    expect(system).toContain("priorityIngredients");
    expect(system).toContain("優先的に取り入れてください");
    expect(system).toContain("安全条件に抵触しない範囲で");
  });

  it("shares the exact response_format reference with the flyer weekly menu", () => {
    // 型・スキーマは import 参照の同一性で確認する（別名の json_schema を作らない）
    expect(weeklyFlyerMenuResponseFormat.json_schema.name).toBe("kondate_weekly_flyer_menu");
  });
});
