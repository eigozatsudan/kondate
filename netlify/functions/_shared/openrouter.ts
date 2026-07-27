import { z } from "zod";
import {
  aiGenerationResponseSchema,
  aiGenerationWireResponseSchema,
  menuResponseFormat,
  toAiGenerationResponse,
  type AiGenerationResponse,
} from "../../../shared/contracts/generation.js";
import {
  dishRegenerationAiOutputSchema,
  type DishRegenerationAiOutput,
} from "../../../shared/contracts/regeneration.js";
import { getServerEnv } from "./env.js";
import { readOpenRouterMockScenario } from "./openrouter-mock-scenario.js";

export type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** フル献立 / 置換料理の wire モード。response_format とパース先を切り替える */
export type GenerationWireMode = "full_menu" | "replacement_dish";

export type OpenRouterGenerationInput = {
  messages: readonly OpenRouterMessage[];
  timeoutMs: number;
  /** 省略時は本番 OPENROUTER_MODELS。ベンチは exact 構成を明示する。 */
  models?: readonly string[];
  excludedModelIds?: readonly string[];
  /** 省略時は full_menu（Plan 3 互換） */
  mode?: GenerationWireMode;
};

export type OpenRouterGenerationRuntimeInput = Readonly<{
  apiKey: string;
  baseUrl: string;
  models: readonly string[];
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}>;

export type OpenRouterGenerationResult =
  | { mode: "full_menu"; output: AiGenerationResponse; modelId: string }
  | { mode: "replacement_dish"; output: DishRegenerationAiOutput; modelId: string };

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

/** 置換料理モードの JSON Schema response_format */
const dishRegenerationResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "kondate_dish_regeneration",
    strict: true,
    schema: z.toJSONSchema(dishRegenerationAiOutputSchema, {
      target: "draft-2020-12",
    }),
  },
} as const;

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

/** 外部 Retry-After を UI/台帳へ載せる上限（秒）。それ以上は切り詰める。 */
const maxRetryAfterSeconds = 86_400;

/** OpenRouter 応答本文の上限（A-I11）。mock 受信上限 1MiB に揃える。 */
export const OPENROUTER_MAX_BODY_BYTES = 1 * 1024 * 1024;

/**
 * byte cap後のcancelはbest-effort cleanupとして扱い、失敗でcap分類を失わない。
 * 永続pendingでも送信Abortを優先して抜け、登録したlistenerを全経路で除去する。
 */
