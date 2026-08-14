/**
 * 共有一般化 Pass1/Pass2 専用 OpenRouter 呼び出し。
 * 通常 generate の予約台帳 / freemium 生成枠とは完全独立。
 * structured outputs のみ。生プロンプト・生 AI 本文はログしない。
 */

import { z } from "zod";
import { OPENROUTER_TIMEOUT_MS } from "../../../shared/contracts/function-budget.js";
import { safetyActionKinds, type ValidatedMenu } from "../../../shared/contracts/generation.js";
import { getServerEnv } from "./env.js";
import {
  ensureOpenRouterRuntimeModelPolicy,
  OpenRouterCallError,
  OPENROUTER_MAX_BODY_BYTES,
  readResponseBodyWithByteCap,
  type OpenRouterGenerationRuntimeInput,
  type OpenRouterMessage,
} from "./openrouter.js";
import { readOpenRouterMockScenario } from "./openrouter-mock-scenario.js";

/** Pass 種別（ログ・モデル列用の閉じた値） */
export type SharePassKind = "pass1" | "pass2";

/**
 * モデルが返す自由文パッチ。数量・構成はサーバーがロックから復元するため含めない。
 * id 対応で merge し、欠落・余剰 id は fail-closed。
 */
export const shareFreeTextPatchSchema = z
  .object({
    dishes: z
      .array(
        z
          .object({
            id: z.uuid(),
            name: z.string().trim().min(1).max(100),
            description: z.string().trim().min(1).max(300),
            ingredients: z
              .array(
                z
                  .object({
                    id: z.uuid(),
                    name: z.string().trim().min(1).max(100),
                    // AP1: quantityText は自由文（数量ロックの対象外）。数値・単位はサーバが復元する。
                    quantityText: z.string().trim().min(1).max(60),
                  })
                  .strict(),
              )
              .max(50),
            steps: z
              .array(
                z
                  .object({
                    id: z.uuid(),
                    instruction: z.string().trim().min(1).max(500),
                  })
                  .strict(),
              )
              .max(30),
          })
          .strict(),
      )
      .min(1)
      .max(5),
    timeline: z
      .array(
        z
          .object({
            id: z.uuid(),
            instruction: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(60),
    adaptations: z
      .array(
        z
          .object({
            id: z.uuid(),
            portionText: z.string().trim().min(1).max(80),
            additionalCutting: z.string().trim().min(1).max(300).nullable(),
            additionalHeating: z.string().trim().min(1).max(300).nullable(),
            additionalSeasoning: z.string().trim().min(1).max(300).nullable(),
            servingCheck: z.string().trim().min(1).max(300),
            safetyActions: z
              .array(
                z
                  .object({
                    kind: z.enum(safetyActionKinds),
                    ingredientId: z.uuid(),
                    beforeRecipeStepId: z.uuid(),
                    instruction: z.string().trim().min(1).max(300),
                  })
                  .strict(),
              )
              .max(20),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export type ShareFreeTextPatch = z.infer<typeof shareFreeTextPatchSchema>;

/** OpenRouter response_format（strict structured）。$schema は provider 向けに除去 */
const shareFreeTextJsonSchema = z.toJSONSchema(shareFreeTextPatchSchema, {
  target: "draft-2020-12",
});
delete shareFreeTextJsonSchema.$schema;

export const shareFreeTextResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "kondate_share_free_text_patch",
    strict: true,
    schema: shareFreeTextJsonSchema,
  },
} as const;

const responseEnvelopeSchema = z.object({
  model: z.string().min(1),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string() }),
      }),
    )
    .min(1),
});
const modelOnlySchema = z.object({ model: z.string().min(1) });
const evidenceModelIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);

function isExactLocalMockBaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "http:" &&
      parsed.hostname === "openrouter-mock" &&
      parsed.port === "8787" &&
      parsed.pathname === "/api/v1" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}

/** メニューからモデル入力用の自由文スナップショットを切り出す（数量の数値・単位は載せない） */
export function extractShareFreeTextForPrompt(menu: ValidatedMenu): ShareFreeTextPatch {
  return {
    dishes: menu.dishes.map((dish) => ({
      id: dish.id,
      name: dish.name,
      description: dish.description,
      ingredients: dish.ingredients.map((ingredient) => ({
        id: ingredient.id,
        name: ingredient.name,
        // AP1: 数量自由文も一般化対象。quantityValue / unit は載せない。
        quantityText: ingredient.quantityText,
      })),
      steps: dish.steps.map((step) => ({
        id: step.id,
        instruction: step.instruction,
      })),
    })),
    timeline: menu.timeline.map((step) => ({
      id: step.id,
      instruction: step.instruction,
    })),
    adaptations: menu.adaptations.map((adaptation) => ({
      id: adaptation.id,
      portionText: adaptation.portionText,
      additionalCutting: adaptation.additionalCutting,
      additionalHeating: adaptation.additionalHeating,
      additionalSeasoning: adaptation.additionalSeasoning,
      servingCheck: adaptation.servingCheck,
      safetyActions: adaptation.safetyActions.map((action) => ({
        kind: action.kind,
        ingredientId: action.ingredientId,
        beforeRecipeStepId: action.beforeRecipeStepId,
        instruction: action.instruction,
      })),
    })),
  };
}

