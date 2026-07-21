import { describe, expect, it, vi } from "vitest";
import { createDishSignature, createMenuSignature } from "../../../shared/safety/deduplicate.js";
import { createCurrentSafetyFingerprint } from "../../../shared/safety/fingerprint.js";
import { validateGeneratedMenu } from "../../../shared/safety/validate-generated-menu.js";
import { makeGenerationContext, makeValidatedMenu } from "../../../shared/testing/factories.js";
import type { GenerationCommand } from "../../../shared/contracts/generation.js";
import type { DishRegenerationAiOutput } from "../../../shared/contracts/regeneration.js";
import { HttpError } from "./http.js";
import type { GenerationExecutionContext } from "./generation-service.js";
import type { StoredMenuAggregate } from "./stored-menu-loader.js";
import {
  buildDishRegenerationPrompt,
  isRegenerationDuplicate,
  loadRegenerationExecutionContext,
  materializeDishRegenerationCandidate,
  toRetainedDishPrompt,
  type LoaderDeps,
} from "./regeneration-context.js";

const user = {
  userId: "85000000-0000-4000-8000-000000000001",
  accessToken: "token",
};

const dish1Id = "50000000-0000-4000-8000-000000000001";
const dish2Id = "50000000-0000-4000-8000-000000000002";

function makeStoredMenu(
  overrides: Partial<StoredMenuAggregate> & {
    menu?: ReturnType<typeof makeValidatedMenu>;
  } = {},
): StoredMenuAggregate {
  // breakfast は既定 2 品。member_1 向け取り分けを付けて revalidation を通す。
  const baseMenu = makeValidatedMenu();
  const firstDish = baseMenu.dishes[0];
  const firstStep = firstDish?.steps[0];
  const menu =
    overrides.menu ??
    makeValidatedMenu({
      adaptations:
        firstDish !== undefined && firstStep !== undefined
          ? [
              {
                id: "57000000-0000-4000-8000-000000000001",
                dishId: firstDish.id,
                anonymousMemberRef: "member_1",
                portionText: "通常量",
                branchBeforeRecipeStepId: firstStep.id,
                additionalCutting: null,
                additionalHeating: null,
                additionalSeasoning: null,
                servingCheck: "通常の取り分けを確認する",
                safetyTags: [],
                safetyActions: [],
              },
            ]
          : [],
    });
  return {
    menu,
    userId: user.userId,
    safetyFingerprint: "source-fp",
    derivationGroupId: "a1000000-0000-4000-8000-000000000001",
    version: 1,
    preferenceSnapshot: {
      mealType: "breakfast",
      mainIngredients: ["ごはん"],
      cuisineGenre: "japanese",
      timeLimitMinutes: 15,
      budgetPreference: "standard",
      avoidIngredients: [],
      memo: "",
      pantrySelections: [],
    },
    targetMemberIds: ["55000000-0000-4000-8000-000000000001"],
    targetMembers: [
      {
        householdMemberId: "55000000-0000-4000-8000-000000000001",
        anonymousMemberRef: "member_1",
        displayNameSnapshot: "家族1",
        displayName: "家族1",
      },
    ],
    ...overrides,
  };
}

function makeLoaderDeps(
  source: StoredMenuAggregate,
  extras: {
    group?: readonly StoredMenuAggregate[];
    recent?: readonly StoredMenuAggregate[];
    generationContext?: ReturnType<typeof makeGenerationContext>;
  } = {},
): LoaderDeps & {
  loadSource: ReturnType<typeof vi.fn>;
  loadGroup: ReturnType<typeof vi.fn>;
  loadRecent: ReturnType<typeof vi.fn>;
  buildCurrentContext: ReturnType<typeof vi.fn>;
} {
  const generationContext = extras.generationContext ?? makeGenerationContext();
  // fingerprint を current-v3 に固定したいテスト用
  const withFingerprint = {
    ...generationContext,
    safety: {
      ...generationContext.safety,
      // createCurrentSafetyFingerprint は決定論的。モックで上書きするため spy 側で対応
    },
  };
  return {
    loadSource: vi.fn(() => Promise.resolve(source)),
    loadGroup: vi.fn(() => Promise.resolve(extras.group ?? [source])),
    loadRecent: vi.fn(() => Promise.resolve(extras.recent ?? [source])),
    buildCurrentContext: vi.fn(() => Promise.resolve(withFingerprint)),
    requestStartedAtMonotonicMs: 1_000,
    now: () => new Date("2026-07-11T00:00:00.000Z"),
    monotonicNow: () => 1_000,
  };
}

