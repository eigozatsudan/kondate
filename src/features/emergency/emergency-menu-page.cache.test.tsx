import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
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
import { AppToastProvider } from "@/shared/ui/app-toast";

const getPlannerDraftMock = vi.hoisted(() => vi.fn());
const listHouseholdMembersMock = vi.hoisted(() => vi.fn());
const listMemberAllergiesMock = vi.hoisted(() => vi.fn());
const getEmergencyMenusMock = vi.hoisted(() => vi.fn());
const realtime = vi.hoisted(() => ({
  handlers: [] as { table: string; filter: string; callback: () => void }[],
  statusCallback: null as null | ((status: string) => void),
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
      subscribe: (cb?: (status: string) => void) => {
        realtime.statusCallback = cb ?? null;
        return channel;
      },
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
  return {
    ...original,
    listHouseholdMembers: listHouseholdMembersMock,
    listMemberAllergies: listMemberAllergiesMock,
  };
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
    fixtureVersion: "2026-07-28.v1",
    candidates: [],
    message,
    consumesAiQuota: false as const,
    path: "household" as const,
    matchMode: null,
    emptyReason: "no_matching_fixture" as const,
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
  listMemberAllergiesMock.mockReset();
  listHouseholdMembersMock.mockResolvedValue([eligibleMember]);
  listMemberAllergiesMock.mockResolvedValue([]);
  getEmergencyMenusMock.mockReset();
  getEmergencyMenusMock.mockResolvedValue(emergencyResponse("旧候補"));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
  // 献立画面へ戻る Link など Router 依存 UI を包む
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <EmergencyMenuPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  expect(await screen.findByRole("heading", { name: "旧候補" })).toBeVisible();
  return { queryClient, view };
}

beforeEach(() => {
  listMemberAllergiesMock.mockReset();
  listMemberAllergiesMock.mockResolvedValue([]);
  vi.clearAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  // 前テストのRealtime handlerが残ると他owner除外や再取得回数の検証が壊れる。
  realtime.handlers.length = 0;
  realtime.statusCallback = null;
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
    ingredientPreference: null,
    avoidIngredients: [],
    memo: "",
    pantrySelections: [],
    revision: 1,
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
  });
  listHouseholdMembersMock.mockResolvedValueOnce([]).mockResolvedValue([eligibleMember]);
  getEmergencyMenusMock.mockResolvedValue({
    fixtureVersion: "2026-07-28.v1",
    candidates: [],
    message: "条件に合う緊急献立がありません",
    consumesAiQuota: false,
    path: "household",
    matchMode: null,
    emptyReason: "no_matching_fixture",
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

it.each(["CHANNEL_ERROR", "TIMED_OUT"] as const)(
  "PE6: Realtime %s で旧候補を閉じて再取得する",
  async (status) => {
    const { view } = await renderVisibleEmergencyResponse();
    await waitFor(() => {
      expect(realtime.statusCallback).not.toBeNull();
    });
    const callsBefore = listHouseholdMembersMock.mock.calls.length;
    const nextHousehold = deferredPromise<HouseholdMemberRow[]>();
    listHouseholdMembersMock.mockReturnValueOnce(nextHousehold.promise);

    act(() => {
      realtime.statusCallback?.(status);
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

it("PE6: SUBSCRIBED alone does not refresh household safety revision", async () => {
  const { view } = await renderVisibleEmergencyResponse();
  await waitFor(() => {
    expect(realtime.statusCallback).not.toBeNull();
  });
  const callsBefore = listHouseholdMembersMock.mock.calls.length;
  act(() => {
    realtime.statusCallback?.("SUBSCRIBED");
  });
  expect(listHouseholdMembersMock).toHaveBeenCalledTimes(callsBefore);
  expect(screen.getByRole("heading", { name: "旧候補" })).toBeVisible();
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
  // safetyRealtimeEnabled は draft 確定後に立つため、interval 開始は mount 直後とは限らない。
  // 60_000ms の setInterval コールバックを直接発火し、poll 契約を固定する。
  const setIntervalSpy = vi.spyOn(window, "setInterval");
  const { view } = await renderVisibleEmergencyResponse();
  await waitFor(() => {
    expect(realtime.handlers.length).toBeGreaterThanOrEqual(2);
  });
  const pollCall = setIntervalSpy.mock.calls.find((call) => call[1] === 60_000);
  expect(pollCall).toBeDefined();
  expect(typeof pollCall?.[0]).toBe("function");

  const callsBefore = listHouseholdMembersMock.mock.calls.length;
  const nextHousehold = deferredPromise<HouseholdMemberRow[]>();
  listHouseholdMembersMock.mockReturnValueOnce(nextHousehold.promise);

  act(() => {
    // setInterval の第1引数は TimerHandler。60s poll は関数で登録している。
    if (typeof pollCall?.[0] === "function") {
      pollCall[0]();
    }
  });
  expect(listHouseholdMembersMock).toHaveBeenCalledTimes(callsBefore + 1);
  expect(screen.getByText("候補を確認中…")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "旧候補" })).not.toBeInTheDocument();

  nextHousehold.resolve([eligibleMember]);
  setIntervalSpy.mockRestore();
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
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <EmergencyMenuPage />
      </QueryClientProvider>
    </MemoryRouter>,
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
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <EmergencyMenuPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );

  expect(await screen.findByRole("alert")).toHaveTextContent("緊急献立を読み込めませんでした");
  expect(getEmergencyMenusMock).not.toHaveBeenCalled();
});

it("PE9: generation_drafts Realtime refreshes draft target members into candidate request", async () => {
  const userId = eligibleMember.user_id;
  const childId = "72000000-0000-4000-8000-000000000011";
  const childMember: HouseholdMemberRow = {
    ...eligibleMember,
    id: childId,
    display_name: "子ども",
    age_band: "age_3_5",
    required_safety_constraints: ["remove_bones", "cut_small"],
  };
  const householdDraft = {
    id: "draft-pe9",
    userId,
    mealType: "dinner" as const,
    mainIngredients: [],
    cuisineGenre: null,
    targetMode: "household" as const,
    targetMemberIds: [eligibleMember.id],
    servings: null,
    timeLimitMinutes: null,
    budgetPreference: null,
    ingredientPreference: null,
    avoidIngredients: [],
    memo: "",
    pantrySelections: [],
    revision: 1,
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
  };
  getPlannerDraftMock.mockReset();
  getPlannerDraftMock.mockResolvedValue(householdDraft);
  listHouseholdMembersMock.mockReset();
  listHouseholdMembersMock.mockResolvedValue([eligibleMember, childMember]);
  listMemberAllergiesMock.mockResolvedValue([]);
  getEmergencyMenusMock.mockReset();
  getEmergencyMenusMock.mockResolvedValue(emergencyResponse("旧候補"));

  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <EmergencyMenuPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(getEmergencyMenusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targetMode: "household",
        targetMemberIds: [eligibleMember.id],
      }),
    );
  });

  getPlannerDraftMock.mockResolvedValue({
    ...householdDraft,
    targetMemberIds: [eligibleMember.id, childId],
    revision: 2,
  });
  act(() => {
    emitRealtime("generation_drafts", userId);
  });

  await waitFor(() => {
    expect(getEmergencyMenusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targetMode: "household",
        targetMemberIds: [eligibleMember.id, childId],
      }),
    );
  });
  view.unmount();
});

