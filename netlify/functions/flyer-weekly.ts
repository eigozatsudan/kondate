import { randomUUID } from "node:crypto";
import type { Config } from "@netlify/functions";
import { flyerWeeklyIssueMessages } from "../../shared/contracts/flyer-weekly.js";
import { requireUserWithEmail } from "./_shared/auth.js";
import { FLYER_MAX_RAW_BYTES } from "./_shared/flyer-image.js";
import { runFlyerWeekly } from "./_shared/flyer-weekly-service.js";
import { handleError, HttpError, json, methodNotAllowed } from "./_shared/http.js";

/**
 * Netlify Functions の buffered payload は 6MB。バイナリは Base64 化で約 +30% となり
 * 実効およそ 4.5MB。画像 raw 上限（4MiB）+ multipart 枠（256KiB）を超えさせない。
 */
export const MAX_MULTIPART_BYTES = FLYER_MAX_RAW_BYTES + 256 * 1024;

/** reserve_flyer_weekly の idempotency_key 長制限（1..128）に合わせる */
const IDEMPOTENCY_KEY_MAX = 128;
/** 自由文混入を防ぐ。UUID およびフォールバック採番（timestamp-hex）を許可 */
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{1,128}$/u;

/**
 * クライアントの Idempotency-Key / form を受理する。不正・欠落時はサーバー採番。
 * allergy 等の自由文は無視（image + キー以外を信頼しない）。
 */
export function resolveFlyerIdempotencyKey(request: Request, form: FormData): string {
  const header = request.headers.get("idempotency-key")?.trim() ?? "";
  const fromFormRaw = form.get("idempotencyKey");
  const fromForm = typeof fromFormRaw === "string" ? fromFormRaw.trim() : "";
  const candidate = header.length > 0 ? header : fromForm;
  if (
    candidate.length >= 1 &&
    candidate.length <= IDEMPOTENCY_KEY_MAX &&
    IDEMPOTENCY_KEY_RE.test(candidate)
  ) {
    return candidate;
  }
  return randomUUID();
}

/**
 * POST /api/flyer-weekly
 * multipart/form-data の image フィールドを受理（クライアント safety 禁止）。
 * 任意で Idempotency-Key ヘッダまたは form idempotencyKey（UUID）を受け取る。
 */
export default async function flyerWeekly(request: Request): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  // 総予算 55s の起点。multipart / sharp / OpenRouter 全体をこの時刻から測る。
  const requestStartedAtMonotonicMs = performance.now();
  try {
    const user = await requireUserWithEmail(request);
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      throw new HttpError(400, "invalid_request", "画像を multipart で送ってください。");
    }

    const contentLength = request.headers.get("content-length");
    if (
      contentLength !== null &&
      (/^\d+$/u.test(contentLength) ? Number(contentLength) > MAX_MULTIPART_BYTES : true)
    ) {
      throw new HttpError(400, "flyer_invalid_image", flyerWeeklyIssueMessages.flyer_invalid_image);
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(400, "flyer_invalid_image", flyerWeeklyIssueMessages.flyer_invalid_image);
    }

    // image 以外のフィールドは safety に使わない（キーは冪等用のみ）
    const image = form.get("image");
    if (image === null || typeof image === "string") {
      throw new HttpError(400, "flyer_invalid_image", flyerWeeklyIssueMessages.flyer_invalid_image);
    }
    const blob = image as Blob;
    const buffer = new Uint8Array(await blob.arrayBuffer());
    const idempotencyKey = resolveFlyerIdempotencyKey(request, form);

    const result = await runFlyerWeekly(
      {
        user: {
          userId: user.userId,
          email: user.email,
          accessToken: user.accessToken,
        },
        requestStartedAtMonotonicMs,
      },
      buffer,
      idempotencyKey,
    );

    return json(200, {
      ok: true,
      data: {
        requestId: result.requestId,
        menu: result.menu,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}

export const config: Config = {
  path: "/api/flyer-weekly",
  method: "POST",
  // sharp デコード + vision。Credit-based Pro 以上で有効。他プランは既定 1024MB のまま。
  memory: 2048,
  rateLimit: { windowLimit: 20, windowSize: 180, aggregateBy: ["ip"] },
};
