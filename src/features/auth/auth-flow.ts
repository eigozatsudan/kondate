import { z } from "zod";

/**
 * returnTo の共有検証（client storage / claim 応答 / サーバ Zod と同型）。
 * C8: `\` と制御文字も拒否し、sanitizeReturnPath より緩い経路を残さない。
 */
export function isSafeAuthReturnTo(value: string): boolean {
  if (value === "/") return true;
  if (!/^\/[^/]/u.test(value)) return false;
  if (value.startsWith("//") || value.includes("//")) return false;
  if (value.includes("\\")) return false;
  // eslint-disable-next-line no-control-regex -- returnTo に制御文字を許さない（C8）
  if (/[\u0000-\u001f\u007f]/u.test(value)) return false;
  return true;
}

/** U1-M1: storage 改ざん時も protocol-relative `//…` や埋め込み `//` を読まない */
const authFlowReturnToSchema = z.string().refine(isSafeAuthReturnTo, "invalid_return_to");

const authFlowSchema = z
  .object({
    id: z.uuid(),
    secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    state: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    origin: z.url(),
    returnTo: authFlowReturnToSchema,
    sessionExchange: z.enum(["supabase", "oauth_mock"]),
    startedAt: z.iso.datetime({ offset: true }),
    // create 応答のサーバ絶対期限。無い（旧 storage）ならローカル TTL のみ（C13）。
    expiresAt: z.iso.datetime({ offset: true }).optional(),
    /**
     * C6: create 時点の clientNow − (serverExpiresAt − ttl)。
     * 正 = クライアント時計が進みすぎ。deadline 判定で now から差し引き、早期消去を抑える。
     * 旧 storage には無い（0 扱い）。
     */
    // z.number() は無限大を既定で拒否するため .finite() は不要（deprecated no-op）
    clockSkewMs: z.number().optional(),
  })
  .strict();
