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
    .mockResolvedValue([standardAllergy]);
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
