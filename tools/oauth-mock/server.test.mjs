// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import fixture from "./fixtures/google-user.json" with { type: "json" };
import { createOAuthMockServer } from "./server.mjs";

let server;
const state = "state-value-must-have-at-least-32-chars";

afterEach(async () => {
  if (server !== undefined)
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
});

async function start(
  now = () => new Date("2026-07-11T00:00:00.000Z"),
  fixtureOverride = fixture,
  options = {},
) {
  server = createOAuthMockServer({
    appOrigin: "http://127.0.0.1:5173",
    fixture: fixtureOverride,
    now,
    issueLocalCredentials: vi.fn().mockResolvedValue({
      email: fixture.email,
      password: "local-random-password",
    }),
    ...options,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("oauth mock did not bind");
  return `http://127.0.0.1:${address.port}`;
}

async function approve(origin) {
  return fetch(
    `${origin}/authorize?${new URLSearchParams({
      redirect_uri: "http://127.0.0.1:5173/auth/callback",
      action: "approve",
      flow: "10000000-0000-4000-8000-000000000001",
      state,
    })}`,
    { redirect: "manual" },
  );
}

it("escapes fixture display names before rendering provider HTML", async () => {
  const origin = await start(undefined, {
    ...fixture,
    displayName: "<img src=x onerror=alert(1)>",
  });
  const response = await fetch(
    `${origin}/authorize?${new URLSearchParams({
      redirect_uri: "http://127.0.0.1:5173/auth/callback",
      flow: "10000000-0000-4000-8000-000000000001",
      state,
    })}`,
  );
  const html = await response.text();
  expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  expect(html).not.toContain("<img src=x onerror=alert(1)>");
});

it("redirects deterministic Google success and cancel to the exact app callback", async () => {
  const origin = await start();
  const common = new URLSearchParams({
    redirect_uri: "http://127.0.0.1:5173/auth/callback",
    flow: "10000000-0000-4000-8000-000000000001",
    state,
  });
  const success = await fetch(`${origin}/authorize?${common}&action=approve`, {
    redirect: "manual",
  });
  const successUrl = new URL(success.headers.get("location"));
  expect(successUrl.origin + successUrl.pathname).toBe("http://127.0.0.1:5173/auth/callback");
  expect(successUrl.searchParams.get("flow")).toBe(common.get("flow"));
  expect(successUrl.searchParams.get("state")).toBe(state);
  expect(successUrl.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(successUrl.href).not.toMatch(/token|password|email/iu);

  const cancel = await fetch(`${origin}/authorize?${common}&action=cancel`, { redirect: "manual" });
  expect(new URL(cancel.headers.get("location")).searchParams.get("error")).toBe("access_denied");
});

it("exchanges an opaque code once, from the canonical app origin, within 300 seconds", async () => {
  const origin = await start();
  const authorize = await approve(origin);
  const code = new URL(authorize.headers.get("location")).searchParams.get("code");
  const exchange = () =>
    fetch(`${origin}/exchange`, {
      method: "POST",
      headers: { origin: "http://127.0.0.1:5173", "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
  expect((await exchange()).status).toBe(200);
  expect((await exchange()).status).toBe(404);
  expect(
    (
      await fetch(`${origin}/exchange`, {
        method: "POST",
        headers: { origin: "https://evil.example", "content-type": "application/json" },
        body: JSON.stringify({ code: "A".repeat(43) }),
      })
    ).status,
  ).toBe(403);
});

it("rejects new approval codes when the pending-code capacity is reached", async () => {
  const origin = await start(undefined, fixture, { maxPendingCodes: 1 });
  expect((await approve(origin)).status).toBe(302);
  const full = await approve(origin);
  expect(full.status).toBe(429);
  expect(await full.json()).toEqual({ error: "code_capacity_exceeded" });
});

it("removes expired approval codes before checking pending-code capacity", async () => {
  let current = new Date("2026-07-11T00:00:00.000Z");
  const origin = await start(() => current, fixture, { maxPendingCodes: 1 });
  const first = await approve(origin);
  const firstCode = new URL(first.headers.get("location")).searchParams.get("code");
  current = new Date("2026-07-11T00:05:00.001Z");
  const replacement = await approve(origin);
  expect(replacement.status).toBe(302);
  const expired = await fetch(`${origin}/exchange`, {
    method: "POST",
    headers: { origin: "http://127.0.0.1:5173", "content-type": "application/json" },
    body: JSON.stringify({ code: firstCode }),
  });
  expect(expired.status).toBe(404);
});
