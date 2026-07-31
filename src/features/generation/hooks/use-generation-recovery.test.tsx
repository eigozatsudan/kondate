import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationCommand, GenerationStatusData } from "@shared/contracts/generation";
import {
  createPendingGeneration,
  pendingGenerationCommand,
  readPendingGeneration,
  savePendingGeneration,
  type PendingGeneration,
} from "../model/pending-generation";
import type { GenerationClientState, GenerationEvent } from "../model/generation-machine";

// --- モック定義 ---------------------------------------------------------

const mockPost = vi.hoisted(() => vi.fn());
const mockStatus = vi.hoisted(() => vi.fn());
const mockReadPending = vi.hoisted(() => vi.fn());
const mockSavePending = vi.hoisted(() => vi.fn());
const mockClearPending = vi.hoisted(() => vi.fn());
const mockDispatches = vi.hoisted(() => [] as GenerationEvent[]);
const navigateMock = vi.hoisted(() => vi.fn());
const unsubscribeMock = vi.hoisted(() => vi.fn());
const redirectToLoginForExpiredSessionMock = vi.hoisted(() => vi.fn());
const authCallbackRef = vi.hoisted(() => ({
  current: null as ((event: string, session: Session | null) => void) | null,
}));
const reducerListenerRef = vi.hoisted(() => ({
  current: undefined as ((event: GenerationEvent) => void) | undefined,
}));
const currentUserIdRef = vi.hoisted(() => ({ current: "" }));

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({
    session:
      currentUserIdRef.current === ""
        ? null
        : ({ user: { id: currentUserIdRef.current } } as Session),
  }),
}));
vi.mock("@/features/auth/session-expiry", () => ({
  redirectToLoginForExpiredSession: redirectToLoginForExpiredSessionMock,
}));
vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({
    auth: {
      onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
        authCallbackRef.current = callback;
        return { data: { subscription: { unsubscribe: unsubscribeMock } } };
      },
    },
  }),
}));
vi.mock("react-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-router")>();
  return { ...original, useNavigate: () => navigateMock };
});
vi.mock("../api/generation-api", () => ({
  postGeneration: mockPost,
  getGenerationStatus: mockStatus,
}));
vi.mock("../model/pending-generation", async (importOriginal) => {
  const original = await importOriginal<typeof import("../model/pending-generation")>();
  return {
    ...original,
    readPendingGeneration: mockReadPending,
    savePendingGeneration: mockSavePending,
    clearPendingGeneration: mockClearPending,
  };
});
vi.mock("../model/generation-machine", async (importOriginal) => {
  const original = await importOriginal<typeof import("../model/generation-machine")>();
  return {
    ...original,
    generationReducer: (state: GenerationClientState, event: GenerationEvent) => {
      mockDispatches.push(event);
      reducerListenerRef.current?.(event);
      return original.generationReducer(state, event);
    },
  };
});

// モック適用後にフックを import する。
const { useGenerationRecovery } = await import("./use-generation-recovery");

function recoveryWrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const realPendingGeneration = await vi.importActual<typeof import("../model/pending-generation")>(
  "../model/pending-generation",
);

// --- フィクスチャ --------------------------------------------------------

const USER_ID = "40000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "40000000-0000-4000-8000-000000000002";
// フックの read() は呼び出し時点の実時刻 (new Date()) で TTL を判定するため、
// 固定の過去日時では即座に期限切れになってしまう。実行時点に近い値を使う。
const FIXED_NOW = new Date();
const KEY_A = "10000000-0000-4000-8000-000000000001";
const KEY_B = "10000000-0000-4000-8000-000000000002";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

let storage: ReturnType<typeof memoryStorage>;

function makeCommand(idempotencyKey: string): GenerationCommand {
  return {
    commandVersion: "generation-command.v3",
    kind: "new_menu",
    qualityMode: false,
    request: {
      idempotencyKey,
      draftId: "20000000-0000-4000-8000-000000000001",
      draftRevision: 3,
      privacyNoticeVersion: "2026-07-29.v1",
      expiredPantryConfirmations: [],
    },
  };
}

function makePending(idempotencyKey: string, ownerUserId: string = USER_ID): PendingGeneration {
  return createPendingGeneration(makeCommand(idempotencyKey), ownerUserId, () => FIXED_NOW);
}

const quota = {
  consumed: false,
  remaining: 2,
  userDailyLimit: 3,
  limitKind: null,
  retryAt: null,
} as const;

