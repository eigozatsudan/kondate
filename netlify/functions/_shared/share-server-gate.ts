/**
 * 共有一般化後のサーバー関門（fail-closed・AI なし）。
 * Zod（validated menu）+ 材料グラフ不変 + denylist（ingredient.name 含む全テキスト）。
 * 不合格は server_gate_failed のみ（自由文・PII を返さない）。
 */

import {
  textHitsShareDenylist,
  textsHitClosedShareDenylistPhrases,
} from "../../../shared/contracts/share-denylist.v1.js";
import { validatedMenuSchema, type ValidatedMenu } from "../../../shared/contracts/generation.js";
import type { ShareFailureCode } from "../../../shared/contracts/share-job.js";
import { collectMenuTextSources } from "../../../shared/safety/allergens.js";

/** 関門が比較する材料グラフのロック形（数値・単位・構成。name / quantityText はロックしない） */
export type ShareIngredientGraphLock = {
  readonly dishes: readonly {
    readonly id: string;
    readonly role: ValidatedMenu["dishes"][number]["role"];
    readonly position: number;
    readonly ingredients: readonly {
      readonly id: string;
      readonly position: number;
      readonly quantityValue: number | null;
      readonly unit: string | null;
      readonly storeSection: ValidatedMenu["dishes"][number]["ingredients"][number]["storeSection"];
    }[];
  }[];
};

export type ShareServerGateResult = { ok: true } | { ok: false; code: ShareFailureCode };

/**
 * Pass 前（または canonical 直後）のメニューからグラフロックを切り出す。
 * name / quantityText は含めない（一般化対象。数値・単位・構成のみ不変）。
 */
export function captureShareIngredientGraphLock(menu: ValidatedMenu): ShareIngredientGraphLock {
  return {
    dishes: menu.dishes.map((dish) => ({
      id: dish.id,
      role: dish.role,
      position: dish.position,
      ingredients: dish.ingredients.map((ingredient) => ({
        id: ingredient.id,
        position: ingredient.position,
        quantityValue: ingredient.quantityValue,
        unit: ingredient.unit,
        storeSection: ingredient.storeSection,
      })),
    })),
  };
}

function graphsMatch(menu: ValidatedMenu, locked: ShareIngredientGraphLock): boolean {
  if (menu.dishes.length !== locked.dishes.length) return false;

  for (let dishIndex = 0; dishIndex < locked.dishes.length; dishIndex += 1) {
    const lockedDish = locked.dishes[dishIndex];
    const menuDish = menu.dishes[dishIndex];
    if (lockedDish === undefined || menuDish === undefined) return false;
    if (
      menuDish.id !== lockedDish.id ||
      menuDish.role !== lockedDish.role ||
      menuDish.position !== lockedDish.position
    ) {
      return false;
    }
    if (menuDish.ingredients.length !== lockedDish.ingredients.length) return false;

    for (
      let ingredientIndex = 0;
      ingredientIndex < lockedDish.ingredients.length;
      ingredientIndex += 1
    ) {
      const lockedIngredient = lockedDish.ingredients[ingredientIndex];
      const menuIngredient = menuDish.ingredients[ingredientIndex];
      if (lockedIngredient === undefined || menuIngredient === undefined) return false;
      if (
        menuIngredient.id !== lockedIngredient.id ||
        menuIngredient.position !== lockedIngredient.position ||
        menuIngredient.quantityValue !== lockedIngredient.quantityValue ||
        menuIngredient.unit !== lockedIngredient.unit ||
        menuIngredient.storeSection !== lockedIngredient.storeSection
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * メニュー全文（ingredient.name / 手順 / adaptation 等）が denylist に触れるか。
 * Pass 前 precheck と Pass 後 gate の双方で使う（自由文は返さない）。
 */
export function menuHitsShareDenylist(menu: ValidatedMenu): boolean {
  // collectMenuTextSources は ingredient.name / quantityText / 手順 / adaptation 等を網羅
  const texts = collectMenuTextSources(menu).map((source) => source.text);
  for (const text of texts) {
    if (textHitsShareDenylist(text)) return true;
  }
  // AP11: フィールド分割（dish.name=太 + ingredient.name=郎の）を閉じた針で拾う。
  // 全文 haystack と任意 2 フィールド join。オープン NER にはしない。
  if (textHitsShareDenylist(texts.join(""))) return true;
  for (let i = 0; i < texts.length; i += 1) {
    for (let j = i + 1; j < texts.length; j += 1) {
      const left = texts[i];
      const right = texts[j];
      if (left === undefined || right === undefined) continue;
      if (textHitsShareDenylist(`${left}${right}`)) return true;
    }
  }
  // AP-R3: 3 片以上 + 間テキストでも閉じた針を見る（正規表現針は増やさない）
  if (textsHitClosedShareDenylistPhrases(texts)) return true;
  return false;
}

/**
 * サーバー関門。Zod 不正・グラフ変異・denylist ヒットはすべて server_gate_failed。
 * lockedGraph は Pass 前後で数量の数値・単位が戻っていることの証拠。
 */
export function runShareServerGate(
  menu: unknown,
  lockedGraph: ShareIngredientGraphLock,
): ShareServerGateResult {
  const parsed = validatedMenuSchema.safeParse(menu);
  if (!parsed.success) {
    return { ok: false, code: "server_gate_failed" };
  }

  if (!graphsMatch(parsed.data, lockedGraph)) {
    return { ok: false, code: "server_gate_failed" };
  }

  if (menuHitsShareDenylist(parsed.data)) {
    return { ok: false, code: "server_gate_failed" };
  }

  return { ok: true };
}
