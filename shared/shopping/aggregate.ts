import type {
  ShoppingDraft,
  ShoppingDraftItem,
  ShoppingLabelSnapshot,
  ShoppingSourceIngredient,
} from "../contracts/shopping.js";
import { getJstDateKey } from "../time/jst.js";
import {
  formatQuantityValue,
  normalizeIngredientName,
  normalizeUnit,
  roundQuantityValue,
} from "./normalize.js";

/**
 * 買い物下書き用の在庫量。
 * expiresOn は JST 日付キー（YYYY-MM-DD）。期限切れ在庫は自動差し引き対象外（SP-I1）。
 */
type PantryAmount = {
  name: string;
  quantity: number | null;
  unit: string | null;
  expiresOn?: string | null;
};
export type ShoppingDraftInput = {
  menuId: string;
  menuVersion: number;
  ingredients: readonly ShoppingSourceIngredient[];
  pantry: readonly PantryAmount[];
  aliases: ReadonlyMap<string, string>;
  labels: readonly ShoppingLabelSnapshot[];
  /** 期限判定の基準時刻。省略時は new Date()。 */
  now?: Date;
};

/** 期限切れ（expiresOn < 当日 JST）の在庫は差し引きに使わない。 */
function isUsablePantryStock(item: PantryAmount, todayJst: string): boolean {
  if (item.expiresOn === null || item.expiresOn === undefined) return true;
  return item.expiresOn >= todayJst;
}

function itemKey(
  normalizedName: string,
  unit: string | null,
  sourceIds: readonly string[],
): string {
  const value = JSON.stringify([normalizedName, unit, [...sourceIds].sort()]);
  let hash = 14695981039346656037n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return `item_${hash.toString(16).padStart(16, "0")}`;
}

export function buildShoppingDraft(input: ShoppingDraftInput): ShoppingDraft {
  const todayJst = getJstDateKey(input.now ?? new Date());
  const usablePantry = input.pantry.filter((item) => isUsablePantryStock(item, todayJst));
  // 期限切れ在庫でも同名があれば「確認必須」フラグだけ立てる（差し引きはしない）。
  const expiredSameName = (normalizedName: string) =>
    input.pantry.some(
      (item) =>
        !isUsablePantryStock(item, todayJst) &&
        normalizeIngredientName(item.name, input.aliases) === normalizedName,
    );

  const numeric = new Map<string, ShoppingDraftItem>();
  const ambiguous: ShoppingDraftItem[] = [];
  for (const source of input.ingredients) {
    const normalizedName = normalizeIngredientName(source.name, input.aliases);
    const unit = normalizeUnit(source.unit);
    const warnings = input.labels
      .filter(
        (label) => label.sourceType === "ingredient" && label.sourceId === source.ingredientId,
      )
      .map((label) => ({ ...label, confirmationStatus: "pending" as const }));
    if (source.quantityValue === null || unit === null) {
      ambiguous.push({
        key: itemKey(normalizedName, unit, [source.ingredientId]),
        displayName: source.name,
        normalizedName,
        storeSection: source.storeSection,
        quantityValue: null,
        quantityText: source.quantityText,
        unit,
        pantryCheckRequired:
          usablePantry.some(
            (item) => normalizeIngredientName(item.name, input.aliases) === normalizedName,
          ) || expiredSameName(normalizedName),
        sourceIngredients: [source],
        labelWarnings: warnings,
      });
      continue;
    }
    const groupKey = JSON.stringify([normalizedName, unit]);
    const previous = numeric.get(groupKey);
    const sources = [...(previous?.sourceIngredients ?? []), source];
    // SP-I2: 合算直後に milli 丸めし、DB round-trip と diff の厳密比較が一致するようにする。
    const quantityValue = roundQuantityValue((previous?.quantityValue ?? 0) + source.quantityValue);
    numeric.set(groupKey, {
      key: itemKey(
        normalizedName,
        unit,
        sources.map((item) => item.ingredientId),
      ),
      displayName: previous?.displayName ?? source.name,
      normalizedName,
      storeSection: previous?.storeSection ?? source.storeSection,
      quantityValue,
      quantityText: `${formatQuantityValue(quantityValue)}${unit}`,
      unit,
      pantryCheckRequired: false,
      sourceIngredients: sources,
      labelWarnings: [...(previous?.labelWarnings ?? []), ...warnings],
    });
  }

  const kept: ShoppingDraftItem[] = [];
  for (const item of [...numeric.values(), ...ambiguous]) {
    if (item.quantityValue === null || item.unit === null) {
      kept.push(item);
      continue;
    }
    const sameName = usablePantry.filter(
      (candidate) => normalizeIngredientName(candidate.name, input.aliases) === item.normalizedName,
    );
    const sameUnit = sameName.filter((candidate) => normalizeUnit(candidate.unit) === item.unit);
    const needsExpiryCheck = expiredSameName(item.normalizedName);
    if (sameName.length === 0) {
      kept.push(needsExpiryCheck ? { ...item, pantryCheckRequired: true } : item);
    } else if (sameUnit.length === 0 || sameUnit.some((candidate) => candidate.quantity === null)) {
      kept.push({ ...item, pantryCheckRequired: true });
    } else {
      const pantryQuantity = sameUnit.reduce(
        (sum, candidate) => sum + (candidate.quantity ?? 0),
        0,
      );
      const remaining = roundQuantityValue(Math.max(0, item.quantityValue - pantryQuantity));
      // 有効在庫で足りた行は落とす。期限切れ在庫は usablePantry に含まれないので
      // 期限切れだけで「足りた」扱いにならない（SP-I1）。
      if (remaining > 0) {
        kept.push({
          ...item,
          quantityValue: remaining,
          quantityText: `${formatQuantityValue(remaining)}${item.unit}`,
          pantryCheckRequired: item.pantryCheckRequired || needsExpiryCheck,
        });
      }
    }
  }
  const labelKey = (label: ShoppingLabelSnapshot) =>
    JSON.stringify([label.sourceType, label.sourceId, label.allergenId, label.anonymousMemberRef]);
  const attached = new Set(kept.flatMap((item) => item.labelWarnings.map(labelKey)));
  return {
    items: kept,
    listLabelWarnings: input.labels
      .filter((label) => !attached.has(labelKey(label)))
      .map((label) => ({ ...label, confirmationStatus: "pending" as const })),
  };
}