const dishCommand: Extract<GenerationCommand, { kind: "regenerate_dish" }> = {
  kind: "regenerate_dish",
  request: {
    sourceMenuId: "52000000-0000-4000-8000-000000000001",
    dishId: dish2Id,
    idempotencyKey: "82000000-0000-4000-8000-000000000001",
    changeReason: "simpler",
    changeReasonCustom: null,
    expiredPantryConfirmations: [],
  },
};

function dishSig(name: string, role: string, ingredients: string[]) {
  return createDishSignature({ role, name, primaryIngredients: ingredients });
}

describe("loadRegenerationExecutionContext", () => {
  it("loads current safety and excludes every dish in the root group", async () => {
    const teriyakiSignature = dishSig("照り焼き", "main", ["鶏肉"]);
    const sweetSoySignature = dishSig("甘辛炒め", "side", ["豚肉"]);
    const source = makeStoredMenu();
    const sibling = makeStoredMenu({
      menu: makeValidatedMenu({
        menuId: "52000000-0000-4000-8000-000000000099",
        dishes: [
          {
            id: "50000000-0000-4000-8000-000000000091",
            role: "main",
            position: 1,
            name: "照り焼き",
            description: "主菜",
            cookingTimeMinutes: 20,
            ingredients: [
              {
                id: "53000000-0000-4000-8000-000000000091",
                position: 1,
                name: "鶏肉",
                quantityValue: 200,
                quantityText: "200g",
                unit: "g",
                storeSection: "meat_fish",
                pantrySelectionId: null,
                labelConfirmationRequired: false,
              },
            ],
            steps: [
              {
                id: "51000000-0000-4000-8000-000000000091",
                position: 1,
                instruction: "焼く",
              },
            ],
          },
          {
            id: "50000000-0000-4000-8000-000000000092",
            role: "side",
            position: 2,
            name: "甘辛炒め",
            description: "副菜",
            cookingTimeMinutes: 15,
            ingredients: [
              {
                id: "53000000-0000-4000-8000-000000000092",
                position: 1,
                name: "豚肉",
                quantityValue: 100,
                quantityText: "100g",
                unit: "g",
                storeSection: "meat_fish",
                pantrySelectionId: null,
                labelConfirmationRequired: false,
              },
            ],
            steps: [
              {
                id: "51000000-0000-4000-8000-000000000092",
                position: 1,
                instruction: "炒める",
              },
            ],
          },
        ],
      }),
    });

    const generationContext = makeGenerationContext();
    const deps = makeLoaderDeps(source, {
      group: [source, sibling],
      generationContext,
    });

    // expectedSafetyFingerprint は現行 context から計算される
    const expectedFp = createCurrentSafetyFingerprint(generationContext.safety);

    const context = await loadRegenerationExecutionContext(
      deps,
      user,
      {
        kind: "regenerate_dish",
        request: {
          sourceMenuId: "menu-2",
          dishId: dish2Id,
          idempotencyKey: "82000000-0000-4000-8000-000000000001",
          changeReason: "simpler",
          changeReasonCustom: null,
          expiredPantryConfirmations: [],
        },
      },
      "request-row-1",
      50_000,
    );

    expect(context.expectedSafetyFingerprint).toBe(expectedFp);
    expect(context.kind).toBe("regenerate_dish");
    if (context.kind !== "regenerate_dish") throw new Error("expected regenerate_dish");
    expect(
      context.regeneration.existingDerivationMenus.flatMap((menu) => menu.dishSignatures),
    ).toEqual(expect.arrayContaining([teriyakiSignature, sweetSoySignature]));
    expect(context.regeneration.retainedDishIds).not.toContain(dish2Id);
    expect(context.startedAtMonotonicMs).toBe(1_000);
  });

  it("requires at least one surviving current target member", async () => {
    const deps = makeLoaderDeps(
      makeStoredMenu({
        targetMembers: [
          {
            householdMemberId: null,
            anonymousMemberRef: "member_1",
            displayNameSnapshot: "削除済みの家族",
            displayName: "削除済みの家族",
          },
        ],
        targetMemberIds: [],
      }),
    );
    await expect(
      loadRegenerationExecutionContext(deps, user, dishCommand, "request-row-1", 50_000),
    ).rejects.toMatchObject({ code: "current_target_member_required" });
    expect(deps.buildCurrentContext).not.toHaveBeenCalled();
  });

  it("fails current safety revalidation before build side-effects complete", async () => {
    // 取り分けを欠いた献立は現行 validate で target_member_mismatch になる
    const deps = makeLoaderDeps(
      makeStoredMenu({
        menu: makeValidatedMenu({ adaptations: [] }),
      }),
    );
    await expect(
      loadRegenerationExecutionContext(deps, user, dishCommand, "request-row-1", 50_000),
    ).rejects.toMatchObject({ code: "current_safety_revalidation_required" });
  });

  it("maps foreign or missing source to source_menu_not_found before current context", async () => {
    const deps = makeLoaderDeps(makeStoredMenu());
    deps.loadSource.mockRejectedValue(new HttpError(404, "menu_not_found", "献立が見つかりません"));
    await expect(
      loadRegenerationExecutionContext(deps, user, dishCommand, "request-row-1", 50_000),
    ).rejects.toMatchObject({ code: "source_menu_not_found", status: 404 });
    // admin 経路は buildCurrentContext 内のみ。source 欠落では到達しない
    expect(deps.buildCurrentContext).not.toHaveBeenCalled();
    expect(deps.loadGroup).not.toHaveBeenCalled();
  });
});

