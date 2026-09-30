import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  backgroundStartMonotonic,
  dispatchMenuGeneration,
  executeMenuBackground,
} from "./menu-background.js";
import { createGenerationDeps, runGeneration } from "./generation-service.js";
import type { GenerationDependencies } from "./generation-service.js";
import type { QuotaRequestRecord } from "./generation-repository.js";
import type { MenuGenerationCommand } from "./menu-generation-command.js";
import { verifyMenuBackgroundRequest } from "./menu-background-signature.js";

vi.mock("./generation-service.js", () => ({
  createGenerationDeps: vi.fn(),
  runGeneration: vi.fn(() => Promise.resolve()),
}));
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./supabase-admin.js", () => ({ getSupabaseAdmin: () => ({ rpc }) }));
vi.mock("./env.js", () => ({
  getServerEnv: () => ({
    SERVER_SITE_ORIGIN: "https://trusted.example",
    generationIntegrity: { requestHmacKey: new Uint8Array(32).fill(7) },
    openRouter: {
      apiKey: "key",
      baseUrl: "https://openrouter.ai/api/v1",
      models: ["openai/gpt-6-luna"],
    },
  }),
}));
vi.mock("./logger.js", () => ({ logGenerationEvent: vi.fn() }));
vi.mock("./openrouter.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./openrouter.js")>()),
  createOpenRouterGenerationSender: vi.fn(() => vi.fn()),
}));
const user = {
  userId: "85000000-0000-4000-8000-000000000001",
  accessToken: "secret-token",
  email: "private@example.invalid",
};
const requestId = "81000000-0000-4000-8000-000000000001";
const token = "91000000-0000-4000-8000-000000000001";
const command: MenuGenerationCommand = {
  commandVersion: "generation-command.v3",
  kind: "new_menu",
  qualityMode: false,
  request: {
    idempotencyKey: "82000000-0000-4000-8000-000000000001",
    draftId: "84000000-0000-4000-8000-000000000001",
    draftRevision: 1,
    privacyNoticeVersion: "2026-07-29.v1",
    expiredPantryConfirmations: [],
  },
};
const reservation: QuotaRequestRecord = {
  status: "processing",
  request_id: requestId,
  idempotency_key: command.request.idempotencyKey,
  user_daily_limit: 1,
  started_at: new Date(Date.now() - 20_000).toISOString(),
};
const lookup = vi.fn<GenerationDependencies["repository"]["lookup"]>();
const replay = vi.fn<GenerationDependencies["repository"]["replayExisting"]>();
const deps: GenerationDependencies = {
  user,
  repository: {
    lookup,
    replayExisting: replay,
    reserveNew: vi.fn(),
    markSent: vi.fn(),
    fail: vi.fn(),
    failBeforeSend: vi.fn(),
    reserveRepair: vi.fn(),
    recordModel: vi.fn(),
    conflict: vi.fn(),
    succeed: vi.fn(),
    status: vi.fn(),
  },
  models: ["openai/gpt-6-luna"],
  loadExecutionContext: vi.fn(),
  validatePreflight: vi.fn(),
  buildMessages: vi.fn(),
  callOpenRouter: vi.fn(),
  now: () => new Date(),
  monotonicNow: () => performance.now(),
  openRouterTimeoutMs: 20_000,
  functionTotalBudgetMs: 26_000,
  requestStartedAtMonotonicMs: 0,
  uuid: () => requestId,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createGenerationDeps).mockReturnValue(deps);
  lookup.mockResolvedValue({
    kind: "hit",
    requestId,
    requestHmacVersion: "generation-command.v3",
    integrity: {
      kind: "new_menu",
      targetMode: "household",
      servings: null,
      targetMemberIds: ["90000000-0000-4000-8000-000000000001"],
      sourceMenuVersion: null,
    },
  });
  replay.mockResolvedValue({
    ...reservation,
    started_at: new Date(Date.now() - 20_000).toISOString(),
  });
  vi.mocked(deps.repository.status).mockResolvedValue({
    ...reservation,
    started_at: new Date(Date.now() - 20_000).toISOString(),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(null, { status: 202 }))),
  );
});
describe("background menu execution", () => {
  it.each([
    [20_000, 50_000, 30_000],
    [120_000, 50_000, null],
    [-1, 50_000, null],
  ])("deducts queue age %s", (age, now, expected) => {
    expect(backgroundStartMonotonic(new Date(1_000_000 - age).toISOString(), 1_000_000, now)).toBe(
      expected,
    );
  });
  it("rejects an invalid ledger timestamp", () => {
    expect(backgroundStartMonotonic("invalid", 0, 0)).toBeNull();
  });
  it("uses only trusted origin and keeps credentials outside persisted RPC arguments", async () => {
    rpc.mockResolvedValue({ data: { token, claimed: false }, error: null });
    await dispatchMenuGeneration(user, command, requestId);
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call?.[0]).toEqual(
      new URL("https://trusted.example/.netlify/functions/menu-generation-background"),
    );
    expect(call?.[1]?.method).toBe("POST");
    expect(new Headers(call?.[1]?.headers).get("authorization")).toBe("Bearer secret-token");
    expect(call?.[1]?.body).toBe(JSON.stringify({ token, command }));
    expect(
      await verifyMenuBackgroundRequest(
        new Request(
          "https://trusted.example/.netlify/functions/menu-generation-background",
          call?.[1],
        ),
        new Uint8Array(32).fill(7),
      ),
    ).toEqual({ token, command });
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/secret-token|private@example/);
  });
  it("preserves processing when dispatch acceptance is unknown", async () => {
    rpc.mockResolvedValue({ data: { token, claimed: false }, error: null });
    vi.mocked(fetch).mockRejectedValue(new Error("response disappeared"));
    await expect(dispatchMenuGeneration(user, command, requestId)).resolves.toBeUndefined();
    expect(deps.repository.failBeforeSend).not.toHaveBeenCalled();
  });
  it("returns processing even when an ignored abort stalls dispatch receipt", async () => {
    rpc.mockResolvedValue({ data: { token, claimed: false }, error: null });
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => {}));
    try {
      const operation = dispatchMenuGeneration(user, command, requestId);
      await Promise.resolve();
      controller.abort();
      await expect(operation).resolves.toBeUndefined();
      expect(deps.repository.failBeforeSend).not.toHaveBeenCalled();
    } finally {
      timeout.mockRestore();
    }
  });

  it.each([
    { token: null, claimed: true },
    { token: null, claimed: false },
  ])("does not dispatch unavailable reservation %j", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    await dispatchMenuGeneration(user, command, requestId);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("checks the persisted HMAC before claiming and does not reserve again", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await executeMenuBackground(user, command, token);
    expect(replay).toHaveBeenCalledWith(command, expect.objectContaining({ requestId }));
    expect(deps.repository.reserveNew).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("claim_menu_background_dispatch", {
      p_user_id: user.userId,
      p_request_id: requestId,
      p_token: token,
    });
    const call = vi.mocked(runGeneration).mock.calls[0];
    expect(call?.[0].functionTotalBudgetMs).toBe(120_000);
    expect(call?.[0].openRouterTimeoutMs).toBe(90_000);
    expect(call?.[1]).toEqual(command);
    expect(call?.[2]?.reservation?.request_id).toBe(requestId);
    expect(call?.[2]?.attemptTimeoutMs).toBe(90_000);
  });
  it("hydrates timestamps omitted by the real reservation RPC before claiming", async () => {
    replay.mockResolvedValue({ ...reservation, started_at: undefined, replayed: true });
    vi.mocked(deps.repository.status).mockResolvedValue({
      ...reservation,
      started_at: new Date(Date.now() - 20_000).toISOString(),
    });
    rpc.mockResolvedValue({ data: true, error: null });
    await executeMenuBackground(user, command, token);
    expect(runGeneration).toHaveBeenCalledTimes(1);
  });

  it("does not execute after another worker claimed", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await executeMenuBackground(user, command, token);
    expect(runGeneration).not.toHaveBeenCalled();
  });
  it("does not claim a tampered command", async () => {
    replay.mockRejectedValue(new Error("idempotency_payload_mismatch"));
    await expect(executeMenuBackground(user, command, token)).rejects.toThrow(
      "idempotency_payload_mismatch",
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(runGeneration).not.toHaveBeenCalled();
  });
  it.each(["succeeded", "failed"] as const)(
    "does not execute a terminal %s replay",
    async (status) => {
      replay.mockResolvedValue({ ...reservation, status });
      await executeMenuBackground(user, command, token);
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it("does not execute expired queued work", async () => {
    vi.mocked(deps.repository.status).mockResolvedValue({
      ...reservation,
      started_at: new Date(Date.now() - 120_000).toISOString(),
    });
    await executeMenuBackground(user, command, token);
    expect(rpc).not.toHaveBeenCalled();
  });
});
