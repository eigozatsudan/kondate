import { formatQuantityValue, normalizeUnit, roundQuantityValue } from "./normalize.js";

export type IngredientQuantityFields = {
  quantityValue: number | null;
  quantityText: string;
  unit: string | null;
};

/** strict で string を受けられるよう includes（Set<"少々"|...> は typecheck で落ちる） */
const QUALITATIVE_WORDS = ["少々", "適量", "ひとつまみ", "適宜"] as const;

function isQualitativeWord(value: string): boolean {
  return (QUALITATIVE_WORDS as readonly string[]).includes(value);
}

const TBSP_ML = 15;
const TSP_ML = 5;
const SPOON_THRESHOLD = 3;

/** 定性語のみ（前後に任意の数可）。部分一致はしない。 */
const QUALITATIVE_TEXT =
  /^(?:(\d+(?:\.\d+)?)\s*)?(少々|適量|ひとつまみ|適宜)(?:\s*(\d+(?:\.\d+)?))?$/u;

/** N大さじ / 大さじN（大匙・小さじ・小匙含む） */
const SPOON_TEXT =
  /^(?:(\d+(?:\.\d+)?)\s*(大さじ|大匙|小さじ|小匙)|(大さじ|大匙|小さじ|小匙)\s*(\d+(?:\.\d+)?))$/u;

function spoonFactor(canonicalUnit: string): number | null {
  if (canonicalUnit === "大さじ") return TBSP_ML;
  if (canonicalUnit === "小さじ") return TSP_ML;
  return null;
}

function toMlTriple(value: number, factor: number): IngredientQuantityFields {
  const ml = roundQuantityValue(value * factor);
  return {
    quantityValue: ml,
    unit: "ml",
    quantityText: `${formatQuantityValue(ml)}ml`,
  };
}

function tryQualitative(input: IngredientQuantityFields): IngredientQuantityFields | null {
  const unitCanon = normalizeUnit(input.unit);
  if (unitCanon !== null && isQualitativeWord(unitCanon)) {
    return { quantityValue: null, unit: null, quantityText: unitCanon };
  }
  const text = input.quantityText.normalize("NFKC").trim();
  const m = QUALITATIVE_TEXT.exec(text);
  // グループ2は定性語本体（正規表現がマッチすれば必ず存在）
  const word = m?.[2];
  if (word !== undefined) {
    return { quantityValue: null, unit: null, quantityText: word };
  }
  return null;
}

function trySpoonFromValueUnit(input: IngredientQuantityFields): IngredientQuantityFields | null {
  if (input.quantityValue === null) return null;
  if (!Number.isFinite(input.quantityValue) || input.quantityValue <= 0) return null;
  const unitCanon = normalizeUnit(input.unit);
  if (unitCanon === null) return null;
  const factor = spoonFactor(unitCanon);
  if (factor === null) return null;
  const rounded = roundQuantityValue(input.quantityValue);
  if (rounded <= SPOON_THRESHOLD) {
    // 閾値以下は仕様どおり無変換
    return null;
  }
  return toMlTriple(rounded, factor);
}

/**
 * P2: unit が null のとき text をパース（設計 §4.6）。
 * quantityValue が有限正なら数値は value 優先。unit が g 等なら触らない。
 */
function trySpoonFromText(input: IngredientQuantityFields): IngredientQuantityFields | null {
  const unitCanon = normalizeUnit(input.unit);
  if (unitCanon !== null) return null;
  const text = input.quantityText.normalize("NFKC").trim();
  const m = SPOON_TEXT.exec(text);
  if (m === null) return null;
  const rawValue = m[1] ?? m[4];
  const rawUnit = m[2] ?? m[3];
  if (rawValue === undefined || rawUnit === undefined) return null;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const spoonCanon = normalizeUnit(rawUnit);
  if (spoonCanon === null) return null;
  const factor = spoonFactor(spoonCanon);
  if (factor === null) return null;
  const numeric =
    input.quantityValue !== null && Number.isFinite(input.quantityValue) && input.quantityValue > 0
      ? input.quantityValue
      : parsed;
  const rounded = roundQuantityValue(numeric);
  if (rounded <= SPOON_THRESHOLD) return null;
  return toMlTriple(rounded, factor);
}

/**
 * 買い足し材料の分量 triple を読みやすくする。
 * pantry 連動行には呼ばないこと（呼び出し側で pantryRef を除外）。
 */
export function normalizeIngredientQuantity(
  input: IngredientQuantityFields,
): IngredientQuantityFields {
  const qualitative = tryQualitative(input);
  if (qualitative !== null) return qualitative;

  const fromValue = trySpoonFromValueUnit(input);
  if (fromValue !== null) return fromValue;

  const fromText = trySpoonFromText(input);
  if (fromText !== null) return fromText;

  return input;
}
