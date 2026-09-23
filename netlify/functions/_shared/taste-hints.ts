/**
 * 好みの学習ヒント（tasteHints）。fail-open・prompt 専用。
 * fingerprint / quota / 検証には載せない。diversity-hints.ts と同型。
 */
import {
  hasTasteContent,
  tasteSignalsSchema,
  TASTE_LIKED_DISHES_MAX,
  TASTE_LIKED_GENRES_MAX,
  TASTE_LIKED_INGREDIENTS_MAX,
  TASTE_OVERUSED_INGREDIENTS_MAX,
  type TasteHints,
  type TasteSignals,
} from "../../../shared/contracts/taste-hints.js";
import { foodTextContainsAlias } from "../../../shared/safety/allergens.js";
import { normalizeFoodText } from "../../../shared/safety-pure/normalize-food-text.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";
import type { RecentDishHint } from "./diversity-hints.js";

export const TASTE_HINTS_ENABLED = true as const;
export const TASTE_SYSTEM_MARKER = "【学習】" as const;
export const TASTE_HINTS_TIMEOUT_MS = 200 as const;

export type TasteHintsOutcome =
  | "disabled_flag"
  | "disabled_user"
  | "no_history"
  | "timeout"
  | "query_failed"
  | "invalid_shape"
  | "filtered_empty"
  | "applied";

export type TasteHintsLoadResult = {
  signals: TasteSignals | null;
  outcome: TasteHintsOutcome;
};

/** `true as const` を三項へ直接置くと lint が死枝扱いするため boolean 引数で広げる */
export function isTasteHintsEnabled(flag: boolean): boolean {
  return flag;
}

type OwnerClientForTaste = {
  rpc: (
    name: "get_taste_signals",
    args: Record<string, never>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

function isOwnerClientForTaste(client: unknown): client is OwnerClientForTaste {
  if (typeof client !== "object" || client === null || !("rpc" in client)) return false;
  return typeof client.rpc === "function";
}

function readReason(data: unknown): string | null | undefined {
  if (typeof data !== "object" || data === null || !("reason" in data)) return undefined;
  const reason = data.reason;
  if (reason === null) return null;
  return typeof reason === "string" ? reason : undefined;
}

/**
 * reason だけを剥がした残りを渡す。値の narrowing は safeParse に任せる。
 * `data as Record<string, unknown>` のような unchecked cast を避けるため
 * Object.entries(object) の組み込みオーバーロードだけで組み立てる。
 */
function omitReason(data: object): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "reason") continue;
    rest[key] = value;
  }
  return rest;
}

async function querySignals(client: OwnerClientForTaste): Promise<TasteHintsLoadResult> {
  const { data, error } = await client.rpc("get_taste_signals", {});
  if (error !== null) return { signals: null, outcome: "query_failed" };

  // reason は safeParse より先に見る。理由オブジェクトを schema に通すと
  // disabled / no_history が invalid_shape へ潰れる。
  const reason = readReason(data);
  if (reason === "disabled") return { signals: null, outcome: "disabled_user" };
  if (reason === "no_history") return { signals: null, outcome: "no_history" };
  if (reason !== null) return { signals: null, outcome: "invalid_shape" };
  if (typeof data !== "object" || data === null) return { signals: null, outcome: "invalid_shape" };

  const rest = omitReason(data);
  const parsed = tasteSignalsSchema.safeParse(rest);
  if (!parsed.success) return { signals: null, outcome: "invalid_shape" };
  return { signals: parsed.data, outcome: "applied" };
}

/**
 * 集計ヒントを owner 境界で読む。
 * 失敗・タイムアウト・0 件はすべて signals: null。決して throw しない。
 */
export async function loadTasteHints(input: {
  ownerClient: unknown;
  timeoutMs?: number;
}): Promise<TasteHintsLoadResult> {
  try {
    if (!isOwnerClientForTaste(input.ownerClient)) {
      return { signals: null, outcome: "query_failed" };
    }
    const timeoutMs = input.timeoutMs ?? TASTE_HINTS_TIMEOUT_MS;
    const ownerClient = input.ownerClient;
    const queryPromise = querySignals(ownerClient).catch((): TasteHintsLoadResult => ({
      signals: null,
      outcome: "query_failed",
    }));

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeoutId = setTimeout(() => {
        resolve("timeout");
      }, timeoutMs);
    });

    const raced = await Promise.race([
      queryPromise.then((result) => ({ kind: "ok" as const, result })),
      timeoutPromise.then(() => ({ kind: "timeout" as const })),
    ]);

    if (timeoutId !== undefined) clearTimeout(timeoutId);

    if (raced.kind === "timeout") {
      // 遅延 resolve した結果は採用しない（race 勝者のみ）。未処理 reject を避ける
      void queryPromise.catch(() => {
        /* ignore late failure */
      });
      return { signals: null, outcome: "timeout" };
    }
    return raced.result;
  } catch {
    return { signals: null, outcome: "query_failed" };
  }
}