function notStartedStatus(
  idempotencyKey: string,
): Extract<GenerationStatusData, { status: "not_started" }> {
  return { status: "not_started", idempotencyKey, quota };
}
function processingStatus(
  idempotencyKey: string,
): Extract<GenerationStatusData, { status: "processing" }> {
  return {
    status: "processing",
    idempotencyKey,
    requestId: "50000000-0000-4000-8000-000000000001",
    startedAt: "2026-07-11T00:00:00.000Z",
    quota,
  };
}
function succeededStatus(
  idempotencyKey: string,
): Extract<GenerationStatusData, { status: "succeeded" }> {
  return {
    status: "succeeded",
    idempotencyKey,
    requestId: "50000000-0000-4000-8000-000000000001",
    menuId: "60000000-0000-4000-8000-000000000001",
    completedAt: "2026-07-11T00:00:01.000Z",
    quota: { ...quota, consumed: true },
  };
}
function failedStatus(idempotencyKey: string): Extract<GenerationStatusData, { status: "failed" }> {
  return {
    status: "failed",
    idempotencyKey,
    requestId: "50000000-0000-4000-8000-000000000001",
    error: { code: "model_unavailable", message: "利用できません", retryable: true },
    completedAt: "2026-07-11T00:00:01.000Z",
    quota,
  };
}
function constraintConflictStatus(
  idempotencyKey: string,
): Extract<GenerationStatusData, { status: "constraint_conflict" }> {
  return {
    status: "constraint_conflict",
    idempotencyKey,
    requestId: "50000000-0000-4000-8000-000000000001",
    conflicts: [
      {
        code: "must_use_conflict",
        message: "条件を同時に満たせません。",
        conditionRefs: ["pantry_1"],
      },
    ],
    completedAt: "2026-07-11T00:00:01.000Z",
    quota,
  };
}

const pending = makePending(KEY_A);
const oldPending = makePending(KEY_A);
const newPending = makePending(KEY_B);
const pendingA = makePending(KEY_A);
const pendingB = makePending(KEY_B);

const notStarted = notStartedStatus(KEY_A);
const processing = processingStatus(KEY_A);
const succeeded = succeededStatus(KEY_A);
const failed = failedStatus(KEY_A);
const constraintConflict = constraintConflictStatus(KEY_A);

const notStartedA = notStartedStatus(KEY_A);
const processingA = processingStatus(KEY_A);
const succeededA = succeededStatus(KEY_A);
const failedA = failedStatus(KEY_A);
const constraintConflictA = constraintConflictStatus(KEY_A);
const processingB = processingStatus(KEY_B);

const idleState: GenerationClientState = { phase: "idle", effect: "none" };
const checkingState: GenerationClientState = { phase: "checking", effect: "status" };
const submittingState: GenerationClientState = { phase: "submitting", effect: "submit" };
const processingState: GenerationClientState = {
  phase: "processing",
  data: processing,
  effect: "poll",
};
const offlineState: GenerationClientState = {
  phase: "offline",
  previous: processingState,
  effect: "wait_online",
};
const succeededState: GenerationClientState = {
  phase: "succeeded",
  data: succeeded,
  effect: "navigate",
};
const failedState: GenerationClientState = { phase: "failed", data: failed, effect: "none" };
const constraintConflictState: GenerationClientState = {
  phase: "constraint_conflict",
  data: constraintConflict,
  effect: "none",
};

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function emitAuth(event: string, session: Session | null): void {
  authCallbackRef.current?.(event, session);
}

function seedTokenFor(
  initialState: GenerationClientState,
  pendingValue: PendingGeneration | null,
): {
  ownerUserId: string;
  idempotencyKey: string;
  epoch: number;
  phase: GenerationClientState["phase"];
} | null {
  if (initialState.phase === "idle" || pendingValue === null) return null;
  return {
    ownerUserId: pendingValue.ownerUserId,
    idempotencyKey: pendingValue.request.idempotencyKey,
    epoch: 0,
    phase: initialState.phase,
  };
}

