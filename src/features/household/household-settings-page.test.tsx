import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { AllergenCatalogRow, HouseholdMemberRow, MemberAllergyRow } from "./household-api";
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

const walnutAllergy: MemberAllergyRow = {
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

it("アレルギー取得中のregistered変更は既存アレルギー確認後に保存する", async () => {
  let resolveAllergies: ((allergies: MemberAllergyRow[]) => void) | undefined;
  const listAllergies = vi.fn(
    () =>
      new Promise<MemberAllergyRow[]>((resolve) => {
        resolveAllergies = resolve;
      }),
  );
  const { updateMember } = renderSettings({ listAllergies });

  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");

  expect(updateMember).not.toHaveBeenCalled();

  await act(async () => {
    resolveAllergies?.([walnutAllergy]);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
    );
  });
});

it("アレルギー取得中のregistered変更は0件確認後に案内して保存しない", async () => {
  let resolveAllergies: ((allergies: MemberAllergyRow[]) => void) | undefined;
  const listAllergies = vi.fn(
    () =>
      new Promise<MemberAllergyRow[]>((resolve) => {
        resolveAllergies = resolve;
      }),
  );
  const { updateMember } = renderSettings({ listAllergies });

  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");

  expect(updateMember).not.toHaveBeenCalled();

  await act(async () => {
    resolveAllergies?.([]);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("登録ありの場合は1つ以上選んでください");
  });
  expect(updateMember).not.toHaveBeenCalled();
});

it("アレルギー取得中のsafe保存後はregisteredを送らず取得成功後に再開する", async () => {
  const registeredMember: HouseholdMemberRow = {
    ...member,
    allergy_status: "registered",
  };
  let resolveAllergies: ((allergies: MemberAllergyRow[]) => void) | undefined;
  let resolveNoneUpdate: ((saved: HouseholdMemberRow) => void) | undefined;
  const listAllergies = vi.fn(
    () =>
      new Promise<MemberAllergyRow[]>((resolve) => {
        resolveAllergies = resolve;
      }),
  );
  const updateMember = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<HouseholdMemberRow>((resolve) => {
          resolveNoneUpdate = resolve;
        }),
    )
    .mockResolvedValueOnce(registeredMember);
  renderSettings({ listAllergies, updateMember });

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
  expect(screen.getByRole("status")).toHaveTextContent("アレルギー情報を確認しています");

  await act(async () => {
    resolveAllergies?.([walnutAllergy]);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(updateMember).toHaveBeenNthCalledWith(
      2,
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
    );
  });
});

it("アレルギー取得失敗時はregisteredを保存せず再取得成功後に保存する", async () => {
  let resolveRetry: ((allergies: MemberAllergyRow[]) => void) | undefined;
  const listAllergies = vi
    .fn()
    .mockRejectedValueOnce(new Error("取得失敗"))
    .mockImplementation(
      () =>
        new Promise<MemberAllergyRow[]>((resolve) => {
          resolveRetry = resolve;
        }),
    );
  const { updateMember } = renderSettings({ listAllergies });

  await waitFor(() => {
    expect(listAllergies).toHaveBeenCalledTimes(1);
  });
  await waitFor(() => {
    expect(screen.getByLabelText("アレルギーの確認")).toBeVisible();
  });
  await userEvent.selectOptions(screen.getByLabelText("アレルギーの確認"), "registered");

  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent(
      "アレルギー情報を確認できませんでした。もう一度お試しください",
    );
  });
  expect(listAllergies).toHaveBeenCalledTimes(2);
  expect(updateMember).not.toHaveBeenCalled();

  await act(async () => {
    resolveRetry?.([walnutAllergy]);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
    );
  });
});

it("アレルギー取得失敗後の再取得が0件なら案内して保存しない", async () => {
  let resolveRetry: ((allergies: MemberAllergyRow[]) => void) | undefined;
  const listAllergies = vi
    .fn()
    .mockRejectedValueOnce(new Error("取得失敗"))
    .mockImplementation(
      () =>
        new Promise<MemberAllergyRow[]>((resolve) => {
          resolveRetry = resolve;
        }),
    );
  const { updateMember } = renderSettings({ listAllergies });

  await waitFor(() => {
    expect(listAllergies).toHaveBeenCalledTimes(1);
  });
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await waitFor(() => {
    expect(listAllergies).toHaveBeenCalledTimes(2);
  });

  await act(async () => {
    resolveRetry?.([]);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("登録ありの場合は1つ以上選んでください");
  });
  expect(updateMember).not.toHaveBeenCalled();
});

