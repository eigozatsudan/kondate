import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  return { api, updateMember, invalidateSafety };
}

it("renders the complete household editor without account deletion", async () => {
  renderSettings();
  expect(await screen.findByRole("heading", { name: "家族設定" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "アカウントを削除" })).not.toBeInTheDocument();
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
