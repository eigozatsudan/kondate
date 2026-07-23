import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

it("resumes one draft, saves each required selection, and completes through completeMember->setProgress->navigate", async () => {
  const user = userEvent.setup();
  let currentDraft = draft;
  const order: string[] = [];
  const updateDraft = vi.fn((_memberId: string, patch: HouseholdDraftPatch) => {
    currentDraft = { ...currentDraft, ...patch };
    return Promise.resolve(currentDraft);
  });
  const completeMember = vi.fn(() => {
    order.push("completeMember");
    return Promise.resolve({
      ...draft,
      age_band: "adult" as const,
      allergy_status: "none" as const,
      unsupported_diet_status: "none" as const,
      status: "complete" as const,
    });
  });
  const setProgress = vi.fn(() => {
    order.push("setProgress");
    return Promise.resolve({});
  });
  const onDone = vi.fn(() => {
    order.push("navigate");
  });
  const api: HouseholdOnboardingApi = {
    listMembers: vi.fn().mockResolvedValue([draft]),
    createDraft: vi.fn(),
    updateDraft,
    completeMember,
    listAllergies: vi.fn().mockResolvedValue([]),
    addCustomAllergy: vi.fn(),
    setProgress,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <HouseholdOnboardingForm userId="user-1" api={api} onDone={onDone} />
    </QueryClientProvider>,
  );

  expect(await screen.findByText("設定済み項目 0 / 3")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("年齢のめやす"), "adult");
  await user.selectOptions(screen.getByLabelText("アレルギーの確認"), "none");
  await user.selectOptions(screen.getByLabelText("食べない食事はありますか"), "none");
  expect(await screen.findByText("設定済み項目 3 / 3")).toBeInTheDocument();
  expect(updateDraft).toHaveBeenCalledTimes(3);
  await user.click(screen.getByRole("button", { name: "この家族の設定を完了する" }));
  await waitFor(() => {
    expect(onDone).toHaveBeenCalledOnce();
  });
  expect(completeMember).toHaveBeenCalledWith("member-1");
  expect(setProgress).toHaveBeenCalledWith("complete");
  expect(order).toEqual(["completeMember", "setProgress", "navigate"]);
});

it("stays on the page and shows a retryable error when setProgress fails after completeMember succeeds", async () => {
  const user = userEvent.setup();
  const completableDraft: HouseholdMemberRow = {
    ...draft,
    age_band: "adult",
    allergy_status: "none",
    unsupported_diet_status: "none",
  };
  const completeMember = vi.fn().mockResolvedValue({ ...completableDraft, status: "complete" });
  const setProgress = vi.fn().mockRejectedValue(new Error("network"));
  const onDone = vi.fn();
  const api: HouseholdOnboardingApi = {
    listMembers: vi.fn().mockResolvedValue([completableDraft]),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    completeMember,
    listAllergies: vi.fn().mockResolvedValue([]),
    addCustomAllergy: vi.fn(),
    setProgress,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <HouseholdOnboardingForm userId="user-1" api={api} onDone={onDone} />
    </QueryClientProvider>,
  );

  await user.click(await screen.findByRole("button", { name: "この家族の設定を完了する" }));

  expect(
    await screen.findByText("設定を完了できませんでした。通信を確認して再試行してください。"),
  ).toBeInTheDocument();
  expect(completeMember).toHaveBeenCalledWith("member-1");
  expect(setProgress).toHaveBeenCalledWith("complete");
  expect(onDone).not.toHaveBeenCalled();
});

it("does not call setProgress or navigate when completeMember fails", async () => {
  const user = userEvent.setup();
  const completableDraft: HouseholdMemberRow = {
    ...draft,
    age_band: "adult",
    allergy_status: "none",
    unsupported_diet_status: "none",
  };
  const completeMember = vi.fn().mockRejectedValue(new Error("network"));
  const setProgress = vi.fn();
  const onDone = vi.fn();
  const api: HouseholdOnboardingApi = {
    listMembers: vi.fn().mockResolvedValue([completableDraft]),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    completeMember,
    listAllergies: vi.fn().mockResolvedValue([]),
    addCustomAllergy: vi.fn(),
    setProgress,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <HouseholdOnboardingForm userId="user-1" api={api} onDone={onDone} />
    </QueryClientProvider>,
  );

  await user.click(await screen.findByRole("button", { name: "この家族の設定を完了する" }));

  expect(
    await screen.findByText("保存できませんでした。選び直して再試行してください。"),
  ).toBeInTheDocument();
  expect(setProgress).not.toHaveBeenCalled();
  expect(onDone).not.toHaveBeenCalled();
});

