import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { decryptContinuationCode, sha256 } from "./_shared/auth-continuation-crypto.js";
import { getServerEnv } from "./_shared/env.js";
import {
  continuationGone,
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
    // C8: client sanitize と同型で `\` / 制御文字も拒否
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

type RouteContext = { params: Record<string, string | undefined> };
type ClaimTransitionInput = {
  id: string;
  stateHash: Uint8Array;
  secretHash: Uint8Array;
  origin: string;
  now: string;
};
/**
 * claim 成功時の payload。
 * C3: RPC は ciphertext を expires_at まで保持し冪等 re-claim する。
 * 行を返した後に bytea/IV が読めない場合だけ "gone"（破損等。burn 消去ではない）。
 */
type ClaimTransitionResult = { ciphertext: Uint8Array; iv: Uint8Array; returnTo: string };
type ClaimTransition = (
  input: ClaimTransitionInput,
) => Promise<ClaimTransitionResult | "gone" | null>;
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

/**
 * RPC が 1 行返したあとの bytea を ClaimTransitionResult に落とす。
 * 形式不正 / IV 長不正は payload 破損として "gone"（410）。
 * 単体テストから production 経路を再現できるように export する。
 */
export function parseClaimedContinuationRow(row: {
  encrypted_code: string;
  code_iv: string;
  return_to: string;
}): ClaimTransitionResult | "gone" {
  const ciphertext = fromBytea(row.encrypted_code);
  const iv = fromBytea(row.code_iv);
  // IV は AES-GCM 96-bit 固定。読めない / 長さ不正は terminal。
  if (ciphertext === null || iv === null || iv.byteLength !== 12) return "gone";
  return { ciphertext, iv, returnTo: row.return_to };
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
    // 未存在・binding 失敗・RPC エラー・行数不正は 404（リトライ可）
    if (error !== null || data === null || row === undefined || data.length !== 1) return null;
    // 初回/冪等 re-claim とも ciphertext 行が返る。bytea 破損は gone。
    return parseClaimedContinuationRow(row);
  };
}

export const config: Config = {
  path: "/api/auth/continuations/:continuationId/claim",
  method: "POST",
  // C6: recovery poll（5s 床）と NAT 共有を想定し claim だけ 60/60 に分離。
  // C17: IP 集約は CGNAT で 429 を出し得るが、緩めず gateway の awaiting 再試行に委ねる。
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip"] },
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
      // claim 前の未存在・binding 不一致・未 deposit は 404（クライアントはリトライ可）
      if (result === null) return continuationUnavailable();
      // RPC は成功したが payload（bytea）が読めない — 破損等 → 410（C3: burn 消去ではない）
      if (result === "gone") return continuationGone();
      // decrypt / 応答検証失敗は 404 だとクライアントが無限リトライするため 410 で terminal。
      try {
        const code = await decryptContinuationCode(
          { ciphertext: result.ciphertext, iv: result.iv },
          continuationId,
          dependencies.origin,
          dependencies.encryptionKey,
        );
        const response = claimResponseSchema.safeParse({ code, returnTo: result.returnTo });
        if (!response.success) return continuationGone();
        return jsonResponse(200, { ok: true, data: response.data });
      } catch {
        return continuationGone();
      }
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
