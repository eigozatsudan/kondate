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

const { default: maintenanceCleanup, config } = await import("../maintenance-cleanup.js");

afterEach(() => {
  vi.clearAllMocks();
  logLines.length = 0;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_MAINTENANCE_DB_URL;
  delete process.env.CONTEXT;
  delete process.env.KONDATE_MAINTENANCE_ENV;
});

describe("maintenance-cleanup scheduled function", () => {
  it("returns 204 and logs four snake_case aggregates only on success", async () => {
    selectMaintenanceEnvironmentMode.mockReturnValue("local");
    parseMaintenanceDatabaseEnv.mockReturnValue("postgresql://opaque");
    runMaintenance.mockResolvedValue({
      staleReservationsFinalized: 1,
      generationLedgersDeleted: 2,
      shoppingMutationsDeleted: 3,
      authContinuationsDeleted: 4,
    });

    const response = await maintenanceCleanup();
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
        "duration_ms",
        "generation_ledgers_deleted",
        "level",
        "request_id",
        "shopping_mutations_deleted",
        "stale_reservations_finalized",
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
    });
    expect(parsed).not.toHaveProperty("durationMs");
    expect(parsed).not.toHaveProperty("errorCode");
  });

  it("returns 500 and logs closed failure without counts or driver text", async () => {
    selectMaintenanceEnvironmentMode.mockReturnValue("production");
    parseManagedSupabaseProjectRef.mockReturnValue("abcdefghijklmnopqrst");
    parseMaintenanceDatabaseEnv.mockReturnValue("postgresql://opaque");
    runMaintenance.mockRejectedValue(
      new Error("password=supersecret host=db.abcdefghijklmnopqrst.supabase.co"),
    );

    const response = await maintenanceCleanup();
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
    process.env.SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
    selectMaintenanceEnvironmentMode.mockReturnValue("production");
    parseManagedSupabaseProjectRef.mockReturnValue("abcdefghijklmnopqrst");
    parseMaintenanceDatabaseEnv.mockReturnValue("postgresql://opaque");
    runMaintenance.mockResolvedValue({
      staleReservationsFinalized: 0,
      generationLedgersDeleted: 0,
      shoppingMutationsDeleted: 0,
      authContinuationsDeleted: 0,
    });
    await maintenanceCleanup();
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
});