it("saves an incomplete unsupported diet draft before requiring a kind at completion", async () => {
  const user = userEvent.setup();
  let currentDraft: HouseholdMemberRow = {
    ...draft,
    age_band: "adult",
    allergy_status: "none",
  };
  const updateDraft = vi.fn((_memberId: string, patch: HouseholdDraftPatch) => {
    currentDraft = { ...currentDraft, ...patch };
    return Promise.resolve(currentDraft);
  });
  const api: HouseholdOnboardingApi = {
    listMembers: vi.fn().mockResolvedValue([currentDraft]),
    createDraft: vi.fn(),
    updateDraft,
    completeMember: vi.fn(),
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

  await user.selectOptions(await screen.findByLabelText("食べない食事はありますか"), "present");

  expect(updateDraft).toHaveBeenNthCalledWith(1, "member-1", {
    unsupported_diet_status: "present",
    unsupported_diet_kinds: [],
  });
  const completeButton = screen.getByRole("button", { name: "この家族の設定を完了する" });
  expect(completeButton).toBeDisabled();

  await user.click(await screen.findByRole("checkbox", { name: "離乳食" }));

  expect(updateDraft).toHaveBeenNthCalledWith(2, "member-1", {
    unsupported_diet_kinds: ["weaning_food"],
  });
  expect(completeButton).toBeEnabled();
});

it("completes onboarding through setProgress->navigate when a complete member already exists and no draft is open", async () => {
  const user = userEvent.setup();
  const order: string[] = [];
  const onDone = vi.fn(() => {
    order.push("navigate");
  });
  const setProgress = vi.fn(() => {
    order.push("setProgress");
    return Promise.resolve({});
  });
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

  await user.click(await screen.findByRole("button", { name: "この家族の設定を完了する" }));

  await waitFor(() => {
    expect(onDone).toHaveBeenCalledOnce();
  });
  expect(setProgress).toHaveBeenCalledWith("complete");
  expect(order).toEqual(["setProgress", "navigate"]);
});

it("stays on the page with a retryable error when setProgress fails for an already-complete member", async () => {
  const user = userEvent.setup();
  const onDone = vi.fn();
  const setProgress = vi.fn().mockRejectedValue(new Error("network"));
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

  await user.click(await screen.findByRole("button", { name: "この家族の設定を完了する" }));

  expect(
    await screen.findByText("設定を完了できませんでした。通信を確認して再試行してください。"),
  ).toBeInTheDocument();
  expect(onDone).not.toHaveBeenCalled();
});

it("serializes rapid draft updates in input order", async () => {
  const user = userEvent.setup();
  const firstUpdate = deferred<HouseholdMemberRow>();
  const updateDraft = vi
    .fn()
    .mockImplementationOnce(() => firstUpdate.promise)
    .mockResolvedValueOnce({ ...draft, age_band: "adult", allergy_status: "none" });
  const api: HouseholdOnboardingApi = {
    listMembers: vi.fn().mockResolvedValue([draft]),
    createDraft: vi.fn(),
    updateDraft,
    completeMember: vi.fn(),
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

  await user.selectOptions(await screen.findByLabelText("年齢のめやす"), "adult");
  await user.selectOptions(screen.getByLabelText("アレルギーの確認"), "none");

  expect(updateDraft).toHaveBeenCalledTimes(1);
  firstUpdate.resolve({ ...draft, age_band: "adult" });
  await waitFor(() => {
    expect(updateDraft).toHaveBeenCalledTimes(2);
  });
  expect(updateDraft).toHaveBeenNthCalledWith(
    2,
    "member-1",
    expect.objectContaining({ age_band: "adult", allergy_status: "none" }),
  );
});

it("preserves rapid changes to the same field while the first save is pending", async () => {
  const user = userEvent.setup();
  const firstUpdate = deferred<HouseholdMemberRow>();
  const updateDraft = vi
    .fn()
    .mockImplementationOnce(() => firstUpdate.promise)
    .mockResolvedValueOnce({ ...draft, display_name: "母娘" });
  const api: HouseholdOnboardingApi = {
    listMembers: vi.fn().mockResolvedValue([draft]),
    createDraft: vi.fn(),
    updateDraft,
    completeMember: vi.fn(),
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

  const displayName = await screen.findByLabelText("呼び名（任意・AIには送りません）");
  await user.type(displayName, "母娘");

  expect(displayName).toHaveValue("母娘");
  expect(updateDraft).toHaveBeenCalledTimes(1);
  expect(updateDraft).toHaveBeenNthCalledWith(1, "member-1", { display_name: "母" });

  firstUpdate.resolve({ ...draft, display_name: "母" });
  await waitFor(() => {
    expect(updateDraft).toHaveBeenCalledTimes(2);
  });
  expect(updateDraft).toHaveBeenNthCalledWith(2, "member-1", { display_name: "母娘" });
  expect(displayName).toHaveValue("母娘");
});

it("waits for pending draft saves before completing a member", async () => {
  const user = userEvent.setup();
  const pendingUpdate = deferred<HouseholdMemberRow>();
  const completableDraft: HouseholdMemberRow = {
    ...draft,
    age_band: "adult",
    allergy_status: "none",
    unsupported_diet_status: "none",
  };
  const completeMember = vi.fn().mockResolvedValue({
    ...completableDraft,
    display_name: "母",
    status: "complete",
  });
  const api: HouseholdOnboardingApi = {
    listMembers: vi.fn().mockResolvedValue([completableDraft]),
    createDraft: vi.fn(),
    updateDraft: vi.fn().mockReturnValue(pendingUpdate.promise),
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

  await user.type(await screen.findByLabelText("呼び名（任意・AIには送りません）"), "母");
  await user.click(screen.getByRole("button", { name: "この家族の設定を完了する" }));
  expect(completeMember).not.toHaveBeenCalled();

  pendingUpdate.resolve({ ...completableDraft, display_name: "母" });
  await waitFor(() => {
    expect(completeMember).toHaveBeenCalledWith("member-1");
  });
});

it("retries unsaved fields with a later queued save after an earlier save fails", async () => {
  const user = userEvent.setup();
  const firstUpdate = deferred<HouseholdMemberRow>();
  const updateDraft = vi
    .fn()
    .mockImplementationOnce(() => firstUpdate.promise)
    .mockResolvedValueOnce({ ...draft, allergy_status: "none" });
  const api: HouseholdOnboardingApi = {
    listMembers: vi.fn().mockResolvedValue([draft]),
    createDraft: vi.fn(),
    updateDraft,
    completeMember: vi.fn(),
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

  await user.selectOptions(await screen.findByLabelText("年齢のめやす"), "adult");
  await user.selectOptions(screen.getByLabelText("アレルギーの確認"), "none");
  firstUpdate.reject(new Error("一時的な保存失敗"));

  await waitFor(() => {
    expect(updateDraft).toHaveBeenCalledTimes(2);
  });
  expect(updateDraft).toHaveBeenNthCalledWith(
    2,
    "member-1",
    expect.objectContaining({
      age_band: "adult",
      allergy_status: "none",
    }),
  );
  expect(await screen.findByText("保存済み")).toBeInTheDocument();
});

it("does not complete or report saved when the final queued save fails", async () => {
  const user = userEvent.setup();
  const pendingUpdate = deferred<HouseholdMemberRow>();
  const completableDraft: HouseholdMemberRow = {
    ...draft,
    age_band: "adult",
    allergy_status: "none",
    unsupported_diet_status: "none",
  };
  const completeMember = vi.fn();
  const api: HouseholdOnboardingApi = {
    listMembers: vi.fn().mockResolvedValue([completableDraft]),
    createDraft: vi.fn(),
    updateDraft: vi.fn().mockReturnValue(pendingUpdate.promise),
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

  await user.type(await screen.findByLabelText("呼び名（任意・AIには送りません）"), "母");
  await user.click(screen.getByRole("button", { name: "この家族の設定を完了する" }));
  pendingUpdate.reject(new Error("一時的な保存失敗"));

  expect(
    await screen.findByText("保存できませんでした。選び直して再試行してください。"),
  ).toBeInTheDocument();
  expect(completeMember).not.toHaveBeenCalled();
  expect(screen.queryByText("保存済み")).not.toBeInTheDocument();
});

it("任意性が明確な文言を表示し、旧「必須設定」表現を残さない", async () => {
  const api: HouseholdOnboardingApi = {
    listMembers: vi.fn().mockResolvedValue([draft]),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    completeMember: vi.fn(),
    listAllergies: vi.fn().mockResolvedValue([]),
    addCustomAllergy: vi.fn(),
    setProgress: vi.fn(),
  };
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />
    </QueryClientProvider>,
  );

  expect(await screen.findByText("家族設定（任意）", { exact: false })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "この家族の設定を完了する" })).toBeInTheDocument();
  expect(screen.queryByText("必須設定", { exact: false })).not.toBeInTheDocument();
  expect(screen.queryByText("残りはあとで設定して完了")).not.toBeInTheDocument();
});

it("draft が無く complete member が既にいる場合も任意性が明確な完了ボタン文言を使う", async () => {
  const api: HouseholdOnboardingApi = {
    listMembers: vi.fn().mockResolvedValue([{ ...draft, status: "complete" as const }]),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    completeMember: vi.fn(),
    listAllergies: vi.fn(),
    addCustomAllergy: vi.fn(),
    setProgress: vi.fn(),
  };
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />
    </QueryClientProvider>,
  );

  expect(
    await screen.findByRole("button", { name: "この家族の設定を完了する" }),
  ).toBeInTheDocument();
});
