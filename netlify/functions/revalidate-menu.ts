import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { requireUser } from "./_shared/auth.js";
import { handleError, HttpError, json, methodNotAllowed } from "./_shared/http.js";
import { createRevalidationDeps } from "./_shared/revalidation-adapter.js";
import { revalidateStoredMenu } from "./_shared/revalidation-service.js";
import { loadStoredMenuIdentity } from "./_shared/stored-menu-loader.js";
import { createUserScopedSupabase } from "./_shared/supabase-user.js";

const menuIdSchema = z.uuid();

/**
 * POST /api/menus/:menuId/revalidate
 * 履歴献立を現行の家族安全条件で再検証する境界。
 * 最初に identity だけを読み、idea は full aggregate / 家族 query より前に拒否する。
 */
export default async (request: Request, context: Context): Promise<Response> => {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  try {
    const user = await requireUser(request);
    const menuId = menuIdSchema.safeParse(context.params.menuId);
    if (!menuId.success) {
      throw new HttpError(400, "invalid_menu_id", "献立を確認できませんでした");
    }
    const ownerClient = createUserScopedSupabase(user.accessToken);
    const identity = await loadStoredMenuIdentity(ownerClient, user.userId, menuId.data);
    if (identity.targetMode === "idea") {
      throw new HttpError(
        422,
        "idea_menu_revalidation_not_supported",
        "アイデア献立は家族条件で確認できません",
      );
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
