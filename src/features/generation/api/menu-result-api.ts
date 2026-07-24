import { pantryItemSchema } from "@shared/contracts/pantry";
import { validatedMenuSchema } from "@shared/contracts/generation";
import type { MenuResultViewModel, PantryPostCookTarget } from "@shared/contracts/menu-result";
import { plannerSubmissionSchema, targetModeSchema } from "@shared/contracts/planner";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";

export type { MenuResultViewModel, PantryPostCookTarget } from "@shared/contracts/menu-result";

// RLSで保護された献立集約を、所有者セッションから見える正規化テーブルだけで
// 再構成するクエリ。埋め込みヒントは Plan 2 のマイグレーションで確定した
// 所有者複合外部キー名（*_owner_fkey）を明示することで、無関係な多対多経路への
// 誤解決を防ぐ。
export function buildMenuResultQuery(
  client: ReturnType<typeof getBrowserSupabaseClient>,
  menuId: string,
) {
  return client
    .from("menus")
    .select(
      `
      id, meal_type, cuisine_genre, servings, total_elapsed_minutes, output_schema_version,
      target_mode, preference_snapshot, is_favorite,
      dishes!dishes_menu_owner_fkey (
        id, role, position, name, description, cooking_time_minutes,
        dish_ingredients!dish_ingredients_dish_owner_fkey (
          id, position, name, quantity_value, quantity_text, unit, store_section,
          pantry_selection_id, label_confirmation_required
        ),
        recipe_steps!recipe_steps_dish_owner_fkey (id, position, instruction),
        menu_member_adaptations!menu_member_adaptations_dish_owner_fkey (
          id, dish_id, anonymous_member_ref, portion_text, branch_before_recipe_step_id,
          additional_cutting, additional_heating, additional_seasoning, serving_check, safety_tags,
          menu_safety_actions!menu_safety_actions_adaptation_owner_fkey (
            dish_id, ingredient_id, anonymous_member_ref,
            before_recipe_step_id, position, kind, instruction
          )
        )
      ),
      menu_timeline_steps!menu_timeline_steps_menu_owner_fkey (
        id, position, start_minute, duration_minutes, instruction, dish_id, recipe_step_id
      ),
      generation_pantry_selections!generation_pantry_selections_menu_owner_fkey (
        id, pantry_item_id, pantry_name_snapshot, priority, usage_status, planned_quantity,
        inventory_quantity_snapshot, shortage_quantity, unit, unused_reason
      ),
      menu_target_members!menu_target_members_menu_owner_fkey (
        anonymous_ref, member_display_name_snapshot,
        household_members!menu_target_members_member_owner_fkey (display_name)
      ),
      menu_label_confirmations!menu_label_confirmations_menu_owner_fkey (
        id, source_type, source_id, source_path, source_text_snapshot,
        allergen_id, anonymous_member_ref,
        dictionary_version, requirement_safety_fingerprint, is_current,
        confirmation_status, confirmed_at, confirmed_by,
        allergen_catalog!menu_label_confirmations_allergen_id_fkey (display_name)
      )
    `,
    )
    .eq("id", menuId)
    .eq("menu_label_confirmations.is_current", true)
    .maybeSingle();
}

/** used 選択に紐づく live pantry_items を所有者 RLS で読み、mutation version に使う。 */
async function loadLivePantryRows(
  client: ReturnType<typeof getBrowserSupabaseClient>,
  pantryItemIds: readonly string[],
): Promise<
  Map<
    string,
    Pick<
      ReturnType<typeof pantryItemSchema.parse>,
      | "id"
      | "name"
      | "quantity"
      | "unit"
      | "expiresOn"
      | "expirationType"
      | "openedState"
      | "updatedAt"
    >
  >
