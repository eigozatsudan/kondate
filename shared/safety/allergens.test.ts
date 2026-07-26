import { describe, expect, it } from "vitest";
import {
  collectMenuTextSources,
  evaluateAllergens,
  foodTextContainsAlias,
  normalizeFoodText,
} from "./allergens.js";
import { makeCurrentSafetyContext, makeValidatedMenu } from "../testing/factories.js";

describe("normalizeFoodText", () => {
  it("folds katakana to hiragana", () => {
    expect(normalizeFoodText("サーモン")).toBe(normalizeFoodText("さーもん"));
    expect(normalizeFoodText("タマゴ")).toBe(normalizeFoodText("たまご"));
    expect(normalizeFoodText("ざるソバ")).toBe(normalizeFoodText("ざるそば"));
  });
});

describe("foodTextContainsAlias", () => {
  it("detects 玉子 as egg alias form", () => {
    expect(foodTextContainsAlias("玉子焼き", "玉子")).toBe(true);
  });

  it("detects ミルク for milk after normalization", () => {
    expect(foodTextContainsAlias("ミルクティー", "ミルク")).toBe(true);
  });

  it("detects folded katakana dish names for fish aliases", () => {
    expect(foodTextContainsAlias("サーモンのムニエル", "さーもん")).toBe(true);
    expect(foodTextContainsAlias("サバの味噌煮", "さば")).toBe(true);
  });

  it("detects buckwheat after kana fold", () => {
    expect(foodTextContainsAlias("ざるソバ", "そば")).toBe(true);
  });

  it.each(["十割のそばです", "きつねのそばです"])(
    "detects buckwheat in an unknown food phrase %s",
    (sourceText) => {
      expect(foodTextContainsAlias(sourceText, "そば")).toBe(true);
    },
  );

  it.each([
    ["あまえびフライ", "えび"],
    ["やりいかそうめん", "いか"],
    ["ざるそば", "そば"],
    ["かにかま", "かに"],
    ["豆、乳を加える", "乳"],
    ["鶏、ももを添える", "もも"],
  ])("detects allergen compound %s for alias %s", (sourceText, alias) => {
    expect(foodTextContainsAlias(sourceText, alias)).toBe(true);
  });

  it("does not match 乳 inside 豆乳", () => {
    expect(foodTextContainsAlias("豆乳スープ", "乳")).toBe(false);
  });

  it("does not match もも inside 鶏もも肉", () => {
    expect(foodTextContainsAlias("鶏もも肉のソテー", "もも")).toBe(false);
  });

  it("does not match かに mid-hiragana phrase", () => {
    expect(foodTextContainsAlias("やわらかになるまで煮る", "かに")).toBe(false);
    expect(foodTextContainsAlias("やわらかに煮る", "かに")).toBe(false);
  });

  it("does not match いか mid-hiragana phrase", () => {
    expect(foodTextContainsAlias("食べやすいから小さく切る", "いか")).toBe(false);
    expect(foodTextContainsAlias("食べやすいか確認する", "いか")).toBe(false);
  });

  it("does not match そば as a location particle phrase", () => {
    expect(foodTextContainsAlias("コンロのそばで冷ます", "そば")).toBe(false);
    expect(foodTextContainsAlias("火のそばで冷ます", "そば")).toBe(false);
  });

  it("does not match もち in an onomatopoeic texture phrase", () => {
    expect(foodTextContainsAlias("もちもち食感のうどん", "もち")).toBe(false);
  });

  it("I4: does not match alias that only appears by mid-token separator crossing", () => {
    // compact 後に「いかにんじん」となりトークン途中で「かに」が合成されるのを拒否する
    expect(foodTextContainsAlias("いか、にんじんを炒める", "かに")).toBe(false);
  });

  it("I4: still matches real crab dishes after separator fix", () => {
    expect(foodTextContainsAlias("かに玉", "かに")).toBe(true);
    expect(foodTextContainsAlias("茹でかに", "かに")).toBe(true);
    expect(foodTextContainsAlias("かに、にんじんを炒める", "かに")).toBe(true);
  });

  it("I4: still matches multi-word nut names that intentionally contain spaces", () => {
    // カシュー ナッツ → カシューナッツ は完全トークン列の連結として許可する
    expect(foodTextContainsAlias("カシュー ナッツ", "カシューナッツ")).toBe(true);
    expect(foodTextContainsAlias("マカダミア ナッツ", "マカダミアナッツ")).toBe(true);
  });
});

const member = {
  ...makeCurrentSafetyContext().members[0]!,
  allergyStatus: "registered" as const,
  allergenIds: ["egg"],
};
const context = makeCurrentSafetyContext({
  members: [member],
  allergenDictionary: {
    version: "jp-caa-2026-04.v1",
    catalog: [{ id: "egg", displayName: "卵", catalogVersion: "jp-caa-2026-04.v1" }],
    aliases: [
      {
        allergenId: "egg",
        alias: "鶏卵",
        normalizedAlias: "鶏卵",
        aliasKind: "derived",
        requiresLabelConfirmation: false,
        dictionaryVersion: "jp-caa-2026-04.v1",
      },
      {
        allergenId: "egg",
        alias: "ドレッシング",
        normalizedAlias: "ドレッシング",
        aliasKind: "processed",
        requiresLabelConfirmation: true,
        dictionaryVersion: "jp-caa-2026-04.v1",
      },
    ],
  },
});

