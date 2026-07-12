import { z } from "zod";

const localBrowserSupabaseUrl = "http://127.0.0.1:8000";
const managedSupabaseOrigin = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/u;

const publicEnvSchema = z.object({
  VITE_SUPABASE_URL: z.union([
    z.literal(localBrowserSupabaseUrl),
    z.string().regex(managedSupabaseOrigin, "managed Supabase origin required"),
  ]),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
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

export function parsePublicEnv(
  source: Record<string, unknown>,
  context: PublicEnvParseContext = { production: false },
): PublicEnv {
  const result = publicEnvSchema.safeParse(source);
  if (!result.success) throw new Error("公開設定を読み込めません");

  const { VITE_AUTH_PROVIDER_MODE: mode, VITE_OAUTH_MOCK_ORIGIN: mockOrigin } = result.data;
  const validLocalMock =
    mode === "oauth_mock" && !context.production && mockOrigin === "http://127.0.0.1:8788";
  const validSupabase = mode === "supabase" && mockOrigin === undefined;
  const validSupabaseUrl = context.production
    ? managedSupabaseOrigin.test(result.data.VITE_SUPABASE_URL)
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
