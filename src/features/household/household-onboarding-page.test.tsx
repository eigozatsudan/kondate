import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AppToastProvider } from "@/shared/ui/app-toast";
import type { OnboardingStatus } from "@shared/contracts/domain";
import type { HouseholdDraftPatch, HouseholdMemberRow, ProfileRow } from "./household-api";
import { HouseholdOnboardingForm, type HouseholdOnboardingApi } from "./household-onboarding-page";
import { UNSUPPORTED_DIET_KIND_LABELS } from "./unsupported-diet-copy";

/** オンボーディング unit は useAppToast 前提のため Provider を同梱する */
function renderOnboarding(
  ui: React.ReactElement,
  client: QueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return render(
    <QueryClientProvider client={client}>
      <AppToastProvider>{ui}</AppToastProvider>
    </QueryClientProvider>,
  );
}

/** 親質問は長いため部分一致（settings と同契約） */
const unsupportedDietStatusLabel = /このアプリで献立を作れない事情はありますか/u;

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

const completeAdult: HouseholdMemberRow = {
  ...draft,
  status: "complete",
  age_band: "adult",
  allergy_status: "none",
  unsupported_diet_status: "none",
};

function mockProfile(status: OnboardingStatus): ProfileRow {
  return {
    user_id: "user-1",
    onboarding_status: status,
    onboarding_completed_at:
      status === "complete" || status === "skipped" ? "2026-07-11T00:00:00.000Z" : null,
    created_at: "2026-07-11T00:00:00.000Z",
    updated_at: "2026-07-11T00:00:00.000Z",
  };
}

/** invalidate → listMembers refetch 後も complete が残るようにする */
function createMembersApiState(initial: HouseholdMemberRow[]) {
  let members = initial.map((member) => ({ ...member }));
  return {
    listMembers: vi.fn(() => Promise.resolve(members.map((member) => ({ ...member })))),
    upsert(member: HouseholdMemberRow) {
      const index = members.findIndex((item) => item.id === member.id);
      if (index >= 0) {
        members[index] = { ...member };
      } else {
        members = [...members, { ...member }];
      }
    },
  };
}

