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
import {
  foodTextContainsAlias,
  normalizeFoodTextForMatching,
} from "../../../shared/safety/allergens.js";
import { expandAvoidNeedles } from "../../../shared/safety/validate-generated-menu.js";
import { normalizeFoodText } from "../../../shared/safety-pure/normalize-food-text.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";
import type { RecentDishHint } from "./diversity-hints.js";

export const TASTE_HINTS_ENABLED = true as const;
export const TASTE_SYSTEM_MARKER = "【学習】" as const;
export const TASTE_HINTS_TIMEOUT_MS = 200 as const;

/**
 * system 文の学習段落。先頭マーカーでテスト・運用識別する。
 * 値は載せない（料理名・食材名は user JSON の tasteHints にだけ出す）。
 */
export const TASTE_PARAGRAPH =
  TASTE_SYSTEM_MARKER +
  "優先順位は次のとおりです。" +
  "1)アレルギー・必須安全・must_use・品数・時間、" +
  "2)当日のpreferences（メイン食材・避けたい等）、" +
  "3)tasteHintsが示す好みのスタイル、" +
  "4)最近の料理に近くないこと（recentDishHints）、" +
  "5)季節。" +
  "tasteHints.likedDishesは、味の方向と調理法の傾向を汲むための材料です。" +
  "そこに挙げた料理名をそのまま出すためのリストとして使わないでください。" +
  "tasteHints.likedTimeBandとlikedGenresは、当日のpreferencesに指定があるときは無視してください。" +
  "tasteHints.signalStrengthがweakのときは参考程度に留めてください。" +
  "tasteHints.overusedIngredientsは連続を避ける対象であり、禁止食材ではありません。" +
  "tasteHints.overusedIngredientsは、当日のpreferencesのメイン食材に含まれるときは無視してください。" +
  "tasteHints.avoidAxesは献立全体の寄せ方であり、constraint_conflictの理由にしないでください。" +
  "学習と他の制約が両立しないときは、通常どおりoutcome=successで返してください。" +
  "学習だけを理由にconstraint_conflictにしないでください。";

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
 * 代入でコピーすると "__proto__" キーがプロトタイプを差し替え、strict schema の
 * 未知キー検査をすり抜ける。fromEntries は自前のプロパティとして作るので検査に掛かる。
 */
function omitReason(data: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([key]) => key !== "reason"));
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
  // 実行時は readReason が既に弾くため到達しない。omitReason へ object として渡す型の絞り込み
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

    // 遅れて届いた結果は採用しない（race 勝者のみ）。queryPromise は catch 済みで reject しない
    if (raced.kind === "timeout") return { signals: null, outcome: "timeout" };
    return raced.result;
  } catch {
    return { signals: null, outcome: "query_failed" };
  }
}

type BlockedTerms = {
  /** 名前と食材の照合に使う全語（苦手・表示確認で済む別名も含む） */
  all: readonly string[];
  /**
   * 対応表経由で料理ごと落とす判定に使う語。ハードゲートが実際に弾く種類だけに絞る:
   * 避けたい食材（展開後）、自由登録アレルギー、表示確認が不要な辞書の別名と表示名、
   * 対象年齢帯の家族がいる forbidden の食品安全ルールの語。
   * 醤油・みそのような表示確認の別名や苦手まで使うと、小麦・大豆アレルギーの家庭で
   * 和食の好みがほぼ全部消える。
   */
  hard: readonly string[];
};

/**
 * 現行制約の語を集める。household は安全文脈も見る。
 * 避けたい食材は検証側（validate-generated-menu）と同じ expandAvoidNeedles で広げ、
 * 「卵」を避けるのに「たまご焼き」が好みとして残る食い違いを作らない。
 */
