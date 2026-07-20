import type { QueryData } from "@supabase/supabase-js";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { buildMenuResultQuery, getMenuResult } from "./menu-result-api";

const getBrowserSupabaseClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: getBrowserSupabaseClientMock,
}));

// menu-result-api.ts の埋め込みヒント（*_owner_fkey）が Plan 2 のマイグレーションで
// 確定した制約名と一致し続けることを型検査の時点で固定する。所有者複合外部キーが
// 消失・改名された場合、モックを any に落とすだけのテストでは検出できず実装前に
// 気付けないため、生成されたクエリ行の型自体を expectTypeOf で固定する。
type MenuResultQueryRow = NonNullable<QueryData<ReturnType<typeof buildMenuResultQuery>>>;

it("keeps every nested relation on the named owner-composite FK", () => {
  expectTypeOf<MenuResultQueryRow["dishes"][number]["dish_ingredients"]>().toBeArray();
  expectTypeOf<MenuResultQueryRow["dishes"][number]["recipe_steps"]>().toBeArray();
  expectTypeOf<
    MenuResultQueryRow["dishes"][number]["menu_member_adaptations"][number]["menu_safety_actions"]
  >().toBeArray();
  expectTypeOf<
    MenuResultQueryRow["menu_target_members"][number]["household_members"]
  >().not.toBeAny();
  expectTypeOf<
    MenuResultQueryRow["menu_label_confirmations"][number]["allergen_catalog"]
  >().not.toBeAny();
  expectTypeOf<
    MenuResultQueryRow["menu_label_confirmations"][number]["source_text_snapshot"]
  >().toEqualTypeOf<string>();
});

const MENU_ID = "20000000-0000-4000-8000-000000000001";
const DISH1_ID = "21000000-0000-4000-8000-000000000001";
const DISH2_ID = "21000000-0000-4000-8000-000000000002";
const INGREDIENT1_ID = "22000000-0000-4000-8000-000000000001";
const INGREDIENT2_ID = "22000000-0000-4000-8000-000000000002";
const INGREDIENT3_ID = "22000000-0000-4000-8000-000000000003";
const INGREDIENT4_ID = "22000000-0000-4000-8000-000000000004";
const STEP1_ID = "23000000-0000-4000-8000-000000000001";
const STEP2_ID = "23000000-0000-4000-8000-000000000002";
const STEP3_ID = "23000000-0000-4000-8000-000000000003";
const STEP4_ID = "23000000-0000-4000-8000-000000000004";
const ADAPTATION_ID = "24000000-0000-4000-8000-000000000001";
const ADAPTATION2_ID = "24000000-0000-4000-8000-000000000002";
const TIMELINE_ID = "25000000-0000-4000-8000-000000000001";
const TIMELINE2_ID = "25000000-0000-4000-8000-000000000002";
const PANTRY_SELECTION_USED_ID = "26000000-0000-4000-8000-000000000001";
const PANTRY_SELECTION_UNUSED_ID = "26000000-0000-4000-8000-000000000002";
const CONFIRMATION_ROW_ID = "27000000-0000-4000-8000-000000000001";

