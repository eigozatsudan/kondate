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
