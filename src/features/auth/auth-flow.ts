import { z } from "zod";

const authFlowSchema = z
  .object({
    id: z.uuid(),
    secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    state: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    origin: z.url(),
    returnTo: z.string().startsWith("/"),
    startedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type AuthFlow = z.infer<typeof authFlowSchema>;

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

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function sanitizeReturnPath(value: string | null | undefined): string {
  if (value === undefined || value === null || !value.startsWith("/") || value.startsWith("//")) {
    return "/planner";
  }
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.origin === window.location.origin
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : "/planner";
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
    const parsed = authFlowSchema.safeParse(JSON.parse(raw));
    if (parsed.success && parsed.data.id === id) return parsed.data;
  } catch {
    // 破損したブラウザ保存値は秘密の再利用を防ぐため削除する。
  }
  storage.removeItem(key);
  return null;
}

export function clearAuthFlow(id: string, storage: Storage = window.localStorage): void {
  storage.removeItem(`${flowPrefix}${id}`);
}

export function listUnexpiredAuthFlows(storage: Storage, now: Date, ttlMs = 300_000): AuthFlow[] {
  const result: AuthFlow[] = [];
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
    (key): key is string => key?.startsWith(flowPrefix) === true,
  );
  for (const key of keys) {
    const id = key.slice(flowPrefix.length);
    const flow = readAuthFlow(id, storage);
    if (flow === null) continue;
    const age = now.getTime() - new Date(flow.startedAt).getTime();
    if (!Number.isFinite(age) || age < 0 || age > ttlMs) clearAuthFlow(id, storage);
    else result.push(flow);
  }
  return result.toSorted((left, right) => left.startedAt.localeCompare(right.startedAt));
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
    const value: unknown = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error("continuation_unavailable");
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
      if (response.status !== 204) throw new Error("continuation_unavailable");
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
    startedAt: deps.now().toISOString(),
  });
  storage.setItem(`${flowPrefix}${flow.id}`, JSON.stringify(flow));
  return flow;
}
