/**
 * Service Worker の fetch 判定だけを置く純関数。
 * Cache Storage は触らない。SW 本体がこの結果で respondWith するかを決める。
 * 判定順は非 GET → 他 origin → API / callback → navigate → 静的許可リスト。
 * API と callback を navigate より前に置くのは、失敗時にシェル HTML を返さないため。
 */

export type SwFetchDecision =
  | { action: "passthrough" }
  | { action: "navigate-network-then-shell" }
  | { action: "cache-first-precache" };

/** Precache してよい文書は `/` 1 枚だけ。`/index.html` は Pretty URL の 301 を避ける。 */
export const SHELL_PATH = "/";

export function isAuthCallbackPath(pathname: string): boolean {
  return pathname === "/auth/callback" || pathname === "/auth/callback/";
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function decideServiceWorkerFetch(input: {
  method: string;
  origin: string;
  selfOrigin: string;
  pathname: string;
  mode: string;
  precachePathnames: ReadonlySet<string>;
}): SwFetchDecision {
  if (input.method !== "GET") {
    return { action: "passthrough" };
  }
  if (input.origin !== input.selfOrigin) {
    return { action: "passthrough" };
  }
  if (isApiPath(input.pathname) || isAuthCallbackPath(input.pathname)) {
    return { action: "passthrough" };
  }
  if (input.mode === "navigate") {
    return { action: "navigate-network-then-shell" };
  }
  if (input.precachePathnames.has(input.pathname)) {
    return { action: "cache-first-precache" };
  }
  return { action: "passthrough" };
}
