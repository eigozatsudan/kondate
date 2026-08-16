# Holistic review: PWA installable app shell

- **Role:** overview / architecture review of the finished feature branch (not a per-Task gate)
- **Date:** 2026-08-16
- **Worktree:** `/home/dev/projects/kondate/.worktrees/pwa-installable-app-shell`
- **Branch:** `feat/pwa-installable-app-shell`
- **Base..Head:** `560f07c4`..`16284ebf`
- **Diff package:** `.superpowers/sdd/review-560f07c4..16284ebf.diff`
- **Requirements:** `docs/superpowers/specs/2026-08-16-pwa-installable-app-shell-design.md`, `docs/superpowers/plans/2026-08-16-pwa-installable-app-shell.md`
- **Method:** read the review package once, then inspect live implementation and seams. Prior review markdown under `docs/superpowers/reviews/` was not treated as evidence.
- **Full suite:** not run (overview instruction). No focused command was needed; named doubts were answered by source and existing tests.

---

### Strengths

The slice is a small, well-seamed feature. The parts compose: detection and dismiss live in `src/features/pwa/`, the worker is a generated allowlist IIFE, and AppShell / settings only mount UI.

**Plan alignment.** Tasks 1–4 are present in HEAD. The later fix (`2a462a62`) is a justified improvement on the plan’s “peek wrap is OK”: cards and settings now subscribe to late BIP via `useSyncExternalStore` (`src/features/pwa/android-install-prompt.ts:51-56`, `src/features/pwa/home-screen-install-card.tsx:57-64`). That matches Spec §8.4 / §8.5 (show「インストールする」when a prompt is held; omit the step list) instead of freezing on the fallback steps after `preventDefault`. No planned function is missing in product code.

**Allowlist SW, not Workbox.** `package.json` `build` is still `tsc -b && vite build` (file not in the range). `vite.config.ts:14-24` only sets `build.manifest: true` and writes `dist/sw.js` from `closeBundle`. Precache is `/` + manifest + four icons + Vite `file` / `css[]` / `assets[]` that end in `.js` or `.css` (`scripts/generate-service-worker.mjs:14-21,89-111`). Fonts, webp, `/index.html`, `/api`, and `dynamicImports` following are out. `CACHE_NAME` is `kondate-shell-` + SHA-256 prefix of sorted URLs plus non-hashed file digests — no `Date.now()` / random (`scripts/generate-service-worker.mjs:136-145`, source guard in `scripts/generate-service-worker.test.mjs:155-161`).

**SW vs Netlify SPA fallback vs Pretty URLs.** Shell URL is `/` (`src/pwa/service-worker-routing.ts:13-14`; esbuild `__KONDATE_SW_SHELL__` is `"/"`). Netlify `/* → /index.html` is a **200 rewrite** (`netlify.toml:34-37`), so `addAll(["/"])` should store `/` rather than follow a Pretty-URLs 301 from `/index.html`. `/index.html` is not on the list. Missing `sw.js` would still be rewritten to HTML; the generator throws if the Vite manifest or `index.html` is absent, so a successful `vite build` leaves a real `dist/sw.js`.

**HTML network-first vs hashed asset cache-first.** Decision order is non-GET → other origin → API / callback → navigate → static allowlist (`src/pwa/service-worker-routing.ts:32-47`). Navigate uses `fetch(request)` and only on rejection opens **this** `CACHE_NAME` and `cache.match(SHELL_URL)` (`src/pwa/service-worker.ts:45-54`). Static allowlist uses `cache.match(event.request, { ignoreSearch: true })` and never `cache.put` (`src/pwa/service-worker.ts:56-62`). `src/pwa/` has no `skipWaiting`, `clients.claim`, `cache.put`, or global `caches.match(` (string-locked in `src/pwa/service-worker-routing.test.ts:136-148` and the generated `dist/sw.js` fixture in `scripts/generate-service-worker.test.mjs:107-113`). Activate deletes only other `kondate-shell-*` names (`src/pwa/service-worker.ts:20-31`).

**`/api` and `/auth/callback` passthrough.** `isApiPath` is `/api` or `/api/…`; `isAuthCallbackPath` is exact `/auth/callback` and `/auth/callback/` (`src/pwa/service-worker-routing.ts:16-22`). Tests lock navigate mode as passthrough (`src/pwa/service-worker-routing.test.ts:74-87`). Passthrough returns without `respondWith` (`src/pwa/service-worker.ts:44`). Query strings are ignored because only `pathname` is judged — `/auth/callback?code=` does not become a cache key.

**BIP listen vs React render.** `main.tsx:16-19` is strip → `listenForAndroidInstallPrompt()` → `registerServiceWorker()` → `createRoot`. Listen does not branch on surface (`src/features/pwa/android-install-prompt.ts:40-44`). After paint, `useAndroidInstallPrompt` notifies subscribers (`src/features/pwa/android-install-prompt.ts:15-18,51-56`). Card and settings tests dispatch BIP after first paint and expect「インストールする」with the step list gone (`src/features/pwa/home-screen-install-card.test.tsx:137-155`, `src/features/pwa/home-screen-install-section.test.tsx:55-71`). `userChoice` / `appinstalled` do not auto-dismiss.

