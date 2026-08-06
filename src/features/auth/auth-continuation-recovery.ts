import {
  isAuthContinuationCallbackOwned,
  listUnexpiredAuthFlows,
  ownedAuthStoragePrefixes,
  sanitizeReturnPath,
} from "./auth-flow";
import { IMMEDIATE_CLAIM_TIMEOUT_MS, withTimeout } from "./async-timeout";

export type RecoveryResult =
  | { kind: "complete"; flowId: string; returnTo: string }
  | { kind: "deposited" | "awaiting_completion"; flowId?: string; returnTo?: string }
  | { kind: "expired" | "error"; flowId?: string; returnTo?: string };
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
const TARGET_RECOVERY_LEASE_PREFIX = `${CLAIM_POLL_COORDINATION_PREFIX}-target-lease.`;
const CLAIM_POLL_LOCK_NAME = "kondate.auth.claim-poll";
const CLAIM_POLL_DATABASE_NAME = "kondate-auth-claim-poll";
const CLAIM_POLL_STORE_NAME = "coordination";
const CLAIM_POLL_TRANSACTION_KEY = "reservation";
const MIN_CLAIM_POLL_GAP_MS = 5_000;
/**
 * C3: pre-lease / target lease の失効。即時 resume の hang 上限（30s）+ poll 床を覆い、
 * heartbeat 停止直後に他タブが orphan 誤認して dual exchange しないようにする。
 */
const TARGET_RECOVERY_LEASE_TTL_MS = IMMEDIATE_CLAIM_TIMEOUT_MS + MIN_CLAIM_POLL_GAP_MS;
/**
 * C3: claim 成功後〜exchange 完了までのタブ横断排他。
 * IdP code 単回利用のため、process 内 inflight の外側で dual exchange を抑止する。
 * タブ死亡時は TTL 後に再 claim を許す（C3 冪等 re-claim）。
 */
const EXCHANGE_IN_FLIGHT_PREFIX = `${CLAIM_POLL_COORDINATION_PREFIX}-exchange.`;
const EXCHANGE_IN_FLIGHT_TTL_MS = IMMEDIATE_CLAIM_TIMEOUT_MS * 4;
/**
 * C-R5: completeCallback 即時 resume の pre-lease 窓用。
 * target recovery 開始前でも「lease 0 = orphan」にしない固定 instanceId。
 * pending:false のため target recovery 開始後も claimable のまま（global だけ抑止）。
 */
const CALLBACK_PRE_LEASE_INSTANCE_ID = "callback-prelease";

type TargetRecoveryLease = {
  flowId: string;
  instanceId: string;
  refreshedAt: number;
  pending: boolean;
};

type ExchangeInFlightLease = {
  flowId: string;
  instanceId: string;
  refreshedAt: number;
};

function callbackPreLeaseKey(flowId: string): string {
  return `${TARGET_RECOVERY_LEASE_PREFIX}${flowId}.${CALLBACK_PRE_LEASE_INSTANCE_ID}`;
}

function exchangeInFlightKey(flowId: string): string {
  return `${EXCHANGE_IN_FLIGHT_PREFIX}${flowId}`;
}

/**
 * C-R5: callback 同一ブラウザの deposit/即時 resume 中に target lease 相当を立て、
 * 他タブ global recovery が orphan 扱いして dual exchange しないようにする。
 * 5s 間隔で heartbeat（lease TTL は IMMEDIATE_CLAIM_TIMEOUT+床）。返却関数は heartbeat のみ止める。
 * terminal 時は releaseAuthContinuationCallbackPreLease で消す。awaiting 手渡しでは残し、
 * target recovery の自前 lease と併存させてよい。
 */
export function startAuthContinuationCallbackPreLease(
  flowId: string,
  storage: Storage,
  now: () => Date = () => new Date(),
  setIntervalFn: typeof setInterval = setInterval,
  clearIntervalFn: typeof clearInterval = clearInterval,
): () => void {
  const write = (): void => {
    const lease: TargetRecoveryLease = {
      flowId,
      instanceId: CALLBACK_PRE_LEASE_INSTANCE_ID,
      refreshedAt: now().getTime(),
      pending: false,
    };
    writeStorageValue(storage, callbackPreLeaseKey(flowId), JSON.stringify(lease));
  };
  write();
  const timer = setIntervalFn(() => {
    write();
  }, MIN_CLAIM_POLL_GAP_MS);
  return () => {
    clearIntervalFn(timer);
  };
}

/** C-R5: pre-lease キーを除去（complete / terminal error 時）。 */
export function releaseAuthContinuationCallbackPreLease(flowId: string, storage: Storage): void {
  try {
    storage.removeItem(callbackPreLeaseKey(flowId));
  } catch {
    // cleanup 失敗時も lease は短期 TTL で失効する
  }
}

