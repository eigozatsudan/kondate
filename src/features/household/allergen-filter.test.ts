import { describe, expect, it } from "vitest";
import { filterAllergenCatalog, normalizeAllergenTerm } from "./allergen-filter";
import type { AllergenAliasRow, AllergenCatalogRow } from "./household-api";

describe("normalizeAllergenTerm", () => {
  it("folds katakana to hiragana so タマゴ matches たまご (F-SAF-001)", () => {
    expect(normalizeAllergenTerm("タマゴ")).toBe(normalizeAllergenTerm("たまご"));
    expect(normalizeAllergenTerm("ミルク")).toBe(normalizeAllergenTerm("みるく"));
  });

  it("strips spaces and parentheses after NFKC", () => {
    expect(normalizeAllergenTerm(" 卵 ")).toBe(normalizeAllergenTerm("卵"));
    expect(normalizeAllergenTerm("卵（鶏）")).toBe(normalizeAllergenTerm("卵鶏"));
  });
});

describe("filterAllergenCatalog", () => {
  const catalog: AllergenCatalogRow[] = [
    {
      id: "egg",
      display_name: "卵",
      catalog_version: "v1",
      created_at: "2026-01-01T00:00:00.000Z",
      regulatory_class: "mandatory",
    },
    {
      id: "milk",
      display_name: "乳",
      catalog_version: "v1",
      created_at: "2026-01-01T00:00:00.000Z",
      regulatory_class: "mandatory",
    },
  ];
  const aliases: AllergenAliasRow[] = [
    {
      id: "a1",
      allergen_id: "egg",
      alias: "たまご",
      normalized_alias: "たまご",
      alias_kind: "direct",
      dictionary_version: "v1",
      created_at: "2026-01-01T00:00:00.000Z",
      requires_label_confirmation: false,
    },
  ];

  it("finds egg when the user searches with katakana タマゴ", () => {
    const hits = filterAllergenCatalog(catalog, "タマゴ", aliases);
    expect(hits.map((row) => row.id)).toContain("egg");
  });
});
