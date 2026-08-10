import { z } from "zod";
import { authDeadlineRemainingMs, clearAuthFlow, sanitizeLoginReturnPath } from "./auth-flow";

/**
 * C7: flow 単位の完了印。単一グローバルキーだと並行 flow の後着 publish が先着を上書きし、
 * 待ち側が TTL まで complete を見失う。prefix 配下は ownedAuthStoragePrefixes で logout 掃除される。
 */
const completionStoragePrefix = "kondate.auth.supabase.continuation-complete.";
/**
 * 旧単一キー。読み取りのみ後方互換（デプロイ跨ぎの in-flight タブ）。
 * 新規 publish は per-flow キーのみ。
 */
const legacyCompletionStorageKey = "kondate.auth.supabase.continuation-complete";
/** same-tab 通知用。storage イベントは書き込みタブでは発火しないため CustomEvent を併用する。 */
const completionEventName = "kondate.auth.supabase.continuation-complete";
const completionSchema = z
  .object({
    flowId: z.string().min(1),
    returnTo: z.string(),
  })
  .strict();

export type AuthContinuationCompletion = z.infer<typeof completionSchema>;

function completionStorageKeyFor(flowId: string): string {
  return `${completionStoragePrefix}${flowId}`;
}

function isCompletionStorageKey(key: string | null): boolean {
  if (key === null) return false;
  return key === legacyCompletionStorageKey || key.startsWith(completionStoragePrefix);
}

/**
 * C10: completion の returnTo も Login create と同型で自己参照 path を落とす。
 * sanitizeReturnPath だけだと /login・/auth/callback が残り、待ちタブが self へ navigate し得る。
 */
function toSafeCompletion(completion: AuthContinuationCompletion): AuthContinuationCompletion {
  return { ...completion, returnTo: sanitizeLoginReturnPath(completion.returnTo) };
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
  // per-flow を優先。無いときだけ legacy 単一キー（flowId 一致時のみ）。
  const perFlowRaw = storage.getItem(completionStorageKeyFor(flowId));
  if (perFlowRaw !== null) {
    try {
      const completion = parseCompletionPayload(JSON.parse(perFlowRaw));
      if (completion === null || completion.flowId !== flowId) {
        storage.removeItem(completionStorageKeyFor(flowId));
        return null;
      }
      return completion;
    } catch {
      storage.removeItem(completionStorageKeyFor(flowId));
      return null;
    }
  }
  const legacyRaw = storage.getItem(legacyCompletionStorageKey);
  if (legacyRaw === null) return null;
  try {
    const completion = parseCompletionPayload(JSON.parse(legacyRaw));
    if (completion === null) {
      storage.removeItem(legacyCompletionStorageKey);
      return null;
    }
    return completion.flowId === flowId ? completion : null;
  } catch {
    storage.removeItem(legacyCompletionStorageKey);
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
  // C7: per-flow キーへ書き、並行 flow の完了印を上書きしない。
  storage.setItem(completionStorageKeyFor(safe.flowId), JSON.stringify(safe));
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
    if (!isCompletionStorageKey(event.key) || event.newValue === null) return;
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
  /**
   * C4 / RR1: hangWatchdog と同型で normalizeAuthClock 相当の skew 補正に使う。
   * 正の skew（クライアント進み）を now から差し引き、サーバ期限前の secret 早期焼却を防ぐ。
   */
  clockSkewMs?: number;
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
  // C4 / C9 / C12: authDeadlineRemainingMs で hangWatchdog と対称。
  // 正 skew 改ざんによる wall 期限後の延命を閉じ、lease（wall）と一貫させる。
  const remainingMs = Number.isFinite(deadlineMs)
    ? authDeadlineRemainingMs(deadlineMs, Date.now(), input.clockSkewMs)
    : 0;
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
