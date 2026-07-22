import {
  type PlannerDraft,
  type PlannerDraftInput,
  plannerDraftSchema,
} from "@shared/contracts/planner";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import type { Tables } from "@/shared/types/database.generated";

export const plannerKeys = {
  draft: (userId: string) => ["planner", "draft", userId] as const,
};

export class DraftRevisionConflictError extends Error {
  readonly code = "draft_revision_conflict" as const;

  constructor() {
    super("別の画面で献立条件が更新されました");
    this.name = "DraftRevisionConflictError";
  }
}

export function mapPlannerDraft(row: Tables<"generation_drafts">): PlannerDraft {
  return plannerDraftSchema.parse({
    id: row.id,
    userId: row.user_id,
    mealType: row.meal_type,
    mainIngredients: row.main_ingredients,
    cuisineGenre: row.cuisine_genre,
    targetMode: row.target_mode,
    targetMemberIds: row.target_member_ids,
    servings: row.servings,
    timeLimitMinutes: row.time_limit_minutes,
    budgetPreference: row.budget_preference,
    avoidIngredients: row.avoid_ingredients,
    memo: row.memo,
    pantrySelections: row.pantry_selections,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function getPlannerDraft(
  client: BrowserSupabaseClient,
  userId: string,
): Promise<PlannerDraft | null> {
  const { data, error } = await client
    .from("generation_drafts")
    .select(
      "id,user_id,meal_type,main_ingredients,cuisine_genre,target_mode,target_member_ids,servings,time_limit_minutes,budget_preference,avoid_ingredients,memo,pantry_selections,revision,created_at,updated_at,deleted_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error !== null) throw new Error("献立条件の下書きを読み込めませんでした");
  return data === null ? null : mapPlannerDraft(data);
}

export async function savePlannerDraft(
  client: BrowserSupabaseClient,
  _userId: string,
  input: PlannerDraftInput,
  revision: number,
): Promise<PlannerDraft> {
  const { data, error } = await client.rpc("save_generation_draft", {
    p_expected_revision: revision,
    p_meal_type: input.mealType,
    p_main_ingredients: input.mainIngredients,
    p_cuisine_genre: input.cuisineGenre,
    p_target_mode: input.targetMode,
    p_target_member_ids: input.targetMemberIds,
    p_servings: input.servings,
    p_time_limit_minutes: input.timeLimitMinutes,
    p_budget_preference: input.budgetPreference,
    p_avoid_ingredients: input.avoidIngredients,
    p_memo: input.memo,
    p_pantry_selections: input.pantrySelections,
  });
  if (error !== null) {
    if (error.message.includes("draft_revision_conflict")) throw new DraftRevisionConflictError();
    throw new Error("献立条件を保存できませんでした");
  }
  return mapPlannerDraft(data);
}

export async function deletePlannerDraft(
  client: BrowserSupabaseClient,
  expectedRevision: number,
): Promise<void> {
  const { error } = await client.rpc("delete_generation_draft", {
    p_expected_revision: expectedRevision,
  });
  if (error?.message.includes("draft_revision_conflict") === true) {
    throw new DraftRevisionConflictError();
  }
  if (error !== null) throw new Error("献立条件の下書きを削除できませんでした");
}
