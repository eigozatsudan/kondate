import { expect, it, vi } from "vitest";
import { addMemberDislike, addCustomMemberAllergy } from "./household-api";

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
  const allergyChain = chain(allergyResult);
  const dislikeResult = { id: "dislike-1" };
  const dislikeChain = chain(dislikeResult);
  const client = {
    from: vi.fn().mockReturnValueOnce(allergyChain).mockReturnValueOnce(dislikeChain),
  } as never;
  await addCustomMemberAllergy(client, "user-1", "member-1", "  ＡＢＣ  ", []);
  await addMemberDislike(client, "user-1", "member-1", "  ねぎ  ");
  expect(allergyChain.insert).toHaveBeenCalledWith(expect.objectContaining({ custom_name: "ABC" }));
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
