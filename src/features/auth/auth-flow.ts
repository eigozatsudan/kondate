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

/**
 * claim 後に IdP 資格をどうセッションへ換えるか。
 * - authorization_code: OAuth / 旧 magic（GET /verify → code）の PKCE exchange
 * - token_hash: アプリ着地 magic（GET では消費しない）。verifyOtp(POST) で換える
 */
const authFlowCredentialKindSchema = z.enum(["authorization_code", "token_hash"]);

const authFlowSchema = z
  .object({
    id: z.uuid(),
    secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    state: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    origin: z.url(),
    returnTo: authFlowReturnToSchema,
    sessionExchange: z.enum(["supabase", "oauth_mock"]),
    // 旧 localStorage 行は無い → authorization_code（OAuth / 旧 verify リンク）
    credentialKind: authFlowCredentialKindSchema.optional().default("authorization_code"),
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
const legacyAuthFlowSchema = authFlowSchema
  .omit({ sessionExchange: true, credentialKind: true })
  .strict();
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
/**
 * C3: URL strip 後も 429/5xx 再 deposit できるよう、同一ブラウザに短寿命で code を保持する。
 * owned prefix 配下なので logout の clearOwnedAuthStorage で消える。
 * cold-start fail-closed（RR1）は session キーのみ消し pending は温存。
 * soft 失効（clearSoftSessionResidualBestEffort）は pending を消す（共有端末 code 残渣 — C3）。
 */
const pendingDepositPrefix = `${ownedAuthStoragePrefixes[1]}.pending-deposit.`;
/**
 * C3: cancel UI / 期限切れ二次 UI 後にユーザーが明示再開するまで
 * 同一 flow の遅延 success を silent complete しない印。
 * secret は焼かない（C5 DoS 縮退ロック）。owned prefix 配下で logout 掃除される。
 */
const userDismissedPrefix = `${ownedAuthStoragePrefixes[1]}.flow-user-dismissed.`;
/**
 * C-R3: storage setItem 失敗時も page lifetime で dismiss を fail-closed に保つ。
 * secret は焼かない（C5 DoS ロック維持）。他タブは storage 印または TTL に依存。
 */
const dismissedFlowIdsMemory = new Set<string>();
/**
 * C-R8: storage setItem が失敗しても、**既に開いている他タブ**へ dismiss を best-effort 伝播する。
 * sessionStorage は tab group 非共有で弱い。BroadcastChannel は open tabs のみ（後から開いたタブは
 * storage 成功または continuation TTL に依存 — design residual）。
 */
const AUTH_FLOW_DISMISS_BROADCAST_CHANNEL = "kondate.auth.flow-user-dismissed";
let dismissBroadcastListenerStarted = false;

function ensureAuthFlowDismissBroadcastListener(): void {
  if (dismissBroadcastListenerStarted) return;
  if (typeof BroadcastChannel === "undefined") return;
  dismissBroadcastListenerStarted = true;
  try {
    const channel = new BroadcastChannel(AUTH_FLOW_DISMISS_BROADCAST_CHANNEL);
    channel.onmessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null) return;
      if (!("flowId" in data)) return;
      const flowId: unknown = Reflect.get(data, "flowId");
      if (typeof flowId !== "string" || flowId === "") return;
      dismissedFlowIdsMemory.add(flowId);
    };
  } catch {
    // BroadcastChannel 不可環境は memory + storage のみ
  }
}

function broadcastAuthFlowUserDismissed(flowId: string): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(AUTH_FLOW_DISMISS_BROADCAST_CHANNEL);
    channel.postMessage({ flowId });
    channel.close();
  } catch {
    // best-effort（受信側 listener 未起動・環境非対応は TTL に収束）
  }
}

const defaultAuthContinuationTtlMs = 300_000;
/**
 * C6: deposit API（`auth-continuation-deposit` authorizationCodeSchema.max(512)）と揃える。
 * pending / claim が 2048 だけ広いと deposit 400 → re-deposit ループになる。
 */
export const AUTH_CONTINUATION_CODE_MAX_LENGTH = 512;
/** C6: create 時 skew の異常値をクリップ（手動時刻の極端なズレでも無限延命しない） */
const MAX_ABS_CLOCK_SKEW_MS = 48 * 60 * 60 * 1_000;

const pendingDepositSchema = z
  .object({
    state: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    // IdP code 長はプロバイダ差がある。deposit API と同上限（C6）。
    code: z.string().min(1).max(AUTH_CONTINUATION_CODE_MAX_LENGTH),
    // Zod v4 では number 既定が有限値のみ（.finite() は no-op かつ deprecated）
    expiresAtMs: z.number(),
  })
  .strict();

export type PendingAuthDeposit = z.infer<typeof pendingDepositSchema>;

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
 * AuthProvider の login surface（`/login` exact と `/login/` 接頭）と揃え、
 * sanitize 後の trailing slash / query / hash も自己参照として落とす（C6）。
 */
