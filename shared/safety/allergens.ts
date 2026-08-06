import type {
  GeneratedLabelConfirmation,
  GeneratedMenu,
  MenuValidationIssue,
  ValidatedMenu,
} from "../contracts/generation.js";
import type { CurrentSafetyContext } from "./context.js";
import { normalizeFoodText, normalizeFoodTextBase } from "../safety-pure/normalize-food-text.js";

export type AllergenCatalogEntry = {
  id: string;
  displayName: string;
  catalogVersion: string;
};

export type AllergenAlias = {
  allergenId: string;
  alias: string;
  normalizedAlias: string;
  aliasKind: "direct" | "derived" | "processed";
  requiresLabelConfirmation: boolean;
  dictionaryVersion: string;
};

export type AllergenDictionary = {
  version: string;
  catalog: readonly AllergenCatalogEntry[];
  aliases: readonly AllergenAlias[];
};

export type MenuTextSource = {
  sourceType: GeneratedLabelConfirmation["sourceType"];
  sourceId: string;
  sourcePath: string;
  text: string;
  dishId: string | null;
  ingredientId: string | null;
};

// 正規化本体は safety-pure（dual-surface）。allergens 評価はここから re-export する。
export { normalizeFoodText } from "../safety-pure/normalize-food-text.js";

