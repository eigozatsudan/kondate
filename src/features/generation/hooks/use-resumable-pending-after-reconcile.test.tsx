import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationStatusData } from "@shared/contracts/generation";

import {
  clearPendingGeneration,
  createPendingGeneration,
  savePendingGeneration,
} from "../model/pending-generation";
import { useResumablePendingAfterReconcile } from "./use-resumable-pending-after-reconcile";

const USER_ID = "60000000-0000-4000-8000-000000000001";
const KEY = "10000000-0000-4000-8000-000000000001";
const REQUEST_ID = "50000000-0000-4000-8000-000000000001";

const quota = {
  consumed: false,
  remaining: 2,
  userDailyLimit: 3 as const,
  limitKind: "user" as const,
  retryAt: null,
};

vi.mock("../api/generation-api", () => ({
  getGenerationStatus: vi.fn(),
}));

import { getGenerationStatus } from "../api/generation-api";

const getStatusMock = vi.mocked(getGenerationStatus);

function seedPending(): void {
  // 壁時計 now を固定しない。TTL 切れで readPendingGeneration が null になると hook が GET しない。
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
  );
  savePendingGeneration(pending);
}

function processing(): GenerationStatusData {
  return {
    status: "processing",
    idempotencyKey: KEY,
    requestId: REQUEST_ID,
    startedAt: new Date().toISOString(),
    quota,
  };
}

function failed(): GenerationStatusData {
  return {
    status: "failed",
    idempotencyKey: KEY,
    requestId: REQUEST_ID,
    completedAt: new Date().toISOString(),
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
  getStatusMock.mockReset();
});

afterEach(() => {
  clearPendingGeneration();
});

describe("useResumablePendingAfterReconcile (G-R4)", () => {
  it("no pending: ready immediately without status GET", async () => {
    const { result } = renderHook(() => useResumablePendingAfterReconcile(USER_ID));
    await waitFor(() => {
      expect(result.current.pendingDisplayReady).toBe(true);
    });
    expect(result.current.hasResumablePending).toBe(false);
    expect(getStatusMock).not.toHaveBeenCalled();
  });

  it("processing: keeps resume UI (G2)", async () => {
    seedPending();
    getStatusMock.mockResolvedValue(processing());
    const { result } = renderHook(() => useResumablePendingAfterReconcile(USER_ID));
    await waitFor(() => {
      expect(result.current.pendingDisplayReady).toBe(true);
    });
    expect(result.current.hasResumablePending).toBe(true);
  });

  it("terminal failed: no resume-only UI after clear", async () => {
    seedPending();
    getStatusMock.mockResolvedValue(failed());
    const { result } = renderHook(() => useResumablePendingAfterReconcile(USER_ID));
    await waitFor(() => {
      expect(result.current.pendingDisplayReady).toBe(true);
    });
    expect(result.current.hasResumablePending).toBe(false);
  });

  it("status GET failure: keep resume UI (G1)", async () => {
    seedPending();
    getStatusMock.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useResumablePendingAfterReconcile(USER_ID));
    await waitFor(() => {
      expect(result.current.pendingDisplayReady).toBe(true);
    });
    expect(result.current.hasResumablePending).toBe(true);
  });
});
