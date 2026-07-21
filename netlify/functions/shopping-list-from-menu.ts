import type { Config } from "@netlify/functions";
import { createShoppingListRequestSchema } from "../../shared/contracts/shopping.js";
import { requireUser } from "./_shared/auth.js";
import { handleError, json, methodNotAllowed, parseJson } from "./_shared/http.js";
import {
  createShoppingDependencies,
  type ShoppingDependencies,
} from "./_shared/shopping-adapter.js";
import { createShoppingListFromMenu } from "./_shared/shopping-service.js";

// 設計書 Task3 listing の import はここでも拡張子なしだが、本ファイルからの
// shared 参照は他の netlify/functions/*.ts と同じ深さ（../shared/...）で
// ".js" 拡張子を付ける必要がある（同じ ESM 実行環境の理由）。

type Factory = (user: { userId: string; accessToken: string }) => ShoppingDependencies;

export function createShoppingListFromMenuHandler(factory: Factory) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    try {
      const user = await requireUser(request);
      const body = await parseJson(request, createShoppingListRequestSchema);
      const result = await createShoppingListFromMenu(factory(user), {
        ...body,
        userId: user.userId,
      });
      return json(200, { ok: true, data: result });
    } catch (error) {
      return handleError(error);
    }
  };
}
export default createShoppingListFromMenuHandler(createShoppingDependencies);
export const config: Config = { path: "/api/shopping-lists/from-menu" };
