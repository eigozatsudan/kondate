import { isAuthContinuationCallbackOwned, listUnexpiredAuthFlows } from "./auth-flow";

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
  const poll = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      const now = input.now?.() ?? new Date();
      const ttlMs = input.ttlMs ?? 300_000;
      for (const flow of listUnexpiredAuthFlows(input.storage, now, ttlMs)) {
        if (isAuthContinuationCallbackOwned(flow.id, input.storage, now, ttlMs)) continue;
        const result = await input.gateway.resumeFlow(flow.id);
        if (isRecoveryComplete(result)) {
          input.onComplete(result);
          break;
        }
      }
    } finally {
      running = false;
    }
  };
  const timer = (input.setInterval ?? window.setInterval)(() => void poll(), 2_000);
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
