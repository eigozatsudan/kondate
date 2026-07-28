export function normalizeIngredientName(
  name: string,
  aliases: ReadonlyMap<string, string>,
): string {
  const compact = name.normalize("NFKC").trim().replace(/\s+/gu, "");
  return aliases.get(compact) ?? compact;
}

/** 単位の全角/半角ゆれを揃え、合算・パントリー照合で同じ単位として扱う（D-I3）。 */
export function normalizeUnit(unit: string | null): string | null {
  if (unit === null) return null;
  const compact = unit.normalize("NFKC").trim();
  return compact === "" ? null : compact;
}

/**
 * 数量を DB numeric(12,3) 相当へ丸める。
 * 合算・差分比較の双方で同じ値を使い、0.1+0.2 の浮動小数ノイズを消す（SP-I2）。
 */
export function roundQuantityValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * 数量テキスト用の安定した小数表現。
 * 0.1+0.2 のような浮動小数ノイズを numeric(12,3) 相当で丸め、末尾の 0 を落とす（D-I1）。
 */
export function formatQuantityValue(value: number): string {
  const rounded = roundQuantityValue(value);
  if (rounded === 0) return "0";
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

/** 数量の厳密一致比較（丸め後）。diff / round-trip で使う。 */
export function quantityValuesEqual(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right;
  return roundQuantityValue(left) === roundQuantityValue(right);
}
