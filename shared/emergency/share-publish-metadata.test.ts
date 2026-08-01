// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { ValidatedMenu } from "../contracts/generation.js";
import { currentAllergenCatalogV1 } from "../safety/current-allergen-catalog.v1.js";
import { makeValidatedMenu } from "../testing/factories.js";
import {
  computeSharePublishMetadata,
  type SharePublishAllergenCatalog,
} from "./share-publish-metadata.js";

/** displayName + 卵系 alias を載せた最小辞書（egg fail-open 防止用） */
function makeEggAwareCatalog(): SharePublishAllergenCatalog {
  return {
    catalog: currentAllergenCatalogV1.map((entry) => ({
      id: entry.id,
      displayName: entry.displayName,
    })),
    aliases: [
      ...currentAllergenCatalogV1.map((entry) => ({
        allergenId: entry.id,
        alias: entry.displayName,
        normalizedAlias: entry.displayName,
      })),
      { allergenId: "egg", alias: "たまご", normalizedAlias: "たまご" },
      { allergenId: "egg", alias: "玉子", normalizedAlias: "玉子" },
      { allergenId: "egg", alias: "オムレツ", normalizedAlias: "オムレツ" },
      { allergenId: "egg", alias: "鶏卵", normalizedAlias: "鶏卵" },
    ],
  };
}

function withIngredientName(name: string): ValidatedMenu {
  const base = makeValidatedMenu();
  return makeValidatedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            ingredients: dish.ingredients.map((ingredient, ingredientIndex) =>
              ingredientIndex === 0 ? { ...ingredient, name } : ingredient,
            ),
          }
        : dish,
    ),
  });
}

function withBoundSafetyActions(kinds: readonly ("cut_small" | "remove_bones")[]): ValidatedMenu {
  const base = makeValidatedMenu();
  const dish = base.dishes[0]!;
  const step = dish.steps[0]!;
  const ingredient = dish.ingredients[0]!;
  return makeValidatedMenu({
    adaptations: [
      {
        id: "57000000-0000-4000-8000-000000000001",
        dishId: dish.id,
        anonymousMemberRef: "member_1",
        portionText: "年齢と食欲に合わせた量",
        branchBeforeRecipeStepId: step.id,
        additionalCutting: null,
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: "取り分けを確認する",
        safetyTags: [...kinds],
        safetyActions: kinds.map((kind) => ({
          kind,
          dishId: dish.id,
          ingredientId: ingredient.id,
          anonymousMemberRef: "member_1" as const,
          beforeRecipeStepId: step.id,
          instruction: kind === "cut_small" ? "食べやすい大きさに切る" : "骨を取り除く",
        })),
      },
    ],
  });
}

describe("computeSharePublishMetadata", () => {
  it("flags egg-like ingredient into standardAllergenIds", () => {
    const catalog = makeEggAwareCatalog();
    for (const name of ["卵", "たまご", "玉子", "オムレツ"] as const) {
      const meta = computeSharePublishMetadata(withIngredientName(name), catalog);
      expect(meta.standardAllergenIds, name).toContain("egg");
    }
  });

  it("allows empty standardAllergenIds only for non-allergen-like materials", () => {
    const catalog = makeEggAwareCatalog();
    const plain = computeSharePublishMetadata(makeValidatedMenu(), catalog);
    // 既定 factory はごはん・にんじんのみ → カタログヒット無し
    expect(plain.standardAllergenIds).toEqual([]);

    // egg があるのに [] は禁止（RED 固定）
    const withEgg = computeSharePublishMetadata(withIngredientName("卵"), catalog);
    expect(withEgg.standardAllergenIds).not.toEqual([]);
    expect(withEgg.standardAllergenIds).toContain("egg");
  });

  it("under-six household filter drops community with only neutral portion and no bound safetyActions", () => {
    const catalog = makeEggAwareCatalog();
    const base = makeValidatedMenu();
    const dish = base.dishes[0]!;
    const step = dish.steps[0]!;
    // 中立 portion のみ・bound safetyActions なし（canonical テンプレ相当）
    const neutralOnly = makeValidatedMenu({
      adaptations: [
        {
          id: "57000000-0000-4000-8000-000000000001",
          dishId: dish.id,
          anonymousMemberRef: "member_1",
          portionText: "年齢と食欲に合わせた量",
          branchBeforeRecipeStepId: step.id,
          additionalCutting: null,
          additionalHeating: null,
          additionalSeasoning: null,
          servingCheck: "取り分けを確認する",
          safetyTags: [],
          safetyActions: [],
        },
      ],
    });

    const meta = computeSharePublishMetadata(neutralOnly, catalog);
    // under-six 帯を載せない（metadata ゲートで落 cond）
    expect(meta.eligibleAgeBands).not.toContain("post_weaning_to_2");
    expect(meta.eligibleAgeBands).not.toContain("age_3_5");
    // 成人帯は残す
    expect(meta.eligibleAgeBands).toContain("adult");

    // Stage S 前の metadata 交差と同じ判定を固定
    const underSixMemberAge = "post_weaning_to_2" as const;
    const wouldPassMetadata = meta.eligibleAgeBands.includes(underSixMemberAge);
    expect(wouldPassMetadata).toBe(false);
  });

  it("includes under-six bands only when remove_bones and cut_small are bound", () => {
    const catalog = makeEggAwareCatalog();
    const full = computeSharePublishMetadata(
      withBoundSafetyActions(["remove_bones", "cut_small"]),
      catalog,
    );
    expect(full.eligibleAgeBands).toEqual(
      expect.arrayContaining(["post_weaning_to_2", "age_3_5", "age_6_8", "adult"]),
    );

    const bonesOnly = computeSharePublishMetadata(
      withBoundSafetyActions(["remove_bones"]),
      catalog,
    );
    expect(bonesOnly.eligibleAgeBands).toContain("age_6_8");
    expect(bonesOnly.eligibleAgeBands).not.toContain("post_weaning_to_2");
  });

  it("returns standardAllergenIds in catalog order", () => {
    const catalog = makeEggAwareCatalog();
    const base = makeValidatedMenu();
    const menu = makeValidatedMenu({
      dishes: base.dishes.map((dish, index) =>
        index === 0
          ? {
              ...dish,
              ingredients: [
                {
                  ...dish.ingredients[0]!,
                  id: "53000000-0000-4000-8000-000000000010",
                  name: "鶏肉",
                },
                {
                  ...dish.ingredients[0]!,
                  id: "53000000-0000-4000-8000-000000000011",
                  position: 2,
                  name: "卵",
                },
              ],
            }
          : dish,
      ),
    });
    const meta = computeSharePublishMetadata(menu, catalog);
    expect(meta.standardAllergenIds).toEqual(["egg", "chicken"]);
  });
});
