import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { decryptContinuationCode, sha256 } from "./_shared/auth-continuation-crypto.js";
import { getServerEnv } from "./_shared/env.js";
import {
  continuationUnavailable,
  invalidRequest,
  jsonResponse,
  parseStrictJson,
  requireOrigin,
} from "./_shared/http.js";
import { createAdminSupabaseClient } from "./_shared/supabase-admin.js";

const credentialSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const continuationIdSchema = z.uuid();
const claimRequestSchema = z
  .object({
    secret: credentialSchema,
    state: credentialSchema,
  })
  .strict();
const claimResponseSchema = z
  .object({
    code: z.string().min(1).max(2_048),
    returnTo: z
      .string()
      .regex(/^\/[^/]/u)
      .max(500),
  })
  .strict();

type RouteContext = { params: Record<string, string | undefined> };
type ClaimTransitionInput = {
  id: string;
  stateHash: Uint8Array;
  secretHash: Uint8Array;
  origin: string;
  now: string;
};
type ClaimTransitionResult = { ciphertext: Uint8Array; iv: Uint8Array; returnTo: string };
type ClaimTransition = (input: ClaimTransitionInput) => Promise<ClaimTransitionResult | null>;
type ClaimHandlerDependencies = {
  origin: string;
  encryptionKey: Uint8Array;
  claim: ClaimTransition;
};

type ClaimRpcClient = {
  rpc(
    functionName: "claim_auth_continuation",
    args: {
      p_id: string;
      p_state_hash: string;
      p_secret_hash: string;
      p_origin: string;
      p_now: string;
    },
  ): Promise<{
    data: Array<{ encrypted_code: string; code_iv: string; return_to: string }> | null;
    error: unknown;
  }>;
};

function toBytea(value: Uint8Array): string {
  return `\\x${Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function fromBytea(value: string): Uint8Array | null {
  if (!/^\\x(?:[0-9a-f]{2})*$/iu.test(value)) return null;
  const bytes = new Uint8Array((value.length - 2) / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(2 + index * 2, 4 + index * 2), 16);
  }
  return bytes;
}

function createAdminTransition(): ClaimTransition {
  // 型生成は未適用のマイグレーションを含まないため、公開RPCの入出力だけをここで固定する。
  const client = createAdminSupabaseClient() as unknown as ClaimRpcClient;
  return async (input) => {
    const { data, error } = await client.rpc("claim_auth_continuation", {
      p_id: input.id,
      p_state_hash: toBytea(input.stateHash),
      p_secret_hash: toBytea(input.secretHash),
      p_origin: input.origin,
      p_now: input.now,
    });
    const row = data?.[0];
    if (error !== null || data === null || row === undefined || data.length !== 1) return null;
    const ciphertext = fromBytea(row.encrypted_code);
    const iv = fromBytea(row.code_iv);
    if (ciphertext === null || iv === null || iv.byteLength !== 12) return null;
    return { ciphertext, iv, returnTo: row.return_to };
  };
}

export const config: Config = {
  path: "/api/auth/continuations/:continuationId/claim",
  method: "POST",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip"] },
};

export function createHandler(
  dependencies: ClaimHandlerDependencies,
): (request: Request, context: RouteContext) => Promise<Response> {
  return async (request, context) => {
    let continuationId: string;
    let body: z.infer<typeof claimRequestSchema>;
    try {
      if (request.method !== "POST") return invalidRequest();
      continuationId = continuationIdSchema.parse(context.params.continuationId);
      body = await parseStrictJson(request, claimRequestSchema);
    } catch {
      return invalidRequest();
    }

    if (!requireOrigin(request, dependencies.origin)) return continuationUnavailable();

    try {
      const result = await dependencies.claim({
        id: continuationId,
        stateHash: await sha256(body.state),
        secretHash: await sha256(body.secret),
        origin: dependencies.origin,
        now: new Date().toISOString(),
      });
      if (result === null) return continuationUnavailable();
      const code = await decryptContinuationCode(
        { ciphertext: result.ciphertext, iv: result.iv },
        continuationId,
        dependencies.origin,
        dependencies.encryptionKey,
      );
      const response = claimResponseSchema.safeParse({ code, returnTo: result.returnTo });
      if (!response.success) return continuationUnavailable();
      return jsonResponse(200, { ok: true, data: response.data });
    } catch {
      return continuationUnavailable();
    }
  };
}

export default async function handler(request: Request, context: Context): Promise<Response> {
  const env = getServerEnv();
  return createHandler({
    origin: env.SERVER_SITE_ORIGIN,
    encryptionKey: Buffer.from(env.AUTH_CONTINUATION_ENCRYPTION_KEY, "base64"),
    claim: createAdminTransition(),
  })(request, context);
}
