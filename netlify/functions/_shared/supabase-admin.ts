import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/shared/types/database.js";
import { getServerEnv, getSupabaseServerEnv, type ServerEnv } from "./env.js";
import { createDeadlineBoundedFetch } from "./request-deadline.js";

export type AdminSupabaseClient = SupabaseClient<Database>;

let cachedAdminClient: AdminSupabaseClient | undefined;

export function createAdminSupabaseClient(env: ServerEnv = getServerEnv()): AdminSupabaseClient {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    // リクエスト締切（runWithRequestDeadline）を超えた RPC は abort して関数を返させる
    global: { fetch: createDeadlineBoundedFetch() },
  });
}

export function getSupabaseAdmin(): AdminSupabaseClient {
  if (cachedAdminClient !== undefined) return cachedAdminClient;
  const env = getSupabaseServerEnv();
  cachedAdminClient = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    // リクエスト締切（runWithRequestDeadline）を超えた RPC は abort して関数を返させる
    global: { fetch: createDeadlineBoundedFetch() },
  });
  return cachedAdminClient;
}