> {
  const map = new Map<
    string,
    Pick<
      ReturnType<typeof pantryItemSchema.parse>,
      | "id"
      | "name"
      | "quantity"
      | "unit"
      | "expiresOn"
      | "expirationType"
      | "openedState"
      | "updatedAt"
    >
  >();
  if (pantryItemIds.length === 0) return map;
  const { data, error } = await client
    .from("pantry_items")
    .select(
      "id, name, quantity, unit, expires_on, expiration_type, opened_state, updated_at, user_id, created_at",
    )
    .in("id", [...pantryItemIds]);
  if (error !== null) return map;
  for (const row of data) {
    const parsed = pantryItemSchema.safeParse({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      quantity: row.quantity,
      unit: row.unit,
      expiresOn: row.expires_on,
      expirationType: row.expiration_type,
      openedState: row.opened_state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
    if (!parsed.success) continue;
    map.set(parsed.data.id, {
      id: parsed.data.id,
      name: parsed.data.name,
      quantity: parsed.data.quantity,
      unit: parsed.data.unit,
      expiresOn: parsed.data.expiresOn,
      expirationType: parsed.data.expirationType,
      openedState: parsed.data.openedState,
      updatedAt: parsed.data.updatedAt,
    });
  }
  return map;
}

export async function getMenuResult(menuId: string): Promise<MenuResultViewModel> {
  const client = getBrowserSupabaseClient();
  const { data, error } = await buildMenuResultQuery(client, menuId);

  if (error || !data) throw new Error("menu_not_found");
  const dishes = [...data.dishes]
    .sort((a, b) => a.position - b.position)
    .map((dish) => ({
      id: dish.id,
      role: dish.role,
      position: dish.position,
      name: dish.name,
      description: dish.description,
      cookingTimeMinutes: dish.cooking_time_minutes,
      ingredients: [...dish.dish_ingredients]
        .sort((a, b) => a.position - b.position)
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
      steps: [...dish.recipe_steps]
        .sort((a, b) => a.position - b.position)
        .map((step) => ({
          id: step.id,
          position: step.position,
          instruction: step.instruction,
        })),
    }));
  const pantryDishIds = new Map<string, Set<string>>();
  for (const dish of dishes) {
    for (const ingredient of dish.ingredients) {
      if (!ingredient.pantrySelectionId) continue;
      const ids = pantryDishIds.get(ingredient.pantrySelectionId) ?? new Set<string>();
      ids.add(dish.id);
      pantryDishIds.set(ingredient.pantrySelectionId, ids);
    }
  }
  const adaptations = data.dishes
    .flatMap((dish) => dish.menu_member_adaptations)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => ({
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
      safetyActions: [...item.menu_safety_actions]
        .sort((a, b) => a.position - b.position)
        .map((action) => ({
          kind: action.kind,
          dishId: action.dish_id,
          ingredientId: action.ingredient_id,
          anonymousMemberRef: action.anonymous_member_ref,
          beforeRecipeStepId: action.before_recipe_step_id,
          instruction: action.instruction,
        })),
    }));
  const menu = validatedMenuSchema.parse({
    schemaVersion: data.output_schema_version,
    menuId: data.id,
    mealType: data.meal_type,
    cuisineGenre: data.cuisine_genre,
    servings: data.servings,
    totalElapsedMinutes: data.total_elapsed_minutes,
    safetyTags: [...new Set(adaptations.flatMap((item) => item.safetyTags))],
    dishes,
    timeline: [...data.menu_timeline_steps]
      .sort((a, b) => a.position - b.position)
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
  const memberLabels = new Map(
    [...data.menu_target_members]
      .sort(
        (a, b) =>
          Number(a.anonymous_ref.slice("member_".length)) -
          Number(b.anonymous_ref.slice("member_".length)),
      )
      .map(
        (item, index) =>
          [
            item.anonymous_ref,
            item.household_members?.display_name?.trim() ||
              item.member_display_name_snapshot.trim() ||
              `家族${String(index + 1)}`,
          ] as const,
      ),
  );
  const canonicalConfirmations = new Map(
    menu.labelConfirmations.map(
      (item) =>
        [
          [
            item.sourceType,
            item.sourceId,
            item.sourcePath,
            item.allergenId,
            item.anonymousMemberRef,
          ].join(":"),
          item,
        ] as const,
    ),
  );

  // used 選択の live pantry 行を同一所有者 RLS 境界で読み mutation version に使う
  const usedSelections = data.generation_pantry_selections.filter(
    (item) => item.usage_status === "used",
  );
  const liveIds = usedSelections
    .map((item) => item.pantry_item_id)
    .filter((id): id is string => id !== null);
  const liveRows = await loadLivePantryRows(client, liveIds);

  const pantryPostCookTargets: PantryPostCookTarget[] = usedSelections.map((item) => {
    const pantryItemId = item.pantry_item_id;
    const live = pantryItemId === null ? undefined : liveRows.get(pantryItemId);
    // 削除済み・RLS 外は pantryItemId を null に閉じ、mutation 制御を出さない
    if (pantryItemId === null || live === undefined) {
      return {
        selectionId: item.id,
        pantryItemId: null,
        pantryItemName: item.pantry_name_snapshot,
        plannedQuantity: item.planned_quantity,
        unit: item.unit,
        currentPantryRow: null,
      };
    }
    return {
      selectionId: item.id,
      pantryItemId,
      pantryItemName: item.pantry_name_snapshot,
      plannedQuantity: item.planned_quantity,
      unit: item.unit,
      currentPantryRow: live,
    };
  });

  // preference_snapshot.submission は idea/household 双方で保存されるが、形が
  // 崩れている・欠落している場合は安全側に倒し sourceSubmission を null にする
  // （存在しない家族条件を捏造してUIへ渡さないため）。
  const submissionCandidate = (data.preference_snapshot as { submission?: unknown } | null)
    ?.submission;
  const submissionParsed = plannerSubmissionSchema.safeParse(submissionCandidate);
  const sourceSubmission = submissionParsed.success ? submissionParsed.data : null;

  // target_mode はDB制約で household|idea のいずれかしか入らないが、境界を
  // 二重に守るため受信側でも zod で確定させ、未知の値は menu_not_found として
  // 扱う（家族安全表示の判定元を不明な値に委ねない）。
  const targetModeParsed = targetModeSchema.safeParse(data.target_mode);
  if (!targetModeParsed.success) throw new Error("menu_not_found");

  return {
    targetMode: targetModeParsed.data,
    sourceSubmission,
    // menus.is_favorite は DB/生成型とも boolean 非 null。そのまま投影する。
    isFavorite: data.is_favorite,
    menu,
    memberLabels: Object.fromEntries(memberLabels),
    labelConfirmations: data.menu_label_confirmations.map((item) => {
      const key = [
        item.source_type,
        item.source_id,
        item.source_path,
        item.allergen_id,
        item.anonymous_member_ref,
      ].join(":");
      const canonical = canonicalConfirmations.get(key);
      if (canonical === undefined) throw new Error("menu_confirmation_mapping_failed");
      return {
        confirmationId: item.id,
        sourceType: canonical.sourceType,
        sourceId: canonical.sourceId,
        sourcePath: canonical.sourcePath,
        sourceText: item.source_text_snapshot,
        allergenName: item.allergen_catalog.display_name.trim() || "確認対象アレルゲン",
        memberLabel: memberLabels.get(canonical.anonymousMemberRef) ?? "家族",
        dictionaryVersion: canonical.dictionaryVersion,
        confirmationStatus: canonical.confirmationStatus,
        requirementSafetyFingerprint: item.requirement_safety_fingerprint,
        isCurrent: true as const,
        confirmedAt: canonical.confirmedAt,
        confirmedBy: canonical.confirmedBy,
      };
    }),
    pantryPostCookTargets,
  };
}