describe("isRegenerationDuplicate material equivalence", () => {
  const chickenCabbage = {
    role: "main",
    name: "鶏肉と白菜の煮物",
    primaryIngredients: ["鶏もも肉", "白菜", "しょうゆ"],
  } as const;
  const cabbageChicken = {
    role: "main",
    name: "白菜と鶏肉の煮物",
    primaryIngredients: ["白菜", "鶏もも肉", "しょうゆ"],
  } as const;

  function dishFromSigInput(
    input: {
      role: "main" | "side" | "soup" | "staple" | "other";
      name: string;
      primaryIngredients: readonly string[];
    },
    dishId: string,
  ) {
    return {
      id: dishId,
      role: input.role,
      position: 1,
      name: input.name,
      description: "テスト",
      cookingTimeMinutes: 20,
      ingredients: input.primaryIngredients.map((name, index) => ({
        id: `53000000-0000-4000-8000-00000000000${String(index + 1)}`,
        position: index + 1,
        name,
        quantityValue: 100,
        quantityText: "100g",
        unit: "g",
        storeSection: "meat_fish" as const,
        pantrySelectionId: null,
        labelConfirmationRequired: false,
      })),
      steps: [
        {
          id: "51000000-0000-4000-8000-000000000001",
          position: 1,
          instruction: "煮る",
        },
      ],
    };
  }

  it("rejects a dish that is only materially the same as an existing derivation dish", () => {
    const sourceMenu = makeValidatedMenu({
      dishes: [
        dishFromSigInput(chickenCabbage, dish1Id),
        {
          ...makeValidatedMenu().dishes[1]!,
          id: dish2Id,
        },
      ],
    });
    const candidate = makeValidatedMenu({
      dishes: [
        dishFromSigInput(cabbageChicken, "b0000000-0000-4000-8000-000000000001"),
        {
          ...makeValidatedMenu().dishes[1]!,
          id: "b0000000-0000-4000-8000-000000000002",
        },
      ],
    });
    const existingSig = createDishSignature(chickenCabbage);
    const candidateSig = createDishSignature(cabbageChicken);
    // 名前順が異なるため exact シグネチャは不一致
    expect(existingSig).not.toBe(candidateSig);

    const execution: Extract<GenerationExecutionContext, { kind: "regenerate_dish" }> = {
      kind: "regenerate_dish",
      command: dishCommand,
      requestId: "81000000-0000-4000-8000-000000000001",
      generationContext: makeGenerationContext(),
      expectedSafetyFingerprint: "fp",
      startedAtMonotonicMs: 0,
      deadlineAtMonotonicMs: 50_000,
      regeneration: {
        sourceMenuId: sourceMenu.menuId,
        sourceMenu,
        derivationGroupId: "a1000000-0000-4000-8000-000000000001",
        replaceDishId: dish1Id,
        retainedDishIds: [dish2Id],
        excludedDishIds: [dish1Id, dish2Id],
        sourceSafetyFingerprint: "source-fp",
        sourcePreferenceSnapshot: {},
        existingDerivationMenus: [
          {
            menuId: sourceMenu.menuId,
            menuSignature: createMenuSignature({
              dishes: sourceMenu.dishes.map((dish) => ({
                role: dish.role,
                name: dish.name,
                primaryIngredients: dish.ingredients.map((item) => item.name),
              })),
            }),
            dishSignatures: [
              existingSig,
              createDishSignature({
                role: "side",
                name: "温野菜",
                primaryIngredients: ["にんじん"],
              }),
            ],
          },
        ],
        artifacts: {
          retainedDishes: [],
          sourceDishToReplace: null,
          promptDto: null,
          retainedRefMap: new Map(),
        },
      },
    };

    expect(isRegenerationDuplicate(candidate, execution)).toBe(true);
  });

  it("rejects a whole menu when every role is only materially unchanged", () => {
    const firstDishes = [
      dishFromSigInput(chickenCabbage, dish1Id),
      {
        id: dish2Id,
        role: "side" as const,
        position: 2,
        name: "にんじんの和え物",
        description: "副菜",
        cookingTimeMinutes: 10,
        ingredients: [
          {
            id: "53000000-0000-4000-8000-000000000099",
            position: 1,
            name: "にんじん",
            quantityValue: 1,
            quantityText: "1本",
            unit: "本",
            storeSection: "produce" as const,
            pantrySelectionId: null,
            labelConfirmationRequired: false,
          },
        ],
        steps: [
          {
            id: "51000000-0000-4000-8000-000000000099",
            position: 1,
            instruction: "和える",
          },
        ],
      },
    ];
    const secondDishes = [
      {
        id: "b0000000-0000-4000-8000-000000000002",
        role: "side" as const,
        position: 2,
        name: "人参の和え物",
        description: "副菜",
        cookingTimeMinutes: 10,
        ingredients: [
          {
            id: "b3000000-0000-4000-8000-000000000002",
            position: 1,
            name: "にんじん",
            quantityValue: 1,
            quantityText: "1本",
            unit: "本",
            storeSection: "produce" as const,
            pantrySelectionId: null,
            labelConfirmationRequired: false,
          },
        ],
        steps: [
          {
            id: "b1000000-0000-4000-8000-000000000002",
            position: 1,
            instruction: "和える",
          },
        ],
      },
      dishFromSigInput(cabbageChicken, "b0000000-0000-4000-8000-000000000001"),
    ];
    const sourceMenu = makeValidatedMenu({ dishes: firstDishes });
    const candidate = makeValidatedMenu({ dishes: secondDishes });
    const existingMenuSig = createMenuSignature({
      dishes: firstDishes.map((dish) => ({
        role: dish.role,
        name: dish.name,
        primaryIngredients: dish.ingredients.map((item) => item.name),
      })),
    });
    const candidateMenuSig = createMenuSignature({
      dishes: secondDishes.map((dish) => ({
        role: dish.role,
        name: dish.name,
        primaryIngredients: dish.ingredients.map((item) => item.name),
      })),
    });
    // 人参/にんじん は signature 正規化で一致し得るが、主菜名順が違うので menu 全体は別
    expect(existingMenuSig).not.toBe(candidateMenuSig);

    const execution: Extract<GenerationExecutionContext, { kind: "regenerate_menu" }> = {
      kind: "regenerate_menu",
      command: {
        kind: "regenerate_menu",
        request: {
          idempotencyKey: "82000000-0000-4000-8000-000000000001",
          sourceMenuId: sourceMenu.menuId,
          changeReason: "simpler",
          changeReasonCustom: null,
          expiredPantryConfirmations: [],
        },
      },
      requestId: "81000000-0000-4000-8000-000000000001",
      generationContext: makeGenerationContext(),
      expectedSafetyFingerprint: "fp",
      startedAtMonotonicMs: 0,
      deadlineAtMonotonicMs: 50_000,
      regeneration: {
        sourceMenuId: sourceMenu.menuId,
        sourceMenu,
        derivationGroupId: "a1000000-0000-4000-8000-000000000001",
        replaceDishId: null,
        retainedDishIds: firstDishes.map((dish) => dish.id),
        excludedDishIds: firstDishes.map((dish) => dish.id),
        sourceSafetyFingerprint: "source-fp",
        sourcePreferenceSnapshot: {},
        existingDerivationMenus: [
          {
            menuId: sourceMenu.menuId,
            menuSignature: existingMenuSig,
            dishSignatures: firstDishes.map((dish) =>
              createDishSignature({
                role: dish.role,
                name: dish.name,
                primaryIngredients: dish.ingredients.map((item) => item.name),
              }),
            ),
          },
        ],
        artifacts: {
          retainedDishes: [],
          sourceDishToReplace: null,
          promptDto: null,
          retainedRefMap: new Map(),
        },
      },
    };

    expect(isRegenerationDuplicate(candidate, execution)).toBe(true);
  });
});

