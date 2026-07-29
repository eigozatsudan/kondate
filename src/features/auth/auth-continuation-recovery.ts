import {
  isAuthContinuationCallbackOwned,
  listUnexpiredAuthFlows,
  ownedAuthStoragePrefixes,
  sanitizeReturnPath,
} from "./auth-flow";

export type RecoveryResult =
  | { kind: "complete"; flowId: string; returnTo: string }
  | { kind: "deposited" | "awaiting_completion" | "expired" | "error" };
export type AuthContinuationRecoveryGateway = {
  resumeFlow(flowId: string): Promise<RecoveryResult>;
};

type RecoveryCompleteResult = Extract<RecoveryResult, { kind: "complete" }>;

function isRecoveryComplete(result: RecoveryResult): result is RecoveryCompleteResult {
  return result.kind === "complete" && "returnTo" in result && typeof result.returnTo === "string";
}

/** プロファイル横断で claim ポーリング間隔を共有する（F-AUTH-001: 複数タブの自己 429 防止）。 */
const CLAIM_POLL_COORDINATION_PREFIX = `${ownedAuthStoragePrefixes[1]}.claim-poll`;
const LAST_CLAIM_POLL_KEY = `${CLAIM_POLL_COORDINATION_PREFIX}-last-at`;
const CLAIM_POLL_CURSOR_KEY = `${CLAIM_POLL_COORDINATION_PREFIX}-cursor`;
const CLAIM_POLL_LOCK_NAME = "kondate.auth.claim-poll";
const CLAIM_POLL_DATABASE_NAME = "kondate-auth-claim-poll";
const CLAIM_POLL_STORE_NAME = "coordination";
const CLAIM_POLL_TRANSACTION_KEY = "reservation";
const MIN_CLAIM_POLL_GAP_MS = 5_000;

function readLastPollAt(storage: Storage): number {
  const raw = storage.getItem(LAST_CLAIM_POLL_KEY);
  if (raw === null) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function writeStorageValue(storage: Storage, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    // 予約状態を書けないとタブ間rate制限を保証できないため、claimせず閉じる。
    return false;
  }
}

function selectNextFlowId(flowIds: string[], storage: Storage): string | undefined {
  if (flowIds.length === 0) return undefined;
  const cursor = storage.getItem(CLAIM_POLL_CURSOR_KEY);
  const cursorIndex = cursor === null ? -1 : flowIds.indexOf(cursor);
  return flowIds[(cursorIndex + 1) % flowIds.length];
}

function openClaimPollDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(CLAIM_POLL_DATABASE_NAME, 1);
    let settled = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CLAIM_POLL_STORE_NAME)) {
        request.result.createObjectStore(CLAIM_POLL_STORE_NAME);
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error("IndexedDB open failed"));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error("IndexedDB upgrade blocked"));
    };
  });
}

async function runInIndexedDbCoordinator<T>(operation: () => T): Promise<T | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  let database: IDBDatabase;
  try {
    database = await openClaimPollDatabase(indexedDB);
  } catch {
    return undefined;
  }

  try {
    return await new Promise<T | undefined>((resolve) => {
      let result: T | undefined;
      let settled = false;
      const settle = (value: T | undefined): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      let transaction: IDBTransaction;
      try {
        transaction = database.transaction(CLAIM_POLL_STORE_NAME, "readwrite");
        const store = transaction.objectStore(CLAIM_POLL_STORE_NAME);
        const read = store.get(CLAIM_POLL_TRANSACTION_KEY);
        read.onsuccess = () => {
          try {
            result = operation();
            store.put(Date.now(), CLAIM_POLL_TRANSACTION_KEY);
          } catch {
            transaction.abort();
          }
        };
        read.onerror = () => {
          transaction.abort();
        };
      } catch {
        settle(undefined);
        return;
      }
      transaction.oncomplete = () => {
        settle(result);
      };
      transaction.onerror = () => {
        settle(undefined);
      };
      transaction.onabort = () => {
        settle(undefined);
      };
    });
  } finally {
    database.close();
  }
}

export function startAuthContinuationRecovery(input: {
  gateway: AuthContinuationRecoveryGateway;
  storage: Storage;
  onComplete(result: RecoveryCompleteResult): void;
  onResult?(result: RecoveryResult): void;
  targetFlowId?: string;
  ttlMs?: number;
  now?: () => Date;
  setInterval?: typeof window.setInterval;
}): () => void {
  let running = false;
  let stopped = false;
  const isStopped = (): boolean => stopped;
  const reserveClaim = (): string | undefined => {
    if (stopped) return;
    const nowMs = (input.now?.() ?? new Date()).getTime();
    // F-AUTH-001: タブ横断で 5s 間隔を守る。focus/visibility の連打も同じ床で抑える。
    const last = readLastPollAt(input.storage);
    if (last <= nowMs && nowMs - last < MIN_CLAIM_POLL_GAP_MS) return;
    const now = input.now?.() ?? new Date();
    const ttlMs = input.ttlMs ?? 300_000;
    const unexpiredFlows = listUnexpiredAuthFlows(input.storage, now, ttlMs);
    const claimableFlowIds =
      input.targetFlowId === undefined
        ? unexpiredFlows
            .filter((flow) => !isAuthContinuationCallbackOwned(flow.id, input.storage, now, ttlMs))
            .map((flow) => flow.id)
        : unexpiredFlows.filter((flow) => flow.id === input.targetFlowId).map((flow) => flow.id);
    const flowId = selectNextFlowId(claimableFlowIds, input.storage);
    if (flowId === undefined || isStopped()) return;
    if (!writeStorageValue(input.storage, LAST_CLAIM_POLL_KEY, String(nowMs))) return;
    if (!writeStorageValue(input.storage, CLAIM_POLL_CURSOR_KEY, flowId)) return;
    return flowId;
  };
  const runClaim = async (flowId: string | undefined): Promise<void> => {
    if (flowId === undefined || stopped) return;
    const result = await input.gateway.resumeFlow(flowId);
    if (isRecoveryComplete(result)) {
      const completeResult = {
        ...result,
        returnTo: sanitizeReturnPath(result.returnTo),
      };
      input.onComplete(completeResult);
      input.onResult?.(completeResult);
      return;
    }
    input.onResult?.(result);
  };
  const poll = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      const lockManager = typeof navigator === "undefined" ? undefined : navigator.locks;
      if (lockManager === undefined) {
        await runClaim(await runInIndexedDbCoordinator(reserveClaim));
        return;
      }
      // Web Locks 対応ブラウザでは待機列を作らず、次周期に譲ってタブ横断のclaim競合を防ぐ。
      await lockManager.request(
        CLAIM_POLL_LOCK_NAME,
        { ifAvailable: true },
        async (lock): Promise<void> => {
          if (lock === null || stopped) return;
          await runClaim(reserveClaim());
        },
      );
    } catch {
      // recovery失敗は次周期へ委ね、認証情報を含み得る例外をグローバルへ漏らさない。
    } finally {
      running = false;
    }
  };
  // B-I1: claim の IP 上限 20/60s を超えないよう 5s 間隔（最大 12 回/分）にする。
  const timer = (input.setInterval ?? window.setInterval)(() => {
    void poll();
  }, 5_000);
  const wake = (): void => {
    void poll();
  };
  window.addEventListener("focus", wake);
  document.addEventListener("visibilitychange", wake);
  void poll();
  return () => {
    stopped = true;
    clearInterval(timer);
    window.removeEventListener("focus", wake);
    document.removeEventListener("visibilitychange", wake);
  };
}
