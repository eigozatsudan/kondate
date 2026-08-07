import { normalizeFoodText } from "@shared/safety-pure/normalize-food-text";
import type { AllergenAliasRow, AllergenCatalogRow } from "./household-api";

/**
 * アレルゲン登録・辞書照合用の正規化。
 * evaluate 側の normalizeFoodText と同じ空間（句読点・書式制御 Cf 除去込み）へ寄せ、
 * カスタム「卵、」「卵​」が標準卵と衝突して拒否されるようにする（H12）。
 * SQL private.normalize_allergen_term も同集合を strip する。
 */
export function normalizeAllergenTerm(value: string): string {
  return normalizeFoodText(value);
}

export function filterAllergenCatalog(
  catalog: readonly AllergenCatalogRow[],
  query: string,
  aliases: readonly AllergenAliasRow[] = [],
): AllergenCatalogRow[] {
  const normalized = normalizeAllergenTerm(query);
  if (normalized.length === 0) return [...catalog];
  const matchingIds = new Set(
    aliases
      .filter(
        (alias) =>
          alias.alias_kind !== "processed" &&
          normalizeAllergenTerm(alias.normalized_alias).includes(normalized),
      )
      .map((alias) => alias.allergen_id),
  );
  return catalog.filter(
    (item) =>
      normalizeAllergenTerm(item.display_name).includes(normalized) || matchingIds.has(item.id),
  );
}
