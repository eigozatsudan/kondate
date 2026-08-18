import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { GenerationCommand, GenerationStatusData } from "@shared/contracts/generation";
import {
  GENERATION_POST_CLIENT_TIMEOUT_MS,
  GENERATION_STATUS_CLIENT_TIMEOUT_MS,
  generationEndpointFor,
  getGenerationStatus,
  postGeneration,
  readLiveGenerationDraftPin,
} from "./generation-api";

const requireAccessTokenMock = vi.hoisted(() => vi.fn());
const assertBrowserDataPlaneAlignedMock = vi.hoisted(() => vi.fn());
const getBrowserSupabaseClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth/session", () => ({
  requireAccessToken: requireAccessTokenMock,
  assertBrowserDataPlaneAligned: assertBrowserDataPlaneAlignedMock,
}));
vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: getBrowserSupabaseClientMock,
}));

const IDEMPOTENCY_KEY = "10000000-0000-4000-8000-000000000001";
const OTHER_KEY = "10000000-0000-4000-8000-000000000002";
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
  startedAt: "2026-07-11T00:00:00.000Z",
  quota,
};
const newMenuCommand: GenerationCommand = {
  commandVersion: "generation-command.v3",
  kind: "new_menu",
  qualityMode: false,
  request: {
    idempotencyKey: IDEMPOTENCY_KEY,
    draftId: "20000000-0000-4000-8000-000000000001",
    draftRevision: 3,
    privacyNoticeVersion: "2026-07-29.v1",
    expiredPantryConfirmations: [],
  },
};
const regenerateMenuCommand: GenerationCommand = {
  commandVersion: "generation-command.v3",
  kind: "regenerate_menu",
  qualityMode: false,
  request: {
    idempotencyKey: IDEMPOTENCY_KEY,
    sourceMenuId: "60000000-0000-4000-8000-000000000001",
    changeReason: "simpler",
    changeReasonCustom: null,
    privacyNoticeVersion: "2026-07-29.v1",
    expiredPantryConfirmations: [],
  },
};
const regenerateDishCommand: GenerationCommand = {
  commandVersion: "generation-command.v3",
  kind: "regenerate_dish",
  qualityMode: false,
  request: {
    ...regenerateMenuCommand.request,
    dishId: "70000000-0000-4000-8000-000000000001",
  },
};

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function liveDraftPinClient(result: { data: unknown; error: unknown }) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            maybeSingle: vi.fn(() => Promise.resolve(result)),
          })),
        })),
      })),
    })),
  };
}

