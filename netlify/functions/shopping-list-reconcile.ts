import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { reconcileShoppingListRequestSchema } from "../../shared/contracts/shopping.js";
import { requireUser } from "./_shared/auth.js";
import { handleError, HttpError, json, methodNotAllowed, parseJson } from "./_shared/http.js";
import {
  createShoppingDependencies,
  type ShoppingDependencies,
} from "./_shared/shopping-adapter.js";
import { reconcileShoppingList } from "./_shared/shopping-service.js";

// 設計書 Task4 listing の import は拡張子なしだが、本リポジトリの ESM 実行環境に
// 合わせて ".js" を付ける機械的補正だけを適用する。

const listIdSchema = z.uuid();
type Factory = (user: { userId: string; accessToken: string }) => ShoppingDependencies;

export function createShoppingListReconcileHandler(factory: Factory) {
  return async (request: Request, context: Context): Promise<Response> => {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    try {
      const user = await requireUser(request);
      const listId = listIdSchema.safeParse(context.params.listId);
      if (!listId.success) {
        throw new HttpError(400, "invalid_list_id", "買い物リストを確認できませんでした");
      }
      const body = await parseJson(request, reconcileShoppingListRequestSchema);
      const result = await reconcileShoppingList(factory(user), {
        ...body,
        listId: listId.data,
        userId: user.userId,
      });
      return json(200, { ok: true, data: result });
    } catch (error) {
      return handleError(error);
    }
  };
}
export default createShoppingListReconcileHandler(createShoppingDependencies);
export const config: Config = { path: "/api/shopping-lists/:listId/reconcile" };
