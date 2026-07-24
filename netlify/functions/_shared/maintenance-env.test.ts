import { describe, expect, it } from "vitest";
import {
  parseMaintenanceDatabaseEnv,
  selectMaintenanceEnvironmentMode,
} from "./maintenance-env.js";

const projectRef = "abcdefghijklmnopqrst";
const otherRef = "zyxwvutsrqponmlkjihg";
const password = "secret-pass";

const localUrl = `postgresql://kondate_maintenance_login:${password}@db:5432/postgres?sslmode=disable`;
const directUrl = `postgresql://kondate_maintenance_login:${password}@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`;
const sessionUrl = `postgresql://kondate_maintenance_login.${projectRef}:${password}@ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require`;

describe("selectMaintenanceEnvironmentMode", () => {
  it("returns local only for CONTEXT=dev and KONDATE_MAINTENANCE_ENV=local", () => {
    expect(
      selectMaintenanceEnvironmentMode({
        CONTEXT: "dev",
        KONDATE_MAINTENANCE_ENV: "local",
      }),
    ).toBe("local");
  });

  it.each([
    [{ CONTEXT: "dev" }],
    [{ KONDATE_MAINTENANCE_ENV: "local" }],
    [{ CONTEXT: "production", KONDATE_MAINTENANCE_ENV: "local" }],
    [{ CONTEXT: "deploy-preview", KONDATE_MAINTENANCE_ENV: "local" }],
    [{ CONTEXT: "branch-deploy", KONDATE_MAINTENANCE_ENV: "local" }],
    [{ CONTEXT: "dev", KONDATE_MAINTENANCE_ENV: "production" }],
    [{}],
  ] as const)("selects production for %j", (env) => {
    expect(selectMaintenanceEnvironmentMode(env)).toBe("production");
  });
});

describe("parseMaintenanceDatabaseEnv local", () => {
  it("accepts the container-internal canonical address", () => {
    expect(
      parseMaintenanceDatabaseEnv({ SUPABASE_MAINTENANCE_DB_URL: localUrl }, { mode: "local" }),
    ).toBe(localUrl);
  });

  it.each([
    [
      "localhost",
      `postgresql://kondate_maintenance_login:${password}@localhost:5432/postgres?sslmode=disable`,
    ],
    [
      "127.0.0.1",
      `postgresql://kondate_maintenance_login:${password}@127.0.0.1:5432/postgres?sslmode=disable`,
    ],
    [
      "host port mapping",
      `postgresql://kondate_maintenance_login:${password}@db:54322/postgres?sslmode=disable`,
    ],
    ["wrong user", `postgresql://postgres:${password}@db:5432/postgres?sslmode=disable`],
    [
      "tls local",
      `postgresql://kondate_maintenance_login:${password}@db:5432/postgres?sslmode=require`,
    ],
  ] as const)("rejects %s", (_label, url) => {
    expect(() =>
      parseMaintenanceDatabaseEnv({ SUPABASE_MAINTENANCE_DB_URL: url }, { mode: "local" }),
    ).toThrow("maintenance_db_url_invalid");
  });

  it("rejects VITE_SUPABASE_MAINTENANCE_DB_URL even when empty", () => {
    expect(() =>
      parseMaintenanceDatabaseEnv(
        {
          SUPABASE_MAINTENANCE_DB_URL: localUrl,
          VITE_SUPABASE_MAINTENANCE_DB_URL: "",
        },
        { mode: "local" },
      ),
    ).toThrow("maintenance_db_url_invalid");
  });

  it("does not put URL details in the error", () => {
    try {
      parseMaintenanceDatabaseEnv(
        {
          SUPABASE_MAINTENANCE_DB_URL: `postgresql://kondate_maintenance_login:${password}@localhost:5432/postgres?sslmode=disable`,
        },
        { mode: "local" },
      );
      expect.unreachable();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe("maintenance_db_url_invalid");
      expect(message).not.toContain(password);
      expect(message).not.toContain("localhost");
    }
  });
});

