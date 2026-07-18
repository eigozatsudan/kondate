import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type {
  AllergenCatalogRow,
  HouseholdMemberPatch,
  HouseholdMemberRow,
  MemberAllergyRow,
} from "./household-api";
import { householdKeys } from "./household-queries";
import { HouseholdSettingsForm, type HouseholdSettingsApi } from "./household-settings-page";

const member: HouseholdMemberRow = {
  id: "member-1",
  user_id: "user-1",
  status: "complete",
  display_name: "大人",
  age_band: "adult",
  portion_size: "regular",
  spice_level: "regular",
  ease_preferences: [],
  required_safety_constraints: [],
  allergy_status: "none",
  unsupported_diet_status: "none",
  unsupported_diet_kinds: [],
  sort_order: 0,
  created_at: "2026-07-11T00:00:00.000Z",
  updated_at: "2026-07-11T00:00:00.000Z",
};

const catalog: AllergenCatalogRow[] = [
  {
    id: "walnut",
    display_name: "くるみ",
    regulatory_class: "standard",
    catalog_version: "2026-07-11",
    created_at: "2026-07-11T00:00:00.000Z",
  },
];

const standardAllergy: MemberAllergyRow = {
  id: "allergy-1",
  user_id: "user-1",
  member_id: "member-1",
  allergen_id: "walnut",
  custom_name: null,
  custom_aliases: [],
  custom_confirmed: false,
  created_at: "2026-07-11T00:00:00.000Z",
};
const walnutAllergy = standardAllergy;

function renderSettings(overrides: Partial<HouseholdSettingsApi> = {}) {
  const updateMember = vi.fn().mockResolvedValue(member);
  const invalidateSafety = vi.fn().mockResolvedValue(undefined);
  const api: HouseholdSettingsApi = {
    listMembers: vi.fn().mockResolvedValue([member]),
    createDraft: vi.fn(),
    updateDraft: vi.fn().mockResolvedValue(member),
    updateMember,
    completeMember: vi.fn().mockResolvedValue(member),
    deleteMember: vi.fn().mockResolvedValue(undefined),
    listCatalog: vi.fn().mockResolvedValue(catalog),
    listAllergies: vi.fn().mockResolvedValue([]),
    addStandardAllergy: vi.fn(),
    addCustomAllergy: vi.fn(),
    removeAllergy: vi.fn(),
    listDislikes: vi.fn().mockResolvedValue([]),
    addDislike: vi.fn(),
    removeDislike: vi.fn(),
    invalidateSafety,
    ...overrides,
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <HouseholdSettingsForm api={api} />
    </QueryClientProvider>,
  );
  return { api, queryClient, updateMember, invalidateSafety };
}

async function waitForAllergies(queryClient: QueryClient, memberId = "member-1") {
  await waitFor(() => {
    expect(
      queryClient.getQueryState(["household", "allergies", "settings", memberId])?.status,
    ).toBe("success");
  });
}

it("renders the complete household editor without account deletion", async () => {
  renderSettings();
  expect(await screen.findByRole("heading", { name: "家族設定" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "アカウントを削除" })).not.toBeInTheDocument();
});

it("creates and selects a new draft while an existing member is present", async () => {
  const draft: HouseholdMemberRow = {
    ...member,
    id: "member-2",
    status: "draft",
    display_name: null,
    age_band: null,
    allergy_status: null,
    unsupported_diet_status: null,
    sort_order: 1,
  };
  const createDraft = vi.fn().mockResolvedValue(draft);
  const { queryClient } = renderSettings({ createDraft });

  await userEvent.click(await screen.findByRole("button", { name: /^家族を追加$/u }));

  expect(createDraft).toHaveBeenCalledWith(1);
  expect(await screen.findByLabelText("呼び名")).toHaveValue("");
  expect(screen.getByLabelText("年齢区分")).toHaveValue("");
  expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("");
  expect(screen.getByLabelText("対象外の食事の確認")).toHaveValue("");
  expect(screen.getByRole("button", { name: "この家族の設定を完了" })).toBeVisible();

  await act(async () => {
    queryClient.setQueryData(["household", "members", "settings"], [member]);
    await Promise.resolve();
  });
  expect(await screen.findByText("家族を追加してください")).toBeVisible();
  expect(screen.queryByLabelText("呼び名")).not.toBeInTheDocument();
});

it("removes a deleted member from cache before selecting the remaining member", async () => {
  const remaining = { ...member, id: "member-2", display_name: "子ども", sort_order: 1 };
  const listMembers = vi
    .fn()
    .mockResolvedValueOnce([member, remaining])
    .mockImplementation(() => new Promise<HouseholdMemberRow[]>(() => undefined));
  const { queryClient } = renderSettings({ listMembers });

  await userEvent.click(await screen.findByRole("button", { name: "家族を削除" }));
  await userEvent.click(screen.getByRole("button", { name: "家族だけを削除" }));

  expect(await screen.findByLabelText("呼び名")).toHaveValue("子ども");
  expect(queryClient.getQueryData(["household", "members", "settings"])).toEqual([remaining]);
});

it("shows the empty add screen immediately after deleting the last member", async () => {
  const listMembers = vi
    .fn()
    .mockResolvedValueOnce([member])
    .mockImplementation(() => new Promise<HouseholdMemberRow[]>(() => undefined));
  const { queryClient } = renderSettings({ listMembers });

  await userEvent.click(await screen.findByRole("button", { name: "家族を削除" }));
  await userEvent.click(screen.getByRole("button", { name: "家族だけを削除" }));

  expect(await screen.findByText("家族を追加してください")).toBeVisible();
  expect(screen.queryByLabelText("呼び名")).not.toBeInTheDocument();
  expect(queryClient.getQueryData(["household", "members", "settings"])).toEqual([]);
});

it("closes a member delete confirmation when another member is selected", async () => {
  const secondMember = { ...member, id: "member-2", display_name: "子ども", sort_order: 1 };
  const deleteMember = vi.fn().mockResolvedValue(undefined);
  renderSettings({
    listMembers: vi.fn().mockResolvedValue([member, secondMember]),
    deleteMember,
  });

  await userEvent.click(await screen.findByRole("button", { name: "家族を削除" }));
  const staleConfirm = screen.getByRole("button", { name: "家族だけを削除" });
  await userEvent.selectOptions(screen.getByLabelText("設定する家族"), secondMember.id);

  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "家族の削除確認" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("呼び名")).toHaveValue("子ども");
  });
  fireEvent.click(staleConfirm);
  expect(deleteMember).not.toHaveBeenCalled();
});

