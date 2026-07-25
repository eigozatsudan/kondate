/**
 * メイン食材の正規化と canonical 比較。
 * 自由入力・冷蔵庫候補・（Task 2 以降の）クイック選択チップが同じ規則で
 * 追加・重複判定・解除できるように共通化する。部分一致や同義語変換は行わない。
 */

/** NFKC + trim。長さ上限は UI / 契約側が Array.from で判定する。 */
export function normalizeMainIngredient(value: string): string {
  return value.normalize("NFKC").trim();
}

/** 正規化後の完全一致で候補が既に含まれているか判定する。 */
export function includesCanonicalMainIngredient(
  values: readonly string[],
  candidate: string,
): boolean {
  const normalizedCandidate = normalizeMainIngredient(candidate);
  return values.some((value) => normalizeMainIngredient(value) === normalizedCandidate);
}

/**
 * 正規化後に候補と一致する要素をすべて除いた新しい配列を返す。
 * 元配列は mutate しない。
 */
export function excludeCanonicalMainIngredient(
  values: readonly string[],
  candidate: string,
): string[] {
  const normalizedCandidate = normalizeMainIngredient(candidate);
  return values.filter((value) => normalizeMainIngredient(value) !== normalizedCandidate);
}
