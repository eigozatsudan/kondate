import { z } from "zod";
import type { ApiResponse } from "../../../shared/contracts/http.js";

const maxBodyBytes = 8 * 1024;

export function jsonResponse(status: number, value: unknown): Response {
  // auth continuation の code 等を含むため json() と同型で no-store を付ける
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function invalidRequest(): Response {
  return jsonResponse(400, {
    ok: false,
    error: { code: "invalid_request", message: "リクエストを確認してください" },
  });
}

export function continuationUnavailable(): Response {
  return jsonResponse(404, {
    ok: false,
    error: { code: "continuation_unavailable", message: "認証をもう一度お試しください" },
  });
}

/**
 * claim RPC 成功後に payload 読取（bytea）/ decrypt / 応答検証が失敗したとき用。
 * C3: サーバ ciphertext は expires_at まで保持され、同一 credential なら冪等 re-claim 可能。
 * ここでの 410 は「行が burned で消えた」ではなく、bytea 破損・decrypt 失敗・応答 schema 不一致など
 * クライアントが 404 リトライしても回復しない terminal 障害を示す。
 */
export function continuationGone(): Response {
  return jsonResponse(410, {
    ok: false,
    error: { code: "continuation_unavailable", message: "認証をもう一度お試しください" },
  });
}

export function requireOrigin(request: Request, origin: string): boolean {
  return request.headers.get("origin") === origin;
}

export async function parseJsonRequest(request: Request): Promise<unknown> {
  if (request.headers.get("content-type") !== "application/json")
    throw new Error("invalid_request");
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) >= maxBodyBytes)
  ) {
    throw new Error("invalid_request");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength >= maxBodyBytes) throw new Error("invalid_request");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("invalid_request");
  }
}

export async function parseStrictJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(await parseJsonRequest(request));
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function json<T>(status: number, body: ApiResponse<T>): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function methodNotAllowed(allowed: readonly string[]): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code: "method_not_allowed", message: "この操作方法は利用できません" },
    } satisfies ApiResponse<never>),
    {
      status: 405,
      headers: {
        "content-type": "application/json",
        allow: allowed.join(", "),
        "cache-control": "no-store",
      },
    },
  );
}

/**
 * Content-Type が JSON 系か（application/json または *+json）。
 * charset 等のパラメータは許容する。parseJsonRequest より緩いが text/plain 等は拒否。
 */
function isJsonContentType(header: string | null): boolean {
  if (header === null) return false;
  const mediaType = header.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

/**
 * fieldErrors の path 名は残し、メッセージは入力本文を埋め込まない固定語に閉じる。
 * 将来の refine が free-text を message に載せてもクライアントへエコーしない。
 */
export function closedFieldErrors(
  fieldErrors: Record<string, string[] | undefined>,
): Record<string, string[]> {
  const closed: Record<string, string[]> = {};
  for (const [path, messages] of Object.entries(fieldErrors)) {
    if (messages === undefined || messages.length === 0) continue;
    // path 名も free-text を避ける（識別子のみ）
    if (!/^[A-Za-z_][A-Za-z0-9_.[\]]{0,79}$/u.test(path)) continue;
    closed[path] = messages.map(() => "invalid");
  }
  return closed;
}

/**
 * S8: HttpError.details を閉じた schema のみに正規化する。
 * - fields: path → ["invalid"] のみ（parseJson と対称）
 * - release_failed: true のみ（billing checkout B6）
 * 未知キー・free-text 値・ネスト任意 Record は落とす。
 */
export function closedHttpErrorDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (details === undefined) return undefined;
  const closed: Record<string, unknown> = {};
  const rawFields = details.fields;
  if (rawFields !== undefined && rawFields !== null && typeof rawFields === "object") {
    const fieldSource: Record<string, string[] | undefined> = {};
    for (const [path, value] of Object.entries(rawFields as Record<string, unknown>)) {
      if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
        fieldSource[path] = value;
      } else if (value !== undefined) {
        // 配列以外の形でも path だけ残し message は閉じる
        fieldSource[path] = ["invalid"];
      }
    }
    const fields = closedFieldErrors(fieldSource);
    if (Object.keys(fields).length > 0) closed.fields = fields;
  }
  if (details.release_failed === true) {
    closed.release_failed = true;
  }
  return Object.keys(closed).length === 0 ? undefined : closed;
}

export async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let value: unknown;
  try {
    if (!isJsonContentType(request.headers.get("content-type"))) {
      throw new HttpError(400, "invalid_json", "JSONを読み取れません");
    }
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > 65_536) {
      throw new HttpError(413, "request_too_large", "入力が大きすぎます");
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 65_536) {
      throw new HttpError(413, "request_too_large", "入力が大きすぎます");
    }
    value = JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "invalid_json", "JSONを読み取れません");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(400, "invalid_request", "入力内容を確認してください", {
      fields: closedFieldErrors(z.flattenError(parsed.error).fieldErrors),
    });
  }
  return parsed.data;
}

export function handleError(error: unknown): Response {
  if (error instanceof HttpError) {
    const details = closedHttpErrorDetails(error.details);
    return json(error.status, {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(details === undefined ? {} : { details }),
      },
    });
  }
  return json(500, {
    ok: false,
    error: { code: "request_failed", message: "処理を完了できませんでした" },
  });
}
