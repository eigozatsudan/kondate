/**
 * 手間 kill-switch off 時の週献立 prompt。
 * EFFORT_HINTS_ENABLED を mock するため専用ファイルにする。
 */
import { describe, expect, it, vi } from "vitest";
import type { CurrentSafetyContext } from "../../../shared/safety/context.js";
import type { WeeklyPlanRequest } from "../../../shared/contracts/weekly-plan.js";

const effortState = vi.hoisted(() => ({ enabled: false }));

vi.mock("./effort-hints.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./effort-hints.js")>();
  return {
    ...actual,
    get EFFORT_HINTS_ENABLED() {
      return effortState.enabled;
    },
  };
});

import { WEEKLY_EFFORT_SENTENCE } from "./effort-hints.js";
import { buildWeeklyPlanMessages } from "./weekly-plan-prompt.js";

const safety: CurrentSafetyContext = {
  dictionaryVersion: "v1",
  foodRuleVersion: "v1",
  requestText: "",
  members: [
    {
      householdMemberId: "m1",
      anonymousRef: "member_1",
      ageBand: "adult",
      allergyStatus: "none",
      allergenIds: [],
      hasUnmappedCustomAllergy: false,
      customAllergies: [],
      requiredSafetyConstraints: [],
      unsupportedDietStatus: "none",
      unsupportedDietKinds: [],
    },
  ],
  allergenDictionary: { version: "test", catalog: [], aliases: [] },
  foodSafetyRules: [],
};

const request: WeeklyPlanRequest = {
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  targetMemberIds: ["m1"],
  cuisineGenre: "japanese",
  budgetPreference: null,
  noveltyPreference: null,
  effortPreference: "easy",
  priorityIngredients: [],
};

describe("buildWeeklyPlanMessages effort off", () => {
  it("drops both the sentence and the payload value even when easy is selected", () => {
    for (const message of buildWeeklyPlanMessages(request, safety)) {
      const content = typeof message.content === "string" ? message.content : "";
      expect(content).not.toContain(WEEKLY_EFFORT_SENTENCE);
      expect(content).not.toContain("effortPreference");
    }
  });
});