function renderRecoveryAt(
  initialState: GenerationClientState,
  pendingValue: PendingGeneration | null,
  overrides: {
    onSave?: (value: PendingGeneration) => void;
    onReducerEvent?: (event: GenerationEvent) => void;
    onPost?: (command: GenerationCommand) => Promise<GenerationStatusData>;
  } = {},
) {
  if (pendingValue !== null) {
    realPendingGeneration.savePendingGeneration(pendingValue, storage);
  }
  if (overrides.onSave !== undefined) {
    const onSave = overrides.onSave;
    mockSavePending.mockImplementation((value: PendingGeneration) => {
      onSave(value);
      realPendingGeneration.savePendingGeneration(value, storage);
    });
  }
  if (overrides.onPost !== undefined) {
    const onPost = overrides.onPost;
    mockPost.mockImplementation(async (command: GenerationCommand) => onPost(command));
  }
  const onReducerEvent = overrides.onReducerEvent;
  // 注記: reducerListenerRef（モック化した generationReducer から呼ばれる）はこの用途には
  // 使えない。React は dispatch を act() 内でバッチ処理するため、reducerListenerRef 経由の
  // 観測は実際のリデューサー呼び出し（レンダー確定時）まで遅延し、非同期の POST 応答より
  // 後に届くことがある（実測で "posted" が "submit"/"clear" より先に記録された）。
  // seedForTesting.onDispatch はフックが dispatch を呼んだその場で同期的に発火するため、
  // save→submit/clear→post という操作順序をレースなく検証できるのはこちらだけである。
  const seed = {
    state: initialState,
    token: seedTokenFor(initialState, pendingValue),
    // このヘルパーの利用者は save→submit/clear→post の操作順だけを観測したいため、
    // POST 応答後に内部発火する status ディスパッチは対象外にする。
    ...(onReducerEvent === undefined
      ? {}
      : {
          onDispatch: (event: GenerationEvent) => {
            if (event.type === "submit" || event.type === "clear") onReducerEvent(event);
          },
        }),
  };
  return renderHook(() => useGenerationRecovery(seed), { wrapper: recoveryWrapper });
}

function renderRecoveryWithInFlight(
  initialState: GenerationClientState,
  pendingValue: PendingGeneration,
  postPromise: Promise<GenerationStatusData>,
): { recovery: ReturnType<typeof renderRecoveryAt>; oldOperation: Promise<void> } {
  realPendingGeneration.savePendingGeneration(pendingValue, storage);
  mockPost.mockReturnValueOnce(postPromise);
  const resultSink: { promise?: Promise<void> } = {};
  const recovery = renderHook(
    () =>
      useGenerationRecovery({
        state: initialState,
        token: seedTokenFor(initialState, pendingValue),
        staleSubmit: { pending: pendingValue, resultSink },
      }),
    { wrapper: recoveryWrapper },
  );
  if (resultSink.promise === undefined) {
    throw new Error("stale submit was not scheduled");
  }
  return { recovery, oldOperation: resultSink.promise };
}

beforeEach(() => {
  vi.clearAllMocks();
  storage = memoryStorage();
  currentUserIdRef.current = USER_ID;
  authCallbackRef.current = null;
  reducerListenerRef.current = undefined;
  mockDispatches.length = 0;
  mockReadPending.mockImplementation((userId: string, now: Date) =>
    realPendingGeneration.readPendingGeneration(userId, now, storage),
  );
  mockSavePending.mockImplementation((value: PendingGeneration) => {
    realPendingGeneration.savePendingGeneration(value, storage);
  });
  mockClearPending.mockImplementation(() => {
    realPendingGeneration.clearPendingGeneration(storage);
  });
});

