import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import type { Tables } from "@/shared/types/database.generated";
import {
  deletePlannerDraft,
  mapPlannerDraft,
  savePlannerDraft,
  startPlannerDraftKeepaliveSave,
} from "./planner-api";

vi.mock("@/shared/config/public-env", () => ({
  getPublicEnv: () => ({
    supabaseUrl: "http://127.0.0.1:8000",
    supabasePublishableKey: "sb_publishable_testkeyforunloadpersistpath",
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

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
  ingredient_preference: null,
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
          ingredientPreference: null,
          avoidIngredients: [],
          memo: "",
          pantrySelections: [],
        },
        2,
      ),
    ).rejects.toMatchObject({ code: "draft_revision_conflict" });
  });

  it("P2: document unload 用保存は keepalive fetch で同一 RPC 引数を送る", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const started = startPlannerDraftKeepaliveSave(
      "access-token-for-unload",
      {
        mealType: "dinner",
        mainIngredients: ["鶏肉"],
        cuisineGenre: "japanese",
        targetMode: "household",
        targetMemberIds: ["70000000-0000-4000-8000-000000000001"],
        servings: null,
        timeLimitMinutes: null,
        budgetPreference: null,
        ingredientPreference: null,
        avoidIngredients: [],
        memo: "野菜多め",
        pantrySelections: [],
      },
      3,
    );

    expect(started).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8000/rest/v1/rpc/save_generation_draft");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(init.headers).toEqual(
      expect.objectContaining({
        apikey: "sb_publishable_testkeyforunloadpersistpath",
        Authorization: "Bearer access-token-for-unload",
        "Content-Type": "application/json",
      }),
    );
    const body = init.body;
    if (typeof body !== "string") {
      throw new Error("keepalive body は JSON 文字列である");
    }
    expect(JSON.parse(body)).toEqual({
      p_expected_revision: 3,
      p_meal_type: "dinner",
      p_main_ingredients: ["鶏肉"],
      p_cuisine_genre: "japanese",
      p_target_mode: "household",
      p_target_member_ids: ["70000000-0000-4000-8000-000000000001"],
      p_servings: null,
      p_time_limit_minutes: null,
      p_budget_preference: null,
      p_ingredient_preference: null,
      p_avoid_ingredients: [],
      p_memo: "野菜多め",
      p_pantry_selections: [],
    });
  });
});
