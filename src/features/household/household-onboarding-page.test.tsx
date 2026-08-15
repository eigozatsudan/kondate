import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AppToastProvider } from "@/shared/ui/app-toast";
import type { OnboardingStatus } from "@shared/contracts/domain";
import {
  HouseholdMemberVersionConflictError,
  type HouseholdDraftPatch,
  type HouseholdMemberRow,
  type ProfileRow,
} from "./household-api";
import { EASE_SOFT_NOT_SWALLOW_DISCLAIMER } from "@/features/generation/components/idea-menu-safety-notice";
import { HouseholdOnboardingForm, type HouseholdOnboardingApi } from "./household-onboarding-page";
import { householdKeys, householdSafetyChangedEvent } from "./household-queries";
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

  expect(updateDraft).toHaveBeenNthCalledWith(
    1,
    "member-1",
    {
      unsupported_diet_status: "present",
      unsupported_diet_kinds: [],
    },
    draft.updated_at,
  );
  const completeButton = screen.getByRole("button", { name: "この家族の設定を完了する" });
  expect(completeButton).not.toBeDisabled();
  await user.click(completeButton);
  // toast と form alert の両方に検証メッセージが出る
  expect(screen.getAllByText(/選んでください|確認してください|入力内容/).length).toBeGreaterThan(0);
  expect(screen.getByRole("alert")).toBeVisible();

  await user.click(
    await screen.findByRole("checkbox", { name: UNSUPPORTED_DIET_KIND_LABELS.weaning_food }),
  );

  expect(updateDraft).toHaveBeenNthCalledWith(
    2,
    "member-1",
    {
      unsupported_diet_kinds: ["weaning_food"],
    },
    draft.updated_at,
  );
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
    draft.updated_at,
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
  expect(updateDraft).toHaveBeenNthCalledWith(
    1,
    "member-1",
    { display_name: "母" },
    draft.updated_at,
  );

  firstUpdate.resolve({ ...draft, display_name: "母", updated_at: "2026-07-11T00:00:01.000Z" });
  await waitFor(() => {
    expect(updateDraft).toHaveBeenCalledTimes(2);
  });
  expect(updateDraft).toHaveBeenNthCalledWith(
    2,
    "member-1",
    { display_name: "母娘" },
    "2026-07-11T00:00:01.000Z",
  );
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
    draft.updated_at,
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

