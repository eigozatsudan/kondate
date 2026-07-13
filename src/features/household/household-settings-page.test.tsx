import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { AllergenCatalogRow, HouseholdMemberRow } from "./household-api";
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
  resolveCreate?.({ ...member, id: "member-2", status: "draft" });
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
