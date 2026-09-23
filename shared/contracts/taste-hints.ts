import { z } from "zod";
import { dishRoles } from "./generation.js";

/** 学習の強さ。窓内の derivation_group_id の個数から決まる */
export const tasteSignalStrengths = ["weak", "medium", "strong"] as const;
export type TasteSignalStrength = (typeof tasteSignalStrengths)[number];

/**
 * 所要時間帯。加重平均は小数になるため、境界は <=20 / <=40 / それ以外で連続させる
 * （21-40 と刻むと 20.5 分がどの帯にも入らない）。
 */
export const tasteTimeBands = ["short", "standard", "slow"] as const;

/** 恒常シグナルとして読めるのは child_friendly だけ（設計 §4.3） */
export const tasteAvoidAxes = ["child_unfriendly"] as const;

/** 集計窓と減衰。SQL 側はリテラルで持ち、境界の同値性は pgTAP が担保する */
export const TASTE_WINDOW_DAYS = 90 as const;
export const TASTE_WINDOW_MENUS = 50 as const;
export const TASTE_HALF_LIFE_DAYS = 30 as const;
export const TASTE_FAVORITE_WEIGHT = 1.0 as const;
export const TASTE_SELECTED_WEIGHT = 0.3 as const;

/** 強さの境界（窓内の derivation_group_id の個数） */
export const TASTE_STRENGTH_MEDIUM_MIN = 5 as const;
export const TASTE_STRENGTH_STRONG_MIN = 15 as const;

/** 最低出現回数。1 回だけの食材を「好き」「使いすぎ」と言わない */
export const TASTE_LIKED_INGREDIENT_MIN_COUNT = 2 as const;
export const TASTE_OVERUSED_INGREDIENT_MIN_COUNT = 3 as const;
export const TASTE_AVOID_AXIS_MIN_COUNT = 2 as const;

/** ジャンルを出す最低比率。和洋中 3 値のうち 2 つが常に入るのを防ぐ */
export const TASTE_GENRE_MIN_SHARE = 0.35 as const;

/** prompt 肥大を防ぐ各上限 */
export const TASTE_LIKED_DISHES_MAX = 12 as const;
/**
 * 集計関数（get_taste_signals）が返す likedDishes の上限。prompt へ出す 12 件より広く取り、
 * Function 側が最近の料理を落とした後に TASTE_LIKED_DISHES_MAX へ切る。SQL 側はリテラル 24 を持ち、
 * 境界は pgTAP が担保する。上位が最近の料理で埋まっても学習が空にならないようにする。
 */
export const TASTE_LIKED_DISHES_QUERY_MAX = 24 as const;
export const TASTE_LIKED_GENRES_MAX = 2 as const;
export const TASTE_LIKED_INGREDIENTS_MAX = 8 as const;
export const TASTE_OVERUSED_INGREDIENTS_MAX = 3 as const;

/** dishes.name / dish_ingredients.name の CHECK と同じ上限（char_length(btrim(name)) <= 100） */
const TASTE_FOOD_NAME_MAX = 100;

/**
 * DB が返し得る名前はすべて通す。長さは DB と planner に揃えて code point で数え、
 * 前後は btrim の既定と同じ半角スペースだけを削る。UTF-16 で数えると絵文字の多い
 * 1 語で parse 全体が invalid_shape になり、その利用者の学習が窓を抜けるまで止まる。
 * 改行・制御文字はここでは拒否しない（全体を落とさず sanitize で語ごとに捨てる）。
 */
const foodNameSchema = z.string().refine((value) => {
  const length = Array.from(value.replace(/^ +| +$/g, "")).length;
  return length >= 1 && length <= TASTE_FOOD_NAME_MAX;
});

/** prompt と preference_snapshot に出る形。対応表は含まない */
export const tasteHintsSchema = z
  .object({
    likedDishes: z
      .array(z.object({ dishName: foodNameSchema, role: z.enum(dishRoles).optional() }))
      .max(TASTE_LIKED_DISHES_MAX),
    likedGenres: z.array(z.enum(["japanese", "western", "chinese"])).max(TASTE_LIKED_GENRES_MAX),
    likedIngredients: z.array(foodNameSchema).max(TASTE_LIKED_INGREDIENTS_MAX),
    likedTimeBand: z.enum(tasteTimeBands).nullable(),
    overusedIngredients: z.array(foodNameSchema).max(TASTE_OVERUSED_INGREDIENTS_MAX),
    avoidAxes: z.array(z.enum(tasteAvoidAxes)).max(1),
    signalStrength: z.enum(tasteSignalStrengths),
  })
  .strict();

export type TasteHints = z.infer<typeof tasteHintsSchema>;

/**
 * 集計関数の戻り。dishIngredientIndex は落とした料理の食材を消すための対応表で、
 * prompt にも preference_snapshot にもログにも出さない（sanitize で捨てる）。
 *
 * 対応表には上限を掛けない。prompt へ出ないので肥大を防ぐ理由が無く、切ると差集合が
 * 両方向に壊れる: likedDishes の上限（TASTE_LIKED_DISHES_QUERY_MAX = 24 件）より下位の
 * お気に入りがあると、残した料理の食材が表から漏れて誤って消え、
 * 落とした料理の食材も表から漏れて likedIngredients に残る。
 * 窓（90 日・50 献立）が実質の上限になる。
 */
export const tasteSignalsSchema = z
  .object({
    ...tasteHintsSchema.shape,
    // 最近の料理を落とす前の候補なので prompt の上限より広い。切り詰めは sanitize が行う
    likedDishes: z
      .array(tasteHintsSchema.shape.likedDishes.element)
      .max(TASTE_LIKED_DISHES_QUERY_MAX),
    dishIngredientIndex: z.array(
      z.object({ dishName: foodNameSchema, ingredients: z.array(foodNameSchema) }),
    ),
  })
  .strict();

export type TasteSignals = z.infer<typeof tasteSignalsSchema>;

/**
 * 中身が空なら prompt にも記録にも出さない。
 * signalStrength は「中身」ではないので、それだけでは載せない。
 */
export function hasTasteContent(hints: TasteHints): boolean {
  return (
    hints.likedDishes.length > 0 ||
    hints.likedGenres.length > 0 ||
    hints.likedIngredients.length > 0 ||
    hints.overusedIngredients.length > 0 ||
    hints.avoidAxes.length > 0 ||
    hints.likedTimeBand !== null
  );
}

/** preference_snapshot へ記録する形。ブラウザはこれだけを読む */
export const tasteHintsRecordSchema = z
  .object({ applied: z.literal(true), strength: z.enum(tasteSignalStrengths) })
  .strict();

export type TasteHintsRecord = z.infer<typeof tasteHintsRecordSchema>;
