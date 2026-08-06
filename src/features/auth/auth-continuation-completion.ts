import { z } from "zod";
import { clearAuthFlow, sanitizeReturnPath } from "./auth-flow";

const completionStorageKey = "kondate.auth.supabase.continuation-complete";
/** same-tab 通知用。storage イベントは書き込みタブでは発火しないため CustomEvent を併用する。 */
const completionEventName = "kondate.auth.supabase.continuation-complete";
const completionSchema = z
  .object({
    flowId: z.string().min(1),
    returnTo: z.string(),
  })
  .strict();

export type AuthContinuationCompletion = z.infer<typeof completionSchema>;

function toSafeCompletion(completion: AuthContinuationCompletion): AuthContinuationCompletion {
  return { ...completion, returnTo: sanitizeReturnPath(completion.returnTo) };
}

function parseCompletionPayload(raw: unknown): AuthContinuationCompletion | null {
  try {
    return toSafeCompletion(completionSchema.parse(raw));
  } catch {
    return null;
  }
}

export function readAuthContinuationCompletion(
  flowId: string,
  storage: Storage = window.localStorage,
): AuthContinuationCompletion | null {
  const raw = storage.getItem(completionStorageKey);
  if (raw === null) return null;
  try {
    const completion = parseCompletionPayload(JSON.parse(raw));
    if (completion === null) {
      storage.removeItem(completionStorageKey);
      return null;
    }
    return completion.flowId === flowId ? completion : null;
  } catch {
    storage.removeItem(completionStorageKey);
    return null;
  }
}

export function publishAuthContinuationCompletion(
  completion: AuthContinuationCompletion,
  storage: Storage = window.localStorage,
): void {
  const safe = toSafeCompletion(completion);
  // C10: completion を先に書く。setItem 失敗時は throw のまま secret を残し、
  // 他タブが re-claim / 再 publish できる余地を残す（clear→setItem 順だと secret だけ消える）。
  storage.setItem(completionStorageKey, JSON.stringify(safe));
  // storage イベントは書き込み同一タブでは発火しない。late publish を wait/listener が拾えるよう same-tab 通知する。
  window.dispatchEvent(new CustomEvent(completionEventName, { detail: safe }));
  clearAuthFlow(completion.flowId, storage);
}

export function startAuthContinuationCompletionListener(input: {
  onComplete(completion: AuthContinuationCompletion): void;
}): () => void {
  const deliver = (raw: unknown): void => {
    const completion = parseCompletionPayload(raw);
    if (completion === null) return;
    input.onComplete(completion);
  };

  const onStorage = (event: StorageEvent): void => {
    if (event.key !== completionStorageKey || event.newValue === null) return;
    try {
      deliver(JSON.parse(event.newValue));
    } catch {
      // 他タブから届いた破損 JSON は認証後の遷移に利用しない。
    }
  };
  const onSameTab = (event: Event): void => {
    if (!(event instanceof CustomEvent)) return;
    deliver(event.detail);
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener(completionEventName, onSameTab);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(completionEventName, onSameTab);
  };
}

export function startAuthContinuationCompletionWait(input: {
  flowId: string;
  startedAt: string;
  ttlMs: number;
  /**
   * サーバ絶対期限（flow.expiresAt）。分かればローカル TTL と min してクリップする（R3 / C6 同型）。
   */
  serverExpiresAt?: string;
  onComplete(completion: AuthContinuationCompletion): void;
  onExpire(): void;
}): () => void {
  const existing = readAuthContinuationCompletion(input.flowId);
  if (existing !== null) {
    input.onComplete(existing);
    return () => undefined;
  }

  let finished = false;
  const stopListening = startAuthContinuationCompletionListener({
    onComplete: (completion) => {
      if (finished || completion.flowId !== input.flowId) return;
      finished = true;
      window.clearTimeout(timer);
      stopListening();
      input.onComplete(completion);
    },
  });
  // R3: hangWatchdog（C6）と同型で min(startedAt+ttl, serverExpiresAt) を deadline にする
  const localDeadlineMs = new Date(input.startedAt).getTime() + input.ttlMs;
  const serverExpiresMs =
    input.serverExpiresAt === undefined ? null : new Date(input.serverExpiresAt).getTime();
  const deadlineMs =
    serverExpiresMs !== null && Number.isFinite(serverExpiresMs)
      ? Math.min(localDeadlineMs, serverExpiresMs)
      : localDeadlineMs;
  const remainingMs = Number.isFinite(deadlineMs) ? Math.max(0, deadlineMs - Date.now()) : 0;
  const timer = window.setTimeout(() => {
    if (finished) return;
    finished = true;
    stopListening();
    input.onExpire();
  }, remainingMs);

  return () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(timer);
    stopListening();
  };
}