describe("materializeDishRegenerationCandidate", () => {
  function makeDishRegenerationExecutionContext() {
    const mainStepId = "51000000-0000-4000-8000-000000000001";
    const sideStepId = "51000000-0000-4000-8000-000000000002";
    const sourceMenu = makeValidatedMenu({
      dishes: [
        {
          id: dish1Id,
          role: "main",
          position: 1,
          name: "元の主菜",
          description: "置換対象",
          cookingTimeMinutes: 20,
          ingredients: [
            {
              id: "53000000-0000-4000-8000-000000000001",
              position: 1,
              name: "鶏肉",
              quantityValue: 200,
              quantityText: "200g",
              unit: "g",
              storeSection: "meat_fish",
              pantrySelectionId: null,
              labelConfirmationRequired: false,
            },
          ],
          steps: [
            {
              id: mainStepId,
              position: 1,
              instruction: "焼く",
            },
          ],
        },
        {
          id: dish2Id,
          role: "side",
          position: 2,
          name: "保持する副菜",
          description: "保持",
          cookingTimeMinutes: 10,
          ingredients: [
            {
              id: "53000000-0000-4000-8000-000000000002",
              position: 1,
              name: "にんじん",
              quantityValue: 1,
              quantityText: "1本",
              unit: "本",
              storeSection: "produce",
              pantrySelectionId: null,
              labelConfirmationRequired: false,
            },
          ],
          steps: [
            {
              id: sideStepId,
              position: 1,
              instruction: "和える",
            },
          ],
        },
      ],
      timeline: [
        {
          id: "54000000-0000-4000-8000-000000000001",
          position: 1,
          startMinute: 0,
          durationMinutes: 20,
          instruction: "主菜",
          dishId: dish1Id,
          recipeStepId: mainStepId,
        },
      ],
      adaptations: [
        {
          id: "57000000-0000-4000-8000-000000000001",
          dishId: dish1Id,
          anonymousMemberRef: "member_1",
          portionText: "通常量",
          branchBeforeRecipeStepId: mainStepId,
          additionalCutting: null,
          additionalHeating: null,
          additionalSeasoning: null,
          servingCheck: "通常の取り分けを確認する",
          safetyTags: [],
          safetyActions: [],
        },
      ],
      pantryUsage: [],
      labelConfirmations: [],
    });
    const retained = toRetainedDishPrompt(sourceMenu, dish1Id);
    // 現行条件は時間上限なし・主要食材なしにして materialize 後の validate を通す
    const generationContext = makeGenerationContext({
      submission: {
        ...makeGenerationContext().submission,
        mainIngredients: ["豚こま肉"],
        timeLimitMinutes: null,
      },
    });
    let seq = 0;
    const uuid = () => {
      seq += 1;
      return `b${String(seq).padStart(7, "0")}-0000-4000-8000-000000000001`;
    };
    return {
      execution: {
        kind: "regenerate_dish" as const,
        command: dishCommand,
        requestId: "81000000-0000-4000-8000-000000000001",
        generationContext,
        expectedSafetyFingerprint: createCurrentSafetyFingerprint(generationContext.safety),
        startedAtMonotonicMs: 0,
        deadlineAtMonotonicMs: 50_000,
        regeneration: {
          sourceMenuId: sourceMenu.menuId,
          sourceMenu,
          derivationGroupId: "a1000000-0000-4000-8000-000000000001",
          replaceDishId: dish1Id,
          retainedDishIds: [dish2Id],
          excludedDishIds: [dish1Id, dish2Id],
          sourceSafetyFingerprint: "source-fp",
          sourcePreferenceSnapshot: {},
          existingDerivationMenus: [],
          artifacts: {
            retainedDishes: retained.dto,
            sourceDishToReplace: retained.replaceTarget,
            promptDto: null,
            retainedRefMap: retained.refMap,
          },
        },
      },
      uuid,
    };
  }

  function makeDishRegenerationAiOutput(): DishRegenerationAiOutput {
    return {
      replacementDish: {
        dishRef: "dish_1",
        role: "main",
        position: 1,
        name: "豚肉と白菜の炒め物",
        description: "さっと炒める主菜",
        cookingTimeMinutes: 20,
        ingredients: [
          {
            ingredientRef: "ingredient_10",
            position: 1,
            name: "豚こま肉",
            quantityValue: 200,
            quantityText: "200g",
            unit: "g",
            storeSection: "meat_fish",
            pantryRef: null,
            labelConfirmationRequired: false,
          },
        ],
        steps: [
          {
            stepRef: "step_10",
            position: 1,
            instruction: "中火で炒める",
          },
        ],
      },
      timeline: [
        {
          timelineRef: "timeline_1",
          position: 1,
          startMinute: 0,
          durationMinutes: 20,
          instruction: "主菜を炒める",
          dishRef: "dish_1",
          stepRef: "step_10",
        },
        {
          timelineRef: "timeline_2",
          position: 2,
          startMinute: 0,
          durationMinutes: 10,
          instruction: "副菜を作る",
          dishRef: "dish_2",
          stepRef: "step_31",
        },
      ],
      adaptations: [
        {
          adaptationRef: "adaptation_1",
          dishRef: "dish_1",
          anonymousMemberRef: "member_1",
          portionText: "通常量",
          beforeStepRef: "step_10",
          additionalCutting: null,
          additionalHeating: null,
          additionalSeasoning: null,
          servingCheck: "通常の取り分けを確認する",
          safetyTags: [],
          safetyActions: [],
        },
      ],
      pantryUsage: [],
      labelConfirmations: [],
    };
  }

  it("materializes one replacement plus complete local-ref sections into one full candidate", () => {
    const { execution, uuid } = makeDishRegenerationExecutionContext();
    const candidate = materializeDishRegenerationCandidate(
      execution,
      makeDishRegenerationAiOutput(),
      uuid,
    );
    expect(
      candidate.dishes.filter((dish) => dish.id === execution.regeneration.replaceDishId),
    ).toHaveLength(0);
    const retained = candidate.dishes.find((dish) => dish.name === "保持する副菜");
    const sourceRetained = execution.regeneration.sourceMenu.dishes.find(
      (dish) => dish.name === "保持する副菜",
    );
    expect(retained).toBeDefined();
    expect(sourceRetained).toBeDefined();
    if (retained === undefined || sourceRetained === undefined) {
      throw new Error("retained fixture missing");
    }
    expect({
      role: retained.role,
      position: retained.position,
      name: retained.name,
      description: retained.description,
      cookingTimeMinutes: retained.cookingTimeMinutes,
      ingredientText: retained.ingredients.map(
        ({ name, quantityValue, quantityText, unit, storeSection }) => ({
          name,
          quantityValue,
          quantityText,
          unit,
          storeSection,
        }),
      ),
      stepText: retained.steps.map(({ position, instruction }) => ({ position, instruction })),
    }).toEqual({
      role: sourceRetained.role,
      position: sourceRetained.position,
      name: sourceRetained.name,
      description: sourceRetained.description,
      cookingTimeMinutes: sourceRetained.cookingTimeMinutes,
      ingredientText: sourceRetained.ingredients.map(
        ({ name, quantityValue, quantityText, unit, storeSection }) => ({
          name,
          quantityValue,
          quantityText,
          unit,
          storeSection,
        }),
      ),
      stepText: sourceRetained.steps.map(({ position, instruction }) => ({
        position,
        instruction,
      })),
    });
    expect(retained.id).not.toBe(sourceRetained.id);
    expect(retained.ingredients.map((item) => item.id)).not.toEqual(
      sourceRetained.ingredients.map((item) => item.id),
    );
    expect(retained.steps.map((item) => item.id)).not.toEqual(
      sourceRetained.steps.map((item) => item.id),
    );
    expect(
      candidate.timeline.every((row) =>
        row.dishId === null ? true : candidate.dishes.some((dish) => dish.id === row.dishId),
      ),
    ).toBe(true);
    const checked = validateGeneratedMenu(candidate, execution.generationContext);
    if (!checked.ok) {
      throw new Error(`materialize validation: ${JSON.stringify(checked.issues)}`);
    }
    expect(checked.ok).toBe(true);

    // 集約所有 UUID を source と共有しない（menu/dish/ingredient/step/timeline/adaptation）
    const sourceMenu = execution.regeneration.sourceMenu;
    const sourceIds = new Set<string>([sourceMenu.menuId]);
    for (const dish of sourceMenu.dishes) {
      sourceIds.add(dish.id);
      for (const item of dish.ingredients) sourceIds.add(item.id);
      for (const step of dish.steps) sourceIds.add(step.id);
    }
    for (const row of sourceMenu.timeline) sourceIds.add(row.id);
    for (const row of sourceMenu.adaptations) sourceIds.add(row.id);
    expect(sourceIds.has(candidate.menuId)).toBe(false);
    for (const dish of candidate.dishes) {
      expect(sourceIds.has(dish.id)).toBe(false);
      for (const item of dish.ingredients) expect(sourceIds.has(item.id)).toBe(false);
      for (const step of dish.steps) expect(sourceIds.has(step.id)).toBe(false);
    }
    for (const row of candidate.timeline) expect(sourceIds.has(row.id)).toBe(false);
    for (const row of candidate.adaptations) expect(sourceIds.has(row.id)).toBe(false);
    // 保持・置換のラベルはすべて pending（履歴 confirmed を持ち込まない）
    // Generated 形は confirmationStatus が pending 固定なので、confirmed フィールド非存在で検証する
    expect(
      candidate.labelConfirmations.every(
        (row) => !("confirmedAt" in row) && !("confirmedBy" in row),
      ),
    ).toBe(true);
  });
});

