import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  decideServiceWorkerFetch,
  isApiPath,
  isAuthCallbackPath,
  SHELL_PATH,
  type SwFetchDecision,
} from "./service-worker-routing";

const SELF_ORIGIN = "https://kondate.example";
const OTHER_ORIGIN = "https://other.example";
const PRECACHE_PATHNAMES = new Set(["/", "/assets/index-abc.js", "/manifest.webmanifest"]);

function decide(
  overrides: Partial<Parameters<typeof decideServiceWorkerFetch>[0]>,
): SwFetchDecision {
  return decideServiceWorkerFetch({
    method: "GET",
    origin: SELF_ORIGIN,
    selfOrigin: SELF_ORIGIN,
    pathname: "/",
    mode: "cors",
    precachePathnames: PRECACHE_PATHNAMES,
    ...overrides,
  });
}

describe("SHELL_PATH", () => {
  it("is the document root", () => {
    expect(SHELL_PATH).toBe("/");
  });
});

describe("isApiPath", () => {
  it("matches /api and /api/ prefixes only", () => {
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/api/")).toBe(true);
    expect(isApiPath("/api/usage-today")).toBe(true);
    expect(isApiPath("/apifake")).toBe(false);
    expect(isApiPath("/planner")).toBe(false);
  });
});

describe("isAuthCallbackPath", () => {
  it("matches exact callback paths including a trailing slash", () => {
    expect(isAuthCallbackPath("/auth/callback")).toBe(true);
    expect(isAuthCallbackPath("/auth/callback/")).toBe(true);
    expect(isAuthCallbackPath("/auth/callback/extra")).toBe(false);
    expect(isAuthCallbackPath("/login")).toBe(false);
  });
});

describe("decideServiceWorkerFetch", () => {
  it("passes non-GET through before any path check", () => {
    expect(decide({ method: "POST", pathname: "/planner", mode: "navigate" })).toEqual({
      action: "passthrough",
    });
    expect(decide({ method: "HEAD", pathname: "/assets/index-abc.js" })).toEqual({
      action: "passthrough",
    });
  });

  it("passes other origins through before path checks", () => {
    expect(
      decide({
        origin: OTHER_ORIGIN,
        pathname: "/planner",
        mode: "navigate",
      }),
    ).toEqual({ action: "passthrough" });
  });

  it("passes API and auth callback navigations through so respondWith is not used", () => {
    expect(decide({ pathname: "/api/usage-today", mode: "navigate" })).toEqual({
      action: "passthrough",
    });
    expect(decide({ pathname: "/api", mode: "navigate" })).toEqual({
      action: "passthrough",
    });
    expect(decide({ pathname: "/auth/callback", mode: "navigate" })).toEqual({
      action: "passthrough",
    });
    expect(decide({ pathname: "/auth/callback/", mode: "navigate" })).toEqual({
      action: "passthrough",
    });
  });

  it("uses the shell fallback only for same-origin navigations past the API and callback gates", () => {
    expect(decide({ pathname: "/planner", mode: "navigate" })).toEqual({
      action: "navigate-network-then-shell",
    });
    expect(decide({ pathname: "/", mode: "navigate" })).toEqual({
      action: "navigate-network-then-shell",
    });
  });

  it("serves precached static GET from the allowlist cache-first", () => {
    expect(decide({ pathname: "/assets/index-abc.js", mode: "cors" })).toEqual({
      action: "cache-first-precache",
    });
  });

  it("passes non-precache static GET such as images and fonts", () => {
    expect(decide({ pathname: "/assets/hero.webp", mode: "cors" })).toEqual({
      action: "passthrough",
    });
    expect(decide({ pathname: "/fonts/x.woff2", mode: "cors" })).toEqual({
      action: "passthrough",
    });
  });

  it("does not touch Cache Storage", () => {
    const original = globalThis.caches;
    const match = vi.fn();
    const open = vi.fn();
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: { match, open },
    });
    try {
      decide({ pathname: "/planner", mode: "navigate" });
      decide({ pathname: "/assets/index-abc.js" });
      expect(match).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "caches", {
        configurable: true,
        value: original,
      });
    }
  });
});

describe("src/pwa fetch handlers", () => {
  it("forbids global caches.match and update-claiming APIs while keeping own-cache match", async () => {
    const [routing, worker] = await Promise.all([
      readFile("src/pwa/service-worker-routing.ts", "utf8"),
      readFile("src/pwa/service-worker.ts", "utf8"),
    ]);
    const joined = `${routing}\n${worker}`;
    expect(joined).not.toContain("caches.match(");
    expect(joined).not.toContain("skipWaiting");
    expect(joined).not.toContain("clients.claim");
    expect(joined).not.toContain("cache.put");
    expect(worker).toContain("caches.open(CACHE_NAME)");
    expect(worker).toContain("cache.match(SHELL_URL)");
    expect(worker).toContain("cache.match(event.request, { ignoreSearch: true })");
  });
});
