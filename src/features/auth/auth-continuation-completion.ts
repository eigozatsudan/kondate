import { z } from "zod";
import { clearAuthFlow, sanitizeReturnPath } from "./auth-flow";

const completionStorageKey = "kondate.auth.supabase.continuation-complete";
const completionSchema = z
  .object({
    flowId: z.string().min(1),
    returnTo: z.string(),
  })
  .strict();

export type AuthContinuationCompletion = z.infer<typeof completionSchema>;

export function readAuthContinuationCompletion(
  flowId: string,
  storage: Storage = window.localStorage,
): AuthContinuationCompletion | null {
  const raw = storage.getItem(completionStorageKey);
  if (raw === null) return null;
  try {
    const completion = completionSchema.parse(JSON.parse(raw));
    return completion.flowId === flowId
      ? { ...completion, returnTo: sanitizeReturnPath(completion.returnTo) }
      : null;
  } catch {
    storage.removeItem(completionStorageKey);
    return null;
  }
}

export function publishAuthContinuationCompletion(
  completion: AuthContinuationCompletion,
  storage: Storage = window.localStorage,
): void {
  clearAuthFlow(completion.flowId, storage);
  storage.setItem(
    completionStorageKey,
    JSON.stringify({ ...completion, returnTo: sanitizeReturnPath(completion.returnTo) }),
  );
}

export function startAuthContinuationCompletionListener(input: {
  onComplete(completion: AuthContinuationCompletion): void;
}): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== completionStorageKey || event.newValue === null) return;
    try {
      const completion = completionSchema.parse(JSON.parse(event.newValue));
      input.onComplete({ ...completion, returnTo: sanitizeReturnPath(completion.returnTo) });
    } catch {
      // 他タブから届いた破損値は認証後の遷移に利用しない。
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("storage", onStorage);
  };
}

export function startAuthContinuationCompletionWait(input: {
  flowId: string;
  startedAt: string;
  ttlMs: number;
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
  const expiresAt = new Date(input.startedAt).getTime() + input.ttlMs;
  const remainingMs = Number.isFinite(expiresAt) ? Math.max(0, expiresAt - Date.now()) : 0;
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