// H8: CAS 衝突後は members 再取得と draftUpdatedAtRef 更新で再衝突ループを閉じる
// （settings H9 と同型の onboarding draft 回復）
it("H8: after draft version conflict, refetches members and advances CAS so retry succeeds", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([draft]);
  const serverAfterOtherTab: HouseholdMemberRow = {
    ...draft,
    allergy_status: "unconfirmed",
    updated_at: "2026-07-20T00:00:00.000Z",
  };
  const updateDraft = vi
    .fn()
    .mockImplementationOnce(() => {
      // 他タブが先に draft を更新した想定。refetch が正本を返すよう state を進める
      membersState.upsert(serverAfterOtherTab);
      return Promise.reject(new HouseholdMemberVersionConflictError());
    })
    .mockImplementation(
      (_memberId: string, patch: HouseholdDraftPatch, expectedUpdatedAt: string) => {
        expect(expectedUpdatedAt).toBe(serverAfterOtherTab.updated_at);
        const saved: HouseholdMemberRow = {
          ...serverAfterOtherTab,
          ...patch,
          updated_at: "2026-07-21T00:00:00.000Z",
        };
        membersState.upsert(saved);
        return Promise.resolve(saved);
      },
    );
  const api = baseApi({
    listMembers: membersState.listMembers,
    updateDraft,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  // 初回 save は T0 基準で CAS miss
  await user.selectOptions(await screen.findByLabelText("年齢のめやす"), "adult");
  await waitFor(() => {
    expect(updateDraft).toHaveBeenCalledTimes(1);
  });
  expect(updateDraft.mock.calls[0]?.[2]).toBe(draft.updated_at);
  expect(
    await screen.findByText("保存できませんでした。選び直して再試行してください。"),
  ).toBeInTheDocument();
  // members 再取得後、form は他タブの正本へ戻る（楽観 age_band を捨てる）
  await waitFor(() => {
    expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("unconfirmed");
    expect(screen.getByLabelText("年齢のめやす")).toHaveValue("");
  });
  // 初期 load + conflict 後 refetch で 2 回以上
  expect(membersState.listMembers.mock.calls.length).toBeGreaterThanOrEqual(2);

  // 再編集は新 CAS 基準で成功する（T0 固定の再衝突ループに入らない）
  await user.selectOptions(screen.getByLabelText("年齢のめやす"), "age_3_5");
  await waitFor(() => {
    expect(updateDraft).toHaveBeenCalledTimes(2);
  });
  expect(updateDraft.mock.calls[1]?.[2]).toBe(serverAfterOtherTab.updated_at);
  await waitFor(() => {
    expect(screen.getByText("保存済み")).toBeInTheDocument();
  });
  expect(screen.getByLabelText("年齢のめやす")).toHaveValue("age_3_5");
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

// H-R2: complete 成功後の invalidate 成否を settings H4 と同型コピーで次アクションへ出す
it("H-R2: shows refresh ok message after complete when invalidate succeeds", async () => {
  const user = userEvent.setup();
  const completableDraft: HouseholdMemberRow = {
    ...draft,
    age_band: "adult",
    allergy_status: "none",
    unsupported_diet_status: "none",
  };
  const membersState = createMembersApiState([completableDraft]);
  const completeMember = vi.fn(() => {
    const completed = { ...completableDraft, status: "complete" as const };
    membersState.upsert(completed);
    return Promise.resolve(completed);
  });
  const api = baseApi({
    listMembers: membersState.listMembers,
    completeMember,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  await user.click(await screen.findByRole("button", { name: "この家族の設定を完了する" }));
  await waitFor(() => {
    expect(
      screen.getByRole("heading", { level: 1, name: "1人目の登録が完了しました" }),
    ).toBeInTheDocument();
  });
  expect(screen.getByRole("status")).toHaveTextContent("最新条件で再確認します");
});

it("H-R2: shows manual reload guidance when complete invalidate fails", async () => {
  const user = userEvent.setup();
  const completableDraft: HouseholdMemberRow = {
    ...draft,
    age_band: "adult",
    allergy_status: "none",
    unsupported_diet_status: "none",
  };
  const membersState = createMembersApiState([completableDraft]);
  const completeMember = vi.fn(() => {
    const completed = { ...completableDraft, status: "complete" as const };
    membersState.upsert(completed);
    return Promise.resolve(completed);
  });
  const api = baseApi({
    listMembers: membersState.listMembers,
    completeMember,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // invalidateQueries を throw させ soft 失敗経路を固定（settings H4 と同型）
  const originalInvalidate = client.invalidateQueries.bind(client);
  vi.spyOn(client, "invalidateQueries").mockImplementation(async (filters) => {
    await originalInvalidate(filters);
    throw new Error("invalidate failed");
  });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  await user.click(await screen.findByRole("button", { name: "この家族の設定を完了する" }));
  await waitFor(() => {
    expect(
      screen.getByRole("heading", { level: 1, name: "1人目の登録が完了しました" }),
    ).toBeInTheDocument();
  });
  expect(screen.getByRole("status")).toHaveTextContent("画面の再確認に失敗したため");
  expect(screen.getByRole("status")).toHaveTextContent("再読み込み");
  // complete 自体は成功しているので次アクション CTA は出る
  expect(screen.getByRole("button", { name: "献立を始める" })).toBeInTheDocument();
});

// H2: onboarding にも residual 警告（settings 相当）
it("H2: shows residual allergy warning when none status still has allergies", async () => {
  const residualDraft: HouseholdMemberRow = {
    ...draft,
    age_band: "adult",
    allergy_status: "none",
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
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([residualDraft]),
    listAllergies: vi.fn().mockResolvedValue([eggAllergy]),
  });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />);

  await waitFor(() => {
    expect(screen.getByText(/以前登録したアレルギーが残っています/u)).toBeVisible();
  });
});

// H2: none + 残針 1 件は削除できる（registeredIntent ガードは発火しない）
it("H2: allows last residual allergy delete when draft status is none", async () => {
  const user = userEvent.setup();
  const residualDraft: HouseholdMemberRow = {
    ...draft,
    age_band: "adult",
    allergy_status: "none",
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
  let allergyRows = [eggAllergy];
  const listAllergies = vi.fn(() => Promise.resolve(allergyRows.map((row) => ({ ...row }))));
  const removeAllergy = vi.fn().mockImplementation(() => {
    allergyRows = [];
    return Promise.resolve(undefined);
  });
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([residualDraft]),
    listAllergies,
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
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />);

  await user.click(await screen.findByRole("button", { name: "卵を削除" }));

  await waitFor(() => {
    expect(removeAllergy).toHaveBeenCalledWith("allergy-egg");
  });
  expect(screen.queryByText("登録ありの場合は1つ以上選んでください")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("searchbox", { name: "よくあるアレルギーを絞り込む" }),
  ).not.toBeInTheDocument();
});

// H7: catalog 未ロード中は AllergyEditor を出さない
it("H7: waits for catalog before showing AllergyEditor", async () => {
  const registeredDraft: HouseholdMemberRow = {
    ...draft,
    age_band: "adult",
    allergy_status: "registered",
    unsupported_diet_status: "none",
  };
  type CatalogRow = {
    id: string;
    display_name: string;
    regulatory_class: string;
    catalog_version: string;
    created_at: string;
  };
  let resolveCatalog: ((value: CatalogRow[]) => void) | undefined;
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([registeredDraft]),
    listAllergies: vi.fn().mockResolvedValue([]),
    listCatalog: vi.fn(
      () =>
        new Promise<CatalogRow[]>((resolve) => {
          resolveCatalog = resolve;
        }),
    ),
    listAliases: vi.fn().mockResolvedValue([]),
  });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />);

  await waitFor(() => {
    expect(screen.getByText(/アレルギー候補を読み込んでいます/u)).toBeVisible();
  });
  expect(screen.queryByRole("region", { name: "アレルギー編集" })).not.toBeInTheDocument();

  await waitFor(() => {
    expect(resolveCatalog).toBeDefined();
  });
  resolveCatalog?.([
    {
      id: "egg",
      display_name: "卵",
      regulatory_class: "standard",
      catalog_version: "2026-07-11",
      created_at: "2026-07-11T00:00:00.000Z",
    },
  ]);
  await waitFor(() => {
    expect(screen.getByRole("region", { name: "アレルギー編集" })).toBeVisible();
  });
});

// H13: 0 件 registered は DB に即書きせず、初回アレルゲン追加でコミット
it("H13: defers empty registered allergy_status until first allergen is added", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([draft]);
  let currentDraft = draft;
  const updateDraft = vi.fn((_memberId: string, patch: HouseholdDraftPatch) => {
    currentDraft = { ...currentDraft, ...patch, updated_at: "2026-07-11T00:00:01.000Z" };
    membersState.upsert(currentDraft);
    return Promise.resolve(currentDraft);
  });
  const addStandardAllergy = vi.fn().mockResolvedValue({
    id: "allergy-egg",
    user_id: "user-1",
    member_id: "member-1",
    allergen_id: "egg",
    custom_name: null,
    custom_aliases: [] as string[],
    custom_confirmed: false,
    created_at: "2026-07-11T00:00:00.000Z",
  });
  const listAllergies = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValue([
      {
        id: "allergy-egg",
        user_id: "user-1",
        member_id: "member-1",
        allergen_id: "egg",
        custom_name: null,
        custom_aliases: [] as string[],
        custom_confirmed: false,
        created_at: "2026-07-11T00:00:00.000Z",
      },
    ]);
  const api = baseApi({
    listMembers: membersState.listMembers,
    updateDraft,
    listAllergies,
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
    addStandardAllergy,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  await user.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  // UI は registered でも、証拠なしでは updateDraft を呼ばない
  await waitFor(() => {
    expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("registered");
  });
  expect(updateDraft).not.toHaveBeenCalledWith(
    "member-1",
    expect.objectContaining({ allergy_status: "registered" }),
    expect.anything(),
  );

  // 年齢変更など他項目は従来どおり保存できる
  await user.selectOptions(screen.getByLabelText("年齢のめやす"), "adult");
  await waitFor(() => {
    expect(updateDraft).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ age_band: "adult" }),
      expect.any(String),
    );
  });
  // 年齢 save 後も allergy_status は patch に載せない（pending のみ）
  const registeredEarlyPatches = updateDraft.mock.calls.filter(
    (call) => call[1].allergy_status === "registered",
  );
  expect(registeredEarlyPatches).toHaveLength(0);

  await waitFor(() => {
    expect(screen.getByRole("region", { name: "アレルギー編集" })).toBeVisible();
  });
  await user.click(screen.getByRole("button", { name: "卵を追加" }));
  await waitFor(() => {
    expect(addStandardAllergy).toHaveBeenCalledWith("member-1", "egg");
  });
  await waitFor(() => {
    expect(updateDraft).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
      expect.any(String),
    );
  });
});

