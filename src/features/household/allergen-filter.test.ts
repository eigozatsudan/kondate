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

  // H12: evaluate の normalizeFoodText と同じ句読点・Cf strip。近傍標準カスタムのすり抜けを閉じる。
  it("strips food-text punctuation so 卵、 collides with 卵 (H12)", () => {
    expect(normalizeAllergenTerm("卵、")).toBe(normalizeAllergenTerm("卵"));
    expect(normalizeAllergenTerm("卵・")).toBe(normalizeAllergenTerm("卵"));
    expect(normalizeAllergenTerm("たまご。")).toBe(normalizeAllergenTerm("たまご"));
  });

  it("strips format controls so 卵+ZWSP collides with 卵 (H12)", () => {
    expect(normalizeAllergenTerm("卵\u200b")).toBe(normalizeAllergenTerm("卵"));
    expect(normalizeAllergenTerm("たまご\u200b")).toBe(normalizeAllergenTerm("たまご"));
  });

  it("collapses pure punctuation or Cf to empty (H12)", () => {
    expect(normalizeAllergenTerm("、。")).toBe("");
    expect(normalizeAllergenTerm("・")).toBe("");
    expect(normalizeAllergenTerm("\u200b")).toBe("");
    expect(normalizeAllergenTerm("\u200b、\u200b")).toBe("");
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
    {
      id: "beef",
      display_name: "牛肉",
      catalog_version: "v1",
      created_at: "2026-01-01T00:00:00.000Z",
      regulatory_class: "recommended",
    },
    {
      id: "chicken",
      display_name: "鶏肉",
      catalog_version: "v1",
      created_at: "2026-01-01T00:00:00.000Z",
      regulatory_class: "recommended",
    },
    {
      id: "pork",
      display_name: "豚肉",
      catalog_version: "v1",
      created_at: "2026-01-01T00:00:00.000Z",
      regulatory_class: "recommended",
    },
    {
      id: "wheat",
      display_name: "小麦",
      catalog_version: "v1",
      created_at: "2026-01-01T00:00:00.000Z",
      regulatory_class: "mandatory",
    },
    {
      id: "buckwheat",
      display_name: "そば",
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
    {
      id: "a-egg-kei",
      allergen_id: "egg",
      alias: "鶏卵",
      normalized_alias: "鶏卵",
      alias_kind: "derived",
      dictionary_version: "v1",
      created_at: "2026-01-01T00:00:00.000Z",
      requires_label_confirmation: false,
    },
    {
      id: "a-milk-gyu",
      allergen_id: "milk",
      alias: "牛乳",
      normalized_alias: "牛乳",
      alias_kind: "derived",
      dictionary_version: "v1",
      created_at: "2026-01-01T00:00:00.000Z",
      requires_label_confirmation: false,
    },
    {
      id: "a-chicken",
      allergen_id: "chicken",
      alias: "チキン",
      normalized_alias: "チキン",
      alias_kind: "direct",
      dictionary_version: "v1",
      created_at: "2026-01-01T00:00:00.000Z",
      requires_label_confirmation: false,
    },
    {
      id: "a-chicken-tori",
      allergen_id: "chicken",
      alias: "とり肉",
      normalized_alias: "とり肉",
      alias_kind: "direct",
      dictionary_version: "v1",
      created_at: "2026-01-01T00:00:00.000Z",
      requires_label_confirmation: false,
    },
    {
      id: "a-beef",
      allergen_id: "beef",
      alias: "ビーフ",
      normalized_alias: "ビーフ",
      alias_kind: "direct",
      dictionary_version: "v1",
      created_at: "2026-01-01T00:00:00.000Z",
      requires_label_confirmation: false,
    },
    {
      id: "a-soba",
      allergen_id: "buckwheat",
      alias: "蕎麦",
      normalized_alias: "蕎麦",
      alias_kind: "direct",
      dictionary_version: "v1",
      created_at: "2026-01-01T00:00:00.000Z",
      requires_label_confirmation: false,
    },
    {
      id: "a-flour",
      allergen_id: "wheat",
      alias: "小麦粉",
      normalized_alias: "小麦粉",
      alias_kind: "derived",
      dictionary_version: "v1",
      created_at: "2026-01-01T00:00:00.000Z",
      requires_label_confirmation: false,
    },
  ];

  it("finds egg when the user searches with katakana タマゴ", () => {
    const hits = filterAllergenCatalog(catalog, "タマゴ", aliases);
    expect(hits.map((row) => row.id)).toContain("egg");
  });

  it("does not rank egg ahead of chicken when the query is 鶏 (H1)", () => {
    // 鶏卵への部分一致を残すと catalog 順で卵が先頭になり、鶏肉のつもりで卵だけ登録される
    const hits = filterAllergenCatalog(catalog, "鶏", aliases);
    expect(hits.map((row) => row.id)).toEqual(["chicken"]);
  });

  it("does not rank milk ahead of beef when the query is 牛 (H1)", () => {
    const hits = filterAllergenCatalog(catalog, "牛", aliases);
    expect(hits.map((row) => row.id)).toEqual(["beef"]);
  });

  it("still finds egg by exact alias 鶏卵 and display name 卵 (H1)", () => {
    expect(filterAllergenCatalog(catalog, "鶏卵", aliases).map((row) => row.id)).toEqual(["egg"]);
    expect(filterAllergenCatalog(catalog, "卵", aliases).map((row) => row.id)).toEqual(["egg"]);
  });

  it("still finds meat by display name and non-colliding aliases (H1)", () => {
    expect(filterAllergenCatalog(catalog, "鶏肉", aliases).map((row) => row.id)).toEqual([
      "chicken",
    ]);
    expect(filterAllergenCatalog(catalog, "チキン", aliases).map((row) => row.id)).toEqual([
      "chicken",
    ]);
    expect(filterAllergenCatalog(catalog, "とり", aliases).map((row) => row.id)).toEqual([
      "chicken",
    ]);
    expect(filterAllergenCatalog(catalog, "ビーフ", aliases).map((row) => row.id)).toEqual([
      "beef",
    ]);
  });

  it("keeps suffix alias matches when the query is not a display_name prefix (H1)", () => {
    // 「麦」は 小麦 の接頭辞ではないので、蕎麦 alias の部分一致は落とさない
    const hits = filterAllergenCatalog(catalog, "麦", aliases).map((row) => row.id);
    expect(hits).toContain("wheat");
    expect(hits).toContain("buckwheat");
  });
});
