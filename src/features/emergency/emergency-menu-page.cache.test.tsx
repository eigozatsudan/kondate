import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HouseholdMemberRow } from "@/features/household/household-api";
import {
  HouseholdOnboardingForm,
  type HouseholdOnboardingApi,
} from "@/features/household/household-onboarding-page";
import {
  householdSafetyChangedEvent,
  householdSafetyRevisionStorageKey,
  invalidateHouseholdSafetyDependents,
} from "@/features/household/household-queries";
import { plannerKeys } from "@/features/planner/planner-api";

const getPlannerDraftMock = vi.hoisted(() => vi.fn());
const listHouseholdMembersMock = vi.hoisted(() => vi.fn());
const getEmergencyMenusMock = vi.hoisted(() => vi.fn());
const realtime = vi.hoisted(() => ({
  handlers: [] as { table: string; filter: string; callback: () => void }[],
  removeChannel: vi.fn(),
}));

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({ session: { user: { id: "72000000-0000-4000-8000-000000000001" } } }),
}));
vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => {
    const channel = {
      on: (_event: string, filter: { table: string; filter: string }, callback: () => void) => {
        realtime.handlers.push({
          table: filter.table,
          filter: filter.filter,
          callback,
        });
        return channel;
      },
      subscribe: () => channel,
    };
    return {
      channel: () => channel,
      removeChannel: realtime.removeChannel,
    };
  },
}));
vi.mock("@/features/planner/planner-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/planner/planner-api")>();
  return { ...original, getPlannerDraft: getPlannerDraftMock };
});
vi.mock("@/features/household/household-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/household/household-api")>();
  return { ...original, listHouseholdMembers: listHouseholdMembersMock };
});
vi.mock("./emergency-menu-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./emergency-menu-api")>();
  return { ...original, getEmergencyMenus: getEmergencyMenusMock };
});

import { EmergencyMenuPage } from "./emergency-menu-page";

const eligibleMember: HouseholdMemberRow = {
  id: "72000000-0000-4000-8000-000000000010",
  user_id: "72000000-0000-4000-8000-000000000001",
  status: "complete",
  display_name: "家族",
  age_band: "adult",
  portion_size: "regular",
  spice_level: "regular",
  ease_preferences: [],
  required_safety_constraints: [],
  allergy_status: "none",
  unsupported_diet_status: "none",
  unsupported_diet_kinds: [],
  sort_order: 0,
  created_at: "2026-07-25T00:00:00.000Z",
  updated_at: "2026-07-25T00:00:00.000Z",
};

function deferredPromise<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function emergencyResponse(message: string) {
  return {
    fixtureVersion: "2026-07-11.v1",
    candidates: [],
    message,
    consumesAiQuota: false,
  } as const;
}

function emitRealtime(table: string, ownerId: string): void {
  for (const handler of realtime.handlers) {
    if (handler.table === table && handler.filter === `user_id=eq.${ownerId}`) {
      handler.callback();
    }
  }
}

async function renderVisibleEmergencyResponse() {
  listHouseholdMembersMock.mockReset();
  listHouseholdMembersMock.mockResolvedValue([eligibleMember]);
  getEmergencyMenusMock.mockReset();
  getEmergencyMenusMock.mockResolvedValue(emergencyResponse("旧候補"));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <EmergencyMenuPage />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("heading", { name: "旧候補" })).toBeVisible();
  return { queryClient, view };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  // 前テストのRealtime handlerが残ると他owner除外や再取得回数の検証が壊れる。
  realtime.handlers.length = 0;
  getPlannerDraftMock.mockResolvedValue({
    id: "draft-1",
    userId: "72000000-0000-4000-8000-000000000001",
    mealType: "dinner",
    mainIngredients: [],
    cuisineGenre: null,
    targetMode: null,
    targetMemberIds: [],
    servings: null,
    timeLimitMinutes: null,
    budgetPreference: null,
    avoidIngredients: [],
    memo: "",
    pantrySelections: [],
    revision: 1,
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
  });
  listHouseholdMembersMock.mockResolvedValueOnce([]).mockResolvedValue([eligibleMember]);
  getEmergencyMenusMock.mockResolvedValue({
    fixtureVersion: "2026-07-11.v1",
    candidates: [],
    message: "条件に合う緊急献立がありません",
    consumesAiQuota: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
  onlineManager.setOnline(true);
});