const FOOD_TEXT_SEPARATOR = /[\s\u3000、。・,./（）()「」『』']/u;

const EXCLUDED_ALIAS_CONTEXTS = new Map<string, readonly string[]>([
  ["乳", ["豆乳"]],
  ["もも", ["鶏もも", "鳥もも"]],
  ["かに", ["やわらかに", "いかに"]],
  ["いか", ["食べやすいか"]],
  [
    "そば",
    [
      "コンロのそばで",
      "コンロのそばに",
      "火のそばで",
      "火のそばに",
      "ストーブのそばで",
      "ストーブのそばに",
    ],
  ],
  ["もち", ["もちもち食感"]],
]);

type TextSpan = {
  start: number;
  end: number;
};

type FoodTextForMatching = {
  compact: string;
  separatorOffsets: ReadonlySet<number>;
};

function normalizeFoodTextForMatching(value: string): FoodTextForMatching {
  let compact = "";
  let sawSeparator = false;
  const separatorOffsets = new Set<number>();
  for (const character of normalizeFoodTextBase(value)) {
    if (FOOD_TEXT_SEPARATOR.test(character)) {
      sawSeparator = true;
      continue;
    }
    if (sawSeparator && compact.length > 0) {
      separatorOffsets.add(compact.length);
    }
    compact += character;
    sawSeparator = false;
  }
  return { compact, separatorOffsets };
}

function findTextSpans(source: string, needle: string): readonly TextSpan[] {
  const spans: TextSpan[] = [];
  let from = 0;
  while (from <= source.length - needle.length) {
    const start = source.indexOf(needle, from);
    if (start === -1) {
      break;
    }
    spans.push({ start, end: start + needle.length });
    from = start + 1;
  }
  return spans;
}

function spanCrossesSeparator(span: TextSpan, separatorOffsets: ReadonlySet<number>): boolean {
  for (const offset of separatorOffsets) {
    if (offset > span.start && offset < span.end) {
      return true;
    }
  }
  return false;
}

/**
 * compact 上の offset がトークン境界か（区切り直後・文字列端・先頭）。
 * マルチワード食材（カシュー ナッツ）は境界に揃った連結を許可し、
 * 中途半端な跨ぎ（いか|にんじん → かに）だけを拒否する。
 */
function isTokenBoundary(
  offset: number,
  compactLength: number,
  separatorOffsets: ReadonlySet<number>,
): boolean {
  return offset === 0 || offset === compactLength || separatorOffsets.has(offset);
}

/**
 * 区切りを跨ぐがトークン途中から始まる／途中で終わる一致（偶然の合成）か。
 * 完全トークン列の連結（カシュー+ナッツ）は false。意図的1文字分割（か、に）は residual。
 */
function isAccidentalSeparatorCrossingMatch(
  span: TextSpan,
  compactLength: number,
  separatorOffsets: ReadonlySet<number>,
): boolean {
  if (!spanCrossesSeparator(span, separatorOffsets)) {
    return false;
  }
  return (
    !isTokenBoundary(span.start, compactLength, separatorOffsets) ||
    !isTokenBoundary(span.end, compactLength, separatorOffsets)
  );
}

/**
 * アレルゲン alias が献立テキストに含まれるかを判定する。
 * 素の includes だと「乳⊂豆乳」「もも⊂鶏もも」「かに⊂やわらかに」などの誤検知が起きるため、
 * 区切りを跨がない確認済み文脈内の一致だけを除外し、日本語の複合食材は検出側へ倒す。
 * I4: 正一致でもトークン途中の区切り跨ぎ（いか、にんじん→かに）は不一致とする。
 * マルチワード正規化（カシュー ナッツ）はトークン境界揃えで維持する。
 */
export function foodTextContainsAlias(sourceText: string, alias: string): boolean {
  const source = normalizeFoodTextForMatching(sourceText);
  const needle = normalizeFoodText(alias);
  if (needle.length === 0) {
    return false;
  }

  const excludedSpans: TextSpan[] = [];
  for (const context of EXCLUDED_ALIAS_CONTEXTS.get(needle) ?? []) {
    for (const span of findTextSpans(source.compact, normalizeFoodText(context))) {
      if (!spanCrossesSeparator(span, source.separatorOffsets)) {
        excludedSpans.push(span);
      }
    }
  }
  return findTextSpans(source.compact, needle).some(
    (match) =>
      !isAccidentalSeparatorCrossingMatch(match, source.compact.length, source.separatorOffsets) &&
      !excludedSpans.some((excluded) => excluded.start <= match.start && match.end <= excluded.end),
  );
}

export function collectMenuTextSources(
  menu: GeneratedMenu | ValidatedMenu,
): readonly MenuTextSource[] {
  const sources: MenuTextSource[] = [];
  const push = (
    sourceType: MenuTextSource["sourceType"],
    sourceId: string,
    sourcePath: string,
    text: string | null,
    dishId: string | null,
    ingredientId: string | null,
  ) => {
    if (text !== null && text.trim() !== "") {
      sources.push({ sourceType, sourceId, sourcePath, text, dishId, ingredientId });
    }
  };
  menu.dishes.forEach((dish, dishIndex) => {
    push("dish", dish.id, `dishes.${String(dishIndex)}.name`, dish.name, dish.id, null);
    push(
      "dish",
      dish.id,
      `dishes.${String(dishIndex)}.description`,
      dish.description,
      dish.id,
      null,
    );
    dish.ingredients.forEach((ingredient, ingredientIndex) => {
      const base = `dishes.${String(dishIndex)}.ingredients.${String(ingredientIndex)}`;
      push("ingredient", ingredient.id, `${base}.name`, ingredient.name, dish.id, ingredient.id);
      push(
        "ingredient",
        ingredient.id,
        `${base}.quantityText`,
        ingredient.quantityText,
        dish.id,
        ingredient.id,
      );
      push("ingredient", ingredient.id, `${base}.unit`, ingredient.unit, dish.id, ingredient.id);
    });
    dish.steps.forEach((step, stepIndex) => {
      push(
        "recipe_step",
        step.id,
        `dishes.${String(dishIndex)}.steps.${String(stepIndex)}.instruction`,
        step.instruction,
        dish.id,
        null,
      );
    });
  });
  menu.timeline.forEach((step, index) => {
    push(
      "timeline",
      step.id,
      `timeline.${String(index)}.instruction`,
      step.instruction,
      step.dishId,
      null,
    );
  });
  menu.adaptations.forEach((adaptation, index) => {
    const base = `adaptations.${String(index)}`;
    push(
      "adaptation",
      adaptation.id,
      `${base}.portionText`,
      adaptation.portionText,
      adaptation.dishId,
      null,
    );
    push(
      "adaptation",
      adaptation.id,
      `${base}.additionalCutting`,
      adaptation.additionalCutting,
      adaptation.dishId,
      null,
    );
    push(
      "adaptation",
      adaptation.id,
      `${base}.additionalHeating`,
      adaptation.additionalHeating,
      adaptation.dishId,
      null,
    );
    push(
      "adaptation",
      adaptation.id,
      `${base}.additionalSeasoning`,
      adaptation.additionalSeasoning,
      adaptation.dishId,
      null,
    );
    push(
      "adaptation",
      adaptation.id,
      `${base}.servingCheck`,
      adaptation.servingCheck,
      adaptation.dishId,
      null,
    );
    adaptation.safetyActions.forEach((action, actionIndex) => {
      push(
        "adaptation",
        adaptation.id,
        `${base}.safetyActions.${String(actionIndex)}.instruction`,
        action.instruction,
        action.dishId,
        action.ingredientId,
      );
    });
  });
  return sources;
}

/**
 * A-C2 residual: 表示名スナップショット等を渡す任意オプション。
 * 未指定時は member_N → 「家族N」、非対応 ref は「ご家族」。内部 ID は出さない。
 */
export type EvaluateAllergensOptions = {
  memberLabels?: Readonly<Record<string, string>>;
};

/** 主婦向けメンバー表示名。内部 anonymousRef を本文に出さない。 */
export function resolveAllergenMemberLabel(
  anonymousRef: string,
  memberLabels?: Readonly<Record<string, string>>,
): string {
  const fromMap = memberLabels?.[anonymousRef]?.trim();
  if (fromMap !== undefined && fromMap !== "") return fromMap;
  const mapped = anonymousRef.match(/^member_(\d+)$/u);
  const memberIndex = mapped?.[1];
  if (memberIndex !== undefined) return `家族${memberIndex}`;
  return "ご家族";
}

/**
 * G6 residual-intentional（生成 validate 経路と同型 H1）: hard match は辞書 alias
 * 部分一致のみ。裸の「パン」等の辞書外表記は fail-open で valid になり得る。
 * catalog 弱体化・無制限追加はしない。安全保証コピーは出さない。
 */
export function evaluateAllergens(
  menu: GeneratedMenu | ValidatedMenu,
  context: CurrentSafetyContext,
  options?: EvaluateAllergensOptions,
): {
  issues: readonly MenuValidationIssue[];
  labelConfirmations: readonly GeneratedLabelConfirmation[];
} {
  const sources = collectMenuTextSources(menu);
  const issues: MenuValidationIssue[] = [];
  const confirmations = new Map<string, GeneratedLabelConfirmation>();
  for (const member of context.members) {
    const memberLabel = resolveAllergenMemberLabel(member.anonymousRef, options?.memberLabels);
    for (const allergenId of member.allergenIds) {
      const aliases = context.allergenDictionary.aliases.filter(
        (alias) => alias.allergenId === allergenId,
      );
      const catalogEntry = context.allergenDictionary.catalog.find(
        (entry) => entry.id === allergenId,
      );
      const allergenDisplayName = catalogEntry?.displayName ?? "登録アレルギー";
      // anonymousRef (member_1) や英語 ID を主婦向け本文に出さない（A-C2 / design L221）。
      // 表示名があれば優先し、無ければ member_N → 「家族N」（生成経路は targetMembers から渡す）。
      for (const source of sources) {
        const matched = aliases.filter((alias) =>
          foodTextContainsAlias(source.text, alias.normalizedAlias),
        );
        if (matched.some((alias) => !alias.requiresLabelConfirmation)) {
          // 材料・工程テキストを軽く添える（design L221 の「主菜の…」方向。DTO 再設計はしない）。
          const sourceSnippet = source.text.trim();
          const withSource =
            sourceSnippet === ""
              ? `「${memberLabel}」さんの登録アレルギー「${allergenDisplayName}」が献立に残っています`
              : `「${memberLabel}」さんの登録アレルギー「${allergenDisplayName}」が「${sourceSnippet}」に残っています`;
          issues.push({
            code: "direct_allergen_match",
            path: source.sourcePath,
            message: withSource,
          });
          continue;
        }
        if (matched.some((alias) => alias.requiresLabelConfirmation)) {
          const confirmation: GeneratedLabelConfirmation = {
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            sourcePath: source.sourcePath,
            sourceText: source.text,
            allergenId,
            anonymousMemberRef: member.anonymousRef,
            dictionaryVersion: context.dictionaryVersion,
            confirmationStatus: "pending",
          };
          const key = [
            confirmation.sourceType,
            confirmation.sourceId,
            confirmation.sourcePath,
            confirmation.allergenId,
            confirmation.anonymousMemberRef,
            confirmation.dictionaryVersion,
          ].join("\u0000");
          confirmations.set(key, confirmation);
        }
      }
    }
    // AGS-I2: 確認済み自由登録語は辞書外でも hard match する（prompt 送信は generation-prompt 側）。
    for (const custom of member.customAllergies) {
      const needles = [custom.name, ...custom.aliases].filter((value) => value.trim() !== "");
      if (needles.length === 0) continue;
      for (const source of sources) {
        if (!needles.some((needle) => foodTextContainsAlias(source.text, needle))) continue;
        const sourceSnippet = source.text.trim();
        const withSource =
          sourceSnippet === ""
            ? `「${memberLabel}」さんの登録アレルギー「${custom.name}」が献立に残っています`
            : `「${memberLabel}」さんの登録アレルギー「${custom.name}」が「${sourceSnippet}」に残っています`;
        issues.push({
          code: "direct_allergen_match",
          path: source.sourcePath,
          message: withSource,
        });
      }
    }
  }
  return { issues, labelConfirmations: [...confirmations.values()] };
}

export function deriveCurrentGeneratedLabelConfirmations(
  menu: GeneratedMenu | ValidatedMenu,
  context: CurrentSafetyContext,
): readonly GeneratedLabelConfirmation[] {
  return evaluateAllergens(menu, context).labelConfirmations;
}
