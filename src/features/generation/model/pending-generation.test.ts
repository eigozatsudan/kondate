import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationCommand, GenerationStatusData } from "@shared/contracts/generation";
import { postGeneration } from "../api/generation-api";
import { generationReducer, type GenerationClientState } from "./generation-machine";
import {
  PENDING_GENERATION_TTL_MS,
  claimPendingGeneration,
  clearPendingGeneration,
  createPendingGeneration,
  pendingGenerationClaimFallbackLockKey,
  pendingGenerationClaimLockName,
  pendingGenerationSchema,
  pendingGenerationCommand,
  readPendingGeneration,
  savePendingGeneration,
  type PendingGeneration,
} from "./pending-generation";

const requireAccessTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth/session", () => ({ requireAccessToken: requireAccessTokenMock }));
vi.mock("@/shared/lib/supabase", () => ({ getBrowserSupabaseClient: () => ({}) }));

const KEY = "kondate:generation:v3";
const LEGACY_V2_KEY = "kondate:generation:v2";
const USER_ID = "40000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "40000000-0000-4000-8000-000000000002";
const IDEMPOTENCY_KEY = "10000000-0000-4000-8000-000000000001";
const STARTED_AT = "2026-07-11T00:00:00.000Z";
const quota = {
  consumed: false,
  remaining: 2,
  userDailyLimit: 3,
  limitKind: null,
  retryAt: null,
} as const;
const processing: GenerationStatusData = {
  status: "processing",
  idempotencyKey: IDEMPOTENCY_KEY,
  requestId: "50000000-0000-4000-8000-000000000001",
  startedAt: STARTED_AT,
  quota,
};

