import { describe, expect, it } from "vitest";
import {
  clearAuthFlow,
  ContinuationResponseLostError,
  createContinuationApi,
  createAuthFlow,
  estimateAuthClockSkewMs,
  isAuthContinuationCallbackOwned,
  isAuthSelfReturnPath,
  listUnexpiredAuthFlows,
  markAuthContinuationCallbackOwner,
  ownedAuthStoragePrefixes,
  readAuthContinuationCallbackStartedAt,
  readAuthFlow,
  sanitizeLoginReturnPath,
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

  it("C1: login return path drops auth self-references", () => {
    expect(isAuthSelfReturnPath("/login")).toBe(true);
    expect(isAuthSelfReturnPath("/login?x=1")).toBe(true);
    expect(isAuthSelfReturnPath("/auth/callback")).toBe(true);
    expect(isAuthSelfReturnPath("/auth/callback?flow=1")).toBe(true);
    expect(isAuthSelfReturnPath("/planner")).toBe(false);
    expect(sanitizeLoginReturnPath("/login")).toBe("/welcome");
    expect(sanitizeLoginReturnPath("/auth/callback?flow=1")).toBe("/welcome");
    expect(sanitizeLoginReturnPath("/pantry")).toBe("/pantry");
  });

  it("U1-M1 rejects protocol-relative and embedded // when reading a tampered flow", () => {
    const storage = new MapStorage();
    const flowId = "10000000-0000-4000-8000-000000000099";
    const base = {
      id: flowId,
      secret: "A".repeat(43),
      state: "B".repeat(43),
      origin: "https://app.test",
      sessionExchange: "supabase" as const,
      startedAt: "2026-07-13T00:00:00.000Z",
    };
    storage.setItem(
      `kondate.auth.flow.${flowId}`,
      JSON.stringify({ ...base, returnTo: "//evil.example" }),
    );
    expect(readAuthFlow(flowId, storage)).toBeNull();
    storage.setItem(
      `kondate.auth.flow.${flowId}`,
      JSON.stringify({ ...base, returnTo: "/planner//x" }),
    );
    expect(readAuthFlow(flowId, storage)).toBeNull();
    storage.setItem(
      `kondate.auth.flow.${flowId}`,
      JSON.stringify({ ...base, returnTo: "/planner" }),
    );
    expect(readAuthFlow(flowId, storage)).toMatchObject({ returnTo: "/planner" });
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
    const markerKey = `kondate.auth.supabase.clock-rebase.${flowId}`;
    const ownerKey = `kondate.auth.supabase.callback-owner.${flowId}`;
    writeFlow(storage, flowId, "2026-07-13T00:10:00.000Z");
    storage.setItem(ownerKey, "2026-07-13T00:10:00.000Z");

    expect(
      listUnexpiredAuthFlows(storage, new Date("2026-07-13T00:00:00.000Z"), 300_000),
    ).toHaveLength(1);
    expect(readAuthFlow(flowId, storage)?.startedAt).toBe("2026-07-13T00:00:00.000Z");
    expect(storage.getItem(ownerKey)).toBe("2026-07-13T00:00:00.000Z");
    expect(JSON.parse(storage.getItem(markerKey) ?? "null")).toEqual({
      rebasedAt: "2026-07-13T00:00:00.000Z",
      deadlineAt: "2026-07-13T00:05:00.000Z",
    });
    expect(
      listUnexpiredAuthFlows(storage, new Date("2026-07-13T00:05:00.000Z"), 300_000),
    ).toHaveLength(1);
    expect(listUnexpiredAuthFlows(storage, new Date("2026-07-13T00:05:00.001Z"), 300_000)).toEqual(
      [],
    );
  });

  it("fails closed instead of rebasing again after a second clock rollback", () => {
    const storage = new MapStorage();
    const flowId = "10000000-0000-4000-8000-000000000001";
    const markerKey = `kondate.auth.supabase.clock-rebase.${flowId}`;
    const ownerKey = `kondate.auth.supabase.callback-owner.${flowId}`;
    writeFlow(storage, flowId, "2026-07-13T00:10:00.000Z");
    storage.setItem(ownerKey, "2026-07-13T00:10:00.000Z");

    expect(
      listUnexpiredAuthFlows(storage, new Date("2026-07-13T00:00:00.000Z"), 300_000),
    ).toHaveLength(1);
    expect(listUnexpiredAuthFlows(storage, new Date("2026-07-12T23:59:59.999Z"), 300_000)).toEqual(
      [],
    );
    expect(storage.getItem(`kondate.auth.flow.${flowId}`)).toBeNull();
    expect(storage.getItem(ownerKey)).toBeNull();
    expect(storage.getItem(markerKey)).toBeNull();
  });

  it("fails closed for a corrupt rebase marker or marker write failure", () => {
    const flowId = "10000000-0000-4000-8000-000000000001";
    const markerKey = `kondate.auth.supabase.clock-rebase.${flowId}`;
    const corruptStorage = new MapStorage();
    writeFlow(corruptStorage, flowId, "2026-07-13T00:00:00.000Z");
    corruptStorage.setItem(markerKey, '{"rebasedAt":"invalid"}');

    expect(
      listUnexpiredAuthFlows(corruptStorage, new Date("2026-07-13T00:01:00.000Z"), 300_000),
    ).toEqual([]);
    expect(corruptStorage.length).toBe(0);

    const failingStorage = new MarkerWriteFailingStorage(markerKey);
    writeFlow(failingStorage, flowId, "2026-07-13T00:10:00.000Z");
    expect(() =>
      listUnexpiredAuthFlows(failingStorage, new Date("2026-07-13T00:00:00.000Z"), 300_000),
    ).not.toThrow();
    expect(failingStorage.length).toBe(0);
  });

  it("normalizes callback-only ownership to the fixed flow deadline", () => {
    const storage = new MapStorage();
    const flowId = "10000000-0000-4000-8000-000000000001";
    writeFlow(storage, flowId, "2026-07-13T00:10:00.000Z");

    expect(
      markAuthContinuationCallbackOwner(
        flowId,
        storage,
        new Date("2026-07-13T00:00:00.000Z"),
        300_000,
      ),
    ).toBe(true);
    expect(
      readAuthContinuationCallbackStartedAt(
        flowId,
        storage,
        new Date("2026-07-13T00:00:00.000Z"),
        300_000,
      ),
    ).toBe("2026-07-13T00:00:00.000Z");
    expect(readAuthFlow(flowId, storage)?.startedAt).toBe("2026-07-13T00:00:00.000Z");
    clearAuthFlow(flowId, storage);
    expect(storage.length).toBe(0);
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

  it("C13 clips rebased local deadline to server expiresAt when known", () => {
    const storage = new MapStorage();
    const flowId = "10000000-0000-4000-8000-000000000001";
    const markerKey = `kondate.auth.supabase.clock-rebase.${flowId}`;
    // クライアント startedAt は未来、サーバ expires は now+120s（フル TTL 300s より短い）
    writeFlow(storage, flowId, "2026-07-13T00:10:00.000Z", "2026-07-13T00:02:00.000Z");

    expect(
      listUnexpiredAuthFlows(storage, new Date("2026-07-13T00:00:00.000Z"), 300_000),
    ).toHaveLength(1);
    // rebasedAt = deadline - ttl = 00:02 - 5m = 23:57 previous day
    expect(readAuthFlow(flowId, storage)?.startedAt).toBe("2026-07-12T23:57:00.000Z");
    expect(JSON.parse(storage.getItem(markerKey) ?? "null")).toEqual({
      rebasedAt: "2026-07-12T23:57:00.000Z",
      deadlineAt: "2026-07-13T00:02:00.000Z",
    });
    // サーバ期限ちょうどはまだ有効、直後は落とす（フル TTL まで延命しない）
    expect(
      listUnexpiredAuthFlows(storage, new Date("2026-07-13T00:02:00.000Z"), 300_000),
    ).toHaveLength(1);
    expect(listUnexpiredAuthFlows(storage, new Date("2026-07-13T00:02:00.001Z"), 300_000)).toEqual(
      [],
    );
  });

  it("C13 expires a non-rebased flow when server expiresAt has passed", () => {
    const storage = new MapStorage();
    const flowId = "10000000-0000-4000-8000-000000000001";
    writeFlow(storage, flowId, "2026-07-13T00:00:00.000Z", "2026-07-13T00:01:00.000Z");
    // ローカル age は 90s < 300s だがサーバ期限超過 → 削除
    expect(listUnexpiredAuthFlows(storage, new Date("2026-07-13T00:01:30.000Z"), 300_000)).toEqual(
      [],
    );
    expect(storage.getItem(`kondate.auth.flow.${flowId}`)).toBeNull();
  });

  it("C6 keeps secret when client clock is ahead but skew-adjusted deadline remains", () => {
    const storage = new MapStorage();
    const flowId = "10000000-0000-4000-8000-000000000001";
    // 壁時計は 00:10。startedAt/expires は 00:00〜00:05。skew=+10m なら adjusted now=00:00 で有効。
    const skewMs = 10 * 60 * 1_000;
    writeFlow(storage, flowId, "2026-07-13T00:00:00.000Z", "2026-07-13T00:05:00.000Z", skewMs);
    expect(
      listUnexpiredAuthFlows(storage, new Date("2026-07-13T00:10:00.000Z"), 300_000),
    ).toHaveLength(1);
    expect(readAuthFlow(flowId, storage)?.secret).toBe("A".repeat(43));
    // skew 補正後もサーバ期限を超えたら消す
    expect(listUnexpiredAuthFlows(storage, new Date("2026-07-13T00:16:00.000Z"), 300_000)).toEqual(
      [],
    );
  });

  it("C6 estimates positive skew when client now is ahead of server implied now", () => {
    // expiresAt = clientNow 相当だが ttl=5m なら implied server now は 5m 前 → skew ≈ +5m
    const clientNow = Date.parse("2026-07-13T00:05:00.000Z");
    const expiresAt = "2026-07-13T00:05:00.000Z";
    expect(estimateAuthClockSkewMs(clientNow, expiresAt, 300_000)).toBe(300_000);
  });

  it("C13 keeps full local TTL when server expiresAt is unknown", async () => {
    const storage = new MapStorage();
    const api = continuationApiMock();
    // create 応答に expiresAt はあるが、storage 直書きの旧 flow は expires 無し
    writeFlow(storage, "10000000-0000-4000-8000-000000000001", "2026-07-13T00:10:00.000Z");
    expect(
      listUnexpiredAuthFlows(storage, new Date("2026-07-13T00:00:00.000Z"), 300_000),
    ).toHaveLength(1);
    expect(
      listUnexpiredAuthFlows(storage, new Date("2026-07-13T00:05:00.000Z"), 300_000),
    ).toHaveLength(1);
    expect(listUnexpiredAuthFlows(storage, new Date("2026-07-13T00:05:00.001Z"), 300_000)).toEqual(
      [],
    );

    // createAuthFlow は create 応答の expiresAt を flow に保存する
    const flow = await createAuthFlow("/planner", api, new MapStorage(), fixedFlowDeps);
    expect(flow.expiresAt).toBe("2026-07-11T00:05:00Z");
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

it("R1: claim 2xx with unreadable body surfaces ContinuationResponseLostError", async () => {
  // HTTP 成功後の body 欠落は burn 済み近似の印対象（素の TypeError と区別）
  const api = createContinuationApi(() => {
    const response = {
      ok: true,
      status: 200,
      json: () => {
        throw new TypeError("body stream interrupted after 2xx");
      },
    };
    return Promise.resolve(response as unknown as Response);
  });

  await expect(
    api.claim("10000000-0000-4000-8000-000000000001", {
      secret: "A".repeat(43),
      state: "B".repeat(43),
    }),
  ).rejects.toBeInstanceOf(ContinuationResponseLostError);
});

it("C8: claim response schema rejects protocol-relative returnTo before sanitize", async () => {
  const api = createContinuationApi(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          ok: true,
          data: { code: "auth-code", returnTo: "//evil.example" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  );

  await expect(
    api.claim("10000000-0000-4000-8000-000000000001", {
      secret: "A".repeat(43),
      state: "B".repeat(43),
    }),
  ).rejects.toBeInstanceOf(ContinuationResponseLostError);
});

it("C7: claim 2xx with Zod parse failure surfaces ContinuationResponseLostError", async () => {
  const api = createContinuationApi(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          ok: true,
          data: { code: "auth-code", returnTo: "//evil.example" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  );

  await expect(
    api.claim("10000000-0000-4000-8000-000000000001", {
      secret: "A".repeat(43),
      state: "B".repeat(43),
    }),
  ).rejects.toBeInstanceOf(ContinuationResponseLostError);
});

it("C8: claim response schema rejects backslash and control characters in returnTo", async () => {
  for (const returnTo of ["/foo\\bar", "/planner\u0000x"]) {
    const api = createContinuationApi(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true, data: { code: "auth-code", returnTo } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(
      api.claim("10000000-0000-4000-8000-000000000001", {
        secret: "A".repeat(43),
        state: "B".repeat(43),
      }),
    ).rejects.toBeInstanceOf(ContinuationResponseLostError);
  }
});

class MapStorage implements Storage {
  protected readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

class MarkerWriteFailingStorage extends MapStorage {
  constructor(private readonly markerKey: string) {
    super();
  }

  override setItem(key: string, value: string): void {
    if (key === this.markerKey) throw new Error("marker write failed");
    super.setItem(key, value);
  }
}

function writeFlow(
  storage: Storage,
  flowId: string,
  startedAt: string,
  expiresAt?: string,
  clockSkewMs?: number,
): void {
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
      ...(expiresAt === undefined ? {} : { expiresAt }),
      ...(clockSkewMs === undefined ? {} : { clockSkewMs }),
    }),
  );
}
