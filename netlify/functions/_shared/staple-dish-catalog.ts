/**
 * メイン食材 → その食材で真っ先に思いつく定番料理名。
 * ひねり軸（noveltyPreference=twist）のプロンプト除外リスト専用。
 * Functions 専用に閉じる（ブラウザからは参照しない）。
 * 安全評価・検証・fingerprint の入力にはしない。
 */
import { normalizeFoodText } from "../../../shared/safety-pure/normalize-food-text.js";

export type StapleDishEntry = {
  readonly ingredientAliases: readonly string[];
  readonly stapleDishes: readonly string[];
};

/**
 * normalizeFoodText が畳むのは NFKC・カタカナ→ひらがな・小文字化・区切り除去だけで、
 * 漢字とかなは畳まない（ブタ = ぶた だが 豚肉 ≠ ぶた肉）。
 * したがって漢字・かな・カタカナの揺れは alias に列挙して吸収する。正規化に期待しない。
 */
export const STAPLE_DISH_CATALOG: readonly StapleDishEntry[] = [
  {
    ingredientAliases: ["豚肉", "ぶた肉", "ぶたにく", "豚", "ぶた", "豚こま", "豚バラ"],
    stapleDishes: ["豚の生姜焼き", "豚汁", "とんかつ", "回鍋肉", "豚キムチ"],
  },
  {
    ingredientAliases: ["鶏肉", "とり肉", "とりにく", "鶏", "とり", "鶏むね肉", "鶏もも肉"],
    stapleDishes: ["から揚げ", "鶏の照り焼き", "親子丼", "筑前煮", "チキン南蛮"],
  },
  {
    ingredientAliases: ["牛肉", "ぎゅう肉", "ぎゅうにく", "牛", "うし", "牛こま"],
    stapleDishes: ["肉じゃが", "牛丼", "青椒肉絲", "すき焼き"],
  },
  {
    ingredientAliases: ["ひき肉", "挽き肉", "ひきにく", "合いびき肉", "あいびき肉"],
    stapleDishes: ["ハンバーグ", "麻婆豆腐", "そぼろ丼", "餃子", "ミートソース"],
  },
  {
    ingredientAliases: ["鮭", "さけ", "しゃけ", "サーモン"],
    stapleDishes: ["鮭の塩焼き", "鮭のムニエル", "鮭のホイル焼き"],
  },
  {
    ingredientAliases: ["鯖", "さば"],
    stapleDishes: ["鯖の味噌煮", "鯖の塩焼き"],
  },
  {
    ingredientAliases: ["卵", "たまご", "玉子"],
    stapleDishes: ["卵焼き", "オムライス", "親子丼", "茶碗蒸し"],
  },
  {
    ingredientAliases: ["豆腐", "とうふ"],
    stapleDishes: ["麻婆豆腐", "冷奴", "湯豆腐", "豆腐の味噌汁"],
  },
  {
    ingredientAliases: ["なす", "ナス", "茄子"],
    stapleDishes: ["麻婆茄子", "なすの味噌炒め", "焼きなす"],
  },
  {
    ingredientAliases: ["キャベツ", "きゃべつ"],
    stapleDishes: ["回鍋肉", "野菜炒め", "コールスロー", "お好み焼き"],
  },
  {
    ingredientAliases: ["じゃがいも", "ジャガイモ", "馬鈴薯"],
    stapleDishes: ["肉じゃが", "ポテトサラダ", "粉ふきいも"],
  },
  {
    ingredientAliases: ["大根", "だいこん"],
    stapleDishes: ["ぶり大根", "おでん", "大根の煮物", "大根サラダ"],
  },
  {
    ingredientAliases: ["白菜", "はくさい"],
    stapleDishes: ["白菜と豚肉の重ね煮", "白菜の浅漬け", "八宝菜"],
  },
  {
    ingredientAliases: ["玉ねぎ", "たまねぎ", "タマネギ", "玉葱"],
    stapleDishes: ["オニオンスープ", "肉じゃが", "カレー"],
  },
  {
    ingredientAliases: ["にんじん", "ニンジン", "人参"],
    stapleDishes: ["きんぴら", "にんじんしりしり", "筑前煮"],
  },
  {
    ingredientAliases: ["ほうれん草", "ほうれんそう", "ホウレンソウ"],
    stapleDishes: ["ほうれん草のおひたし", "ほうれん草のごま和え", "ほうれん草のバター炒め"],
  },
  {
    ingredientAliases: ["ぶり", "ブリ", "鰤"],
    stapleDishes: ["ぶり大根", "ぶりの照り焼き"],
  },
  {
    ingredientAliases: ["えび", "エビ", "海老"],
    stapleDishes: ["エビフライ", "エビチリ", "エビマヨ"],
  },
  {
    ingredientAliases: ["いか", "イカ", "烏賊"],
    stapleDishes: ["イカと大根の煮物", "イカリング"],
  },
  {
    ingredientAliases: [
      "きのこ",
      "キノコ",
      "しめじ",
      "シメジ",
      "まいたけ",
      "マイタケ",
      "えのき",
      "エノキ",
    ],
    stapleDishes: ["きのこのバター炒め", "きのこのホイル焼き", "きのこの味噌汁"],
  },
  {
    ingredientAliases: ["ちくわ", "チクワ", "竹輪"],
    stapleDishes: ["ちくわの磯辺揚げ", "ちくわのきゅうり詰め"],
  },
  {
    ingredientAliases: ["厚揚げ", "あつあげ"],
    stapleDishes: ["厚揚げの煮物", "厚揚げの焼き浸し"],
  },
];

const normalizedCatalog: readonly {
  readonly aliases: ReadonlySet<string>;
  readonly dishes: readonly string[];
}[] = STAPLE_DISH_CATALOG.map((entry) => ({
  aliases: new Set(entry.ingredientAliases.map(normalizeFoodText)),
  dishes: entry.stapleDishes,
}));

/**
 * メイン食材に対応する定番料理名を返す。正規化後の完全一致のみ。
 * 未収録の食材はヒット 0 件。辞書の欠落は生成失敗にしない（fail-open）。
 */
export function lookupStapleDishes(
  mainIngredients: readonly string[],
  max: number,
): readonly string[] {
  if (max <= 0) return [];
  const dishes: string[] = [];
  const seen = new Set<string>();
  for (const ingredient of mainIngredients) {
    const normalized = normalizeFoodText(ingredient);
    if (normalized === "") continue;
    for (const entry of normalizedCatalog) {
      if (!entry.aliases.has(normalized)) continue;
      for (const dish of entry.dishes) {
        if (seen.has(dish)) continue;
        seen.add(dish);
        dishes.push(dish);
        if (dishes.length >= max) return dishes;
      }
    }
  }
  return dishes;
}
