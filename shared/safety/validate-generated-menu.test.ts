import { expect, it } from "vitest";
import { validateGeneratedMenu } from "./validate-generated-menu.js";
import {
  makeCurrentSafetyContext,
  makeGeneratedMenu,
  makeGenerationContext,
} from "../testing/factories.js";

function expectIssueCodes(
  result: ReturnType<typeof validateGeneratedMenu>,
  expectedCodes: readonly string[],
): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("検証エラーを期待しました");
  expect(result.issues.map((issue) => issue.code)).toEqual(
    expect.arrayContaining([...expectedCodes]),
  );
}

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
  const generationContext = makeGenerationContext({
    safety,
    submission: {
      ...makeGenerationContext().submission,
      mainIngredients: ["ドレッシング"],
    },
  });
  expect(validateGeneratedMenu(confirmed, generationContext).ok).toBe(false);
  expect(validateGeneratedMenu(menu, generationContext)).toMatchObject({
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

it("rejects an omitted submitted must-use pantry item", () => {
  const pantryItemId = "58000000-0000-4000-8000-000000000001";
  const context = makeGenerationContext({
    submission: {
      ...makeGenerationContext().submission,
      pantrySelections: [{ pantryItemId, priority: "must_use" }],
    },
    pantryItems: [
      {
        id: pantryItemId,
        userId: "59000000-0000-4000-8000-000000000001",
        name: "にんじん",
        quantity: 1,
        unit: "本",
        expiresOn: null,
        expirationType: null,
        openedState: null,
        createdAt: "2026-07-15T00:00:00+09:00",
        updatedAt: "2026-07-15T00:00:00+09:00",
      },
    ],
  });

  expectIssueCodes(validateGeneratedMenu(makeGeneratedMenu(), context), ["must_use_missing"]);
});

it("rejects forged pantry provenance that disagrees with the trusted item name", () => {
  const pantryItemId = "58000000-0000-4000-8000-000000000001";
  const selectionId = "58000000-0000-4000-8000-000000000002";
  const base = makeGeneratedMenu();
  const firstDish = base.dishes[0]!;
  const menu = makeGeneratedMenu({
    dishes: base.dishes.map((dish, index) =>
      index === 0
        ? {
            ...dish,
            ingredients: [
              {
                ...dish.ingredients[0]!,
                name: "にんじん",
                pantrySelectionId: selectionId,
              },
            ],
          }
        : dish,
    ),
    pantryUsage: [
      {
        selectionId,
        pantryItemId,
        pantryItemName: "にんじん",
        priority: "must_use",
        usageStatus: "used",
        plannedQuantity: 1,
        inventoryQuantity: 1,
        shortageQuantity: 0,
        unit: "本",
        dishIds: [firstDish.id],
        unusedReason: null,
      },
    ],
  });
  const context = makeGenerationContext({
    submission: {
      ...makeGenerationContext().submission,
      pantrySelections: [{ pantryItemId, priority: "must_use" }],
    },
    pantryItems: [
      {
        id: pantryItemId,
        userId: "59000000-0000-4000-8000-000000000001",
        name: "卵入りドレッシング",
        quantity: 1,
        unit: "本",
        expiresOn: null,
        expirationType: null,
        openedState: null,
        createdAt: "2026-07-15T00:00:00+09:00",
        updatedAt: "2026-07-15T00:00:00+09:00",
      },
    ],
  });

  expectIssueCodes(validateGeneratedMenu(menu, context), ["pantry_usage_link_mismatch"]);
});

it("requires exact member adaptations and enforces member preferences", () => {
  const base = makeGenerationContext();
  const context = makeGenerationContext({
    memberPreferences: [
      {
        ...base.memberPreferences[0]!,
        portionSize: "small",
        spiceLevel: "none",
        easePreferences: ["boneless"],
        dislikes: ["ごはん"],
      },
    ],
  });

  expectIssueCodes(validateGeneratedMenu(makeGeneratedMenu({ adaptations: [] }), context), [
    "target_member_mismatch",
    "member_preference_mismatch",
  ]);
});

it("does not count a negated timeline-only mention as a requested main ingredient", () => {
  const menu = makeGeneratedMenu({
    timeline: [
      {
        ...makeGeneratedMenu().timeline[0]!,
        instruction: "鶏肉は使わない",
      },
    ],
  });
  const context = makeGenerationContext({
    submission: { ...makeGenerationContext().submission, mainIngredients: ["鶏肉"] },
  });

  expectIssueCodes(validateGeneratedMenu(menu, context), ["main_ingredient_missing"]);
});
