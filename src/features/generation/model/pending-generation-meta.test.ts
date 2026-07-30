import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PENDING_GENERATION_TTL_MS,
  clearPendingGeneration,
  createPendingGeneration,
  savePendingGeneration,
  type PendingGeneration,
} from "./pending-generation";
import {
  clearPendingGenerationMeta,
  readPendingGenerationMeta,
  savePendingGenerationMeta,
  type PendingGenerationMeta,
} from "./pending-generation-meta";

const PENDING_KEY = "kondate:generation:v3";
const META_KEY = "kondate:generation:v3:meta";
const USER_ID = "40000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "40000000-0000-4000-8000-000000000002";
const IDEMPOTENCY_KEY = "10000000-0000-4000-8000-000000000001";
const OTHER_KEY = "10000000-0000-4000-8000-000000000002";
const STARTED_AT = "2026-07-11T00:00:00.000Z";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
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

function makeNewMenuPending(
  overrides: {
    ownerUserId?: string;
    createdAt?: string;
    request?: { idempotencyKey?: string };
  } = {},
): PendingGeneration {
  return createPendingGeneration(
    {
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: {
        idempotencyKey: overrides.request?.idempotencyKey ?? IDEMPOTENCY_KEY,
        draftId: "20000000-0000-4000-8000-000000000001",
        draftRevision: 3,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    },
    overrides.ownerUserId ?? USER_ID,
    () => new Date(overrides.createdAt ?? STARTED_AT),
  );
}

function makeMeta(overrides: Partial<PendingGenerationMeta> = {}): PendingGenerationMeta {
  return {
    kind: "new_menu",
    targetMode: "household",
    idempotencyKey: IDEMPOTENCY_KEY,
    ownerUserId: USER_ID,
    createdAt: STARTED_AT,
    ...overrides,
  };
}

describe("pending generation meta", () => {
  beforeEach(() => {
    // テスト間で実 localStorage を汚さない（注入 storage を正とする）
  });

  it("clearPendingGeneration clears meta", () => {
    const storage = memoryStorage();
    const pending = makeNewMenuPending();
    savePendingGeneration(pending, storage);
    savePendingGenerationMeta(makeMeta(), storage);
    expect(storage.getItem(META_KEY)).not.toBeNull();

    clearPendingGeneration(storage);

    expect(storage.getItem(PENDING_KEY)).toBeNull();
    expect(storage.getItem(META_KEY)).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(PENDING_KEY);
    expect(storage.removeItem).toHaveBeenCalledWith(META_KEY);
  });

  it("readPendingGenerationMeta returns null when pending missing or key mismatch", () => {
    const now = new Date(STARTED_AT);

    // pending 欠落
    const noPending = memoryStorage({
      [META_KEY]: JSON.stringify(makeMeta()),
    });
    expect(readPendingGenerationMeta(USER_ID, now, noPending)).toBeNull();
    expect(noPending.getItem(META_KEY)).toBeNull();

    // idempotencyKey 不一致
    const pending = makeNewMenuPending();
    const mismatch = memoryStorage();
    savePendingGeneration(pending, mismatch);
    savePendingGenerationMeta(makeMeta({ idempotencyKey: OTHER_KEY }), mismatch);
    expect(readPendingGenerationMeta(USER_ID, now, mismatch)).toBeNull();
    expect(mismatch.getItem(META_KEY)).toBeNull();

    // 一致すれば返す
    const ok = memoryStorage();
    savePendingGeneration(pending, ok);
    savePendingGenerationMeta(makeMeta({ targetMode: "idea" }), ok);
    expect(readPendingGenerationMeta(USER_ID, now, ok)).toEqual(makeMeta({ targetMode: "idea" }));
  });

  it("savePendingGeneration for regenerate clears meta", () => {
    const storage = memoryStorage();
    const newMenu = makeNewMenuPending();
    savePendingGeneration(newMenu, storage);
    savePendingGenerationMeta(makeMeta(), storage);
    expect(storage.getItem(META_KEY)).not.toBeNull();

    const regenerate = createPendingGeneration(
      {
        commandVersion: "generation-command.v3",
        kind: "regenerate_menu",
        qualityMode: false,
        request: {
          idempotencyKey: OTHER_KEY,
          sourceMenuId: "60000000-0000-4000-8000-000000000001",
          changeReason: "simpler",
          changeReasonCustom: null,
          privacyNoticeVersion: "2026-07-29.v1",
          expiredPantryConfirmations: [],
        },
      },
      USER_ID,
      () => new Date(STARTED_AT),
    );
    savePendingGeneration(regenerate, storage);

    expect(storage.getItem(META_KEY)).toBeNull();
    expect(readPendingGenerationMeta(USER_ID, new Date(STARTED_AT), storage)).toBeNull();
  });

  it("readPendingGenerationMeta returns null for foreign owner or expired meta", () => {
    const pending = makeNewMenuPending();
    const foreign = memoryStorage();
    savePendingGeneration(pending, foreign);
    savePendingGenerationMeta(makeMeta({ ownerUserId: OTHER_USER_ID }), foreign);
    expect(readPendingGenerationMeta(USER_ID, new Date(STARTED_AT), foreign)).toBeNull();

    const expired = memoryStorage();
    savePendingGeneration(pending, expired);
    savePendingGenerationMeta(makeMeta(), expired);
    const afterTtl = new Date(Date.parse(STARTED_AT) + PENDING_GENERATION_TTL_MS);
    // pending 自体も TTL 切れで消えるため meta も null
    expect(readPendingGenerationMeta(USER_ID, afterTtl, expired)).toBeNull();
  });

  it("continues when clearPendingGenerationMeta removeItem throws", () => {
    expect(() => {
      clearPendingGenerationMeta({
        removeItem: () => {
          throw new Error("remove");
        },
      });
    }).not.toThrow();
  });
});