**E2E addInitScript vs iPhone SE.** Default dismiss is `context.addInitScript`, not `page.evaluate(setItem)` (`e2e/fixtures/pwa-install-tip.ts:3-10`). Entrances match §9.2: `loginAsNewUser` after session evaluate and **before** `goto("/planner")` (`e2e/fixtures/auth.ts:325-333`); `auth.setup.ts:17-18` before the first `goto`; `session-auth.ts:23-24` immediately after `newContext`; `seed-onboarding.ts:51-52`; `oauth-mock.spec.ts` and `auth-recovery.spec.ts` before their planner-facing `goto`s. The feature spec opts out (`e2e/specs/pwa-install-tip.spec.ts:10,24`). `mobile-chromium` stays iPhone SE; `heading.first()` is now named-not-the-card (`e2e/specs/mobile-accessibility.spec.ts:256-257`) and the same contract is unit-locked (`src/app/layouts/app-shell.test.tsx:322-360`).

**Logout vs `kondate:preferences:*`.** Dismiss key is `kondate:preferences:pwa-install-tip-dismissed` (`src/features/pwa/install-tip-storage.ts:1-5`). `isOwnedBrowserStorageKey` was not edited (auth-cleanup implementation is not in the range). Logout / second-pass tests keep `"1"` (`src/features/auth/auth-cleanup.test.ts:42-44,86-87` and later survival cases). Auth lock modules (`AuthFlow` / `ContinuationApi` / `AuthProvider` / `BrowserSupabaseClient` / `ownedAuthStoragePrefixes`) are not imported from `src/features/pwa/`.

**Settings dual mount.** Empty-family return and family-present main both place `<HomeScreenInstallSection />` immediately before `PlanSettingsSection` (`src/features/household/household-settings-page.tsx:1618-1621,2360-2363`). Pending / editor-loading early returns do not (`1551-1552,1588-1589,1635-1636`) — Spec §2.3 residual, not a miss.

**CSP / MIME / PROD register.** `CSP_STATIC_DIRECTIVES` is unchanged (`scripts/csp-headers.mjs:11-12`). `buildHeadersFileContent` prefixes `/sw.js` (no-cache + JS MIME) and `/manifest.webmanifest` (`application/manifest+json`) before `/*` CSP (`scripts/csp-headers.mjs:60-70`). Global `[[headers]]` in `netlify.toml` still has no CSP (`netlify.toml:41-47`; still asserted in `tests/tooling/project-config.test.mjs:360-368`). `registerServiceWorker` returns unless `import.meta.env.PROD` (`src/features/pwa/register-service-worker.ts:5-6`). No `console.*` in `src/features/pwa/` or `src/pwa/`. Register failure is an empty `catch`. No `@shared/safety` import on this surface.

**Install surface + copy.** Manifest / `index.html` metas match Spec §6.1–6.2. Icons are paper `#faf9f8` + terracotta bowl `#b85033`, no lettering; maskable is inset (`scripts/write-pwa-icons.mjs:13-28,53-58`; committed PNGs). Japanese copy is exact (`src/features/pwa/install-tip-copy.ts`). Card is an `h2`「ホーム画面に置く」before `<Outlet />` (`src/app/layouts/app-shell.tsx:228-230`); settings `h2` is「ホーム画面に追加」. App-shell heading focus still targets `main h1` / `h1` (`src/app/layouts/app-shell.tsx:184-190`), so the card `h2` does not steal route focus.

---

### Issues

#### Critical (Must Fix)

None.

No path puts menus, allergies, API JSON, or auth `code` into Cache Storage. CSP was not loosened. `skipWaiting` / `clients.claim` are absent. Safety copy is untouched. Auth lock exports were not redefined. The dismiss key is not on the owned-storage sweep.

#### Important (Should Fix)

None on current HEAD.

The two product holes that existed before `2a462a62` (late BIP ignored after `preventDefault`; `heading.first()` able to stay green on the card `h2`) are closed in live code and in tests cited above. I did not find a remaining locked-requirement miss, a wrong SW route, an install path that cannot work, or an E2E default that would fail existing iPhone SE specs.

#### Minor (Nice to Have)

1. **Eligibility tests do not lock every “show” exact path.**
   `src/features/pwa/install-tip-eligibility.test.ts:39-43` asserts true for `/planner` (via the fixture), `/menus/x`, `/plus`, `/emergency-menus`, `/emergency-menus/x`. Implementation exact set also has `/generation`, `/pantry`, `/history`, `/shopping` (`src/features/pwa/install-tip-eligibility.ts:4-11`). False side does not name `/login` or `/auth/callback` (those routes are outside AppShell anyway). Dropping an exact path would stay green.

