/**
 * 調理前チェック用の材料合算。
 * 買い物 `buildShoppingDraft` とは別系統（在庫非控除・aliases 空固定）。
 * 合算行の `quantityText` は `formatQuantityValue`（`MenuDishes.amount` とは別系統）。
 * 未登録単位も `normalizeUnit` 後の文字列一致で合算する。
 */
import type { ValidatedMenu } from "@shared/contracts/generation";
import { storeSections } from "@shared/contracts/generation";
import {
  formatQuantityValue,
  normalizeIngredientName,
  normalizeUnit,
  roundQuantityValue,
} from "@shared/shopping/normalize";

const EMPTY_ALIASES: ReadonlyMap<string, string> = new Map();

export type MenuIngredientSummaryLine = {
  /** React key 用。正規化キー由来の安定文字列 */
  key: string;
  displayName: string;
  quantityValue: number | null;
  quantityText: string;
  unit: string | null;
  storeSection: (typeof storeSections)[number];
  labelConfirmationRequired: boolean;
};

export type MenuIngredientSummarySection = {
  storeSection: (typeof storeSections)[number];
  lines: readonly MenuIngredientSummaryLine[];
};

type MutableGroup = MenuIngredientSummaryLine & { firstAppearance: number };

/**
 * dishes を売り場区分順の合算行セクションに変換する。
 * 在庫差し引き・aliases は使わない。
 */
export function buildMenuIngredientsSummary(
  dishes: ValidatedMenu["dishes"],
): readonly MenuIngredientSummarySection[] {
  const groups = new Map<string, MutableGroup>();
  let appearance = 0;
  // toSorted は新配列を返すので [...x].toSorted は不要
  const orderedDishes = dishes.toSorted((a, b) => a.position - b.position);
  for (const d of orderedDishes) {
    const orderedIngredients = d.ingredients.toSorted((a, b) => a.position - b.position);
    for (const item of orderedIngredients) {
      const normalizedName = normalizeIngredientName(item.name, EMPTY_ALIASES);
      const unit = normalizeUnit(item.unit);
      // value をローカルに束縛して narrow（item.quantityValue! は lint error）
      const value = item.quantityValue;
      if (value !== null && unit !== null) {
        const key = JSON.stringify(["m", normalizedName, unit]);
        const existing = groups.get(key);
        if (existing === undefined) {
          groups.set(key, {
            key,
            displayName: item.name,
            quantityValue: value,
            quantityText: `${formatQuantityValue(value)}${unit}`,
            unit,
            storeSection: item.storeSection,
            labelConfirmationRequired: item.labelConfirmationRequired,
            firstAppearance: appearance,
          });
        } else if (existing.quantityValue !== null) {
          const sum = roundQuantityValue(existing.quantityValue + value);
          existing.quantityValue = sum;
          existing.quantityText = `${formatQuantityValue(sum)}${unit}`;
          existing.labelConfirmationRequired =
            existing.labelConfirmationRequired || item.labelConfirmationRequired;
        }
      } else {
        const key = JSON.stringify(["a", normalizedName, unit, item.quantityText]);
        const existing = groups.get(key);
        if (existing === undefined) {
          groups.set(key, {
            key,
            displayName: item.name,
            quantityValue: null,
            quantityText: item.quantityText,
            unit,
            storeSection: item.storeSection,
            labelConfirmationRequired: item.labelConfirmationRequired,
            firstAppearance: appearance,
          });
        } else {
          existing.labelConfirmationRequired =
            existing.labelConfirmationRequired || item.labelConfirmationRequired;
        }
      }
      appearance += 1;
    }
  }

  const bySection = new Map<(typeof storeSections)[number], MutableGroup[]>();
  for (const group of groups.values()) {
    const list = bySection.get(group.storeSection) ?? [];
    list.push(group);
    bySection.set(group.storeSection, list);
  }

  const result: MenuIngredientSummarySection[] = [];
  for (const section of storeSections) {
    const list = bySection.get(section);
    if (list === undefined || list.length === 0) continue;
    list.sort((a, b) => a.firstAppearance - b.firstAppearance);
    result.push({
      storeSection: section,
      // firstAppearance はソート用のみ。公開型から外す
      lines: list.map((group) => ({
        key: group.key,
        displayName: group.displayName,
        quantityValue: group.quantityValue,
        quantityText: group.quantityText,
        unit: group.unit,
        storeSection: group.storeSection,
        labelConfirmationRequired: group.labelConfirmationRequired,
      })),
    });
  }
  return result;
}