describe("evaluateAllergens", () => {
  it("rejects a derived allergen in recipe text", () => {
    const base = makeValidatedMenu();
    const menu = makeValidatedMenu({
      dishes: base.dishes.map((dish, index) =>
        index === 0
          ? { ...dish, steps: [{ ...dish.steps[0]!, instruction: "鶏卵を混ぜる" }] }
          : dish,
      ),
    });
    expect(evaluateAllergens(menu, context).issues[0]?.code).toBe("direct_allergen_match");
  });

  it("uses human-facing member/allergen labels and source text (A-C2 residual)", () => {
    const base = makeValidatedMenu();
    const menu = makeValidatedMenu({
      dishes: base.dishes.map((dish, index) =>
        index === 0 ? { ...dish, ingredients: [{ ...dish.ingredients[0]!, name: "鶏卵" }] } : dish,
      ),
    });
    const issue = evaluateAllergens(menu, context, {
      memberLabels: { member_1: "太郎" },
    }).issues[0];
    expect(issue?.code).toBe("direct_allergen_match");
    expect(issue?.message).toContain("太郎");
    expect(issue?.message).toContain("卵");
    expect(issue?.message).toContain("鶏卵");
    expect(issue?.message).not.toMatch(/member_1|\begg\b/u);
  });

  it("falls back to 家族N without leaking internal IDs when no display name is given", () => {
    const base = makeValidatedMenu();
    const menu = makeValidatedMenu({
      dishes: base.dishes.map((dish, index) =>
        index === 0 ? { ...dish, ingredients: [{ ...dish.ingredients[0]!, name: "鶏卵" }] } : dish,
      ),
    });
    const message = evaluateAllergens(menu, context).issues[0]?.message ?? "";
    expect(message).toContain("家族1");
    expect(message).toContain("卵");
    expect(message).not.toMatch(/member_1|\begg\b/u);
  });

  it("retains canonical processed-food provenance", () => {
    const base = makeValidatedMenu();
    const menu = makeValidatedMenu({
      dishes: base.dishes.map((dish, index) =>
        index === 0
          ? { ...dish, ingredients: [{ ...dish.ingredients[0]!, name: "ドレッシング" }] }
          : dish,
      ),
    });
    expect(evaluateAllergens(menu, context).labelConfirmations[0]).toMatchObject({
      sourceType: "ingredient",
      sourceText: "ドレッシング",
      allergenId: "egg",
      anonymousMemberRef: "member_1",
      dictionaryVersion: "jp-caa-2026-04.v1",
      confirmationStatus: "pending",
    });
  });

  it("T5-EXIT-03 rejects a direct allergen split by an invisible format character", () => {
    const base = makeValidatedMenu();
    const menu = makeValidatedMenu({
      dishes: base.dishes.map((dish, index) =>
        index === 0
          ? { ...dish, ingredients: [{ ...dish.ingredients[0]!, name: "鶏\u200b卵" }] }
          : dish,
      ),
    });

    expect(evaluateAllergens(menu, context).issues).toEqual([
      expect.objectContaining({ code: "direct_allergen_match" }),
    ]);
  });
});

it("collects every food-bearing text leaf with canonical paths", () => {
  const base = makeValidatedMenu();
  const menu = makeValidatedMenu({
    adaptations: [
      {
        id: "57000000-0000-4000-8000-000000000001",
        dishId: base.dishes[0]!.id,
        anonymousMemberRef: "member_1",
        portionText: "少なめ",
        branchBeforeRecipeStepId: base.dishes[0]!.steps[0]!.id,
        additionalCutting: "小さく切る",
        additionalHeating: "追加加熱",
        additionalSeasoning: "薄味",
        servingCheck: "確認する",
        safetyTags: [],
        safetyActions: [
          {
            kind: "cut_small",
            dishId: base.dishes[0]!.id,
            ingredientId: base.dishes[0]!.ingredients[0]!.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: base.dishes[0]!.steps[0]!.id,
            instruction: "小さく切る",
          },
        ],
      },
    ],
  });
  expect(collectMenuTextSources(menu).map((source) => source.sourcePath)).toEqual([
    "dishes.0.name",
    "dishes.0.description",
    "dishes.0.ingredients.0.name",
    "dishes.0.ingredients.0.quantityText",
    "dishes.0.ingredients.0.unit",
    "dishes.0.steps.0.instruction",
    "dishes.1.name",
    "dishes.1.description",
    "dishes.1.ingredients.0.name",
    "dishes.1.ingredients.0.quantityText",
    "dishes.1.ingredients.0.unit",
    "dishes.1.steps.0.instruction",
    "timeline.0.instruction",
    "adaptations.0.portionText",
    "adaptations.0.additionalCutting",
    "adaptations.0.additionalHeating",
    "adaptations.0.additionalSeasoning",
    "adaptations.0.servingCheck",
    "adaptations.0.safetyActions.0.instruction",
  ]);
});