async function cancelBodyReaderWithAbort(
  cancel: () => Promise<void>,
  signal?: AbortSignal,
): Promise<"cancel_settled" | "aborted"> {
  const cancelSettled = Promise.resolve()
    .then(cancel)
    .then(
      () => "cancel_settled" as const,
      () => "cancel_settled" as const,
    );
  if (signal === undefined) return cancelSettled;
  const signalIsAborted = (): boolean => signal.aborted;
  if (signalIsAborted()) return "aborted";

  let resolveAbort!: (value: "aborted") => void;
  const aborted = new Promise<"aborted">((resolve) => {
    resolveAbort = resolve;
  });
  const onAbort = (): void => {
    resolveAbort("aborted");
  };
  signal.addEventListener("abort", onAbort, { once: true });
  // aborted確認とlistener登録の間に発火した場合も取りこぼさない。
  if (signalIsAborted()) onAbort();
  try {
    const result = await Promise.race([cancelSettled, aborted]);
    return result === "aborted" || signalIsAborted() ? "aborted" : "cancel_settled";
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * 応答 body をストリーム読みしつつ固定バイト上限で打ち切る。
 * 超過時は invalid_ai_response（修理適格の invalid 経路へ）。
 */
export async function readResponseBodyWithByteCap(
  response: Response,
  maxBytes: number = OPENROUTER_MAX_BODY_BYTES,
  signal?: AbortSignal,
): Promise<string> {
  if (response.body === null) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new OpenRouterCallError("invalid_ai_response");
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        const cancelResult = await cancelBodyReaderWithAbort(() => reader.cancel(), signal);
        throw new OpenRouterCallError(
          cancelResult === "aborted" ? "generation_timeout" : "invalid_ai_response",
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof OpenRouterCallError) throw error;
    throw error;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

function retryAt(response: Response, now: number): string | null {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) return null;
  const maxTarget = now + maxRetryAfterSeconds * 1_000;
  if (/^\d+$/u.test(retryAfter)) {
    const seconds = Number(retryAfter);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    const target = Math.min(now + seconds * 1_000, maxTarget);
    return Number.isFinite(target) && !Number.isNaN(new Date(target).getTime())
      ? new Date(target).toISOString()
      : null;
  }
  if (!httpDatePattern.test(retryAfter)) return null;
  const parsed = Date.parse(retryAfter);
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed);
  if (date.toUTCString() !== retryAfter || parsed < now) return null;
  // HTTP-date も 24h 超はクランプし、外部入力による「数十年後まで再試行不可」を防ぐ
  return new Date(Math.min(parsed, maxTarget)).toISOString();
}

async function sendMenuGenerationWithRuntime(
  input: OpenRouterGenerationInput,
  runtime: OpenRouterGenerationRuntimeInput,
): Promise<OpenRouterGenerationResult> {
  const mode: GenerationWireMode = input.mode ?? "full_menu";
  const configuredModels = input.models ?? runtime.models;
  // 有料 allowlist ガード: router 集合・空・重複は常に拒否。
  // real API base 上の :free と mock/ も拒否（mock 例外は exact mock base のみ）。
  const routers = new Set(["openrouter/auto", "openrouter/free", "openrouter/auto-beta"]);
  const rejectsRouterOrEmptyOrDup =
    configuredModels.length === 0 ||
    new Set(configuredModels).size !== configuredModels.length ||
    configuredModels.some((model) => routers.has(model));
  const rejectsMockOrFreeOnRealApi =
    !isExactLocalMockBaseUrl(runtime.baseUrl) &&
    configuredModels.some((model) => model.endsWith(":free") || model.startsWith("mock/"));
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
    // timer開始後にfetch側の準備を行い、同期処理も送信予算へ含める。
    // 並行安全: ALS 経由のリクエスト単位シナリオを優先し、無いときだけ env（単体テスト用）
    const testScenario = readOpenRouterMockScenario() ?? process.env.OPENROUTER_MOCK_SCENARIO;
    const responseFormat =
      mode === "replacement_dish" ? dishRegenerationResponseFormat : menuResponseFormat;
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
          messages: input.messages,
          response_format: responseFormat,
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
    assertWithinDeadline();

    if (!response.ok) {
      throw new OpenRouterCallError("model_unavailable", null, retryAt(response, Date.now()));
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
    assertWithinDeadline();

    const knownModel = modelOnlySchema.safeParse(rawEnvelope);
    const modelId = knownModel.success ? knownModel.data.model : null;
    if (modelId !== null && !models.includes(modelId)) {
      throw new OpenRouterCallError("model_unavailable");
    }
    assertWithinDeadline();
    const envelope = responseSchema.safeParse(rawEnvelope);
    if (!envelope.success) {
      throw new OpenRouterCallError("invalid_ai_response", modelId);
    }
    assertWithinDeadline();

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
    assertWithinDeadline();

    if (mode === "replacement_dish") {
      // full_menu ボディを置換モードで拒否（mode 付きの閉じた結果）
      const fullMenuProbe = aiGenerationResponseSchema.safeParse(decoded);
      if (fullMenuProbe.success) {
        throw new OpenRouterCallError("invalid_ai_response", envelope.data.model);
      }
      const dishOutput = dishRegenerationAiOutputSchema.safeParse(decoded);
      if (!dishOutput.success) {
        throw new OpenRouterCallError("invalid_ai_response", envelope.data.model);
      }
      assertWithinDeadline();
      const result: OpenRouterGenerationResult = {
        mode: "replacement_dish",
        output: dishOutput.data,
        modelId: envelope.data.model,
      };
      assertWithinDeadline();
      return result;
    }

    // full_menu は provider wire を検査してから既存の内部 union へ閉じる。
    const wire = aiGenerationWireResponseSchema.safeParse(decoded);
    if (!wire.success) {
      throw new OpenRouterCallError("invalid_ai_response", envelope.data.model);
    }
    assertWithinDeadline();
    let output: AiGenerationResponse;
    try {
      output = toAiGenerationResponse(wire.data);
    } catch {
      throw new OpenRouterCallError("invalid_ai_response", envelope.data.model);
    }
    assertWithinDeadline();
    const result: OpenRouterGenerationResult = {
      mode: "full_menu",
      output,
      modelId: envelope.data.model,
    };
    assertWithinDeadline();
    return result;
  } catch (error) {
    assertWithinDeadline();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * production sender と同じ実装へ、ベンチ専用の認証・URL・fetch・単調時計を閉じ込める。
 * 呼び出しごとの models は OpenRouterGenerationInput の exact 配列を正本にする。
 */
export function createOpenRouterGenerationSender(
  runtime: OpenRouterGenerationRuntimeInput,
): (input: OpenRouterGenerationInput) => Promise<OpenRouterGenerationResult> {
  return async (input) => sendMenuGenerationWithRuntime(input, runtime);
}

export async function sendMenuGeneration(
  input: OpenRouterGenerationInput,
): Promise<OpenRouterGenerationResult> {
  const config = getServerEnv().openRouter;
  return sendMenuGenerationWithRuntime(input, {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    models: config.models,
    timeoutMs: config.timeoutMs,
  });
}
