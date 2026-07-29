import { z } from "zod";

const authFlowSchema = z
  .object({
    id: z.uuid(),
    secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    state: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    origin: z.url(),
    returnTo: z.string().startsWith("/"),
    sessionExchange: z.enum(["supabase", "oauth_mock"]),
    startedAt: z.iso.datetime({ offset: true }),
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

export const ownedAuthStoragePrefixes = ["kondate.auth.flow.", "kondate.auth.supabase"] as const;

const flowPrefix = ownedAuthStoragePrefixes[0];
const callbackOwnerPrefix = `${ownedAuthStoragePrefixes[1]}.callback-owner.`;
const clockRebasePrefix = `${ownedAuthStoragePrefixes[1]}.clock-rebase.`;
const defaultAuthContinuationTtlMs = 300_000;

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
    return normalizeAuthClock(flowId, startedAt, storage, now, ttlMs, (rebasedAt) => {
      storage.setItem(`${callbackOwnerPrefix}${flowId}`, rebasedAt);
      const flow = readAuthFlow(flowId, storage);
      if (flow !== null) {
        storage.setItem(
          `${flowPrefix}${flowId}`,
          JSON.stringify({ ...flow, startedAt: rebasedAt }),
        );
      }
    });
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
    const normalized = normalizeAuthClock(id, flow.startedAt, storage, now, ttlMs, (rebasedAt) => {
      storage.setItem(key, JSON.stringify({ ...flow, startedAt: rebasedAt }));
      const ownerKey = `${callbackOwnerPrefix}${id}`;
      if (storage.getItem(ownerKey) !== null) storage.setItem(ownerKey, rebasedAt);
    });
    if (normalized !== null) result.push({ ...flow, startedAt: normalized });
  }
  return result.toSorted((left, right) => left.startedAt.localeCompare(right.startedAt));
}

function normalizeAuthClock(
  flowId: string,
  startedAt: string,
  storage: Storage,
  now: Date,
  ttlMs: number,
  persistRebase: (rebasedAt: string) => void,
): string | null {
  try {
    const nowMs = now.getTime();
    const startedAtMs = new Date(startedAt).getTime();
    if (!Number.isFinite(nowMs) || !Number.isFinite(startedAtMs) || !isValidTtl(ttlMs)) {
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
      const deadlineAtMs = new Date(marker.deadlineAt).getTime();
      if (nowMs < rebasedAtMs || nowMs > deadlineAtMs) {
        clearAuthFlowClockState(flowId, storage);
        return null;
      }
      return marker.rebasedAt;
    }

    const age = nowMs - startedAtMs;
    if (age > ttlMs) {
      clearAuthFlowClockState(flowId, storage);
      return null;
    }
    if (age >= 0) return startedAt;

    const marker: ClockRebaseMarker = {
      rebasedAt: now.toISOString(),
      deadlineAt: new Date(nowMs + ttlMs).toISOString(),
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
  deposit(continuationId: string, input: { state: string; code: string }): Promise<void>;
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

const createResponseSchema = z
  .object({ id: z.uuid(), expiresAt: z.iso.datetime({ offset: true }) })
  .strict();
const claimResponseSchema = z
  .object({ code: z.string().min(1).max(2_048), returnTo: z.string() })
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
    const value: unknown = response.status === 204 ? null : await response.json();
    return successEnvelope(schema).parse(value).data;
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
  const safeReturnTo = sanitizeReturnPath(returnTo);
  const created = await api.create({ state, secret, returnTo: safeReturnTo });
  const flow = authFlowSchema.parse({
    id: created.id,
    secret,
    state,
    origin: window.location.origin,
    returnTo: safeReturnTo,
    sessionExchange,
    startedAt: deps.now().toISOString(),
  });
  storage.setItem(`${flowPrefix}${flow.id}`, JSON.stringify(flow));
  return flow;
}
