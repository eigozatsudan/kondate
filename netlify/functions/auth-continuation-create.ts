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
    // B-I5: 裸 "/" は RootEntry 復帰用に許可。B-I3: "//" 始まりは拒否。
    // C8: client sanitizeReturnPath と同型で `\` と制御文字も拒否（開リダイレクトを広げない）。
    returnTo: z
      .string()
      .max(500)
      .refine(
        (value) => {
          if (value === "/") return true;
          if (!/^\/[^/]/u.test(value)) return false;
          if (value.startsWith("//") || value.includes("//")) return false;
          if (value.includes("\\")) return false;
          // eslint-disable-next-line no-control-regex -- returnTo に制御文字を許さない
          if (/[\u0000-\u001f\u007f]/u.test(value)) return false;
          return true;
        },
        { message: "invalid_return_to" },
      ),
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

// 生成型 Database.Functions.create_auth_continuation.Returns と同型。
// C7: rpc data は network/DB 境界なので生成型を信じず Zod で検証する。
const createRpcRowSchema = z.object({
  id: z.string(),
  expires_at: z.string(),
});

function toBytea(value: Uint8Array): string {
  return `\\x${Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * C7: create_auth_continuation の Returns を実行時検証する。
 * 行数不正・列欠落は null（handler が unavailable）。
 */
export function parseCreateAuthContinuationRpcData(
  data: unknown,
): { id: string; expiresAt: string } | null {
  const parsed = z.array(createRpcRowSchema).safeParse(data);
  if (!parsed.success || parsed.data.length !== 1) return null;
  const row = parsed.data[0];
  if (row === undefined) return null;
  return { id: row.id, expiresAt: row.expires_at };
}

function createAdminTransition(): CreateTransition {
  // C7: AdminSupabaseClient は Database 生成型の rpc を正本にする。
  // 手書き RpcClient への unchecked cast はしない。応答は Zod で fail-closed。
  const client = createAdminSupabaseClient();
  return async (input) => {
    const { data, error } = await client.rpc("create_auth_continuation", {
      p_state_hash: toBytea(input.stateHash),
      p_secret_hash: toBytea(input.secretHash),
      p_origin: input.origin,
      p_return_to: input.returnTo,
      p_now: input.now,
      p_ttl_seconds: input.ttlSeconds,
    });
    if (error !== null) return null;
    return parseCreateAuthContinuationRpcData(data);
  };
}

export const config: Config = {
  path: "/api/auth/continuations",
  method: "POST",
  // C6: create は開始系。claim より低く保ちつつ NAT 共有に余裕を持たせる。
  // C17: aggregateBy ip は CGNAT 共有バケットを意図した fail-closed。キー緩和はしない。
  rateLimit: { windowLimit: 40, windowSize: 60, aggregateBy: ["ip"] },
};

export function createHandler(
  dependencies: CreateHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    // method 不正は 400。origin 不一致は deposit/claim と同じく 404（利用不可）へ揃える（C11）。
    // 認証バイパスにはならない（create 自体が失敗するだけ）。クライアント開始系は両 status とも失敗扱い。
    if (request.method !== "POST") return invalidRequest();
    if (!requireOrigin(request, dependencies.origin)) return continuationUnavailable();

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