it("does not delete either member after switching during the delete target's allergy add", async () => {
  const secondMember = { ...member, id: "member-2", display_name: "子ども", sort_order: 1 };
  let resolveAdd: ((allergy: MemberAllergyRow) => void) | undefined;
  const addStandardAllergy = vi.fn(
    () =>
      new Promise<MemberAllergyRow>((resolve) => {
        resolveAdd = resolve;
      }),
  );
  const deleteMember = vi.fn().mockResolvedValue(undefined);
  renderSettings({
    listMembers: vi.fn().mockResolvedValue([member, secondMember]),
    listAllergies: vi.fn().mockResolvedValue([]),
    addStandardAllergy,
    deleteMember,
  });

  await userEvent.click(await screen.findByRole("button", { name: "家族を削除" }));
  const staleConfirm = screen.getByRole("button", { name: "家族だけを削除" });
  await userEvent.selectOptions(screen.getByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
  await userEvent.selectOptions(screen.getByLabelText("設定する家族"), secondMember.id);

  expect(screen.queryByRole("dialog", { name: "家族の削除確認" })).not.toBeInTheDocument();
  fireEvent.click(staleConfirm);
  expect(deleteMember).not.toHaveBeenCalled();
  await act(async () => {
    resolveAdd?.(standardAllergy);
    await Promise.resolve();
  });
});

it("deletes only the captured member and preserves a newly selected member", async () => {
  const secondMember = { ...member, id: "member-2", display_name: "子ども", sort_order: 1 };
  let resolveDelete: (() => void) | undefined;
  const pendingDelete = new Promise<void>((resolve) => {
    resolveDelete = resolve;
  });
  const deleteMember = vi.fn().mockReturnValue(pendingDelete);
  const listMembers = vi
    .fn()
    .mockResolvedValueOnce([member, secondMember])
    .mockImplementation(() => new Promise<HouseholdMemberRow[]>(() => undefined));
  const { queryClient } = renderSettings({ listMembers, deleteMember });

  await userEvent.click(await screen.findByRole("button", { name: "家族を削除" }));
  await userEvent.click(screen.getByRole("button", { name: "家族だけを削除" }));
  await userEvent.selectOptions(screen.getByLabelText("設定する家族"), secondMember.id);
  await waitFor(() => {
    expect(screen.getByLabelText("呼び名")).toHaveValue("子ども");
  });

  await act(async () => {
    resolveDelete?.();
    await pendingDelete;
  });

  await waitFor(() => {
    expect(deleteMember).toHaveBeenCalledWith(member.id);
    expect(screen.getByLabelText("呼び名")).toHaveValue("子ども");
  });
  expect(queryClient.getQueryData(householdKeys.members("settings"))).toEqual([secondMember]);
});

it("closes a delete confirmation when its target disappears from the member cache", async () => {
  const secondMember = { ...member, id: "member-2", display_name: "子ども", sort_order: 1 };
  const deleteMember = vi.fn().mockResolvedValue(undefined);
  const { queryClient } = renderSettings({
    listMembers: vi.fn().mockResolvedValue([member, secondMember]),
    deleteMember,
  });

  await userEvent.click(await screen.findByRole("button", { name: "家族を削除" }));
  const staleConfirm = screen.getByRole("button", { name: "家族だけを削除" });
  await act(async () => {
    queryClient.setQueryData(householdKeys.members("settings"), [secondMember]);
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "家族の削除確認" })).not.toBeInTheDocument();
  });

  await act(async () => {
    queryClient.setQueryData(householdKeys.members("settings"), [member, secondMember]);
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(screen.getByLabelText("呼び名")).toHaveValue("大人");
  });
  expect(screen.queryByRole("dialog", { name: "家族の削除確認" })).not.toBeInTheDocument();
  fireEvent.click(staleConfirm);
  expect(deleteMember).not.toHaveBeenCalled();
});

it("submits a member delete confirmation only once", async () => {
  let resolveDelete: (() => void) | undefined;
  const pendingDelete = new Promise<void>((resolve) => {
    resolveDelete = resolve;
  });
  const deleteMember = vi.fn().mockReturnValue(pendingDelete);
  renderSettings({ deleteMember });

  await userEvent.click(await screen.findByRole("button", { name: "家族を削除" }));
  const confirm = screen.getByRole("button", { name: "家族だけを削除" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);

  expect(deleteMember).toHaveBeenCalledTimes(1);
  expect(confirm).toBeDisabled();
  await act(async () => {
    resolveDelete?.();
    await pendingDelete;
  });
});

it("prevents duplicate draft creation from the empty add screen", async () => {
  let resolveCreate: ((member: HouseholdMemberRow) => void) | undefined;
  const createDraft = vi.fn(
    () =>
      new Promise<HouseholdMemberRow>((resolve) => {
        resolveCreate = resolve;
      }),
  );
  renderSettings({ listMembers: vi.fn().mockResolvedValue([]), createDraft });
  const add = await screen.findByRole("button", { name: /^家族を追加$/u });

  await userEvent.click(add);
  await userEvent.click(add);

  expect(add).toBeDisabled();
  expect(createDraft).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolveCreate?.({ ...member, id: "member-2", status: "draft" });
    await Promise.resolve();
  });
  expect(await screen.findByLabelText("呼び名")).toBeVisible();
});

it("keeps every new draft field through consecutive autosaves and completes with the latest payload", async () => {
  const draft: HouseholdMemberRow = {
    ...member,
    id: "member-draft",
    status: "draft",
    display_name: "子ども",
    age_band: null,
    allergy_status: null,
    unsupported_diet_status: null,
  };
  const pendingSaves: Array<{
    patch: HouseholdMemberPatch;
    resolve(savedMember: HouseholdMemberRow): void;
  }> = [];
  const updateDraft = vi.fn(
    (_memberId: string, patch: HouseholdMemberPatch) =>
      new Promise<HouseholdMemberRow>((resolve) => {
        pendingSaves.push({ patch, resolve });
      }),
  );
  const completeMember = vi.fn().mockResolvedValue({ ...draft, status: "complete" });
  renderSettings({
    listMembers: vi.fn().mockResolvedValue([]),
    createDraft: vi.fn().mockResolvedValue(draft),
    updateDraft,
    completeMember,
  });

  await userEvent.click(await screen.findByRole("button", { name: /^家族を追加$/u }));
  await userEvent.selectOptions(await screen.findByLabelText("年齢区分"), "adult");
  await userEvent.selectOptions(screen.getByLabelText("アレルギーの確認"), "none");
  await userEvent.selectOptions(screen.getByLabelText("対象外の食事の確認"), "none");
  await userEvent.click(screen.getByLabelText("骨を除く"));

  for (let index = 0; index < 2; index += 1) {
    await waitFor(() => {
      expect(updateDraft).toHaveBeenCalledTimes(index + 1);
    });
    const pendingSave = pendingSaves[index];
    if (pendingSave === undefined) throw new Error("保留中の下書き保存を確認できませんでした");
    await act(async () => {
      pendingSave.resolve({ ...draft, ...pendingSave.patch });
      await Promise.resolve();
    });
  }

  await waitFor(() => {
    expect(screen.getByLabelText("年齢区分")).toHaveValue("adult");
    expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("none");
    expect(screen.getByLabelText("対象外の食事の確認")).toHaveValue("none");
    expect(screen.getByLabelText("骨を除く")).toBeChecked();
  });
  expect(updateDraft.mock.calls[1]?.[1]).toEqual(
    expect.objectContaining({
      age_band: "adult",
      allergy_status: "none",
      unsupported_diet_status: "none",
      required_safety_constraints: ["remove_bones"],
    }),
  );

  await userEvent.click(screen.getByRole("button", { name: "この家族の設定を完了" }));
  await waitFor(() => {
    expect(updateDraft).toHaveBeenCalledTimes(3);
  });
  const completionSave = pendingSaves[2];
  if (completionSave === undefined) throw new Error("完了前の下書き保存を確認できませんでした");
  await act(async () => {
    completionSave.resolve({ ...draft, ...completionSave.patch });
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(completeMember).toHaveBeenCalledWith(draft.id);
  });
  expect(completionSave.patch).toEqual(
    expect.objectContaining({
      age_band: "adult",
      allergy_status: "none",
      unsupported_diet_status: "none",
      required_safety_constraints: ["remove_bones"],
    }),
  );
});

it("saves a changed safety field and invalidates dependents", async () => {
  const { updateMember, invalidateSafety } = renderSettings();
  await userEvent.selectOptions(await screen.findByLabelText("年齢区分"), "age_3_5");
  await waitFor(() => {
    expect(updateMember.mock.calls.length).toBeGreaterThan(0);
  });
  await waitFor(() => {
    expect(invalidateSafety.mock.calls.length).toBeGreaterThan(0);
  });
});