const PASS1_SYSTEM =
  "共有用レシピの自由文だけを一般化してください。" +
  "指定スキーマの JSON のみを返してください。" +
  "人名・家族呼び・「うちの」等の固有表現を一般的な表現に置き換えてください。" +
  "医療・アレルギー安全の保証表現は書かないでください。" +
  "材料・料理の id は入力と同一を維持してください。" +
  "数量の数値・単位・構成は変更対象外です。" +
  "quantityText は自由文として一般化してください（人名や世帯呼びを残さない）。" +
  "利用者向け文言はすべて日本語で書いてください。";

const PASS2_SYSTEM =
  "共有用レシピ自由文の点検と修正をしてください。" +
  "指定スキーマの JSON のみを返してください。" +
  "プライバシー残渣（人名・家族呼び・個人特定っぽい表現）、保証表現、" +
  "共有向きでない表現を除去または中立表現へ直してください。" +
  "材料・料理の id は入力と同一を維持してください。" +
  "数量の数値・単位・構成は変更対象外です。" +
  "quantityText は自由文として点検し、人名や世帯呼びが残っていれば中立な分量表現へ直してください。" +
  "利用者向け文言はすべて日本語で書いてください。";

/**
 * Pass 用メッセージ列。自由文のみを JSON で渡し、数量の数値・単位は載せない。
 * quantityText は一般化対象。プロンプト本文は呼び出し元でもログしないこと。
 */
export function buildSharePassMessages(
  pass: SharePassKind,
  menu: ValidatedMenu,
): OpenRouterMessage[] {
  const freeText = extractShareFreeTextForPrompt(menu);
  const system = pass === "pass1" ? PASS1_SYSTEM : PASS2_SYSTEM;
  const task =
    pass === "pass1"
      ? "次の自由文を共有向けに一般化してください。"
      : "次の自由文を点検し、必要なら修正してください。問題なければ同等の中立表現で返してください。";
  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `${task}\n${JSON.stringify(freeText)}`,
    },
  ];
}

export type ShareOpenRouterPassInput = {
  pass: SharePassKind;
  menu: ValidatedMenu;
  timeoutMs: number;
  excludedModelIds?: readonly string[];
};

export type ShareOpenRouterPassResult = {
  patch: ShareFreeTextPatch;
  modelId: string;
};

export type ShareOpenRouterRuntimeInput = OpenRouterGenerationRuntimeInput;

/**
 * Pass1 または Pass2 を 1 回呼び、structured free-text patch を返す。
 * generate 予約台帳・freemium 生成枠には一切触れない。
 */
