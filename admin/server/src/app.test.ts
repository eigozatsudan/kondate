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

describe("shared-recipes routes", () => {
  it("does not register shared-recipes when localToken is null", async () => {
    const app = createApp({
      pool: null,
      config: { ...baseConfig, localToken: null },
      dbReady: false,
    });
    const res = await app.request(
      "http://127.0.0.1:5193/api/shared-recipes?from=2026-08-01&to=2026-08-07",
      { headers: { host: "127.0.0.1:5193" } },
    );
    expect(res.status).toBe(404);
  });

  it("requires bearer for shared-recipes when token configured", async () => {
    const app = createApp({ pool: null, config: baseConfig, dbReady: false });
    const denied = await app.request(
      "http://127.0.0.1:5193/api/shared-recipes?from=2026-08-01&to=2026-08-07",
      { headers: { host: "127.0.0.1:5193" } },
    );
    expect(denied.status).toBe(401);
  });

  it("rejects shared-recipes without date range with date_range_required", async () => {
    // pool null でも date 検証が先。code を固定して db_unavailable の偽 green を防ぐ
    const app = createApp({ pool: null, config: baseConfig, dbReady: false });
    const headers = {
      host: "127.0.0.1:5193",
      authorization: "Bearer test-token-32chars-minimum-ok",
    };
    const bothMissing = await app.request(
      "http://127.0.0.1:5193/api/shared-recipes",
      { headers },
    );
    expect(bothMissing.status).toBe(400);
    expect(
      ((await bothMissing.json()) as { error: { code: string } }).error.code,
    ).toBe("date_range_required");

    const oneSided = await app.request(
      "http://127.0.0.1:5193/api/shared-recipes?from=2026-08-01",
      { headers },
    );
    expect(oneSided.status).toBe(400);
    expect(
      ((await oneSided.json()) as { error: { code: string } }).error.code,
    ).toBe("date_range_required");
  });

  it("rejects invalid status on shared-recipes", async () => {
    const app = createApp({ pool: null, config: baseConfig, dbReady: false });
    const res = await app.request(
      "http://127.0.0.1:5193/api/shared-recipes?from=2026-08-01&to=2026-08-07&status=nope",
      {
        headers: {
          host: "127.0.0.1:5193",
          authorization: "Bearer test-token-32chars-minimum-ok",
        },
      },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "invalid_status",
    );
  });

  it("rejects invalid mealType on shared-recipes", async () => {
    const app = createApp({ pool: null, config: baseConfig, dbReady: false });
    const res = await app.request(
      "http://127.0.0.1:5193/api/shared-recipes?from=2026-08-01&to=2026-08-07&mealType=brunch",
      {
        headers: {
          host: "127.0.0.1:5193",
          authorization: "Bearer test-token-32chars-minimum-ok",
        },
      },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "invalid_meal_type",
    );
  });

  it("returns 400 for non-uuid shared recipe id", async () => {
    // UUID 検証は requirePool より先。pool null でも invalid_id になる
    const app = createApp({ pool: null, config: baseConfig, dbReady: false });
    const headers = {
      host: "127.0.0.1:5193",
      authorization: "Bearer test-token-32chars-minimum-ok",
    };
    const short = await app.request(
      "http://127.0.0.1:5193/api/shared-recipes/not-a-uuid",
      { headers },
    );
    expect(short.status).toBe(400);
    expect(
      ((await short.json()) as { error: { code: string } }).error.code,
    ).toBe("invalid_id");

    // 36 文字だが 8-4-4-4-12 でない（旧 regex は通過して PG cast 500 になり得た）
    const hyphens = await app.request(
      "http://127.0.0.1:5193/api/shared-recipes/------------------------------------",
      { headers },
    );
    expect(hyphens.status).toBe(400);
    expect(
      ((await hyphens.json()) as { error: { code: string } }).error.code,
    ).toBe("invalid_id");
  });
});
