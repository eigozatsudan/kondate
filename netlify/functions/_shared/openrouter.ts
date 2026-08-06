import { z } from "zod";
import {
  aiGenerationResponseSchema,
  aiGenerationWireResponseSchema,
  menuResponseFormat,
  toAiGenerationResponse,
  type AiGenerationResponse,
} from "../../../shared/contracts/generation.js";
import {
  weeklyFlyerMenuResponseFormat,
  weeklyFlyerMenuSchema,
  type WeeklyFlyerMenu,
} from "../../../shared/contracts/flyer-weekly.js";
import {
  dishRegenerationAiOutputSchema,
  type DishRegenerationAiOutput,
} from "../../../shared/contracts/regeneration.js";
import { getServerEnv } from "./env.js";
import { readOpenRouterMockScenario } from "./openrouter-mock-scenario.js";

/** vision / text 両対応の content part（OpenRouter chat completions） */
export type OpenRouterContentPart =
  { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  /**
   * 通常生成は string。チラシ vision は ContentPart[]。
   * 応答側 message.content は string のまま（ADV-25）。
   */
  content: string | OpenRouterContentPart[];
};

/** 通常生成メッセージの text content を取り出す（vision parts は空文字） */
export function openRouterTextContent(content: OpenRouterMessage["content"]): string {
  return typeof content === "string" ? content : "";
}

/** フル献立 / 置換料理 / チラシ週間の wire モード。response_format とパース先を切り替える */
export type GenerationWireMode = "full_menu" | "replacement_dish" | "flyer_weekly";

export type OpenRouterGenerationInput = {
  messages: readonly OpenRouterMessage[];
  timeoutMs: number;
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
  | { mode: "replacement_dish"; output: DishRegenerationAiOutput; modelId: string }
  | { mode: "flyer_weekly"; output: WeeklyFlyerMenu; modelId: string };

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
const evidenceModelIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
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

/** 公式 OpenRouter base（ランタイム remote 政策の対象）。verify スクリプトと同一。 */
export const OFFICIAL_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
/** Models API（text のみ）。verify-openrouter-models.mjs と同一 URL。 */
export const OFFICIAL_OPENROUTER_MODELS_URL =
  "https://openrouter.ai/api/v1/models?output_modalities=text";
/** prompt+completion 上限 USD/1M（inclusive）。verify の maxPromptPlusCompletionUsdPerMillion と同一。 */
export const MAX_PROMPT_PLUS_COMPLETION_USD_PER_MILLION = 4;
/** Models API 1 回あたりの締切（5 秒）。verify の modelsApiTimeoutMs と同一。 */
export const OPENROUTER_MODELS_API_TIMEOUT_MS = 5_000;

/** Models API 1 エントリの最小形（policy 判定に使うフィールドのみ）。 */
export type OpenRouterRemoteModelMeta = {
  id: string;
  supported_parameters?: unknown;
  pricing?: {
    prompt?: unknown;
    completion?: unknown;
  };
};

/**
 * OpenRouter token 単価（USD/token）を USD/1M tokens に変換。
 * verify-openrouter-models.mjs の usdPerMillion と同一規則（fail-closed）。
 */
export function usdPerMillion(tokenPrice: unknown): number | null {
  if (typeof tokenPrice === "number") {
    if (!Number.isFinite(tokenPrice) || tokenPrice < 0) return null;
    return tokenPrice * 1e6;
  }
  if (typeof tokenPrice === "string") {
    const trimmed = tokenPrice.trim();
    if (trimmed === "") return null;
    // 10 進表現のみ（0x0 等の Number 強制変換で $0 扱いしない）
    if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) return null;
    return n * 1e6;
  }
  return null;
}

/**
 * リモート Models メタに対し、allowlist の structured_outputs ∧ response_format と
 * prompt+completion ≤ $4/1M を検証する（純粋・throw）。verifyRemoteModels の鏡像。
 */
