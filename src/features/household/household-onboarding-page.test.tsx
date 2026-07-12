import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { HouseholdDraftPatch, HouseholdMemberRow } from "./household-api";
import { HouseholdOnboardingForm, type HouseholdOnboardingApi } from "./household-onboarding-page";

const draft: HouseholdMemberRow = {
  id: "member-1",
  user_id: "user-1",
  status: "draft",
  display_name: null,
  age_band: null,
  portion_size: null,
  spice_level: null,
  ease_preferences: [],
  required_safety_constraints: [],
  allergy_status: null,
  unsupported_diet_status: null,
  unsupported_diet_kinds: [],
  sort_order: 0,
  created_at: "2026-07-11T00:00:00.000Z",
  updated_at: "2026-07-11T00:00:00.000Z",
};

it("resumes one draft and saves each required selection", async () => {
  const user = userEvent.setup();
  let currentDraft = draft;
  const updateDraft = vi.fn((_memberId: string, patch: HouseholdDraftPatch) => {
    currentDraft = { ...currentDraft, ...patch };
    return Promise.resolve(currentDraft);
  });
  const completeMember = vi.fn(() =>
    Promise.resolve({
      ...draft,
      age_band: "adult" as const,
      allergy_status: "none" as const,
      unsupported_diet_status: "none" as const,
      status: "complete" as const,
    }),
  );
  const api: HouseholdOnboardingApi = {
    listMembers: vi.fn().mockResolvedValue([draft]),
    createDraft: vi.fn(),
    updateDraft,
    completeMember,
    listAllergies: vi.fn().mockResolvedValue([]),
    addCustomAllergy: vi.fn(),
    setProgress: vi.fn(),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />
    </QueryClientProvider>,
  );

  expect(await screen.findByText("必須項目 0 / 3")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("年齢区分"), "adult");
  await user.selectOptions(screen.getByLabelText("アレルギーの確認"), "none");
  await user.selectOptions(screen.getByLabelText("対象外の食事の確認"), "none");
  expect(await screen.findByText("必須項目 3 / 3")).toBeInTheDocument();
  expect(updateDraft).toHaveBeenCalledTimes(3);
  await user.click(screen.getByRole("button", { name: "残りはあとで設定して完了" }));
  expect(completeMember).toHaveBeenCalledWith("member-1");
});

it("opens the privacy notice without completing onboarding", async () => {
  const user = userEvent.setup();
  const onDone = vi.fn();
  const setProgress = vi.fn();
  const api: HouseholdOnboardingApi = {
    listMembers: vi.fn().mockResolvedValue([{ ...draft, status: "complete" as const }]),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    completeMember: vi.fn(),
    listAllergies: vi.fn(),
    addCustomAllergy: vi.fn(),
    setProgress,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <HouseholdOnboardingForm userId="user-1" api={api} onDone={onDone} />
    </QueryClientProvider>,
  );

  await user.click(await screen.findByRole("button", { name: "AI情報の説明へ" }));

  expect(onDone).toHaveBeenCalledOnce();
  expect(setProgress).not.toHaveBeenCalled();
});
