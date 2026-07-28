import { z } from "zod";
import { HttpError } from "./http.js";
import { normalizeQuotaEmail } from "./quota-identity.js";
import { getSupabaseAdmin } from "./supabase-admin.js";

/** メール欠落・不正時の閉じた 503。email 専用 code / 文言を付けない。 */
const closedServiceUnavailable = () =>
  new HttpError(503, "request_failed", "処理を完了できませんでした");

async function authenticateBearer(
  request: Request,
): Promise<{ userId: string; accessToken: string; email: string | null | undefined }> {
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
  // identities[].identity_data.email は使わない（user.email のみが正）
  return {
    userId: data.user.id,
    accessToken,
    email: data.user.email,
  };
}

export async function requireUser(
  request: Request,
): Promise<{ userId: string; accessToken: string }> {
  const { userId, accessToken } = await authenticateBearer(request);
  return { userId, accessToken };
}

/**
 * identity 日次枠を使う経路向け。JWT 検証後に user.email を正規化し、
 * 欠落・空・不正は 503 の閉じた JSON（専用 code なし）で fail-closed する。
 */
export async function requireUserWithEmail(
  request: Request,
): Promise<{ userId: string; accessToken: string; email: string }> {
  const { userId, accessToken, email } = await authenticateBearer(request);
  if (email === null || email === undefined) {
    throw closedServiceUnavailable();
  }
  const normalized = normalizeQuotaEmail(email);
  if (normalized.length === 0) {
    throw closedServiceUnavailable();
  }
  // z.email() は正規化後に適用（空白のみ・不正形式を拒否）
  if (!z.email().safeParse(normalized).success) {
    throw closedServiceUnavailable();
  }
  return { userId, accessToken, email: normalized };
}