// HR1: pending 中にアレルギー一覧が非空で成功したら settings と同型に auto-commit
it("HR1: auto-commits deferred registered when allergy list becomes non-empty while pending", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([draft]);
  let currentDraft = draft;
  const updateDraft = vi.fn((_memberId: string, patch: HouseholdDraftPatch) => {
    currentDraft = {
      ...currentDraft,
      ...patch,
      updated_at: "2026-07-11T00:00:02.000Z",
    };
    membersState.upsert(currentDraft);
    return Promise.resolve(currentDraft);
  });
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
  // H5: pending 中は select が disabled。空一覧成功後に registered を選び、residual 到着で auto-commit
  const allergiesDeferred = deferred<
    Array<{
      id: string;
      user_id: string;
      member_id: string;
      allergen_id: string | null;
      custom_name: string | null;
      custom_aliases: string[];
      custom_confirmed: boolean;
      created_at: string;
    }>
  >();
  const listAllergies = vi.fn(() => allergiesDeferred.promise);
  const api = baseApi({
    listMembers: membersState.listMembers,
    updateDraft,
    listAllergies,
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
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  allergiesDeferred.resolve([]);
  await waitFor(() => {
    expect(screen.getByLabelText("アレルギーの確認")).toBeEnabled();
  });
  await user.selectOptions(screen.getByLabelText("アレルギーの確認"), "registered");
  await waitFor(() => {
    expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("registered");
  });
  // 空一覧の registered は DB に書かない（H13 pending）
  expect(updateDraft).not.toHaveBeenCalledWith(
    "member-1",
    expect.objectContaining({ allergy_status: "registered" }),
    expect.anything(),
  );

  client.setQueryData(householdKeys.allergies("user-1", "member-1"), [eggAllergy]);
  await waitFor(() => {
    expect(updateDraft).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
      expect.any(String),
    );
  });
});

// HR1: complete 直前に deferred registered を flush（actionPending 中でも updateDraft する）
it("HR1: flushes pending registered before completeMember", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([draft]);
  let currentDraft = draft;
  let allowRegisteredCommit = false;
  const updateDraft = vi.fn((_memberId: string, patch: HouseholdDraftPatch) => {
    if (patch.allergy_status === "registered" && !allowRegisteredCommit) {
      return Promise.reject(new Error("registered commit blocked for test"));
    }
    currentDraft = {
      ...currentDraft,
      ...patch,
      updated_at: "2026-07-11T00:00:03.000Z",
    };
    membersState.upsert(currentDraft);
    return Promise.resolve(currentDraft);
  });
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
  const completeMember = vi.fn(() => {
    const completed = {
      ...currentDraft,
      status: "complete" as const,
    };
    membersState.upsert(completed);
    return Promise.resolve(completed);
  });
  const addStandardAllergy = vi.fn().mockResolvedValue(eggAllergy);
  const listAllergies = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([eggAllergy]);
  const api = baseApi({
    listMembers: membersState.listMembers,
    updateDraft,
    completeMember,
    listAllergies,
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
    addStandardAllergy,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  await user.selectOptions(await screen.findByLabelText("年齢のめやす"), "adult");
  await user.selectOptions(screen.getByLabelText("アレルギーの確認"), "registered");
  await user.selectOptions(screen.getByLabelText(unsupportedDietStatusLabel), "none");
  await waitFor(() => {
    expect(screen.getByRole("region", { name: "アレルギー編集" })).toBeVisible();
  });
  // 初回追加時の commit は失敗させ、pending を残す
  await user.click(screen.getByRole("button", { name: "卵を追加" }));
  await waitFor(() => {
    expect(addStandardAllergy).toHaveBeenCalledWith("member-1", "egg");
  });
  await waitFor(() => {
    expect(updateDraft).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
      expect.any(String),
    );
  });
  expect(completeMember).not.toHaveBeenCalled();

  // complete 押下で actionPending 中の flush が再試行する
  allowRegisteredCommit = true;
  const registeredCallsBeforeComplete = updateDraft.mock.calls.filter(
    (call) => call[1].allergy_status === "registered",
  ).length;
  await user.click(screen.getByRole("button", { name: "この家族の設定を完了する" }));
  await waitFor(() => {
    expect(completeMember).toHaveBeenCalledWith("member-1");
  });
  const registeredCalls = updateDraft.mock.calls.filter(
    (call) => call[1].allergy_status === "registered",
  );
  // complete 前に少なくとも1回成功 flush がある
  expect(registeredCalls.length).toBeGreaterThan(registeredCallsBeforeComplete);
  expect(currentDraft.allergy_status).toBe("registered");
  // completeMember は flush 後（registered が DB 相当に載ったあと）
  const lastRegisteredIdx = updateDraft.mock.calls.findLastIndex(
    (call) => call[1].allergy_status === "registered",
  );
  expect(lastRegisteredIdx).toBeGreaterThanOrEqual(0);
  const lastRegisteredCallOrder = updateDraft.mock.invocationCallOrder[lastRegisteredIdx];
  const completeCallOrder = completeMember.mock.invocationCallOrder[0];
  expect(lastRegisteredCallOrder).toBeDefined();
  expect(completeCallOrder).toBeDefined();
  expect(lastRegisteredCallOrder!).toBeLessThan(completeCallOrder!);
  await waitFor(() => {
    expect(
      screen.getByRole("heading", { level: 1, name: "1人目の登録が完了しました" }),
    ).toBeInTheDocument();
  });
});

