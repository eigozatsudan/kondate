import { z } from "zod";
import {
  aiGenerationResponseSchema,
  menuResponseFormat,
  type AiGenerationResponse,
} from "../../../shared/contracts/generation.js";
import { getServerEnv } from "./env.js";

export type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type OpenRouterGenerationInput = {
  messages: readonly OpenRouterMessage[];
  timeoutMs: number;
  excludedModelIds?: readonly string[];
};

export type OpenRouterGenerationResult = {
  output: AiGenerationResponse;
  modelId: string;
};

export class OpenRouterCallError extends Error {
  constructor(
    readonly code: "model_unavailable" | "invalid_ai_response" | "generation_timeout",
    readonly modelId: string | null = null,
    readonly retryAt: string | null = null,
  ) {
    super(code);
  }
}

const responseSchema = z.object({
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
const httpDatePattern = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/u;

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

function retryAt(response: Response, now: number): string | null {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) return null;
  if (/^\d+$/u.test(retryAfter)) {
    const target = now + Number(retryAfter) * 1_000;
    return Number.isFinite(target) && !Number.isNaN(new Date(target).getTime())
      ? new Date(target).toISOString()
      : null;
  }
  if (!httpDatePattern.test(retryAfter)) return null;
  const parsed = Date.parse(retryAfter);
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed);
  return date.toUTCString() === retryAfter && parsed >= now ? date.toISOString() : null;
}

export async function sendMenuGeneration(
  input: OpenRouterGenerationInput,
): Promise<OpenRouterGenerationResult> {
  const config = getServerEnv().openRouter;
  if (
    config.models.length === 0 ||
    new Set(config.models).size !== config.models.length ||
    config.models.some((model) => model === "openrouter/auto" || !model.endsWith(":free"))
  ) {
    throw new OpenRouterCallError("model_unavailable");
  }

  const excluded = new Set(input.excludedModelIds ?? []);
  const models = config.models.filter((model) => !excluded.has(model));
  if (models.length === 0) {
    throw new OpenRouterCallError("model_unavailable");
  }
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new OpenRouterCallError("generation_timeout");
  }
  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0) {
    throw new OpenRouterCallError("generation_timeout");
  }

  const timeoutMs = Math.min(config.timeoutMs, input.timeoutMs);
  const testScenario = process.env.OPENROUTER_MOCK_SCENARIO;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          ...(testScenario && isExactLocalMockBaseUrl(config.baseUrl)
            ? { "X-Kondate-Mock-Scenario": testScenario }
            : {}),
        },
        body: JSON.stringify({
          models,
          messages: input.messages,
          response_format: menuResponseFormat,
          provider: { require_parameters: true },
          temperature: 0.2,
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

    if (!response.ok) {
      throw new OpenRouterCallError("model_unavailable", null, retryAt(response, Date.now()));
    }

    let rawBody: string;
    try {
      rawBody = await response.text();
    } catch {
      if (controller.signal.aborted) {
        throw new OpenRouterCallError("generation_timeout");
      }
      throw new OpenRouterCallError("model_unavailable");
    }

    let rawEnvelope: unknown;
    try {
      rawEnvelope = JSON.parse(rawBody) as unknown;
    } catch {
      throw new OpenRouterCallError("invalid_ai_response");
    }

    const knownModel = modelOnlySchema.safeParse(rawEnvelope);
    const modelId = knownModel.success ? knownModel.data.model : null;
    if (modelId !== null && !models.includes(modelId)) {
      throw new OpenRouterCallError("model_unavailable");
    }
    const envelope = responseSchema.safeParse(rawEnvelope);
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
    const output = aiGenerationResponseSchema.safeParse(decoded);
    if (!output.success) {
      throw new OpenRouterCallError("invalid_ai_response", envelope.data.model);
    }
    return { output: output.data, modelId: envelope.data.model };
  } finally {
    clearTimeout(timeout);
  }
}