function readExchangeInFlight(
  storage: Storage,
  flowId: string,
  nowMs: number,
): ExchangeInFlightLease | null {
  try {
    const raw = storage.getItem(exchangeInFlightKey(flowId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      storage.removeItem(exchangeInFlightKey(flowId));
      return null;
    }
    const id = "flowId" in parsed ? parsed.flowId : null;
    const instanceId = "instanceId" in parsed ? parsed.instanceId : null;
    const refreshedAt = "refreshedAt" in parsed ? parsed.refreshedAt : null;
    if (
      id !== flowId ||
      typeof instanceId !== "string" ||
      instanceId === "" ||
      typeof refreshedAt !== "number" ||
      !Number.isFinite(refreshedAt)
    ) {
      storage.removeItem(exchangeInFlightKey(flowId));
      return null;
    }
    if (nowMs - refreshedAt > EXCHANGE_IN_FLIGHT_TTL_MS) {
      storage.removeItem(exchangeInFlightKey(flowId));
      return null;
    }
    return { flowId: id, instanceId, refreshedAt };
  } catch {
    return null;
  }
}

/**
 * C3: exchange 開始前にタブ横断 lease を取る。他タブが保持中なら false。
 * 同一 instance の再取得（heartbeat 相当）は true。
 */
export function tryAcquireAuthContinuationExchangeInFlight(
  flowId: string,
  instanceId: string,
  storage: Storage,
  nowMs: number = Date.now(),
): boolean {
  const existing = readExchangeInFlight(storage, flowId, nowMs);
  if (existing !== null && existing.instanceId !== instanceId) {
    return false;
  }
  const lease: ExchangeInFlightLease = { flowId, instanceId, refreshedAt: nowMs };
  return writeStorageValue(storage, exchangeInFlightKey(flowId), JSON.stringify(lease));
}

/** C3: exchange 完了・terminal 時に lease を解放する */
export function releaseAuthContinuationExchangeInFlight(flowId: string, storage: Storage): void {
  try {
    storage.removeItem(exchangeInFlightKey(flowId));
  } catch {
    // TTL で収束する
  }
}

export function isAuthContinuationExchangeInFlight(
  flowId: string,
  storage: Storage,
  nowMs: number = Date.now(),
): boolean {
  return readExchangeInFlight(storage, flowId, nowMs) !== null;
}

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

function createRecoveryInstanceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function readActiveTargetLeases(
  storage: Storage,
  nowMs: number,
): Map<string, TargetRecoveryLease[]> {
  const leases = new Map<string, TargetRecoveryLease[]>();
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
    (key): key is string => key?.startsWith(TARGET_RECOVERY_LEASE_PREFIX) === true,
  );
  for (const key of keys) {
    let lease: TargetRecoveryLease | undefined;
    try {
      const value: unknown = JSON.parse(storage.getItem(key) ?? "");
      if (
        typeof value === "object" &&
        value !== null &&
        "flowId" in value &&
        typeof value.flowId === "string" &&
        "instanceId" in value &&
        typeof value.instanceId === "string" &&
        "refreshedAt" in value &&
        typeof value.refreshedAt === "number" &&
        Number.isFinite(value.refreshedAt) &&
        "pending" in value &&
        typeof value.pending === "boolean"
      ) {
        lease = {
          flowId: value.flowId,
          instanceId: value.instanceId,
          refreshedAt: value.refreshedAt,
          pending: value.pending,
        };
      }
    } catch {
      // 破損leaseは有効なtarget所有証跡として扱わず、同じowned prefix内で除去する。
    }
    const expectedKey =
      lease === undefined
        ? undefined
        : `${TARGET_RECOVERY_LEASE_PREFIX}${lease.flowId}.${lease.instanceId}`;
    const age = lease === undefined ? Number.NaN : nowMs - lease.refreshedAt;
    if (
      lease === undefined ||
      expectedKey !== key ||
      age < 0 ||
      age > TARGET_RECOVERY_LEASE_TTL_MS
    ) {
      storage.removeItem(key);
      continue;
    }
    const flowLeases = leases.get(lease.flowId) ?? [];
    flowLeases.push(lease);
    leases.set(lease.flowId, flowLeases);
  }
  return leases;
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
  const instanceId = createRecoveryInstanceId();
  const targetLeaseKey =
    input.targetFlowId === undefined
      ? undefined
      : `${TARGET_RECOVERY_LEASE_PREFIX}${input.targetFlowId}.${instanceId}`;
  const isStopped = (): boolean => stopped;
  const refreshTargetLease = (pending: boolean): boolean => {
    if (input.targetFlowId === undefined || targetLeaseKey === undefined) return true;
    const lease: TargetRecoveryLease = {
      flowId: input.targetFlowId,
      instanceId,
      refreshedAt: (input.now?.() ?? new Date()).getTime(),
      pending,
    };
    return writeStorageValue(input.storage, targetLeaseKey, JSON.stringify(lease));
  };
  const reserveClaim = (): string | undefined => {
    if (stopped) return;
    const nowMs = (input.now?.() ?? new Date()).getTime();
    // F-AUTH-001: タブ横断で 5s 間隔を守る。focus/visibility の連打も同じ床で抑える。
    // U1-I3: last が未来（時計戻り・改ざん）だと `last <= nowMs` が偽になり gap がスキップされるため、
    // 未来値は now に正規化してその周期の claim を見送る。
    const last = readLastPollAt(input.storage);
    if (last > nowMs) {
      writeStorageValue(input.storage, LAST_CLAIM_POLL_KEY, String(nowMs));
      return;
    }
    if (nowMs - last < MIN_CLAIM_POLL_GAP_MS) return;
    const now = input.now?.() ?? new Date();
    const ttlMs = input.ttlMs ?? 300_000;
    const unexpiredFlows = listUnexpiredAuthFlows(input.storage, now, ttlMs);
    const activeTargetLeases = readActiveTargetLeases(input.storage, nowMs);
    const callbackOwnedFlowIds = new Set(
      unexpiredFlows
        .filter((flow) => isAuthContinuationCallbackOwned(flow.id, input.storage, now, ttlMs))
        .map((flow) => flow.id),
    );
    // AUTH-R2: callback-owner 中は target lease がある間だけ排他。
    // lease が全滅（callback タブ死亡・TTL 切れ）したら orphan として global recovery が claim できる。
    // C-R5: completeCallback 即時 resume 中は callback-prelease が立ち、pre-lease 窓の orphan 誤認を防ぐ。
    // C3: 他タブが exchange 中の flow は claimable に入れない（dual exchange 抑止）。
    const claimableFlowIds = unexpiredFlows
      .filter((flow) => {
        if (isAuthContinuationExchangeInFlight(flow.id, input.storage, nowMs)) return false;
        if (!callbackOwnedFlowIds.has(flow.id)) return true;
        const leases = activeTargetLeases.get(flow.id) ?? [];
        if (leases.length === 0) return true;
        return leases.every((lease) => !lease.pending);
      })
      .map((flow) => flow.id);
    const flowId = selectNextFlowId(claimableFlowIds, input.storage);
    if (flowId === undefined || isStopped()) return;
    const isCallbackOwned = callbackOwnedFlowIds.has(flowId);
    const ownerLeases = activeTargetLeases.get(flowId) ?? [];
    const isOrphanCallbackOwned = isCallbackOwned && ownerLeases.length === 0;
    const canHandleFlow =
      input.targetFlowId === undefined
        ? !isCallbackOwned || isOrphanCallbackOwned
        : isCallbackOwned && flowId === input.targetFlowId;
    // 担当外flowを選んだinstanceは共有slotを消費せず、同じ周期の担当instanceへ譲る。
    if (!canHandleFlow) return;
    if (input.targetFlowId !== undefined && !refreshTargetLease(true)) return;
    if (!writeStorageValue(input.storage, LAST_CLAIM_POLL_KEY, String(nowMs))) return;
    if (!writeStorageValue(input.storage, CLAIM_POLL_CURSOR_KEY, flowId)) return;
    return flowId;
  };
  const runClaim = async (flowId: string | undefined): Promise<void> => {
    if (flowId === undefined || stopped) return;
    // claim 後 exchange hang で recovery の running を永久占有しない（timeout で解放）。
    // C4: gateway は exchange 成功まで secret を残すため、timeout 後の次周期で
    // 冪等 re-claim → 再 exchange を試せる。裏の resumeFlow が complete すれば completion を publish する。
    let result: RecoveryResult;
    try {
      result = await withTimeout(input.gateway.resumeFlow(flowId), IMMEDIATE_CLAIM_TIMEOUT_MS);
    } catch {
      return;
    }
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
    if (stopped || !refreshTargetLease(running) || running) return;
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
      if (!isStopped()) refreshTargetLease(false);
    }
  };
  // B-I1 / C12: claim の IP 上限 60/60s を超えないよう 5s 間隔（最大 12 回/分）にする。
  // create/deposit は 40/60。CGNAT 共有で 429 になり得るが gateway は awaiting 再試行する（C17）。
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
    if (targetLeaseKey !== undefined) {
      try {
        input.storage.removeItem(targetLeaseKey);
      } catch {
        // cleanup失敗時もleaseは短期で失効し、他flowをTTLまで停止させない。
      }
    }
  };
}