it.each([
  ["focus", () => window.dispatchEvent(new Event("focus"))],
  ["online", () => window.dispatchEvent(new Event("online"))],
  ["visible visibilitychange", () => document.dispatchEvent(new Event("visibilitychange"))],
])("%s復帰直後に旧候補を隠し、家族と候補の再取得完了後だけ表示する", async (_name, fire) => {
  const { view } = await renderVisibleEmergencyResponse();
  const nextHousehold = deferredPromise<HouseholdMemberRow[]>();
  listHouseholdMembersMock.mockReturnValueOnce(nextHousehold.promise);
  const householdCallsBefore = listHouseholdMembersMock.mock.calls.length;

  act(() => {
    fire();
  });

  expect(screen.getByText("候補を確認中…")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "旧候補" })).not.toBeInTheDocument();
  expect(listHouseholdMembersMock).toHaveBeenCalledTimes(householdCallsBefore + 1);

  const nextCandidates = deferredPromise<ReturnType<typeof emergencyResponse>>();
  getEmergencyMenusMock.mockReturnValueOnce(nextCandidates.promise);
  await act(async () => {
    nextHousehold.resolve([eligibleMember]);
    await Promise.resolve();
  });
  expect(screen.getByText("候補を確認中…")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "旧候補" })).not.toBeInTheDocument();

  await act(async () => {
    nextCandidates.resolve(emergencyResponse("新候補"));
    await Promise.resolve();
  });
  expect(await screen.findByRole("heading", { name: "新候補" })).toBeVisible();
  view.unmount();
});

it.each(["household_members", "member_allergies"])(
  "owner-filtered %s Realtimeだけで旧候補を閉じる",
  async (table) => {
    const { view } = await renderVisibleEmergencyResponse();
    await waitFor(() => {
      expect(realtime.handlers.length).toBeGreaterThanOrEqual(2);
    });
    const callsBefore = listHouseholdMembersMock.mock.calls.length;

    act(() => {
      emitRealtime(table, "72000000-0000-4000-8000-000000000099");
    });
    expect(listHouseholdMembersMock).toHaveBeenCalledTimes(callsBefore);
    expect(screen.getByRole("heading", { name: "旧候補" })).toBeVisible();

    const nextHousehold = deferredPromise<HouseholdMemberRow[]>();
    listHouseholdMembersMock.mockReturnValueOnce(nextHousehold.promise);
    act(() => {
      emitRealtime(table, eligibleMember.user_id);
    });
    expect(screen.getByText("候補を確認中…")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "旧候補" })).not.toBeInTheDocument();
    expect(listHouseholdMembersMock).toHaveBeenCalledTimes(callsBefore + 1);

    await act(async () => {
      nextHousehold.resolve([eligibleMember]);
      await Promise.resolve();
    });
    view.unmount();
  },
);

it("表示中かつonlineなら60秒で旧候補を閉じて再取得する", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const mountedAt = Date.now();
  const { view } = await renderVisibleEmergencyResponse();
  const callsBefore = listHouseholdMembersMock.mock.calls.length;
  const nextHousehold = deferredPromise<HouseholdMemberRow[]>();
  listHouseholdMembersMock.mockReturnValueOnce(nextHousehold.promise);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(59_999 - (Date.now() - mountedAt));
  });
  expect(listHouseholdMembersMock).toHaveBeenCalledTimes(callsBefore);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(listHouseholdMembersMock).toHaveBeenCalledTimes(callsBefore + 1);
  expect(screen.getByText("候補を確認中…")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "旧候補" })).not.toBeInTheDocument();

  nextHousehold.resolve([eligibleMember]);
  view.unmount();
});

it("unmount時に全listener・interval・Realtime channelをcleanupする", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const removeWindow = vi.spyOn(window, "removeEventListener");
  const removeDocument = vi.spyOn(document, "removeEventListener");
  const { view } = await renderVisibleEmergencyResponse();
  await waitFor(() => {
    expect(realtime.handlers.length).toBeGreaterThanOrEqual(2);
  });
  const callsBefore = listHouseholdMembersMock.mock.calls.length;

  view.unmount();

  expect(removeWindow.mock.calls.map(([name]) => name)).toEqual(
    expect.arrayContaining([householdSafetyChangedEvent, "storage", "focus", "online", "offline"]),
  );
  expect(removeDocument.mock.calls.map(([name]) => name)).toContain("visibilitychange");
  expect(realtime.removeChannel).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120_000);
  });
  expect(listHouseholdMembersMock).toHaveBeenCalledTimes(callsBefore);
});

it("実QueryClientのoffline paused家族queryを0人扱いせずloading表示する", async () => {
  const userId = eligibleMember.user_id;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(plannerKeys.draft(userId), await getPlannerDraftMock());
  onlineManager.setOnline(false);
  const view = render(
    <QueryClientProvider client={queryClient}>
      <EmergencyMenuPage />
    </QueryClientProvider>,
  );

  try {
    expect(await screen.findByText("候補を確認中…")).toBeVisible();
    expect(screen.queryByText(/対象の家族が登録されていない/u)).not.toBeInTheDocument();
    expect(listHouseholdMembersMock).not.toHaveBeenCalled();
    expect(getEmergencyMenusMock).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    onlineManager.setOnline(true);
  }
});