function collectBlockedTerms(context: GenerationContext): BlockedTerms {
  const hard: string[] = context.submission.avoidIngredients.flatMap((avoided) => [
    ...expandAvoidNeedles(avoided, context),
  ]);
  const soft: string[] = [];
  for (const preference of context.memberPreferences) {
    soft.push(...preference.dislikes);
  }
  if (context.targetMode === "household") {
    const allergenIds = new Set<string>();
    for (const member of context.safety.members) {
      for (const custom of member.customAllergies) {
        hard.push(custom.name, ...custom.aliases);
      }
      for (const allergenId of member.allergenIds) {
        allergenIds.add(allergenId);
      }
    }
    // AllergenDictionary は { version, catalog, aliases }。表示名と alias の両方を語にする
    for (const entry of context.safety.allergenDictionary.catalog) {
      if (allergenIds.has(entry.id)) {
        hard.push(entry.displayName);
      }
    }
    for (const alias of context.safety.allergenDictionary.aliases) {
      if (!allergenIds.has(alias.allergenId)) continue;
      const bucket = alias.requiresLabelConfirmation ? soft : hard;
      bucket.push(alias.alias, alias.normalizedAlias);
    }
    // 年齢帯の禁止ルール（5 歳以下の餅・ナッツ、高齢者の餅など）。ハードゲート
    // （food-rules の evaluateFoodSafetyRules）は forbidden を foodTextContainsAlias で
    // 無条件に弾くので、同じ照合器で料理ごと落とさないと prompt が弾かれる料理へ寄り、
    // repair も「安全工程を足せ」の方向しか指さず生成失敗が増える。
    // requires_tag（ぶどうの 4 等分、骨を取るなど）は下処理で許されるので足さない。
    const ageBands = new Set(context.safety.members.map((member) => member.ageBand));
    for (const rule of context.safety.foodSafetyRules) {
      if (rule.ruleKind !== "forbidden") continue;
      if (!rule.appliesToAgeBands.some((band) => ageBands.has(band))) continue;
      hard.push(...rule.matchTerms);
    }
  }
  // alias と normalizedAlias はほぼ同じ形に正規化されるので、正規化後の形で 1 つに畳む
  const dedupe = (terms: readonly string[], seen: Set<string>): string[] =>
    terms.filter((term) => {
      const key = normalizeFoodText(term);
      if (key === "" || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const seen = new Set<string>();
  const hardTerms = dedupe(hard, seen);
  return { all: [...hardTerms, ...dedupe(soft, seen)], hard: hardTerms };
}

/**
 * 1 つの名前が語に当たるかを判定する。foodTextContainsAlias は一致の必要条件として
 * 正規化済み compact に語が部分文字列で含まれることを要求するため、名前ごとに 1 回だけ
 * 正規化して部分文字列で絞り、候補だけを本判定に回す（判定結果は foodTextContainsAlias と同一）。
 * 同じ名前は対応表に何度も出るので、結果も名前ごとに覚える。
 */
function makeBlockedMatcher(terms: readonly string[]): (text: string) => boolean {
  const needles = terms.map((term) => ({ term, needle: normalizeFoodText(term) }));
  const cache = new Map<string, boolean>();
  return (text) => {
    const cached = cache.get(text);
    if (cached !== undefined) return cached;
    const compact = normalizeFoodTextForMatching(text).compact;
    const hit = needles.some(
      ({ term, needle }) => compact.includes(needle) && foodTextContainsAlias(text, term),
    );
    cache.set(text, hit);
    return hit;
  };
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
  const terms = collectBlockedTerms(context);
  const hitsHard = makeBlockedMatcher(terms.hard);
  const hitsSoft = makeBlockedMatcher(terms.all.slice(terms.hard.length));
  const hitsAny = (text: string) => hitsHard(text) || hitsSoft(text);
  // 料理名に出ない食材（親子丼の卵など）でも、対応表の食材がハードな語に当たれば料理ごと落とす
  const blockedDishNames = new Set(
    signals.dishIngredientIndex
      .filter((entry) => entry.ingredients.some(hitsHard))
      .map((entry) => normalizeFoodText(entry.dishName)),
  );
  return {
    ...signals,
    likedDishes: signals.likedDishes.filter(
      (dish) => !hitsAny(dish.dishName) && !blockedDishNames.has(normalizeFoodText(dish.dishName)),
    ),
    likedIngredients: signals.likedIngredients.filter((name) => !hitsAny(name)),
    dishIngredientIndex: signals.dishIngredientIndex.map((entry) => ({
      dishName: entry.dishName,
      ingredients: entry.ingredients.filter((name) => !hitsAny(name)),
    })),
    // overusedIngredients は「使いすぎを避けて」という向きの語なので落とさない（spec §5.2 の対象外）
    avoidAxes: context.targetMode === "idea" ? [] : signals.avoidAxes,
  };
}

/**
 * 制御文字・行区切り（U+2028）・段落区切り（U+2029）と、ゼロ幅・双方向制御などの
 * 不可視文字（Cf）、私用領域（Co）、未割り当て（Cn）を含む語かどうか。
 * Task 1 敵対的レビュー M3 の申し送り: overusedIngredients は利用者が入力した
 * メイン食材の文字列がそのまま DB から返るため、【学習】段落へ改行混じりの
 * 指示文などを持ち越さないよう、語ごとに落とす（ヒント全体は落とさない）。
 *
 * 上の一般カテゴリに入らない見えない文字も足す（最終レビュー A3）:
 * 異体字セレクタ（U+FE00–FE0F、U+E0100–E01EF。Mn）と、ハングル・点字の空白字
 * （U+3164、U+115F、U+1160、U+FFA0 は Lo、U+2800 は So）。照合器の正規化は
 * NFKC と Cf の除去だけなので、「え︎び」のように挟むと現行アレルギーの語を
 * すり抜ける。照合器側を変えると安全 fingerprint に波及するため、ここで語ごと落とす。
 */
const CONTROL_OR_LINE_BREAK =
  /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}\u{3164}\u{115F}\u{1160}\u{FFA0}\u{2800}]/u;

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

  // 最近の料理以外に現れる食材だけを「まだ好き」と扱う。likedDishes は 12 件で
  // 切れているため、生き残りは上限の無い対応表から直接数える（13 位以下の料理の食材を消さない）。
  // 安全フィルタで料理ごと落ちた料理の残りの食材（親子丼の鶏肉など）も生き残りに数える。
  // 当たった食材自体はフィルタが対応表と likedIngredients から既に消しているので拾い直さない。
  // 対応表に載っていない食材は由来が辿れないため保守的に残す。
  const survivingIngredients = new Set<string>();
  const indexedIngredients = new Set<string>();
  for (const entry of signals.dishIngredientIndex) {
    const isRecent = recentNames.has(normalizeFoodText(entry.dishName));
    for (const name of entry.ingredients) {
      indexedIngredients.add(normalizeFoodText(name));
      if (!isRecent) {
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
