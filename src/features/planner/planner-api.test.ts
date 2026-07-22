import { describe, expect, it, vi } from "vitest";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import type { Tables } from "@/shared/types/database.generated";
import { deletePlannerDraft, mapPlannerDraft, savePlannerDraft } from "./planner-api";

function clientWithRpc(result: unknown) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as BrowserSupabaseClient, rpc };
}

const incompleteTargetDraft = {
  id: "71000000-0000-4000-8000-000000000001",
  user_id: "72000000-0000-4000-8000-000000000001",
  meal_type: "dinner",
  main_ingredients: ["鶏肉"],
  cuisine_genre: "japanese",
  target_mode: null,
  target_member_ids: [],
  servings: null,
  time_limit_minutes: null,
  budget_preference: null,
  avoid_ingredients: [],
  memo: "",
  pantry_selections: [],
  revision: 1,
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:00.000Z",
} as unknown as Tables<"generation_drafts">;

describe("planner draft API", () => {
  it("keeps mode and servings unselected for an incomplete draft", () => {
    expect(mapPlannerDraft(incompleteTargetDraft)).toMatchObject({
      targetMode: null,
      targetMemberIds: [],
      servings: null,
      mealType: "dinner",
      mainIngredients: ["鶏肉"],
      cuisineGenre: "japanese",
    });
  });

  it("authoritative revision を削除 RPC に渡す", async () => {
    const { client, rpc } = clientWithRpc({ error: null });
    await deletePlannerDraft(client, 7);
    expect(rpc).toHaveBeenCalledWith("delete_generation_draft", {
      p_expected_revision: 7,
    });
  });

  it("古い revision の削除を共通 conflict code に変換する", async () => {
    const { client } = clientWithRpc({
      error: { message: "draft_revision_conflict" },
    });
    await expect(deletePlannerDraft(client, 7)).rejects.toMatchObject({
      code: "draft_revision_conflict",
    });
  });

  it("古い revision の保存を fail closed にする", async () => {
    const { client } = clientWithRpc({
      data: null,
      error: { message: "draft_revision_conflict" },
    });
    await expect(
      savePlannerDraft(
        client,
        "72000000-0000-0000-0000-000000000001",
        {
          mealType: null,
          mainIngredients: [],
          cuisineGenre: null,
          targetMode: null,
          targetMemberIds: [],
          servings: null,
          timeLimitMinutes: null,
          budgetPreference: null,
          avoidIngredients: [],
          memo: "",
          pantrySelections: [],
        },
        2,
      ),
    ).rejects.toMatchObject({ code: "draft_revision_conflict" });
  });
});