describe("buildDishRegenerationPrompt label source refs", () => {
  it("resolves timeline and adaptation sourced labels without throwing 500", () => {
    const base = makeValidatedMenu();
    const firstDish = base.dishes[0];
    const firstStep = firstDish?.steps[0];
    const timelineId = base.timeline[0]?.id;
    if (firstDish === undefined || firstStep === undefined || timelineId === undefined) {
      throw new Error("fixture missing dish/step/timeline");
    }
    const adaptationId = "57000000-0000-4000-8000-000000000099";
    const menu = makeValidatedMenu({
      adaptations: [
        {
          id: adaptationId,
          dishId: firstDish.id,
          anonymousMemberRef: "member_1",
          portionText: "通常量",
          branchBeforeRecipeStepId: firstStep.id,
          additionalCutting: null,
          additionalHeating: null,
          additionalSeasoning: null,
          servingCheck: "確認",
          safetyTags: [],
          safetyActions: [],
        },
      ],
      labelConfirmations: [
        {
          sourceType: "timeline",
          sourceId: timelineId,
          sourcePath: "timeline.0.instruction",
          sourceText: base.timeline[0]?.instruction ?? "工程",
          allergenId: "wheat",
          anonymousMemberRef: "member_1",
          dictionaryVersion: "jp-caa-2026-04.v1",
          confirmationStatus: "pending",
          confirmedAt: null,
          confirmedBy: null,
        },
        {
          sourceType: "adaptation",
          sourceId: adaptationId,
          sourcePath: "adaptations.0.portionText",
          sourceText: "通常量",
          allergenId: "egg",
          anonymousMemberRef: "member_1",
          dictionaryVersion: "jp-caa-2026-04.v1",
          confirmationStatus: "pending",
          confirmedAt: null,
          confirmedBy: null,
        },
      ],
    });
    const stored = makeStoredMenu({ menu });
    const retained = toRetainedDishPrompt(menu, firstDish.id);
    const prompt = buildDishRegenerationPrompt({
      command: {
        kind: "regenerate_dish",
        request: {
          sourceMenuId: menu.menuId,
          dishId: firstDish.id,
          idempotencyKey: "82000000-0000-4000-8000-000000000099",
          changeReason: "simpler",
          changeReasonCustom: null,
          expiredPantryConfirmations: [],
        },
      },
      source: stored,
      generationContext: makeGenerationContext(),
      retained,
    });

    const timelineLabel = prompt.sourceLabelConfirmations.find(
      (row) => row.sourceType === "timeline",
    );
    const adaptationLabel = prompt.sourceLabelConfirmations.find(
      (row) => row.sourceType === "adaptation",
    );
    expect(timelineLabel?.sourceRef).toMatch(/^timeline_[1-9][0-9]*$/u);
    expect(adaptationLabel?.sourceRef).toMatch(/^adaptation_[1-9][0-9]*$/u);
  });
});
