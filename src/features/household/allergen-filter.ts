import type { AllergenAliasRow, AllergenCatalogRow } from "./household-api";

/** カタカナ（ァ-ヶ）を対応するひらがなへ折り畳む（normalizeFoodText と同型）。 */
function foldKatakanaToHiragana(value: string): string {
  return value.replace(/[\u30a1-\u30f6]/gu, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/**
 * アレルゲン登録・辞書照合用の正規化。
 * NFKC → カタカナ→ひらがな → 小文字 → 空白・括弧除去。
 * SQL private.normalize_allergen_term と揃える（F-SAF-001: タマゴ≠たまご の取りこぼし防止）。
 */
export function normalizeAllergenTerm(value: string): string {
  return foldKatakanaToHiragana(value.normalize("NFKC"))
    .trim()
    .toLocaleLowerCase("ja-JP")
    .replace(/[\s()（）]/gu, "");
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
