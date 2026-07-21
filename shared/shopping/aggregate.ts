import type {
  ShoppingDraft,
  ShoppingDraftItem,
  ShoppingLabelSnapshot,
  ShoppingSourceIngredient,
} from "../contracts/shopping.js";
import { normalizeIngredientName } from "./normalize.js";

type PantryAmount = { name: string; quantity: number | null; unit: string | null };
export type ShoppingDraftInput = {
  menuId: string;
  menuVersion: number;
  ingredients: readonly ShoppingSourceIngredient[];
  pantry: readonly PantryAmount[];
  aliases: ReadonlyMap<string, string>;
  labels: readonly ShoppingLabelSnapshot[];
};

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
  const numeric = new Map<string, ShoppingDraftItem>();
  const ambiguous: ShoppingDraftItem[] = [];
  for (const source of input.ingredients) {
    const normalizedName = normalizeIngredientName(source.name, input.aliases);
    const warnings = input.labels
      .filter(
        (label) => label.sourceType === "ingredient" && label.sourceId === source.ingredientId,
      )
      .map((label) => ({ ...label, confirmationStatus: "pending" as const }));
    if (source.quantityValue === null || source.unit === null) {
      ambiguous.push({
        key: itemKey(normalizedName, source.unit, [source.ingredientId]),
        displayName: source.name,
        normalizedName,
        storeSection: source.storeSection,
        quantityValue: null,
        quantityText: source.quantityText,
        unit: source.unit,
        pantryCheckRequired: input.pantry.some(
          (item) => normalizeIngredientName(item.name, input.aliases) === normalizedName,
        ),
        sourceIngredients: [source],
        labelWarnings: warnings,
      });
      continue;
    }
    const groupKey = JSON.stringify([normalizedName, source.unit]);
    const previous = numeric.get(groupKey);
    const sources = [...(previous?.sourceIngredients ?? []), source];
    const quantityValue = (previous?.quantityValue ?? 0) + source.quantityValue;
    numeric.set(groupKey, {
      key: itemKey(
        normalizedName,
        source.unit,
        sources.map((item) => item.ingredientId),
      ),
      displayName: previous?.displayName ?? source.name,
      normalizedName,
      storeSection: previous?.storeSection ?? source.storeSection,
      quantityValue,
      quantityText: `${String(quantityValue)}${source.unit}`,
      unit: source.unit,
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
    const sameName = input.pantry.filter(
      (candidate) => normalizeIngredientName(candidate.name, input.aliases) === item.normalizedName,
    );
    const sameUnit = sameName.filter((candidate) => candidate.unit === item.unit);
    if (sameName.length === 0) {
      kept.push(item);
    } else if (sameUnit.length === 0 || sameUnit.some((candidate) => candidate.quantity === null)) {
      kept.push({ ...item, pantryCheckRequired: true });
    } else {
      const pantryQuantity = sameUnit.reduce(
        (sum, candidate) => sum + (candidate.quantity ?? 0),
        0,
      );
      const remaining = Math.max(0, item.quantityValue - pantryQuantity);
      if (remaining > 0) {
        kept.push({
          ...item,
          quantityValue: remaining,
          quantityText: `${String(remaining)}${item.unit}`,
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
