import { createHmac, timingSafeEqual } from "node:crypto";
import { MENU_BACKGROUND_HARD_DEADLINE_MS } from "../../../shared/contracts/function-budget.js";
import { parseJson, readJsonTextWithLimit } from "./http.js";
import { menuBackgroundBodySchema } from "./menu-generation-command.js";
import { awaitWithAbort } from "./openrouter.js";

export const MENU_BACKGROUND_PATH = "/.netlify/functions/menu-generation-background";
const timestampHeader = "x-kondate-background-timestamp";
const signatureHeader = "x-kondate-background-signature";

/** 台帳 HMAC と用途を分離し、同じ鍵でも内部 dispatch 以外の署名を転用させない。 */
export function menuBackgroundSignature(
  key: Uint8Array,
  authorization: string,
  timestamp: string,
  body: string,
  method = "POST",
  path = MENU_BACKGROUND_PATH,
): string {
  return createHmac("sha256", key)
    .update("kondate/menu-background-dispatch/v1\n")
    .update(JSON.stringify([method, path, timestamp, authorization, body]))
    .digest("hex");
}

export function menuBackgroundSignatureHeaders(
  key: Uint8Array,
  authorization: string,
  body: string,
  now = Date.now(),
): Record<string, string> {
  const timestamp = String(now);
  return {
    [timestampHeader]: timestamp,
    [signatureHeader]: menuBackgroundSignature(key, authorization, timestamp, body),
  };
}

/** 署名形式・期限を先に閉じ、正当な本文だけを Auth/DB へ渡す。 */
export async function verifyMenuBackgroundRequest(
  request: Request,
  key: Uint8Array,
  now = Date.now(),
) {
  const timestamp = request.headers.get(timestampHeader);
  const signature = request.headers.get(signatureHeader);
  const authorization = request.headers.get("authorization");
  if (
    request.method !== "POST" ||
    new URL(request.url).pathname !== MENU_BACKGROUND_PATH ||
    timestamp === null ||
    !/^[1-9]\d{12}$/u.test(timestamp) ||
    signature === null ||
    !/^[a-f0-9]{64}$/u.test(signature) ||
    authorization === null ||
    !/^Bearer [^\s]+$/u.test(authorization)
  )
    return null;
  const elapsed = now - Number(timestamp);
  // 60 秒の platform 再試行は許容するが、180 秒の再試行は受付予算外として拒否する。
  if (elapsed < 0 || elapsed >= MENU_BACKGROUND_HARD_DEADLINE_MS) return null;
  let body: string;
  const readSignal = AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]);
  try {
    // 未認証のストリームが停止しても待機を打ち切る。ALS の fetch deadline とは独立する。
    body = await awaitWithAbort(() => readJsonTextWithLimit(request, 65_536), readSignal);
  } catch (error) {
    if (readSignal.aborted) return null;
    throw error;
  }
  const expected = menuBackgroundSignature(
    key,
    authorization,
    timestamp,
    body,
    request.method,
    new URL(request.url).pathname,
  );
  if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) return null;
  // 送信時の raw JSON を署名するため、キー順や空白を正規化して検証を迂回しない。
  return parseJson(
    new Request(request.url, { method: "POST", headers: request.headers, body }),
    menuBackgroundBodySchema,
  );
}