it.each([
  { allergyKind: "standard" as const, label: "standard allergy" },
  { allergyKind: "custom" as const, label: "custom allergy" },
])(
  "defers a registered allergy status until the first $label is saved",
  async ({ allergyKind }) => {
    const registeredMember = { ...member, allergy_status: "registered" as const };
    const updateMember = vi.fn().mockResolvedValue(registeredMember);
    const addStandardAllergy = vi.fn().mockResolvedValue(undefined);
    const addCustomAllergy = vi.fn().mockResolvedValue(undefined);
    renderSettings({ updateMember, addStandardAllergy, addCustomAllergy });

    await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");

    expect(screen.getByRole("region", { name: "アレルギー編集" })).toBeVisible();
    expect(updateMember).not.toHaveBeenCalled();

    if (allergyKind === "standard") {
      await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
    } else {
      await userEvent.type(screen.getByLabelText("自由登録名"), "えんどう豆たんぱく");
      await userEvent.click(screen.getByLabelText("標準候補に該当しないことを確認"));
      await userEvent.click(screen.getByRole("button", { name: "自由登録を追加" }));
    }

    const addAllergy = allergyKind === "standard" ? addStandardAllergy : addCustomAllergy;
    await waitFor(() => {
      expect(updateMember).toHaveBeenCalledWith(
        "member-1",
        expect.objectContaining({ allergy_status: "registered" }),
      );
    });
    const [addCallOrder] = addAllergy.mock.invocationCallOrder;
    const [updateCallOrder] = updateMember.mock.invocationCallOrder;
    if (addCallOrder === undefined || updateCallOrder === undefined) {
      throw new Error("アレルギー追加と状態保存の呼び出し順を確認できませんでした");
    }
    expect(addCallOrder).toBeLessThan(updateCallOrder);
  },
);

it.each([
  { allergyKind: "standard" as const, label: "standard allergy" },
  { allergyKind: "custom" as const, label: "custom allergy" },
])(
  "keeps a deferred registered intent while an earlier save settles before the first $label",
  async ({ allergyKind }) => {
    let resolveEarlierSave: ((savedMember: HouseholdMemberRow) => void) | undefined;
    const earlierSave = new Promise<HouseholdMemberRow>((resolve) => {
      resolveEarlierSave = resolve;
    });
    const updateMember = vi
      .fn()
      .mockReturnValueOnce(earlierSave)
      .mockResolvedValue({ ...member, allergy_status: "registered" });
    const addStandardAllergy = vi.fn().mockResolvedValue(standardAllergy);
    const addCustomAllergy = vi.fn().mockResolvedValue({
      ...standardAllergy,
      id: "allergy-custom",
      allergen_id: null,
      custom_name: "えんどう豆たんぱく",
      custom_confirmed: true,
    });
    renderSettings({ updateMember, addStandardAllergy, addCustomAllergy });

    await userEvent.selectOptions(await screen.findByLabelText("年齢区分"), "age_3_5");
    await waitFor(() => {
      expect(updateMember).toHaveBeenCalledTimes(1);
    });
    expect(updateMember.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ allergy_status: "none" }),
    );
    await userEvent.selectOptions(screen.getByLabelText("アレルギーの確認"), "registered");

    await act(async () => {
      resolveEarlierSave?.({ ...member, age_band: "age_3_5", allergy_status: "none" });
      await earlierSave;
    });

    await waitFor(() => {
      expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("registered");
    });
    expect(screen.getByRole("region", { name: "アレルギー編集" })).toBeVisible();

    if (allergyKind === "standard") {
      await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
    } else {
      await userEvent.type(screen.getByLabelText("自由登録名"), "えんどう豆たんぱく");
      await userEvent.click(screen.getByLabelText("標準候補に該当しないことを確認"));
      await userEvent.click(screen.getByRole("button", { name: "自由登録を追加" }));
    }

    await waitFor(() => {
      expect(updateMember).toHaveBeenCalledTimes(2);
    });
    expect(updateMember.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ allergy_status: "registered" }),
    );
  },
);

it("keeps only the deferred registered status over newer member query values", async () => {
  const latestMember: HouseholdMemberRow = {
    ...member,
    display_name: "保護者",
    portion_size: "large",
    spice_level: "mild",
    updated_at: "2026-07-18T00:00:00.000Z",
  };
  const updateMember = vi.fn((_memberId: string, patch: HouseholdMemberPatch) =>
    Promise.resolve({ ...latestMember, ...patch }),
  );
  const { queryClient } = renderSettings({ updateMember });

  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await act(async () => {
    queryClient.setQueryData(householdKeys.members("settings"), [latestMember]);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("registered");
    expect(screen.getByLabelText("呼び名")).toHaveValue("保護者");
    expect(screen.getByLabelText("辛さ")).toHaveValue("mild");
  });
  await userEvent.selectOptions(screen.getByLabelText("食べる量"), "small");

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      member.id,
      expect.objectContaining({
        allergy_status: "none",
        display_name: "保護者",
        portion_size: "small",
        spice_level: "mild",
      }),
    );
  });
  expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("registered");
});

it.each(["none", "unconfirmed"] as const)(
  "clears a deferred registered status when it is changed to %s",
  async (allergyStatus) => {
    const savedMember = { ...member, allergy_status: allergyStatus };
    const updateMember = vi.fn().mockResolvedValue(savedMember);
    const { queryClient } = renderSettings({ updateMember });

    const allergyStatusSelect = await screen.findByLabelText("アレルギーの確認");
    await userEvent.selectOptions(allergyStatusSelect, "registered");
    await userEvent.selectOptions(allergyStatusSelect, allergyStatus);

    await waitFor(() => {
      expect(updateMember).toHaveBeenCalledWith(
        member.id,
        expect.objectContaining({ allergy_status: allergyStatus }),
      );
    });
    await act(async () => {
      queryClient.setQueryData(householdKeys.members("settings"), [savedMember]);
      await Promise.resolve();
    });
    expect(allergyStatusSelect).toHaveValue(allergyStatus);
  },
);

it("keeps a deferred registered intent when the first allergy add fails", async () => {
  let resolveEarlierSave: ((savedMember: HouseholdMemberRow) => void) | undefined;
  const earlierSave = new Promise<HouseholdMemberRow>((resolve) => {
    resolveEarlierSave = resolve;
  });
  let rejectAdd: ((error: Error) => void) | undefined;
  const addFailure = new Promise<MemberAllergyRow>((_resolve, reject) => {
    rejectAdd = reject;
  });
  const addStandardAllergy = vi.fn().mockReturnValue(addFailure);
  const updateMember = vi
    .fn()
    .mockReturnValueOnce(earlierSave)
    .mockImplementation((_memberId: string, patch: HouseholdMemberPatch) =>
      Promise.resolve({ ...member, ...patch }),
    );
  renderSettings({ addStandardAllergy, updateMember });

  await userEvent.selectOptions(await screen.findByLabelText("年齢区分"), "age_3_5");
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(1);
  });
  const allergyStatus = await screen.findByLabelText("アレルギーの確認");
  await userEvent.selectOptions(allergyStatus, "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
  await act(async () => {
    rejectAdd?.(new Error("アレルギーを追加できませんでした"));
    await addFailure.catch(() => undefined);
  });

  await waitFor(() => {
    expect(allergyStatus).toHaveValue("registered");
  });
  expect(await screen.findByRole("status")).toHaveTextContent("アレルギーを追加できませんでした");
  await userEvent.selectOptions(screen.getByLabelText("辛さ"), "mild");
  await act(async () => {
    resolveEarlierSave?.({ ...member, age_band: "age_3_5", allergy_status: "none" });
    await earlierSave;
  });
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(2);
  });
  expect(updateMember.mock.calls[1]?.[1]).toEqual(
    expect.objectContaining({ allergy_status: "none", spice_level: "mild" }),
  );
});

