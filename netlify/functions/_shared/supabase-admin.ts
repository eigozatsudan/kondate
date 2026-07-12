import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/shared/types/database.generated.js";
import { getServerEnv, type ServerEnv } from "./env.js";

export type AdminSupabaseClient = SupabaseClient<Database>;

export function createAdminSupabaseClient(env: ServerEnv = getServerEnv()): AdminSupabaseClient {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
