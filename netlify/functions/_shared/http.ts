import { z } from "zod";

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