it("keeps a deferred registered status when saving it after the first allergy fails", async () => {
  const updateMember = vi.fn().mockRejectedValue(new Error("家族設定を保存できませんでした"));
  renderSettings({
    updateMember,
    addStandardAllergy: vi.fn().mockResolvedValue(standardAllergy),
  });

  const allergyStatus = await screen.findByLabelText("アレルギーの確認");
  await userEvent.selectOptions(allergyStatus, "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));

  expect(await screen.findByRole("status")).toHaveTextContent("家族設定を保存できませんでした");
  expect(allergyStatus).toHaveValue("registered");
  expect(screen.getByRole("region", { name: "アレルギー編集" })).toBeVisible();
});

it("rejects removing the last allergy from a complete registered member", async () => {
  const registeredMember = { ...member, allergy_status: "registered" as const };
  const removeAllergy = vi.fn().mockResolvedValue(undefined);
  renderSettings({
    listMembers: vi.fn().mockResolvedValue([registeredMember]),
    listAllergies: vi.fn().mockResolvedValue([standardAllergy]),
    removeAllergy,
  });

  await userEvent.click(await screen.findByRole("button", { name: "くるみを削除" }));

  expect(removeAllergy).not.toHaveBeenCalled();
  expect(await screen.findByRole("status")).toHaveTextContent(
    "登録ありの場合は1つ以上選んでください",
  );
});

it("shows a remove error when deleting from multiple registered allergies fails", async () => {
  const registeredMember = { ...member, allergy_status: "registered" as const };
  const customAllergy: MemberAllergyRow = {
    ...standardAllergy,
    id: "allergy-custom",
    allergen_id: null,
    custom_name: "えんどう豆たんぱく",
    custom_confirmed: true,
  };
  const removeAllergy = vi.fn().mockRejectedValue(new Error("アレルギーを削除できませんでした"));
  renderSettings({
    listMembers: vi.fn().mockResolvedValue([registeredMember]),
    listAllergies: vi.fn().mockResolvedValue([standardAllergy, customAllergy]),
    removeAllergy,
  });

  await userEvent.click(await screen.findByRole("button", { name: "くるみを削除" }));

  await waitFor(() => {
    expect(removeAllergy).toHaveBeenCalledWith(standardAllergy.id);
  });
  expect(await screen.findByRole("status")).toHaveTextContent("アレルギーを削除できませんでした");
});

it("cleans up a deferred registered status when its member is deleted", async () => {
  const remainingMember: HouseholdMemberRow = {
    ...member,
    id: "member-2",
    display_name: "子ども",
    sort_order: 1,
  };
  const listMembers = vi
    .fn()
    .mockResolvedValueOnce([member, remainingMember])
    .mockImplementation(() => new Promise<HouseholdMemberRow[]>(() => undefined));
  const { queryClient } = renderSettings({ listMembers });

  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "家族を削除" }));
  await userEvent.click(screen.getByRole("button", { name: "家族だけを削除" }));
  expect(await screen.findByLabelText("呼び名")).toHaveValue("子ども");

  await act(async () => {
    queryClient.setQueryData(householdKeys.members("settings"), [member, remainingMember]);
    await Promise.resolve();
  });
  await userEvent.selectOptions(await screen.findByLabelText("設定する家族"), member.id);

  expect(await screen.findByLabelText("アレルギーの確認")).toHaveValue("none");
});

it("disables the allergy status until existing allergies finish loading", async () => {
  let resolveAllergies: ((allergies: MemberAllergyRow[]) => void) | undefined;
  const listAllergies = vi.fn(
    () =>
      new Promise<MemberAllergyRow[]>((resolve) => {
        resolveAllergies = resolve;
      }),
  );
  const updateMember = vi.fn().mockResolvedValue({ ...member, allergy_status: "registered" });
  renderSettings({ listAllergies, updateMember });

  const allergyStatus = await screen.findByLabelText("アレルギーの確認");
  expect(allergyStatus).toBeDisabled();

  await act(async () => {
    resolveAllergies?.([standardAllergy]);
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(allergyStatus).toBeEnabled();
  });
  await userEvent.selectOptions(allergyStatus, "registered");

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
    );
  });
});

it("keeps newer edits in the registered save after a delayed standard allergy add", async () => {
  let resolveAdd: ((allergy: MemberAllergyRow) => void) | undefined;
  const addStandardAllergy = vi.fn(
    () =>
      new Promise<MemberAllergyRow>((resolve) => {
        resolveAdd = resolve;
      }),
  );
  const savedPatches: HouseholdMemberPatch[] = [];
  const updateMember = vi
    .fn()
    .mockImplementation((_memberId: string, patch: HouseholdMemberPatch) => {
      savedPatches.push(patch);
      return Promise.resolve({
        ...member,
        display_name: patch.display_name ?? member.display_name,
        spice_level: patch.spice_level ?? member.spice_level,
        allergy_status: patch.allergy_status ?? member.allergy_status,
      });
    });
  renderSettings({ addStandardAllergy, updateMember });

  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
  fireEvent.change(screen.getByLabelText("呼び名"), { target: { value: "保護者" } });
  await userEvent.selectOptions(screen.getByLabelText("辛さ"), "mild");

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ display_name: "保護者", spice_level: "mild" }),
    );
  });
  await act(async () => {
    resolveAdd?.(standardAllergy);
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(updateMember.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  const registeredPatches = savedPatches.filter((patch) => patch.allergy_status === "registered");
  expect(registeredPatches.at(-1)).toEqual(
    expect.objectContaining({
      allergy_status: "registered",
      display_name: "保護者",
      spice_level: "mild",
    }),
  );
});

it.each([
  {
    label: "none status",
    secondMember: {
      ...member,
      id: "member-2",
      display_name: "子ども",
      spice_level: "mild" as const,
      allergy_status: "none" as const,
      sort_order: 1,
    },
    secondAllergies: [] as MemberAllergyRow[],
  },
  {
    label: "registered status with different values",
    secondMember: {
      ...member,
      id: "member-2",
      display_name: "高齢者",
      spice_level: "none" as const,
      allergy_status: "registered" as const,
      sort_order: 1,
    },
    secondAllergies: [
      { ...standardAllergy, id: "allergy-2", member_id: "member-2" },
    ] as MemberAllergyRow[],
  },
])(
  "saves a delayed allergy transition with the initiating member when the next member has $label",
  async ({ secondMember, secondAllergies }) => {
    let resolveAdd: ((allergy: MemberAllergyRow) => void) | undefined;
    const addStandardAllergy = vi.fn(
      () =>
        new Promise<MemberAllergyRow>((resolve) => {
          resolveAdd = resolve;
        }),
    );
    const updateCalls: Array<{ memberId: string; patch: HouseholdMemberPatch }> = [];
    const updateMember = vi.fn((memberId: string, patch: HouseholdMemberPatch) => {
      updateCalls.push({ memberId, patch });
      const source = memberId === member.id ? member : secondMember;
      return Promise.resolve({
        ...source,
        display_name: patch.display_name ?? source.display_name,
        spice_level: patch.spice_level ?? source.spice_level,
        allergy_status: patch.allergy_status ?? source.allergy_status,
      });
    });
    renderSettings({
      listMembers: vi.fn().mockResolvedValue([member, secondMember]),
      listAllergies: vi.fn((memberId: string) =>
        Promise.resolve(memberId === member.id ? [] : secondAllergies),
      ),
      addStandardAllergy,
      updateMember,
    });

    await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
    await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
    await userEvent.selectOptions(screen.getByLabelText("設定する家族"), secondMember.id);
    await waitFor(() => {
      expect(screen.getByLabelText("呼び名")).toHaveValue(secondMember.display_name);
    });

    await act(async () => {
      resolveAdd?.(standardAllergy);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(updateCalls.length).toBe(1);
    });
    const [updateCall] = updateCalls;
    expect(updateCall?.memberId).toBe(member.id);
    expect(updateCall?.patch).toEqual(
      expect.objectContaining({
        allergy_status: "registered",
        display_name: member.display_name,
        spice_level: member.spice_level,
      }),
    );
  },
);

it("keeps an allergy add locked for its member across switching until success", async () => {
  const secondMember: HouseholdMemberRow = {
    ...member,
    id: "member-2",
    display_name: "子ども",
    sort_order: 1,
  };
  let resolveAdd: ((allergy: MemberAllergyRow) => void) | undefined;
  const addStandardAllergy = vi.fn(
    () =>
      new Promise<MemberAllergyRow>((resolve) => {
        resolveAdd = resolve;
      }),
  );
  const updateMember = vi.fn((memberId: string, patch: HouseholdMemberPatch) =>
    Promise.resolve({ ...(memberId === member.id ? member : secondMember), ...patch }),
  );
  renderSettings({
    listMembers: vi.fn().mockResolvedValue([member, secondMember]),
    listAllergies: vi.fn().mockResolvedValue([]),
    addStandardAllergy,
    updateMember,
  });

  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
  await userEvent.selectOptions(screen.getByLabelText("設定する家族"), secondMember.id);
  await waitFor(() => {
    expect(screen.getByLabelText("呼び名")).toHaveValue("子ども");
  });
  expect(screen.getByLabelText("アレルギーの確認")).toBeEnabled();
  expect(screen.getByRole("button", { name: "家族を削除" })).toBeEnabled();

  await userEvent.selectOptions(screen.getByLabelText("設定する家族"), member.id);
  await waitFor(() => {
    expect(screen.getByLabelText("呼び名")).toHaveValue("大人");
  });
  expect(screen.getByLabelText("アレルギーの確認")).toBeDisabled();
  expect(screen.getByRole("button", { name: "くるみを追加" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "家族を削除" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
  expect(addStandardAllergy).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveAdd?.(standardAllergy);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("アレルギーの確認")).toBeEnabled();
    expect(screen.getByRole("button", { name: "くるみを追加" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "家族を削除" })).toBeEnabled();
  });
  expect(updateMember).toHaveBeenCalledWith(
    member.id,
    expect.objectContaining({ allergy_status: "registered" }),
  );
});

it("keeps the intent and unlocks a switched member after its allergy add fails", async () => {
  const secondMember: HouseholdMemberRow = {
    ...member,
    id: "member-2",
    display_name: "子ども",
    sort_order: 1,
  };
  let rejectAdd: ((error: Error) => void) | undefined;
  const pendingAdd = new Promise<MemberAllergyRow>((_resolve, reject) => {
    rejectAdd = reject;
  });
  const addStandardAllergy = vi.fn().mockReturnValue(pendingAdd);
  renderSettings({
    listMembers: vi.fn().mockResolvedValue([member, secondMember]),
    listAllergies: vi.fn().mockResolvedValue([]),
    addStandardAllergy,
  });

  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
  await userEvent.selectOptions(screen.getByLabelText("設定する家族"), secondMember.id);
  await userEvent.selectOptions(screen.getByLabelText("設定する家族"), member.id);

  expect(screen.getByLabelText("アレルギーの確認")).toBeDisabled();
  await act(async () => {
    rejectAdd?.(new Error("アレルギーを追加できませんでした"));
    await pendingAdd.catch(() => undefined);
  });

  await waitFor(() => {
    expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("registered");
    expect(screen.getByLabelText("アレルギーの確認")).toBeEnabled();
    expect(screen.getByRole("button", { name: "家族を削除" })).toBeEnabled();
  });
  expect(screen.getByRole("region", { name: "アレルギー編集" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("アレルギーを追加できませんでした");
});

it("blocks a previously opened member delete confirmation during an allergy add", async () => {
  let resolveAdd: ((allergy: MemberAllergyRow) => void) | undefined;
  const addStandardAllergy = vi.fn(
    () =>
      new Promise<MemberAllergyRow>((resolve) => {
        resolveAdd = resolve;
      }),
  );
  const deleteMember = vi.fn().mockResolvedValue(undefined);
  renderSettings({ addStandardAllergy, deleteMember });

  await userEvent.click(await screen.findByRole("button", { name: "家族を削除" }));
  const confirmDelete = screen.getByRole("button", { name: "家族だけを削除" });
  await userEvent.selectOptions(screen.getByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));

  expect(screen.getByRole("button", { name: "家族を削除" })).toBeDisabled();
  expect(confirmDelete).toBeDisabled();
  fireEvent.click(confirmDelete);
  expect(deleteMember).not.toHaveBeenCalled();

  await act(async () => {
    resolveAdd?.(standardAllergy);
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "家族を削除" })).toBeEnabled();
    expect(confirmDelete).toBeEnabled();
  });
});

