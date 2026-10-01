import { describe, expect, it, vi } from "vitest";
import {
  HOUSEHOLD_SAVED_REFRESH_FAILED,
  INGREDIENT_DISLIKE_PARTIAL_SAVED,
  ingredientDislikeSavedMessage,
  planIngredientDislikeOps,
  saveIngredientDislikes,
  type DislikeBaselineRow,
  type IngredientDislikeWriter,
  type SaveIngredientDislikesInput,
} from "./save-ingredient-dislikes";

const memberA = "member-a";
const memberB = "member-b";

function row(id: string, memberId: string, ingredientName: string): DislikeBaselineRow {
  return { id, memberId, ingredientName };
}

function input(overrides: Partial<SaveIngredientDislikesInput> = {}): SaveIngredientDislikesInput {
  return {
    openedName: "にんじん",
    currentName: "にんじん",
    memberIds: [memberA, memberB],
    checkedMemberIds: new Set([memberA]),
    baseline: [row("row-a", memberA, "にんじん")],
    ...overrides,
  };
}

function harness(overrides: Partial<IngredientDislikeWriter> = {}) {
  const addMemberDislike = vi.fn<IngredientDislikeWriter["addMemberDislike"]>(() =>
    Promise.resolve({ id: "created" }),
  );
  const deleteMemberDislike = vi.fn<IngredientDislikeWriter["deleteMemberDislike"]>(async () => {});
  const listMemberDislikes = vi.fn<IngredientDislikeWriter["listMemberDislikes"]>(() =>
    Promise.resolve([]),
  );
  const invalidate = vi.fn<() => Promise<void>>(async () => {});
  const client: IngredientDislikeWriter = {
    addMemberDislike,
    deleteMemberDislike,
    listMemberDislikes,
    ...overrides,
  };
  return { client, addMemberDislike, deleteMemberDislike, listMemberDislikes, invalidate };
}

describe("planIngredientDislikeOps", () => {
  it("adds a checked member who does not have the current name", () => {
    const ops = planIngredientDislikeOps(input({ checkedMemberIds: new Set([memberA, memberB]) }));
    expect(ops).toEqual([{ kind: "add", memberId: memberB, ingredientName: "にんじん" }]);
  });

  it("deletes only the opened name when that person is unchecked", () => {
    const ops = planIngredientDislikeOps(input({ checkedMemberIds: new Set() }));
    expect(ops).toEqual([{ kind: "delete", memberId: memberA, dislikeId: "row-a" }]);
  });

  it("adds the new name and does not delete the old name when the name changes", () => {
    const ops = planIngredientDislikeOps(
      input({
        openedName: "鶏むね肉",
        currentName: " 鶏肉 ",
        checkedMemberIds: new Set([memberA]),
        baseline: [row("old", memberA, "鶏むね肉")],
      }),
    );
    expect(ops).toEqual([{ kind: "add", memberId: memberA, ingredientName: "鶏肉" }]);
  });

  it("does not delete a new name the unchecked person already has", () => {
    const ops = planIngredientDislikeOps(
      input({
        openedName: "鶏むね肉",
        currentName: "鶏肉",
        checkedMemberIds: new Set(),
        baseline: [row("new-name", memberA, "鶏肉")],
      }),
    );
    expect(ops).toEqual([]);
  });

  it("does not plan a save when the normalized name is empty or too long", () => {
    expect(planIngredientDislikeOps(input({ currentName: "  " }))).toEqual([]);
    expect(planIngredientDislikeOps(input({ currentName: "あ".repeat(81) }))).toEqual([]);
  });
});

