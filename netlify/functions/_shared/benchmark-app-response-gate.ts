/**
 * 有料ベンチ §4.4.2 のアプリ側ゲート。
 * 本番 openrouter 応答パース + materialize + validate と同じ経路を要求する。
 * （最低キー形状だけの合格は設計違反のため禁止）
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  aiGenerationResponseSchema,
  type AiGenerationResponse,
} from "../../../shared/contracts/generation.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";
import { validateGeneratedMenu } from "../../../shared/safety/validate-generated-menu.js";
import { makeGenerationContext } from "../../../shared/testing/factories.js";
import { materializeAiGeneratedMenu } from "./generation-materializer.js";
import { GenerationOutputError } from "./generation-repair.js";

/** 本番 openrouter.ts の responseSchema と同一（model 必須・choices 最低1） */
const openRouterResponseEnvelopeSchema = z.object({
  model: z.string().min(1),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string() }),
      }),
    )
    .min(1),
});

const benchPantryItemId = "61000000-0000-4000-8000-000000000001";

/**
 * ベンチ固定の GenerationContext。
 * プロンプトと整合させる: 必須手元食材「ごはん」(pantry_1)、member_1、和食朝食・15分。
 */
export function createBenchGenerationContext(): GenerationContext {
  const base = makeGenerationContext();
  return {
    ...base,
    submission: {
      ...base.submission,
      mealType: "breakfast",
      mainIngredients: ["ごはん"],
      cuisineGenre: "japanese",
      timeLimitMinutes: 15,
      pantrySelections: [{ pantryItemId: benchPantryItemId, priority: "must_use" }],
    },
    pantryItems: [
      {
        id: benchPantryItemId,
        userId: "62000000-0000-4000-8000-000000000001",
        name: "ごはん",
        quantity: 500,
        unit: "g",
        expiresOn: null,
        expirationType: null,
        openedState: null,
        createdAt: "2026-07-11T00:00:00.000Z",
        updatedAt: "2026-07-11T00:00:00.000Z",
      },
    ],
  };
}

export type AppGateResult =
  | { ok: true; detail: "ok"; decoded: AiGenerationResponse }
  | { ok: false; detail: string };

/**
 * 本番相当の応答受理判定。
 * - envelope.model が要求 modelId と一致
 * - openrouter response envelope schema
 * - content の aiGenerationResponseSchema
 * - success 時のみ materializeAiGeneratedMenu + validateGeneratedMenu
 */
export function evaluateAppResponseGate(
  rawEnvelope: unknown,
  requestedModelId: string,
  context: GenerationContext = createBenchGenerationContext(),
  uuid: () => string = () => randomUUID(),
): AppGateResult {
  const modelOnly = z.object({ model: z.string().min(1) }).safeParse(rawEnvelope);
  if (!modelOnly.success) {
    return { ok: false, detail: "envelope_model_missing" };
  }
  if (modelOnly.data.model !== requestedModelId) {
    return { ok: false, detail: "envelope_model_mismatch" };
  }

  const envelope = openRouterResponseEnvelopeSchema.safeParse(rawEnvelope);
  if (!envelope.success) {
    return { ok: false, detail: "envelope_schema_fail" };
  }

  const content = envelope.data.choices[0]?.message.content;
  if (typeof content !== "string") {
    return { ok: false, detail: "missing_or_invalid_content" };
  }

  let decodedUnknown: unknown;
  try {
    decodedUnknown = JSON.parse(content) as unknown;
  } catch {
    return { ok: false, detail: "content_json_fail" };
  }

  const decoded = aiGenerationResponseSchema.safeParse(decodedUnknown);
  if (!decoded.success) {
    return { ok: false, detail: "ai_generation_schema_fail" };
  }

  if (decoded.data.outcome !== "success") {
    return { ok: false, detail: "outcome_not_success" };
  }

  try {
    const menu = materializeAiGeneratedMenu(decoded.data.menu, context, uuid);
    const validation = validateGeneratedMenu(menu, context);
    if (!validation.ok) {
      return { ok: false, detail: "validate_generated_menu_fail" };
    }
  } catch (error) {
    if (error instanceof GenerationOutputError) {
      return { ok: false, detail: `materialize_fail:${error.issues[0]?.code ?? "unknown"}` };
    }
    return { ok: false, detail: "materialize_fail" };
  }

  return { ok: true, detail: "ok", decoded: decoded.data };
}

/** ベンチ合格フィクスチャ（tests / ゲート自己検証用）。完全な provider menu。 */
export function createBenchPassingMenuPayload() {
  return {
    schemaVersion: "2026-07-11.v1" as const,
    mealType: "breakfast" as const,
    cuisineGenre: "japanese" as const,
    servings: 2,
    totalElapsedMinutes: 15,
    safetyTags: [] as string[],
    dishes: [
      {
        dishRef: "dish_1",
        role: "main" as const,
        position: 1,
        name: "塩おにぎり",
        description: "朝の主食",
        cookingTimeMinutes: 10,
        ingredients: [
          {
            ingredientRef: "ingredient_1",
            position: 1,
            name: "ごはん",
            quantityValue: 300,
            quantityText: "300g",
            unit: "g",
            storeSection: "dry_goods" as const,
            pantryRef: "pantry_1",
            labelConfirmationRequired: false,
          },
        ],
        steps: [{ stepRef: "step_1", position: 1, instruction: "ごはんを握る" }],
      },
      {
        dishRef: "dish_2",
        role: "side" as const,
        position: 2,
        name: "温野菜",
        description: "加熱した野菜",
        cookingTimeMinutes: 5,
        ingredients: [
          {
            ingredientRef: "ingredient_2",
            position: 1,
            name: "にんじん",
            quantityValue: 0.5,
            quantityText: "1/2本",
            unit: "本",
            storeSection: "produce" as const,
            pantryRef: null,
            labelConfirmationRequired: false,
          },
        ],
        steps: [{ stepRef: "step_2", position: 1, instruction: "やわらかく加熱する" }],
      },
    ],
    timeline: [
      {
        timelineRef: "timeline_1",
        position: 1,
        startMinute: 0,
        durationMinutes: 10,
        instruction: "おにぎりを作る",
        dishRef: "dish_1",
        stepRef: "step_1",
      },
    ],
    adaptations: [
      {
        adaptationRef: "adaptation_1",
        dishRef: "dish_1",
        anonymousMemberRef: "member_1",
        portionText: "通常量",
        beforeStepRef: "step_1",
        additionalCutting: null,
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: "通常の取り分けを確認する",
        safetyTags: [],
        safetyActions: [],
      },
    ],
    pantryUsage: [
      {
        pantryRef: "pantry_1",
        priority: "must_use" as const,
        usageStatus: "used" as const,
        plannedQuantity: 300,
        unit: " g ",
        dishRefs: ["dish_1"],
        unusedReason: null,
      },
    ],
    labelConfirmations: [],
  };
}

export function createBenchPassingEnvelope(modelId: string): unknown {
  return {
    model: modelId,
    choices: [
      {
        message: {
          content: JSON.stringify({
            outcome: "success",
            menu: createBenchPassingMenuPayload(),
          }),
        },
      },
    ],
  };
}
