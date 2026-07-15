import { expect, it, vi } from "vitest";
import {
  addMemberDislike,
  addCustomMemberAllergy,
  deleteMemberAllergy,
  startHouseholdOnboarding,
} from "./household-api";

function chain(data: unknown, error: unknown = null) {
  const result = {
    eq: vi.fn(),
    order: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
    insert: vi.fn(),
  };
  for (const method of [result.eq, result.order, result.select, result.insert])
    method.mockReturnValue(result);
  result.single.mockResolvedValue({ data, error });
  return result;
}

it("normalizes custom allergy and dislike names at the repository boundary", async () => {
  const allergyResult = { id: "allergy-1" };
  const dislikeResult = { id: "dislike-1" };
  const dislikeChain = chain(dislikeResult);
  const rpc = vi.fn().mockResolvedValue({ data: allergyResult, error: null });
  const client = {
    rpc,
    from: vi.fn().mockReturnValueOnce(dislikeChain),
  } as never;
  await addCustomMemberAllergy(client, "user-1", "member-1", "  ＡＢＣ  ", []);
  await addMemberDislike(client, "user-1", "member-1", "  ねぎ  ");
  expect(rpc).toHaveBeenCalledWith("add_custom_member_allergy", {
    p_member_id: "member-1",
    p_custom_name: "ABC",
    p_custom_aliases: [],
  });
  expect(dislikeChain.insert).toHaveBeenCalledWith(
    expect.objectContaining({ ingredient_name: "ねぎ" }),
  );
});

it("rejects empty or oversized dislike names", async () => {
  const client = {} as never;
  await expect(addMemberDislike(client, "user-1", "member-1", " ")).rejects.toThrow("1〜80文字");
  await expect(addMemberDislike(client, "user-1", "member-1", "a".repeat(81))).rejects.toThrow(
    "1〜80文字",
  );
});

it("deletes an allergy through the serialized database boundary", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const client = { rpc } as never;

  await deleteMemberAllergy(client, "user-1", "allergy-1");

  expect(rpc).toHaveBeenCalledWith("delete_member_allergy", {
    p_allergy_id: "allergy-1",
  });
});

it("starts onboarding through the atomic database boundary", async () => {
  const created = { id: "member-1", status: "draft" };
  const rpc = vi.fn().mockResolvedValue({ data: created, error: null });
  const client = { rpc } as never;

  await expect(startHouseholdOnboarding(client, 2)).resolves.toBe(created);

  expect(rpc).toHaveBeenCalledWith("start_household_onboarding", {
    p_sort_order: 2,
  });
});
