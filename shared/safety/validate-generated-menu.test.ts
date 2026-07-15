import { expect, it } from "vitest";
import { validateGeneratedMenu } from "./validate-generated-menu.js";
import {
  makeCurrentSafetyContext,
  makeGeneratedMenu,
  makeGenerationContext,
} from "../testing/factories.js";

it("blocks unconfirmed allergy, unsupported scope, and unsupported memo", () => {
  const context = makeCurrentSafetyContext({
    requestText: "離乳食にして",
    members: [
      {
        ...makeCurrentSafetyContext().members[0]!,
        allergyStatus: "unconfirmed",
        unsupportedDietStatus: "unconfirmed",
      },
    ],
  });
  const result = validateGeneratedMenu(
    makeGeneratedMenu(),
    makeGenerationContext({ safety: context }),
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("安全性エラーを期待しました");
  expect(result.issues.map((issue) => issue.code)).toEqual(
    expect.arrayContaining([
      "allergy_unconfirmed",
      "unsupported_diet_unconfirmed",
      "unsupported_medical_request",
    ]),
  );
});

it("rejects provider-confirmed state and canonicalizes pending processed-food provenance", () => {
  const base = makeGeneratedMenu();
  const ingredient = base.dishes[0]!.ingredients[0]!;
  const menu = makeGeneratedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0 ? { ...dish, ingredients: [{ ...ingredient, name: "ドレッシング" }] } : dish,
    ),
    labelConfirmations: [
      {
        sourceType: "ingredient",
        sourceId: ingredient.id,
        sourcePath: "dishes.0.ingredients.0.name",
        sourceText: "偽装された表示名",
        allergenId: "egg",
        anonymousMemberRef: "member_1",
        dictionaryVersion: "jp-caa-2026-04.v1",
        confirmationStatus: "pending",
      },
    ],
  });
  const safety = makeCurrentSafetyContext({
    members: [
      {
        ...makeCurrentSafetyContext().members[0]!,
        allergyStatus: "registered",
        allergenIds: ["egg"],
      },
    ],
    allergenDictionary: {
      version: "jp-caa-2026-04.v1",
      catalog: [{ id: "egg", displayName: "卵", catalogVersion: "jp-caa-2026-04.v1" }],
      aliases: [
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
  const confirmed = {
    ...menu,
    labelConfirmations: [{ ...menu.labelConfirmations[0]!, confirmationStatus: "confirmed" }],
  };
  expect(validateGeneratedMenu(confirmed, makeGenerationContext({ safety })).ok).toBe(false);
  expect(validateGeneratedMenu(menu, makeGenerationContext({ safety }))).toMatchObject({
    ok: true,
    menu: {
      labelConfirmations: [
        {
          sourcePath: "dishes.0.ingredients.0.name",
          sourceText: "ドレッシング",
          confirmationStatus: "pending",
          confirmedAt: null,
          confirmedBy: null,
        },
      ],
    },
  });
});
