import { describe, expect, it, vi } from "vitest";
import { createDishSignature } from "../../../shared/safety/deduplicate.js";
import { createCurrentSafetyFingerprint } from "../../../shared/safety/fingerprint.js";
import { validateGeneratedMenu } from "../../../shared/safety/validate-generated-menu.js";
import { makeGenerationContext, makeValidatedMenu } from "../../../shared/testing/factories.js";
import type { GenerationCommand } from "../../../shared/contracts/generation.js";
import type { DishRegenerationAiOutput } from "../../../shared/contracts/regeneration.js";
import type { StoredMenuAggregate } from "./stored-menu-loader.js";
import {
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
  });
});
