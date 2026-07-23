import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generatedMenuSchema,
  validatedMenuSchema,
  type GeneratedMenu,
  type ValidatedMenu,
} from "../../../shared/contracts/generation.js";
import type { TargetMode } from "../../../shared/contracts/planner.js";
import { deriveCurrentGeneratedLabelConfirmations } from "../../../shared/safety/allergens.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";
import type { Database } from "../../../src/shared/types/database.js";
import { HttpError } from "./http.js";

/** identity-only: 家族/adaptation/catalog を nested select しない軽量読出し */
export type StoredMenuIdentity = {
  id: string;
  userId: string;
  version: number;
  targetMode: TargetMode;
};

export type StoredMenuAggregate = {
  menu: ValidatedMenu;
  userId: string;
  safetyFingerprint: string;
  derivationGroupId: string;
  version: number;
  preferenceSnapshot: unknown;
  targetMemberIds: readonly string[];
  targetMembers: readonly {
    householdMemberId: string | null;
    anonymousMemberRef: string;
    displayNameSnapshot: string;
    displayName: string;
  }[];
};

// 所有者複合 FK を !constraint で固定し、PostgREST の曖昧な関係推論を避ける。
// adaptation は dish 所有者関係のみ、safety actions は adaptation 配下に載せる。
export const STORED_MENU_SELECT = `
  id,user_id,safety_fingerprint,derivation_group_id,version,preference_snapshot,
  meal_type,cuisine_genre,servings,total_elapsed_minutes,output_schema_version,
  menu_target_members!menu_target_members_menu_owner_fkey(
    household_member_id,member_display_name_snapshot,anonymous_ref,
    current_member:household_members!menu_target_members_member_owner_fkey(display_name)),
  dishes!dishes_menu_owner_fkey(id,role,position,name,description,cooking_time_minutes,
    dish_ingredients!dish_ingredients_dish_owner_fkey(
      id,position,name,quantity_value,quantity_text,unit,store_section,
      pantry_selection_id,label_confirmation_required),
    recipe_steps!recipe_steps_dish_owner_fkey(id,position,instruction),
    menu_member_adaptations!menu_member_adaptations_dish_owner_fkey(
      id,dish_id,anonymous_member_ref,portion_text,branch_before_recipe_step_id,
      additional_cutting,additional_heating,additional_seasoning,serving_check,safety_tags,
      menu_safety_actions!menu_safety_actions_adaptation_owner_fkey(
        id,dish_id,ingredient_id,anonymous_member_ref,before_recipe_step_id,
        position,kind,instruction))),
  menu_timeline_steps!menu_timeline_steps_menu_owner_fkey(
    id,position,start_minute,duration_minutes,instruction,dish_id,recipe_step_id),
  generation_pantry_selections!generation_pantry_selections_menu_owner_fkey(
    id,pantry_item_id,pantry_name_snapshot,priority,
    usage_status,planned_quantity,inventory_quantity_snapshot,shortage_quantity,unit,unused_reason),
  menu_label_confirmations!menu_label_confirmations_menu_owner_fkey(
    source_type,source_id,source_path,source_text_snapshot,allergen_id,
    anonymous_member_ref,dictionary_version,confirmation_status,confirmed_at,confirmed_by)
` as const;

export function buildStoredMenuQuery(
  client: SupabaseClient<Database>,
  userId: string,
  menuId: string,
) {
  return client
    .from("menus")
    .select(STORED_MENU_SELECT)
    .eq("id", menuId)
    .eq("user_id", userId)
    .maybeSingle();
}

/**
 * owner-scoped で id/user_id/version/target_mode だけを読む。
 * 買い物 idea 拒否と revalidate-menu の mode 境界用。full aggregate とは分離する。
 */
export async function loadStoredMenuIdentity(
  client: SupabaseClient<Database>,
  userId: string,
  menuId: string,
): Promise<StoredMenuIdentity> {
  const { data, error } = await client
    .from("menus")
    .select("id,user_id,version,target_mode")
    .eq("id", menuId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error !== null) throw new HttpError(503, "menu_load_failed", "献立を読み込めませんでした");
  if (data === null) throw new HttpError(404, "menu_not_found", "献立が見つかりません");
  if (data.target_mode !== "household" && data.target_mode !== "idea") {
    throw new HttpError(503, "menu_load_failed", "献立を読み込めませんでした");
  }
  return {
    id: data.id,
    userId: data.user_id,
    version: data.version,
    targetMode: data.target_mode,
  };
}

/**
 * JWT 所有者境界で正規化献立を読み、ValidatedMenu 集約へ閉じる。
 * service-role の先行 lookup は所有権証明に使わない。
 */