it("30秒のfresh cache中でも家族安全更新event後に家族を再取得して候補へ渡す", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <EmergencyMenuPage />
      </QueryClientProvider>
    </MemoryRouter>,
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
      expect.objectContaining({
        targetMode: "household",
        targetMemberIds: [eligibleMember.id],
      }),
    );
  });
});

it("localStorageへ書き込めなくてもonboarding完了後の再表示で家族を再取得する", async () => {
  const user = userEvent.setup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
  const firstEmergency = render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <EmergencyMenuPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("対象の家族が登録されていない");
  firstEmergency.unmount();

  let onboardingMember: HouseholdMemberRow = {
    ...eligibleMember,
    status: "draft",
  };
  const onboardingApi: HouseholdOnboardingApi = {
    listMembers: vi.fn(() => Promise.resolve([onboardingMember])),
    getProfile: vi.fn().mockResolvedValue({
      user_id: eligibleMember.user_id,
      onboarding_status: "in_progress",
      onboarding_completed_at: null,
      created_at: "2026-07-11T00:00:00.000Z",
      updated_at: "2026-07-11T00:00:00.000Z",
    }),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    completeMember: vi.fn(() => {
      onboardingMember = eligibleMember;
      return Promise.resolve(eligibleMember);
    }),
    listAllergies: vi.fn().mockResolvedValue([]),
    addCustomAllergy: vi.fn(),
    setProgress: vi.fn().mockResolvedValue({
      user_id: eligibleMember.user_id,
      onboarding_status: "complete",
      onboarding_completed_at: "2026-07-11T00:00:00.000Z",
      created_at: "2026-07-11T00:00:00.000Z",
      updated_at: "2026-07-11T00:00:00.000Z",
    }),
  };
  const onDone = vi.fn();
  // HouseholdOnboardingForm は useAppToast を使う。setItem 失敗は後続テストへ漏れないよう finally で戻す。
  const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("storage unavailable");
  });
  try {
    const onboarding = render(
      <QueryClientProvider client={queryClient}>
        <AppToastProvider>
          <HouseholdOnboardingForm
            userId={eligibleMember.user_id}
            api={onboardingApi}
            onDone={onDone}
          />
        </AppToastProvider>
      </QueryClientProvider>,
    );
    // completeMember 後は次アクション画面。献立を始めるで setProgress + onDone。
    await user.click(await screen.findByRole("button", { name: "この家族の設定を完了する" }));
    await user.click(await screen.findByRole("button", { name: "献立を始める" }));
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledOnce();
    });
    expect(setItem).toHaveBeenCalled();
    onboarding.unmount();

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <EmergencyMenuPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(listHouseholdMembersMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(getEmergencyMenusMock).toHaveBeenCalledWith(
        expect.objectContaining({
          targetMode: "household",
          targetMemberIds: [eligibleMember.id],
        }),
      );
    });
  } finally {
    setItem.mockRestore();
  }
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
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <EmergencyMenuPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(getEmergencyMenusMock).toHaveBeenCalledTimes(1);
  });
  const inactiveCandidateKey = ["emergency-menus", "inactive-candidate"] as const;
  queryClient.setQueryData(inactiveCandidateKey, { cached: true });

  const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("storage unavailable");
  });
  try {
    await act(async () => {
      await invalidateHouseholdSafetyDependents(queryClient, userId);
    });

    await waitFor(() => {
      expect(getEmergencyMenusMock.mock.calls.length).toBeGreaterThan(1);
    });
    expect(getEmergencyMenusMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        targetMode: "household",
        targetMemberIds: [eligibleMember.id],
      }),
    );
    expect(queryClient.getQueryState(inactiveCandidateKey)?.isInvalidated).toBe(true);
    expect(
      queryClient
        .getQueryCache()
        .findAll({ queryKey: ["emergency-menus"] })
        .some((query) => query.queryKey[query.queryKey.length - 1] === "existing-revision:event:1"),
    ).toBe(true);
    expect(localStorage.getItem(householdSafetyRevisionStorageKey)).toBe("existing-revision");
  } finally {
    setItem.mockRestore();
  }
});
