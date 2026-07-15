import { Buffer } from "node:buffer";
import { z } from "zod";

const localServerSupabaseUrl = "http://kong:8000";
const localBrowserSupabaseUrl = "http://127.0.0.1:8000";
const localSiteOrigin = "http://127.0.0.1:5173";
const managedSupabaseOrigin = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/u;

const serverSupabaseUrlSchema = z.union([
  z.literal(localServerSupabaseUrl),
  z.string().regex(managedSupabaseOrigin),
]);
const encryptionKeySchema = z
  .string()
  .refine((value) => Buffer.from(value, "base64").byteLength === 32);

export const continuationServerEnvSchema = z.object({
  VITE_SUPABASE_URL: z.union([
    z.literal(localBrowserSupabaseUrl),
    z.string().regex(managedSupabaseOrigin),
  ]),
  SUPABASE_URL: serverSupabaseUrlSchema,
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SERVER_SITE_ORIGIN: z.url(),
  AUTH_CONTINUATION_ENCRYPTION_KEY: encryptionKeySchema,
  AUTH_CONTINUATION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .refine((value) => value === 300),
});

export type ServerEnv = z.infer<typeof continuationServerEnvSchema>;

export function parseManagedSupabaseProjectRef(value: string): string | null {
  return managedSupabaseOrigin.exec(value)?.[1] ?? null;
}

export function parseServerEnv(source: Record<string, unknown>): ServerEnv {
  if (source.VITE_AUTH_CONTINUATION_ENCRYPTION_KEY !== undefined) {
    throw new Error("server_configuration_invalid");
  }
  const result = continuationServerEnvSchema.safeParse(source);
  if (!result.success) throw new Error("server_configuration_invalid");

  let site: URL;
  try {
    site = new URL(result.data.SERVER_SITE_ORIGIN);
  } catch {
    throw new Error("server_configuration_invalid");
  }
  if (site.origin !== result.data.SERVER_SITE_ORIGIN) {
    throw new Error("server_configuration_invalid");
  }
  const isLocal = site.origin === localSiteOrigin;
  const browserProjectRef = parseManagedSupabaseProjectRef(result.data.VITE_SUPABASE_URL);
  const serverProjectRef = parseManagedSupabaseProjectRef(result.data.SUPABASE_URL);
  if (
    (!isLocal && site.protocol !== "https:") ||
    (isLocal &&
      (result.data.VITE_SUPABASE_URL !== localBrowserSupabaseUrl ||
        result.data.SUPABASE_URL !== localServerSupabaseUrl))
  ) {
    throw new Error("server_configuration_invalid");
  }
  if (
    !isLocal &&
    (browserProjectRef === null ||
      serverProjectRef === null ||
      browserProjectRef !== serverProjectRef)
  ) {
    throw new Error("server_configuration_invalid");
  }
  return result.data;
}

export function getServerEnv(): ServerEnv {
  return parseServerEnv(process.env);
}
