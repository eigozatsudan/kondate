import { describe, expect, it } from "vitest";
import {
  clearAuthFlow,
  createContinuationApi,
  createAuthFlow,
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

  it("clears a legacy flow without an explicit session exchange target", () => {
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

    expect(readAuthFlow(flowId, storage)).toBeNull();
    expect(storage.getItem(`kondate.auth.flow.${flowId}`)).toBeNull();
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
