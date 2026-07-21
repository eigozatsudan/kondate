import type {
  ShoppingDiff,
  ShoppingDraft,
  ShoppingDraftItem,
  ShoppingList,
} from "../contracts/shopping.js";

export type ShoppingDiffApproval = {
  addKeys: readonly string[];
  replaceItemIds: readonly string[];
  removeItemIds: readonly string[];
};
export type ResolvedShoppingDiff = {
  add: ShoppingDraftItem[];
  replace: Array<ShoppingDraftItem & { existingItemId: string }>;
  removeIds: string[];
  listLabelWarnings: ShoppingDraft["listLabelWarnings"];
};

const protectedItem = (item: ShoppingList["items"][number]) =>
  item.isChecked || item.isManual || item.isManuallyEdited || item.isRemovedByUser;
const diffKey = (item: {
  normalizedName: string;
  unit: string | null;
  quantityValue: number | null;
  quantityText: string;
  storeSection: string;
}) =>
  item.quantityValue === null || item.unit === null
    ? JSON.stringify([
        "ambiguous",
        item.normalizedName,
        item.unit,
        item.quantityText,
        item.storeSection,
      ])
    : JSON.stringify(["numeric", item.normalizedName, item.unit]);

export function computeShoppingDiff(current: ShoppingList, next: ShoppingDraft): ShoppingDiff {
  const nextBuckets = new Map<string, ShoppingDraftItem[]>();
  for (const item of next.items) {
    const key = diffKey(item);
    const bucket = nextBuckets.get(key) ?? [];
    bucket.push(item);
    nextBuckets.set(key, bucket);
  }
  const takeCandidate = (key: string): ShoppingDraftItem | undefined => {
    const bucket = nextBuckets.get(key);
    const candidate = bucket?.shift();
    if (bucket?.length === 0) nextBuckets.delete(key);
    return candidate;
  };
  // 同じ正規化名の候補を numeric/ambiguous を問わず探す（protected row 専用のフォールバック）。
  // 完全一致キーでは見つからない場合にだけ使う。one-to-one 消費を維持するため、
  // 見つけた候補はバケットから取り除く。
  const takeCandidateByName = (normalizedName: string): ShoppingDraftItem | undefined => {
    for (const [key, bucket] of nextBuckets) {
      const index = bucket.findIndex((entry) => entry.normalizedName === normalizedName);
      if (index === -1) continue;
      const [candidate] = bucket.splice(index, 1);
      if (bucket.length === 0) nextBuckets.delete(key);
      return candidate;
    }
    return undefined;
  };
  const add: ShoppingDraftItem[] = [];
  const replace: ShoppingDiff["replace"] = [];
  const remove: ShoppingDiff["remove"] = [];
  const protectedItemIds: string[] = [];

  for (const item of current.items) {
    if (protectedItem(item)) {
      protectedItemIds.push(item.id);
      if (item.isManual) continue; // a manual row never satisfies a derived requirement
      // まず完全一致キーで候補を探す（同unit・同ambiguous形状なら安全な差分にできる）。
      // 完全一致がなければ、同じ正規化名の候補を numeric/ambiguous を問わず探す
      // （設計仕様: 同単位なら安全な差分、そうでなければ別項目で確認を求める）。
      const candidate = takeCandidate(diffKey(item)) ?? takeCandidateByName(item.normalizedName);
      if (
        candidate !== undefined &&
        item.quantityValue !== null &&
        candidate.quantityValue !== null &&
        item.unit !== null &&
        candidate.unit === item.unit
      ) {
        const delta = candidate.quantityValue - item.quantityValue;
        if (delta > 0)
          add.push({
            ...candidate,
            key: `${candidate.key}_delta_${item.id}`,
            quantityValue: delta,
            quantityText: `${String(delta)}${candidate.unit}`,
          });
      } else if (candidate !== undefined) {
        add.push({
          ...candidate,
          key: `${candidate.key}_review_${item.id}`,
          pantryCheckRequired: true,
        });
      }
      continue;
    }
    const candidate = takeCandidate(diffKey(item));
    if (candidate === undefined) {
      remove.push({
        itemId: item.id,
        displayName: item.displayName,
        quantityText: item.quantityText,
      });
    } else if (
      candidate.quantityValue !== item.quantityValue ||
      candidate.quantityText !== item.quantityText ||
      candidate.storeSection !== item.storeSection
    ) {
      replace.push({
        itemId: item.id,
        current: {
          displayName: item.displayName,
          quantityText: item.quantityText,
          storeSection: item.storeSection,
        },
        next: candidate,
      });
    }
  }
  add.push(...[...nextBuckets.values()].flat());
  return { add, replace, remove, protectedItemIds, listLabelWarnings: next.listLabelWarnings };
}

export function resolveApprovedDiff(
  diff: ShoppingDiff,
  approval: ShoppingDiffApproval,
): ResolvedShoppingDiff {
  const add = new Map(diff.add.map((item) => [item.key, item]));
  const replace = new Map(diff.replace.map((item) => [item.itemId, item.next]));
  const remove = new Set(diff.remove.map((item) => item.itemId));
  const resolvedAdd = approval.addKeys.map((key) => add.get(key));
  const resolvedReplace = approval.replaceItemIds.map((id) => {
    const next = replace.get(id);
    return next === undefined ? undefined : { ...next, existingItemId: id };
  });
  if (
    resolvedAdd.some((item) => item === undefined) ||
    resolvedReplace.some((item) => item === undefined) ||
    approval.removeItemIds.some((id) => !remove.has(id))
  ) {
    throw new Error("approved_diff_mismatch");
  }
  return {
    add: resolvedAdd.filter((item): item is ShoppingDraftItem => item !== undefined),
    replace: resolvedReplace.filter(
      (item): item is ShoppingDraftItem & { existingItemId: string } => item !== undefined,
    ),
    removeIds: [...approval.removeItemIds],
    listLabelWarnings: diff.listLabelWarnings,
  };
}
