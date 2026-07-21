import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { requireUser } from "./_shared/auth.js";
import { handleError, HttpError, json, methodNotAllowed } from "./_shared/http.js";
import { createRevalidationDeps } from "./_shared/revalidation-adapter.js";
import { revalidateStoredMenu } from "./_shared/revalidation-service.js";

const menuIdSchema = z.uuid();

/**
 * POST /api/menus/:menuId/revalidate
 * 履歴献立を現行の家族安全条件で再検証する境界。
 * 所有権は createRevalidationDeps 内の owner-scoped load が先に証明する。
 */
export default async (request: Request, context: Context): Promise<Response> => {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  try {
    const user = await requireUser(request);
    const menuId = menuIdSchema.safeParse(context.params.menuId);
    if (!menuId.success) {
      throw new HttpError(400, "invalid_menu_id", "献立を確認できませんでした");
    }
    const result = await revalidateStoredMenu(createRevalidationDeps(user), {
      userId: user.userId,
      menuId: menuId.data,
    });
    return json(200, { ok: true, data: result });
  } catch (error) {
    return handleError(error);
  }
};

export const config: Config = { path: "/api/menus/:menuId/revalidate", method: "POST" };
