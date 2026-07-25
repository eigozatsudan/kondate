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
  // 同一 role が複数あるとき、最初の候補だけに全部マッチさせない（1 対 1 で消費する）。
  const remaining = right.dishes.map((dish, index) => ({ dish, index }));
  for (const dish of left.dishes) {
    const matchAt = remaining.findIndex(
      (candidate) =>
        candidate.dish.role === dish.role && isMateriallySameDish(dish, candidate.dish),
    );
    if (matchAt === -1) return false;
    remaining.splice(matchAt, 1);
  }
  return true;
}
