/**
 * 手間 kill-switch off 時の prompt 合成。
 * EFFORT_HINTS_ENABLED を mock するため専用ファイルにする（novelty-off と同型）。
 */
import { describe, expect, it, vi } from "vitest";
import { makeGenerationContext, makeValidatedMenu } from "../../../shared/testing/factories.js";
import { createCurrentSafetyFingerprint } from "../../../shared/safety/fingerprint.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";

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

import { EFFORT_SYSTEM_MARKER } from "./effort-hints.js";
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
    tasteHints: null,
  };
}

function regenerateMenuExecution(
  context: GenerationContext,
): Extract<GenerationExecutionContext, { kind: "regenerate_menu" }> {
  const sourceMenu = makeValidatedMenu();
  return {
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
    expectedSafetyFingerprint:
      context.targetMode === "idea" ? "idea" : createCurrentSafetyFingerprint(context.safety),
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
}

function easyContext(): GenerationContext {
  const base = makeGenerationContext();
  return { ...base, submission: { ...base.submission, effortPreference: "easy" } };
}

function expectNoEffort(messages: ReturnType<typeof buildGenerationMessages>): void {
  for (const message of messages) {
    const content = typeof message.content === "string" ? message.content : "";
    expect(content).not.toContain(EFFORT_SYSTEM_MARKER);
    expect(content).not.toContain("effortPreference");
  }
}

describe("buildGenerationMessages effort off", () => {
  it("drops both the paragraph and the payload value on new_menu even when easy is selected", () => {
    expectNoEffort(buildGenerationMessages(asNewMenuExecution(easyContext())));
  });

  it("drops both the paragraph and the payload value on regenerate_menu too", () => {
    expectNoEffort(buildGenerationMessages(regenerateMenuExecution(easyContext())));
  });
});
