import {
  isAuthContinuationCallbackOwned,
  listUnexpiredAuthFlows,
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
const LAST_CLAIM_POLL_KEY = "kondate.auth.claim-poll-last-at";
const CLAIM_POLL_LOCK_NAME = "kondate.auth.claim-poll";
const MIN_CLAIM_POLL_GAP_MS = 5_000;

function readLastPollAt(storage: Storage): number {
  const raw = storage.getItem(LAST_CLAIM_POLL_KEY);
  if (raw === null) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function writeLastPollAt(storage: Storage, at: number): void {
  try {
    storage.setItem(LAST_CLAIM_POLL_KEY, String(at));
  } catch {
    // quota 超過時は協調が弱まるだけなので握りつぶす
  }
}

export function startAuthContinuationRecovery(input: {
  gateway: AuthContinuationRecoveryGateway;
  storage: Storage;
  onComplete(result: RecoveryCompleteResult): void;
  ttlMs?: number;
  now?: () => Date;
  setInterval?: typeof window.setInterval;
}): () => void {
  let running = false;
  let stopped = false;
  const runClaimPoll = async (): Promise<void> => {
    if (stopped) return;
    const nowMs = (input.now?.() ?? new Date()).getTime();
    // F-AUTH-001: タブ横断で 5s 間隔を守る。focus/visibility の連打も同じ床で抑える。
    const last = readLastPollAt(input.storage);
    if (nowMs - last < MIN_CLAIM_POLL_GAP_MS) return;
    writeLastPollAt(input.storage, nowMs);
    const now = input.now?.() ?? new Date();
    const ttlMs = input.ttlMs ?? 300_000;
    for (const flow of listUnexpiredAuthFlows(input.storage, now, ttlMs)) {
      if (isAuthContinuationCallbackOwned(flow.id, input.storage, now, ttlMs)) continue;
      const result = await input.gateway.resumeFlow(flow.id);
      if (isRecoveryComplete(result)) {
        input.onComplete({
          ...result,
          returnTo: sanitizeReturnPath(result.returnTo),
        });
        break;
      }
    }
  };
  const poll = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      const lockManager = typeof navigator === "undefined" ? undefined : navigator.locks;
      if (lockManager === undefined) {
        await runClaimPoll();
        return;
      }
      // Web Locks 対応ブラウザでは待機列を作らず、次周期に譲ってタブ横断のclaim競合を防ぐ。
      await lockManager.request(
        CLAIM_POLL_LOCK_NAME,
        { ifAvailable: true },
        async (lock): Promise<void> => {
          if (lock === null || stopped) return;
          await runClaimPoll();
        },
      );
    } finally {
      running = false;
    }
  };
  // B-I1: claim の IP 上限 20/60s を超えないよう 5s 間隔（最大 12 回/分）にする。
  const timer = (input.setInterval ?? window.setInterval)(() => void poll(), 5_000);
  const wake = (): void => void poll();
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
