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
/**
 * R1: PKCE/oauth-mock の authorization code 形に寄せて明らかなゴミを弾く。
 * gotrue 系 UUID・base64url（oauth-mock 32B）・一般的な unreserved/base64 文字を許容。
 * 形式を通る後着毒は C2 匿名 last-wins の意図的残余（residual-intentional: R1）。
 */
const authorizationCodeSchema = z
  .string()
  .min(16)
  .max(512)
  // 文字クラス末尾の `-` はリテラル（範囲演算子にしない）
  .regex(/^[A-Za-z0-9._~+/-]+$/u);
const depositRequestSchema = z
  .object({
    state: credentialSchema,
    code: authorizationCodeSchema,
    // C2: 同一ブラウザ所有者だけが渡す。無い（WebView）は匿名 last-wins（未 claim）。
    secret: credentialSchema.optional(),
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
  /** 所有者上書き用。未指定は匿名 last-wins（未 claim）。 */
  secretHash?: Uint8Array;
};
type DepositTransition = (input: DepositTransitionInput) => Promise<boolean>;
type DepositHandlerDependencies = {
  origin: string;
  encryptionKey: Uint8Array;
  deposit: DepositTransition;
};

function toBytea(value: Uint8Array): string {
  return `\\x${Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * C7: deposit_auth_continuation の生成型 Returns（boolean）を実行時検証する。
 * true 以外は失敗（handler が unavailable）。
 */
export function parseDepositAuthContinuationRpcData(data: unknown): boolean {
  return z.literal(true).safeParse(data).success;
}

function createAdminTransition(): DepositTransition {
  // C7: AdminSupabaseClient は Database 生成型の rpc を正本にする。
  // 手書き RpcClient への unchecked cast はしない。応答は Zod で fail-closed。
  const client = createAdminSupabaseClient();
  return async (input) => {
    const { data, error } = await client.rpc("deposit_auth_continuation", {
      p_id: input.id,
      p_state_hash: toBytea(input.stateHash),
      p_origin: input.origin,
      p_ciphertext: toBytea(input.ciphertext),
      p_iv: toBytea(input.iv),
      p_now: input.now,
      // C2: 所有者 secret があるときだけ上書き可能な hash を渡す
      ...(input.secretHash === undefined ? {} : { p_secret_hash: toBytea(input.secretHash) }),
    });
    return error === null && parseDepositAuthContinuationRpcData(data);
  };
}

export const config: Config = {
  path: "/api/auth/continuations/:continuationId/callback",
  method: "POST",
  // C6: create/deposit/claim が同一 IP で食い合わないよう、deposit は 40/60 に余裕を持たせる。
  // C17: IP 集約は CGNAT/法人 NAT で共有バケットになり 429 を出し得る。
  // クライアント completeCallback は deposit 429/5xx を code 保持のまま backoff 再試行する
  // （claim の awaiting 再試行とは別経路）。キーを user/secret に緩めない（ロック契約）。
  rateLimit: { windowLimit: 40, windowSize: 60, aggregateBy: ["ip"] },
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
        // C2: 所有者は secret 付き。WebView は secret 無しで未 claim なら last-wins。
        // R1 residual-intentional / C7: 匿名 last-wins は正当後の後着毒を許す可用性 DoS。
        // first-wins に戻すと毒 first-wins（旧 C2）が再発する。RPC / last-wins は変えない。
        ...(body.secret === undefined ? {} : { secretHash: await sha256(body.secret) }),
      });
      // U1-004: 空 204 でも continuation 経路は no-store を揃える（json/jsonResponse と同型）
      return deposited
        ? new Response(null, {
            status: 204,
            headers: { "cache-control": "no-store" },
          })
        : continuationUnavailable();
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
