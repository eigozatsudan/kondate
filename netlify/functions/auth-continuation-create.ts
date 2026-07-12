import type { Config } from "@netlify/functions";
import { z } from "zod";
import { getServerEnv } from "./_shared/env.js";
import { sha256 } from "./_shared/auth-continuation-crypto.js";
import {
  continuationUnavailable,
  invalidRequest,
  jsonResponse,
  parseStrictJson,
  requireOrigin,
} from "./_shared/http.js";
import { createAdminSupabaseClient } from "./_shared/supabase-admin.js";

const credentialSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const createRequestSchema = z
  .object({
    state: credentialSchema,
    secret: credentialSchema,
    returnTo: z
      .string()
      .regex(/^\/[^/]/u)
      .max(500),
  })
  .strict();
const createResultSchema = z
  .object({
    id: z.uuid(),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

type CreateTransitionInput = {
  stateHash: Uint8Array;
  secretHash: Uint8Array;
  origin: string;
  returnTo: string;
  now: string;
  ttlSeconds: number;
};

type CreateTransition = (
  input: CreateTransitionInput,
) => Promise<{ id: string; expiresAt: string } | null>;

type CreateHandlerDependencies = {
  origin: string;
  ttlSeconds: number;
  create: CreateTransition;
};

type CreateRpcClient = {
  rpc(
    functionName: "create_auth_continuation",
    args: {
      p_state_hash: string;
      p_secret_hash: string;
      p_origin: string;
      p_return_to: string;
      p_now: string;
      p_ttl_seconds: number;
    },
  ): Promise<{ data: Array<{ id: string; expires_at: string }> | null; error: unknown }>;
};

function toBytea(value: Uint8Array): string {
  return `\\x${Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function createAdminTransition(): CreateTransition {
  // 型生成は未適用のマイグレーションを含まないため、公開RPCの入出力だけをここで固定する。
  const client = createAdminSupabaseClient() as unknown as CreateRpcClient;
  return async (input) => {
    const { data, error } = await client.rpc("create_auth_continuation", {
      p_state_hash: toBytea(input.stateHash),
      p_secret_hash: toBytea(input.secretHash),
      p_origin: input.origin,
      p_return_to: input.returnTo,
      p_now: input.now,
      p_ttl_seconds: input.ttlSeconds,
    });
    const row = data?.[0];
    if (error !== null || data === null || row === undefined || data.length !== 1) return null;
    return { id: row.id, expiresAt: row.expires_at };
  };
}

export const config: Config = {
  path: "/api/auth/continuations",
  method: "POST",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip"] },
};

export function createHandler(
  dependencies: CreateHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST" || !requireOrigin(request, dependencies.origin))
      return invalidRequest();

    let body: z.infer<typeof createRequestSchema>;
    try {
      body = await parseStrictJson(request, createRequestSchema);
    } catch {
      return invalidRequest();
    }

    try {
      const result = await dependencies.create({
        stateHash: await sha256(body.state),
        secretHash: await sha256(body.secret),
        origin: dependencies.origin,
        returnTo: body.returnTo,
        now: new Date().toISOString(),
        ttlSeconds: dependencies.ttlSeconds,
      });
      const parsed = createResultSchema.safeParse(result);
      if (!parsed.success) return continuationUnavailable();
      return jsonResponse(200, { ok: true, data: parsed.data });
    } catch {
      return continuationUnavailable();
    }
  };
}

export default async function handler(request: Request): Promise<Response> {
  const env = getServerEnv();
  return createHandler({
    origin: env.SERVER_SITE_ORIGIN,
    ttlSeconds: env.AUTH_CONTINUATION_TTL_SECONDS,
    create: createAdminTransition(),
  })(request);
}
