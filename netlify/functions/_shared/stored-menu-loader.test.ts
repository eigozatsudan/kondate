import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeCurrentSafetyContext,
  makeGenerationContext,
  makeValidatedMenu,
} from "../../../shared/testing/factories.js";
import { HttpError } from "./http.js";
import {
  STORED_MENU_SELECT,
  loadStoredMenu,
  toStoredRevalidationCandidate,
} from "./stored-menu-loader.js";

const MENU_ID = "20000000-0000-4000-8000-000000000001";
const USER_ID = "10000000-0000-4000-8000-000000000001";
const MEMBER1_ID = "30000000-0000-4000-8000-000000000001";
const MEMBER2_ID = "30000000-0000-4000-8000-000000000002";
const MEMBER10_ID = "30000000-0000-4000-8000-00000000000a";
const DISH1_ID = "21000000-0000-4000-8000-000000000001";
const DISH2_ID = "21000000-0000-4000-8000-000000000002";
const INGREDIENT1_ID = "22000000-0000-4000-8000-000000000001";
const INGREDIENT2_ID = "22000000-0000-4000-8000-000000000002";
const INGREDIENT3_ID = "22000000-0000-4000-8000-000000000003";
const STEP1_ID = "23000000-0000-4000-8000-000000000001";
const STEP2_ID = "23000000-0000-4000-8000-000000000002";
const ADAPTATION_ID = "24000000-0000-4000-8000-000000000001";
const TIMELINE_ID = "25000000-0000-4000-8000-000000000001";
const PANTRY_SELECTION_ID = "26000000-0000-4000-8000-000000000001";
const CONFIRMED_BY = "10000000-0000-4000-8000-000000000001";

const requiredConstraintTokens = [
  "menu_target_members!menu_target_members_menu_owner_fkey",
  "household_members!menu_target_members_member_owner_fkey",
  "dishes!dishes_menu_owner_fkey",
  "dish_ingredients!dish_ingredients_dish_owner_fkey",
  "recipe_steps!recipe_steps_dish_owner_fkey",
  "menu_member_adaptations!menu_member_adaptations_dish_owner_fkey",
  "menu_safety_actions!menu_safety_actions_adaptation_owner_fkey",
  "menu_timeline_steps!menu_timeline_steps_menu_owner_fkey",
  "generation_pantry_selections!generation_pantry_selections_menu_owner_fkey",
  "menu_label_confirmations!menu_label_confirmations_menu_owner_fkey",
] as const;

function rawStoredMenuRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MENU_ID,
    user_id: USER_ID,
    safety_fingerprint: "b".repeat(64),
    derivation_group_id: "c1000000-0000-4000-8000-000000000001",
    version: 2,
    preference_snapshot: {
      memberPreferences: [
        {
          householdMemberId: MEMBER1_ID,
          anonymousMemberRef: "member_1",
          portionSize: "regular",
          spiceLevel: "regular",
          easePreferences: [],
          dislikes: [],
        },
      ],
    },
    meal_type: "breakfast",
    cuisine_genre: "japanese",
    servings: 2,
    total_elapsed_minutes: 15,
    output_schema_version: "2026-07-11.v1",
    dishes: [
      {
        id: DISH2_ID,
        role: "side",
        position: 2,
        name: "温野菜",
        description: "加熱した野菜",
        cooking_time_minutes: 5,
        dish_ingredients: [
          {
            id: INGREDIENT2_ID,
            position: 1,
            name: "にんじん",
            quantity_value: 0.5,
            quantity_text: "1/2本",
            unit: "本",
            store_section: "produce",
            pantry_selection_id: null,
            label_confirmation_required: false,
          },
        ],
        recipe_steps: [{ id: STEP2_ID, position: 1, instruction: "やわらかく加熱する" }],
        menu_member_adaptations: [],
      },
      {
        id: DISH1_ID,
        role: "main",
        position: 1,
        name: "塩おにぎり",
        description: "朝の主食",
        cooking_time_minutes: 10,
        dish_ingredients: [
          {
            id: INGREDIENT3_ID,
            position: 2,
            name: "のり",
            quantity_value: 1,
            quantity_text: "1枚",
            unit: "枚",
            store_section: "dry_goods",
            pantry_selection_id: null,
            label_confirmation_required: false,
          },
          {
            id: INGREDIENT1_ID,
            position: 1,
            // 永続材料名と source_text_snapshot は生成時に一致する。
            // loader は name ではなく source_text_snapshot 列だけを sourceText に写す。
            name: "ごはん",
            quantity_value: 300,
            quantity_text: "300g",
            unit: "g",
            store_section: "dry_goods",
            pantry_selection_id: PANTRY_SELECTION_ID,
            label_confirmation_required: true,
          },
        ],
        recipe_steps: [{ id: STEP1_ID, position: 1, instruction: "ごはんを握る" }],
        menu_member_adaptations: [
          {
            id: ADAPTATION_ID,
            dish_id: DISH1_ID,
            anonymous_member_ref: "member_1",
            portion_text: "取り分け量を確認",
            branch_before_recipe_step_id: STEP1_ID,
            additional_cutting: "一口大にする",
            additional_heating: null,
            additional_seasoning: null,
            serving_check: "小さくちぎって渡す",
            safety_tags: ["small_bite"],
            menu_safety_actions: [
              {
                id: "28000000-0000-4000-8000-000000000001",
                dish_id: DISH1_ID,
                ingredient_id: INGREDIENT1_ID,
                anonymous_member_ref: "member_1",
                before_recipe_step_id: STEP1_ID,
                position: 1,
                kind: "cut_small",
                instruction: "食べやすい大きさにほぐしてください",
              },
            ],
          },
        ],
      },
    ],
    menu_timeline_steps: [
      {
        id: TIMELINE_ID,
        position: 1,
        start_minute: 0,
        duration_minutes: 10,
        instruction: "おにぎりを作る",
        dish_id: DISH1_ID,
        recipe_step_id: STEP1_ID,
      },
    ],
    generation_pantry_selections: [
      {
        id: PANTRY_SELECTION_ID,
        pantry_item_id: "29000000-0000-4000-8000-000000000001",
        pantry_name_snapshot: "ごはん",
        priority: "must_use",
        usage_status: "used",
        planned_quantity: 300,
        inventory_quantity_snapshot: 200,
        shortage_quantity: 100,
        unit: "g",
        unused_reason: null,
      },
    ],
    menu_target_members: [
      {
        household_member_id: MEMBER1_ID,
        member_display_name_snapshot: "きろく1",
        anonymous_ref: "member_1",
        current_member: { display_name: "子ども" },
      },
    ],
    menu_label_confirmations: [
      {
        source_type: "ingredient",
        source_id: INGREDIENT1_ID,
        source_path: "dishes.0.ingredients.0.name",
        source_text_snapshot: "ごはん",
        allergen_id: "wheat",
        anonymous_member_ref: "member_1",
        dictionary_version: "jp-caa-2026-04.v1",
        confirmation_status: "confirmed",
        confirmed_at: "2026-07-11T01:00:00.000Z",
        confirmed_by: CONFIRMED_BY,
      },
      {
        source_type: "ingredient",
        source_id: INGREDIENT1_ID,
        source_path: "dishes.0.ingredients.0.quantityText",
        source_text_snapshot: "300g",
        allergen_id: "wheat",
        anonymous_member_ref: "member_1",
        dictionary_version: "jp-caa-2026-04.v1",
        confirmation_status: "pending",
        confirmed_at: null,
        confirmed_by: null,
      },
    ],
    ...overrides,
  };
}

function mockClient(result: { data: unknown; error: unknown }) {
  const eqCalls: Array<[string, unknown]> = [];
  const chain = {
    eq: vi.fn((column: string, value: unknown) => {
      eqCalls.push([column, value]);
      return chain;
    }),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  };
  const select = vi.fn(() => chain);
  const from = vi.fn(() => ({ select }));
  return { from, select, chain, eqCalls };
}

describe("STORED_MENU_SELECT", () => {
  it("pins every nested relation with an exact owner-composite !constraint token", () => {
    for (const token of requiredConstraintTokens) {
      expect(STORED_MENU_SELECT).toContain(token);
    }
    // bare 埋め込み（`relation(` で `!constraint` なし）を許さない
    for (const relation of [
      "menu_target_members",
      "dishes",
      "dish_ingredients",
      "recipe_steps",
      "menu_member_adaptations",
      "menu_safety_actions",
      "menu_timeline_steps",
      "generation_pantry_selections",
      "menu_label_confirmations",
    ] as const) {
      expect(STORED_MENU_SELECT).not.toMatch(new RegExp(`\\b${relation}\\s*\\(`, "u"));
    }
  });
});

