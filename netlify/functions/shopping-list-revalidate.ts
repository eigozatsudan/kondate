import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { requireUser } from "./_shared/auth.js";
import { handleError, HttpError, json, methodNotAllowed } from "./_shared/http.js";
import {
  createShoppingDependencies,
  type ShoppingDependencies,
} from "./_shared/shopping-adapter.js";
import { revalidateActiveShoppingList } from "./_shared/shopping-service.js";

// 設計書 Task4: preview / reconcile と同じ「認証 + context.params 注入 factory」
// パターン。再検証は path の listId だけで完結するため body は受け取らない
// （ブラウザから解決済みの値を持ち込ませないという Task4 の前提そのもの）。
// 相対 import の ".js" は本リポジトリの ESM 実行環境に合わせた機械的補正。

const listIdSchema = z.uuid();
type Factory = (user: { userId: string; accessToken: string }) => ShoppingDependencies;

export function createShoppingListRevalidateHandler(factory: Factory) {
  return async (request: Request, context: Context): Promise<Response> => {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    try {
      const user = await requireUser(request);
      const parsedId = listIdSchema.safeParse(context.params.listId);
      if (!parsedId.success) {
        throw new HttpError(400, "invalid_list_id", "買い物リストを確認できませんでした");
      }
      const result = await revalidateActiveShoppingList(factory(user), {
        userId: user.userId,
        listId: parsedId.data,
      });
      return json(200, { ok: true, data: result });
    } catch (error) {
      return handleError(error);
    }
  };
}
export default createShoppingListRevalidateHandler(createShoppingDependencies);
export const config: Config = { path: "/api/shopping-lists/:listId/revalidate", method: "POST" };