export function isAuthSelfReturnPath(path: string): boolean {
  return (
    path === "/login" ||
    path.startsWith("/login?") ||
    path.startsWith("/login/") ||
    path.startsWith("/login#") ||
    path.startsWith("/auth/callback")
  );
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
      const migrated: AuthFlow = {
        ...legacy.data,
        sessionExchange: "supabase",
        credentialKind: "authorization_code",
      };
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
    // C3: cancel UI 後の dismiss 済みは residual recovery / multi-flow 列挙から外す
    if (isAuthFlowUserDismissed(id, storage)) continue;
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
 * C9 / C12: hangWatchdog / completion wait の remaining を安全側で算出する。
 *
 * - 負 skew: adjusted が wall より進む → 短い remaining（早期失効）
 * - 正 skew（正当な進みすぎ時計 or 改ざん）: wall 基準を上限にし、
 *   lease TTL（wall `Date.now()`）より長く待たない。改ざん +48h で watchdog が
 *   サーバ期限後まで延命する非対称を閉じる。
 *
 * 正当なクライアント進み時計では wall がサーバ期限に先に達し得る（最大 skew 相当の
 * 早期発火）。秘密の期限後長期残存より安全側を優先する。
 */
export function authDeadlineRemainingMs(
  deadlineMs: number,
  wallNowMs: number,
  clockSkewMs?: number | null,
): number {
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(wallNowMs)) return 0;
  const adjustedNowMs = adjustedAuthNowMs(wallNowMs, clockSkewMs);
  return Math.max(0, Math.min(deadlineMs - adjustedNowMs, deadlineMs - wallNowMs));
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
    // C9: サーバ絶対期限は wall で hard cap。storage 改ざんの正 skew で
    // サーバ expires 後もローカル secret が残る経路を閉じる（安全側・早期失効）。
    if (serverExpiresMs !== null && wallNowMs > serverExpiresMs) {
      clearAuthFlowClockState(flowId, storage);
      return null;
    }

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
    `${pendingDepositPrefix}${flowId}`,
    `${userDismissedPrefix}${flowId}`,
  ]) {
    try {
      storage.removeItem(key);
    } catch {
      // fail-closed cleanupは他の保存値の削除を続け、個別Storage失敗を外へ漏らさない。
    }
  }
  // C-R3: storage 印と memory 印を同期して落とす（restart clear 後に dismiss が残らない）
  dismissedFlowIdsMemory.delete(flowId);
}

/**
 * C3: cancel / 期限切れ UI 後のユーザー明示 dismiss。
 * secret は残すが completeCallback / residual recovery は当該 flow を拾わない。
 * C-R3: setItem 失敗でも memory 印で同一ページの遅延 success を拒否する。
 * C-R8: BroadcastChannel で open tabs へ memory 印を best-effort 伝播（storage 全滅時の cross-tab 窓を縮める）。
 */
export function markAuthFlowUserDismissed(
  flowId: string,
  storage: Storage = window.localStorage,
): void {
  if (flowId === "") return;
  ensureAuthFlowDismissBroadcastListener();
  dismissedFlowIdsMemory.add(flowId);
  broadcastAuthFlowUserDismissed(flowId);
  try {
    storage.setItem(`${userDismissedPrefix}${flowId}`, "1");
  } catch {
    // storage 障害: memory + BroadcastChannel で complete/resume を拒否（TTL / 明示 logout も併用）
  }
}

/** C3: dismiss 済み flow か（残存 secret があっても silent complete しない） */
export function isAuthFlowUserDismissed(
  flowId: string,
  storage: Storage = window.localStorage,
): boolean {
  if (flowId === "") return false;
  // 受信側タブも complete/resume 前に listener を立てる（C-R8）
  ensureAuthFlowDismissBroadcastListener();
  // C-R3: memory を優先（setItem 失敗・getItem 失敗でも同一タブでは dismiss 扱い）
  if (dismissedFlowIdsMemory.has(flowId)) return true;
  try {
    return storage.getItem(`${userDismissedPrefix}${flowId}`) !== null;
  } catch {
    // storage 読めないが memory にも無い → 可用性優先（未 dismiss）
    return false;
  }
}

/** テスト専用: page-lifetime dismiss memory / BroadcastChannel listener 起動フラグを隔離する */
export function resetAuthFlowUserDismissedMemoryForTests(): void {
  dismissedFlowIdsMemory.clear();
  // 次の mark/isAuth で現在の BroadcastChannel 実装に再接続できるようにする（C-R8 テスト用）
  dismissBroadcastListenerStarted = false;
}

/**
 * C1: ログイン完了後に他 flow の unexpired secret を捨てる。
 * multi-flow 併存（C6 再送温存）× soft residual 後の residual recovery が
 * **別ユーザー**になり得る flow を拾う経路を閉じる。
 * 完了済み flow 自身は publish 側で clear 済みでもよい（冪等）。
 */
