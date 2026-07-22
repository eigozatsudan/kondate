import { z } from "zod";

import {
  generationCommandV2Schema,
  generationStatusDataSchema,
  type GenerationCommand,
  type GenerationStatusData,
} from "@shared/contracts/generation";

import { requireAccessToken } from "@/features/auth/session";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";

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
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<GenerationStatusData> {
  // wire は top-level commandVersion を必須とする v2 全体を送る
  const command = generationCommandV2Schema.parse(commandInput);
  return call(
    generationEndpointFor(command),
    { method: "POST", body: JSON.stringify(command) },
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