it("実QueryClientで家族APIが失敗したとき候補APIを呼ばずpage-level errorを表示する", async () => {
  listHouseholdMembersMock.mockReset();
  listHouseholdMembersMock.mockRejectedValue(new Error("household unavailable"));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <EmergencyMenuPage />
    </QueryClientProvider>,
  );

  expect(await screen.findByRole("alert")).toHaveTextContent("緊急献立を読み込めませんでした");
  expect(getEmergencyMenusMock).not.toHaveBeenCalled();
});

it("30秒のfresh cache中でも家族安全更新event後に家族を再取得して候補へ渡す", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <EmergencyMenuPage />
    </QueryClientProvider>,
  );

  expect(await screen.findByRole("alert")).toHaveTextContent("対象の家族が登録されていない");
  expect(listHouseholdMembersMock).toHaveBeenCalledTimes(1);
  expect(getEmergencyMenusMock).not.toHaveBeenCalled();

  act(() => {
    localStorage.setItem(householdSafetyRevisionStorageKey, "revision-after-registration");
    window.dispatchEvent(new CustomEvent(householdSafetyChangedEvent));
  });

  await waitFor(() => {
    expect(listHouseholdMembersMock).toHaveBeenCalledTimes(2);
  });
  await waitFor(() => {
    expect(getEmergencyMenusMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetMemberIds: [eligibleMember.id] }),
    );
  });
});

it("localStorageへ書き込めなくてもonboarding完了後の再表示で家族を再取得する", async () => {
  const user = userEvent.setup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
  const firstEmergency = render(
    <QueryClientProvider client={queryClient}>
      <EmergencyMenuPage />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("対象の家族が登録されていない");
  firstEmergency.unmount();

  let onboardingMember: HouseholdMemberRow = {
    ...eligibleMember,
    status: "draft",
  };
  const onboardingApi: HouseholdOnboardingApi = {
    listMembers: vi.fn(() => Promise.resolve([onboardingMember])),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    completeMember: vi.fn(() => {
      onboardingMember = eligibleMember;
      return Promise.resolve(eligibleMember);
    }),
    listAllergies: vi.fn().mockResolvedValue([]),
    addCustomAllergy: vi.fn(),
    setProgress: vi.fn().mockResolvedValue({}),
  };
  const onDone = vi.fn();
  const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("storage unavailable");
  });
  const onboarding = render(
    <QueryClientProvider client={queryClient}>
      <HouseholdOnboardingForm
        userId={eligibleMember.user_id}
        api={onboardingApi}
        onDone={onDone}
      />
    </QueryClientProvider>,
  );
  await user.click(await screen.findByRole("button", { name: "この家族の設定を完了する" }));
  await waitFor(() => {
    expect(onDone).toHaveBeenCalledOnce();
  });
  expect(setItem).toHaveBeenCalled();
  onboarding.unmount();

  render(
    <QueryClientProvider client={queryClient}>
      <EmergencyMenuPage />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(listHouseholdMembersMock).toHaveBeenCalledTimes(2);
  });
  await waitFor(() => {
    expect(getEmergencyMenusMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetMemberIds: [eligibleMember.id] }),
    );
  });
  setItem.mockRestore();
});

it("既存revisionの更新に失敗しても同一家族の安全変更後に候補を再取得する", async () => {
  const userId = eligibleMember.user_id;
  localStorage.setItem(householdSafetyRevisionStorageKey, "existing-revision");
  listHouseholdMembersMock.mockReset();
  listHouseholdMembersMock.mockResolvedValue([eligibleMember]);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <EmergencyMenuPage />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(getEmergencyMenusMock).toHaveBeenCalledTimes(1);
  });
  const inactiveCandidateKey = ["emergency-menus", "inactive-candidate"] as const;
  queryClient.setQueryData(inactiveCandidateKey, { cached: true });

  const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("storage unavailable");
  });
  await act(async () => {
    await invalidateHouseholdSafetyDependents(queryClient, userId);
  });

  await waitFor(() => {
    expect(getEmergencyMenusMock.mock.calls.length).toBeGreaterThan(1);
  });
  expect(getEmergencyMenusMock).toHaveBeenLastCalledWith(
    expect.objectContaining({ targetMemberIds: [eligibleMember.id] }),
  );
  expect(queryClient.getQueryState(inactiveCandidateKey)?.isInvalidated).toBe(true);
  expect(
    queryClient
      .getQueryCache()
      .findAll({ queryKey: ["emergency-menus"] })
      .some((query) => query.queryKey[query.queryKey.length - 1] === "existing-revision:event:1"),
  ).toBe(true);
  expect(localStorage.getItem(householdSafetyRevisionStorageKey)).toBe("existing-revision");
  setItem.mockRestore();
});
