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
 * R3: 生存タブは heartbeat で refreshedAt を延ばし、hang 中の他タブ re-claim 窓を縮める。
 * JS 死亡時は heartbeat 停止 → TTL 失効で回復。
 * R2: acquire は Web Locks（flow 単位・ifAvailable）で臨界区間を直列化し、
 * localStorage は write→re-read→確認遅延→再 re-read で後着 write の dual true を潰す。
 */
const EXCHANGE_IN_FLIGHT_PREFIX = `${CLAIM_POLL_COORDINATION_PREFIX}-exchange.`;
/** Web Locks 名（claim-poll とは別。exchange 専用の flow 単位排他）。 */
const EXCHANGE_IN_FLIGHT_LOCK_PREFIX = "kondate.auth.exchange.";
/** テスト・心拍 TTL 検証用。IMMEDIATE_CLAIM_TIMEOUT * 4 = 120s。 */
export const EXCHANGE_IN_FLIGHT_TTL_MS = IMMEDIATE_CLAIM_TIMEOUT_MS * 4;
/**
 * R2: localStorage に CAS が無い前提で、write 直後 re-read だけでは
 * 「双方 null 読取 → 交互 write → 双方 true」が残る。確認遅延後の再 re-read で
 * 後着 owner 以外を false にする（Web Locks 非対応 UA の主防衛）。
 */
export const EXCHANGE_IN_FLIGHT_CONFIRM_DELAY_MS = 40;
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

function exchangeInFlightLockName(flowId: string): string {
  return `${EXCHANGE_IN_FLIGHT_LOCK_PREFIX}${flowId}`;
}

/** R2 acquire の注入点（テストで delay / locks を制御する）。 */
export type ExchangeInFlightAcquireOptions = {
  /** 確認遅延 ms。省略時は EXCHANGE_IN_FLIGHT_CONFIRM_DELAY_MS。 */
  confirmDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Web Locks。省略時は navigator.locks。
   * `null` で明示的に storage のみ（locks 無しフォールバック経路のテスト用）。
   */
  locks?: LockManager | null;
  /**
   * テスト専用: 他 owner チェック直後・write 前に挟む await 点。
   * 単一スレッドで「双方 null 読取 → その後に双方 write」を再現する。
   * 本番ゲートウェイは渡さない。
   */
  yieldBeforeWrite?: () => Promise<void>;
};

function defaultConfirmSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveExchangeLockManager(
  locksOption: LockManager | null | undefined,
): LockManager | undefined {
  if (locksOption === null) return undefined;
  if (locksOption !== undefined) return locksOption;
  if (typeof navigator === "undefined") return undefined;
  // DOM 型は locks を常置するが、未対応 UA では runtime で欠けることがある
  const locks = Reflect.get(navigator, "locks") as LockManager | undefined;
  if (locks === undefined || typeof locks.request !== "function") return undefined;
  return locks;
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

/**
 * C9: hangWatchdog / failClosed が exchange lease 取得前（claim 中〜acquire 遅延）でも
 * secret を焼かないよう、callback-prelease の有効性を見る。
 * completeCallback 同一ブラウザ経路では deposit 前から pre-lease が立つ。
 */
export function isAuthContinuationCallbackPreLeaseHeld(
  flowId: string,
  storage: Storage,
  nowMs: number = Date.now(),
): boolean {
  try {
    const raw = storage.getItem(callbackPreLeaseKey(flowId));
    if (raw === null) return false;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      storage.removeItem(callbackPreLeaseKey(flowId));
      return false;
    }
    const id = "flowId" in parsed ? parsed.flowId : null;
    const instanceId = "instanceId" in parsed ? parsed.instanceId : null;
    const refreshedAt = "refreshedAt" in parsed ? parsed.refreshedAt : null;
    if (
      id !== flowId ||
      instanceId !== CALLBACK_PRE_LEASE_INSTANCE_ID ||
      typeof refreshedAt !== "number" ||
      !Number.isFinite(refreshedAt)
    ) {
      storage.removeItem(callbackPreLeaseKey(flowId));
      return false;
    }
    if (nowMs - refreshedAt > TARGET_RECOVERY_LEASE_TTL_MS) {
      storage.removeItem(callbackPreLeaseKey(flowId));
      return false;
    }
    return true;
  } catch {
    return false;
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
 * R2: storage のみの acquire（locks 臨界区間内またはフォールバックから呼ぶ）。
 *
 * 1. 他 owner 有効 lease → false
 * 2. write → 直後 re-read（owner 不一致なら false。他 owner キーは消さない）
 * 3. 既所有の refresh（heartbeat）なら遅延なしで true
 * 4. 初期取得は確認遅延後に再 re-read。後着 write の owner 以外は false
 *
 * 双方 null 読取後の交互 write でも、遅延後に storage に残る owner は 1 だけなので
 * 勝者は高々 1（last-writer-wins）。
 */
async function acquireExchangeInFlightViaStorage(
  flowId: string,
  instanceId: string,
  storage: Storage,
  nowMs: number,
  confirmDelayMs: number,
  sleep: (ms: number) => Promise<void>,
  yieldBeforeWrite?: () => Promise<void>,
): Promise<boolean> {
  const existing = readExchangeInFlight(storage, flowId, nowMs);
  if (existing !== null && existing.instanceId !== instanceId) {
    return false;
  }
  // 既所有判定は yield 前の snapshot（heartbeat は yield を使わない）
  const isRefresh = existing !== null && existing.instanceId === instanceId;
  // テスト用: 双方が null を見たあとに同期して write へ進ませる
  if (yieldBeforeWrite !== undefined) {
    await yieldBeforeWrite();
  }
  const lease: ExchangeInFlightLease = { flowId, instanceId, refreshedAt: nowMs };
  const key = exchangeInFlightKey(flowId);
  if (!writeStorageValue(storage, key, JSON.stringify(lease))) {
    return false;
  }
  // setItem 直後に owner 一致を確認（同時書き込みの最終 writer 以外はここで落ちる場合もある）
  const confirmed = readExchangeInFlight(storage, flowId, nowMs);
  if (confirmed === null || confirmed.instanceId !== instanceId) {
    // 他タブが後着上書き済み。自分は持たないので remove しない（勝者の lease を壊さない）
    return false;
  }
  // heartbeat 等の既所有 refresh は確認遅延不要（初期 dual-null 競合の窓ではない）
  if (isRefresh) {
    return true;
  }
  if (confirmDelayMs > 0) {
    await sleep(confirmDelayMs);
  }
  // 遅延中に他タブが上書きしていれば owner 不一致 → false（双方 true を潰す）
  const afterDelay = readExchangeInFlight(storage, flowId, nowMs + confirmDelayMs);
  if (afterDelay === null || afterDelay.instanceId !== instanceId) {
    return false;
  }
  return true;
}

/**
 * C3/R2: exchange 開始前にタブ横断 lease を取る。他タブが保持中なら false。
 * 同一 instance の再取得（heartbeat）は refreshedAt を更新して true。
 *
 * 優先: navigator.locks で flow 単位 exclusive（ifAvailable: true = 非待ち）。
 * ロック取得中だけ storage 書き込みと確認遅延を進め、他タブの同時 acquire を弾く。
 * ロック未対応 / 例外時は storage の write→re-read→遅延→再 re-read にフォールバック。
 */
export async function tryAcquireAuthContinuationExchangeInFlight(
  flowId: string,
  instanceId: string,
  storage: Storage,
  nowMs: number = Date.now(),
  options?: ExchangeInFlightAcquireOptions,
): Promise<boolean> {
  const confirmDelayMs = options?.confirmDelayMs ?? EXCHANGE_IN_FLIGHT_CONFIRM_DELAY_MS;
  const sleep = options?.sleep ?? defaultConfirmSleep;
  const yieldBeforeWrite = options?.yieldBeforeWrite;
  const lockManager = resolveExchangeLockManager(options?.locks);

  if (lockManager !== undefined) {
    try {
      let acquired = false;
      await lockManager.request(
        exchangeInFlightLockName(flowId),
        { ifAvailable: true },
        async (lock) => {
          // 他タブが臨界区間保持中 → 待たずに諦める（storage フォールバックしない）
          if (lock === null) {
            acquired = false;
            return;
          }
          acquired = await acquireExchangeInFlightViaStorage(
            flowId,
            instanceId,
            storage,
            nowMs,
            confirmDelayMs,
            sleep,
            yieldBeforeWrite,
          );
        },
      );
      return acquired;
    } catch {
      // Web Locks 例外時のみ storage 経路へ（claim-poll と同様、ロック基盤障害で exchange を全止めしない）
    }
  }

  return acquireExchangeInFlightViaStorage(
    flowId,
    instanceId,
    storage,
    nowMs,
    confirmDelayMs,
    sleep,
    yieldBeforeWrite,
  );
}

/**
 * R2: 指定 instance が現在の exchange in-flight owner か。
 * acquire 成功後〜exchange 開始直前の再確認に使う。
 */
export function isAuthContinuationExchangeInFlightOwner(
  flowId: string,
  instanceId: string,
  storage: Storage,
  nowMs: number = Date.now(),
): boolean {
  const existing = readExchangeInFlight(storage, flowId, nowMs);
  return existing !== null && existing.instanceId === instanceId;
}

/**
 * R3: exchange 中の heartbeat。MIN_CLAIM_POLL_GAP 間隔で同一 instance の lease を延長する。
 * 返却関数は heartbeat のみ止める（キー削除は release 側）。
 * C5: bg throttle で interval が止まる前に freeze / pagehide / 非表示遷移でも 1 拍延命し、
 * 復帰時（resume / pageshow / focus / visible）も即 beat。hidden wake を捨てない。
 */
export function startAuthContinuationExchangeInFlightHeartbeat(
  flowId: string,
  instanceId: string,
  storage: Storage,
  now: () => number = () => Date.now(),
  setIntervalFn: typeof setInterval = setInterval,
  clearIntervalFn: typeof clearInterval = clearInterval,
): () => void {
  const beat = (): void => {
    // 所有中のみ refreshedAt 更新。他 owner や失効後の奪取は tryAcquire が拒否する。
    // async 化後も interval から fire-and-forget（失敗時は次拍 or TTL で収束）。
    void tryAcquireAuthContinuationExchangeInFlight(flowId, instanceId, storage, now());
  };
  const timer = setIntervalFn(beat, MIN_CLAIM_POLL_GAP_MS);
  // C5: hidden でも beat（深 sleep 直前の延命）。interval が throttle されても
  // freeze/pagehide で 1 拍、復帰で再拍できる。
  const wake = (): void => {
    beat();
  };
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    // Page Lifecycle: freeze 前・resume 後に lease を延命（モバイル bg の dual exchange 窓を縮める）
    document.addEventListener("freeze", wake);
    document.addEventListener("resume", wake);
    window.addEventListener("pagehide", wake);
    window.addEventListener("pageshow", wake);
  }
  return () => {
    clearIntervalFn(timer);
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
      document.removeEventListener("freeze", wake);
      document.removeEventListener("resume", wake);
      window.removeEventListener("pagehide", wake);
      window.removeEventListener("pageshow", wake);
    }
  };
}