function baseApi(overrides: Partial<HouseholdOnboardingApi> = {}): HouseholdOnboardingApi {
  return {
    listMembers: vi.fn().mockResolvedValue([draft]),
    getProfile: vi.fn().mockResolvedValue(mockProfile("in_progress")),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    completeMember: vi.fn(),
    listAllergies: vi.fn().mockResolvedValue([]),
    addCustomAllergy: vi.fn(),
    // H7: 戻り onboarding_status を検査するため Profile 形で返す
    setProgress: vi.fn().mockResolvedValue(mockProfile("complete")),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

it("completes member without setProgress or navigate, then shows next-action screen", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([draft]);
  let currentDraft = draft;
  const updateDraft = vi.fn((_memberId: string, patch: HouseholdDraftPatch) => {
    currentDraft = { ...currentDraft, ...patch };
    membersState.upsert(currentDraft);
    return Promise.resolve(currentDraft);
  });
  const completeMember = vi.fn(() => {
    const completed = {
      ...currentDraft,
      age_band: "adult" as const,
      allergy_status: "none" as const,
      unsupported_diet_status: "none" as const,
      status: "complete" as const,
    };
    membersState.upsert(completed);
    return Promise.resolve(completed);
  });
  const setProgress = vi.fn().mockResolvedValue(mockProfile("complete"));
  const onDone = vi.fn();
  const api = baseApi({
    listMembers: membersState.listMembers,
    updateDraft,
    completeMember,
    setProgress,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={onDone} />, client);

  expect(await screen.findByText("設定済み項目 0 / 3")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("年齢のめやす"), "adult");
  await user.selectOptions(screen.getByLabelText("アレルギーの確認"), "none");
  await user.selectOptions(screen.getByLabelText(unsupportedDietStatusLabel), "none");
  expect(await screen.findByText("設定済み項目 3 / 3")).toBeInTheDocument();
  expect(updateDraft).toHaveBeenCalledTimes(3);
  await user.click(screen.getByRole("button", { name: "この家族の設定を完了する" }));

  await waitFor(() => {
    expect(
      screen.getByRole("heading", { level: 1, name: "1人目の登録が完了しました" }),
    ).toBeInTheDocument();
  });
  expect(screen.getByText("1人の設定が完了しています。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "献立を始める" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "続けて家族を追加" })).toBeInTheDocument();
  expect(completeMember).toHaveBeenCalledWith("member-1");
  expect(setProgress).not.toHaveBeenCalled();
  expect(onDone).not.toHaveBeenCalled();
});

it("starts planner from next-action via setProgress complete then onDone", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([completeAdult]);
  const setProgress = vi.fn().mockResolvedValue(mockProfile("complete"));
  const onDone = vi.fn();
  const api = baseApi({
    listMembers: membersState.listMembers,
    getProfile: vi.fn().mockResolvedValue(mockProfile("in_progress")),
    setProgress,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={onDone} />, client);

  await user.click(await screen.findByRole("button", { name: "献立を始める" }));
  await waitFor(() => {
    expect(onDone).toHaveBeenCalledOnce();
  });
  // onboarding complete は CAS（expectedStatus=in_progress）
  expect(setProgress).toHaveBeenCalledWith("complete", { expectedStatus: "in_progress" });
});

it("keeps next-action and shows error when setProgress CAS miss returns non-complete (H7)", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([completeAdult]);
  // 他タブが先に skip した想定: RPC は上書きせず skipped を返す
  const setProgress = vi.fn().mockResolvedValue(mockProfile("skipped"));
  const onDone = vi.fn();
  const api = baseApi({
    listMembers: membersState.listMembers,
    getProfile: vi.fn().mockResolvedValue(mockProfile("in_progress")),
    setProgress,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={onDone} />, client);

  await user.click(await screen.findByRole("button", { name: "献立を始める" }));
  expect(
    await screen.findByText("設定を完了できませんでした。通信を確認して再試行してください。"),
  ).toBeInTheDocument();
  expect(onDone).not.toHaveBeenCalled();
  expect(
    screen.getByRole("heading", { level: 1, name: "1人目の登録が完了しました" }),
  ).toBeInTheDocument();
});

it("keeps next-action and shows error when setProgress complete fails on primary CTA", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([completeAdult]);
  const onDone = vi.fn();
  const api = baseApi({
    listMembers: membersState.listMembers,
    getProfile: vi.fn().mockResolvedValue(mockProfile("in_progress")),
    setProgress: vi.fn().mockRejectedValue(new Error("network")),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={onDone} />, client);

  await user.click(await screen.findByRole("button", { name: "献立を始める" }));
  expect(
    await screen.findByText("設定を完了できませんでした。通信を確認して再試行してください。"),
  ).toBeInTheDocument();
  expect(onDone).not.toHaveBeenCalled();
  expect(
    screen.getByRole("heading", { level: 1, name: "1人目の登録が完了しました" }),
  ).toBeInTheDocument();
});

it("uses 献立を始める as primary CTA when complete members exist without draft", async () => {
  const membersState = createMembersApiState([completeAdult]);
  const api = baseApi({ listMembers: membersState.listMembers });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  expect(await screen.findByRole("button", { name: "献立を始める" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "続けて家族を追加" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "この家族の設定を完了する" }),
  ).not.toBeInTheDocument();
});

it("does not call setProgress or navigate when completeMember fails", async () => {
  const user = userEvent.setup();
  const completableDraft: HouseholdMemberRow = {
    ...draft,
    age_band: "adult",
    allergy_status: "none",
    unsupported_diet_status: "none",
  };
  const membersState = createMembersApiState([completableDraft]);
  const completeMember = vi.fn().mockRejectedValue(new Error("network"));
  const setProgress = vi.fn();
  const onDone = vi.fn();
  const api = baseApi({
    listMembers: membersState.listMembers,
    completeMember,
    setProgress,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={onDone} />, client);

  await user.click(await screen.findByRole("button", { name: "この家族の設定を完了する" }));

  // U3-I1: complete 失敗は専用 alert。autosave failed 文言に倒さず CTA 再試行可能。
  expect(
    await screen.findByText("設定を完了できませんでした。通信を確認して再試行してください。"),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "この家族の設定を完了する" })).toBeEnabled();
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
  const membersState = createMembersApiState([currentDraft]);
  const updateDraft = vi.fn((_memberId: string, patch: HouseholdDraftPatch) => {
    currentDraft = { ...currentDraft, ...patch };
    membersState.upsert(currentDraft);
    return Promise.resolve(currentDraft);
  });
  const api = baseApi({
    listMembers: membersState.listMembers,
    updateDraft,
    completeMember: vi.fn(),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  await user.selectOptions(await screen.findByLabelText(unsupportedDietStatusLabel), "present");

  expect(updateDraft).toHaveBeenNthCalledWith(1, "member-1", {
    unsupported_diet_status: "present",
    unsupported_diet_kinds: [],
  });
  const completeButton = screen.getByRole("button", { name: "この家族の設定を完了する" });
  expect(completeButton).not.toBeDisabled();
  await user.click(completeButton);
  // toast と form alert の両方に検証メッセージが出る
  expect(screen.getAllByText(/選んでください|確認してください|入力内容/).length).toBeGreaterThan(0);
  expect(screen.getByRole("alert")).toBeVisible();

  await user.click(
    await screen.findByRole("checkbox", { name: UNSUPPORTED_DIET_KIND_LABELS.weaning_food }),
  );

  expect(updateDraft).toHaveBeenNthCalledWith(2, "member-1", {
    unsupported_diet_kinds: ["weaning_food"],
  });
  expect(completeButton).toBeEnabled();
});

it("shows toast field error and focuses first invalid on incomplete save", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([draft]);
  const completeMember = vi.fn();
  const api = baseApi({
    listMembers: membersState.listMembers,
    completeMember,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  const complete = await screen.findByRole("button", { name: "この家族の設定を完了する" });
  expect(complete).not.toBeDisabled();
  await user.click(complete);

  expect(completeMember).not.toHaveBeenCalled();
  expect(screen.getAllByText(/選んでください|確認してください|入力内容/).length).toBeGreaterThan(0);
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(document.activeElement).toBeTruthy();
  expect(screen.getByLabelText("年齢のめやす")).toHaveFocus();
  expect(screen.getByLabelText("年齢のめやす")).toHaveAttribute("aria-invalid", "true");
});

it("serializes rapid draft updates in input order", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([draft]);
  const firstUpdate = deferred<HouseholdMemberRow>();
  const updateDraft = vi
    .fn()
    .mockImplementationOnce(() => firstUpdate.promise)
    .mockResolvedValueOnce({ ...draft, age_band: "adult", allergy_status: "none" });
  const api = baseApi({
    listMembers: membersState.listMembers,
    updateDraft,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

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
  const membersState = createMembersApiState([draft]);
  const firstUpdate = deferred<HouseholdMemberRow>();
  const updateDraft = vi
    .fn()
    .mockImplementationOnce(() => firstUpdate.promise)
    .mockResolvedValueOnce({ ...draft, display_name: "母娘" });
  const api = baseApi({
    listMembers: membersState.listMembers,
    updateDraft,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

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
  const membersState = createMembersApiState([completableDraft]);
  const completeMember = vi.fn(() => {
    const completed = {
      ...completableDraft,
      display_name: "母",
      status: "complete" as const,
    };
    membersState.upsert(completed);
    return Promise.resolve(completed);
  });
  const api = baseApi({
    listMembers: membersState.listMembers,
    updateDraft: vi.fn().mockReturnValue(pendingUpdate.promise),
    completeMember,
    setProgress: vi.fn(),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

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
  const membersState = createMembersApiState([draft]);
  const firstUpdate = deferred<HouseholdMemberRow>();
  const updateDraft = vi
    .fn()
    .mockImplementationOnce(() => firstUpdate.promise)
    .mockResolvedValueOnce({ ...draft, allergy_status: "none" });
  const api = baseApi({
    listMembers: membersState.listMembers,
    updateDraft,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

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
  const membersState = createMembersApiState([completableDraft]);
  const completeMember = vi.fn();
  const api = baseApi({
    listMembers: membersState.listMembers,
    updateDraft: vi.fn().mockReturnValue(pendingUpdate.promise),
    completeMember,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

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
  const membersState = createMembersApiState([draft]);
  const api = baseApi({ listMembers: membersState.listMembers });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  expect(await screen.findByText("家族設定（任意）", { exact: false })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "この家族の設定を完了する" })).toBeInTheDocument();
  expect(screen.queryByText("必須設定", { exact: false })).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "あとで設定する（アイデアから始める）" }),
  ).toBeInTheDocument();
});

it("shows first-person callout while editing the initial draft", async () => {
  const membersState = createMembersApiState([draft]);
  const api = baseApi({ listMembers: membersState.listMembers });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  expect(await screen.findByText("まずは1人分から登録しましょう")).toBeInTheDocument();
  expect(
    screen.getByText(
      "家族が複数いる場合も、最初は1人で十分です。追加の家族は、このあとや設定画面からいつでも登録できます。",
    ),
  ).toBeInTheDocument();
});

it("shows continue-callout when drafting after a complete member exists", async () => {
  const secondDraft = { ...draft, id: "member-2", sort_order: 1 };
  const membersState = createMembersApiState([completeAdult, secondDraft]);
  const api = baseApi({ listMembers: membersState.listMembers });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  expect(await screen.findByText("続けて家族を登録できます")).toBeInTheDocument();
  expect(screen.queryByText("まずは1人分から登録しましょう")).not.toBeInTheDocument();
});

it("hides skip on next-action when profile is already complete", async () => {
  const membersState = createMembersApiState([completeAdult]);
  const api = baseApi({
    listMembers: membersState.listMembers,
    getProfile: vi.fn().mockResolvedValue(mockProfile("complete")),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  expect(
    await screen.findByRole("heading", { level: 1, name: "1人目の登録が完了しました" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "あとで設定する（アイデアから始める）" }),
  ).not.toBeInTheDocument();
});

it("shows skip on next-action when profile is in_progress and skips to onDone", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([completeAdult]);
  const setProgress = vi.fn().mockResolvedValue(mockProfile("skipped"));
  const onDone = vi.fn();
  const api = baseApi({
    listMembers: membersState.listMembers,
    getProfile: vi.fn().mockResolvedValue(mockProfile("in_progress")),
    setProgress,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={onDone} />, client);

  await user.click(
    await screen.findByRole("button", { name: "あとで設定する（アイデアから始める）" }),
  );
  await waitFor(() => {
    expect(onDone).toHaveBeenCalledOnce();
  });
  // onboarding skip は CAS（expectedStatus=in_progress）
  expect(setProgress).toHaveBeenCalledWith("skipped", { expectedStatus: "in_progress" });
});

it("adds another member from next-action and shows continue callout", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([completeAdult]);
  const createDraft = vi.fn(() => {
    const created = { ...draft, id: "member-2", sort_order: 1, status: "draft" as const };
    membersState.upsert(created);
    return Promise.resolve(created);
  });
  const api = baseApi({
    listMembers: membersState.listMembers,
    createDraft,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  // 追加前確認を経てから createDraft（ダイアログ OK 後のみ）
  await user.click(await screen.findByRole("button", { name: "続けて家族を追加" }));
  expect(createDraft).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "登録の前に" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "登録を続ける" }));
  await waitFor(() => {
    expect(createDraft).toHaveBeenCalled();
  });
  expect(await screen.findByText("続けて家族を登録できます")).toBeInTheDocument();
});

it("shows add-scope notice before starting onboarding and cancel does not create", async () => {
  const user = userEvent.setup();
  const createDraft = vi.fn();
  // メンバー0・draftなしの初期画面
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([]),
    getProfile: vi.fn().mockResolvedValue(mockProfile("not_started")),
    createDraft,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  await user.click(await screen.findByRole("button", { name: "家族設定を始める" }));
  expect(createDraft).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "登録の前に" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "やめる" }));
  expect(createDraft).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog", { name: "登録の前に" })).not.toBeInTheDocument();
});

it("single-flights createDraft when confirm is invoked twice in the same turn", async () => {
  // 同期 startingDraftRef により、isPending 再レンダー前の二重 OK でも 1 回だけ
  const user = userEvent.setup();
  let resolveDraft!: (value: HouseholdMemberRow) => void;
  const createDraft = vi.fn(
    () =>
      new Promise<HouseholdMemberRow>((resolve) => {
        resolveDraft = resolve;
      }),
  );
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([]),
    getProfile: vi.fn().mockResolvedValue(mockProfile("not_started")),
    createDraft,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  await user.click(await screen.findByRole("button", { name: "家族設定を始める" }));
  const continueButton = screen.getByRole("button", { name: "登録を続ける" });
  // 同一 tick の二重発火を再現（userEvent は間に re-render を挟む）
  fireEvent.click(continueButton);
  fireEvent.click(continueButton);
  await waitFor(() => {
    expect(createDraft).toHaveBeenCalledTimes(1);
  });
  resolveDraft({
    ...draft,
    id: "member-started",
    status: "draft",
    sort_order: 0,
  });
});

it("omits setProgress when starting planner while profile is already complete", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([completeAdult]);
  const setProgress = vi.fn().mockResolvedValue(mockProfile("complete"));
  const onDone = vi.fn();
  const api = baseApi({
    listMembers: membersState.listMembers,
    getProfile: vi.fn().mockResolvedValue(mockProfile("complete")),
    setProgress,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={onDone} />, client);

  await user.click(await screen.findByRole("button", { name: "献立を始める" }));
  await waitFor(() => {
    expect(onDone).toHaveBeenCalledOnce();
  });
  expect(setProgress).not.toHaveBeenCalled();
});

it("disables AllergyEditor while complete is pending (H6)", async () => {
  // complete 押下直後も add/remove を閉じ、settings と同型の single-flight にする
  const registeredDraft: HouseholdMemberRow = {
    ...draft,
    age_band: "adult",
    allergy_status: "registered",
    unsupported_diet_status: "none",
  };
  const eggAllergy = {
    id: "allergy-egg",
    user_id: "user-1",
    member_id: "member-1",
    allergen_id: "egg",
    custom_name: null,
    custom_aliases: [] as string[],
    custom_confirmed: false,
    created_at: "2026-07-11T00:00:00.000Z",
  };
  const membersState = createMembersApiState([registeredDraft]);
  let resolveComplete!: (value: HouseholdMemberRow) => void;
  const completeMember = vi.fn(
    () =>
      new Promise<HouseholdMemberRow>((resolve) => {
        resolveComplete = resolve;
      }),
  );
  const removeAllergy = vi.fn().mockResolvedValue(undefined);
  const api = baseApi({
    listMembers: membersState.listMembers,
    completeMember,
    listAllergies: vi.fn().mockResolvedValue([eggAllergy]),
    listCatalog: vi.fn().mockResolvedValue([
      {
        id: "egg",
        display_name: "卵",
        regulatory_class: "standard",
        catalog_version: "2026-07-11",
        created_at: "2026-07-11T00:00:00.000Z",
      },
    ]),
    listAliases: vi.fn().mockResolvedValue([]),
    removeAllergy,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  const removeButton = await screen.findByRole("button", { name: "卵を削除" });
  expect(removeButton).toBeEnabled();
  fireEvent.click(await screen.findByRole("button", { name: "この家族の設定を完了する" }));
  await waitFor(() => {
    expect(completeMember).toHaveBeenCalledTimes(1);
  });
  expect(screen.getByRole("button", { name: "卵を削除" })).toBeDisabled();
  expect(screen.getByRole("searchbox", { name: "よくあるアレルギーを絞り込む" })).toBeDisabled();

  const completed: HouseholdMemberRow = { ...registeredDraft, status: "complete" };
  membersState.upsert(completed);
  resolveComplete(completed);
  await waitFor(() => {
    expect(
      screen.getByRole("heading", { level: 1, name: "1人目の登録が完了しました" }),
    ).toBeInTheDocument();
  });
  expect(removeAllergy).not.toHaveBeenCalled();
});

it("single-flights completeMember on double complete click (H7)", async () => {
  // actionPendingRef により re-render 前の連打でも completeMember は1回
  const completableDraft: HouseholdMemberRow = {
    ...draft,
    age_band: "adult",
    allergy_status: "none",
    unsupported_diet_status: "none",
  };
  const membersState = createMembersApiState([completableDraft]);
  let resolveComplete!: (value: HouseholdMemberRow) => void;
  const completeMember = vi.fn(
    () =>
      new Promise<HouseholdMemberRow>((resolve) => {
        resolveComplete = resolve;
      }),
  );
  const api = baseApi({
    listMembers: membersState.listMembers,
    completeMember,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  const completeButton = await screen.findByRole("button", {
    name: "この家族の設定を完了する",
  });
  // 同一 tick の二重発火（userEvent は間に re-render を挟む）
  fireEvent.click(completeButton);
  fireEvent.click(completeButton);
  await waitFor(() => {
    expect(completeMember).toHaveBeenCalledTimes(1);
  });
  // complete 成功後の invalidate → listMembers refetch でも complete が残るように state を更新
  const completed: HouseholdMemberRow = { ...completableDraft, status: "complete" };
  membersState.upsert(completed);
  resolveComplete(completed);
  await waitFor(() => {
    expect(
      screen.getByRole("heading", { level: 1, name: "1人目の登録が完了しました" }),
    ).toBeInTheDocument();
  });
});