export async function sendShareGeneralizationPass(
  input: ShareOpenRouterPassInput,
  runtime: ShareOpenRouterRuntimeInput,
): Promise<ShareOpenRouterPassResult> {
  const configuredModels = runtime.models;
  const routers = new Set(["openrouter/auto", "openrouter/free", "openrouter/auto-beta"]);
  const rejectsRouterOrEmptyOrDup =
    configuredModels.length === 0 ||
    new Set(configuredModels).size !== configuredModels.length ||
    configuredModels.some((model) => routers.has(model.toLowerCase()));
  const rejectsMockOrFreeOnRealApi =
    !isExactLocalMockBaseUrl(runtime.baseUrl) &&
    configuredModels.some((model) => {
      const normalized = model.toLowerCase();
      return normalized.endsWith(":free") || normalized.startsWith("mock/");
    });
  if (rejectsRouterOrEmptyOrDup || rejectsMockOrFreeOnRealApi) {
    throw new OpenRouterCallError("model_unavailable");
  }

  const excluded = new Set(input.excludedModelIds ?? []);
  const models = configuredModels.filter((model) => !excluded.has(model));
  if (models.length === 0) {
    throw new OpenRouterCallError("model_unavailable");
  }
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new OpenRouterCallError("generation_timeout");
  }
  if (!Number.isFinite(runtime.timeoutMs) || runtime.timeoutMs <= 0) {
    throw new OpenRouterCallError("generation_timeout");
  }

  await ensureOpenRouterRuntimeModelPolicy({
    baseUrl: runtime.baseUrl,
    models: configuredModels,
    apiKey: runtime.apiKey,
    ...(runtime.fetchImpl !== undefined ? { fetchImpl: runtime.fetchImpl } : {}),
  });

  const timeoutMs = Math.min(runtime.timeoutMs, input.timeoutMs);
  const fetchImpl = runtime.fetchImpl ?? fetch;
  const monotonicNow = runtime.now ?? (() => performance.now());
  const controller = new AbortController();
  const startedAt = monotonicNow();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  const assertWithinDeadline = (): void => {
    if (controller.signal.aborted || monotonicNow() - startedAt >= timeoutMs) {
      throw new OpenRouterCallError("generation_timeout");
    }
  };

  try {
    const testScenario = readOpenRouterMockScenario() ?? process.env.OPENROUTER_MOCK_SCENARIO;
    const messages = buildSharePassMessages(input.pass, input.menu);
    assertWithinDeadline();

    let response: Response;
    try {
      response = await fetchImpl(`${runtime.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${runtime.apiKey}`,
          "Content-Type": "application/json",
          ...(testScenario && isExactLocalMockBaseUrl(runtime.baseUrl)
            ? { "X-Kondate-Mock-Scenario": testScenario }
            : {}),
        },
        body: JSON.stringify({
          models,
          messages,
          response_format: shareFreeTextResponseFormat,
          provider: { require_parameters: true },
          stream: false,
        }),
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) {
        throw new OpenRouterCallError("generation_timeout");
      }
      throw new OpenRouterCallError("model_unavailable");
    }
    assertWithinDeadline();

    if (response.status !== 200) {
      throw new OpenRouterCallError("model_unavailable");
    }

    let rawBody: string;
    try {
      rawBody = await readResponseBodyWithByteCap(
        response,
        OPENROUTER_MAX_BODY_BYTES,
        controller.signal,
      );
    } catch (error) {
      if (error instanceof OpenRouterCallError) throw error;
      if (controller.signal.aborted) {
        throw new OpenRouterCallError("generation_timeout");
      }
      throw new OpenRouterCallError("model_unavailable");
    }
    assertWithinDeadline();

    let rawEnvelope: unknown;
    try {
      rawEnvelope = JSON.parse(rawBody) as unknown;
    } catch {
      throw new OpenRouterCallError("invalid_ai_response");
    }

    const knownModel = modelOnlySchema.safeParse(rawEnvelope);
    const modelId = knownModel.success ? knownModel.data.model : null;
    if (modelId !== null && !models.includes(modelId)) {
      const evidenceModelId = evidenceModelIdSchema.safeParse(modelId);
      throw new OpenRouterCallError(
        "model_unavailable",
        evidenceModelId.success ? evidenceModelId.data : null,
      );
    }

    const envelope = responseEnvelopeSchema.safeParse(rawEnvelope);
    if (!envelope.success) {
      throw new OpenRouterCallError("invalid_ai_response", modelId);
    }

    const firstChoice = envelope.data.choices[0];
    if (firstChoice === undefined) {
      throw new OpenRouterCallError("invalid_ai_response", envelope.data.model);
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(firstChoice.message.content) as unknown;
    } catch {
      throw new OpenRouterCallError("invalid_ai_response", envelope.data.model);
    }

    const patch = shareFreeTextPatchSchema.safeParse(decoded);
    if (!patch.success) {
      throw new OpenRouterCallError("invalid_ai_response", envelope.data.model);
    }

    return { patch: patch.data, modelId: envelope.data.model };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * env から runtime を組み立てて Pass を送る production 入口。
 * 共有 worker 以外から generate 寿命に載せて呼ばないこと。
 */
export async function sendShareGeneralizationPassFromEnv(
  input: ShareOpenRouterPassInput,
): Promise<ShareOpenRouterPassResult> {
  const config = getServerEnv().openRouter;
  return sendShareGeneralizationPass(input, {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    models: config.models,
    timeoutMs: config.timeoutMs,
  });
}

/** テスト・pipeline 用: 既定 timeout を閉じた sender */
export function createShareOpenRouterPassSender(
  runtime: ShareOpenRouterRuntimeInput,
): (
  input: Omit<ShareOpenRouterPassInput, "timeoutMs"> & { timeoutMs?: number },
) => Promise<ShareOpenRouterPassResult> {
  return async (input) =>
    sendShareGeneralizationPass(
      {
        pass: input.pass,
        menu: input.menu,
        timeoutMs: input.timeoutMs ?? OPENROUTER_TIMEOUT_MS,
        ...(input.excludedModelIds !== undefined
          ? { excludedModelIds: input.excludedModelIds }
          : {}),
      },
      runtime,
    );
}
