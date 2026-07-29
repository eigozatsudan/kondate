import { describe, expect, it } from "vitest";
import {
  clearAuthFlow,
  createContinuationApi,
  createAuthFlow,
  isAuthContinuationCallbackOwned,
  listUnexpiredAuthFlows,
  ownedAuthStoragePrefixes,
  readAuthFlow,
  sanitizeReturnPath,
} from "./auth-flow";

const fixedFlowDeps = {
  randomBytes: () => new Uint8Array(32).fill(7),
  now: () => new Date("2026-07-11T00:00:00Z"),
};
const continuationApiMock = () => ({
  lastCreateInput: null as null | { state: string; secret: string; returnTo: string },
  create(input: { state: string; secret: string; returnTo: string }) {
    this.lastCreateInput = input;
    return Promise.resolve({
      id: "10000000-0000-4000-8000-000000000001",
      expiresAt: "2026-07-11T00:05:00Z",
    });
  },
  deposit() {
    return Promise.resolve();
  },
  claim() {
    return Promise.reject(new Error("not deposited"));
  },
});

describe("auth flow storage", () => {
  it("keeps the locked owned storage prefixes", () => {
    expect(ownedAuthStoragePrefixes).toEqual(["kondate.auth.flow.", "kondate.auth.supabase"]);
  });
  it("accepts only same-origin path values", () => {
    expect(sanitizeReturnPath("/planner?resume=1")).toBe("/planner?resume=1");
    expect(sanitizeReturnPath("https://attacker.example")).toBe("/planner");
    expect(sanitizeReturnPath("//attacker.example")).toBe("/planner");
  });
  it("allows bare root for RootEntry and rejects path-collapse open redirects", () => {
    // B-I5: "/" は RootEntry（welcome/planner 分岐）へ戻す
    expect(sanitizeReturnPath("/")).toBe("/");
    // B-I3: collapse 後に "//…" になる入力は拒否
    expect(sanitizeReturnPath("/planner/..//evil.example")).toBe("/planner");
    expect(sanitizeReturnPath("/x/..//evil.example")).toBe("/planner");
  });

  it("keeps the claim secret only in the initiating browser", async () => {
    const shared = new MapStorage();
    const isolated = new MapStorage();
    const api = continuationApiMock();
    const flow = await createAuthFlow("/onboarding", api, shared, fixedFlowDeps);
    expect(readAuthFlow(flow.id, shared)).toEqual(flow);
    expect(readAuthFlow(flow.id, isolated)).toBeNull();
    expect(api.lastCreateInput).not.toHaveProperty("verifier");
    shared.setItem(`kondate.auth.supabase.callback-owner.${flow.id}`, flow.startedAt);
    clearAuthFlow(flow.id, shared);
    expect(readAuthFlow(flow.id, shared)).toBeNull();
    expect(shared.getItem(`kondate.auth.supabase.callback-owner.${flow.id}`)).toBeNull();
  });

  it("migrates a legacy flow to the Supabase session exchange target", () => {
    const storage = new MapStorage();
    const flowId = "10000000-0000-4000-8000-000000000001";
    storage.setItem(
      `kondate.auth.flow.${flowId}`,
      JSON.stringify({
        id: flowId,
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "https://app.test",
        returnTo: "/onboarding",
        startedAt: "2026-07-13T00:00:00.000Z",
      }),
    );

    expect(readAuthFlow(flowId, storage)).toMatchObject({
      id: flowId,
      sessionExchange: "supabase",
    });
    expect(JSON.parse(storage.getItem(`kondate.auth.flow.${flowId}`) ?? "null")).toMatchObject({
      id: flowId,
      sessionExchange: "supabase",
    });
  });

  it("rebases a future flow once and retains it for at most one TTL", () => {
    const storage = new MapStorage();
    const flowId = "10000000-0000-4000-8000-000000000001";
    storage.setItem(
      `kondate.auth.flow.${flowId}`,
      JSON.stringify({
        id: flowId,
        secret: "A".repeat(43),
        state: "B".repeat(43),
        origin: "https://app.test",
        returnTo: "/planner",
        sessionExchange: "supabase",
        startedAt: "2026-07-13T00:10:00.000Z",
      }),
    );

    expect(
      listUnexpiredAuthFlows(storage, new Date("2026-07-13T00:00:00.000Z"), 300_000),
    ).toHaveLength(1);
    expect(readAuthFlow(flowId, storage)?.startedAt).toBe("2026-07-13T00:00:00.000Z");
    expect(listUnexpiredAuthFlows(storage, new Date("2026-07-13T00:05:00.001Z"), 300_000)).toEqual(
      [],
    );
  });

  it("rebases future callback ownership without crossing its TTL boundary", () => {
    const storage = new MapStorage();
    const flowId = "10000000-0000-4000-8000-000000000001";
    const ownerKey = `kondate.auth.supabase.callback-owner.${flowId}`;
    storage.setItem(ownerKey, "2026-07-13T00:10:00.000Z");

    expect(
      isAuthContinuationCallbackOwned(
        flowId,
        storage,
        new Date("2026-07-13T00:00:00.000Z"),
        300_000,
      ),
    ).toBe(true);
    expect(storage.getItem(ownerKey)).toBe("2026-07-13T00:00:00.000Z");
    expect(
      isAuthContinuationCallbackOwned(
        flowId,
        storage,
        new Date("2026-07-13T00:05:00.001Z"),
        300_000,
      ),
    ).toBe(false);
  });

  it("removes non-finite and over-TTL flow and callback timestamps", () => {
    const storage = new MapStorage();
    const invalidFlowId = "10000000-0000-4000-8000-000000000001";
    const expiredFlowId = "10000000-0000-4000-8000-000000000002";
    for (const [flowId, startedAt] of [
      [invalidFlowId, "invalid"],
      [expiredFlowId, "2026-07-12T23:54:59.999Z"],
    ] as const) {
      storage.setItem(
        `kondate.auth.flow.${flowId}`,
        JSON.stringify({
          id: flowId,
          secret: "A".repeat(43),
          state: "B".repeat(43),
          origin: "https://app.test",
          returnTo: "/planner",
          sessionExchange: "supabase",
          startedAt,
        }),
      );
    }
    const invalidOwnerId = "10000000-0000-4000-8000-000000000003";
    const expiredOwnerId = "10000000-0000-4000-8000-000000000004";
    storage.setItem(`kondate.auth.supabase.callback-owner.${invalidOwnerId}`, "invalid");
    storage.setItem(
      `kondate.auth.supabase.callback-owner.${expiredOwnerId}`,
      "2026-07-12T23:54:59.999Z",
    );
    const now = new Date("2026-07-13T00:00:00.000Z");

    expect(listUnexpiredAuthFlows(storage, now, 300_000)).toEqual([]);
    expect(isAuthContinuationCallbackOwned(invalidOwnerId, storage, now, 300_000)).toBe(false);
    expect(isAuthContinuationCallbackOwned(expiredOwnerId, storage, now, 300_000)).toBe(false);
    expect(storage.length).toBe(0);
  });
});

it("preserves an unavailable claim HTTP status without reading sensitive response details", async () => {
  const api = createContinuationApi(() => Promise.resolve(new Response(null, { status: 503 })));

  await expect(
    api.claim("10000000-0000-4000-8000-000000000001", {
      secret: "A".repeat(43),
      state: "B".repeat(43),
    }),
  ).rejects.toMatchObject({ status: 503 });
});

class MapStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length() {
    return this.#values.size;
  }

  clear() {
    this.#values.clear();
  }

  getItem(key: string) {
    return this.#values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.#values.delete(key);
  }

  setItem(key: string, value: string) {
    this.#values.set(key, value);
  }
}