/** 現行制約の語を集める。household は安全文脈も見る */
function collectBlockedTerms(context: GenerationContext): readonly string[] {
  const terms: string[] = [...context.submission.avoidIngredients];
  for (const preference of context.memberPreferences) {
    terms.push(...preference.dislikes);
  }
  if (context.targetMode === "household") {
    const allergenIds = new Set<string>();
    for (const member of context.safety.members) {
      for (const custom of member.customAllergies) {
        terms.push(custom.name, ...custom.aliases);
      }
      for (const allergenId of member.allergenIds) {
        allergenIds.add(allergenId);
      }
    }
    // AllergenDictionary は id キーの辞書ではなく { version, catalog, aliases } なので
    // aliases を allergenId で絞り込む
    for (const alias of context.safety.allergenDictionary.aliases) {
      if (allergenIds.has(alias.allergenId)) {
        terms.push(alias.alias);
      }
    }
  }
  return terms.filter((term) => normalizeFoodText(term) !== "");
}

function hitsBlocked(text: string, blocked: readonly string[]): boolean {
  return blocked.some((term) => foodTextContainsAlias(text, term));
}

/**
 * 過去の好みを現在の制約へ持ち込まないための prompt 衛生。
 * これは安全ゲートではない（実判定は validate-generated-menu と生成ハードゲート）。
 * あわせて idea の avoidAxes を空にする。集計関数はモードを知らないため、
 * generationContext が揃うこの位置が最初の適用点になる。
 */
export function filterTasteHintsForSafety(
  signals: TasteSignals,
  context: GenerationContext,
): TasteSignals {
  const blocked = collectBlockedTerms(context);
  return {
    ...signals,
    likedDishes: signals.likedDishes.filter((dish) => !hitsBlocked(dish.dishName, blocked)),
    likedIngredients: signals.likedIngredients.filter((name) => !hitsBlocked(name, blocked)),
    dishIngredientIndex: signals.dishIngredientIndex.map((entry) => ({
      dishName: entry.dishName,
      ingredients: entry.ingredients.filter((name) => !hitsBlocked(name, blocked)),
    })),
    avoidAxes: context.targetMode === "idea" ? [] : signals.avoidAxes,
  };
}

/**
 * 制御文字・行区切り（U+2028）・段落区切り（U+2029）を含む語かどうか。
 * Task 1 敵対的レビュー M3 の申し送り: overusedIngredients は利用者が入力した
 * メイン食材の文字列がそのまま DB から返るため、【学習】段落へ改行混じりの
 * 指示文などを持ち越さないよう、語ごとに落とす（ヒント全体は落とさない）。
 */
const CONTROL_OR_LINE_BREAK = /[\p{Cc}\p{Zl}\p{Zp}]/u;

function hasControlOrLineBreak(value: string): boolean {
  return CONTROL_OR_LINE_BREAK.test(value);
}

/**
 * 軸分けの確定。最近出した料理を落とし、その料理にしか出てこない食材も落とす。
 * 対応表は使い切ってここで捨てる（prompt にも記録にも出さない）。
 */
export function sanitizeTasteHints(
  signals: TasteSignals,
  recentDishHints: readonly RecentDishHint[],
): TasteHints | null {
  const recentNames = new Set(recentDishHints.map((hint) => normalizeFoodText(hint.dishName)));
  const keptDishes = signals.likedDishes.filter(
    (dish) =>
      !recentNames.has(normalizeFoodText(dish.dishName)) && !hasControlOrLineBreak(dish.dishName),
  );
  const keptNames = new Set(keptDishes.map((dish) => normalizeFoodText(dish.dishName)));

  // 残った料理に現れる食材だけを「まだ好き」と扱う。
  // 対応表に載っていない食材は由来が辿れないため保守的に残す。
  const survivingIngredients = new Set<string>();
  const indexedIngredients = new Set<string>();
  for (const entry of signals.dishIngredientIndex) {
    for (const name of entry.ingredients) {
      indexedIngredients.add(normalizeFoodText(name));
      if (keptNames.has(normalizeFoodText(entry.dishName))) {
        survivingIngredients.add(normalizeFoodText(name));
      }
    }
  }

  const hints: TasteHints = {
    likedDishes: keptDishes.slice(0, TASTE_LIKED_DISHES_MAX),
    likedGenres: signals.likedGenres.slice(0, TASTE_LIKED_GENRES_MAX),
    likedIngredients: signals.likedIngredients
      .filter((name) => {
        if (hasControlOrLineBreak(name)) return false;
        const normalized = normalizeFoodText(name);
        if (!indexedIngredients.has(normalized)) return true;
        return survivingIngredients.has(normalized);
      })
      .slice(0, TASTE_LIKED_INGREDIENTS_MAX),
    likedTimeBand: signals.likedTimeBand,
    overusedIngredients: signals.overusedIngredients
      .filter((name) => !hasControlOrLineBreak(name))
      .slice(0, TASTE_OVERUSED_INGREDIENTS_MAX),
    avoidAxes: signals.avoidAxes.slice(0, 1),
    signalStrength: signals.signalStrength,
  };

  return hasTasteContent(hints) ? hints : null;
}
