import type { AllergenAliasRow, AllergenCatalogRow } from "./household-api";

export function normalizeAllergenTerm(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ja-JP")
    .replace(/[\s()]/gu, "");
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
