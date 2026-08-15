import { z } from "zod";

const localBrowserSupabaseUrl = "http://127.0.0.1:8000";
const managedSupabaseOrigin = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/u;

/**
 * base64url セグメントを UTF-8 文字列へ（JWT payload の role 検査用）。
 * 署名検証はしない。Node 24 / ブラウザとも atob を使う。
 */
function decodeJwtPayloadSegment(segment: string): string | null {
  try {
    const normalized = segment.replace(/-/gu, "+").replace(/_/gu, "/");
    const padLen = (4 - (normalized.length % 4)) % 4;
    return globalThis.atob(normalized + "=".repeat(padLen));
  } catch {
    return null;
  }
}

/**
 * publishable として安全なキーか。
 * - `sb_publishable_*`: 新形式（secret 系 prefix は別鍵）
 * - JWT 三セグメント: payload.role が **anon のみ**（service_role 誤設定を fail-closed。L3）
 * 署名検証はしない（公開設定の誤用防止が目的）。
 */
function isSafePublishableKey(value: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/u.test(value)) {
    return true;
  }
  if (!/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value)) {
    return false;
  }
  const payloadSegment = value.split(".")[1];
  if (payloadSegment === undefined) return false;
  const json = decodeJwtPayloadSegment(payloadSegment);
  if (json === null) return false;
  try {
    const payload: unknown = JSON.parse(json);
    if (typeof payload !== "object" || payload === null) return false;
    return Reflect.get(payload, "role") === "anon";
  } catch {
    return false;
  }
}

// JWT anon（3 セグメント・payload.role=anon）または sb_publishable_*。
// min(1) だけだと誤設定の気づきが遅れる（L6）。service_role JWT は拒否（L3）。
const supabasePublishableKeySchema = z
  .string()
  .min(1)
  .refine((value) => isSafePublishableKey(value), "publishable key format");

const publicEnvSchema = z.object({
  VITE_SUPABASE_URL: z.union([
    z.literal(localBrowserSupabaseUrl),
    z.string().regex(managedSupabaseOrigin, "managed Supabase origin required"),
  ]),
  VITE_SUPABASE_PUBLISHABLE_KEY: supabasePublishableKeySchema,
  VITE_MAGIC_LINK_RESEND_SECONDS: z.coerce.number().int().min(1).max(3_600),
  VITE_AUTH_CONTINUATION_TTL_MS: z.coerce
    .number()
    .int()
    .refine((value) => value === 300_000, "continuation TTL must be exactly 300000 ms"),
  VITE_AUTH_PROVIDER_MODE: z.enum(["supabase", "oauth_mock"]),
  VITE_OAUTH_MOCK_ORIGIN: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.url().optional(),
  ),
});

export type PublicEnvParseContext = { production: boolean };

export type PublicEnv = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  magicLinkResendSeconds: number;
  authContinuationTtlMs: number;
  authProviderMode: "supabase" | "oauth_mock";
  oauthMockOrigin: string | null;
};

/** ブラウザへ露出してよい VITE_* の allowlist（これ以外の VITE_* は fail-closed） */
const allowedViteKeys = new Set([
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_MAGIC_LINK_RESEND_SECONDS",
  "VITE_AUTH_CONTINUATION_TTL_MS",
  "VITE_AUTH_PROVIDER_MODE",
  "VITE_OAUTH_MOCK_ORIGIN",
]);

/**
 * import.meta.env / テスト用 source に未知の VITE_* があれば拒否する。
 * Vite は VITE_ 接頭辞をクライアント露出するため、parse 対象外の秘密 alias を fail-closed にする。
 */
function rejectUnexpectedViteKeys(source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    if (!key.startsWith("VITE_")) continue;
    if (!allowedViteKeys.has(key)) {
      throw new Error("公開設定を読み込めません");
    }
  }
}

export function parsePublicEnv(
  source: Record<string, unknown>,
  context: PublicEnvParseContext = { production: false },
): PublicEnv {
  rejectUnexpectedViteKeys(source);
  const result = publicEnvSchema.safeParse(source);
  if (!result.success) throw new Error("公開設定を読み込めません");

  const { VITE_AUTH_PROVIDER_MODE: mode, VITE_OAUTH_MOCK_ORIGIN: mockOrigin } = result.data;
  const validLocalMock =
    mode === "oauth_mock" && !context.production && mockOrigin === "http://127.0.0.1:8788";
  const validSupabase = mode === "supabase" && mockOrigin === undefined;
  // 許可 origin 集合は変えない。oauth_mock だけ local Compose URL に閉じる（L10）。
  const validSupabaseUrl = context.production
    ? managedSupabaseOrigin.test(result.data.VITE_SUPABASE_URL)
    : mode === "oauth_mock"
      ? result.data.VITE_SUPABASE_URL === localBrowserSupabaseUrl
      : result.data.VITE_SUPABASE_URL === localBrowserSupabaseUrl ||
        managedSupabaseOrigin.test(result.data.VITE_SUPABASE_URL);
  if ((!validLocalMock && !validSupabase) || !validSupabaseUrl) {
    throw new Error("公開設定を読み込めません");
  }

  return {
    supabaseUrl: result.data.VITE_SUPABASE_URL,
    supabasePublishableKey: result.data.VITE_SUPABASE_PUBLISHABLE_KEY,
    magicLinkResendSeconds: result.data.VITE_MAGIC_LINK_RESEND_SECONDS,
    authContinuationTtlMs: result.data.VITE_AUTH_CONTINUATION_TTL_MS,
    authProviderMode: mode,
    oauthMockOrigin: mockOrigin ?? null,
  };
}

let cached: PublicEnv | undefined;

export function getPublicEnv(): PublicEnv {
  cached ??= parsePublicEnv(import.meta.env, { production: import.meta.env.PROD });
  return cached;
}
