// define 定数は ambient。WebWorker lib を app tsconfig に足さないので参照で取り込む。
// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- 上の意図どおり
/// <reference path="./sw-defines.d.ts" />
import { decideServiceWorkerFetch } from "./service-worker-routing";

// 許可リスト型シェル。新しい worker は待たせ、実行時に許可リスト外を貯めない。
// ナビ失敗の HTML は自 CACHE_NAME の SHELL だけ。他キャッシュの HTML は返さない。
const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE_NAME = __KONDATE_SW_CACHE_NAME__;
const PRECACHE_URLS = JSON.parse(__KONDATE_SW_PRECACHE__) as string[];
const SHELL_URL = __KONDATE_SW_SHELL__;
const PRECACHE_PATHS = new Set(
  PRECACHE_URLS.map((url) => new URL(url, "https://sw.invalid").pathname),
);

sw.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("kondate-shell-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});

sw.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const decision = decideServiceWorkerFetch({
    method: event.request.method,
    origin: url.origin,
    selfOrigin: sw.location.origin,
    pathname: url.pathname,
    mode: event.request.mode,
    precachePathnames: PRECACHE_PATHS,
  });
  if (decision.action === "passthrough") return;
  if (decision.action === "navigate-network-then-shell") {
    event.respondWith(
      fetch(event.request).catch(async (error: unknown) => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(SHELL_URL);
        if (cached) return cached;
        throw error;
      }),
    );
    return;
  }
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      if (!PRECACHE_PATHS.has(url.pathname)) return fetch(event.request);
      const cached = await cache.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      return fetch(event.request);
    }),
  );
});
