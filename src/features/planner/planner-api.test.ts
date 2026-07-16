import { describe, expect, it, vi } from "vitest";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import { deletePlannerDraft, savePlannerDraft } from "./planner-api";

function clientWithRpc(result: unknown) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as BrowserSupabaseClient, rpc };
}

describe("planner draft API", () => {
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
          targetMemberIds: [],
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