export function assertModelsMeetRuntimePolicy(
  allowlist: readonly string[],
  modelsMeta: readonly OpenRouterRemoteModelMeta[],
): void {
  const byId = new Map(modelsMeta.map((model) => [model.id, model]));
  for (const id of allowlist) {
    const model = byId.get(id);
    if (!model) {
      throw new Error(`${id} is not present in the OpenRouter Models API`);
    }
    const parameters = new Set(
      Array.isArray(model.supported_parameters) ? model.supported_parameters : [],
    );
    // AND 必須（片方だけでは不足）— 緩和禁止
    if (!parameters.has("structured_outputs") || !parameters.has("response_format")) {
      throw new Error(`${id} does not support strict structured output`);
    }
    const prompt = usdPerMillion(model.pricing?.prompt);
    const completion = usdPerMillion(model.pricing?.completion);
    if (prompt === null || completion === null) {
      throw new Error(`${id} is missing usable pricing.prompt/completion`);
    }
    if (prompt + completion > MAX_PROMPT_PLUS_COMPLETION_USD_PER_MILLION) {
      throw new Error(`${id} exceeds max prompt+completion USD per 1M tokens`);
    }
  }
}

function policyCacheKey(baseUrl: string, models: readonly string[]): string {
  return `${baseUrl}\n${models.join("\n")}`;
}

/**
 * process 寿命の成功キャッシュ（key 一致時のみ skip）。失敗は再試行可。
 * G4 residual-intentional: cold-start 最適化のため成功後は isolate 存続中 remote 再検証しない。
 * capability 脱落・単価上昇の一時逸脱窓は残る（TTL 再検証はロック拡大になるためしない）。
 */
let runtimePolicyOkKey: string | null = null;
/** 同時 cold-start を 1 本の Models API 呼び出しへ畳む */
let runtimePolicyInflight: Promise<void> | null = null;

/** 単体テスト用: process 寿命キャッシュを初期化 */
export function resetOpenRouterRuntimeModelPolicyCacheForTests(): void {
  runtimePolicyOkKey = null;
  runtimePolicyInflight = null;
}

/**
 * 単体テスト用: remote 検証を成功済みとしてスキップする。
 * key 省略時は任意の official allowlist を通す（既存 chat 経路の fixture 向け）。
 */
export function seedOpenRouterRuntimeModelPolicyOkForTests(key = "*"): void {
  runtimePolicyOkKey = key;
  runtimePolicyInflight = null;
}

/**
 * 公式 base 上の allowlist に対し、process 寿命 1 回の Models API 政策検証を行う。
 * exact mock base は skip。ネットワーク / 政策違反は fail-closed で model_unavailable。
 * 成功のみキャッシュ（一時的 transport 失敗は次回再試行）。
 */
