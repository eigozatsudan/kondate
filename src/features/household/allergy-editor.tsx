import { useMemo, useState } from "react";
import type { AllergenAliasRow, AllergenCatalogRow, MemberAllergyRow } from "./household-api";

function normalizeAllergenTerm(value: string): string {
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

export type AllergyEditorProps = {
  memberId: string;
  catalog: readonly AllergenCatalogRow[];
  aliases?: readonly AllergenAliasRow[];
  allergies: readonly MemberAllergyRow[];
  addStandard(memberId: string, allergenId: string): Promise<unknown>;
  addCustom(memberId: string, name: string, aliases: string[]): Promise<unknown>;
  remove(allergyId: string): Promise<unknown>;
  disabled?: boolean;
};

export function AllergyEditor(props: AllergyEditorProps) {
  const { memberId, catalog, aliases = [], allergies, disabled = false } = props;
  const [query, setQuery] = useState("");
  const [customName, setCustomName] = useState("");
  const [customAliases, setCustomAliases] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const matches = useMemo(
    () => filterAllergenCatalog(catalog, query, aliases),
    [aliases, catalog, query],
  );
  const normalizedCustomName = customName.normalize("NFKC").trim();
  const customTerms = [normalizedCustomName, ...customAliases.split(",")]
    .map(normalizeAllergenTerm)
    .filter((term) => term.length > 0);
  const exactMatchIds = new Set(
    aliases
      .filter(
        (alias) =>
          alias.alias_kind !== "processed" &&
          customTerms.includes(normalizeAllergenTerm(alias.normalized_alias)),
      )
      .map((alias) => alias.allergen_id),
  );
  for (const item of catalog) {
    if (customTerms.includes(normalizeAllergenTerm(item.display_name))) exactMatchIds.add(item.id);
  }
  const exactMatches = catalog.filter((item) => exactMatchIds.has(item.id));
  const exactMatch = exactMatches.length > 0;
  const aliasValues = customAliases
    .split(",")
    .map((alias) => alias.normalize("NFKC").trim())
    .filter((alias) => alias.length > 0);

  return (
    <section className="stack" aria-label="アレルギー編集">
      <label className="field">
        <span>標準29品目を検索</span>
        <input
          aria-label="標準29品目を検索"
          role="searchbox"
          value={query}
          disabled={disabled}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
      </label>
      <ul className="stack" aria-label="標準アレルギー候補">
        {matches.length === 0 && (
          <li>該当する標準項目はありません。自由登録を確認してください。</li>
        )}
        {matches.map((item) => (
          <li key={item.id}>
            <button
              className="secondary-button"
              type="button"
              disabled={disabled || allergies.some((allergy) => allergy.allergen_id === item.id)}
              onClick={() => void props.addStandard(memberId, item.id)}
            >
              {item.display_name}を追加
            </button>
          </li>
        ))}
      </ul>
      <p>自由登録は候補にない場合だけ使用してください</p>
      <fieldset className="stack">
        <legend>自由登録</legend>
        <label className="field">
          <span>自由登録名</span>
          <input
            value={customName}
            disabled={disabled}
            onChange={(event) => {
              setCustomName(event.target.value);
            }}
          />
        </label>
        <label className="field">
          <span>別名（カンマ区切り・任意）</span>
          <input
            value={customAliases}
            disabled={disabled}
            onChange={(event) => {
              setCustomAliases(event.target.value);
            }}
          />
        </label>
        {exactMatch && (
          <p role="alert">
            標準候補: {exactMatches.map((item) => item.display_name).join("、")}（
            {normalizedCustomName}）。標準項目を先に選んでください
          </p>
        )}
        <label>
          <input
            type="checkbox"
            aria-label="標準候補に該当しないことを確認"
            checked={confirmed}
            disabled={disabled}
            onChange={(event) => {
              setConfirmed(event.target.checked);
            }}
          />
          標準候補に該当しないことを確認
        </label>
        <button
          className="secondary-button"
          type="button"
          disabled={
            disabled ||
            !confirmed ||
            exactMatch ||
            normalizedCustomName.length < 1 ||
            normalizedCustomName.length > 80 ||
            aliasValues.length > 10
          }
          onClick={() => {
            void props
              .addCustom(memberId, normalizedCustomName, aliasValues)
              .then(() => {
                setCustomName("");
                setCustomAliases("");
                setConfirmed(false);
              })
              .catch(() => undefined);
          }}
        >
          自由登録を追加
        </button>
      </fieldset>
      <ul aria-label="選択済みアレルギー">
        {allergies.map((allergy) => {
          const name =
            allergy.allergen_id === null
              ? allergy.custom_name
              : catalog.find((item) => item.id === allergy.allergen_id)?.display_name;
          const displayName = name ?? "表示名を確認できない項目";
          return (
            <li key={allergy.id}>
              {displayName}
              <button
                className="text-button"
                type="button"
                aria-label={`${displayName}を削除`}
                disabled={disabled}
                onClick={() => void props.remove(allergy.id)}
              >
                削除
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