const legacyAuthFlowSchema = authFlowSchema.omit({ sessionExchange: true }).strict();
const clockRebaseMarkerSchema = z
  .object({
    rebasedAt: z.iso.datetime({ offset: true }),
    deadlineAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type AuthFlow = z.infer<typeof authFlowSchema>;
type ClockRebaseMarker = z.infer<typeof clockRebaseMarkerSchema>;

export type FlowDeps = {
  randomBytes(size?: number): Uint8Array;
  now(): Date;
};

export const browserFlowDeps: FlowDeps = {
  randomBytes: (size = 32) => crypto.getRandomValues(new Uint8Array(size)),
  now: () => new Date(),
};

/**
 * C9: continuation secret は localStorage 平文（SPA+PKCE 設計のロック）。
 * HttpOnly cookie 境界は無し。同一オリジン XSS 面は CSP（emit-deploy-headers）と
 * 所有キーの logout clear で抑止する。完全隔離はアーキテクチャ変更が必要。
 */
export const ownedAuthStoragePrefixes = ["kondate.auth.flow.", "kondate.auth.supabase"] as const;

const flowPrefix = ownedAuthStoragePrefixes[0];
const callbackOwnerPrefix = `${ownedAuthStoragePrefixes[1]}.callback-owner.`;
const clockRebasePrefix = `${ownedAuthStoragePrefixes[1]}.clock-rebase.`;
const defaultAuthContinuationTtlMs = 300_000;
/** C6: create 時 skew の異常値をクリップ（手動時刻の極端なズレでも無限延命しない） */
const MAX_ABS_CLOCK_SKEW_MS = 48 * 60 * 60 * 1_000;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function sanitizeReturnPath(value: string | null | undefined): string {
  // B-I3/B-I5: URL 正規化**後**の pathname が安全であること。
  // - 裸 "/" は RootEntry（welcome/planner 分岐）へ戻すために許可する
  // - "/planner/..//evil" のような collapse 後 "//evil" は拒否する
  // - protocol-relative "//host" は拒否する
  if (value === undefined || value === null || value === "") {
    return "/planner";
  }
  if (value === "/") {
    return "/";
  }
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/planner";
  }
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin) {
      return "/planner";
    }
    const { pathname } = parsed;
    // collapse 後に protocol-relative や不正パスになったら拒否
    if (pathname.startsWith("//") || pathname.includes("\\") || pathname.includes("//")) {
      return "/planner";
    }
    if (pathname === "/") {
      return `${pathname}${parsed.search}${parsed.hash}`;
    }
    // 正規化後も「先頭 / のあと非 /」を要求（DB/Function 契約と同型）
    if (!/^\/[^/]/u.test(pathname)) {
      return "/planner";
    }
    return `${pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/planner";
  }
}

/**
 * 認証完了後の復帰先に載せるとループや無意味な中間遷移になる自己参照パス。
 * open redirect ではなく UX/状態機械の対称性（session-expiry / callback エラーと同型）。
 */
export function isAuthSelfReturnPath(path: string): boolean {
  return path === "/login" || path.startsWith("/login?") || path.startsWith("/auth/callback");
}

/**
 * Login happy path 用: sanitize したうえで /login・/auth/callback 自己参照を fallback へ落とす（C1）。
 */
export function sanitizeLoginReturnPath(
  value: string | null | undefined,
  fallback = "/welcome",
): string {
  const safe = sanitizeReturnPath(value);
  if (isAuthSelfReturnPath(safe)) return fallback;
  return safe;
}

export function buildAuthCallbackUrl(origin: string, flow: Pick<AuthFlow, "id" | "state">): string {
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.origin !== origin) throw new Error("invalid app origin");
  const callback = new URL("/auth/callback", parsedOrigin);
  callback.searchParams.set("flow", flow.id);
  callback.searchParams.set("state", flow.state);
  return callback.href;
}

export function readAuthFlow(id: string, storage: Storage): AuthFlow | null {
  const key = `${flowPrefix}${id}`;
  const raw = storage.getItem(key);
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    const parsed = authFlowSchema.safeParse(value);
    if (parsed.success && parsed.data.id === id) return parsed.data;
    const legacy = legacyAuthFlowSchema.safeParse(value);
    if (legacy.success && legacy.data.id === id) {
      // 更新直前に開始された認証を失わないよう、旧形式は本番同等の交換先へ移行する。
      const migrated: AuthFlow = { ...legacy.data, sessionExchange: "supabase" };
      storage.setItem(key, JSON.stringify(migrated));
      return migrated;
    }
  } catch {
    // 破損したブラウザ保存値は秘密の再利用を防ぐため削除する。
  }
  storage.removeItem(key);
  return null;
}

export function clearAuthFlow(id: string, storage: Storage = window.localStorage): void {
  clearAuthFlowClockState(id, storage);
}

export function clearClaimedAuthFlow(id: string, storage: Storage = window.localStorage): void {
  // 勝者の完了通知まで所有証跡を残し、同時claimに敗れたタブを待機へ収束させる。
  storage.removeItem(`${flowPrefix}${id}`);
}

export function markAuthContinuationCallbackOwner(flowId: string, storage?: Storage): void;
export function markAuthContinuationCallbackOwner(
  flowId: string,
  storage: Storage,
  now: Date,
  ttlMs: number,
): boolean;
export function markAuthContinuationCallbackOwner(
  flowId: string,
  storage: Storage = window.localStorage,
  now?: Date,
  ttlMs = defaultAuthContinuationTtlMs,
): boolean | void {
  try {
    const flow = readAuthFlow(flowId, storage);
    if (flow === null) return now === undefined ? undefined : true;
    if (now === undefined) {
      storage.setItem(`${callbackOwnerPrefix}${flowId}`, flow.startedAt);
      return;
    }
    const normalized = normalizeAuthClock(
      flowId,
      flow.startedAt,
      storage,
      now,
      ttlMs,
      (rebasedAt) => {
        storage.setItem(
          `${flowPrefix}${flowId}`,
          JSON.stringify({ ...flow, startedAt: rebasedAt }),
        );
        const ownerKey = `${callbackOwnerPrefix}${flowId}`;
        if (storage.getItem(ownerKey) !== null) storage.setItem(ownerKey, rebasedAt);
      },
      flow.expiresAt,
      flow.clockSkewMs,
    );
    if (normalized === null) return false;
    storage.setItem(`${callbackOwnerPrefix}${flowId}`, normalized);
    return true;
  } catch {
    // callback開始前の保存失敗はclaimを続けず、秘密を可能な範囲で破棄する。
    clearAuthFlowClockState(flowId, storage);
    return now === undefined ? undefined : false;
  }
}

export function readAuthContinuationCallbackStartedAt(
  flowId: string,
  storage: Storage = window.localStorage,
  now: Date = new Date(),
  ttlMs = defaultAuthContinuationTtlMs,
): string | null {
  try {
    const startedAt = storage.getItem(`${callbackOwnerPrefix}${flowId}`);
    if (startedAt === null) return null;
    // callback-only 所有でも flow が残っていればサーバ期限でクリップする（C13）。
    const flow = readAuthFlow(flowId, storage);
    return normalizeAuthClock(
      flowId,
      startedAt,
      storage,
      now,
      ttlMs,
      (rebasedAt) => {
        storage.setItem(`${callbackOwnerPrefix}${flowId}`, rebasedAt);
        const latest = readAuthFlow(flowId, storage);
        if (latest !== null) {
          storage.setItem(
            `${flowPrefix}${flowId}`,
            JSON.stringify({ ...latest, startedAt: rebasedAt }),
          );
        }
      },
      flow?.expiresAt,
      flow?.clockSkewMs,
    );
  } catch {
    clearAuthFlowClockState(flowId, storage);
    return null;
  }
}

export function isAuthContinuationCallbackOwned(
  flowId: string,
  storage: Storage,
  now: Date,
  ttlMs: number,
): boolean {
  return readAuthContinuationCallbackStartedAt(flowId, storage, now, ttlMs) !== null;
}

export function listUnexpiredAuthFlows(
  storage: Storage,
  now: Date,
  ttlMs = defaultAuthContinuationTtlMs,
): AuthFlow[] {
  const result: AuthFlow[] = [];
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
    (key): key is string => key?.startsWith(flowPrefix) === true,
  );
  for (const key of keys) {
    const id = key.slice(flowPrefix.length);
    const flow = readAuthFlow(id, storage);
    if (flow === null) continue;
    const normalized = normalizeAuthClock(
      id,
      flow.startedAt,
      storage,
      now,
      ttlMs,
      (rebasedAt) => {
        storage.setItem(key, JSON.stringify({ ...flow, startedAt: rebasedAt }));
        const ownerKey = `${callbackOwnerPrefix}${id}`;
        if (storage.getItem(ownerKey) !== null) storage.setItem(ownerKey, rebasedAt);
      },
      flow.expiresAt,
      flow.clockSkewMs,
    );
    if (normalized !== null) result.push({ ...flow, startedAt: normalized });
  }
  return result.toSorted((left, right) => left.startedAt.localeCompare(right.startedAt));
}

function parseServerExpiresMs(serverExpiresAt: string | null | undefined): number | null {
  if (serverExpiresAt === undefined || serverExpiresAt === null) return null;
  const ms = new Date(serverExpiresAt).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function clampClockSkewMs(skewMs: number | null | undefined): number {
  if (skewMs === undefined || skewMs === null || !Number.isFinite(skewMs)) return 0;
  if (skewMs > MAX_ABS_CLOCK_SKEW_MS) return MAX_ABS_CLOCK_SKEW_MS;
  if (skewMs < -MAX_ABS_CLOCK_SKEW_MS) return -MAX_ABS_CLOCK_SKEW_MS;
  return skewMs;
}

/**
 * C4 / C6: hangWatchdog や completion wait が normalizeAuthClock と同型で now を補正する。
 * 正の skew（クライアント進み）を差し引き、サーバ期限前の secret 早期焼却を防ぐ。
 */
export function adjustedAuthNowMs(wallNowMs: number, clockSkewMs?: number | null): number {
  return wallNowMs - clampClockSkewMs(clockSkewMs);
}

/**
 * create 応答の expiresAt とクライアント now から skew を推定する（C6）。
 * serverImpliedNow ≈ expiresAt − ttl。client が進みすぎなら正の skew。
 */
export function estimateAuthClockSkewMs(
  clientNowMs: number,
  serverExpiresAt: string,
  ttlMs: number = defaultAuthContinuationTtlMs,
): number {
  const serverExpiresMs = new Date(serverExpiresAt).getTime();
  if (!Number.isFinite(clientNowMs) || !Number.isFinite(serverExpiresMs) || !isValidTtl(ttlMs)) {
    return 0;
  }
  return clampClockSkewMs(clientNowMs - (serverExpiresMs - ttlMs));
}

function normalizeAuthClock(
  flowId: string,
  startedAt: string,
  storage: Storage,
  now: Date,
  ttlMs: number,
  persistRebase: (rebasedAt: string) => void,
  /** create 応答の絶対期限。未知ならローカル TTL のみ（C13）。 */
  serverExpiresAt?: string | null,
  /** C6: create 時に保存した client−server 推定 skew（正 = クライアント進み）。 */
  clockSkewMs?: number | null,
): string | null {
  try {
    const wallNowMs = now.getTime();
    const startedAtMs = new Date(startedAt).getTime();
    if (!Number.isFinite(wallNowMs) || !Number.isFinite(startedAtMs) || !isValidTtl(ttlMs)) {
      clearAuthFlowClockState(flowId, storage);
      return null;
    }
    // C6: 進みすぎクライアント時計でもサーバ期限まで claim できるよう now を補正する
    const nowMs = wallNowMs - clampClockSkewMs(clockSkewMs);

    const serverExpiresMs = parseServerExpiresMs(serverExpiresAt);

    const markerKey = `${clockRebasePrefix}${flowId}`;
    const rawMarker = storage.getItem(markerKey);
    if (rawMarker !== null) {
      const marker = parseClockRebaseMarker(rawMarker);
      if (marker === null || !isConsistentClockRebaseMarker(marker, startedAt, ttlMs)) {
        clearAuthFlowClockState(flowId, storage);
        return null;
      }
      const rebasedAtMs = new Date(marker.rebasedAt).getTime();
      const markerDeadlineMs = new Date(marker.deadlineAt).getTime();
      // サーバ期限が分かれば marker より厳しい方へ（C13）
      const deadlineAtMs =
        serverExpiresMs === null ? markerDeadlineMs : Math.min(markerDeadlineMs, serverExpiresMs);
      if (nowMs < rebasedAtMs || nowMs > deadlineAtMs) {
        clearAuthFlowClockState(flowId, storage);
        return null;
      }
      return marker.rebasedAt;
    }

    const localDeadlineMs = startedAtMs + ttlMs;
    const effectiveDeadlineMs =
      serverExpiresMs === null ? localDeadlineMs : Math.min(localDeadlineMs, serverExpiresMs);
    if (nowMs > effectiveDeadlineMs) {
      clearAuthFlowClockState(flowId, storage);
      return null;
    }

    const age = nowMs - startedAtMs;
    if (age >= 0) return startedAt;

    // future startedAt: 1 回だけ rebase。deadline は min(now+ttl, serverExpires)（C13）。
    // rebasedAt = deadline - ttl に固定すると deadlineAt - rebasedAt === ttl の marker 整合を保ち、
    // hangWatchdog の startedAt+ttl がサーバ期限と一致する。
    const rebasedLocalDeadlineMs = nowMs + ttlMs;
    const deadlineAtMs =
      serverExpiresMs === null
        ? rebasedLocalDeadlineMs
        : Math.min(rebasedLocalDeadlineMs, serverExpiresMs);
    if (deadlineAtMs <= nowMs) {
      clearAuthFlowClockState(flowId, storage);
      return null;
    }
    const rebasedAtMs = deadlineAtMs - ttlMs;
    const marker: ClockRebaseMarker = {
      rebasedAt: new Date(rebasedAtMs).toISOString(),
      deadlineAt: new Date(deadlineAtMs).toISOString(),
    };
    // markerを先に固定し、後続書込みが失敗しても再rebaseできない証跡を残す。
    storage.setItem(markerKey, JSON.stringify(marker));
    persistRebase(marker.rebasedAt);
    return marker.rebasedAt;
  } catch {
    clearAuthFlowClockState(flowId, storage);
    return null;
  }
}

function parseClockRebaseMarker(raw: string): ClockRebaseMarker | null {
  try {
    const parsed = clockRebaseMarkerSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function isConsistentClockRebaseMarker(
  marker: ClockRebaseMarker,
  startedAt: string,
  ttlMs: number,
): boolean {
  const rebasedAtMs = new Date(marker.rebasedAt).getTime();
  const deadlineAtMs = new Date(marker.deadlineAt).getTime();
  return (
    isValidTtl(ttlMs) &&
    Number.isFinite(rebasedAtMs) &&
    Number.isFinite(deadlineAtMs) &&
    startedAt === marker.rebasedAt &&
    deadlineAtMs - rebasedAtMs === ttlMs
  );
}

function isValidTtl(ttlMs: number): boolean {
  return Number.isFinite(ttlMs) && ttlMs > 0;
}

function clearAuthFlowClockState(flowId: string, storage: Storage): void {
  for (const key of [
    `${flowPrefix}${flowId}`,
    `${callbackOwnerPrefix}${flowId}`,
    `${clockRebasePrefix}${flowId}`,
  ]) {
    try {
      storage.removeItem(key);
    } catch {
      // fail-closed cleanupは他の保存値の削除を続け、個別Storage失敗を外へ漏らさない。
    }
  }
}

export function clearOwnedAuthStorage(storage: Storage): void {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
    (key): key is string => key !== null,
  );
  for (const key of keys) {
    if (ownedAuthStoragePrefixes.some((prefix) => key.startsWith(prefix))) storage.removeItem(key);
  }
}

export interface ContinuationApi {
  create(input: { state: string; secret: string; returnTo: string }): Promise<{
    id: string;
    expiresAt: string;
  }>;
  /**
   * code を deposit する。
   * secret を渡すと同じブラウザ所有者として毒 first-wins を上書きできる（C2）。
   * WebView 等 secret 無しは従来どおり first-wins。
   */
  deposit(
    continuationId: string,
    input: { state: string; code: string; secret?: string },
  ): Promise<void>;
  claim(
    continuationId: string,
    input: { secret: string; state: string },
  ): Promise<{ code: string; returnTo: string }>;
}

export class ContinuationHttpError extends Error {
  constructor(readonly status: number) {
    super("continuation_unavailable");
    this.name = "ContinuationHttpError";
  }
}

/**
 * HTTP 成功（2xx）を受け取ったあと body 読取が欠けたときのエラー。
 * claim はサーバ側で冪等再提示するため（C3）、gateway は secret を残して再 claim する。
 * fetch 自体の TypeError（サーバ未到達）とは区別する。
 */
export class ContinuationResponseLostError extends Error {
  constructor() {
    super("continuation_response_lost");
    this.name = "ContinuationResponseLostError";
  }
}

const createResponseSchema = z
  .object({ id: z.uuid(), expiresAt: z.iso.datetime({ offset: true }) })
  .strict();
/** サーバ claim 応答と同型。sanitize 前のパースで protocol-relative / `\` 等を落とす（C8） */
const claimResponseSchema = z
  .object({
    code: z.string().min(1).max(2_048),
    returnTo: z.string().max(500).refine(isSafeAuthReturnTo, { message: "invalid_return_to" }),
  })
  .strict();
const successEnvelope = <T extends z.ZodType>(schema: T) =>
  z.object({ ok: z.literal(true), data: schema }).strict();

export function createContinuationApi(fetchImpl: typeof fetch = fetch): ContinuationApi {
  const post = async <T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> => {
    const response = await fetchImpl(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new ContinuationHttpError(response.status);
    // 2xx 到達後の body 欠落はサーバ処理済み（claim は C3 で冪等再提示）の可能性が高い（R1）
    let value: unknown;
    try {
      value = response.status === 204 ? null : await response.json();
    } catch {
      throw new ContinuationResponseLostError();
    }
    try {
      return successEnvelope(schema).parse(value).data;
    } catch {
      // C7: schema drift / 中間改変での Zod 失敗も terminal clear にせず、
      // C3 冪等 re-claim で回復できるよう ResponseLost と同じく secret 保持経路へ。
      throw new ContinuationResponseLostError();
    }
  };
  return {
    create: (input) => post("/api/auth/continuations", input, createResponseSchema),
    async deposit(continuationId, input) {
      const response = await fetchImpl(
        `/api/auth/continuations/${encodeURIComponent(continuationId)}/callback`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      if (response.status !== 204) throw new ContinuationHttpError(response.status);
    },
    claim: (continuationId, input) =>
      post(
        `/api/auth/continuations/${encodeURIComponent(continuationId)}/claim`,
        input,
        claimResponseSchema,
      ),
  };
}

export async function createAuthFlow(
  returnTo: string,
  api: ContinuationApi,
  storage: Storage,
  deps: FlowDeps = browserFlowDeps,
  sessionExchange: AuthFlow["sessionExchange"] = "supabase",
): Promise<AuthFlow> {
  const secret = base64url(deps.randomBytes(32));
  const state = base64url(deps.randomBytes(32));
  // C1: /login・/auth/callback 自己参照は flow/DB に載せない（fallback は welcome）
  const safeReturnTo = sanitizeLoginReturnPath(returnTo, "/welcome");
  const created = await api.create({ state, secret, returnTo: safeReturnTo });
  const clientNow = deps.now();
  const clockSkewMs = estimateAuthClockSkewMs(
    clientNow.getTime(),
    created.expiresAt,
    defaultAuthContinuationTtlMs,
  );
  const flow = authFlowSchema.parse({
    id: created.id,
    secret,
    state,
    origin: window.location.origin,
    returnTo: safeReturnTo,
    sessionExchange,
    startedAt: clientNow.toISOString(),
    // サーバ絶対期限を保持し、ローカル clock rebase 時にクリップする（C13）
    expiresAt: created.expiresAt,
    // C6: 進みすぎクライアント時計での早期 secret 消去を抑える
    ...(clockSkewMs === 0 ? {} : { clockSkewMs }),
  });
  try {
    storage.setItem(`${flowPrefix}${flow.id}`, JSON.stringify(flow));
  } catch {
    // C15: 永続化失敗時は秘密をメモリにも残さない（呼び出し側は開始失敗として扱う）。
    // サーバ行の即時取消 RPC は無いため TTL 掃除に委ねる（孤児行は秘密ハッシュのみ）。
    throw new Error("auth_flow_persist_failed");
  }
  return flow;
}
