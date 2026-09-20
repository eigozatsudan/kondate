/**
 * 再生成時の「実質同一」判定と決定論的シグネチャ。
 * 正規化は NFKC・ja-JP lower・空白/句読点除去のみ。意味的な同義語辞書は持たない。
 */

export type DishSignatureInput = {
  role: string;
  name: string;
  primaryIngredients: readonly string[];
};

export type MenuSignatureInput = { dishes: readonly DishSignatureInput[] };

const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/[\s・、。()（）]/g, "");

export function normalizeDishSignature(dish: DishSignatureInput): {
  role: string;
  name: string;
  ingredients: ReadonlySet<string>;
} {
  return {
    role: dish.role,
    name: normalize(dish.name),
    ingredients: new Set(dish.primaryIngredients.map(normalize)),
  };
}

export function createDishSignature(dish: DishSignatureInput): string {
  const normalized = normalizeDishSignature(dish);
  return JSON.stringify([normalized.role, normalized.name, [...normalized.ingredients].toSorted()]);
}

export function createMenuSignature(menu: MenuSignatureInput): string {
  return JSON.stringify(menu.dishes.map(createDishSignature).toSorted());
}

export function isMateriallySameDish(left: DishSignatureInput, right: DishSignatureInput): boolean {
  const a = normalizeDishSignature(left);
  const b = normalizeDishSignature(right);
  if (a.role !== b.role) return false;
  if (a.name === b.name) return true;
  const intersection = [...a.ingredients].filter((item) => b.ingredients.has(item)).length;
  const union = new Set([...a.ingredients, ...b.ingredients]).size;
  return union > 0 && intersection / union >= 0.8;
}

export function isMateriallySameMenu(left: MenuSignatureInput, right: MenuSignatureInput): boolean {
  if (left.dishes.length !== right.dishes.length) return false;
  // 同一 role が複数あるとき貪欲マッチは誤判定し得る（先に取った候補が別のペアの
  // 唯一の相手を食い潰す）。完全な 1 対 1 対応が存在するかを Kuhn の
  // augmenting path（二部マッチング）で判定する。
  const candidates = left.dishes.map((dish) =>
    right.dishes
      .map((candidate, index) => ({ candidate, index }))
      .filter(
        ({ candidate }) => candidate.role === dish.role && isMateriallySameDish(dish, candidate),
      )
      .map(({ index }) => index),
  );
  const assignedTo = new Array<number>(right.dishes.length).fill(-1);
  // 自己再帰するため、循環推論を避ける目的で関数型を明示する
  const tryAssign: (leftIndex: number, seen: Set<number>) => boolean = (leftIndex, seen) => {
    for (const rightIndex of candidates[leftIndex] ?? []) {
      if (seen.has(rightIndex)) continue;
      seen.add(rightIndex);
      const previous = assignedTo[rightIndex] ?? -1;
      if (previous === -1 || tryAssign(previous, seen)) {
        assignedTo[rightIndex] = leftIndex;
        return true;
      }
    }
    return false;
  };
  for (let leftIndex = 0; leftIndex < left.dishes.length; leftIndex += 1) {
    if (!tryAssign(leftIndex, new Set())) return false;
  }
  return true;
}