it("disables every allergy operation while a registered member allergy query is pending", async () => {
  let resolveAllergies: ((allergies: MemberAllergyRow[]) => void) | undefined;
  const listAllergies = vi.fn(
    () =>
      new Promise<MemberAllergyRow[]>((resolve) => {
        resolveAllergies = resolve;
      }),
  );
  const addStandardAllergy = vi.fn();
  const addCustomAllergy = vi.fn();
  const removeAllergy = vi.fn();
  renderSettings({
    listMembers: vi.fn().mockResolvedValue([{ ...member, allergy_status: "registered" }]),
    listAllergies,
    addStandardAllergy,
    addCustomAllergy,
    removeAllergy,
  });

  expect(await screen.findByLabelText("アレルギーの確認")).toBeDisabled();
  const standardAdd = screen.getByRole("button", { name: "くるみを追加" });
  const customName = screen.getByLabelText("自由登録名");
  const customConfirm = screen.getByLabelText("標準候補に該当しないことを確認");
  const customAdd = screen.getByRole("button", { name: "自由登録を追加" });
  expect(standardAdd).toBeDisabled();
  expect(customName).toBeDisabled();
  expect(customConfirm).toBeDisabled();
  expect(customAdd).toBeDisabled();

  fireEvent.click(standardAdd);
  fireEvent.click(customConfirm);
  fireEvent.click(customAdd);
  expect(addStandardAllergy).not.toHaveBeenCalled();
  expect(addCustomAllergy).not.toHaveBeenCalled();
  expect(removeAllergy).not.toHaveBeenCalled();

  await act(async () => {
    resolveAllergies?.([]);
    await Promise.resolve();
  });
});

it("keeps allergy operations disabled after failure and enables them only after retry succeeds", async () => {
  const registeredMember = { ...member, allergy_status: "registered" as const };
  const customAllergy: MemberAllergyRow = {
    ...standardAllergy,
    id: "allergy-custom",
    allergen_id: null,
    custom_name: "えんどう豆たんぱく",
    custom_confirmed: true,
  };
  const listAllergies = vi
    .fn()
    .mockRejectedValueOnce(new Error("temporary failure"))
    .mockResolvedValue([standardAllergy, customAllergy]);
  const updateMember = vi.fn().mockResolvedValue(registeredMember);
  const addStandardAllergy = vi.fn().mockResolvedValue(standardAllergy);
  const addCustomAllergy = vi.fn().mockResolvedValue(customAllergy);
  const removeAllergy = vi.fn().mockResolvedValue(undefined);
  renderSettings({
    listMembers: vi.fn().mockResolvedValue([registeredMember]),
    listAllergies,
    updateMember,
    addStandardAllergy,
    addCustomAllergy,
    removeAllergy,
  });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "アレルギー情報を読み込めませんでした",
  );
  const allergyStatus = screen.getByLabelText("アレルギーの確認");
  const standardAdd = screen.getByRole("button", { name: "くるみを追加" });
  const customName = screen.getByLabelText("自由登録名");
  const customConfirm = screen.getByLabelText("標準候補に該当しないことを確認");
  const customAdd = screen.getByRole("button", { name: "自由登録を追加" });
  expect(allergyStatus).toBeDisabled();
  expect(standardAdd).toBeDisabled();
  expect(customName).toBeDisabled();
  expect(customConfirm).toBeDisabled();
  expect(customAdd).toBeDisabled();
  fireEvent.click(standardAdd);
  fireEvent.click(customAdd);
  expect(updateMember).not.toHaveBeenCalled();
  expect(addStandardAllergy).not.toHaveBeenCalled();
  expect(addCustomAllergy).not.toHaveBeenCalled();
  expect(removeAllergy).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: "アレルギー情報を再読み込み" }));
  await waitFor(() => {
    expect(listAllergies).toHaveBeenCalledTimes(2);
  });
  expect(await screen.findByRole("button", { name: "くるみを削除" })).toBeEnabled();
  expect(allergyStatus).toBeEnabled();
  expect(customName).toBeEnabled();
  expect(customConfirm).toBeEnabled();

  await userEvent.type(customName, "えんどう豆たんぱく");
  await userEvent.click(customConfirm);
  await userEvent.click(customAdd);
  await waitFor(() => {
    expect(addCustomAllergy).toHaveBeenCalledWith(member.id, "えんどう豆たんぱく", []);
  });
  await userEvent.click(screen.getByRole("button", { name: "くるみを削除" }));
  await waitFor(() => {
    expect(removeAllergy).toHaveBeenCalledWith(standardAllergy.id);
  });
  await userEvent.selectOptions(allergyStatus, "none");
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      member.id,
      expect.objectContaining({ allergy_status: "none" }),
    );
  });
});