export function clearSiblingUnexpiredAuthFlows(
  completedFlowId: string,
  storage: Storage,
  now: Date = new Date(),
  ttlMs = defaultAuthContinuationTtlMs,
): void {
  for (const flow of listUnexpiredAuthFlows(storage, now, ttlMs)) {
    if (flow.id === completedFlowId) continue;
    clearAuthFlow(flow.id, storage);
  }
}

/**
 * C3: completeCallback が deposit 前に code を短寿命保存する。
 * recovery / resumeFlow が transient 尽きたあとも re-deposit できる。
 * expiresAtMs は continuation TTL と揃える（期限後は読まない）。
 */
export function writePendingAuthDeposit(
  flowId: string,
  pending: PendingAuthDeposit,
  storage: Storage,
): void {
  const parsed = pendingDepositSchema.safeParse(pending);
  if (!parsed.success) return;
  try {
    storage.setItem(`${pendingDepositPrefix}${flowId}`, JSON.stringify(parsed.data));
  } catch {
    // quota 等ではメモリ上の completeCallback 再試行のみに依存する
  }
}

/**
 * C3: 未失効の pending deposit を読む。壊れている・期限切れは削除して null。
 * C15: 期限判定の nowMs は呼び出し側で `adjustedAuthNowMs(Date.now(), flow.clockSkewMs)` を渡すこと。
 * flow deadline / hangWatchdog と同型にし、進みすぎクライアント時計で re-deposit キャッシュが先に落ちないようにする。
 * 既定の Date.now() は skew 未知（テスト・単独読取）向け。
 */
export function readPendingAuthDeposit(
  flowId: string,
  storage: Storage,
  nowMs: number = Date.now(),
): PendingAuthDeposit | null {
  try {
    const raw = storage.getItem(`${pendingDepositPrefix}${flowId}`);
    if (raw === null) return null;
    const parsed = pendingDepositSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) {
      storage.removeItem(`${pendingDepositPrefix}${flowId}`);
      return null;
    }
    if (parsed.data.expiresAtMs <= nowMs) {
      storage.removeItem(`${pendingDepositPrefix}${flowId}`);
      return null;
    }
    return parsed.data;
  } catch {
    try {
      storage.removeItem(`${pendingDepositPrefix}${flowId}`);
    } catch {
      // ignore
    }
    return null;
  }
}

export function clearPendingAuthDeposit(flowId: string, storage: Storage): void {
  try {
    storage.removeItem(`${pendingDepositPrefix}${flowId}`);
  } catch {
    // TTL で収束
  }
}

/**
 * Browser Supabase の session 永続キー（createBrowserSupabaseClient の storageKey と一致）。
 * ownedAuthStoragePrefixes[1] と同じ文字列だが、logout の prefix 一掃ではなく **exact key** として扱う。
 */
export const browserSupabaseSessionStorageKey = ownedAuthStoragePrefixes[1];

/**
 * C5 / RR1: cold-start fail-closed 専用。session 永続キーだけを消す。
 * clearOwnedAuthStorage は flow secret / pending-deposit / callback-owner まで origin 共有領域から
 * 一掃するため、他タブの進行中ログインを unbound にする（RR1）。logout 経路は従来どおり全所有キー。
 */
export function clearBrowserSupabaseSessionStorage(storage: Storage): void {
  try {
    storage.removeItem(browserSupabaseSessionStorageKey);
  } catch {
    // best-effort（storage 障害でも呼び出し側の UI 解放を妨げない）
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
   * secret を渡すと同じブラウザ所有者として毒を上書きできる（C2 owner overwrite）。
   * secret 無し（WebView 等）は未 claim なら last-wins（R1 residual-intentional:
   * 正当 deposit 後の後着毒も上書きし得る可用性 DoS。first-wins は C2 再発のため採用しない）。
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
    // C6: deposit max(512) と揃える（長く受けすぎて client だけ成功にしない）
    code: z.string().min(1).max(AUTH_CONTINUATION_CODE_MAX_LENGTH),
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
  /**
   * magic link は token_hash（アプリ着地・POST 消費）。
   * Google OAuth は authorization_code（既定）。
   */
  credentialKind: AuthFlow["credentialKind"] = "authorization_code",
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
    credentialKind,
    startedAt: clientNow.toISOString(),
    // サーバ絶対期限を保持し、ローカル clock rebase 時にクリップする（C13）
    expiresAt: created.expiresAt,
    // C6: 進みすぎクライアント時計での早期 secret 消去を抑える
    ...(clockSkewMs === 0 ? {} : { clockSkewMs }),
  });
  try {
    storage.setItem(`${flowPrefix}${flow.id}`, JSON.stringify(flow));
  } catch {
    // C11 / 旧 C15: 永続化失敗時は秘密をメモリにも残さない（呼び出し側は開始失敗として扱う）。
    // ContinuationApi に cancel は無く、サーバ行の即時取消はできない。
    // 孤児行は state/secret ハッシュのみ（平文秘密なし）で expires_at TTL 掃除に委ねる。
    // create レート枠は消費されるが、秘密漏洩面は無い（residual-intentional / TTL）。
    throw new Error("auth_flow_persist_failed");
  }
  return flow;
}
