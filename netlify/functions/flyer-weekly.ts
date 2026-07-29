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

/**
 * POST /api/flyer-weekly
 * multipart/form-data の image フィールドのみ受理（クライアント safety 禁止）。
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

    // image 以外のフィールドは無視（allergy 等を信頼しない）
    const image = form.get("image");
    if (image === null || typeof image === "string") {
      throw new HttpError(400, "flyer_invalid_image", flyerWeeklyIssueMessages.flyer_invalid_image);
    }
    const blob = image as Blob;
    const buffer = new Uint8Array(await blob.arrayBuffer());

    const result = await runFlyerWeekly(
      {
        user: { userId: user.userId, email: user.email },
        requestStartedAtMonotonicMs,
      },
      buffer,
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
