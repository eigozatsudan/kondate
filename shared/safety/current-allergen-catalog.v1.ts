export const currentAllergenCatalogVersion = "jp-caa-2026-04.v1" as const;

export type CurrentAllergenCatalogEntry = {
  readonly id: string;
  readonly displayName: string;
  readonly regulatoryClass: "mandatory" | "recommended";
  readonly catalogVersion: typeof currentAllergenCatalogVersion;
};

const catalogEntry = (
  id: string,
  displayName: string,
  regulatoryClass: CurrentAllergenCatalogEntry["regulatoryClass"],
): CurrentAllergenCatalogEntry =>
  Object.freeze({
    id,
    displayName,
    regulatoryClass,
    catalogVersion: currentAllergenCatalogVersion,
  });

// 同一バージョン内で表示名を含む意味を固定し、DB・警告表示・判定境界のドリフトを防ぐ。
export const currentAllergenCatalogV1: readonly CurrentAllergenCatalogEntry[] = Object.freeze([
  catalogEntry("shrimp", "えび", "mandatory"),
  catalogEntry("cashew_nut", "カシューナッツ", "mandatory"),
  catalogEntry("crab", "かに", "mandatory"),
  catalogEntry("walnut", "くるみ", "mandatory"),
  catalogEntry("wheat", "小麦", "mandatory"),
  catalogEntry("buckwheat", "そば", "mandatory"),
  catalogEntry("egg", "卵", "mandatory"),
  catalogEntry("milk", "乳", "mandatory"),
  catalogEntry("peanut", "落花生（ピーナッツ）", "mandatory"),
  catalogEntry("almond", "アーモンド", "recommended"),
  catalogEntry("abalone", "あわび", "recommended"),
  catalogEntry("squid", "いか", "recommended"),
  catalogEntry("salmon_roe", "いくら", "recommended"),
  catalogEntry("orange", "オレンジ", "recommended"),
  catalogEntry("kiwi", "キウイフルーツ", "recommended"),
  catalogEntry("beef", "牛肉", "recommended"),
  catalogEntry("sesame", "ごま", "recommended"),
  catalogEntry("salmon", "さけ", "recommended"),
  catalogEntry("mackerel", "さば", "recommended"),
  catalogEntry("soy", "大豆", "recommended"),
  catalogEntry("chicken", "鶏肉", "recommended"),
  catalogEntry("banana", "バナナ", "recommended"),
  catalogEntry("pistachio", "ピスタチオ", "recommended"),
  catalogEntry("pork", "豚肉", "recommended"),
  catalogEntry("macadamia_nut", "マカダミアナッツ", "recommended"),
  catalogEntry("peach", "もも", "recommended"),
  catalogEntry("yam", "やまいも", "recommended"),
  catalogEntry("apple", "りんご", "recommended"),
  catalogEntry("gelatin", "ゼラチン", "recommended"),
]);
