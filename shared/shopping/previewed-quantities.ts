import type { PreviewedShoppingQuantities, ShoppingDiff } from "../contracts/shopping.js";
import { quantityValuesEqual } from "./normalize.js";

/**
 * preview 差分から、画面が見せた add/replace 数量スナップショットを作る。
 * preview/apply の数量ずれを閉じるため、承認キーと対で送る。
 */
export function snapshotPreviewedQuantities(
  diff: Pick<ShoppingDiff, "add" | "replace">,
): PreviewedShoppingQuantities {
  return {
    add: diff.add.map((item) => ({
      key: item.key,
      quantityValue: item.quantityValue,
      quantityText: item.quantityText,
      pantryCheckRequired: item.pantryCheckRequired,
    })),
    replace: diff.replace.map((item) => ({
      itemId: item.itemId,
      quantityValue: item.next.quantityValue,
      quantityText: item.next.quantityText,
      pantryCheckRequired: item.next.pantryCheckRequired,
    })),
  };
}

/** hash / sticky 照合用。key・itemId 順に安定化する。 */
export function canonicalizePreviewedQuantities(
  snapshot: PreviewedShoppingQuantities,
): PreviewedShoppingQuantities {
  return {
    add: snapshot.add
      .map((entry) => ({
        key: entry.key,
        quantityValue: entry.quantityValue,
        quantityText: entry.quantityText,
        pantryCheckRequired: entry.pantryCheckRequired,
      }))
      .toSorted((left, right) => left.key.localeCompare(right.key)),
    replace: snapshot.replace
      .map((entry) => ({
        itemId: entry.itemId,
        quantityValue: entry.quantityValue,
        quantityText: entry.quantityText,
        pantryCheckRequired: entry.pantryCheckRequired,
      }))
      .toSorted((left, right) => left.itemId.localeCompare(right.itemId)),
  };
}

export function previewedQuantitiesEqual(
  left: PreviewedShoppingQuantities,
  right: PreviewedShoppingQuantities,
): boolean {
  return (
    JSON.stringify(canonicalizePreviewedQuantities(left)) ===
    JSON.stringify(canonicalizePreviewedQuantities(right))
  );
}

/**
 * 再計算 diff の add/replace が、画面が見せた数量スナップショットと一致するか。
 * 数量比較は quantityValuesEqual + quantityText。key 集合の増減も mismatch。
 * SHOP7: pantryCheckRequired も承認対象。期限切れ同名在庫は数量を変えずフラグだけ立てる。
 */
export function previewedQuantitiesMatchDiff(
  snapshot: PreviewedShoppingQuantities,
  diff: Pick<ShoppingDiff, "add" | "replace">,
): boolean {
  if (snapshot.add.length !== diff.add.length || snapshot.replace.length !== diff.replace.length) {
    return false;
  }
  const addByKey = new Map(diff.add.map((item) => [item.key, item]));
  if (addByKey.size !== snapshot.add.length) return false;
  for (const entry of snapshot.add) {
    const item = addByKey.get(entry.key);
    if (item === undefined) return false;
    if (!quantityValuesEqual(entry.quantityValue, item.quantityValue)) return false;
    if (entry.quantityText !== item.quantityText) return false;
    if (entry.pantryCheckRequired !== item.pantryCheckRequired) return false;
  }
  const replaceById = new Map(diff.replace.map((item) => [item.itemId, item]));
  if (replaceById.size !== snapshot.replace.length) return false;
  for (const entry of snapshot.replace) {
    const item = replaceById.get(entry.itemId);
    if (item === undefined) return false;
    if (!quantityValuesEqual(entry.quantityValue, item.next.quantityValue)) return false;
    if (entry.quantityText !== item.next.quantityText) return false;
    if (entry.pantryCheckRequired !== item.next.pantryCheckRequired) return false;
  }
  return true;
}