describe("parseMaintenanceDatabaseEnv production", () => {
  it("accepts direct managed host with matching project ref", () => {
    expect(
      parseMaintenanceDatabaseEnv(
        { SUPABASE_MAINTENANCE_DB_URL: directUrl },
        { mode: "production", expectedProjectRef: projectRef },
      ),
    ).toBe(directUrl);
  });

  it("accepts Supavisor Session URL with matching project-ref suffix", () => {
    expect(
      parseMaintenanceDatabaseEnv(
        { SUPABASE_MAINTENANCE_DB_URL: sessionUrl },
        { mode: "production", expectedProjectRef: projectRef },
      ),
    ).toBe(sessionUrl);
  });

  it.each(["require", "verify-ca", "verify-full"] as const)("accepts sslmode=%s", (sslmode) => {
    const url = directUrl.replace("sslmode=require", `sslmode=${sslmode}`);
    expect(
      parseMaintenanceDatabaseEnv(
        { SUPABASE_MAINTENANCE_DB_URL: url },
        { mode: "production", expectedProjectRef: projectRef },
      ),
    ).toBe(url);
  });

  it.each([
    [
      "other direct ref",
      `postgresql://kondate_maintenance_login:${password}@db.${otherRef}.supabase.co:5432/postgres?sslmode=require`,
    ],
    [
      "other session ref",
      `postgresql://kondate_maintenance_login.${otherRef}:${password}@ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require`,
    ],
    [
      "transaction port",
      `postgresql://kondate_maintenance_login:${password}@db.${projectRef}.supabase.co:6543/postgres?sslmode=require`,
    ],
    [
      "transaction pooler user shape",
      `postgresql://postgres.${projectRef}:${password}@ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require`,
    ],
    [
      "wrong login user",
      `postgresql://postgres:${password}@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
    ],
    [
      "disable ssl",
      `postgresql://kondate_maintenance_login:${password}@db.${projectRef}.supabase.co:5432/postgres?sslmode=disable`,
    ],
    [
      "options override",
      `postgresql://kondate_maintenance_login:${password}@db.${projectRef}.supabase.co:5432/postgres?sslmode=require&options=-csearch_path%3Dpublic`,
    ],
    [
      "fragment",
      `postgresql://kondate_maintenance_login:${password}@db.${projectRef}.supabase.co:5432/postgres?sslmode=require#x`,
    ],
    [
      "duplicate sslmode",
      `postgresql://kondate_maintenance_login:${password}@db.${projectRef}.supabase.co:5432/postgres?sslmode=require&sslmode=require`,
    ],
    [
      "loopback production",
      `postgresql://kondate_maintenance_login:${password}@127.0.0.1:5432/postgres?sslmode=require`,
    ],
  ] as const)("rejects %s", (_label, url) => {
    expect(() =>
      parseMaintenanceDatabaseEnv(
        { SUPABASE_MAINTENANCE_DB_URL: url },
        { mode: "production", expectedProjectRef: projectRef },
      ),
    ).toThrow("maintenance_db_url_invalid");
  });

  it("rejects missing expected project ref before URL inspection", () => {
    expect(() =>
      parseMaintenanceDatabaseEnv(
        { SUPABASE_MAINTENANCE_DB_URL: directUrl },
        { mode: "production", expectedProjectRef: "" },
      ),
    ).toThrow("maintenance_db_url_invalid");
  });

  it("rejects VITE_SUPABASE_MAINTENANCE_DB_URL even when empty", () => {
    expect(() =>
      parseMaintenanceDatabaseEnv(
        {
          SUPABASE_MAINTENANCE_DB_URL: directUrl,
          VITE_SUPABASE_MAINTENANCE_DB_URL: "",
        },
        { mode: "production", expectedProjectRef: projectRef },
      ),
    ).toThrow("maintenance_db_url_invalid");
  });
});
