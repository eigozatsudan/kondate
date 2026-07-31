/**
 * 家庭キッチン soft off 時の prompt 合成。
 * HOUSEHOLD_KITCHEN_PROMPT_ENABLED を mock するため専用ファイルにする
 * （generation-prompt-diversity-off.test.ts と同型）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeGenerationContext,
  makeIdeaGenerationContext,
  makeValidatedMenu,
} from "../../../shared/testing/factories.js";
import { createCurrentSafetyFingerprint } from "../../../shared/safety/fingerprint.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";

const kitchenState = vi.hoisted(() => ({ enabled: false }));

vi.mock("./household-kitchen-prompt.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./household-kitchen-prompt.js")>();
  return {
    ...actual,
    get HOUSEHOLD_KITCHEN_PROMPT_ENABLED() {
      return kitchenState.enabled;
    },
  };
});

import { HOUSEHOLD_KITCHEN_SYSTEM_MARKER } from "./household-kitchen-prompt.js";
import { buildGenerationMessages } from "./generation-prompt.js";
import type { GenerationExecutionContext } from "./generation-service.js";

function asNewMenuExecution(
  context: GenerationContext,
): Extract<GenerationExecutionContext, { kind: "new_menu" }> {
  return {
    kind: "new_menu",
    command: {
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: {
        idempotencyKey: "56000000-0000-4000-8000-000000000001",
        draftId: "84000000-0000-4000-8000-000000000001",
        draftRevision: 1,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    },
    requestId: "81000000-0000-4000-8000-000000000001",
    generationContext: context,
    expectedSafetyFingerprint:
      context.targetMode === "idea" ? "idea" : createCurrentSafetyFingerprint(context.safety),
    startedAtMonotonicMs: 0,
    deadlineAtMonotonicMs: 50_000,
    regeneration: null,
    recentDishHints: [],
  };
}

function systemText(messages: ReturnType<typeof buildGenerationMessages>): string {
  const system = messages.find((message) => message.role === "system");
  return typeof system?.content === "string" ? system.content : "";
}

describe("buildGenerationMessages household kitchen off", () => {
  beforeEach(() => {
    kitchenState.enabled = false;
  });

  it("flag off: no kitchen marker and no gear non-conflict phrase on new_menu", () => {
    for (const context of [makeGenerationContext(), makeIdeaGenerationContext()]) {
      const system = systemText(buildGenerationMessages(asNewMenuExecution(context)));
      expect(system).not.toContain(HOUSEHOLD_KITCHEN_SYSTEM_MARKER);
      expect(system).not.toContain("機材・器具の都合");
      // 既存 non-conflict は残る
      expect(system).toContain("材料の都合・好みの曖昧さ");
    }
  });

  it("flag off: regenerate_menu also omits kitchen marker", () => {
    const context = makeGenerationContext();
    const sourceMenu = makeValidatedMenu();
    const execution: Extract<GenerationExecutionContext, { kind: "regenerate_menu" }> = {
      kind: "regenerate_menu",
      command: {
        commandVersion: "generation-command.v3",
        kind: "regenerate_menu",
        qualityMode: false,
        request: {
          idempotencyKey: "56000000-0000-4000-8000-000000000001",
          sourceMenuId: sourceMenu.menuId,
          changeReason: "simpler",
          changeReasonCustom: null,
          privacyNoticeVersion: "2026-07-29.v1",
          expiredPantryConfirmations: [],
        },
      },
      requestId: "81000000-0000-4000-8000-000000000001",
      generationContext: context,
      expectedSafetyFingerprint: createCurrentSafetyFingerprint(context.safety),
      startedAtMonotonicMs: 0,
      deadlineAtMonotonicMs: 50_000,
      regeneration: {
        sourceMenuId: sourceMenu.menuId,
        sourceMenu,
        derivationGroupId: "a1000000-0000-4000-8000-000000000001",
        replaceDishId: null,
        retainedDishIds: sourceMenu.dishes.map((dish) => dish.id),
        excludedDishIds: [],
        sourceSafetyFingerprint: "source-fp",
        sourcePreferenceSnapshot: {},
        existingDerivationMenus: [],
        artifacts: {
          retainedDishes: [],
          sourceDishToReplace: null,
          promptDto: null,
          retainedRefMap: new Map(),
        },
      },
    };
    const system = systemText(buildGenerationMessages(execution));
    expect(system).not.toContain(HOUSEHOLD_KITCHEN_SYSTEM_MARKER);
    expect(system).not.toContain("機材・器具の都合");
  });
});