describe("generation API", () => {
  beforeEach(() => {
    requireAccessTokenMock.mockReset();
    requireAccessTokenMock.mockResolvedValue("access-token");
    assertBrowserDataPlaneAlignedMock.mockReset();
    assertBrowserDataPlaneAlignedMock.mockResolvedValue(undefined);
    getBrowserSupabaseClientMock.mockReset();
    getBrowserSupabaseClientMock.mockReturnValue({});
  });

  it("G1: reads live draft id and revision without menu body", async () => {
    const draftId = "20000000-0000-4000-8000-000000000001";
    getBrowserSupabaseClientMock.mockReturnValue(
      liveDraftPinClient({ data: { id: draftId, revision: 4 }, error: null }),
    );
    await expect(
      readLiveGenerationDraftPin("40000000-0000-4000-8000-000000000001"),
    ).resolves.toEqual({ draftId, revision: 4 });
  });

  it("G1: live draft pin returns null when the row is gone", async () => {
    getBrowserSupabaseClientMock.mockReturnValue(liveDraftPinClient({ data: null, error: null }));
    await expect(
      readLiveGenerationDraftPin("40000000-0000-4000-8000-000000000001"),
    ).resolves.toBeNull();
  });

  it("G-R1: live draft pin throws on PostgREST query error instead of returning null", async () => {
    getBrowserSupabaseClientMock.mockReturnValue(
      liveDraftPinClient({ data: null, error: { message: "fetch failed" } }),
    );
    await expect(
      readLiveGenerationDraftPin("40000000-0000-4000-8000-000000000001"),
    ).rejects.toThrow("献立条件の下書きを読み込めませんでした");
  });

  it("G-R1: live draft pin propagates AuthSessionProbeTimeoutError from assert", async () => {
    const probeTimeout = Object.assign(new Error("auth_session_probe_timeout"), {
      name: "AuthSessionProbeTimeoutError",
    });
    assertBrowserDataPlaneAlignedMock.mockRejectedValue(probeTimeout);
    await expect(readLiveGenerationDraftPin("40000000-0000-4000-8000-000000000001")).rejects.toBe(
      probeTimeout,
    );
  });

  it.each([
    [newMenuCommand, "/api/generations/menu"],
    [regenerateMenuCommand, "/api/generations/menu"],
    [regenerateDishCommand, "/api/generations/dish"],
  ] as const)("selects the $0.kind endpoint", (command, endpoint) => {
    expect(generationEndpointFor(command)).toBe(endpoint);
  });

  it("posts the canonical request with authentication and a client abort budget", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(response({ ok: true, data: processing }, 202)));
    await expect(postGeneration(newMenuCommand, { fetchImpl })).resolves.toEqual(processing);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe("/api/generations/menu");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(newMenuCommand));
    expect(init.headers).toEqual({
      Authorization: "Bearer access-token",
      "Content-Type": "application/json",
    });
    // G8/S12: function-budget 正本から導出した POST 専用 AbortSignal
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(GENERATION_POST_CLIENT_TIMEOUT_MS).toBe(58_000);
    expect(GENERATION_POST_CLIENT_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
    expect(GENERATION_POST_CLIENT_TIMEOUT_MS).toBeGreaterThan(55_000);
  });

  it("G8: aborts a hung POST when the client timeout fires", async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal ?? null;
          if (signal === null) {
            reject(new Error("missing abort signal"));
            return;
          }
          if (signal.aborted) {
            reject(new DOMException("The operation was aborted.", "AbortError"));
            return;
          }
          signal.addEventListener(
            "abort",
            () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            },
            { once: true },
          );
        }),
    );
    // 実壁時計を短くして AbortSignal.timeout を確定させる（本番既定は 58s）
    await expect(
      postGeneration(newMenuCommand, { fetchImpl, postTimeoutMs: 20 }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("parses a valid envelope even when response.ok is false", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(response({ ok: true, data: processing }, 503)));
    await expect(postGeneration(newMenuCommand, { fetchImpl })).resolves.toEqual(processing);
  });

  it("throws the standard envelope error code", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        response(
          { ok: false, error: { code: "model_unavailable", message: "利用できません" } },
          503,
        ),
      ),
    );
    await expect(postGeneration(newMenuCommand, { fetchImpl })).rejects.toThrow(
      "model_unavailable",
    );
  });

  it("stops before fetch when authentication fails", async () => {
    const fetchImpl = vi.fn();
    requireAccessTokenMock.mockRejectedValue(new Error("auth"));
    await expect(postGeneration(newMenuCommand, { fetchImpl })).rejects.toThrow("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["POST", "GET"] as const)(
    "rejects a valid status envelope whose idempotency key mismatches %s",
    async (method) => {
      const mismatch = { ...processing, idempotencyKey: OTHER_KEY };
      const fetchImpl = vi.fn(() => Promise.resolve(response({ ok: true, data: mismatch })));
      const operation =
        method === "POST"
          ? postGeneration(newMenuCommand, { fetchImpl })
          : getGenerationStatus(IDEMPOTENCY_KEY, { fetchImpl });
      await expect(operation).rejects.toBeInstanceOf(z.ZodError);
    },
  );

  it("gets status with a validated encoded key and a client abort budget", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(response({ ok: true, data: processing })));
    await expect(getGenerationStatus(IDEMPOTENCY_KEY, { fetchImpl })).resolves.toEqual(processing);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe(`/api/generations/${IDEMPOTENCY_KEY}/status`);
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({
      Authorization: "Bearer access-token",
      "Content-Type": "application/json",
    });
    // G18: hung GET が statusInFlight を永久占有しないよう POST と同系の AbortSignal
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(GENERATION_STATUS_CLIENT_TIMEOUT_MS).toBe(GENERATION_POST_CLIENT_TIMEOUT_MS);
    expect(GENERATION_STATUS_CLIENT_TIMEOUT_MS).toBe(58_000);
  });

  it("G18: aborts a hung status GET when the client timeout fires", async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal ?? null;
          if (signal === null) {
            reject(new Error("missing abort signal"));
            return;
          }
          if (signal.aborted) {
            reject(new DOMException("The operation was aborted.", "AbortError"));
            return;
          }
          signal.addEventListener(
            "abort",
            () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            },
            { once: true },
          );
        }),
    );
    // 実壁時計を短くして AbortSignal.timeout を確定させる（本番既定は 58s）
    await expect(
      getGenerationStatus(IDEMPOTENCY_KEY, { fetchImpl, statusTimeoutMs: 20 }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid GET key before auth or fetch", async () => {
    const fetchImpl = vi.fn();
    requireAccessTokenMock.mockClear();
    await expect(getGenerationStatus("not-a-uuid", { fetchImpl })).rejects.toBeInstanceOf(
      z.ZodError,
    );
    expect(requireAccessTokenMock).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
