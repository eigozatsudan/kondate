import { HttpError } from "./http.js";
import { getSupabaseAdmin } from "./supabase-admin.js";

export async function requireUser(
  request: Request,
): Promise<{ userId: string; accessToken: string }> {
  const authorization = request.headers.get("authorization");
  if (authorization === null || !authorization.startsWith("Bearer ")) {
    throw new HttpError(401, "auth_required", "ログインが必要です");
  }
  const accessToken = authorization.slice("Bearer ".length).trim();
  if (accessToken === "") {
    throw new HttpError(401, "auth_required", "ログインが必要です");
  }
  const { data, error } = await getSupabaseAdmin().auth.getUser(accessToken);
  if (error !== null) {
    throw new HttpError(401, "auth_required", "ログインが必要です");
  }
  return { userId: data.user.id, accessToken };
}