2. **Settings dual-mount is not asserted in the household page test.**
   The section is mocked like Plan (`src/features/household/household-settings-page.test.tsx:61-63`). H9 asserts the Plan mock (`4094`) and never the PWA mock. Live mounts exist on both branches (`household-settings-page.tsx:1619,2361`). The feature E2E hits `/settings` after `loginAsNewUser` without onboarding, i.e. the **empty-family** branch (`e2e/specs/pwa-install-tip.spec.ts:15-16`). Removing only the family-present mount would stay green in both that E2E and the household unit file.

3. **`registerServiceWorker` has no unit test.**
   The PROD / `serviceWorker` guards are 11 lines (`src/features/pwa/register-service-worker.ts:5-10`). Removing the PROD guard would register on Vite DEV (E2E `baseURL` 5173) and is not locked except by reading the source.

4. **`readNavigatorPlatform` is duplicated.**
   Same `Reflect.get(navigator, "platform")` helper in `src/features/pwa/home-screen-install-card.tsx:21-25` and `src/features/pwa/home-screen-install-section.tsx:11-15`. Behavior is fine; iPadOS detection could drift if one copy regresses.

5. **`/emergency-menus` is a prefix without a trailing slash.**
   `src/features/pwa/install-tip-eligibility.ts:19` is `pathname.startsWith("/emergency-menus")`, which is what Plan Task 1 wrote. `/menus/` and `/history/` require the slash. No current router sibling exists (`src/app/router.tsx:101-107`). A future `/emergency-menuscript` would show the card.

6. **`readInstallTipDismissed` does not catch `getItem` throw.**
   Spec only required `setItem` failure → memory dismiss (`src/features/pwa/install-tip-storage.ts:8-15`; card `src/features/pwa/home-screen-install-card.tsx:41-42,66-68`). A throwing `getItem` would surface as a render exception. Safari quota is typically `setItem`.

---

### Residuals (spec-accepted)

Implementation did not make these worse. Not must-fix.

| Spec §2.3 residual | Live appearance |
| --- | --- |
| iOS standalone storage can split from Safari; re-login possible | `start_url` `/`; no standalone auth repair |
| Google / magic-link leave standalone | Card is not on `/login` / `/auth/callback` (router: AppShell starts at `src/app/router.tsx:98`) |
| First open after deploy can be the old shell | No `skipWaiting` / `clients.claim`; online navigate is network-first |
| Offline = shell only, data uses existing errors | Navigate failure returns cached `/` only; no offline data UI |
| Desktop: no first-run card | `surface === "other"` → card null; settings generic sentence (`home-screen-install-section.tsx:60`) |
| iPhone “desktop site” → `other` | Same as desktop |
| CriOS / FxiOS treated as iOS | `iPhone` UA wins (`install-surface.ts:10`); CriOS unit exists; copy is Safari share steps |
| Install success does not auto-dismiss | No `userChoice` / `appinstalled` handler |
| Shared device, second account | Terminal flag only; settings section remains |
| Real SW / real-device install not in CI | E2E is Vite DEV; `@smoke` not added; §9.3 stays manual |
| No old-SW kill switch | v1; online navigate still hits network |
| DEV leftover production SW is not unregistered | `register-service-worker.ts` does not unregister; preview 4173 / E2E 5173 |
| Settings loading early return has no section | `membersQuery.isPending` / editor loading (`household-settings-page.tsx:1551-1552,1588-1589`) |
| Card pushes Outlet down; primary CTA can sink | Overlay avoided; bottom nav stays below (`app-shell.tsx:228-231`) |

§9.3 host checks (each Precache URL 200 and non-redirect; `/sw.js` is JavaScript not HTML; manifest MIME) remain a deploy-time manual acceptance. The generator proves dist shape, not the hosted CDN.

Desktop Chromium will fire BIP once a SW + manifest exist. Listen always `preventDefault`s (`android-install-prompt.ts:32-37`) and settings only expose「インストールする」when `surface === "android"` (`home-screen-install-section.tsx:25,42-51`). That is the spec’s desktop residual (generic settings copy), not a new hole. The address-bar install affordance is outside this slice.

---

### Recommendations

- Optional: assert `getByLabelText("ホーム画面に追加")` on both empty-family and family-present settings renders, and add `/generation` `/pantry` `/history` `/shopping` to the eligibility true table. Not merge-blocking.
- Keep the kill-switch and DEV unregister out of this slice (Spec §2.3).
- Before production cut, run Spec §9.3 once against the hosted origin: curl `/sw.js` (JS MIME, `Cache-Control: no-cache`, not HTML), `/manifest.webmanifest` (`application/manifest+json`), and each Precache URL (200, no 301). Confirm Chromium install + second load of hashed JS via the worker.
- Do not add `vite-plugin-pwa`, `skipWaiting`, or a dismiss key on `isOwnedBrowserStorageKey`.

---

### Assessment

**Ready to merge?** Yes

**Reasoning:** Live code matches the locked spec: allowlist shell, `/` not `/index.html`, API/callback passthrough, own-cache-only fallback, CSP and Auth locks untouched, PROD-only register, dismiss survives logout, and late Android BIP plus existing `heading.first()` contracts are fixed in HEAD. Remaining items are residuals or optional test polish.