describe("useGenerationRecovery", () => {
  it("recovers a saved processing key without posting again", async () => {
    savePendingGeneration(pending, storage);
    mockStatus.mockResolvedValue(processing);
    renderHook(() => useGenerationRecovery(), { wrapper: recoveryWrapper });
    await waitFor(() => {
      expect(mockStatus).toHaveBeenCalledWith(pending.request.idempotencyKey);
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it.each([checkingState, submittingState, processingState, offlineState])(
    "rejects a new operation from active $phase without mutation",
    async (initialState) => {
      const recovery = renderRecoveryAt(initialState, oldPending);
      await expect(recovery.result.current.startGeneration(newPending)).rejects.toThrow();
      expect(readPendingGeneration(USER_ID, FIXED_NOW, storage)).toEqual(oldPending);
      expect(recovery.result.current.state).toBe(initialState);
      expect(mockSavePending).not.toHaveBeenCalled();
      expect(mockClearPending).not.toHaveBeenCalled();
      expect(mockPost).not.toHaveBeenCalled();
    },
  );

  it("starts one idle operation save-first without recovery duplication", async () => {
    const order: string[] = [];
    const recovery = renderRecoveryAt(idleState, oldPending, {
      onSave: (value) => {
        order.push("saved");
        expect(value).toEqual(newPending);
      },
      onReducerEvent: (event) => {
        order.push(event.type);
      },
      onPost: (command) => {
        order.push("posted");
        expect(command).toEqual(pendingGenerationCommand(newPending));
        return Promise.resolve(processing);
      },
    });
    await act(() => recovery.result.current.startGeneration(newPending));
    expect(order).toEqual(["saved", "submit", "posted"]);
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it.each([succeededState, failedState, constraintConflictState])(
    "replaces terminal $phase only after save succeeds",
    async (initialState) => {
      const order: string[] = [];
      const recovery = renderRecoveryAt(initialState, oldPending, {
        onSave: (value) => {
          order.push("saved");
          expect(value).toEqual(newPending);
        },
        onReducerEvent: (event) => {
          order.push(event.type);
        },
        onPost: (command) => {
          order.push("posted");
          expect(command).toEqual(pendingGenerationCommand(newPending));
          return Promise.resolve(processing);
        },
      });
      await act(() => recovery.result.current.startGeneration(newPending));
      expect(order).toEqual(["saved", "clear", "submit", "posted"]);
    },
  );

  it("preserves old terminal storage and state when replacement save fails", async () => {
    const recovery = renderRecoveryAt(failedState, oldPending);
    mockSavePending.mockImplementation(() => {
      throw new Error("set");
    });
    await expect(recovery.result.current.startGeneration(newPending)).rejects.toThrow("set");
    expect(readPendingGeneration(USER_ID, FIXED_NOW, storage)).toEqual(oldPending);
    expect(recovery.result.current.state).toBe(failedState);
    expect(mockDispatches).toEqual([]);
    expect(mockClearPending).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("hands GET not_started to a separate submit record without self-suppression", async () => {
    mockReadPending.mockReturnValue(oldPending);
    mockStatus.mockResolvedValue(notStarted);
    mockPost.mockResolvedValue(processing);
    const recovery = renderHook(() => useGenerationRecovery(), {
      wrapper: recoveryWrapper,
    });
    await waitFor(() => {
      expect(recovery.result.current.state.phase).toBe("processing");
    });
    expect(mockStatus).toHaveBeenCalledTimes(1);
    expect(mockStatus).toHaveBeenCalledWith(oldPending.request.idempotencyKey);
    expect(mockPost).toHaveBeenCalledWith(pendingGenerationCommand(oldPending));
  });

  it.each([processing, succeeded, failed, constraintConflict])(
    "does not resend after GET returns $status",
    async (status) => {
      mockReadPending.mockReturnValue(oldPending);
      mockStatus.mockResolvedValue(status);
      const recovery = renderRecoveryAt(checkingState, oldPending);
      await act(() => recovery.result.current.retryStatus());
      await waitFor(() => {
        expect(recovery.result.current.state.phase).toBe(status.status);
      });
      expect(mockPost).not.toHaveBeenCalled();
    },
  );

  it("serializes concurrent not_started status checks into one resend", async () => {
    mockReadPending.mockReturnValue(oldPending);
    mockStatus.mockResolvedValue(notStarted);
    mockPost.mockResolvedValue(processing);
    const recovery = renderHook(() => useGenerationRecovery(), {
      wrapper: recoveryWrapper,
    });
    await act(() =>
      Promise.all([recovery.result.current.retryStatus(), recovery.result.current.retryStatus()]),
    );
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(recovery.result.current.state.phase).toBe("processing");
    });
    expect(mockStatus).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(pendingGenerationCommand(oldPending));
  });

  it("rejects a sequential second start before React rerenders", async () => {
    const postA = deferred<GenerationStatusData>();
    mockPost.mockReturnValue(postA.promise);
    const recovery = renderRecoveryAt(idleState, null);
    const first = recovery.result.current.startGeneration(pendingA);
    await expect(recovery.result.current.startGeneration(pendingB)).rejects.toThrow();
    expect(mockSavePending).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledTimes(1);
    postA.resolve(processingA);
    await act(() => first);
  });

  it.each([notStartedA, processingA, succeededA, failedA, constraintConflictA, "reject"] as const)(
    "discards delayed status A outcome %s after terminal replacement B",
    async (outcome) => {
      const delayedStatus = deferred<GenerationStatusData>();
      mockStatus.mockReturnValue(delayedStatus.promise);
      const recovery = renderRecoveryAt(failedState, pendingA);
      const statusA = recovery.result.current.retryStatus();
      mockPost.mockResolvedValue(processingB);
      await act(() => recovery.result.current.startGeneration(pendingB));
      const dispatchSnapshot = [...mockDispatches];
      const stateSnapshot = recovery.result.current.state;
      if (outcome === "reject") {
        delayedStatus.reject(new Error("auth"));
      } else {
        delayedStatus.resolve(outcome);
      }
      await act(() => statusA);
      expect(readPendingGeneration(USER_ID, FIXED_NOW, storage)).toMatchObject(pendingB);
      expect(mockDispatches).toEqual(dispatchSnapshot);
      expect(recovery.result.current.state).toBe(stateSnapshot);
    },
  );

  it("discards delayed GET A after account switch", async () => {
    const delayedStatus = deferred<GenerationStatusData>();
    mockStatus.mockReturnValue(delayedStatus.promise);
    const recovery = renderRecoveryAt(processingState, pendingA);
    const statusA = recovery.result.current.retryStatus();
    act(() => {
      emitAuth("SIGNED_IN", { user: { id: OTHER_USER_ID } } as Session);
    });
    const dispatchSnapshot = [...mockDispatches];
    const stateSnapshot = recovery.result.current.state;
    delayedStatus.resolve(succeededA);
    await act(() => statusA);
    expect(mockDispatches).toEqual(dispatchSnapshot);
    expect(recovery.result.current.state).toBe(stateSnapshot);
    expect(readPendingGeneration(OTHER_USER_ID, FIXED_NOW, storage)).toBeNull();
  });

  it("discards old POST A after sign-out", async () => {
    const postA = deferred<GenerationStatusData>();
    mockPost.mockReturnValueOnce(postA.promise);
    const recovery = renderRecoveryAt(idleState, null);
    const operationA = recovery.result.current.startGeneration(pendingA);
    act(() => {
      emitAuth("SIGNED_OUT", null);
    });
    postA.resolve(processingA);
    await act(() => operationA);
    expect(readPendingGeneration(USER_ID, FIXED_NOW, storage)).not.toMatchObject(pendingA);
    expect(mockDispatches).not.toContainEqual({ type: "status", data: processingA });
  });

  it("discards old POST A after accepted terminal replacement B", async () => {
    const postA = deferred<GenerationStatusData>();
    const { recovery, oldOperation } = renderRecoveryWithInFlight(
      failedState,
      pendingA,
      postA.promise,
    );
    mockPost.mockResolvedValue(processingB);
    await act(() => recovery.result.current.startGeneration(pendingB));
    const dispatchSnapshot = [...mockDispatches];
    const stateSnapshot = recovery.result.current.state;
    postA.resolve(processingA);
    await act(() => oldOperation);
    expect(readPendingGeneration(USER_ID, FIXED_NOW, storage)).toMatchObject(pendingB);
    expect(mockDispatches).toEqual(dispatchSnapshot);
    expect(recovery.result.current.state).toBe(stateSnapshot);
  });

  it("does not unlock a second resend when a non-not_started GET interleaves", async () => {
    const resend = deferred<GenerationStatusData>();
    mockPost.mockReturnValue(resend.promise);
    mockStatus.mockResolvedValueOnce(notStartedA).mockResolvedValueOnce(processingA);
    const recovery = renderRecoveryAt(checkingState, pendingA);
    await act(() => recovery.result.current.retryStatus());
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledTimes(1);
    });
    await act(() => recovery.result.current.retryStatus());
    expect(mockPost).toHaveBeenCalledTimes(1);
    await act(async () => {
      resend.resolve(processingA);
      await flushPromises();
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it.each([new Error("transport"), new Error("auth")])(
    "keeps current pending offline after %s and permits later status recovery",
    async (error) => {
      mockPost.mockRejectedValueOnce(error);
      const recovery = renderRecoveryAt(idleState, null);
      await act(() => recovery.result.current.startGeneration(pendingA));
      expect(recovery.result.current.state.phase).toBe("offline");
      expect(readPendingGeneration(USER_ID, FIXED_NOW, storage)).toMatchObject(pendingA);
      mockStatus.mockResolvedValue(processingA);
      await act(() => recovery.result.current.retryStatus());
      await waitFor(() => {
        expect(recovery.result.current.state.phase).toBe("processing");
      });
      expect(mockDispatches).toContainEqual({ type: "status", data: processingA });
    },
  );

  // C1: terminal 後に pending を消した状態で online / TOKEN_REFRESHED が
  // 無条件 recover すると checking 永久スピナーになる。pending が無いときは no-op。
  it("keeps failed UI after pending clear when window online fires", async () => {
    const recovery = renderHook(
      () =>
        useGenerationRecovery({
          state: failedState,
          token: {
            ownerUserId: USER_ID,
            idempotencyKey: KEY_A,
            epoch: 0,
            phase: "failed",
          },
        }),
      { wrapper: recoveryWrapper },
    );
    mockStatus.mockClear();
    mockDispatches.length = 0;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await flushPromises();
    });
    expect(recovery.result.current.state.phase).toBe("failed");
    expect(recovery.result.current.state).toMatchObject(failedState);
    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockDispatches.filter((event) => event.type === "online")).toHaveLength(0);
  });

  it("keeps constraint_conflict UI after pending clear when TOKEN_REFRESHED fires", async () => {
    const recovery = renderHook(
      () =>
        useGenerationRecovery({
          state: constraintConflictState,
          token: {
            ownerUserId: USER_ID,
            idempotencyKey: KEY_A,
            epoch: 0,
            phase: "constraint_conflict",
          },
        }),
      { wrapper: recoveryWrapper },
    );
    mockStatus.mockClear();
    mockDispatches.length = 0;
    await act(async () => {
      emitAuth("TOKEN_REFRESHED", { user: { id: USER_ID } } as Session);
      await flushPromises();
    });
    expect(recovery.result.current.state.phase).toBe("constraint_conflict");
    expect(recovery.result.current.state).toMatchObject(constraintConflictState);
    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockDispatches.filter((event) => event.type === "online")).toHaveLength(0);
  });

  it("recovers offline to processing on online when pending still present", async () => {
    realPendingGeneration.savePendingGeneration(pendingA, storage);
    mockStatus.mockResolvedValue(processingA);
    const recovery = renderRecoveryAt(offlineState, pendingA);
    mockStatus.mockClear();
    mockDispatches.length = 0;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await flushPromises();
    });
    await waitFor(() => {
      expect(recovery.result.current.state.phase).toBe("processing");
    });
    expect(mockStatus).toHaveBeenCalled();
    expect(mockDispatches).toContainEqual({ type: "status", data: processingA });
  });

  it("TOKEN_REFRESHED with pending processing rechecks status without double POST", async () => {
    realPendingGeneration.savePendingGeneration(pendingA, storage);
    mockStatus.mockResolvedValue(processingA);
    mockPost.mockClear();
    const recovery = renderRecoveryAt(processingState, pendingA);
    mockStatus.mockClear();
    mockDispatches.length = 0;
    await act(async () => {
      emitAuth("TOKEN_REFRESHED", { user: { id: USER_ID } } as Session);
      await flushPromises();
    });
    await waitFor(() => {
      expect(mockStatus).toHaveBeenCalled();
    });
    expect(recovery.result.current.state.phase).toBe("processing");
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("online with no pending from idle does not enter checking", async () => {
    const recovery = renderRecoveryAt(idleState, null);
    mockStatus.mockClear();
    mockDispatches.length = 0;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await flushPromises();
    });
    expect(recovery.result.current.state.phase).toBe("idle");
    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockDispatches.filter((event) => event.type === "online")).toHaveLength(0);
  });

  // F6: 旧 privacy / 欠落 privacy の pending を直接配置しても recovery は POST/status せず削除する
  it.each([
    [
      "missing privacyNoticeVersion",
      {
        commandVersion: "generation-command.v3" as const,
        kind: "regenerate_menu" as const,
        qualityMode: false,
        request: {
          idempotencyKey: KEY_A,
          sourceMenuId: "60000000-0000-4000-8000-000000000001",
          changeReason: "simpler" as const,
          changeReasonCustom: null,
          expiredPantryConfirmations: [],
        },
        ownerUserId: USER_ID,
        createdAt: FIXED_NOW.toISOString(),
      },
    ],
    [
      "previous privacyNoticeVersion",
      {
        commandVersion: "generation-command.v3" as const,
        kind: "regenerate_menu" as const,
        qualityMode: false,
        request: {
          idempotencyKey: KEY_A,
          sourceMenuId: "60000000-0000-4000-8000-000000000001",
          changeReason: "simpler" as const,
          changeReasonCustom: null,
          privacyNoticeVersion: "2026-07-11.v1",
          expiredPantryConfirmations: [],
        },
        ownerUserId: USER_ID,
        createdAt: FIXED_NOW.toISOString(),
      },
    ],
  ] as const)(
    "mount recovery clears %s pending without POST or status",
    async (_label, rawPending) => {
      // pending storage key は v3 cutover 後の kondate:generation:v3
      storage.setItem("kondate:generation:v3", JSON.stringify(rawPending));
      mockPost.mockClear();
      mockStatus.mockClear();
      mockDispatches.length = 0;

      const recovery = renderHook(() => useGenerationRecovery(), {
        wrapper: recoveryWrapper,
      });

      await waitFor(() => {
        expect(storage.getItem("kondate:generation:v3")).toBeNull();
      });
      expect(mockPost).not.toHaveBeenCalled();
      expect(mockStatus).not.toHaveBeenCalled();
      expect(recovery.result.current.state.phase).toBe("idle");
      expect(mockDispatches.filter((event) => event.type === "recover")).toHaveLength(0);
      // pending 削除後は idle のまま。再同意は privacy 導線へ進む通常フローで行う
      expect(navigateMock).not.toHaveBeenCalled();
    },
  );

  // Plan 3: 409 idempotency_payload_mismatch は offline 再POST ループに落とさない。
  it("maps POST idempotency_payload_mismatch to request_conflict without offline retry", async () => {
    mockPost.mockRejectedValueOnce(new Error("idempotency_payload_mismatch"));
    const recovery = renderRecoveryAt(idleState, null);
    await act(() => recovery.result.current.startGeneration(pendingA));
    expect(recovery.result.current.state.phase).toBe("request_conflict");
    if (recovery.result.current.state.phase !== "request_conflict") {
      throw new Error("expected request_conflict");
    }
    expect(recovery.result.current.state.code).toBe("idempotency_payload_mismatch");
    expect(recovery.result.current.state.message).toContain("再送できません");
    expect(readPendingGeneration(USER_ID, FIXED_NOW, storage)).toBeNull();
    mockPost.mockClear();
    mockStatus.mockClear();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      emitAuth("TOKEN_REFRESHED", { user: { id: USER_ID } } as Session);
      await flushPromises();
    });
    expect(recovery.result.current.state.phase).toBe("request_conflict");
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockStatus).not.toHaveBeenCalled();
  });

  // L10-4: Free 品質モード 403 は offline ではなく failed + issueMessages
  it("maps POST quality_mode_requires_plus to failed terminal without offline", async () => {
    mockPost.mockRejectedValueOnce(new Error("quality_mode_requires_plus"));
    const recovery = renderRecoveryAt(idleState, null);
    await act(() => recovery.result.current.startGeneration(pendingA));
    expect(recovery.result.current.state.phase).toBe("failed");
    if (recovery.result.current.state.phase !== "failed") {
      throw new Error("expected failed");
    }
    expect(recovery.result.current.state.data.error.code).toBe("quality_mode_requires_plus");
    expect(recovery.result.current.state.data.error.message).toContain("Plus");
    expect(readPendingGeneration(USER_ID, FIXED_NOW, storage)).toBeNull();
    mockPost.mockClear();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await flushPromises();
    });
    expect(recovery.result.current.state.phase).toBe("failed");
    expect(mockPost).not.toHaveBeenCalled();
  });

  // 本番調査: ok:false 業務 code を offline「通信確認」に落とすと第三者端末で永久停止する。
  // pre-reserve / 合成確定失敗のみ Error 名で failed に焼く（G7）。
  it.each([
    ["consent_required", "AIへ送る情報の説明"],
    ["draft_not_found", "献立条件が見つかりません"],
    ["invalid_request", "献立条件を確認"],
  ] as const)("maps POST %s to failed terminal without offline", async (code, messagePart) => {
    mockPost.mockRejectedValueOnce(new Error(code));
    const recovery = renderRecoveryAt(idleState, null);
    await act(() => recovery.result.current.startGeneration(pendingA));
    expect(recovery.result.current.state.phase).toBe("failed");
    if (recovery.result.current.state.phase !== "failed") {
      throw new Error("expected failed");
    }
    expect(recovery.result.current.state.data.error.code).toBe(code);
    expect(recovery.result.current.state.data.error.message).toContain(messagePart);
    expect(readPendingGeneration(USER_ID, FIXED_NOW, storage)).toBeNull();
    expect(mockDispatches).not.toContainEqual({ type: "network_error" });
  });

  // G7: post-reserve 系 code が Error.message で来ても pending を焼かない（ok:true 正規終端と非対称）
  it.each([
    "generation_timeout",
    "model_unavailable",
    "invalid_ai_response",
    "internal_error",
    "duplicate_output",
  ] as const)("keeps pending offline on POST Error %s (post-reserve recoverable)", async (code) => {
    mockPost.mockRejectedValueOnce(new Error(code));
    const recovery = renderRecoveryAt(idleState, null);
    await act(() => recovery.result.current.startGeneration(pendingA));
    expect(recovery.result.current.state.phase).toBe("offline");
    expect(readPendingGeneration(USER_ID, FIXED_NOW, storage)).toMatchObject(pendingA);
    expect(mockDispatches).toContainEqual({ type: "network_error" });
  });

  // G1/G2: POST の閉じた 5xx 系 code で pending を焼くと processing 台帳を status 回収できない
  it.each([
    "billing_entitlement_unavailable",
    "request_failed",
    "quota_transition_failed",
  ] as const)("keeps pending offline on POST %s (recoverable server path)", async (code) => {
    mockPost.mockRejectedValueOnce(new Error(code));
    const recovery = renderRecoveryAt(idleState, null);
    await act(() => recovery.result.current.startGeneration(pendingA));
    expect(recovery.result.current.state.phase).toBe("offline");
    expect(readPendingGeneration(USER_ID, FIXED_NOW, storage)).toMatchObject(pendingA);
    expect(mockDispatches).toContainEqual({ type: "network_error" });
  });

  it("maps GET invalid_request to failed terminal without offline", async () => {
    mockStatus.mockRejectedValueOnce(new Error("invalid_request"));
    const recovery = renderRecoveryAt(processingState, pendingA);
    await act(() => recovery.result.current.retryStatus());
    expect(recovery.result.current.state.phase).toBe("failed");
    if (recovery.result.current.state.phase !== "failed") {
      throw new Error("expected failed");
    }
    expect(recovery.result.current.state.data.error.message).toContain("献立条件を確認");
    expect(readPendingGeneration(USER_ID, FIXED_NOW, storage)).toBeNull();
    expect(mockDispatches).not.toContainEqual({ type: "network_error" });
  });

  // 敵対的レビュー I-1: GET の entitlement 一時 503 で pending を焼くと processing 復旧不能。
  it.each([
    "billing_entitlement_unavailable",
    "request_failed",
    "quota_transition_failed",
  ] as const)("keeps pending offline on GET %s (transient server path)", async (code) => {
    realPendingGeneration.savePendingGeneration(pendingA, storage);
    mockStatus.mockRejectedValueOnce(new Error(code));
    const recovery = renderRecoveryAt(processingState, pendingA);
    await act(() => recovery.result.current.retryStatus());
    expect(recovery.result.current.state.phase).toBe("offline");
    expect(readPendingGeneration(USER_ID, FIXED_NOW, storage)).toMatchObject(pendingA);
    expect(mockDispatches).toContainEqual({ type: "network_error" });
  });

  // 複数端末ログアウト等: auth 失敗を offline「通信確認」に落とさず再ログインへ
  it("redirects to login on POST auth_required without entering offline", async () => {
    mockPost.mockRejectedValueOnce(new Error("auth_required"));
    const recovery = renderRecoveryAt(idleState, null);
    await act(() => recovery.result.current.startGeneration(pendingA));
    expect(redirectToLoginForExpiredSessionMock).toHaveBeenCalledWith({ returnTo: "/planner" });
    expect(mockClearPending).toHaveBeenCalled();
    expect(recovery.result.current.state.phase).toBe("idle");
    expect(mockDispatches).toContainEqual({ type: "clear" });
    expect(mockDispatches).not.toContainEqual({ type: "network_error" });
  });

  it("redirects to login on GET auth_required during status check", async () => {
    mockStatus.mockRejectedValueOnce(new Error("auth_required"));
    const recovery = renderRecoveryAt(processingState, pendingA);
    await act(() => recovery.result.current.retryStatus());
    expect(redirectToLoginForExpiredSessionMock).toHaveBeenCalledWith({ returnTo: "/planner" });
    expect(mockClearPending).toHaveBeenCalled();
    expect(recovery.result.current.state.phase).toBe("idle");
    expect(mockDispatches).toContainEqual({ type: "clear" });
    expect(recovery.result.current.state.phase).not.toBe("offline");
  });

  it("nulls planner draft cache on new_menu success but not regenerate_menu", async () => {
    // seed 経路は初回 effect を skip するため、実運用どおり startGeneration→POST succeeded で検証する。
    const { plannerKeys } = await import("@/features/planner/planner-api");
    const draftKey = plannerKeys.draft(USER_ID);
    const staleDraft = { id: "draft", revision: 9 };

    const runStart = async (pending: PendingGeneration) => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      client.setQueryData(draftKey, staleDraft);
      mockPost.mockResolvedValueOnce(succeededStatus(pending.request.idempotencyKey));
      const recovery = renderHook(() => useGenerationRecovery(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      });
      await act(() => recovery.result.current.startGeneration(pending));
      await waitFor(() => {
        expect(recovery.result.current.state.phase).toBe("succeeded");
      });
      return client.getQueryData(draftKey);
    };

    const afterNewMenu = await runStart(makePending(KEY_A));
    expect(afterNewMenu).toBeNull();

    const regenCommand: GenerationCommand = {
      commandVersion: "generation-command.v3",
      kind: "regenerate_menu",
      qualityMode: false,
      request: {
        idempotencyKey: KEY_B,
        sourceMenuId: "60000000-0000-4000-8000-000000000099",
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
        changeReason: "different_flavor",
        changeReasonCustom: null,
      },
    };
    const regenPending = createPendingGeneration(regenCommand, USER_ID, () => FIXED_NOW);
    const afterRegen = await runStart(regenPending);
    // regenerate は soft-delete しない。stale を null で潰さない
    expect(afterRegen).toEqual(staleDraft);
  });
});