it("saves a registered allergy status immediately when an allergy already exists", async () => {
  const updateMember = vi.fn().mockResolvedValue({ ...member, allergy_status: "registered" });
  const { queryClient } = renderSettings({
    updateMember,
    listAllergies: vi.fn().mockResolvedValue([standardAllergy]),
  });

  const allergyStatus = await screen.findByLabelText("アレルギーの確認");
  await waitFor(() => {
    expect(queryClient.getQueryData(householdKeys.allergies("settings", "member-1"))).toEqual([
      standardAllergy,
    ]);
  });
  await userEvent.selectOptions(allergyStatus, "registered");

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
    );
  });
});

it("keeps explicitly empty saved preferences when loading and saving another field", async () => {
  const savedWithoutPreferences: HouseholdMemberRow = {
    ...member,
    age_band: "age_3_5",
    ease_preferences: [],
    required_safety_constraints: [],
  };
  const updateMember = vi.fn().mockResolvedValue(savedWithoutPreferences);
  renderSettings({
    listMembers: vi.fn().mockResolvedValue([savedWithoutPreferences]),
    updateMember,
  });

  expect(await screen.findByLabelText("骨を除く")).not.toBeChecked();
  expect(screen.getByLabelText("小さく切る")).not.toBeChecked();
  expect(screen.getByLabelText("小さめ")).not.toBeChecked();
  expect(screen.getByLabelText("boneless")).not.toBeChecked();
  expect(screen.getByLabelText("soft")).not.toBeChecked();

  fireEvent.change(screen.getByLabelText("呼び名"), { target: { value: "子ども" } });

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({
        display_name: "子ども",
        ease_preferences: [],
        required_safety_constraints: [],
      }),
    );
  });
});

it("アレルギー0件のcomplete家族ではregisteredの保存を保留する", async () => {
  const { queryClient, updateMember } = renderSettings();

  await waitForAllergies(queryClient);

  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");

  expect(screen.getByRole("status")).toHaveTextContent("登録ありの場合は1つ以上選んでください");
  expect(updateMember).not.toHaveBeenCalled();
});

it("0件確認中のsafe保存後はregisteredを送らず追加成功後に再開する", async () => {
  const registeredMember: HouseholdMemberRow = {
    ...member,
    allergy_status: "registered",
  };
  let resolveNoneUpdate: ((saved: HouseholdMemberRow) => void) | undefined;
  const updateMember = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<HouseholdMemberRow>((resolve) => {
          resolveNoneUpdate = resolve;
        }),
    )
    .mockResolvedValueOnce(registeredMember);
  const addStandardAllergy = vi.fn().mockResolvedValue(walnutAllergy);
  const { queryClient } = renderSettings({ addStandardAllergy, updateMember });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.selectOptions(screen.getByLabelText("アレルギーの確認"), "none");
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(1);
  });
  await userEvent.selectOptions(screen.getByLabelText("アレルギーの確認"), "registered");

  await act(async () => {
    resolveNoneUpdate?.(member);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(updateMember).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toHaveTextContent("登録ありの場合は1つ以上選んでください");

  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));

  await waitFor(() => {
    expect(updateMember).toHaveBeenNthCalledWith(
      2,
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
    );
  });
});

it("最初のアレルギー追加成功後に保留したregisteredを保存する", async () => {
  let resolveAdd: ((allergy: MemberAllergyRow) => void) | undefined;
  const addStandardAllergy = vi.fn(
    () =>
      new Promise<MemberAllergyRow>((resolve) => {
        resolveAdd = resolve;
      }),
  );
  const { queryClient, updateMember, invalidateSafety } = renderSettings({ addStandardAllergy });

  await waitForAllergies(queryClient);

  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));

  expect(addStandardAllergy).toHaveBeenCalledWith("member-1", "walnut");
  expect(updateMember).not.toHaveBeenCalled();

  await act(async () => {
    resolveAdd?.(walnutAllergy);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
    );
  });
  await waitFor(() => {
    expect(invalidateSafety).toHaveBeenCalled();
  });
  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("最新条件で再確認します");
  });
});

it("既存registered家族はアレルギー取得中でも通常の編集を保存する", async () => {
  const registeredMember: HouseholdMemberRow = {
    ...member,
    allergy_status: "registered",
  };
  const updateMember = vi.fn().mockResolvedValue(registeredMember);
  renderSettings({
    listMembers: vi.fn().mockResolvedValue([registeredMember]),
    listAllergies: vi.fn(() => new Promise<MemberAllergyRow[]>(() => undefined)),
    updateMember,
  });

  fireEvent.change(await screen.findByLabelText("呼び名"), { target: { value: "保護者" } });

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ display_name: "保護者", allergy_status: "registered" }),
    );
  });
});

it("標準アレルギー追加失敗時はregisteredも成功表示も保存しない", async () => {
  const addStandardAllergy = vi.fn().mockRejectedValue(new Error("追加失敗"));
  const { queryClient, updateMember } = renderSettings({ addStandardAllergy });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));

  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("追加失敗");
  });
  expect(screen.getByRole("status")).not.toHaveTextContent("最新条件で再確認します");
  expect(updateMember).not.toHaveBeenCalled();
});

it("自由登録アレルギー追加成功後に保留したregisteredを保存する", async () => {
  const addCustomAllergy = vi.fn().mockResolvedValue({
    ...walnutAllergy,
    allergen_id: null,
    custom_name: "マンゴー",
    custom_confirmed: true,
  });
  const { queryClient, updateMember } = renderSettings({ addCustomAllergy });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.type(screen.getByLabelText("自由登録名"), "マンゴー");
  await userEvent.click(screen.getByLabelText("標準候補に該当しないことを確認"));
  await userEvent.click(screen.getByRole("button", { name: "自由登録を追加" }));

  expect(addCustomAllergy).toHaveBeenCalledWith("member-1", "マンゴー", []);
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
    );
  });
});

it("自由登録INSERT失敗時は入力と確認状態を保持する", async () => {
  let rejectAdd: ((reason?: unknown) => void) | undefined;
  const addCustomAllergy = vi.fn(
    () =>
      new Promise<MemberAllergyRow>((_resolve, reject) => {
        rejectAdd = reject;
      }),
  );
  const { queryClient, updateMember } = renderSettings({ addCustomAllergy });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.type(screen.getByLabelText("自由登録名"), "マンゴー");
  await userEvent.type(screen.getByLabelText("別名（カンマ区切り・任意）"), "南国果実");
  await userEvent.click(screen.getByLabelText("標準候補に該当しないことを確認"));
  await userEvent.click(screen.getByRole("button", { name: "自由登録を追加" }));

  await act(async () => {
    rejectAdd?.(new Error("自由登録の追加に失敗しました"));
    await Promise.resolve();
  });

  expect(screen.getByRole("status")).toHaveTextContent("自由登録の追加に失敗しました");
  expect(screen.getByLabelText("自由登録名")).toHaveValue("マンゴー");
  expect(screen.getByLabelText("別名（カンマ区切り・任意）")).toHaveValue("南国果実");
  expect(screen.getByLabelText("標準候補に該当しないことを確認")).toBeChecked();
  expect(updateMember).not.toHaveBeenCalled();
});