function makeCommand(kind: GenerationCommand["kind"]): GenerationCommand {
  const base = {
    idempotencyKey: IDEMPOTENCY_KEY,
    sourceMenuId: "60000000-0000-4000-8000-000000000001",
    changeReason: "simpler" as const,
    changeReasonCustom: null,
    privacyNoticeVersion: "2026-07-29.v1" as const,
    expiredPantryConfirmations: [],
  };
  if (kind === "new_menu") {
    return {
      commandVersion: "generation-command.v3",
      kind,
      qualityMode: false,
      request: {
        idempotencyKey: IDEMPOTENCY_KEY,
        draftId: "20000000-0000-4000-8000-000000000001",
        draftRevision: 3,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    };
  }
  if (kind === "regenerate_menu") {
    return { commandVersion: "generation-command.v3", kind, qualityMode: false, request: base };
  }
  return {
    commandVersion: "generation-command.v3",
    kind,
    qualityMode: false,
    request: { ...base, dishId: "70000000-0000-4000-8000-000000000001" },
  };
}

function memoryStorage(initial: string | null = null) {
  const map = new Map<string, string>();
  if (initial !== null) {
    map.set(KEY, initial);
  }
  return {
    getItem: vi.fn((k: string) => map.get(k) ?? null),
    setItem: vi.fn((k: string, next: string) => {
      map.set(k, next);
    }),
    removeItem: vi.fn((k: string) => {
      map.delete(k);
    }),
  };
}

function storedPending(overrides: Partial<PendingGeneration> = {}): PendingGeneration {
  return pendingGenerationSchema.parse({
    ...createPendingGeneration(makeCommand("new_menu"), USER_ID, () => new Date(STARTED_AT)),
    ...overrides,
  });
}

describe("pending generation storage", () => {
  beforeEach(() => {
    requireAccessTokenMock.mockReset();
    requireAccessTokenMock.mockResolvedValue("access-token");
  });

  it("writes the same owner-bound command before starting the POST", async () => {
    const order: string[] = [];
    const command = makeCommand("new_menu");
    const pending = createPendingGeneration(command, USER_ID, () => new Date(STARTED_AT));
    savePendingGeneration(pending, {
      setItem: (_key, value) => {
        order.push("saved");
        expect(JSON.parse(value)).toMatchObject({ ownerUserId: USER_ID, ...command });
        expect(value).not.toContain("email");
        expect(value).not.toContain("allerg");
        expect(value).not.toContain("prompt");
      },
    });
    await postGeneration(pendingGenerationCommand(pending), {
      fetchImpl: () => {
        order.push("posted");
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: processing })));
      },
    });
    expect(order).toEqual(["saved", "posted"]);
  });

  it("saves a terminal replacement before clear, idle submit, and POST", async () => {
    const order: string[] = [];
    const pending = createPendingGeneration(makeCommand("new_menu"), USER_ID);
    savePendingGeneration(pending, {
      setItem: () => {
        order.push("saved");
      },
    });
    const failedState: GenerationClientState = {
      phase: "failed",
      data: {
        status: "failed",
        idempotencyKey: IDEMPOTENCY_KEY,
        requestId: "50000000-0000-4000-8000-000000000001",
        error: { code: "model_unavailable", message: "利用できません", retryable: true },
        completedAt: "2026-07-11T00:00:01.000Z",
        quota,
      },
      effect: "none",
    };
    const idle = generationReducer(failedState, { type: "clear" });
    order.push("cleared");
    const submitting = generationReducer(idle, { type: "submit" });
    order.push("submitted");
    await postGeneration(pendingGenerationCommand(pending), {
      fetchImpl: () => {
        order.push("posted");
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: processing })));
      },
    });
    expect(submitting).toEqual({ phase: "submitting", effect: "submit" });
    expect(order).toEqual(["saved", "cleared", "submitted", "posted"]);
  });

  it.each([
    [PENDING_GENERATION_TTL_MS - 1, true],
    [PENDING_GENERATION_TTL_MS, false],
  ])("keeps 29:59.999 and expires at the exact 30:00 boundary", (age, kept) => {
    const storage = memoryStorage(JSON.stringify(storedPending()));
    const result = readPendingGeneration(USER_ID, new Date(Date.parse(STARTED_AT) + age), storage);
    expect(result !== null).toBe(kept);
    expect(storage.removeItem).toHaveBeenCalledTimes(kept ? 0 : 1);
  });

  it("best-effort removes legacy v2 pending key on v3 read", () => {
    const storage = memoryStorage(JSON.stringify(storedPending()));
    storage.setItem(LEGACY_V2_KEY, JSON.stringify({ kind: "legacy_v2_blob" }));
    const result = readPendingGeneration(USER_ID, new Date(STARTED_AT), storage);
    expect(result).not.toBeNull();
    expect(storage.getItem(LEGACY_V2_KEY)).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(LEGACY_V2_KEY);
  });

  it.each(["new_menu", "regenerate_menu", "regenerate_dish"] as const)(
    "persists and recovers the exact %s command",
    (kind) => {
      const command = makeCommand(kind);
      const requestId = "50000000-0000-4000-8000-000000000001";
      const pending = pendingGenerationSchema.parse({
        ...createPendingGeneration(command, USER_ID, () => new Date(STARTED_AT)),
        requestId,
      });
      const storage = memoryStorage();

      savePendingGeneration(pending, storage);
      const recovered = readPendingGeneration(
        USER_ID,
        new Date(Date.parse(STARTED_AT) + 1_000),
        storage,
      );

      expect(recovered).not.toBeNull();
      if (recovered === null) {
        throw new Error("pending generation was not recovered");
      }
      expect(recovered.ownerUserId).toBe(USER_ID);
      expect(recovered.requestId).toBe(requestId);
      expect(pendingGenerationCommand(recovered)).toEqual(command);
    },
  );

  it.each([
    ["foreign", JSON.stringify(storedPending({ ownerUserId: OTHER_USER_ID }))],
    ["corrupt", "{"],
    ["invalid", JSON.stringify({ ...storedPending(), extra: true })],
    ["future", JSON.stringify(storedPending({ createdAt: "2026-07-11T00:00:01.000Z" }))],
  ])("deletes %s records and returns null", (_case, raw) => {
    const storage = memoryStorage(raw);
    expect(readPendingGeneration(USER_ID, new Date(STARTED_AT), storage)).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(KEY);
  });

  // F1: 旧 privacy 欠落 / 旧 version の再生成 pending は互換受理せず clear する
  it.each(["regenerate_menu", "regenerate_dish"] as const)(
    "clears %s pending missing privacyNoticeVersion without recovery",
    (kind) => {
      const valid = makeCommand(kind);
      const withoutPrivacy = {
        ...valid,
        request: Object.fromEntries(
          Object.entries(valid.request).filter(([key]) => key !== "privacyNoticeVersion"),
        ),
        ownerUserId: USER_ID,
        createdAt: STARTED_AT,
        requestId: null,
      };
      const storage = memoryStorage(JSON.stringify(withoutPrivacy));
      expect(readPendingGeneration(USER_ID, new Date(STARTED_AT), storage)).toBeNull();
      expect(storage.removeItem).toHaveBeenCalledWith(KEY);
    },
  );

  it.each(["regenerate_menu", "regenerate_dish"] as const)(
    "clears %s pending with previous privacyNoticeVersion without recovery",
    (kind) => {
      const valid = makeCommand(kind);
      const oldVersion = {
        ...valid,
        request: { ...valid.request, privacyNoticeVersion: "2026-07-11.v1" },
        ownerUserId: USER_ID,
        createdAt: STARTED_AT,
        requestId: null,
      };
      const storage = memoryStorage(JSON.stringify(oldVersion));
      expect(readPendingGeneration(USER_ID, new Date(STARTED_AT), storage)).toBeNull();
      expect(storage.removeItem).toHaveBeenCalledWith(KEY);
    },
  );

  it("fails closed when getItem throws", () => {
    const storage = {
      getItem: () => {
        throw new Error("get");
      },
      removeItem: vi.fn(),
    };
    expect(readPendingGeneration(USER_ID, new Date(STARTED_AT), storage)).toBeNull();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each(["invalid", "foreign", "expired"] as const)(
    "absorbs removeItem failure for %s data",
    (kind) => {
      const pending = storedPending({
        ...(kind === "foreign" ? { ownerUserId: OTHER_USER_ID } : {}),
        ...(kind === "expired" ? { createdAt: "2026-07-10T00:00:00.000Z" } : {}),
      });
      const raw = kind === "invalid" ? "{" : JSON.stringify(pending);
      const storage = {
        getItem: () => raw,
        removeItem: () => {
          throw new Error("remove");
        },
      };
      expect(() => readPendingGeneration(USER_ID, new Date(STARTED_AT), storage)).not.toThrow();
      expect(readPendingGeneration(USER_ID, new Date(STARTED_AT), storage)).toBeNull();
    },
  );

  it("continues cleanup when clear removeItem throws", () => {
    expect(() => {
      clearPendingGeneration({
        removeItem: () => {
          throw new Error("remove");
        },
      });
    }).not.toThrow();
  });

  it("propagates setItem failure and never starts the POST", async () => {
    const post = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true, data: processing }))),
    );
    const operation = async () => {
      const pending = createPendingGeneration(makeCommand("new_menu"), USER_ID);
      savePendingGeneration(pending, {
        setItem: () => {
          throw new Error("set");
        },
      });
      await postGeneration(pendingGenerationCommand(pending), { fetchImpl: post });
    };
    await expect(operation()).rejects.toThrow("set");
    expect(post).not.toHaveBeenCalled();
  });

  describe("claimPendingGeneration (P1 dual-tab)", () => {
    const OTHER_KEY = "10000000-0000-4000-8000-000000000002";

    it("claims empty storage and persists the candidate", async () => {
      const storage = memoryStorage();
      const candidate = storedPending();
      const result = await claimPendingGeneration(
        candidate,
        USER_ID,
        new Date(STARTED_AT),
        storage,
      );
      expect(result.claimed).toBe(true);
      expect(result.pending.request.idempotencyKey).toBe(IDEMPOTENCY_KEY);
      expect(readPendingGeneration(USER_ID, new Date(STARTED_AT), storage)).toMatchObject({
        request: { idempotencyKey: IDEMPOTENCY_KEY },
      });
    });

    it("does not overwrite an existing sticky (C2 first-writer / resume)", async () => {
      const existing = storedPending({
        request: {
          idempotencyKey: OTHER_KEY,
          draftId: "20000000-0000-4000-8000-000000000001",
          draftRevision: 3,
          privacyNoticeVersion: "2026-07-29.v1",
          expiredPantryConfirmations: [],
        },
      });
      const storage = memoryStorage(JSON.stringify(existing));
      const candidate = storedPending();
      const result = await claimPendingGeneration(
        candidate,
        USER_ID,
        new Date(STARTED_AT),
        storage,
      );
      expect(result.claimed).toBe(false);
      expect(result.pending.request.idempotencyKey).toBe(OTHER_KEY);
      // pending 本体は上書きしない。Locks 無しでは fallback lock キーだけ書く。
      expect(storage.setItem.mock.calls.filter(([writtenKey]) => writtenKey === KEY)).toHaveLength(
        0,
      );
      expect(
        readPendingGeneration(USER_ID, new Date(STARTED_AT), storage)?.request.idempotencyKey,
      ).toBe(OTHER_KEY);
    });

    it("write-then-reread adopts the storage winner when keys diverge", async () => {
      // Locks 無し競合: 自 setItem の直後に他 sticky が読める場合は claimed=false
      const winner = storedPending({
        request: {
          idempotencyKey: OTHER_KEY,
          draftId: "20000000-0000-4000-8000-000000000001",
          draftRevision: 9,
          privacyNoticeVersion: "2026-07-29.v1",
          expiredPantryConfirmations: [],
        },
      });
      const map = new Map<string, string>();
      const storage = {
        getItem: vi.fn((k: string) => map.get(k) ?? null),
        setItem: vi.fn((k: string, next: string) => {
          map.set(k, next);
          // pending 本体の自 claim 書込直後に他タブ sticky へ差替え（re-read で負けを観測）。
          // G6 fallback lock が先に別キーを書くので、KEY の書込だけを対象にする。
          if (k === KEY) {
            map.set(k, JSON.stringify(winner));
          }
        }),
        removeItem: vi.fn((k: string) => {
          map.delete(k);
        }),
      };
      const candidate = storedPending();
      const result = await claimPendingGeneration(
        candidate,
        USER_ID,
        new Date(STARTED_AT),
        storage,
      );
      expect(result.claimed).toBe(false);
      expect(result.pending.request.idempotencyKey).toBe(OTHER_KEY);
    });

    it("locks 無しでも自 key の直後 re-read のあと他 sticky が見えたら負け", async () => {
      // 既存の即時 re-read は自 setItem 直後に自 key を見て claimed になる。
      // locks 無し dual-tab では他タブ上書きが次ティックで見えるので、
      // 自 key 確認後にもう一度読んで他 sticky なら負けにする。
      vi.stubGlobal("navigator", {});
      try {
        const winner = storedPending({
          request: {
            idempotencyKey: OTHER_KEY,
            draftId: "20000000-0000-4000-8000-000000000001",
            draftRevision: 9,
            privacyNoticeVersion: "2026-07-29.v1",
            expiredPantryConfirmations: [],
          },
        });
        const map = new Map<string, string>();
        let readsAfterWrite = 0;
        const storage = {
          getItem: vi.fn((k: string) => {
            if (k === KEY && map.has(k)) {
              readsAfterWrite += 1;
              if (readsAfterWrite >= 2) {
                return JSON.stringify(winner);
              }
            }
            return map.get(k) ?? null;
          }),
          setItem: vi.fn((k: string, next: string) => {
            map.set(k, next);
          }),
          removeItem: vi.fn((k: string) => {
            map.delete(k);
          }),
        };
        const result = await claimPendingGeneration(
          storedPending(),
          USER_ID,
          new Date(STARTED_AT),
          storage,
        );
        expect(result.claimed).toBe(false);
        expect(result.pending.request.idempotencyKey).toBe(OTHER_KEY);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("locks 無しの同時 check-then-act では両方 claimed にならない", async () => {
      // navigator.locks が無いと両タブが existing===null を見て別 idempotencyKey を
      // 書ける。書込の可視を次マクロタスクに遅らせ、即時 re-read だけだと両方勝つ。
      vi.stubGlobal("navigator", {});
      try {
        const map = new Map<string, string>();
        const storage = {
          getItem: vi.fn((k: string) => map.get(k) ?? null),
          setItem: vi.fn((k: string, next: string) => {
            queueMicrotask(() => {
              map.set(k, next);
            });
          }),
          removeItem: vi.fn((k: string) => {
            map.delete(k);
          }),
        };
        const a = storedPending();
        const b = storedPending({
          request: {
            idempotencyKey: OTHER_KEY,
            draftId: "20000000-0000-4000-8000-000000000001",
            draftRevision: 3,
            privacyNoticeVersion: "2026-07-29.v1",
            expiredPantryConfirmations: [],
          },
        });
        const [resultA, resultB] = await Promise.all([
          claimPendingGeneration(a, USER_ID, new Date(STARTED_AT), storage),
          claimPendingGeneration(b, USER_ID, new Date(STARTED_AT), storage),
        ]);
        expect([resultA.claimed, resultB.claimed].filter(Boolean)).toHaveLength(1);
        expect(resultA.pending.request.idempotencyKey).toBe(resultB.pending.request.idempotencyKey);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("serializes concurrent claims via Web Locks so both tabs share one sticky", async () => {
      // shopping claimItemMutationSticky テストと同型の直列キュー
      type LockRequest = {
        name: string;
        callback: () => unknown;
        resolve: (value: unknown) => void;
        reject: (reason?: unknown) => void;
      };
      const queue: LockRequest[] = [];
      let running = false;
      const pump = (): void => {
        if (running) return;
        const next = queue.shift();
        if (next === undefined) return;
        running = true;
        Promise.resolve()
          .then(() => next.callback())
          .then(
            (value) => {
              next.resolve(value);
            },
            (reason: unknown) => {
              next.reject(reason);
            },
          )
          .finally(() => {
            running = false;
            pump();
          });
      };
      vi.stubGlobal("navigator", {
        locks: {
          request: (name: string, callback: () => unknown) =>
            new Promise((resolve, reject) => {
              queue.push({ name, callback, resolve, reject });
              pump();
            }),
        },
      });
      try {
        const storage = memoryStorage();
        const a = storedPending();
        const b = storedPending({
          request: {
            idempotencyKey: OTHER_KEY,
            draftId: "20000000-0000-4000-8000-000000000001",
            draftRevision: 3,
            privacyNoticeVersion: "2026-07-29.v1",
            expiredPantryConfirmations: [],
          },
        });
        const [resultA, resultB] = await Promise.all([
          claimPendingGeneration(a, USER_ID, new Date(STARTED_AT), storage),
          claimPendingGeneration(b, USER_ID, new Date(STARTED_AT), storage),
        ]);
        // 先勝ち 1 件のみ claimed。後続は同一 sticky を adopted
        expect([resultA.claimed, resultB.claimed].filter(Boolean)).toHaveLength(1);
        expect(resultA.pending.request.idempotencyKey).toBe(resultB.pending.request.idempotencyKey);
        const stored = readPendingGeneration(USER_ID, new Date(STARTED_AT), storage);
        expect(stored?.request.idempotencyKey).toBe(resultA.pending.request.idempotencyKey);
        // ロック名が generation claim であることを固定
        expect(pendingGenerationClaimLockName).toBe("kondate:generation:v3:claim");
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("G6: locks 無しでも後タブは先勝ち sticky を上書きしない", async () => {
      vi.stubGlobal("navigator", {});
      try {
        const storage = memoryStorage();
        const first = storedPending();
        const second = storedPending({
          request: {
            idempotencyKey: OTHER_KEY,
            draftId: "20000000-0000-4000-8000-000000000001",
            draftRevision: 3,
            privacyNoticeVersion: "2026-07-29.v1",
            expiredPantryConfirmations: [],
          },
        });
        const started = claimPendingGeneration(first, USER_ID, new Date(STARTED_AT), storage);
        await Promise.resolve();
        const late = claimPendingGeneration(second, USER_ID, new Date(STARTED_AT), storage);
        const [resultFirst, resultLate] = await Promise.all([started, late]);
        expect(resultFirst.claimed).toBe(true);
        expect(resultLate.claimed).toBe(false);
        expect(resultLate.pending.request.idempotencyKey).toBe(IDEMPOTENCY_KEY);
        expect(
          readPendingGeneration(USER_ID, new Date(STARTED_AT), storage)?.request.idempotencyKey,
        ).toBe(IDEMPOTENCY_KEY);
        expect(storage.getItem(pendingGenerationClaimFallbackLockKey)).toBeNull();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
