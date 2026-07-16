import { z } from "zod";
import type { ApiResponse } from "../../../shared/contracts/http.js";

const maxBodyBytes = 8 * 1024;

export function jsonResponse(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
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

export async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let value: unknown;
  try {
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
      fields: z.flattenError(parsed.error).fieldErrors,
    });
  }
  return parsed.data;
}

export function handleError(error: unknown): Response {
  if (error instanceof HttpError) {
    return json(error.status, {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
  }
  return json(500, {
    ok: false,
    error: { code: "request_failed", message: "処理を完了できませんでした" },
  });
}
