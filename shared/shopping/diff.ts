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

/** numeric 同一キー（正規化名・単位）。数量カバレッジ集計と SHOP15 温存判定に使う。 */
const numericCoverageKey = (item: {
  normalizedName: string;
  unit: string | null;
  quantityValue: number | null;
}): string | null =>
  item.quantityValue === null || item.unit === null
    ? null
    : JSON.stringify(["numeric", item.normalizedName, item.unit]);

export type ComputeShoppingDiffOptions = {
  /**
   * 再照合対象の item id 集合（同一献立 lineage の由来行）。
   * 指定時、集合外の plain 行は replace/remove も候補消費もしない（他献立 append 分を温存）。
   * protected 行は従来どおり保護し、集合外でも protectedItemIds に載せる。
   */
  scopeItemIds?: ReadonlySet<string>;
};

export function computeShoppingDiff(
  current: ShoppingList,
  next: ShoppingDraft,
  options?: ComputeShoppingDiffOptions,
): ShoppingDiff {
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
  // SHOP12: 同名だけだと unit バケットを跨ぎ誤 unit の review add になる。
  // protected fallback は normalizedName + unit が一致する候補に限る。
  const takeCandidateByNameAndUnit = (
    normalizedName: string,
    unit: string | null,
  ): ShoppingDraftItem | undefined => {
    for (const [key, bucket] of nextBuckets) {
      const candidateIndex = bucket.findIndex(
        (entry) => entry.normalizedName === normalizedName && entry.unit === unit,
      );
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
  const scopeItemIds = options?.scopeItemIds;

  for (const item of current.items) {
    if (protectedItem(item)) {
      protectedItemIds.push(item.id);
      // 手動行は新版のderived requirementを満たさず、候補を一切消費しない。
      // multi-source: scope 外の protected も候補消費しない（他献立の購入済み行を横取りしない）
      if (!item.isManual && (scopeItemIds === undefined || scopeItemIds.has(item.id))) {
        protectedDerivedItems.push(item);
      }
      continue;
    }
    // multi-source: 再照合対象外の plain 行は温存（名前一致で他献立行を replace/remove しない）
    if (scopeItemIds !== undefined && !scopeItemIds.has(item.id)) {
      continue;
    }
    plainItems.push(item);
  }

  // SHOP15: protected shortfall は「当該行だけ」ではなく同一 numeric key の
  // 非手動・非ユーザー削除行の合計で既充足量を見る。前回 _delta_* 追加行が残った
  // 再 reconcile で不足分を二重に積まない。isRemovedByUser 行は base から除外し、
  // 処理中の自身数量だけ後で足す（既存の removed delta 挙動を維持）。
  const baseCoverageByKey = new Map<string, number>();
  for (const item of current.items) {
    if (item.isManual || item.isRemovedByUser) continue;
    const key = numericCoverageKey(item);
    if (key === null || item.quantityValue === null) continue;
    baseCoverageByKey.set(
      key,
      roundQuantityValue((baseCoverageByKey.get(key) ?? 0) + item.quantityValue),
    );
  }
  // protected が numeric exact で所要を受け持った key。被覆に使った plain 行は remove しない。
  const protectedSatisfiedNumericKeys = new Set<string>();

  // protected非手動行の完全一致をplain行より先に割り当て、入力順による結果変化を防ぐ。
  // residual-intentional (SHOP7): protected は exact diffKey の delta/add のみ。
  // label 警告差分の replace は plain のみ（SP-I8）。購入済み行の provenance 差し替えはしない。
  for (const item of protectedDerivedItems) {
    const exact = takeCandidate(diffKey(item));
    if (
      exact !== undefined &&
      item.quantityValue !== null &&
      exact.quantityValue !== null &&
      item.unit !== null &&
      exact.unit === item.unit
    ) {
      const coverageKey = numericCoverageKey(item);
      let covered = item.quantityValue;
      if (coverageKey !== null) {
        protectedSatisfiedNumericKeys.add(coverageKey);
        covered = baseCoverageByKey.get(coverageKey) ?? 0;
        // ユーザー削除行は base に含めないが、自身の数量は shortfall 基準に残す。
        if (item.isRemovedByUser) {
          covered = roundQuantityValue(covered + item.quantityValue);
        }
      }
      // SP-I2/SP-I3: 差分数量も milli 丸め + formatQuantityValue で表示を安定させる。
      const delta = roundQuantityValue(exact.quantityValue - covered);
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
      const coverageKey = numericCoverageKey(item);
      // SHOP15: protected が同一 key の所要を既に満たした plain は被覆行として温存。
      // ここで remove すると（UI 上 remove は任意のため）未承認時に _delta_ 再加算と重なり数量が積み上がる。
      if (coverageKey !== null && protectedSatisfiedNumericKeys.has(coverageKey)) {
        continue;
      }
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
  // 最後まで残った同名・同 unit 候補だけを protected 行の在庫確認付き追加へ割り当てる（SHOP12）。
  for (const item of protectedFallbackItems) {
    const candidate = takeCandidateByNameAndUnit(item.normalizedName, item.unit);
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