// HR1: 初回追加後の deferred registered commit 失敗 + H16 soft invalidate 後も
// 登録あり / AllergyEditor を落とさない（members サーバ正本は non-registered のまま）
it("HR1: keeps deferred registered UI after commit fails and soft members invalidate", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([draft]);
  let currentDraft = draft;
  const updateDraft = vi.fn((_memberId: string, patch: HouseholdDraftPatch) => {
    if (patch.allergy_status === "registered") {
      // registered だけ失敗。members API 正本は non-registered のまま
      return Promise.reject(new Error("registered commit failed"));
    }
    currentDraft = {
      ...currentDraft,
      ...patch,
      updated_at: "2026-07-11T00:00:05.000Z",
    };
    membersState.upsert(currentDraft);
    return Promise.resolve(currentDraft);
  });
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
  const addStandardAllergy = vi.fn().mockResolvedValue(eggAllergy);
  const listAllergies = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([eggAllergy]);
  const api = baseApi({
    listMembers: membersState.listMembers,
    updateDraft,
    listAllergies,
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
    addStandardAllergy,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  await user.selectOptions(await screen.findByLabelText("年齢のめやす"), "adult");
  await user.selectOptions(screen.getByLabelText("アレルギーの確認"), "registered");
  await waitFor(() => {
    expect(screen.getByRole("region", { name: "アレルギー編集" })).toBeVisible();
  });
  await user.click(screen.getByRole("button", { name: "卵を追加" }));
  await waitFor(() => {
    expect(addStandardAllergy).toHaveBeenCalledWith("member-1", "egg");
  });
  await waitFor(() => {
    expect(updateDraft).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
      expect.any(String),
    );
  });
  // soft invalidate → listMembers refetch 後も UI は registered / Editor を維持
  await waitFor(() => {
    expect(membersState.listMembers.mock.calls.length).toBeGreaterThan(1);
  });
  await waitFor(() => {
    expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("registered");
    expect(screen.getByRole("region", { name: "アレルギー編集" })).toBeVisible();
  });
  // サーバ正本は non-registered のまま（fail-closed。再選択なしで UI intent だけ残る）
  expect(currentDraft.allergy_status).not.toBe("registered");
});