// PostgREST から返る行を意図的に非ソート順（料理・取り分けは降順）で用意し、
// マッパーがposition/idで正規化して並べ直すことを検証する。各ネスト配列も2件以上にし、
// 先頭要素だけが偶然正しいfixtureでは並び替えの欠落を見逃さないようにする。
function rawMenuRow() {
  return {
    id: MENU_ID,
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
            id: INGREDIENT4_ID,
            position: 2,
            name: "ブロッコリー",
            quantity_value: 40,
            quantity_text: "40g",
            unit: "g",
            store_section: "produce",
            pantry_selection_id: null,
            label_confirmation_required: false,
          },
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
        recipe_steps: [
          { id: STEP4_ID, position: 2, instruction: "器に盛る" },
          { id: STEP2_ID, position: 1, instruction: "やわらかく加熱する" },
        ],
        menu_member_adaptations: [
          {
            id: ADAPTATION2_ID,
            dish_id: DISH2_ID,
            anonymous_member_ref: "member_2",
            portion_text: "副菜を半量取り分ける",
            branch_before_recipe_step_id: STEP2_ID,
            additional_cutting: "野菜を5mm角に切る",
            additional_heating: "追加で3分加熱する",
            additional_seasoning: "味付け前に取り分ける",
            serving_check: "十分に冷まして配膳する",
            safety_tags: ["soft_vegetable"],
            menu_safety_actions: [
              {
                dish_id: DISH2_ID,
                ingredient_id: INGREDIENT2_ID,
                anonymous_member_ref: "member_2",
                before_recipe_step_id: STEP2_ID,
                position: 1,
                kind: "soften",
                instruction: "にんじんを歯ぐきでつぶせる硬さにする",
              },
            ],
          },
        ],
      },
      {
        id: DISH1_ID,
        role: "main",
        position: 1,
        name: "ごはん",
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
            name: "ごはん",
            quantity_value: 300,
            quantity_text: "300g",
            unit: "g",
            store_section: "dry_goods",
            pantry_selection_id: PANTRY_SELECTION_USED_ID,
            label_confirmation_required: false,
          },
        ],
        recipe_steps: [
          { id: STEP3_ID, position: 2, instruction: "のりを巻く" },
          { id: STEP1_ID, position: 1, instruction: "ごはんを握る" },
        ],
        menu_member_adaptations: [
          {
            id: ADAPTATION_ID,
            dish_id: DISH1_ID,
            anonymous_member_ref: "member_1",
            portion_text: "取り分け量を確認",
            branch_before_recipe_step_id: STEP1_ID,
            additional_cutting: "ごはんを一口大にする",
            additional_heating: "中心まで再加熱する",
            additional_seasoning: "塩を加える前に取り分ける",
            serving_check: "小さくちぎって渡す",
            safety_tags: ["small_bite"],
            menu_safety_actions: [
              {
                dish_id: DISH1_ID,
                ingredient_id: INGREDIENT3_ID,
                anonymous_member_ref: "member_1",
                before_recipe_step_id: STEP3_ID,
                position: 2,
                kind: "cut_small",
                instruction: "のりを細かくちぎってください",
              },
              {
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
        id: TIMELINE2_ID,
        position: 2,
        start_minute: 10,
        duration_minutes: 5,
        instruction: "料理を盛り付ける",
        dish_id: DISH2_ID,
        recipe_step_id: STEP4_ID,
      },
      {
        id: TIMELINE_ID,
        position: 1,
        start_minute: 0,
        duration_minutes: 10,
        instruction: "野菜を加熱しながらごはんを握る",
        dish_id: DISH1_ID,
        recipe_step_id: STEP1_ID,
      },
    ],
    generation_pantry_selections: [
      {
        id: PANTRY_SELECTION_UNUSED_ID,
        pantry_item_id: "29000000-0000-4000-8000-000000000002",
        pantry_name_snapshot: "小松菜",
        priority: "prefer_use",
        usage_status: "unused",
        planned_quantity: null,
        inventory_quantity_snapshot: null,
        shortage_quantity: null,
        unit: null,
        unused_reason: "傷んでいたため使わなかった",
      },
      {
        id: PANTRY_SELECTION_USED_ID,
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
        anonymous_ref: "member_3",
        member_display_name_snapshot: " ",
        household_members: { display_name: " " },
      },
      {
        anonymous_ref: "member_2",
        member_display_name_snapshot: "家族2",
        household_members: null,
      },
      {
        anonymous_ref: "member_1",
        member_display_name_snapshot: "きろく1",
        household_members: { display_name: "子ども" },
      },
    ],
    menu_label_confirmations: [
      {
        id: CONFIRMATION_ROW_ID,
        source_type: "ingredient",
        source_id: INGREDIENT1_ID,
        source_path: "dishes.0.ingredients.0.name",
        source_text_snapshot: "ごはん",
        allergen_id: "wheat",
        anonymous_member_ref: "member_1",
        dictionary_version: "jp-caa-2026-04.v1",
        requirement_safety_fingerprint: "a".repeat(64),
        is_current: true,
        confirmation_status: "pending",
        confirmed_at: null,
        confirmed_by: null,
        allergen_catalog: { display_name: "小麦" },
      },
    ],
  };
}

