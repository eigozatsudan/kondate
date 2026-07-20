import type { Session } from "@supabase/supabase-js";
import { act, renderHook, waitFor } from "@testing-library/react";
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
    kind: "new_menu",
    request: {
      idempotencyKey,
      draftId: "20000000-0000-4000-8000-000000000001",
      draftRevision: 3,
      privacyNoticeVersion: "2026-07-11.v1",
      expiredPantryConfirmations: [],
    },
  };
}

function makePending(idempotencyKey: string, ownerUserId: string = USER_ID): PendingGeneration {
  return createPendingGeneration(makeCommand(idempotencyKey), ownerUserId, () => FIXED_NOW);
}

const quota = {
  consumed: false,
  remaining: 4,
  userDailyLimit: 5,
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
  return renderHook(() => useGenerationRecovery(seed));
}

function renderRecoveryWithInFlight(
  initialState: GenerationClientState,
  pendingValue: PendingGeneration,
  postPromise: Promise<GenerationStatusData>,
): { recovery: ReturnType<typeof renderRecoveryAt>; oldOperation: Promise<void> } {
  realPendingGeneration.savePendingGeneration(pendingValue, storage);
  mockPost.mockReturnValueOnce(postPromise);
  const resultSink: { promise?: Promise<void> } = {};
  const recovery = renderHook(() =>
    useGenerationRecovery({
      state: initialState,
      token: seedTokenFor(initialState, pendingValue),
      staleSubmit: { pending: pendingValue, resultSink },
    }),
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
    renderHook(() => useGenerationRecovery());
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
    const recovery = renderHook(() => useGenerationRecovery());
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
    const recovery = renderHook(() => useGenerationRecovery());
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
});