export async function loadStoredMenu(
  client: SupabaseClient<Database>,
  userId: string,
  menuId: string,
): Promise<StoredMenuAggregate> {
  const { data, error } = await buildStoredMenuQuery(client, userId, menuId);
  if (error !== null) throw new HttpError(503, "menu_load_failed", "献立を読み込めませんでした");
  if (data === null) throw new HttpError(404, "menu_not_found", "献立が見つかりません");

  const dishes = data.dishes
    .toSorted((a, b) => a.position - b.position)
    .map((dish) => ({
      id: dish.id,
      role: dish.role,
      position: dish.position,
      name: dish.name,
      description: dish.description,
      cookingTimeMinutes: dish.cooking_time_minutes,
      ingredients: dish.dish_ingredients
        .toSorted((a, b) => a.position - b.position)
        .map((item) => ({
          id: item.id,
          position: item.position,
          name: item.name,
          quantityValue: item.quantity_value,
          quantityText: item.quantity_text,
          unit: item.unit,
          storeSection: item.store_section,
          pantrySelectionId: item.pantry_selection_id,
          labelConfirmationRequired: item.label_confirmation_required,
        })),
      steps: dish.recipe_steps
        .toSorted((a, b) => a.position - b.position)
        .map((step) => ({
          id: step.id,
          position: step.position,
          instruction: step.instruction,
        })),
    }));

  const pantryDishIds = new Map<string, Set<string>>();
  for (const dish of dishes) {
    for (const ingredient of dish.ingredients) {
      if (ingredient.pantrySelectionId === null) continue;
      const ids = pantryDishIds.get(ingredient.pantrySelectionId) ?? new Set<string>();
      ids.add(dish.id);
      pantryDishIds.set(ingredient.pantrySelectionId, ids);
    }
  }

  // adaptation は dish 配下のみ。menu 直下の関係は存在しない。
  const adaptations = data.dishes.flatMap((dishRow) =>
    dishRow.menu_member_adaptations.map((item) => ({
      id: item.id,
      dishId: item.dish_id,
      anonymousMemberRef: item.anonymous_member_ref,
      portionText: item.portion_text,
      branchBeforeRecipeStepId: item.branch_before_recipe_step_id,
      additionalCutting: item.additional_cutting,
      additionalHeating: item.additional_heating,
      additionalSeasoning: item.additional_seasoning,
      servingCheck: item.serving_check,
      safetyTags: item.safety_tags,
      safetyActions: item.menu_safety_actions
        .toSorted((a, b) => a.position - b.position)
        .map((action) => ({
          kind: action.kind,
          dishId: action.dish_id,
          ingredientId: action.ingredient_id,
          anonymousMemberRef: action.anonymous_member_ref,
          beforeRecipeStepId: action.before_recipe_step_id,
          instruction: action.instruction,
        })),
    })),
  );

  const menu = validatedMenuSchema.parse({
    schemaVersion: data.output_schema_version,
    menuId: data.id,
    mealType: data.meal_type,
    cuisineGenre: data.cuisine_genre,
    servings: data.servings,
    totalElapsedMinutes: data.total_elapsed_minutes,
    safetyTags: [...new Set(adaptations.flatMap((item) => item.safetyTags))],
    dishes,
    timeline: data.menu_timeline_steps
      .toSorted((a, b) => a.position - b.position)
      .map((item) => ({
        id: item.id,
        position: item.position,
        startMinute: item.start_minute,
        durationMinutes: item.duration_minutes,
        instruction: item.instruction,
        dishId: item.dish_id,
        recipeStepId: item.recipe_step_id,
      })),
    adaptations,
    pantryUsage: data.generation_pantry_selections.map((item) => ({
      selectionId: item.id,
      pantryItemId: item.pantry_item_id,
      pantryItemName: item.pantry_name_snapshot,
      priority: item.priority,
      usageStatus: item.usage_status,
      plannedQuantity: item.planned_quantity,
      inventoryQuantity: item.inventory_quantity_snapshot,
      shortageQuantity: item.shortage_quantity,
      unit: item.unit,
      dishIds: [...(pantryDishIds.get(item.id) ?? new Set<string>())],
      unusedReason: item.unused_reason,
    })),
    // sourceText は永続スナップショットのみ。動的再構成しない。
    labelConfirmations: data.menu_label_confirmations.map((item) => ({
      sourceType: item.source_type,
      sourceId: item.source_id,
      sourcePath: item.source_path,
      sourceText: item.source_text_snapshot,
      allergenId: item.allergen_id,
      anonymousMemberRef: item.anonymous_member_ref,
      dictionaryVersion: item.dictionary_version,
      confirmationStatus: item.confirmation_status,
      confirmedAt: item.confirmed_at,
      confirmedBy: item.confirmed_by,
    })),
  });

  // PostgREST 返却順や文字列順は権威にせず、regex 制約の数値 suffix で並べる。
  const targetMembers = data.menu_target_members
    .toSorted(
      (left, right) =>
        Number(left.anonymous_ref.slice("member_".length)) -
        Number(right.anonymous_ref.slice("member_".length)),
    )
    .map((item, index) => ({
      householdMemberId: item.household_member_id,
      anonymousMemberRef: item.anonymous_ref,
      displayNameSnapshot: item.member_display_name_snapshot,
      // live 名 → 不変 snapshot → 家族N。nullable live link を snapshot から復元しない。
      displayName:
        item.current_member?.display_name?.trim() ||
        item.member_display_name_snapshot.trim() ||
        `家族${String(index + 1)}`,
    }));

  return {
    menu,
    userId: data.user_id,
    safetyFingerprint: data.safety_fingerprint,
    derivationGroupId: data.derivation_group_id,
    version: data.version,
    preferenceSnapshot: data.preference_snapshot,
    targetMembers,
    // 削除済みリンクは fingerprint / loadCurrentSafety に渡さない
    targetMemberIds: targetMembers.flatMap((item) =>
      item.householdMemberId === null ? [] : [item.householdMemberId],
    ),
  };
}

/**
 * 履歴の confirmed 証跡を捨て、現行 pending の generated 形へ投影する。
 * 保存済み ValidatedMenu は変更しない。idea は家族 safety を持たないため空確認のまま。
 */
export function toStoredRevalidationCandidate(
  menu: ValidatedMenu,
  context: GenerationContext,
): GeneratedMenu {
  if (context.targetMode === "idea") {
    return generatedMenuSchema.parse({
      ...menu,
      labelConfirmations: [],
    });
  }
  return generatedMenuSchema.parse({
    ...menu,
    labelConfirmations: deriveCurrentGeneratedLabelConfirmations(menu, context.safety),
  });
}
