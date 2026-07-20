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
const STEP1_ID = "23000000-0000-4000-8000-000000000001";
const STEP2_ID = "23000000-0000-4000-8000-000000000002";
const ADAPTATION_ID = "24000000-0000-4000-8000-000000000001";
const TIMELINE_ID = "25000000-0000-4000-8000-000000000001";
const PANTRY_SELECTION_USED_ID = "26000000-0000-4000-8000-000000000001";
const PANTRY_SELECTION_UNUSED_ID = "26000000-0000-4000-8000-000000000002";
const CONFIRMATION_ROW_ID = "27000000-0000-4000-8000-000000000001";

// PostgREST から返る行を意図的に非ソート順（料理は position 降順）で用意し、
// マッパーが position/id で正規化して並べ直すことを検証する。
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
        name: "ごはん",
        description: "朝の主食",
        cooking_time_minutes: 10,
        dish_ingredients: [
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
        recipe_steps: [{ id: STEP1_ID, position: 1, instruction: "ごはんを握る" }],
        menu_member_adaptations: [
          {
            id: ADAPTATION_ID,
            dish_id: DISH1_ID,
            anonymous_member_ref: "member_1",
            portion_text: "取り分け量を確認",
            branch_before_recipe_step_id: STEP1_ID,
            additional_cutting: null,
            additional_heating: null,
            additional_seasoning: null,
            serving_check: "小さくちぎって渡す",
            safety_tags: [],
            menu_safety_actions: [
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
    expect(result.menu.menuId).toBe(MENU_ID);
    expect(result.menu.mealType).toBe("breakfast");

    // 取り分けの安全手順は正規化された配列として保持される。
    const adaptation = result.menu.adaptations.find((item) => item.id === ADAPTATION_ID);
    expect(adaptation?.safetyActions).toEqual([
      {
        kind: "cut_small",
        dishId: DISH1_ID,
        ingredientId: INGREDIENT1_ID,
        anonymousMemberRef: "member_1",
        beforeRecipeStepId: STEP1_ID,
        instruction: "食べやすい大きさにほぐしてください",
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
    expect(result.memberLabels).toEqual({ member_1: "子ども", member_2: "家族2" });

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