// HR1: complete 前 flush 失敗時は completeMember を呼ばず failed 表示
it("HR1: does not completeMember when pending registered flush fails", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([draft]);
  let currentDraft = draft;
  const updateDraft = vi.fn((_memberId: string, patch: HouseholdDraftPatch) => {
    if (patch.allergy_status === "registered") {
      return Promise.reject(new Error("registered flush failed"));
    }
    currentDraft = {
      ...currentDraft,
      ...patch,
      updated_at: "2026-07-11T00:00:04.000Z",
    };
    membersState.upsert(currentDraft);
    return Promise.resolve(currentDraft);
  });
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
  const completeMember = vi.fn();
  const addStandardAllergy = vi.fn().mockResolvedValue(eggAllergy);
  const listAllergies = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([eggAllergy]);
  const api = baseApi({
    listMembers: membersState.listMembers,
    updateDraft,
    completeMember,
    listAllergies,
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
    addStandardAllergy,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  await user.selectOptions(await screen.findByLabelText("年齢のめやす"), "adult");
  await user.selectOptions(screen.getByLabelText("アレルギーの確認"), "registered");
  await user.selectOptions(screen.getByLabelText(unsupportedDietStatusLabel), "none");
  await waitFor(() => {
    expect(screen.getByRole("region", { name: "アレルギー編集" })).toBeVisible();
  });
  await user.click(screen.getByRole("button", { name: "卵を追加" }));
  await waitFor(() => {
    expect(addStandardAllergy).toHaveBeenCalled();
  });

  await user.click(screen.getByRole("button", { name: "この家族の設定を完了する" }));
  await waitFor(() => {
    expect(
      screen.getByText("保存できませんでした。選び直して再試行してください。"),
    ).toBeInTheDocument();
  });
  expect(completeMember).not.toHaveBeenCalled();
});

// H14: allergy 追加 in-flight 中は complete CTA を disabled（settings と同型）
it("H14: disables complete while an allergy addition is pending", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([
    {
      ...draft,
      age_band: "adult",
      allergy_status: "registered",
      unsupported_diet_status: "none",
    },
  ]);
  let resolveAdd: ((value: unknown) => void) | undefined;
  const addStandardAllergy = vi.fn(
    () =>
      new Promise((resolve) => {
        resolveAdd = resolve;
      }),
  );
  const completeMember = vi.fn();
  const api = baseApi({
    listMembers: membersState.listMembers,
    updateDraft: vi.fn((_id: string, patch: HouseholdDraftPatch) => {
      const next: HouseholdMemberRow = {
        ...draft,
        ...patch,
        age_band: "adult" as const,
        allergy_status: "registered" as const,
        unsupported_diet_status: "none" as const,
      };
      membersState.upsert(next);
      return Promise.resolve(next);
    }),
    listAllergies: vi.fn().mockResolvedValue([]),
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
    addStandardAllergy,
    completeMember,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  await waitFor(() => {
    expect(screen.getByRole("region", { name: "アレルギー編集" })).toBeVisible();
  });
  await user.click(screen.getByRole("button", { name: "卵を追加" }));
  await waitFor(() => {
    expect(addStandardAllergy).toHaveBeenCalledTimes(1);
  });

  const completeButton = screen.getByRole("button", { name: "この家族の設定を完了する" });
  expect(completeButton).toBeDisabled();
  fireEvent.click(completeButton);
  expect(completeMember).not.toHaveBeenCalled();

  resolveAdd?.({
    id: "allergy-egg",
    user_id: "user-1",
    member_id: "member-1",
    allergen_id: "egg",
    custom_name: null,
    custom_aliases: [],
    custom_confirmed: false,
    created_at: "2026-07-11T00:00:00.000Z",
  });
  await waitFor(() => {
    expect(completeButton).not.toBeDisabled();
  });
});

// H16: draft アレルギー追加後に dependents soft invalidate も走る（allergies 単独 invalidate より広い）
it("H16: soft-invalidates safety dependents after draft allergy add", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([
    {
      ...draft,
      age_band: "adult",
      allergy_status: "registered",
      unsupported_diet_status: "none",
    },
  ]);
  const addStandardAllergy = vi.fn().mockResolvedValue({
    id: "allergy-egg",
    user_id: "user-1",
    member_id: "member-1",
    allergen_id: "egg",
    custom_name: null,
    custom_aliases: [] as string[],
    custom_confirmed: false,
    created_at: "2026-07-11T00:00:00.000Z",
  });
  const listAllergies = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValue([
      {
        id: "allergy-egg",
        user_id: "user-1",
        member_id: "member-1",
        allergen_id: "egg",
        custom_name: null,
        custom_aliases: [] as string[],
        custom_confirmed: false,
        created_at: "2026-07-11T00:00:00.000Z",
      },
    ]);
  const api = baseApi({
    listMembers: membersState.listMembers,
    updateDraft: vi.fn((_id: string, patch: HouseholdDraftPatch) => {
      const next: HouseholdMemberRow = {
        ...draft,
        age_band: "adult" as const,
        allergy_status: "registered" as const,
        unsupported_diet_status: "none" as const,
        ...patch,
      };
      membersState.upsert(next);
      return Promise.resolve(next);
    }),
    listAllergies,
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
    addStandardAllergy,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // dependents のうち emergency を seed し、soft invalidate で stale になることを固定
  client.setQueryData(["emergency-menus", "user-1"], [{ id: "stale" }]);
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  await waitFor(() => {
    expect(screen.getByRole("region", { name: "アレルギー編集" })).toBeVisible();
  });
  await user.click(screen.getByRole("button", { name: "卵を追加" }));
  await waitFor(() => {
    expect(addStandardAllergy).toHaveBeenCalled();
  });
  await waitFor(() => {
    expect(client.getQueryState(["emergency-menus", "user-1"])?.isInvalidated).toBe(true);
  });
});

// H18: 年齢選択で soft 既定が入り得るため settings と同文言の嚥下非該当 disclaimer を出す
it("H18: shows ease soft-not-swallow disclaimer after age is selected", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([draft]);
  const updateDraft = vi.fn((_memberId: string, patch: HouseholdDraftPatch) => {
    const next = { ...draft, ...patch };
    membersState.upsert(next);
    return Promise.resolve(next);
  });
  const api = baseApi({
    listMembers: membersState.listMembers,
    updateDraft,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  expect(screen.queryByText(EASE_SOFT_NOT_SWALLOW_DISCLAIMER)).not.toBeInTheDocument();
  await user.selectOptions(await screen.findByLabelText("年齢のめやす"), "post_weaning_to_2");
  expect(await screen.findByText(EASE_SOFT_NOT_SWALLOW_DISCLAIMER)).toBeVisible();
});

// H4: draft registered で最後の 1 件を消すと trigger が無いので registered+0 が残る。
// 追加完了直後の削除も通さない（beginAllergyMutation 解除後の直列 add→delete）。
it("H4: refuses last allergy delete on draft registered so status cannot become registered+0", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([draft]);
  let currentDraft = draft;
  const updateDraft = vi.fn((_memberId: string, patch: HouseholdDraftPatch) => {
    currentDraft = { ...currentDraft, ...patch, updated_at: "2026-07-11T00:00:06.000Z" };
    membersState.upsert(currentDraft);
    return Promise.resolve(currentDraft);
  });
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
  let allergyRows = [] as (typeof eggAllergy)[];
  const listAllergies = vi.fn(() => Promise.resolve(allergyRows.map((row) => ({ ...row }))));
  const addStandardAllergy = vi.fn().mockImplementation(() => {
    allergyRows = [eggAllergy];
    return Promise.resolve(eggAllergy);
  });
  const removeAllergy = vi.fn().mockImplementation(() => {
    allergyRows = [];
    return Promise.resolve(undefined);
  });
  const api = baseApi({
    listMembers: membersState.listMembers,
    updateDraft,
    listAllergies,
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
    addStandardAllergy,
    removeAllergy,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  await user.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await waitFor(() => {
    expect(screen.getByRole("region", { name: "アレルギー編集" })).toBeVisible();
  });
  await user.click(screen.getByRole("button", { name: "卵を追加" }));
  const removeButton = await screen.findByRole("button", { name: "卵を削除" });
  await user.click(removeButton);

  expect(removeAllergy).not.toHaveBeenCalled();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "登録ありの場合は1つ以上選んでください",
  );
  expect(allergyRows).toHaveLength(1);
  expect(screen.getByRole("button", { name: "卵を削除" })).toBeInTheDocument();
  // registered を書いたなら針は残っている（0 件のまま registered を維持しない）
  const registeredPatches = updateDraft.mock.calls.filter(
    (call) => call[1].allergy_status === "registered",
  );
  if (registeredPatches.length > 0) {
    expect(currentDraft.allergy_status).toBe("registered");
    expect(allergyRows).toHaveLength(1);
  }
});

// H4: 追加後も一覧が空なら直接 commit が registered を書かない（HR1 effect は length===0 で既に return）
it("H4: commitPendingRegisteredIfNeeded does not write registered when allergy list is empty", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([draft]);
  let currentDraft = draft;
  const updateDraft = vi.fn((_memberId: string, patch: HouseholdDraftPatch) => {
    currentDraft = { ...currentDraft, ...patch, updated_at: "2026-07-11T00:00:07.000Z" };
    membersState.upsert(currentDraft);
    return Promise.resolve(currentDraft);
  });
  const addStandardAllergy = vi.fn().mockResolvedValue({
    id: "allergy-egg",
    user_id: "user-1",
    member_id: "member-1",
    allergen_id: "egg",
    custom_name: null,
    custom_aliases: [] as string[],
    custom_confirmed: false,
    created_at: "2026-07-11T00:00:00.000Z",
  });
  const listAllergies = vi.fn().mockResolvedValue([]);
  const api = baseApi({
    listMembers: membersState.listMembers,
    updateDraft,
    listAllergies,
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
    addStandardAllergy,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  await user.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await waitFor(() => {
    expect(screen.getByRole("region", { name: "アレルギー編集" })).toBeVisible();
  });
  await user.click(screen.getByRole("button", { name: "卵を追加" }));
  await waitFor(() => {
    expect(addStandardAllergy).toHaveBeenCalledWith("member-1", "egg");
  });
  // add → invalidate → commit まで終える（mutation 解除で追加ボタンが戻る）
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "卵を追加" })).toBeEnabled();
  });
  expect(updateDraft).not.toHaveBeenCalledWith(
    "member-1",
    expect.objectContaining({ allergy_status: "registered" }),
    expect.anything(),
  );
  expect(
    updateDraft.mock.calls.filter((call) => call[1].allergy_status === "registered"),
  ).toHaveLength(0);
  expect(currentDraft.allergy_status).not.toBe("registered");
});