it("自由登録INSERT成功後のregistered保存失敗では入力をクリアする", async () => {
  const addCustomAllergy = vi.fn().mockResolvedValue({
    ...walnutAllergy,
    allergen_id: null,
    custom_name: "マンゴー",
    custom_aliases: ["南国果実"],
    custom_confirmed: true,
  });
  const updateMember = vi.fn().mockRejectedValue(new Error("家族設定の保存に失敗しました"));
  const { queryClient } = renderSettings({ addCustomAllergy, updateMember });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.type(screen.getByLabelText("自由登録名"), "マンゴー");
  await userEvent.type(screen.getByLabelText("別名（カンマ区切り・任意）"), "南国果実");
  await userEvent.click(screen.getByLabelText("標準候補に該当しないことを確認"));
  await userEvent.click(screen.getByRole("button", { name: "自由登録を追加" }));

  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("家族設定の保存に失敗しました");
  });
  expect(screen.getByLabelText("自由登録名")).toHaveValue("");
  expect(screen.getByLabelText("別名（カンマ区切り・任意）")).toHaveValue("");
  expect(screen.getByLabelText("標準候補に該当しないことを確認")).not.toBeChecked();
});

it("アレルギー追加中の別フィールド変更を最新snapshotで保存する", async () => {
  let resolveAdd: ((allergy: MemberAllergyRow) => void) | undefined;
  const addStandardAllergy = vi.fn(
    () =>
      new Promise<MemberAllergyRow>((resolve) => {
        resolveAdd = resolve;
      }),
  );
  const { queryClient, updateMember } = renderSettings({ addStandardAllergy });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
  fireEvent.change(screen.getByLabelText("呼び名"), { target: { value: "更新後" } });

  expect(updateMember).not.toHaveBeenCalled();

  await act(async () => {
    resolveAdd?.(walnutAllergy);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({
        allergy_status: "registered",
        display_name: "更新後",
      }),
    );
  });
});

it("registered保存中の別フィールド変更を後続の最新snapshotで保存する", async () => {
  const firstRegisteredMember: HouseholdMemberRow = {
    ...member,
    allergy_status: "registered",
  };
  const latestRegisteredMember: HouseholdMemberRow = {
    ...firstRegisteredMember,
    display_name: "更新後",
  };
  let resolveFirstUpdate: ((saved: HouseholdMemberRow) => void) | undefined;
  const updateMember = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<HouseholdMemberRow>((resolve) => {
          resolveFirstUpdate = resolve;
        }),
    )
    .mockResolvedValueOnce(latestRegisteredMember);
  const { queryClient } = renderSettings({
    listAllergies: vi.fn().mockResolvedValue([walnutAllergy]),
    updateMember,
  });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(1);
  });

  fireEvent.change(screen.getByLabelText("呼び名"), { target: { value: "更新後" } });
  expect(updateMember).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveFirstUpdate?.(firstRegisteredMember);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(updateMember).toHaveBeenNthCalledWith(
      2,
      "member-1",
      expect.objectContaining({
        allergy_status: "registered",
        display_name: "更新後",
      }),
    );
  });
  await waitFor(() => {
    expect(screen.getByLabelText("呼び名")).toHaveValue("更新後");
  });
  expect(
    queryClient.getQueryData<HouseholdMemberRow[]>(["household", "members", "settings"]),
  ).toEqual([latestRegisteredMember]);
});

it("registered保存中のnone変更を後続保存して最終状態へ反映する", async () => {
  const registeredMember: HouseholdMemberRow = {
    ...member,
    allergy_status: "registered",
  };
  let resolveFirstUpdate: ((saved: HouseholdMemberRow) => void) | undefined;
  const updateMember = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<HouseholdMemberRow>((resolve) => {
          resolveFirstUpdate = resolve;
        }),
    )
    .mockResolvedValueOnce(member);
  const { queryClient } = renderSettings({
    listAllergies: vi.fn().mockResolvedValue([walnutAllergy]),
    updateMember,
  });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(1);
  });

  await userEvent.selectOptions(screen.getByLabelText("アレルギーの確認"), "none");
  expect(updateMember).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveFirstUpdate?.(registeredMember);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(updateMember).toHaveBeenNthCalledWith(
      2,
      "member-1",
      expect.objectContaining({ allergy_status: "none" }),
    );
  });
  await waitFor(() => {
    expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("none");
  });
  expect(
    queryClient.getQueryData<HouseholdMemberRow[]>(["household", "members", "settings"]),
  ).toEqual([member]);
});

it("アレルギー追加中に家族を往復してもregisteredを表示し元の家族だけへ保存する", async () => {
  const secondMember: HouseholdMemberRow = {
    ...member,
    id: "member-2",
    display_name: "子ども",
    sort_order: 1,
  };
  let resolveAdd: ((allergy: MemberAllergyRow) => void) | undefined;
  const addStandardAllergy = vi.fn(
    () =>
      new Promise<MemberAllergyRow>((resolve) => {
        resolveAdd = resolve;
      }),
  );
  const updateMember = vi.fn().mockResolvedValue(member);
  const { queryClient } = renderSettings({
    listMembers: vi.fn().mockResolvedValue([member, secondMember]),
    addStandardAllergy,
    updateMember,
  });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
  await userEvent.selectOptions(screen.getByLabelText("設定する家族"), "member-2");

  expect(await screen.findByLabelText("呼び名")).toHaveValue("子ども");
  await userEvent.selectOptions(screen.getByLabelText("設定する家族"), "member-1");
  expect(await screen.findByLabelText("アレルギーの確認")).toHaveValue("registered");

  await act(async () => {
    resolveAdd?.(walnutAllergy);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
    );
  });
  expect(updateMember).not.toHaveBeenCalledWith(
    "member-2",
    expect.objectContaining({ allergy_status: "registered" }),
  );
});

it("registered保存中に家族を往復しても成功後の表示とcacheを一致させる", async () => {
  const secondMember: HouseholdMemberRow = {
    ...member,
    id: "member-2",
    display_name: "子ども",
    sort_order: 1,
  };
  const registeredMember: HouseholdMemberRow = {
    ...member,
    allergy_status: "registered",
  };
  let resolveUpdate: ((saved: HouseholdMemberRow) => void) | undefined;
  const updateMember = vi.fn(
    () =>
      new Promise<HouseholdMemberRow>((resolve) => {
        resolveUpdate = resolve;
      }),
  );
  const { queryClient } = renderSettings({
    listMembers: vi.fn().mockResolvedValue([member, secondMember]),
    listAllergies: vi.fn((memberId: string) =>
      Promise.resolve(memberId === "member-1" ? [walnutAllergy] : []),
    ),
    updateMember,
  });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
    );
  });

  await userEvent.selectOptions(screen.getByLabelText("設定する家族"), "member-2");
  expect(await screen.findByLabelText("呼び名")).toHaveValue("子ども");
  await userEvent.selectOptions(screen.getByLabelText("設定する家族"), "member-1");
  expect(await screen.findByLabelText("アレルギーの確認")).toHaveValue("registered");

  await act(async () => {
    resolveUpdate?.(registeredMember);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("registered");
  });
  expect(
    queryClient.getQueryData<HouseholdMemberRow[]>(["household", "members", "settings"]),
  ).toEqual([registeredMember, secondMember]);
  expect(updateMember).not.toHaveBeenCalledWith(
    "member-2",
    expect.objectContaining({ allergy_status: "registered" }),
  );
});

it("registered保存失敗後に家族を往復してもローカル値を保持する", async () => {
  const secondMember: HouseholdMemberRow = {
    ...member,
    id: "member-2",
    display_name: "子ども",
    sort_order: 1,
  };
  const updateMember = vi.fn().mockRejectedValue(new Error("家族設定の保存に失敗しました"));
  const { queryClient } = renderSettings({
    listMembers: vi.fn().mockResolvedValue([member, secondMember]),
    listAllergies: vi.fn((memberId: string) =>
      Promise.resolve(memberId === "member-1" ? [walnutAllergy] : []),
    ),
    updateMember,
  });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("家族設定の保存に失敗しました");
  });

  await userEvent.selectOptions(screen.getByLabelText("設定する家族"), "member-2");
  expect(await screen.findByLabelText("呼び名")).toHaveValue("子ども");
  await userEvent.selectOptions(screen.getByLabelText("設定する家族"), "member-1");

  expect(await screen.findByLabelText("アレルギーの確認")).toHaveValue("registered");
  expect(
    queryClient.getQueryData<HouseholdMemberRow[]>(["household", "members", "settings"]),
  ).toEqual([member, secondMember]);
});

