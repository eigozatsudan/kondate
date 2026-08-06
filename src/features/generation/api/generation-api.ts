import { z } from "zod";

import {
  generationCommandV3Schema,
  generationStatusDataSchema,
  type GenerationCommand,
  type GenerationStatusData,
} from "@shared/contracts/generation";

import { requireAccessToken } from "@/features/auth/session";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";

/**
 * 生成 POST のクライアント abort 上限（ms）。
 * サーバ Function 総予算 55s（FUNCTION_TOTAL_BUDGET_MS）と platform 60s の間に置き、
 * hang 中に status poll へ戻れない窓を閉じる（adversarial G8）。
 * Abort 時は classify が offline へ落とし pending を維持して status 回収する。
 */
export const GENERATION_POST_CLIENT_TIMEOUT_MS = 58_000 as const;

const generationEnvelopeSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      data: z.unknown(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: z
        .object({
          code: z.string(),
          message: z.string(),
          details: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
    })
    .strict(),
]);

async function call(
  url: string,
  init: RequestInit,
  expectedIdempotencyKey: string,
  fetchImpl: typeof fetch,
): Promise<GenerationStatusData> {
  const accessToken = await requireAccessToken(getBrowserSupabaseClient());
  const initialHeaders = Object.fromEntries(new Headers(init.headers));
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      ...initialHeaders,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  const envelope = generationEnvelopeSchema.parse(await response.json());
  if (!envelope.ok) {
    throw new Error(envelope.error.code);
  }

  const data = generationStatusDataSchema.parse(envelope.data);
  z.literal(expectedIdempotencyKey).parse(data.idempotencyKey);
  return data;
}

export function generationEndpointFor(command: GenerationCommand): string {
  return command.kind === "regenerate_dish" ? "/api/generations/dish" : "/api/generations/menu";
}

export function postGeneration(
  commandInput: GenerationCommand,
  deps: { fetchImpl?: typeof fetch; postTimeoutMs?: number } = {},
): Promise<GenerationStatusData> {
  // wire は top-level commandVersion + qualityMode を必須とする v3 全体を送る
  const command = generationCommandV3Schema.parse(commandInput);
  const timeoutMs = deps.postTimeoutMs ?? GENERATION_POST_CLIENT_TIMEOUT_MS;
  return call(
    generationEndpointFor(command),
    {
      method: "POST",
      body: JSON.stringify(command),
      // サーバ 55s / platform 60s と独立に待つと G1 孤児窓中に破棄しやすい（G8）
      signal: AbortSignal.timeout(timeoutMs),
    },
    command.request.idempotencyKey,
    deps.fetchImpl ?? fetch,
  );
}

export async function getGenerationStatus(
  idempotencyKey: string,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<GenerationStatusData> {
  const expectedIdempotencyKey = z.uuid().parse(idempotencyKey);
  return await call(
    `/api/generations/${encodeURIComponent(expectedIdempotencyKey)}/status`,
    { method: "GET" },
    expectedIdempotencyKey,
    deps.fetchImpl ?? fetch,
  );
}