// H5: settings と同型。一覧 pending 中はアレルギー select を止め、residual 未確認警告を出す
it("H5: disables allergy select while allergies query is pending", async () => {
  const pendingDraft: HouseholdMemberRow = {
    ...draft,
    age_band: "adult",
    allergy_status: "none",
    unsupported_diet_status: "none",
  };
  const allergiesDeferred = deferred<
    Array<{
      id: string;
      user_id: string;
      member_id: string;
      allergen_id: string | null;
      custom_name: string | null;
      custom_aliases: string[];
      custom_confirmed: boolean;
      created_at: string;
    }>
  >();
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([pendingDraft]),
    listAllergies: vi.fn(() => allergiesDeferred.promise),
  });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />);

  expect(await screen.findByLabelText("アレルギーの確認")).toBeDisabled();
  expect(
    screen.getByText(/アレルギー一覧を確認できないため、以前の登録が残っている可能性/u),
  ).toBeVisible();

  allergiesDeferred.resolve([]);
  await waitFor(() => {
    expect(screen.getByLabelText("アレルギーの確認")).toBeEnabled();
  });
});

// H5: 残針未確認のまま「なし」完了させない（completeMember に進まない）
it("H5: refuses none-complete while allergies query is pending", async () => {
  const user = userEvent.setup();
  const completableDraft: HouseholdMemberRow = {
    ...draft,
    age_band: "adult",
    allergy_status: "none",
    unsupported_diet_status: "none",
  };
  const allergiesDeferred = deferred<
    Array<{
      id: string;
      user_id: string;
      member_id: string;
      allergen_id: string | null;
      custom_name: string | null;
      custom_aliases: string[];
      custom_confirmed: boolean;
      created_at: string;
    }>
  >();
  const completeMember = vi.fn();
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([completableDraft]),
    listAllergies: vi.fn(() => allergiesDeferred.promise),
    completeMember,
  });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />);

  await user.click(await screen.findByRole("button", { name: "この家族の設定を完了する" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "アレルギー一覧の読み込みが終わるまで待ってください",
  );
  expect(completeMember).not.toHaveBeenCalled();
});

const residualEggAllergy = {
  id: "allergy-egg",
  user_id: "user-1",
  member_id: "member-1",
  allergen_id: "egg",
  custom_name: null,
  custom_aliases: [] as string[],
  custom_confirmed: false,
  created_at: "2026-07-11T00:00:00.000Z",
};

const residualWheatAllergy = {
  id: "allergy-wheat",
  user_id: "user-1",
  member_id: "member-1",
  allergen_id: "wheat",
  custom_name: null,
  custom_aliases: [] as string[],
  custom_confirmed: false,
  created_at: "2026-07-11T00:00:00.000Z",
};

const eggWheatCatalog = [
  {
    id: "egg",
    display_name: "卵",
    regulatory_class: "standard",
    catalog_version: "2026-07-11",
    created_at: "2026-07-11T00:00:00.000Z",
  },
  {
    id: "wheat",
    display_name: "小麦",
    regulatory_class: "standard",
    catalog_version: "2026-07-11",
    created_at: "2026-07-11T00:00:00.000Z",
  },
];

function residualNoneDraft(): HouseholdMemberRow {
  return {
    ...draft,
    age_band: "adult",
    allergy_status: "none",
    unsupported_diet_status: "none",
  };
}

// H13: 残針 removeOnly の削除失敗も allergyError を出す（registered ゲートを外す）
it("H13: shows allergyError alert when residual removeAllergy rejects", async () => {
  const user = userEvent.setup();
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([residualNoneDraft()]),
    listAllergies: vi.fn().mockResolvedValue([residualEggAllergy]),
    listCatalog: vi.fn().mockResolvedValue(eggWheatCatalog),
    listAliases: vi.fn().mockResolvedValue([]),
    removeAllergy: vi.fn().mockRejectedValue(new Error("アレルギーを削除できませんでした")),
  });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />);

  await user.click(await screen.findByRole("button", { name: "卵を削除" }));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveClass("error-message");
  expect(alert).toHaveTextContent("アレルギーを削除できませんでした");
});

it("H13: shows persist-failed copy when residual remove RPC succeeds but the row remains", async () => {
  const user = userEvent.setup();
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([residualNoneDraft()]),
    listAllergies: vi.fn().mockResolvedValue([residualEggAllergy]),
    listCatalog: vi.fn().mockResolvedValue(eggWheatCatalog),
    listAliases: vi.fn().mockResolvedValue([]),
    removeAllergy: vi.fn().mockResolvedValue(undefined),
  });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />);

  await user.click(await screen.findByRole("button", { name: "卵を削除" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("削除を反映できませんでした");
});

// H14: 残針リストは catalog 成功まで出さない（無名削除ボタンを出さない）
it("H14: waits for catalog before naming residual delete buttons", async () => {
  type CatalogRow = {
    id: string;
    display_name: string;
    regulatory_class: string;
    catalog_version: string;
    created_at: string;
  };
  let resolveCatalog: ((value: CatalogRow[]) => void) | undefined;
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([residualNoneDraft()]),
    listAllergies: vi.fn().mockResolvedValue([residualEggAllergy, residualWheatAllergy]),
    listCatalog: vi.fn(
      () =>
        new Promise<CatalogRow[]>((resolve) => {
          resolveCatalog = resolve;
        }),
    ),
    listAliases: vi.fn().mockResolvedValue([]),
  });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />);

  await waitFor(() => {
    expect(screen.getByText(/アレルギー候補を読み込んでいます/u)).toBeVisible();
  });
  expect(
    screen.queryByRole("button", { name: /名前を表示できない項目を削除/u }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "卵を削除" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "小麦を削除" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "残っているアレルギー" })).not.toBeInTheDocument();

  await waitFor(() => {
    expect(resolveCatalog).toBeDefined();
  });
  resolveCatalog?.(eggWheatCatalog);

  expect(await screen.findByRole("button", { name: "卵を削除" })).toBeVisible();
  expect(screen.getByRole("button", { name: "小麦を削除" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /名前を表示できない項目を削除/u }),
  ).not.toBeInTheDocument();
});