it("アレルギー追加後のregistered保存失敗を成功表示で上書きしない", async () => {
  const updateMember = vi.fn().mockRejectedValue(new Error("家族設定の保存に失敗しました"));
  const addStandardAllergy = vi.fn().mockResolvedValue(walnutAllergy);
  const { queryClient } = renderSettings({ addStandardAllergy, updateMember });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));

  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("家族設定の保存に失敗しました");
  });
  expect(screen.getByRole("status")).not.toHaveTextContent("最新条件で再確認します");
});

it.each(["standard", "custom"] as const)(
  "%s追加後のPATCH失敗文言をfallback無効化失敗で上書きしない",
  async (kind) => {
    const registeredMember: HouseholdMemberRow = {
      ...member,
      allergy_status: "registered",
      display_name: "更新後",
    };
    const updateMember = vi
      .fn()
      .mockRejectedValueOnce(new Error("家族設定の保存に失敗しました"))
      .mockResolvedValueOnce(registeredMember);
    const invalidateSafety = vi
      .fn()
      .mockRejectedValueOnce(new Error("安全条件の無効化に失敗しました"))
      .mockResolvedValue(undefined);
    const addStandardAllergy = vi.fn().mockResolvedValue(walnutAllergy);
    const addCustomAllergy = vi.fn().mockResolvedValue({
      ...walnutAllergy,
      allergen_id: null,
      custom_name: "マンゴー",
      custom_confirmed: true,
    });
    const { queryClient } = renderSettings({
      addCustomAllergy,
      addStandardAllergy,
      invalidateSafety,
      updateMember,
    });

    await waitForAllergies(queryClient);
    await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
    if (kind === "standard") {
      await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
    } else {
      await userEvent.type(screen.getByLabelText("自由登録名"), "マンゴー");
      await userEvent.click(screen.getByLabelText("標準候補に該当しないことを確認"));
      await userEvent.click(screen.getByRole("button", { name: "自由登録を追加" }));
    }

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("家族設定の保存に失敗しました");
    });
    expect(screen.getByRole("status")).not.toHaveTextContent("安全条件の無効化に失敗しました");
    expect(screen.getByRole("status")).not.toHaveTextContent("最新条件で再確認します");
    expect(updateMember).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("registered");
    await waitFor(() => {
      expect(invalidateSafety).toHaveBeenCalledTimes(1);
    });
    if (kind === "custom") {
      await waitFor(() => {
        expect(screen.getByLabelText("自由登録名")).toHaveValue("");
      });
      expect(screen.getByLabelText("標準候補に該当しないことを確認")).not.toBeChecked();
    }

    fireEvent.change(screen.getByLabelText("呼び名"), { target: { value: "更新後" } });

    await waitFor(() => {
      expect(updateMember).toHaveBeenNthCalledWith(
        2,
        "member-1",
        expect.objectContaining({ allergy_status: "registered", display_name: "更新後" }),
      );
    });
  },
);

it("applies age defaults when the user selects an age band", async () => {
  const { updateMember } = renderSettings();

  await userEvent.selectOptions(await screen.findByLabelText("年齢区分"), "age_3_5");

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({
        age_band: "age_3_5",
        ease_preferences: ["small_pieces", "boneless", "soft"],
        required_safety_constraints: ["remove_bones", "cut_small"],
      }),
    );
  });
});

it("persists an edit that only changes the display name", async () => {
  const { updateMember } = renderSettings();
  const input = await screen.findByLabelText("呼び名");

  fireEvent.change(input, { target: { value: "保護者" } });

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ display_name: "保護者" }),
    );
  });
});

it("keeps newer local edits when an older save response updates the member query", async () => {
  let resolveFirstSave: ((member: HouseholdMemberRow) => void) | undefined;
  const firstSave = new Promise<HouseholdMemberRow>((resolve) => {
    resolveFirstSave = resolve;
  });
  const updateMember = vi.fn().mockReturnValue(firstSave);
  renderSettings({ updateMember });
  const input = await screen.findByLabelText("呼び名");

  fireEvent.change(input, { target: { value: "最初の入力" } });
  fireEvent.change(input, { target: { value: "新しい入力" } });
  resolveFirstSave?.({ ...member, display_name: "最初の入力" });

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(2);
  });
  await waitFor(() => {
    expect(input).toHaveValue("新しい入力");
  });
});

it("keeps the latest local snapshot after a queued success then failure", async () => {
  const updateMember = vi
    .fn()
    .mockImplementationOnce((_memberId: string, patch: HouseholdMemberPatch) =>
      Promise.resolve({ ...member, ...patch }),
    )
    .mockRejectedValueOnce(new Error("後の保存に失敗しました"));
  const { queryClient } = renderSettings({ updateMember });
  const displayName = await screen.findByLabelText("呼び名");

  fireEvent.change(displayName, { target: { value: "保護者" } });
  fireEvent.change(screen.getByLabelText("辛さ"), { target: { value: "mild" } });

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(2);
  });
  expect(await screen.findByRole("status")).toHaveTextContent("後の保存に失敗しました");
  expect(displayName).toHaveValue("保護者");
  expect(screen.getByLabelText("辛さ")).toHaveValue("mild");

  await act(async () => {
    queryClient.setQueryData(householdKeys.members("settings"), [
      { ...member, display_name: "外部更新", spice_level: "regular" },
    ]);
    await Promise.resolve();
  });
  expect(displayName).toHaveValue("保護者");
  expect(screen.getByLabelText("辛さ")).toHaveValue("mild");
});

it("clears a failed local snapshot after the next queued full save succeeds", async () => {
  const updateMember = vi
    .fn()
    .mockRejectedValueOnce(new Error("先の保存に失敗しました"))
    .mockImplementationOnce((_memberId: string, patch: HouseholdMemberPatch) =>
      Promise.resolve({ ...member, ...patch }),
    );
  const { queryClient } = renderSettings({ updateMember });
  const displayName = await screen.findByLabelText("呼び名");

  fireEvent.change(displayName, { target: { value: "保護者" } });
  fireEvent.change(screen.getByLabelText("辛さ"), { target: { value: "mild" } });

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(2);
  });
  expect(updateMember.mock.calls[1]?.[1]).toEqual(
    expect.objectContaining({ display_name: "保護者", spice_level: "mild" }),
  );
  await act(async () => {
    queryClient.setQueryData(householdKeys.members("settings"), [
      { ...member, display_name: "外部更新", spice_level: "none" },
    ]);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(displayName).toHaveValue("外部更新");
    expect(screen.getByLabelText("辛さ")).toHaveValue("none");
  });
});

it("uses the latest member query values after switching away and back", async () => {
  const secondMember: HouseholdMemberRow = {
    ...member,
    id: "member-2",
    display_name: "子ども",
    sort_order: 1,
  };
  const latestMember: HouseholdMemberRow = {
    ...member,
    display_name: "保護者",
    portion_size: "large",
    spice_level: "mild",
    updated_at: "2026-07-18T00:00:00.000Z",
  };
  const updateMember = vi.fn().mockResolvedValue(latestMember);
  const { queryClient } = renderSettings({
    listMembers: vi.fn().mockResolvedValue([member, secondMember]),
    updateMember,
  });

  expect(await screen.findByLabelText("呼び名")).toHaveValue("大人");
  await userEvent.selectOptions(screen.getByLabelText("設定する家族"), secondMember.id);
  expect(await screen.findByLabelText("呼び名")).toHaveValue("子ども");

  await act(async () => {
    queryClient.setQueryData(householdKeys.members("settings"), [latestMember, secondMember]);
    await Promise.resolve();
  });
  await userEvent.selectOptions(screen.getByLabelText("設定する家族"), member.id);

  expect(await screen.findByLabelText("呼び名")).toHaveValue("保護者");
  expect(screen.getByLabelText("辛さ")).toHaveValue("mild");
  await userEvent.selectOptions(screen.getByLabelText("食べる量"), "small");

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      member.id,
      expect.objectContaining({
        display_name: "保護者",
        portion_size: "small",
        spice_level: "mild",
      }),
    );
  });
});
