import { useMemo, useRef, useState } from "react";
import { filterAllergenCatalog, normalizeAllergenTerm } from "./allergen-filter";
import type { AllergenAliasRow, AllergenCatalogRow, MemberAllergyRow } from "./household-api";

export type AllergyEditorProps = {
  memberId: string;
  catalog: readonly AllergenCatalogRow[];
  aliases?: readonly AllergenAliasRow[];
  allergies: readonly MemberAllergyRow[];
  addStandard(memberId: string, allergenId: string): Promise<unknown>;
  addCustom(memberId: string, name: string, aliases: string[]): Promise<unknown>;
  remove(allergyId: string): Promise<unknown>;
  onError?(error: unknown): void;
  disabled?: boolean;
};

export function AllergyEditor(props: AllergyEditorProps) {
  const { memberId, catalog, aliases = [], allergies, disabled = false } = props;
  const [query, setQuery] = useState("");
  const [customName, setCustomName] = useState("");
  const [customAliases, setCustomAliases] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [mutationPending, setMutationPending] = useState(false);
  const mutationPendingRef = useRef(false);
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
  const mutationDisabled = disabled || mutationPending;
  const runMutation = (operation: () => Promise<unknown>, onSuccess?: () => void) => {
    // React の再描画前に連続クリックされても、アレルギー更新を同時送信しない。
    if (mutationPendingRef.current) return;
    mutationPendingRef.current = true;
    setMutationPending(true);
    let result: Promise<unknown>;
    try {
      result = operation();
    } catch (error) {
      props.onError?.(error);
      mutationPendingRef.current = false;
      setMutationPending(false);
      return;
    }
    void result
      .then(() => {
        onSuccess?.();
      })
      .catch((error: unknown) => {
        props.onError?.(error);
      })
      .finally(() => {
        mutationPendingRef.current = false;
        setMutationPending(false);
      });
  };

  return (
    <section className="stack" aria-label="アレルギー編集">
      <label className="field">
        <span>よくあるアレルギーから探す</span>
        <input
          aria-label="よくあるアレルギーから探す"
          role="searchbox"
          value={query}
          disabled={mutationDisabled}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
      </label>
      <ul className="stack" aria-label="よくあるアレルギーの候補">
        {matches.length === 0 && (
          <li>一覧に該当するものはありません。自由登録を確認してください。</li>
        )}
        {matches.map((item) => (
          <li key={item.id}>
            <button
              className="secondary-button"
              type="button"
              disabled={
                mutationDisabled || allergies.some((allergy) => allergy.allergen_id === item.id)
              }
              onClick={() => {
                runMutation(() => props.addStandard(memberId, item.id));
              }}
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
            disabled={mutationDisabled}
            onChange={(event) => {
              setCustomName(event.target.value);
            }}
          />
        </label>
        <label className="field">
          <span>別名（カンマ区切り・任意）</span>
          <input
            value={customAliases}
            disabled={mutationDisabled}
            onChange={(event) => {
              setCustomAliases(event.target.value);
            }}
          />
        </label>
        {exactMatch && (
          <p role="alert">
            一覧に同じものがあります: {exactMatches.map((item) => item.display_name).join("、")}（
            {normalizedCustomName}）。一覧から先に選んでください
          </p>
        )}
        <label>
          <input
            type="checkbox"
            aria-label="一覧にないアレルギーとして登録"
            checked={confirmed}
            disabled={mutationDisabled}
            onChange={(event) => {
              setConfirmed(event.target.checked);
            }}
          />
          一覧にないアレルギーとして登録
        </label>
        <button
          className="secondary-button"
          type="button"
          disabled={
            mutationDisabled ||
            !confirmed ||
            exactMatch ||
            normalizedCustomName.length < 1 ||
            normalizedCustomName.length > 80 ||
            aliasValues.length > 10
          }
          onClick={() => {
            runMutation(
              () => props.addCustom(memberId, normalizedCustomName, aliasValues),
              () => {
                setCustomName("");
                setCustomAliases("");
                setConfirmed(false);
              },
            );
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
          const displayName = name ?? "名前を表示できない項目";
          return (
            <li key={allergy.id}>
              {displayName}
              <button
                className="text-button"
                type="button"
                aria-label={`${displayName}を削除`}
                disabled={mutationDisabled}
                onClick={() => {
                  runMutation(() => props.remove(allergy.id));
                }}
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