it("アレルギー再取得中のsafe保存後はregisteredを送らず再取得成功後に再開する", async () => {
  const registeredMember: HouseholdMemberRow = {
    ...member,
    allergy_status: "registered",
  };
  let resolveRetry: ((allergies: MemberAllergyRow[]) => void) | undefined;
  let resolveNoneUpdate: ((saved: HouseholdMemberRow) => void) | undefined;
  const listAllergies = vi
    .fn()
    .mockRejectedValueOnce(new Error("取得失敗"))
    .mockImplementation(
      () =>
        new Promise<MemberAllergyRow[]>((resolve) => {
          resolveRetry = resolve;
        }),
    );
  const updateMember = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<HouseholdMemberRow>((resolve) => {
          resolveNoneUpdate = resolve;
        }),
    )
    .mockResolvedValueOnce(registeredMember);
  renderSettings({ listAllergies, updateMember });

  await waitFor(() => {
    expect(listAllergies).toHaveBeenCalledTimes(1);
  });
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await waitFor(() => {
    expect(listAllergies).toHaveBeenCalledTimes(2);
  });
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
  expect(screen.getByRole("status")).toHaveTextContent("アレルギー情報を確認しています");

  await act(async () => {
    resolveRetry?.([walnutAllergy]);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(updateMember).toHaveBeenNthCalledWith(
      2,
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
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

it.each(["none", "unconfirmed"] as const)(
  "アレルギー追加中に%sへ変更した場合はregistered保存を取り消す",
  async (allergyStatus) => {
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
    await userEvent.selectOptions(screen.getByLabelText("アレルギーの確認"), allergyStatus);

    await waitFor(() => {
      expect(updateMember).toHaveBeenCalledWith(
        "member-1",
        expect.objectContaining({ allergy_status: allergyStatus }),
      );
    });

    await act(async () => {
      resolveAdd?.(walnutAllergy);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(addStandardAllergy).toHaveBeenCalledTimes(1);
    });
    expect(updateMember).toHaveBeenCalledTimes(1);
  },
);

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

it("registered保存がqueue待ちの間に最後のアレルギーを削除したら古いPATCHを送らない", async () => {
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
    .mockResolvedValueOnce(registeredMember);
  let resolveEmptyAllergies: ((allergies: MemberAllergyRow[]) => void) | undefined;
  const listAllergies = vi
    .fn()
    .mockResolvedValueOnce([walnutAllergy])
    .mockImplementationOnce(
      () =>
        new Promise<MemberAllergyRow[]>((resolve) => {
          resolveEmptyAllergies = resolve;
        }),
    );
  let resolveRemove: (() => void) | undefined;
  const removeAllergy = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveRemove = resolve;
      }),
  );
  const { queryClient } = renderSettings({ listAllergies, removeAllergy, updateMember });

  await waitForAllergies(queryClient);
  fireEvent.change(await screen.findByLabelText("呼び名"), { target: { value: "先行保存" } });
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(1);
  });
  await userEvent.selectOptions(screen.getByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを削除" }));

  await waitFor(() => {
    expect(removeAllergy).toHaveBeenCalledWith("allergy-1");
  });
  await act(async () => {
    resolveRemove?.();
    fireEvent.change(screen.getByLabelText("呼び名"), { target: { value: "削除確認中" } });
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(listAllergies).toHaveBeenCalledTimes(2);
  });
  await act(async () => {
    queryClient.setQueryData(
      ["household", "allergies", "settings", "member-1"],
      [{ ...walnutAllergy, id: "allergy-1-stale" }],
    );
    await Promise.resolve();
  });
  await act(async () => {
    resolveFirstUpdate?.(member);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(updateMember).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveEmptyAllergies?.([]);
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("登録ありの場合は1つ以上選んでください");
  });
});

it("削除前から進行中の取得が終わっても削除後のregisteredを送らない", async () => {
  const registeredMember: HouseholdMemberRow = { ...member, allergy_status: "registered" };
  let resolveFirstUpdate: ((saved: HouseholdMemberRow) => void) | undefined;
  let resolveOldFetch: ((allergies: MemberAllergyRow[]) => void) | undefined;
  let resolveFreshFetch: ((allergies: MemberAllergyRow[]) => void) | undefined;
  const listAllergies = vi
    .fn()
    .mockResolvedValueOnce([walnutAllergy])
    .mockImplementationOnce(
      () => new Promise<MemberAllergyRow[]>((resolve) => (resolveOldFetch = resolve)),
    )
    .mockImplementationOnce(
      () => new Promise<MemberAllergyRow[]>((resolve) => (resolveFreshFetch = resolve)),
    );
  const updateMember = vi
    .fn()
    .mockImplementationOnce(
      () => new Promise<HouseholdMemberRow>((resolve) => (resolveFirstUpdate = resolve)),
    )
    .mockResolvedValueOnce(registeredMember);
  const removeAllergy = vi.fn().mockResolvedValue(undefined);
  const { queryClient } = renderSettings({ listAllergies, removeAllergy, updateMember });

  await waitForAllergies(queryClient);
  fireEvent.change(await screen.findByLabelText("呼び名"), { target: { value: "先行保存" } });
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(1);
  });
  await userEvent.selectOptions(screen.getByLabelText("アレルギーの確認"), "registered");
  void queryClient.invalidateQueries({
    queryKey: ["household", "allergies", "settings", "member-1"],
  });
  await waitFor(() => {
    expect(listAllergies).toHaveBeenCalledTimes(2);
  });
  await userEvent.click(screen.getByRole("button", { name: "くるみを削除" }));

  await act(async () => {
    resolveOldFetch?.([walnutAllergy]);
    resolveFirstUpdate?.(member);
    await Promise.resolve();
  });
  expect(updateMember).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolveFreshFetch?.([]);
    await Promise.resolve();
  });
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
