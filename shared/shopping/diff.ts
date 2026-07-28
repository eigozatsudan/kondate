import type {
  ShoppingDiff,
  ShoppingDraft,
  ShoppingDraftItem,
  ShoppingList,
} from "../contracts/shopping.js";
import { formatQuantityValue, quantityValuesEqual, roundQuantityValue } from "./normalize.js";

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
  const takeCandidateByName = (normalizedName: string): ShoppingDraftItem | undefined => {
    for (const [key, bucket] of nextBuckets) {
      const candidateIndex = bucket.findIndex((entry) => entry.normalizedName === normalizedName);
      if (candidateIndex !== -1) {
        const [candidate] = bucket.splice(candidateIndex, 1);
        if (bucket.length === 0) nextBuckets.delete(key);
        return candidate;
      }
    }
    return undefined;
  };
  const add: ShoppingDraftItem[] = [];
  const replace: ShoppingDiff["replace"] = [];
  const remove: ShoppingDiff["remove"] = [];
  const protectedItemIds: string[] = [];
  const protectedDerivedItems: ShoppingList["items"][number][] = [];
  const plainItems: ShoppingList["items"][number][] = [];
  const protectedFallbackItems: ShoppingList["items"][number][] = [];

  for (const item of current.items) {
    if (protectedItem(item)) {
      protectedItemIds.push(item.id);
      // 手動行は新版のderived requirementを満たさず、候補を一切消費しない。
      if (!item.isManual) protectedDerivedItems.push(item);
      continue;
    }
    plainItems.push(item);
  }

  // protected非手動行の完全一致をplain行より先に割り当て、入力順による結果変化を防ぐ。
  for (const item of protectedDerivedItems) {
    const exact = takeCandidate(diffKey(item));
    if (
      exact !== undefined &&
      item.quantityValue !== null &&
      exact.quantityValue !== null &&
      item.unit !== null &&
      exact.unit === item.unit
    ) {
      // SP-I2/SP-I3: 差分数量も milli 丸め + formatQuantityValue で表示を安定させる。
      const delta = roundQuantityValue(exact.quantityValue - item.quantityValue);
      if (delta > 0)
        add.push({
          ...exact,
          key: `${exact.key}_delta_${item.id}`,
          quantityValue: delta,
          quantityText: `${formatQuantityValue(delta)}${exact.unit}`,
        });
    } else if (exact !== undefined) {
      add.push({
        ...exact,
        key: `${exact.key}_review_${item.id}`,
        pantryCheckRequired: true,
      });
    } else {
      protectedFallbackItems.push(item);
    }
  }

  const labelWarningKey = (warnings: readonly { allergenId: string; sourceId: string }[]) =>
    JSON.stringify(
      [...warnings].map((w) => `${w.allergenId}:${w.sourceId}`).sort((a, b) => a.localeCompare(b)),
    );

  // protected割当後にplain行を完全一致させ、不要になった旧行だけをremove候補にする。
  for (const item of plainItems) {
    const candidate = takeCandidate(diffKey(item));
    if (candidate === undefined) {
      remove.push({
        itemId: item.id,
        displayName: item.displayName,
        quantityText: item.quantityText,
      });
    } else if (
      // SP-I2: 生 float の !== ではなく丸め後比較。
      !quantityValuesEqual(candidate.quantityValue, item.quantityValue) ||
      candidate.quantityText !== item.quantityText ||
      candidate.storeSection !== item.storeSection ||
      // SP-I8: 加工品ラベル警告の差分も replace 対象にする（§9.2）。
      labelWarningKey(candidate.labelWarnings) !== labelWarningKey(item.labelWarnings) ||
      candidate.displayName !== item.displayName ||
      candidate.pantryCheckRequired !== item.pantryCheckRequired
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
  // 最後まで残った同名候補だけをprotected行の在庫確認付き追加へ割り当てる。
  for (const item of protectedFallbackItems) {
    const candidate = takeCandidateByName(item.normalizedName);
    if (candidate !== undefined) {
      add.push({
        ...candidate,
        key: `${candidate.key}_review_${item.id}`,
        pantryCheckRequired: true,
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
  if (
    new Set(approval.addKeys).size !== approval.addKeys.length ||
    new Set(approval.replaceItemIds).size !== approval.replaceItemIds.length ||
    new Set(approval.removeItemIds).size !== approval.removeItemIds.length
  ) {
    throw new Error("approved_diff_mismatch");
  }
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
