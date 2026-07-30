/**
 * L13 off 時の prompt 合成。DIVERSITY_HINTS_ENABLED を mock するため専用ファイルにする。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeGenerationContext,
  makeIdeaGenerationContext,
} from "../../../shared/testing/factories.js";
import { createCurrentSafetyFingerprint } from "../../../shared/safety/fingerprint.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";

const diversityState = vi.hoisted(() => ({ enabled: false }));

vi.mock("./diversity-hints.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./diversity-hints.js")>();
  return {
    ...actual,
    get DIVERSITY_HINTS_ENABLED() {
      return diversityState.enabled;
    },
  };
});

import { DIVERSITY_SYSTEM_MARKER } from "./diversity-hints.js";
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
    // flag off でも execution に載っていても payload は [] にする
    recentDishHints: [{ dishName: "無視される料理", role: "main" }],
  };
}

describe("buildGenerationMessages L13 off", () => {
  beforeEach(() => {
    diversityState.enabled = false;
  });

  it("L13 off: payload []; no DIVERSITY_SYSTEM_MARKER", () => {
    const contexts: GenerationContext[] = [makeGenerationContext(), makeIdeaGenerationContext()];
    for (const context of contexts) {
      const messages = buildGenerationMessages(asNewMenuExecution(context));
      const systemMessage = messages.find((message) => message.role === "system");
      const system = typeof systemMessage?.content === "string" ? systemMessage.content : "";
      expect(system).not.toContain(DIVERSITY_SYSTEM_MARKER);
      const userMessage = messages.find((message) => message.role === "user");
      const userContent = typeof userMessage?.content === "string" ? userMessage.content : "";
      const serialized = userContent
        .replace("<kondate_input_data>\n", "")
        .replace("\n</kondate_input_data>", "");
      const payload = JSON.parse(serialized) as { recentDishHints?: unknown };
      expect(payload.recentDishHints).toEqual([]);
    }
  });
});
