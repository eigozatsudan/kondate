import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import { previewShoppingDiffRequestSchema } from "../../shared/contracts/shopping.js";
import { requireUser } from "./_shared/auth.js";
import { handleError, HttpError, json, methodNotAllowed, parseJson } from "./_shared/http.js";
import {
  createShoppingDependencies,
  type ShoppingDependencies,
} from "./_shared/shopping-adapter.js";
import { previewShoppingListDiff } from "./_shared/shopping-service.js";

// 設計書 Task4 の listing は相対 import に拡張子を付けていないが、本リポジトリは
// ESM で全既存 netlify/functions ファイルが ".js" を付けている。実行時に解決できない
// ため、この補正だけを機械的に適用する（Task3 の shopping-list-from-menu.ts と同じ）。

const listIdSchema = z.uuid();
type Factory = (user: { userId: string; accessToken: string }) => ShoppingDependencies;

export function createShoppingListPreviewHandler(factory: Factory) {
  return async (request: Request, context: Context): Promise<Response> => {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    try {
      const user = await requireUser(request);
      const parsedId = listIdSchema.safeParse(context.params.listId);
      if (!parsedId.success) {
        throw new HttpError(400, "invalid_list_id", "買い物リストを確認できませんでした");
      }
      const body = await parseJson(request, previewShoppingDiffRequestSchema);
      const diff = await previewShoppingListDiff(factory(user), {
        ...body,
        listId: parsedId.data,
        userId: user.userId,
      });
      return json(200, { ok: true, data: diff });
    } catch (error) {
      return handleError(error);
    }
  };
}
export default createShoppingListPreviewHandler(createShoppingDependencies);
export const config: Config = { path: "/api/shopping-lists/:listId/preview" };