export async function ensureOpenRouterRuntimeModelPolicy(input: {
  baseUrl: string;
  models: readonly string[];
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  // mock path はローカルフィクスチャが構造化を保証（verify --remote と同趣旨）
  if (isExactLocalMockBaseUrl(input.baseUrl)) return;
  // 公式 base 以外はデプロイ preflight / env が拒否。ランタイムでは remote を呼ばない
  if (input.baseUrl !== OFFICIAL_OPENROUTER_BASE_URL) return;

  const key = policyCacheKey(input.baseUrl, input.models);
  if (runtimePolicyOkKey === "*" || runtimePolicyOkKey === key) return;

  if (runtimePolicyInflight !== null) {
    try {
      await runtimePolicyInflight;
    } catch {
      // 他キーの失敗を共有しない（同一 key は下で再検証）
    }
    if (runtimePolicyOkKey === "*" || runtimePolicyOkKey === key) return;
  }

  const run = async (): Promise<void> => {
    const fetchImpl = input.fetchImpl ?? fetch;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (input.apiKey !== undefined && input.apiKey.length > 0) {
      headers.Authorization = `Bearer ${input.apiKey}`;
    }

    let response: Response;
    try {
      response = await fetchImpl(OFFICIAL_OPENROUTER_MODELS_URL, {
        headers,
        signal: AbortSignal.timeout(OPENROUTER_MODELS_API_TIMEOUT_MS),
      });
    } catch {
      // transport 詳細は閉じる（verify の openrouter_models_unavailable と同趣旨）
      throw new OpenRouterCallError("model_unavailable");
    }
    if (!response.ok) {
      throw new OpenRouterCallError("model_unavailable");
    }

    let body: unknown;
    try {
      body = (await response.json()) as unknown;
    } catch {
      throw new OpenRouterCallError("model_unavailable");
    }
    if (
      body === null ||
      typeof body !== "object" ||
      !("data" in body) ||
      !Array.isArray(body.data)
    ) {
      throw new OpenRouterCallError("model_unavailable");
    }

    try {
      assertModelsMeetRuntimePolicy(
        input.models,
        (body as { data: OpenRouterRemoteModelMeta[] }).data,
      );
    } catch {
      // 政策違反の詳細はクライアントへ出さない
      throw new OpenRouterCallError("model_unavailable");
    }
    runtimePolicyOkKey = key;
  };

  const pending = run().finally(() => {
    if (runtimePolicyInflight === pending) {
      runtimePolicyInflight = null;
    }
  });
  runtimePolicyInflight = pending;
  await pending;
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
  const configuredModels = runtime.models;
  // 有料 allowlist ガード: router 集合・空・重複は常に拒否。
  // real API base 上の :free と mock/ も拒否（R1: mock/ 接頭も case-insensitive）。
  // G4: 公式 base では process 寿命 1 回の Models API で structured ∧ pricing を強制。
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

  // 防御-in-depth: generation-service が markSent 前に ensure 済みでも、
  // 直接 sender を呼ぶ経路では chat 前に政策違反を閉じる。成功 cache なら remote なし。
  await ensureOpenRouterRuntimeModelPolicy({
    baseUrl: runtime.baseUrl,
    models: configuredModels,
    apiKey: runtime.apiKey,
    // exactOptionalPropertyTypes: undefined を渡さず、有るときだけ載せる
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
    // timer開始後にfetch側の準備を行い、同期処理も送信予算へ含める。
    // 並行安全: ALS 経由のリクエスト単位シナリオを優先し、無いときだけ env（単体テスト用）
    const testScenario = readOpenRouterMockScenario() ?? process.env.OPENROUTER_MOCK_SCENARIO;
    const responseFormat =
      mode === "replacement_dish"
        ? dishRegenerationResponseFormat
        : mode === "flyer_weekly"
          ? weeklyFlyerMenuResponseFormat
          : menuResponseFormat;
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
        // temperature は送らない。
        // Models API の supported_parameters に temperature が無いモデル（例: openai/gpt-5.6-luna）では、
        // provider.require_parameters: true と temperature の併用が 404
        // 「No endpoints found that can handle the requested parameters」になる。
        // require_parameters と strict response_format は維持し、決定性は schema / prompt 側で担保する。
        body: JSON.stringify({
          models,
          messages: input.messages,
          response_format: responseFormat,
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
      const evidenceModelId = evidenceModelIdSchema.safeParse(modelId);
      throw new OpenRouterCallError(
        "model_unavailable",
        evidenceModelId.success ? evidenceModelId.data : null,
      );
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

    if (mode === "flyer_weekly") {
      const flyerOutput = weeklyFlyerMenuSchema.safeParse(decoded);
      if (!flyerOutput.success) {
        throw new OpenRouterCallError("invalid_ai_response", envelope.data.model);
      }
      assertWithinDeadline();
      const result: OpenRouterGenerationResult = {
        mode: "flyer_weekly",
        output: flyerOutput.data,
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
 * exact models は公開call inputへ出さず、このfactory closureだけへ閉じ込める。
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
