import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { encryptContinuationCode, sha256 } from "./_shared/auth-continuation-crypto.js";
import { getServerEnv } from "./_shared/env.js";
import {
  continuationUnavailable,
  invalidRequest,
  parseStrictJson,
  requireOrigin,
} from "./_shared/http.js";
import { createAdminSupabaseClient } from "./_shared/supabase-admin.js";

const credentialSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const continuationIdSchema = z.uuid();
const depositRequestSchema = z
  .object({
    state: credentialSchema,
    code: z.string().min(1).max(2_048),
  })
  .strict();

type RouteContext = { params: Record<string, string | undefined> };
type DepositTransitionInput = {
  id: string;
  stateHash: Uint8Array;
  origin: string;
  ciphertext: Uint8Array;
  iv: Uint8Array;
  now: string;
};
type DepositTransition = (input: DepositTransitionInput) => Promise<boolean>;
type DepositHandlerDependencies = {
  origin: string;
  encryptionKey: Uint8Array;
  deposit: DepositTransition;
};

type DepositRpcClient = {
  rpc(
    functionName: "deposit_auth_continuation",
    args: {
      p_id: string;
      p_state_hash: string;
      p_origin: string;
      p_ciphertext: string;
      p_iv: string;
      p_now: string;
    },
  ): Promise<{ data: boolean | null; error: unknown }>;
};

function toBytea(value: Uint8Array): string {
  return `\\x${Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function createAdminTransition(): DepositTransition {
  // 型生成は未適用のマイグレーションを含まないため、公開RPCの入出力だけをここで固定する。
  const client = createAdminSupabaseClient() as unknown as DepositRpcClient;
  return async (input) => {
    const { data, error } = await client.rpc("deposit_auth_continuation", {
      p_id: input.id,
      p_state_hash: toBytea(input.stateHash),
      p_origin: input.origin,
      p_ciphertext: toBytea(input.ciphertext),
      p_iv: toBytea(input.iv),
      p_now: input.now,
    });
    return error === null && data === true;
  };
}

export const config: Config = {
  path: "/api/auth/continuations/:continuationId/callback",
  method: "POST",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip"] },
};

export function createHandler(
  dependencies: DepositHandlerDependencies,
): (request: Request, context: RouteContext) => Promise<Response> {
  return async (request, context) => {
    let continuationId: string;
    let body: z.infer<typeof depositRequestSchema>;
    try {
      if (request.method !== "POST") return invalidRequest();
      continuationId = continuationIdSchema.parse(context.params.continuationId);
      body = await parseStrictJson(request, depositRequestSchema);
    } catch {
      return invalidRequest();
    }

    if (!requireOrigin(request, dependencies.origin)) return continuationUnavailable();

    try {
      const encrypted = await encryptContinuationCode(
        body.code,
        continuationId,
        dependencies.origin,
        dependencies.encryptionKey,
      );
      const deposited = await dependencies.deposit({
        id: continuationId,
        stateHash: await sha256(body.state),
        origin: dependencies.origin,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        now: new Date().toISOString(),
      });
      return deposited ? new Response(null, { status: 204 }) : continuationUnavailable();
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
    deposit: createAdminTransition(),
  })(request, context);
}
