/**
 * ひねり kill-switch off 時の prompt 合成。
 * NOVELTY_HINTS_ENABLED を mock するため専用ファイルにする（diversity-off と同型）。
 */
import { describe, expect, it, vi } from "vitest";
import { makeGenerationContext } from "../../../shared/testing/factories.js";
import { createCurrentSafetyFingerprint } from "../../../shared/safety/fingerprint.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";

const noveltyState = vi.hoisted(() => ({ enabled: false }));

vi.mock("./novelty-hints.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./novelty-hints.js")>();
  return {
    ...actual,
    get NOVELTY_HINTS_ENABLED() {
      return noveltyState.enabled;
    },
  };
});

import { NOVELTY_SYSTEM_MARKER } from "./novelty-hints.js";
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

describe("buildGenerationMessages novelty off", () => {
  it("drops both the paragraph and the key even when twist is selected", () => {
    const base = makeGenerationContext();
    const context: GenerationContext = {
      ...base,
      submission: { ...base.submission, noveltyPreference: "twist", mainIngredients: ["豚肉"] },
    };
    const messages = buildGenerationMessages(asNewMenuExecution(context));
    const systemMessage = messages.find((message) => message.role === "system");
    const system = typeof systemMessage?.content === "string" ? systemMessage.content : "";
    expect(system).not.toContain(NOVELTY_SYSTEM_MARKER);
    const userMessage = messages.find((message) => message.role === "user");
    const userContent = typeof userMessage?.content === "string" ? userMessage.content : "";
    const serialized = userContent
      .replace("<kondate_input_data>\n", "")
      .replace("\n</kondate_input_data>", "");
    const payload = JSON.parse(serialized) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(payload, "noveltyExcludedDishes")).toBe(false);
  });
});
