import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationStatusData } from "@shared/contracts/generation";

import {
  clearPendingGeneration,
  createPendingGeneration,
  readPendingGeneration,
  savePendingGeneration,
} from "./pending-generation";
import { reconcileTerminalPendingGeneration } from "./reconcile-terminal-pending";

const USER_ID = "60000000-0000-4000-8000-000000000001";
const KEY = "10000000-0000-4000-8000-000000000001";
const MENU_A = "20000000-0000-4000-8000-000000000001";
const MENU_B = "20000000-0000-4000-8000-000000000002";
const REQUEST_ID = "50000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-07-20T05:00:00.000Z");

const quota = {
  consumed: false,
  remaining: 2,
  userDailyLimit: 3 as const,
  limitKind: "user" as const,
  retryAt: null,
};

function seedPending(): void {
  const pending = createPendingGeneration(
    {
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: {
        idempotencyKey: KEY,
        draftId: "30000000-0000-4000-8000-000000000001",
        draftRevision: 1,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    },
    USER_ID,
    () => NOW,
  );
  savePendingGeneration(pending);
}

function succeeded(menuId: string): GenerationStatusData {
  return {
    status: "succeeded",
    idempotencyKey: KEY,
    requestId: REQUEST_ID,
    menuId,
    completedAt: "2026-07-20T05:01:00.000Z",
    quota: { ...quota, consumed: true, remaining: 1 },
  };
}

function processing(): GenerationStatusData {
  return {
    status: "processing",
    idempotencyKey: KEY,
    requestId: REQUEST_ID,
    startedAt: "2026-07-20T05:00:30.000Z",
    quota,
  };
}

function failed(): GenerationStatusData {
  return {
    status: "failed",
    idempotencyKey: KEY,
    requestId: REQUEST_ID,
    completedAt: "2026-07-20T05:01:00.000Z",
    error: {
      code: "generation_timeout",
      message: "作成に時間がかかりました。",
      retryable: true,
    },
    quota,
  };
}

beforeEach(() => {
  clearPendingGeneration();
});

afterEach(() => {
  clearPendingGeneration();
});

describe("reconcileTerminalPendingGeneration", () => {
  it("returns none when no pending", async () => {
    const getStatus = vi.fn();
    await expect(
      reconcileTerminalPendingGeneration(USER_ID, { now: NOW, getStatus }),
    ).resolves.toBe("none");
    expect(getStatus).not.toHaveBeenCalled();
  });

  it("G-R1 matchMenuId: clears only when succeeded menuId matches", async () => {
    seedPending();
    const getStatus = vi.fn().mockResolvedValue(succeeded(MENU_A));
    await expect(
      reconcileTerminalPendingGeneration(USER_ID, {
        matchMenuId: MENU_A,
        now: NOW,
        getStatus,
      }),
    ).resolves.toBe("cleared");
    expect(readPendingGeneration(USER_ID, NOW)).toBeNull();
  });

  it("G-R1 matchMenuId: keeps when succeeded menuId differs (G2)", async () => {
    seedPending();
    const getStatus = vi.fn().mockResolvedValue(succeeded(MENU_B));
    await expect(
      reconcileTerminalPendingGeneration(USER_ID, {
        matchMenuId: MENU_A,
        now: NOW,
        getStatus,
      }),
    ).resolves.toBe("kept");
    expect(readPendingGeneration(USER_ID, NOW)).not.toBeNull();
  });

  it("G-R1 matchMenuId: keeps while processing", async () => {
    seedPending();
    const getStatus = vi.fn().mockResolvedValue(processing());
    await expect(
      reconcileTerminalPendingGeneration(USER_ID, {
        matchMenuId: MENU_A,
        now: NOW,
        getStatus,
      }),
    ).resolves.toBe("kept");
    expect(readPendingGeneration(USER_ID, NOW)).not.toBeNull();
  });

  it("G-R1 planner path: clears terminal failed so new create is allowed", async () => {
    seedPending();
    const getStatus = vi.fn().mockResolvedValue(failed());
    await expect(
      reconcileTerminalPendingGeneration(USER_ID, { now: NOW, getStatus }),
    ).resolves.toBe("cleared");
    expect(readPendingGeneration(USER_ID, NOW)).toBeNull();
  });

  it("G-R1 planner path: keeps processing for resume", async () => {
    seedPending();
    const getStatus = vi.fn().mockResolvedValue(processing());
    await expect(
      reconcileTerminalPendingGeneration(USER_ID, { now: NOW, getStatus }),
    ).resolves.toBe("kept");
    expect(readPendingGeneration(USER_ID, NOW)).not.toBeNull();
  });

  it("G-R1: status GET failure keeps pending (G1)", async () => {
    seedPending();
    const getStatus = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(
      reconcileTerminalPendingGeneration(USER_ID, {
        matchMenuId: MENU_A,
        now: NOW,
        getStatus,
      }),
    ).resolves.toBe("kept");
    await expect(
      reconcileTerminalPendingGeneration(USER_ID, { now: NOW, getStatus }),
    ).resolves.toBe("kept");
    expect(readPendingGeneration(USER_ID, NOW)).not.toBeNull();
  });
});
