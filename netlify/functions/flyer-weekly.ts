import type { Config } from "@netlify/functions";
import { flyerWeeklyIssueMessages } from "../../shared/contracts/flyer-weekly.js";
import { requireUserWithEmail } from "./_shared/auth.js";
import { runFlyerWeekly } from "./_shared/flyer-weekly-service.js";
import { handleError, HttpError, json, methodNotAllowed } from "./_shared/http.js";

const MAX_MULTIPART_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/flyer-weekly
 * multipart/form-data の image フィールドのみ受理（クライアント safety 禁止）。
 */
export default async function flyerWeekly(request: Request): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
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
      { user: { userId: user.userId, email: user.email } },
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
  rateLimit: { windowLimit: 20, windowSize: 180, aggregateBy: ["ip"] },
};
