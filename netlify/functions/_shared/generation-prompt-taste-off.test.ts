/**
 * 学習 kill-switch off 時の prompt 合成。TASTE_HINTS_ENABLED を mock するため専用ファイルにする。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeGenerationContext,
  makeIdeaGenerationContext,
} from "../../../shared/testing/factories.js";
import { createCurrentSafetyFingerprint } from "../../../shared/safety/fingerprint.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";
import type { TasteHints } from "../../../shared/contracts/taste-hints.js";

const tasteState = vi.hoisted(() => ({ enabled: false }));

vi.mock("./taste-hints.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./taste-hints.js")>();
  return {
    ...actual,
    get TASTE_HINTS_ENABLED() {
      return tasteState.enabled;
    },
  };
});

import { TASTE_SYSTEM_MARKER } from "./taste-hints.js";
import { DIVERSITY_PARAGRAPH } from "./diversity-hints.js";
import { buildGenerationMessages } from "./generation-prompt.js";
import type { GenerationExecutionContext } from "./generation-service.js";

const someTasteHints: TasteHints = {
  likedDishes: [{ dishName: "ぶり大根", role: "main" }],
  likedGenres: ["japanese"],
  likedIngredients: ["大根"],
  likedTimeBand: "standard",
  overusedIngredients: ["豚肉"],
  avoidAxes: [],
  signalStrength: "medium",
};

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
    // flag off でも execution に載っていても段落・キーは出さない
    tasteHints: someTasteHints,
  };
}

describe("buildGenerationMessages taste off", () => {
  beforeEach(() => {
    tasteState.enabled = false;
  });

  it("taste off: no TASTE_SYSTEM_MARKER; no tasteHints key", () => {
    const contexts: GenerationContext[] = [makeGenerationContext(), makeIdeaGenerationContext()];
    for (const context of contexts) {
      const messages = buildGenerationMessages(asNewMenuExecution(context));
      const systemMessage = messages.find((message) => message.role === "system");
      const system = typeof systemMessage?.content === "string" ? systemMessage.content : "";
      expect(system).not.toContain(TASTE_SYSTEM_MARKER);
      const userMessage = messages.find((message) => message.role === "user");
      const userContent = typeof userMessage?.content === "string" ? userMessage.content : "";
      expect(userContent).not.toContain("tasteHints");
    }
  });

  // flag が false のときは execution.tasteHints が非 null でも、多様性段落の差し替え判定は
  // flag 経由で決まった tasteEnabled を使わなければならない（context.tasteHints !== null を
  // 直接使う退行を検出する）。DIVERSITY_PARAGRAPH（優先順位の文つき）がそのまま残ることを固定する。
  it("taste off: keeps DIVERSITY_PARAGRAPH (not the WITH_TASTE variant) even though execution.tasteHints is non-null", () => {
    const contexts: GenerationContext[] = [makeGenerationContext(), makeIdeaGenerationContext()];
    for (const context of contexts) {
      const messages = buildGenerationMessages(asNewMenuExecution(context));
      const systemMessage = messages.find((message) => message.role === "system");
      const system = typeof systemMessage?.content === "string" ? systemMessage.content : "";
      expect(system).toContain(DIVERSITY_PARAGRAPH);
      expect(system.split("優先順位は次のとおりです。").length - 1).toBe(1);
    }
  });
});