describe("saveIngredientDislikes", () => {
  it("does not call the writer or invalidate when there is no diff", async () => {
    const { client, addMemberDislike, deleteMemberDislike, invalidate } = harness();
    await expect(saveIngredientDislikes(client, input(), invalidate)).resolves.toEqual({
      kind: "no_diff",
    });
    expect(addMemberDislike).not.toHaveBeenCalled();
    expect(deleteMemberDislike).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("invalidates after a resolved delete even when the row was already gone", async () => {
    const { client, deleteMemberDislike, invalidate } = harness();
    const result = await saveIngredientDislikes(
      client,
      input({ checkedMemberIds: new Set() }),
      invalidate,
    );
    expect(deleteMemberDislike).toHaveBeenCalledWith("row-a");
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe("saved");
    if (result.kind !== "saved") return;
    expect(result).toMatchObject({ deleted: 1, inserted: 0, refreshFailed: false });
    expect(ingredientDislikeSavedMessage(result)).toBe("にんじんの苦手を外しました");
  });

  it("refetches on any add failure and does not count an existing row as a commit", async () => {
    const listed = vi.fn<IngredientDislikeWriter["listMemberDislikes"]>((memberId) =>
      Promise.resolve(memberId === memberB ? [row("existing", memberB, " にんじん ")] : []),
    );
    const { client, invalidate } = harness({
      addMemberDislike: vi.fn(() =>
        Promise.reject(new Error("苦手食材は1〜80文字で重複なく登録してください")),
      ),
      listMemberDislikes: listed,
    });
    const result = await saveIngredientDislikes(
      client,
      input({ checkedMemberIds: new Set([memberA, memberB]) }),
      invalidate,
    );
    expect(listed).toHaveBeenCalledWith(memberB);
    expect(invalidate).not.toHaveBeenCalled();
    expect(result.kind).toBe("saved");
    if (result.kind !== "saved") return;
    expect(result).toMatchObject({
      inserted: 0,
      alreadyPresent: 1,
      deleted: 0,
      refreshFailed: false,
    });
    expect(ingredientDislikeSavedMessage(result)).toBe("にんじんを苦手に覚えました");
  });

  it("stops when the refetch does not find the name, and does not invalidate before any commit", async () => {
    const { client, invalidate } = harness({
      addMemberDislike: vi.fn(() => Promise.reject(new Error("登録に失敗しました"))),
    });
    const result = await saveIngredientDislikes(
      client,
      input({ checkedMemberIds: new Set([memberA, memberB]) }),
      invalidate,
    );
    expect(invalidate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      kind: "stopped",
      inserted: 0,
      deleted: 0,
      message: "登録に失敗しました",
    });
  });

  it("uses a non-Error fallback and appends the partial sentence after a commit", async () => {
    const { client, invalidate } = harness({
      addMemberDislike: vi.fn((memberId: string) => {
        if (memberId === memberB) {
          // 失敗理由が Error でないとき、追加のフォールバック文になることを固定する。
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- 非 Error の拒否をそのまま渡す
          return Promise.reject({ reason: "nope" });
        }
        return Promise.resolve({ id: "created" });
      }),
    });
    const result = await saveIngredientDislikes(
      client,
      input({ checkedMemberIds: new Set([memberA, memberB]), baseline: [] }),
      invalidate,
    );
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe("stopped");
    if (result.kind !== "stopped") return;
    expect(result.message).toContain("苦手食材を追加できませんでした");
    expect(result.message).toContain(INGREDIENT_DISLIKE_PARTIAL_SAVED);
    expect(result.nextCheckedMemberIds).toEqual([]);
    expect(result.refreshFailed).toBe(false);
  });

  it("keeps the dialog baseline unchanged when the alignment refetch fails", async () => {
    let calls = 0;
    const { client } = harness({
      addMemberDislike: vi.fn(() => Promise.reject(new Error("登録に失敗しました"))),
      listMemberDislikes: vi.fn(() => {
        calls += 1;
        if (calls === 1) return Promise.resolve([]);
        return Promise.reject(new Error("苦手食材を読み込めませんでした"));
      }),
    });
    const result = await saveIngredientDislikes(
      client,
      input({ checkedMemberIds: new Set([memberB]), baseline: [] }),
      vi.fn(async () => {}),
    );
    expect(result).toMatchObject({
      kind: "stopped",
      nextCheckedMemberIds: null,
      nextBaseline: null,
    });
    if (result.kind !== "stopped") return;
    expect(result.message).toContain("苦手食材を読み込めませんでした");
  });

  it("closes with only the refresh failure sentence when every write succeeded", async () => {
    const { client } = harness();
    const result = await saveIngredientDislikes(
      client,
      input({ checkedMemberIds: new Set([memberA, memberB]) }),
      vi.fn(() => Promise.reject(new Error("cache"))),
    );
    expect(result.kind).toBe("saved");
    if (result.kind !== "saved") return;
    expect(result).toMatchObject({ refreshFailed: true, inserted: 1 });
    expect(ingredientDislikeSavedMessage(result)).toBe(HOUSEHOLD_SAVED_REFRESH_FAILED);
    expect(HOUSEHOLD_SAVED_REFRESH_FAILED).toBe(
      "家族設定を保存しました。画面の再確認に失敗したため、献立・履歴を開き直すか再読み込みしてください。",
    );
  });

  it("appends the refresh failure sentence when a later write stops after a commit", async () => {
    const { client, addMemberDislike } = harness({
      deleteMemberDislike: vi.fn(() => Promise.reject(new Error("苦手食材を削除できませんでした"))),
    });
    const result = await saveIngredientDislikes(
      client,
      input({
        // 追加が先、削除が後。削除で止めても追加はコミット済みになる。
        memberIds: [memberB, memberA],
        checkedMemberIds: new Set([memberB]),
        baseline: [row("row-a", memberA, "にんじん")],
      }),
      vi.fn(() => Promise.reject(new Error("cache"))),
    );
    expect(addMemberDislike).toHaveBeenCalledWith(memberB, "にんじん");
    expect(result.kind).toBe("stopped");
    if (result.kind !== "stopped") return;
    expect(result.refreshFailed).toBe(true);
    expect(result.message).toContain("苦手食材を削除できませんでした");
    expect(result.message).toContain(INGREDIENT_DISLIKE_PARTIAL_SAVED);
    expect(result.message).toContain(HOUSEHOLD_SAVED_REFRESH_FAILED);
  });
});
