import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const runMaintenance = vi.fn();
const parseManagedSupabaseProjectRef = vi.fn();
const parseMaintenanceDatabaseEnv = vi.fn();
const selectMaintenanceEnvironmentMode = vi.fn();
const logLines: string[] = [];

vi.mock("../_shared/maintenance-db.js", () => ({ runMaintenance }));
vi.mock("../_shared/env.js", () => ({ parseManagedSupabaseProjectRef }));
vi.mock("../_shared/maintenance-env.js", () => ({
  parseMaintenanceDatabaseEnv,
  selectMaintenanceEnvironmentMode,
}));
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
  default: maintenanceCleanup,
  config,
  MAINTENANCE_CRON_SECRET_ENV,
  MAINTENANCE_CRON_SECRET_HEADER,
  authorizeMaintenanceCleanup,
} = await import("../maintenance-cleanup.js");

const VALID_SECRET = "maintenance-cron-secret-32chars!!";

function authorizedRequest(overrides: HeadersInit = {}): Request {
  // HeadersInit は配列も取りうるため object spread せず Headers で合成する
  const headers = new Headers({
    [MAINTENANCE_CRON_SECRET_HEADER]: VALID_SECRET,
  });
  new Headers(overrides).forEach((value, key) => {
    headers.set(key, value);
  });
  return new Request("http://127.0.0.1/.netlify/functions/maintenance-cleanup", {
    method: "POST",
    headers,
  });
}

afterEach(() => {
  vi.clearAllMocks();
  logLines.length = 0;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_MAINTENANCE_DB_URL;
  delete process.env.CONTEXT;
  delete process.env.KONDATE_MAINTENANCE_ENV;
  // 静的キーで delete（no-dynamic-delete）。値は MAINTENANCE_CRON_SECRET_ENV と同一
  delete process.env.MAINTENANCE_CRON_SECRET;
});