// H15: catalog 失敗中は「下の一覧から削除できます」を出さず、残針のまま complete しない
it("H15: does not claim residual can be deleted or complete while catalog rejected", async () => {
  const user = userEvent.setup();
  const completeMember = vi.fn();
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([residualNoneDraft()]),
    listAllergies: vi.fn().mockResolvedValue([residualEggAllergy]),
    listCatalog: vi.fn().mockRejectedValue(new Error("アレルギー候補を読み込めませんでした")),
    listAliases: vi.fn().mockResolvedValue([]),
    completeMember,
  });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />);

  await waitFor(() => {
    expect(screen.getByText(/アレルギー候補を読み込めませんでした/u)).toBeVisible();
  });
  expect(screen.queryByText(/下の一覧から削除できます/u)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "卵を削除" })).not.toBeInTheDocument();

  await user.click(await screen.findByRole("button", { name: "この家族の設定を完了する" }));

  expect(completeMember).not.toHaveBeenCalled();
});

// H16: 初回 catalog 成功後の refetch error でも名前付き削除を残す
it("H16: keeps residual delete after catalog refetch error", async () => {
  const listCatalog = vi.fn().mockResolvedValue(eggWheatCatalog);
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([residualNoneDraft()]),
    listAllergies: vi.fn().mockResolvedValue([residualEggAllergy]),
    listCatalog,
    listAliases: vi.fn().mockResolvedValue([]),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  expect(await screen.findByRole("button", { name: "卵を削除" })).toBeVisible();
  expect(client.getQueryState(["household", "allergen-catalog"])?.status).toBe("success");

  listCatalog.mockRejectedValue(new Error("アレルギー候補を読み込めませんでした"));
  await act(async () => {
    await client
      .refetchQueries({ queryKey: ["household", "allergen-catalog"] })
      .catch(() => undefined);
  });

  await waitFor(() => {
    expect(client.getQueryState(["household", "allergen-catalog"])?.status).toBe("error");
  });
  expect(screen.getByRole("button", { name: "卵を削除" })).toBeVisible();
});

// H11: 既定 staleTime 内の空 success cache を正本扱いしない。complete 時だけ fresh を取る。
it("H11: refuses none-complete when stale empty cache hides a residual allergy", async () => {
  const user = userEvent.setup();
  const noneDraft = residualNoneDraft();
  const completeMember = vi.fn();
  const listAllergies = vi.fn().mockResolvedValue([residualEggAllergy]);
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([noneDraft]),
    getProfile: vi.fn().mockResolvedValue(mockProfile("in_progress")),
    listAllergies,
    completeMember,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  client.setQueryData(householdKeys.members("user-1"), [noneDraft]);
  client.setQueryData(householdKeys.profile("user-1"), mockProfile("in_progress"));
  client.setQueryData(householdKeys.allergies("user-1", "member-1"), []);

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  expect(await screen.findByRole("button", { name: "この家族の設定を完了する" })).toBeEnabled();
  expect(listAllergies).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "この家族の設定を完了する" }));

  await waitFor(() => {
    expect(listAllergies).toHaveBeenCalled();
  });
  expect(completeMember).not.toHaveBeenCalled();
  expect(screen.getAllByText(/以前登録したアレルギーが残っています/u).length).toBeGreaterThan(0);
});