describe("loadStoredMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reconstructs the normalized aggregate and keeps source_text_snapshot as sourceText", async () => {
    const client = mockClient({ data: rawStoredMenuRow(), error: null });
    const aggregate = await loadStoredMenu(client as never, USER_ID, MENU_ID);

    expect(client.eqCalls).toEqual([
      ["id", MENU_ID],
      ["user_id", USER_ID],
    ]);
    expect(aggregate.userId).toBe(USER_ID);
    expect(aggregate.safetyFingerprint).toBe("b".repeat(64));
    expect(aggregate.derivationGroupId).toBe("c1000000-0000-4000-8000-000000000001");
    expect(aggregate.version).toBe(2);
    expect(aggregate.preferenceSnapshot).toMatchObject({
      memberPreferences: [expect.objectContaining({ householdMemberId: MEMBER1_ID })],
    });
    expect(aggregate.menu.dishes.map((dish) => dish.id)).toEqual([DISH1_ID, DISH2_ID]);
    expect(aggregate.menu.dishes[0]?.ingredients.map((item) => item.id)).toEqual([
      INGREDIENT1_ID,
      INGREDIENT3_ID,
    ]);
    expect(aggregate.menu.dishes[0]?.steps.map((step) => step.id)).toEqual([STEP1_ID]);
    expect(aggregate.menu.timeline.map((step) => step.id)).toEqual([TIMELINE_ID]);
    expect(aggregate.menu.adaptations).toEqual([
      expect.objectContaining({
        id: ADAPTATION_ID,
        dishId: DISH1_ID,
        safetyActions: [
          expect.objectContaining({
            kind: "cut_small",
            ingredientId: INGREDIENT1_ID,
            instruction: "食べやすい大きさにほぐしてください",
          }),
        ],
      }),
    ]);
    expect(aggregate.menu.pantryUsage).toEqual([
      expect.objectContaining({
        selectionId: PANTRY_SELECTION_ID,
        pantryItemName: "ごはん",
        dishIds: [DISH1_ID],
      }),
    ]);
    // 現行材料名が snapshot と異なっても、ValidatedMenu は永続 snapshot を保持する
    expect(aggregate.menu.labelConfirmations[0]).toMatchObject({
      sourceText: "ごはん",
      confirmationStatus: "confirmed",
      confirmedAt: "2026-07-11T01:00:00.000Z",
      confirmedBy: CONFIRMED_BY,
    });
    expect(aggregate.menu.labelConfirmations[1]).toMatchObject({
      sourceText: "300g",
      confirmationStatus: "pending",
    });
    expect(aggregate.targetMemberIds).toEqual([MEMBER1_ID]);
    expect(aggregate.targetMembers[0]).toMatchObject({
      householdMemberId: MEMBER1_ID,
      displayName: "子ども",
      displayNameSnapshot: "きろく1",
    });
  });

  it("keeps deleted members for display only and omits them from targetMemberIds", async () => {
    const client = mockClient({
      data: rawStoredMenuRow({
        menu_target_members: [
          {
            household_member_id: null,
            member_display_name_snapshot: "削除済みの家族",
            anonymous_ref: "member_1",
            current_member: null,
          },
          {
            household_member_id: MEMBER2_ID,
            member_display_name_snapshot: "きろく2",
            anonymous_ref: "member_2",
            current_member: { display_name: " " },
          },
        ],
      }),
      error: null,
    });
    const aggregate = await loadStoredMenu(client as never, USER_ID, MENU_ID);
    expect(aggregate.targetMemberIds).toEqual([MEMBER2_ID]);
    expect(aggregate.targetMembers).toEqual([
      {
        householdMemberId: null,
        anonymousMemberRef: "member_1",
        displayNameSnapshot: "削除済みの家族",
        displayName: "削除済みの家族",
      },
      {
        householdMemberId: MEMBER2_ID,
        anonymousMemberRef: "member_2",
        displayNameSnapshot: "きろく2",
        // live が空白のみなら snapshot へフォールバック
        displayName: "きろく2",
      },
    ]);
  });

  it("numerically sorts member_10 before member_2 regardless of reverse insertion order", async () => {
    const client = mockClient({
      data: rawStoredMenuRow({
        menu_target_members: [
          {
            household_member_id: MEMBER10_ID,
            member_display_name_snapshot: "10番",
            anonymous_ref: "member_10",
            current_member: { display_name: "十" },
          },
          {
            household_member_id: MEMBER2_ID,
            member_display_name_snapshot: "2番",
            anonymous_ref: "member_2",
            current_member: { display_name: "二" },
          },
        ],
      }),
      error: null,
    });
    const aggregate = await loadStoredMenu(client as never, USER_ID, MENU_ID);
    expect(aggregate.targetMembers.map((item) => item.anonymousMemberRef)).toEqual([
      "member_2",
      "member_10",
    ]);
    expect(aggregate.targetMemberIds).toEqual([MEMBER2_ID, MEMBER10_ID]);
  });

  it("returns indistinguishable 404 for missing and foreign menus", async () => {
    const missing = mockClient({ data: null, error: null });
    await expect(loadStoredMenu(missing as never, USER_ID, MENU_ID)).rejects.toMatchObject({
      status: 404,
      code: "menu_not_found",
    } satisfies Partial<HttpError>);

    const foreign = mockClient({ data: null, error: null });
    await expect(loadStoredMenu(foreign as never, "foreign-user", MENU_ID)).rejects.toMatchObject({
      status: 404,
      code: "menu_not_found",
    });
  });

  it("fails closed when PostgREST returns an error", async () => {
    const client = mockClient({ data: null, error: { message: "boom" } });
    await expect(loadStoredMenu(client as never, USER_ID, MENU_ID)).rejects.toMatchObject({
      status: 503,
      code: "menu_load_failed",
    });
  });
});

