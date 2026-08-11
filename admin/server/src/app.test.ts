import { describe, it, expect } from "vitest";
import { createApp } from "./app.js";
import type { AdminConfig } from "./config.js";

const baseConfig: AdminConfig = {
  databaseUrl:
    "postgresql://kondate_ops_readonly:x@127.0.0.1:5432/postgres?sslmode=disable",
  port: 5193,
  bindHost: "0.0.0.0",
  localToken: "test-token-32chars-minimum-ok",
  allowInsecureLocalDb: true,
};

describe("createApp security", () => {
  it("rejects bad Host", async () => {
    const app = createApp({ pool: null, config: baseConfig, dbReady: false });
    const res = await app.request("http://evil.example/api/health", {
      headers: { host: "evil.example" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects POST", async () => {
    const app = createApp({ pool: null, config: baseConfig, dbReady: false });
    const res = await app.request("http://127.0.0.1:5193/api/health", {
      method: "POST",
      headers: {
        host: "127.0.0.1:5193",
        authorization: "Bearer test-token-32chars-minimum-ok",
      },
    });
    expect([404, 405]).toContain(res.status);
  });

  it("allows GET health without token", async () => {
    const app = createApp({ pool: null, config: baseConfig, dbReady: false });
    const res = await app.request("http://127.0.0.1:5193/api/health", {
      headers: { host: "127.0.0.1:5193" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("requires token on non-health api when configured", async () => {
    const app = createApp({
      pool: null,
      config: baseConfig,
      dbReady: false,
      registerRoutes: (app) => {
        app.get("/api/dashboard", (c) => c.json({ ok: true, data: {} }));
      },
    });
    const denied = await app.request("http://127.0.0.1:5193/api/dashboard", {
      headers: { host: "127.0.0.1:5193" },
    });
    expect(denied.status).toBe(401);

    const ok = await app.request("http://127.0.0.1:5193/api/dashboard", {
      headers: {
        host: "127.0.0.1:5193",
        authorization: "Bearer test-token-32chars-minimum-ok",
      },
    });
    expect(ok.status).toBe(200);
  });

  it("allows localhost Host", async () => {
    const app = createApp({ pool: null, config: baseConfig, dbReady: true });
    const res = await app.request("http://localhost:5193/api/health", {
      headers: { host: "localhost:5193" },
    });
    expect(res.status).toBe(200);
  });
});