// H11: /onboarding も AppShell と同型に householdSafetyChangedEvent を受けて再取得する
it("H11: invalidates allergies when householdSafetyChangedEvent fires", async () => {
  const noneDraft = residualNoneDraft();
  const listMembers = vi.fn().mockResolvedValue([noneDraft]);
  const listAllergies = vi.fn().mockResolvedValue([]);
  const api = baseApi({
    listMembers,
    listAllergies,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const allergiesKey = householdKeys.allergies("user-1", "member-1");
  const membersKey = householdKeys.members("user-1");

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  await waitFor(() => {
    expect(listAllergies).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(allergiesKey)?.status).toBe("success");
  });
  const membersCallsBefore = listMembers.mock.calls.length;

  act(() => {
    window.dispatchEvent(new CustomEvent(householdSafetyChangedEvent));
  });

  await waitFor(() => {
    expect(listAllergies.mock.calls.length).toBeGreaterThan(1);
    expect(listMembers.mock.calls.length).toBeGreaterThan(membersCallsBefore);
  });
  expect(client.getQueryState(allergiesKey)?.status).toBe("success");
  expect(client.getQueryState(membersKey)?.status).toBe("success");
});

// H12: 空 success の refetch 中は旧 [] のまま complete しない
it("H12: refuses none-complete while empty allergies cache is refetching", async () => {
  const user = userEvent.setup();
  const noneDraft = residualNoneDraft();
  const hang = deferred<(typeof residualEggAllergy)[]>();
  const listAllergies = vi.fn().mockResolvedValue([]);
  const completeMember = vi.fn();
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([noneDraft]),
    listAllergies,
    completeMember,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const allergiesKey = householdKeys.allergies("user-1", "member-1");

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  await waitFor(() => {
    expect(client.getQueryState(allergiesKey)?.status).toBe("success");
  });

  listAllergies.mockImplementation(() => hang.promise);
  act(() => {
    void client.refetchQueries({ queryKey: allergiesKey });
  });
  await waitFor(() => {
    expect(client.getQueryState(allergiesKey)?.fetchStatus).toBe("fetching");
  });

  await user.click(screen.getByRole("button", { name: "この家族の設定を完了する" }));

  expect(completeMember).not.toHaveBeenCalled();
});

// H6: ACK 前の楽観 cache を失敗時に戻す。再入場で stale registered のまま complete しない。
it("H6: rolls back optimistic members cache when registered save fails", async () => {
  const user = userEvent.setup();
  const noneDraft: HouseholdMemberRow = {
    ...draft,
    age_band: "adult",
    allergy_status: "none",
    unsupported_diet_status: "none",
  };
  const membersState = createMembersApiState([noneDraft]);
  const updateDraft = vi.fn().mockRejectedValue(new Error("一時的な保存失敗"));
  const completeMember = vi.fn();
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
  const api = baseApi({
    listMembers: membersState.listMembers,
    updateDraft,
    completeMember,
    listAllergies: vi.fn().mockResolvedValue([eggAllergy]),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  await user.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  expect(
    await screen.findByText("保存できませんでした。選び直して再試行してください。"),
  ).toBeInTheDocument();

  await waitFor(() => {
    expect(
      client.getQueryData<HouseholdMemberRow[]>(householdKeys.members("user-1"))?.[0],
    ).toMatchObject({
      allergy_status: "none",
    });
  });
  expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("none");
});

// H-R1: remount で pending overlay だけ落ちると、30s stale cache の registered のまま
// DB none で complete できる。未 ACK overlay をサーバ正本へ戻す。
it("H-R1: remount discards unacked registered overlay so complete uses DB status", async () => {
  const user = userEvent.setup();
  const dbNoneDraft = residualNoneDraft();
  const overlayRegistered: HouseholdMemberRow = {
    ...dbNoneDraft,
    allergy_status: "registered",
  };
  const listMembers = vi.fn().mockResolvedValue([dbNoneDraft]);
  const updateDraft = vi.fn();
  const completeMember = vi.fn().mockResolvedValue({
    ...dbNoneDraft,
    status: "complete" as const,
  });
  const api = baseApi({
    listMembers,
    updateDraft,
    completeMember,
    listAllergies: vi.fn().mockResolvedValue([residualEggAllergy]),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  client.setQueryData(householdKeys.members("user-1"), [overlayRegistered]);
  client.setQueryData(householdKeys.profile("user-1"), mockProfile("in_progress"));
  client.setQueryData(householdKeys.allergies("user-1", "member-1"), [residualEggAllergy]);

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  await waitFor(() => {
    expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("none");
  });

  await user.click(screen.getByRole("button", { name: "この家族の設定を完了する" }));

  await waitFor(() => {
    expect(completeMember).toHaveBeenCalledWith("member-1");
  });
  expect(updateDraft).not.toHaveBeenCalled();
});

// H-R1: remount fetch 完了前の complete も、cache registered / DB none を正本にしない
it("H-R1: refuses complete from stale registered overlay while remount members are in flight", async () => {
  const user = userEvent.setup();
  const dbNoneDraft = residualNoneDraft();
  const overlayRegistered: HouseholdMemberRow = {
    ...dbNoneDraft,
    allergy_status: "registered",
  };
  const remountMembers = deferred<HouseholdMemberRow[]>();
  const listMembers = vi
    .fn()
    .mockImplementationOnce(() => remountMembers.promise)
    .mockResolvedValue([dbNoneDraft]);
  const completeMember = vi.fn();
  const api = baseApi({
    listMembers,
    completeMember,
    listAllergies: vi.fn().mockResolvedValue([residualEggAllergy]),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  client.setQueryData(householdKeys.members("user-1"), [overlayRegistered]);
  client.setQueryData(householdKeys.profile("user-1"), mockProfile("in_progress"));
  client.setQueryData(householdKeys.allergies("user-1", "member-1"), [residualEggAllergy]);

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  expect(await screen.findByLabelText("アレルギーの確認")).toHaveValue("registered");
  await user.click(screen.getByRole("button", { name: "この家族の設定を完了する" }));

  await waitFor(() => {
    expect(listMembers.mock.calls.length).toBeGreaterThan(1);
  });
  expect(completeMember).not.toHaveBeenCalled();
  await waitFor(() => {
    expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("none");
  });
  remountMembers.resolve([dbNoneDraft]);
});

// H-R2: settings H5 と同型。registered 完了は cache 件数ではなく fresh fetch を正本にする
it("H-R2: refuses registered-complete when stale non-empty cache hides an empty list", async () => {
  const user = userEvent.setup();
  const registeredDraft: HouseholdMemberRow = {
    ...draft,
    age_band: "adult",
    allergy_status: "registered",
    unsupported_diet_status: "none",
  };
  const listAllergies = vi.fn().mockResolvedValue([]);
  const completeMember = vi.fn();
  const updateDraft = vi.fn();
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([registeredDraft]),
    listAllergies,
    completeMember,
    updateDraft,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  client.setQueryData(householdKeys.members("user-1"), [registeredDraft]);
  client.setQueryData(householdKeys.profile("user-1"), mockProfile("in_progress"));
  client.setQueryData(householdKeys.allergies("user-1", "member-1"), [residualEggAllergy]);

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  const callsBeforeComplete = listAllergies.mock.calls.length;
  await user.click(await screen.findByRole("button", { name: "この家族の設定を完了する" }));

  await waitFor(() => {
    expect(listAllergies.mock.calls.length).toBeGreaterThan(callsBeforeComplete);
  });
  expect(completeMember).not.toHaveBeenCalled();
  expect(updateDraft).not.toHaveBeenCalled();
  expect(
    screen.getAllByText("アレルギー「登録あり」のときは、1つ以上のアレルゲンを追加してください。")
      .length,
  ).toBeGreaterThan(0);
});

it("H-R2: allows registered-complete when stale empty cache hides a remaining allergy", async () => {
  const user = userEvent.setup();
  const registeredDraft: HouseholdMemberRow = {
    ...draft,
    age_band: "adult",
    allergy_status: "registered",
    unsupported_diet_status: "none",
  };
  const remaining = { ...residualEggAllergy, member_id: registeredDraft.id };
  const listAllergies = vi.fn().mockResolvedValue([remaining]);
  const completeMember = vi.fn().mockResolvedValue({
    ...registeredDraft,
    status: "complete" as const,
  });
  const updateDraft = vi.fn();
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([registeredDraft]),
    listAllergies,
    completeMember,
    updateDraft,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  client.setQueryData(householdKeys.members("user-1"), [registeredDraft]);
  client.setQueryData(householdKeys.profile("user-1"), mockProfile("in_progress"));
  client.setQueryData(householdKeys.allergies("user-1", "member-1"), []);

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  await user.click(await screen.findByRole("button", { name: "この家族の設定を完了する" }));

  await waitFor(() => {
    expect(completeMember).toHaveBeenCalledWith(registeredDraft.id);
  });
});