describe("toStoredRevalidationCandidate", () => {
  it("derives current pending confirmations without mutating the stored menu", () => {
    const stored = makeValidatedMenu({
      dishes: makeValidatedMenu().dishes.map((dish, dishIndex) =>
        dishIndex === 0
          ? {
              ...dish,
              ingredients: dish.ingredients.map((ingredient, ingredientIndex) =>
                ingredientIndex === 0
                  ? { ...ingredient, name: "しょうゆ", labelConfirmationRequired: true }
                  : ingredient,
              ),
            }
          : dish,
      ),
      labelConfirmations: [
        {
          sourceType: "ingredient",
          sourceId: "53000000-0000-4000-8000-000000000001",
          sourcePath: "dishes.0.ingredients.0.name",
          sourceText: "古いスナップショット",
          allergenId: "wheat",
          anonymousMemberRef: "member_1",
          dictionaryVersion: "jp-caa-2026-04.v1",
          confirmationStatus: "confirmed",
          confirmedAt: "2026-07-11T01:00:00.000Z",
          confirmedBy: CONFIRMED_BY,
        },
      ],
    });
    const historicalConfirmations = structuredClone(stored.labelConfirmations);
    const safety = makeCurrentSafetyContext({
      members: [
        {
          householdMemberId: "55000000-0000-4000-8000-000000000001",
          anonymousRef: "member_1",
          ageBand: "adult",
          allergyStatus: "registered",
          allergenIds: ["wheat"],
          hasUnmappedCustomAllergy: false,
          requiredSafetyConstraints: [],
          unsupportedDietStatus: "none",
          unsupportedDietKinds: [],
        },
      ],
      allergenDictionary: {
        version: "jp-caa-2026-04.v1",
        catalog: makeCurrentSafetyContext().allergenDictionary.catalog,
        aliases: [
          ...makeCurrentSafetyContext().allergenDictionary.aliases,
          {
            allergenId: "wheat",
            alias: "しょうゆ",
            normalizedAlias: "しょうゆ",
            aliasKind: "processed",
            requiresLabelConfirmation: true,
            dictionaryVersion: "jp-caa-2026-04.v1",
          },
        ],
      },
    });
    const context = makeGenerationContext({ safety });
    const candidate = toStoredRevalidationCandidate(stored, context);

    expect(stored.labelConfirmations).toEqual(historicalConfirmations);
    expect(candidate.labelConfirmations.map((item) => item.confirmationStatus)).toEqual(
      candidate.labelConfirmations.map(() => "pending" as const),
    );
    expect(candidate.labelConfirmations.some((item) => item.sourceText === "しょうゆ")).toBe(true);
    expect(candidate.dishes[0]?.steps[0]?.instruction).toBe(
      stored.dishes[0]?.steps[0]?.instruction,
    );

    // アレルギー削除後は旧 confirmation を要求しない
    const withoutAllergy = makeGenerationContext({
      safety: makeCurrentSafetyContext({
        members: [
          {
            ...safety.members[0]!,
            allergenIds: [],
            allergyStatus: "none",
          },
        ],
      }),
    });
    const cleared = toStoredRevalidationCandidate(stored, withoutAllergy);
    expect(cleared.labelConfirmations).toEqual([]);
  });
});
