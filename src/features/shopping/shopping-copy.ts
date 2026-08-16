import { shoppingItemsMax } from "@shared/contracts/shopping";

/**
 * SHOP6 / SHOP-R1: soft-delete 行も 500 件天井に入る。
 * リスト面の空表示・追記 422 と、献立面の create/reconcile 422 で同じ案内を出す。
 * 天井値そのものは契約 shoppingItemsMax のまま変えない。
 */
export const shoppingListAtItemCeilingCopy =
  `このリストは${String(shoppingItemsMax)}件の上限に達しています。リストから外した項目も件数に入るため、新しい項目は足せません。別の献立から新しいリストを作ってください。` as const;

const shoppingCommandGenericCodedFailureCopy =
  "買い物リストの状態が変わりました。もう一度確認してください" as const;

/**
 * 献立面 failShoppingCommand の code 付き失敗文言。
 * 天井 422 だけリスト面と同じ copy を出し、他 code は従来どおり畳む。
 */
export function shoppingCommandCodedFailureCopy(code: unknown): string {
  if (code === "shopping_items_limit_exceeded") {
    return shoppingListAtItemCeilingCopy;
  }
  return shoppingCommandGenericCodedFailureCopy;
}
