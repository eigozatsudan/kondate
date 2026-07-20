import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { requireUser } from "./_shared/auth.js";
import { createGenerationRepository } from "./_shared/generation-repository.js";
import { generationResponse, toGenerationStatus } from "./_shared/generation-service.js";
import { handleError, HttpError, methodNotAllowed } from "./_shared/http.js";

const idempotencyKeySchema = z.uuid();

export default async function generationStatus(
  request: Request,
  context?: Context,
): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  try {
    const user = await requireUser(request);
    const parsedIdempotencyKey = idempotencyKeySchema.safeParse(context?.params.idempotencyKey);
    if (!parsedIdempotencyKey.success) {
      throw new HttpError(400, "invalid_request", "入力内容を確認してください");
    }
    const idempotencyKey = parsedIdempotencyKey.data;
    const record = await createGenerationRepository(user).status(idempotencyKey);
    return generationResponse(toGenerationStatus(record, idempotencyKey));
  } catch (error) {
    return handleError(error);
  }
}

export const config: Config = {
  path: "/api/generations/:idempotencyKey/status",
  method: "GET",
};
