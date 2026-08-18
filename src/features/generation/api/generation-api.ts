import { z } from "zod";

import { GENERATION_POST_CLIENT_TIMEOUT_MS } from "@shared/contracts/function-budget";
import {
  generationCommandV3Schema,
  generationStatusDataSchema,
  type GenerationCommand,
  type GenerationStatusData,
} from "@shared/contracts/generation";

import { assertBrowserDataPlaneAligned, requireAccessToken } from "@/features/auth/session";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";

/**
 * 生成 POST のクライアント abort 上限（ms）。
 * 正本は function-budget（FUNCTION_TOTAL_BUDGET_MS + headroom）。
 * Abort 時は classify が offline へ落とし pending を維持して status 回収する。
 */
export { GENERATION_POST_CLIENT_TIMEOUT_MS };

/**
 * 生成 status GET のクライアント abort 上限（ms）。
 * POST と同じ budget 正本を共有する（G18: hung GET が statusInFlight を永久占有しない）。
 * Abort 時は recovery が offline 扱いで pending 維持し、次の poll/retry で再取得する。
 */
export const GENERATION_STATUS_CLIENT_TIMEOUT_MS = GENERATION_POST_CLIENT_TIMEOUT_MS;

/** Function エラー code: SafeLog closedErrorCode と同形（S9）。 */
const functionErrorCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/u);
/** 利用者向け message 天井。巨大プロキシ改変を構造拒否。 */
const functionErrorMessageSchema = z.string().min(1).max(500);

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
          code: functionErrorCodeSchema,
          message: functionErrorMessageSchema,
          // details キーも天井を付け、無制限 string キーを拒否
          details: z.record(z.string().max(64), z.unknown()).optional(),
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

const liveDraftPinSchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int().positive(),
  })
  .strict();

export type LiveGenerationDraftPin = {
  draftId: string;
  revision: number;
};

/**
 * G1: new_menu pending が pin した draftRevision が live 行と食い違うかを見る。
 * 下書きは in-place 更新なので旧 N は残らない。本文は読まず id+revision だけ返す
 * （名前・メモ等をクライアント recovery に載せない）。
 */
export async function readLiveGenerationDraftPin(
  userId: string,
): Promise<LiveGenerationDraftPin | null> {
  const client = getBrowserSupabaseClient();
  await assertBrowserDataPlaneAligned(client);
  const { data, error } = await client
    .from("generation_drafts")
    .select("id, revision")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error !== null || data === null) return null;
  const parsed = liveDraftPinSchema.safeParse(data);
  if (!parsed.success) return null;
  return { draftId: parsed.data.id, revision: parsed.data.revision };
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
  deps: { fetchImpl?: typeof fetch; statusTimeoutMs?: number } = {},
): Promise<GenerationStatusData> {
  const expectedIdempotencyKey = z.uuid().parse(idempotencyKey);
  // G18: status も AbortSignal.timeout を付け、hung proxy で statusInFlight が永久に残らないようにする
  const timeoutMs = deps.statusTimeoutMs ?? GENERATION_STATUS_CLIENT_TIMEOUT_MS;
  return await call(
    `/api/generations/${encodeURIComponent(expectedIdempotencyKey)}/status`,
    {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    },
    expectedIdempotencyKey,
    deps.fetchImpl ?? fetch,
  );
}