/**
 * C3: exchange 完了・terminal 時に lease を解放する。
 * instanceId 指定時は他 owner のキーを消さない（R2 並行後の安全解放）。
 */
export function releaseAuthContinuationExchangeInFlight(
  flowId: string,
  storage: Storage,
  instanceId?: string,
): void {
  try {
    if (instanceId !== undefined) {
      const existing = readExchangeInFlight(storage, flowId, Date.now());
      if (existing !== null && existing.instanceId !== instanceId) {
        return;
      }
    }
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

/**
 * C15/C9: hangWatchdog が secret を焼いてよいか。
 * exchange in-flight または callback-prelease（claim〜exchange 前）なら焼かない。
 */
export function isAuthContinuationExchangeBusy(
  flowId: string,
  storage: Storage,
  nowMs: number = Date.now(),
): boolean {
  return (
    isAuthContinuationExchangeInFlight(flowId, storage, nowMs) ||
    isAuthContinuationCallbackPreLeaseHeld(flowId, storage, nowMs)
  );
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
    // （gateway 自身の completion bus 公開。recovery の onComplete は stop 後は呼ばない — R2）
    let result: RecoveryResult;
    try {
      result = await withTimeout(input.gateway.resumeFlow(flowId), IMMEDIATE_CLAIM_TIMEOUT_MS);
    } catch {
      return;
    }
    // R2: cleanup で stopped=true しても in-flight resumeFlow は abort できない。
    // await 後・副作用前に再検査し、ポリシー上 stop した recovery の onComplete/onResult を捨てる。
    if (isStopped()) return;
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
  // create/deposit は 40/60。CGNAT 共有で 429 になり得る。
  // claim の 429/5xx は gateway が awaiting 再試行（C17）。
  // C3: deposit の 429/5xx は completeCallback 内 backoff 後、同一ブラウザは pending code を残して
  // awaiting へ。resumeFlow（recovery 経由含む）が pending から re-deposit してから claim する。
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
