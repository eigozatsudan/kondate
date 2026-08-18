import { normalizeFoodText } from "@shared/safety-pure/normalize-food-text";
import type { AllergenAliasRow, AllergenCatalogRow } from "./household-api";

/**
 * アレルゲン登録・辞書照合用の正規化。
 * evaluate 側の normalizeFoodText と同じ空間（句読点・書式制御 Cf 除去込み）へ寄せ、
 * カスタム「卵、」や「卵」+ZWSP が標準卵と衝突して拒否されるようにする（H12）。
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

  const displayNameOf = (item: AllergenCatalogRow): string =>
    normalizeAllergenTerm(item.display_name);
  const displayHitIds = new Set(
    catalog.filter((item) => displayNameOf(item).includes(normalized)).map((item) => item.id),
  );
  const usableAliases = aliases.filter((alias) => alias.alias_kind !== "processed");
  const exactAliasIds = new Set(
    usableAliases
      .filter((alias) => normalizeAllergenTerm(alias.normalized_alias) === normalized)
      .map((alias) => alias.allergen_id),
  );
  const substringAliasIds = new Set(
    usableAliases
      .filter((alias) => {
        const aliasNorm = normalizeAllergenTerm(alias.normalized_alias);
        return aliasNorm.includes(normalized) && aliasNorm !== normalized;
      })
      .map((alias) => alias.allergen_id),
  );

  // 「鶏」⊂ 鶏卵 / 「牛」⊂ 牛乳 の部分一致は、鶏肉・牛肉の display_name と衝突する。
  // evaluate は裸の鶏/牛を肉 alias に載せない（鶏卵・牛乳回避）。検索だけ逆方向に拾うと
  // catalog 順（卵 < 鶏肉、乳 < 牛肉）で別アレルゲンが先頭チップになる。
  // クエリがより長い display_name の接頭辞のときは、alias 真部分一致だけの ID を落とす。
  // exact alias（鶏卵・牛乳・たまご）と display_name 一致は残す。
  const queryIsPrefixOfLongerDisplayName = catalog.some((item) => {
    const name = displayNameOf(item);
    return name.startsWith(normalized) && name.length > normalized.length;
  });

  const matchingIds = new Set<string>([...displayHitIds, ...exactAliasIds]);
  for (const allergenId of substringAliasIds) {
    if (
      queryIsPrefixOfLongerDisplayName &&
      !displayHitIds.has(allergenId) &&
      !exactAliasIds.has(allergenId)
    ) {
      continue;
    }
    matchingIds.add(allergenId);
  }

  const hits = catalog.filter((item) => matchingIds.has(item.id));
  // display_name 一致を先頭に残し、残差の alias 一致はカタログ順のまま後ろへ。
  const preferred = hits.filter((item) => displayHitIds.has(item.id));
  const rest = hits.filter((item) => !displayHitIds.has(item.id));
  return [...preferred, ...rest];
}
