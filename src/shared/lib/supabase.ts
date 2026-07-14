import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv, type PublicEnv } from "@/shared/config/public-env";
import type { Database } from "@/shared/types/database";

export type BrowserSupabaseClient = SupabaseClient<Database>;

export function createBrowserSupabaseClient(
  env: Pick<PublicEnv, "supabaseUrl" | "supabasePublishableKey">,
): BrowserSupabaseClient {
  return createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      storage: window.localStorage,
      storageKey: "kondate.auth.supabase",
    },
  });
}

let browserClient: BrowserSupabaseClient | undefined;

export function getBrowserSupabaseClient(): BrowserSupabaseClient {
  browserClient ??= createBrowserSupabaseClient(getPublicEnv());
  return browserClient;
}