function mockClient(result: { data: unknown; error: unknown }) {
  const chain = {
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  };
  const from = vi.fn(() => ({ select: vi.fn(() => chain) }));
  return { from };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getMenuResult", () => {
  it("所有者のRLS集約を並び替え・正規化したビューモデルへ変換する", async () => {
    getBrowserSupabaseClientMock.mockReturnValue(mockClient({ data: rawMenuRow(), error: null }));

    const result = await getMenuResult(MENU_ID);

    // 料理はDB上position降順で返っても、position昇順に並び替わる。
    expect(result.menu.dishes.map((dish) => dish.id)).toEqual([DISH1_ID, DISH2_ID]);
    expect(result.menu.dishes[0]?.ingredients.map((item) => item.id)).toEqual([
      INGREDIENT1_ID,
      INGREDIENT3_ID,
    ]);
    expect(result.menu.dishes[1]?.ingredients.map((item) => item.id)).toEqual([
      INGREDIENT2_ID,
      INGREDIENT4_ID,
    ]);
    expect(result.menu.dishes[0]?.steps.map((step) => step.id)).toEqual([STEP1_ID, STEP3_ID]);
    expect(result.menu.dishes[1]?.steps.map((step) => step.id)).toEqual([STEP2_ID, STEP4_ID]);
    expect(result.menu.timeline.map((step) => step.id)).toEqual([TIMELINE_ID, TIMELINE2_ID]);
    expect(result.menu.menuId).toBe(MENU_ID);
    expect(result.menu.mealType).toBe("breakfast");

    // 取り分けの安全手順は正規化された配列として保持される。
    expect(result.menu.adaptations).toEqual([
      {
        id: ADAPTATION_ID,
        dishId: DISH1_ID,
        anonymousMemberRef: "member_1",
        portionText: "取り分け量を確認",
        branchBeforeRecipeStepId: STEP1_ID,
        additionalCutting: "ごはんを一口大にする",
        additionalHeating: "中心まで再加熱する",
        additionalSeasoning: "塩を加える前に取り分ける",
        servingCheck: "小さくちぎって渡す",
        safetyTags: ["small_bite"],
        safetyActions: [
          {
            kind: "cut_small",
            dishId: DISH1_ID,
            ingredientId: INGREDIENT1_ID,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: STEP1_ID,
            instruction: "食べやすい大きさにほぐしてください",
          },
          {
            kind: "cut_small",
            dishId: DISH1_ID,
            ingredientId: INGREDIENT3_ID,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: STEP3_ID,
            instruction: "のりを細かくちぎってください",
          },
        ],
      },
      {
        id: ADAPTATION2_ID,
        dishId: DISH2_ID,
        anonymousMemberRef: "member_2",
        portionText: "副菜を半量取り分ける",
        branchBeforeRecipeStepId: STEP2_ID,
        additionalCutting: "野菜を5mm角に切る",
        additionalHeating: "追加で3分加熱する",
        additionalSeasoning: "味付け前に取り分ける",
        servingCheck: "十分に冷まして配膳する",
        safetyTags: ["soft_vegetable"],
        safetyActions: [
          {
            kind: "soften",
            dishId: DISH2_ID,
            ingredientId: INGREDIENT2_ID,
            anonymousMemberRef: "member_2",
            beforeRecipeStepId: STEP2_ID,
            instruction: "にんじんを歯ぐきでつぶせる硬さにする",
          },
        ],
      },
    ]);

    // 冷蔵庫食材の使用先は ingredient.pantry_selection_id から dish 単位に導出される。
    const usedPantry = result.menu.pantryUsage.find(
      (item) => item.selectionId === PANTRY_SELECTION_USED_ID,
    );
    expect(usedPantry?.dishIds).toEqual([DISH1_ID]);
    expect(usedPantry?.shortageQuantity).toBe(100);
    const unusedPantry = result.menu.pantryUsage.find(
      (item) => item.selectionId === PANTRY_SELECTION_UNUSED_ID,
    );
    expect(unusedPantry?.unusedReason).toBe("傷んでいたため使わなかった");

    // 家族ラベルは anonymous_ref の番号順に並び、household_members の表示名が
    // スナップショットより優先される。
    expect(result.memberLabels).toEqual({
      member_1: "子ども",
      member_2: "家族2",
      member_3: "家族3",
    });

    // ラベル確認はDBの確認行id・不変の原文スナップショット・人間可読な
    // アレルゲン名／家族名を持つ。
    expect(result.labelConfirmations).toEqual([
      {
        confirmationId: CONFIRMATION_ROW_ID,
        sourceType: "ingredient",
        sourceId: INGREDIENT1_ID,
        sourcePath: "dishes.0.ingredients.0.name",
        sourceText: "ごはん",
        allergenName: "小麦",
        memberLabel: "子ども",
        dictionaryVersion: "jp-caa-2026-04.v1",
        confirmationStatus: "pending",
        requirementSafetyFingerprint: "a".repeat(64),
        isCurrent: true,
        confirmedAt: null,
        confirmedBy: null,
      },
    ]);
  });

  it("行が見つからない場合はmenu_not_foundを送出する", async () => {
    getBrowserSupabaseClientMock.mockReturnValue(mockClient({ data: null, error: null }));

    await expect(getMenuResult(MENU_ID)).rejects.toThrow("menu_not_found");
  });

  it("他ユーザーの献立などRLSにより不可視な場合もmenu_not_foundを送出する", async () => {
    getBrowserSupabaseClientMock.mockReturnValue(
      mockClient({ data: null, error: { message: "not found", code: "PGRST116" } }),
    );

    await expect(getMenuResult(MENU_ID)).rejects.toThrow("menu_not_found");
  });
});