describe("maintenance-cleanup scheduled function", () => {
  it("returns 204 and logs eight snake_case aggregates only on success", async () => {
    process.env[MAINTENANCE_CRON_SECRET_ENV] = VALID_SECRET;
    selectMaintenanceEnvironmentMode.mockReturnValue("local");
    parseMaintenanceDatabaseEnv.mockReturnValue("postgresql://opaque");
    runMaintenance.mockResolvedValue({
      staleReservationsFinalized: 1,
      generationLedgersDeleted: 2,
      shoppingMutationsDeleted: 3,
      authContinuationsDeleted: 4,
      userFeedbackDeleted: 5,
      draftSubmissionsDeleted: 6,
      identityLedgersDeleted: 7,
      flyerLedgersDeleted: 8,
    });

    const response = await maintenanceCleanup(authorizedRequest());
    expect(response.status).toBe(204);
    expect(runMaintenance).toHaveBeenCalledTimes(1);
    expect(runMaintenance.mock.calls[0]?.[0]).toMatchObject({
      connectionString: "postgresql://opaque",
      batchSize: 250,
    });
    expect(logLines).toHaveLength(1);
    const parsed = JSON.parse(logLines[0]!) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(
      [
        "auth_continuations_deleted",
        "code",
        "draft_submissions_deleted",
        "duration_ms",
        "flyer_ledgers_deleted",
        "generation_ledgers_deleted",
        "identity_ledgers_deleted",
        "level",
        "request_id",
        "shopping_mutations_deleted",
        "stale_reservations_finalized",
        "user_feedback_deleted",
      ].sort(),
    );
    expect(parsed).toMatchObject({
      level: "info",
      request_id: "maintenance",
      code: "maintenance_cleanup",
      stale_reservations_finalized: 1,
      generation_ledgers_deleted: 2,
      shopping_mutations_deleted: 3,
      auth_continuations_deleted: 4,
      identity_ledgers_deleted: 7,
      flyer_ledgers_deleted: 8,
    });
    expect(parsed).not.toHaveProperty("durationMs");
    expect(parsed).not.toHaveProperty("errorCode");
  });

  it("returns 500 and logs closed failure without counts or driver text", async () => {
    process.env[MAINTENANCE_CRON_SECRET_ENV] = VALID_SECRET;
    selectMaintenanceEnvironmentMode.mockReturnValue("production");
    parseManagedSupabaseProjectRef.mockReturnValue("abcdefghijklmnopqrst");
    parseMaintenanceDatabaseEnv.mockReturnValue("postgresql://opaque");
    runMaintenance.mockRejectedValue(
      new Error("password=supersecret host=db.abcdefghijklmnopqrst.supabase.co"),
    );

    const response = await maintenanceCleanup(authorizedRequest());
    expect(response.status).toBe(500);
    expect(logLines).toHaveLength(1);
    const parsed = JSON.parse(logLines[0]!) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      level: "error",
      request_id: "maintenance",
      code: "maintenance_cleanup_failed",
    });
    expect(parsed).not.toHaveProperty("stale_reservations_finalized");
    expect(JSON.stringify(parsed)).not.toContain("password");
    expect(JSON.stringify(parsed)).not.toContain("abcdefghijklmnopqrst");
  });

  it("uses production project-ref binding when not in local mode", async () => {
    process.env[MAINTENANCE_CRON_SECRET_ENV] = VALID_SECRET;
    process.env.SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
    selectMaintenanceEnvironmentMode.mockReturnValue("production");
    parseManagedSupabaseProjectRef.mockReturnValue("abcdefghijklmnopqrst");
    parseMaintenanceDatabaseEnv.mockReturnValue("postgresql://opaque");
    runMaintenance.mockResolvedValue({
      staleReservationsFinalized: 0,
      generationLedgersDeleted: 0,
      shoppingMutationsDeleted: 0,
      authContinuationsDeleted: 0,
      userFeedbackDeleted: 0,
      draftSubmissionsDeleted: 0,
      identityLedgersDeleted: 0,
      flyerLedgersDeleted: 0,
    });
    await maintenanceCleanup(authorizedRequest());
    expect(parseManagedSupabaseProjectRef).toHaveBeenCalled();
    expect(parseMaintenanceDatabaseEnv).toHaveBeenCalledWith(
      process.env,
      expect.objectContaining({
        mode: "production",
        expectedProjectRef: "abcdefghijklmnopqrst",
      }),
    );
  });

  it("exports schedule-only config without path", () => {
    expect(config).toEqual({ schedule: "@hourly" });
    expect(config).not.toHaveProperty("path");
  });

  it("handler source has no console.* and no Supabase admin/REST client import", () => {
    const source = readFileSync(
      resolve(process.cwd(), "netlify/functions/maintenance-cleanup.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/console\./u);
    expect(source).not.toMatch(/supabase-admin/u);
    expect(source).not.toMatch(/createClient/u);
    // Scheduled Function は published production のみ。ローカルは netlify functions:invoke。
    expect(source).toContain('schedule: "@hourly"');
  });

  it("returns 401 when secret header and schedule event are both missing (S3)", async () => {
    process.env[MAINTENANCE_CRON_SECRET_ENV] = VALID_SECRET;
    const response = await maintenanceCleanup(
      new Request("http://127.0.0.1/.netlify/functions/maintenance-cleanup", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(401);
    expect(runMaintenance).not.toHaveBeenCalled();
    const parsed = JSON.parse(logLines[0]!) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      level: "warn",
      code: "maintenance_cleanup_unauthorized",
    });
  });

  it("returns 403 when secret header is wrong (S3)", async () => {
    process.env[MAINTENANCE_CRON_SECRET_ENV] = VALID_SECRET;
    const response = await maintenanceCleanup(
      new Request("http://127.0.0.1/.netlify/functions/maintenance-cleanup", {
        method: "POST",
        headers: { [MAINTENANCE_CRON_SECRET_HEADER]: "wrong-secret-value-xxxxx" },
      }),
    );
    expect(response.status).toBe(403);
    expect(runMaintenance).not.toHaveBeenCalled();
    const parsed = JSON.parse(logLines[0]!) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      level: "warn",
      code: "maintenance_cleanup_forbidden",
    });
  });

  it("returns 403 when MAINTENANCE_CRON_SECRET env is missing (S3 fail-closed)", async () => {
    delete process.env.MAINTENANCE_CRON_SECRET;
    const response = await maintenanceCleanup(authorizedRequest());
    expect(response.status).toBe(403);
    expect(runMaintenance).not.toHaveBeenCalled();
  });

  it("accepts Netlify schedule event when env secret is configured (S3 dual)", async () => {
    process.env[MAINTENANCE_CRON_SECRET_ENV] = VALID_SECRET;
    selectMaintenanceEnvironmentMode.mockReturnValue("local");
    parseMaintenanceDatabaseEnv.mockReturnValue("postgresql://opaque");
    runMaintenance.mockResolvedValue({
      staleReservationsFinalized: 0,
      generationLedgersDeleted: 0,
      shoppingMutationsDeleted: 0,
      authContinuationsDeleted: 0,
      userFeedbackDeleted: 0,
      draftSubmissionsDeleted: 0,
      identityLedgersDeleted: 0,
      flyerLedgersDeleted: 0,
    });
    const response = await maintenanceCleanup(
      new Request("http://127.0.0.1/.netlify/functions/maintenance-cleanup", {
        method: "POST",
        headers: { "x-netlify-event": "schedule" },
      }),
    );
    expect(response.status).toBe(204);
    expect(runMaintenance).toHaveBeenCalledTimes(1);
  });

  it("authorizeMaintenanceCleanup rejects short secrets", () => {
    expect(
      authorizeMaintenanceCleanup(authorizedRequest(), {
        [MAINTENANCE_CRON_SECRET_ENV]: "tooshort",
      }),
    ).toBe("forbidden");
  });
});
