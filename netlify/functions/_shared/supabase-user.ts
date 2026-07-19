import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/shared/types/database.js";
import { getServerEnv } from "./env.js";

export type UserSupabaseClient = SupabaseClient<Database>;

export function createUserScopedSupabase(accessToken: string): UserSupabaseClient {
  const env = getServerEnv();
  return createClient<Database>(env.supabase.url, env.supabase.publishableKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
