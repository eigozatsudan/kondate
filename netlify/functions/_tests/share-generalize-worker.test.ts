import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const claimShareGeneralizationJobs = vi.fn();
const getSupabaseAdmin = vi.fn(() => ({ rpc: vi.fn() }));
const logLines: string[] = [];

vi.mock("../_shared/share-claim.js", () => ({ claimShareGeneralizationJobs }));
vi.mock("../_shared/supabase-admin.js", () => ({ getSupabaseAdmin }));
vi.mock("../_shared/logger.js", async () => {
  const actual =
    await vi.importActual<typeof import("../_shared/logger.js")>("../_shared/logger.js");
  return {
    ...actual,
    safeLog: actual.createSafeLogger((line) => {
      logLines.push(line);
    }),
  };
});

const {
  default: shareGeneralizeWorker,
  config,
  SHARE_WORKER_CRON_SECRET_ENV,
  SHARE_WORKER_CRON_SECRET_HEADER,
  authorizeShareGeneralizeWorker,
} = await import("../share-generalize-worker.js");

const VALID_SECRET = "share-worker-cron-secret-32ch!!";

function authorizedRequest(overrides: HeadersInit = {}): Request {
  const headers = new Headers({
    [SHARE_WORKER_CRON_SECRET_HEADER]: VALID_SECRET,
  });
  new Headers(overrides).forEach((value, key) => {
    headers.set(key, value);
  });
  return new Request("http://127.0.0.1/.netlify/functions/share-generalize-worker", {
    method: "POST",
    headers,
  });
}

afterEach(() => {
  vi.clearAllMocks();
  logLines.length = 0;
  delete process.env.SHARE_WORKER_CRON_SECRET;
});

describe("share-generalize-worker (claim-only skeleton)", () => {
  it("claims jobs and logs count only (no job ids or titles)", async () => {
    process.env[SHARE_WORKER_CRON_SECRET_ENV] = VALID_SECRET;
    claimShareGeneralizationJobs.mockResolvedValue([
      {
        id: "d1000000-0000-4000-8000-000000000001",
        source_menu_id: "b1000000-0000-4000-8000-0000000000b1",
        contributor_user_id: "a1000000-0000-4000-8000-0000000000a1",
        status: "running",
        claimed_at: "2026-08-01T12:00:00.000Z",
        heartbeat_at: "2026-08-01T12:00:00.000Z",
        created_at: "2026-08-01T11:00:00.000Z",
      },
    ]);

    const response = await shareGeneralizeWorker(authorizedRequest());
    expect(response.status).toBe(204);
    expect(claimShareGeneralizationJobs).toHaveBeenCalledTimes(1);
    expect(getSupabaseAdmin).toHaveBeenCalledTimes(1);

    const parsed = JSON.parse(logLines[0]!) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      level: "info",
      request_id: "share-worker",
      code: "share_generalize_worker_claim",
      candidate_count: 1,
    });
    expect(JSON.stringify(parsed)).not.toContain("d1000000");
    expect(JSON.stringify(parsed)).not.toContain("肉じゃが");
  });

  it("returns 500 and closed failure log when claim throws", async () => {
    process.env[SHARE_WORKER_CRON_SECRET_ENV] = VALID_SECRET;
    claimShareGeneralizationJobs.mockRejectedValue(new Error("share_claim_failed"));
    const response = await shareGeneralizeWorker(authorizedRequest());
    expect(response.status).toBe(500);
    const parsed = JSON.parse(logLines[0]!) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      level: "error",
      code: "share_generalize_worker_failed",
    });
  });

  it("returns 401 without secret or schedule event", async () => {
    process.env[SHARE_WORKER_CRON_SECRET_ENV] = VALID_SECRET;
    const response = await shareGeneralizeWorker(
      new Request("http://127.0.0.1/.netlify/functions/share-generalize-worker", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(401);
    expect(claimShareGeneralizationJobs).not.toHaveBeenCalled();
  });

  it("accepts Netlify schedule event when env secret is set", async () => {
    process.env[SHARE_WORKER_CRON_SECRET_ENV] = VALID_SECRET;
    claimShareGeneralizationJobs.mockResolvedValue([]);
    const response = await shareGeneralizeWorker(
      new Request("http://127.0.0.1/.netlify/functions/share-generalize-worker", {
        method: "POST",
        headers: { "x-netlify-event": "schedule" },
      }),
    );
    expect(response.status).toBe(204);
    expect(claimShareGeneralizationJobs).toHaveBeenCalledTimes(1);
  });

  it("exports schedule-only config without path", () => {
    expect(config).toEqual({ schedule: "@hourly" });
    expect(config).not.toHaveProperty("path");
  });

  it("handler source has no OpenRouter or pipeline imports", () => {
    const source = readFileSync(
      resolve(process.cwd(), "netlify/functions/share-generalize-worker.ts"),
      "utf8",
    );
    const importSpecifiers = [
      ...source.matchAll(/from\s+["']([^"']+)["']/gu),
      ...source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/gu),
    ].map((match) => match[1]!);
    expect(importSpecifiers.some((s) => /openrouter/i.test(s))).toBe(false);
    expect(importSpecifiers.some((s) => s.includes("share-generalize-pipeline"))).toBe(false);
    expect(source).not.toMatch(/reserve_ai_generation/u);
    expect(source).toMatch(/claimShareGeneralizationJobs/);
  });

  it("authorizeShareGeneralizeWorker rejects short secrets", () => {
    expect(
      authorizeShareGeneralizeWorker(authorizedRequest(), {
        [SHARE_WORKER_CRON_SECRET_ENV]: "tooshort",
      }),
    ).toBe("forbidden");
  });
});
