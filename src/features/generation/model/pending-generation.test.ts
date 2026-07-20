import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationCommand, GenerationStatusData } from "@shared/contracts/generation";
import { postGeneration } from "../api/generation-api";
import { generationReducer, type GenerationClientState } from "./generation-machine";
import {
  PENDING_GENERATION_TTL_MS,
  clearPendingGeneration,
  createPendingGeneration,
  pendingGenerationSchema,
  pendingGenerationCommand,
  readPendingGeneration,
  savePendingGeneration,
  type PendingGeneration,
} from "./pending-generation";

const requireAccessTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth/session", () => ({ requireAccessToken: requireAccessTokenMock }));
vi.mock("@/shared/lib/supabase", () => ({ getBrowserSupabaseClient: () => ({}) }));

const KEY = "kondate:generation:v2";
const USER_ID = "40000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "40000000-0000-4000-8000-000000000002";
const IDEMPOTENCY_KEY = "10000000-0000-4000-8000-000000000001";
const STARTED_AT = "2026-07-11T00:00:00.000Z";
const quota = {
  consumed: false,
  remaining: 4,
  userDailyLimit: 5,
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
    expiredPantryConfirmations: [],
  };
  if (kind === "new_menu") {
    return {
      kind,
      request: {
        idempotencyKey: IDEMPOTENCY_KEY,
        draftId: "20000000-0000-4000-8000-000000000001",
        draftRevision: 3,
        privacyNoticeVersion: "2026-07-11.v1",
        expiredPantryConfirmations: [],
      },
    };
  }
  if (kind === "regenerate_menu") return { kind, request: base };
  return {
    kind,
    request: { ...base, dishId: "70000000-0000-4000-8000-000000000001" },
  };
}

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next;
    }),
    removeItem: vi.fn(() => {
      value = null;
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
});
