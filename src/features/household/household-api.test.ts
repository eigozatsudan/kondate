import { expect, it, vi } from "vitest";
import {
  addMemberDislike,
  addCustomMemberAllergy,
  createHouseholdMemberDraft,
  deleteMemberAllergy,
  HouseholdMemberVersionConflictError,
  setOnboardingStatus,
  startHouseholdOnboarding,
  updateCompleteHouseholdMember,
} from "./household-api";

function chain(data: unknown, error: unknown = null) {
  const result = {
    eq: vi.fn(),
    order: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };
  for (const method of [result.eq, result.order, result.select, result.insert, result.update])
    method.mockReturnValue(result);
  result.single.mockResolvedValue({ data, error });
  result.maybeSingle.mockResolvedValue({ data, error });
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

// H12: 純句読点/Cf は collision normalize 後 empty。RPC 前にクライアントで拒否する。
it("rejects custom allergy names that collapse to empty after collision normalize (H12)", async () => {
  const client = {} as never;
  await expect(addCustomMemberAllergy(client, "user-1", "member-1", "、。", [])).rejects.toThrow(
    "1〜80文字",
  );
  await expect(addCustomMemberAllergy(client, "user-1", "member-1", "\u200b", [])).rejects.toThrow(
    "1〜80文字",
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
  // H8: 所有行無しでも RPC は error なし（silent success）。クライアントは error のみ throw。
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

it("createHouseholdMemberDraft reuses start_household_onboarding RPC (H11)", async () => {
  // 直 INSERT は複数 draft 並立を許すため、原子 start RPC に寄せる
  const created = { id: "member-1", status: "draft" };
  const rpc = vi.fn().mockResolvedValue({ data: created, error: null });
  const from = vi.fn();
  const client = { rpc, from } as never;

  await expect(createHouseholdMemberDraft(client, "user-1", 3)).resolves.toBe(created);

  expect(rpc).toHaveBeenCalledWith("start_household_onboarding", {
    p_sort_order: 3,
  });
  expect(from).not.toHaveBeenCalled();
});

it("setOnboardingStatus sends expectedStatus for welcome CAS", async () => {
  const profile = { onboarding_status: "skipped" };
  const rpc = vi.fn().mockResolvedValue({ data: profile, error: null });
  const client = { rpc } as never;
  await expect(
    setOnboardingStatus(client, "user-1", "skipped", { expectedStatus: "not_started" }),
  ).resolves.toBe(profile);
  expect(rpc).toHaveBeenCalledWith("set_onboarding_status", {
    p_status: "skipped",
    p_expected_status: "not_started",
  });
});

it("setOnboardingStatus omits p_expected_status when not requested", async () => {
  const profile = { onboarding_status: "in_progress" };
  const rpc = vi.fn().mockResolvedValue({ data: profile, error: null });
  const client = { rpc } as never;
  await setOnboardingStatus(client, "user-1", "in_progress");
  expect(rpc).toHaveBeenCalledWith("set_onboarding_status", {
    p_status: "in_progress",
  });
});

// H5: complete 更新は updated_at CAS（pantry と同型）。0 行は競合。
it("updateCompleteHouseholdMember CAS-guards with expectedUpdatedAt", async () => {
  const saved = {
    id: "member-1",
    status: "complete",
    allergy_status: "registered",
    updated_at: "2026-07-12T00:00:00.000Z",
  };
  const updateChain = chain(saved);
  const client = { from: vi.fn().mockReturnValue(updateChain) } as never;
  const patch = { allergy_status: "registered" as const };

  await expect(
    updateCompleteHouseholdMember(client, "user-1", "member-1", patch, "2026-07-11T00:00:00.000Z"),
  ).resolves.toBe(saved);

  expect(updateChain.update).toHaveBeenCalledWith(patch);
  expect(updateChain.eq.mock.calls).toEqual([
    ["id", "member-1"],
    ["user_id", "user-1"],
    ["status", "complete"],
    ["updated_at", "2026-07-11T00:00:00.000Z"],
  ]);
  expect(updateChain.maybeSingle).toHaveBeenCalled();
});

it("updateCompleteHouseholdMember throws conflict when CAS misses (H5)", async () => {
  const updateChain = chain(null);
  const client = { from: vi.fn().mockReturnValue(updateChain) } as never;

  await expect(
    updateCompleteHouseholdMember(
      client,
      "user-1",
      "member-1",
      { allergy_status: "none" },
      "2026-07-11T00:00:00.000Z",
    ),
  ).rejects.toMatchObject({
    name: "HouseholdMemberVersionConflictError",
    code: "household_member_version_conflict",
  });
  expect(HouseholdMemberVersionConflictError).toBeDefined();
});
