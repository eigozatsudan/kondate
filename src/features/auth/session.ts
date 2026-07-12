import type { BrowserSupabaseClient } from "@/shared/lib/supabase";

export class AuthSessionRequiredError extends Error {
  constructor() {
    super("ログインが必要です");
    this.name = "AuthSessionRequiredError";
  }
}

export async function requireAccessToken(client: BrowserSupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getSession();
  if (error !== null || data.session === null) throw new AuthSessionRequiredError();
  return data.session.access_token;
}
