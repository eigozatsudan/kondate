# Kondate MVP Foundation, Auth, and Household Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first independently testable Kondate MVP increment: a reproducible local stack, typed React foundation, Supabase household/privacy schema, Google and magic-link authentication shell, resumable household onboarding, privacy consent, and a protected mobile-first app shell.

**Architecture:** A React 19 Vite SPA uses one typed browser Supabase client for Auth and RLS-protected household/privacy CRUD, with TanStack Query owning server-state caching. Root Docker Compose includes the official Supabase stack, a Node 24 app container, Mailpit, migrations, pgTAP, a deterministic local Google-style OAuth provider, and the OpenRouter stub. Authentication uses Supabase PKCE plus a server-backed five-minute continuation: the initiating browser keeps the continuation secret and PKCE verifier, the callback deposits only the authorization code, and the initiating browser atomically claims that encrypted code with its secret before exchanging it. Local OAuth uses the same state/continuation path and a one-time mock code; production parsing rejects that provider and uses real Supabase Google only. State/secret hashes, exact origin binding, encrypted-at-rest code, one-time claim, and expiry prevent a foreign callback from installing another user's session.

**Tech Stack:** Node.js 24 LTS, npm, TypeScript strict mode, React 19.2.7, React Router 8 Data Mode (`createBrowserRouter`), Vite 8, Tailwind CSS 4 through `@tailwindcss/vite`, TanStack Query 5, Supabase JS 2, React Hook Form, Zod 4, Vitest, React Testing Library, pgTAP, Playwright, Docker Compose, Mailpit.

## Global Constraints

- The approved source of truth is `docs/superpowers/specs/2026-07-11-kondate-mvp-design.md` at commit `cd0cb70` or a later commit that only clarifies that approved design.
- Use Node.js `>=24 <25`; Node 24 is LTS. Do not use Node 26 Current for production.
- Use ESM and TypeScript `strict: true`; do not introduce `any` or unchecked type assertions at network and database boundaries.
- Use React 19.2.7 or later within React 19, Vite 8, Tailwind CSS 4 through `@tailwindcss/vite`, React Router 8 Data Mode (`createBrowserRouter`), and TanStack Query 5. React Router 8 DOM rendering imports `RouterProvider` from `react-router/dom`; route construction, hooks, components, and types come from `react-router`.
- The server continuation TTL is `AUTH_CONTINUATION_TTL_SECONDS=300`; browser flow expiry/recovery uses only `VITE_AUTH_CONTINUATION_TTL_MS=300000`. Never pass the browser millisecond key to a Function or interpret the server key as milliseconds.
- All user-facing copy is Japanese. Internal identifiers, code comments, commits, and test names are English.
- Mobile-first layout must work at 320 CSS pixels without horizontal scrolling; interactive targets are at least 44 by 44 CSS pixels.
- Use the approved visual direction: warm off-white background, terracotta primary action, subdued green pantry accents, three-step planner home, and tabbed dish results with an overall timeline first.
- OpenRouter is called only from Netlify Functions. `OPENROUTER_MODELS` must contain only explicit model IDs ending in `:free`; paid fallback and `openrouter/auto` are rejected.
- User successful-generation limit is 5 per Japan calendar day; application OpenRouter HTTP-call limit defaults to 45 per Japan calendar day.
- Never log names, emails, allergies, free-form conditions, prompts, or raw AI responses. Log only request ID, error code, duration, and actual model ID.
- Never store raw AI output. Persist only Zod-validated structures, validation versions, and unresolved label confirmations.
- Current household safety constraints always override historical snapshots for history use, regeneration, and shopping-list creation.
- Allergy and food-safety validation never produces a “safe” badge or guarantee. Processed ingredients retain explicit label-confirmation records.
- All user-owned public tables have RLS and explicit grants. Shared safety catalogs are authenticated read-only. AI control tables live in a non-exposed `private` schema.
- Local development starts through root `docker compose up`; every browser-visible local URL uses the one canonical origin `http://127.0.0.1:5173`, browser Supabase uses exact `http://127.0.0.1:8000`, and the Function-side Compose URL remains exact `http://kong:8000`. Production accepts only the exact managed origin `https://<20-character-project-ref>.supabase.co` with no credentials, port, trailing slash, path, query, or fragment. Plan 6 binds the browser, server, direct-database host, and Supavisor Session username suffix to that same project ref before deployment.
- Local Google success/cancel uses only Compose service `oauth-mock` at `http://127.0.0.1:8788`, `VITE_AUTH_PROVIDER_MODE=oauth_mock`, and the exact app callback. Production requires `VITE_AUTH_PROVIDER_MODE=supabase`, no `VITE_OAUTH_MOCK_ORIGIN`, and real Supabase Google; browser parsing and Plan 6 preflight reject every production mock configuration.
- The three unauthenticated continuation Functions use exact Netlify custom paths and an outer IP flood ceiling of 20 requests per 60 seconds. The five-minute single-use database continuation remains authoritative; this outer ceiling is unrelated to Plan 3's authenticated-user four-sends-per-600-seconds AI quota.
- Every behavior change follows red-green-refactor, includes exact focused tests, and ends in a small commit.
- Treat `infra/supabase/` as generated vendor content: it must match `supabase/supabase` tag `v1.26.05` (verified short commit `23b55d6`) and must never contain Kondate-specific edits.
- The implementation starts from a repository containing only documentation. Every path below is created by this plan.
- Every hand-authored file changed by a step is shown in full in that step. `package-lock.json`, `infra/supabase/**`, and `src/shared/types/database.generated.ts` are generated only by their exact commands and are never hand-edited.

---

## File Structure

```text
.
├── .dockerignore                         # Docker build exclusions
├── .env.example                          # non-secret local variable names and safe placeholders
├── .gitignore                            # generated, secret, and test artifacts
├── .node-version                         # Node major for generic version managers
├── .npmrc                                # engine enforcement
├── .nvmrc                                # Node major for nvm
├── .prettierignore
├── .prettierrc.json
├── Dockerfile                            # Node 24 development/build image
├── compose.yaml                          # root entry point; includes official Supabase compose
├── eslint.config.js
├── index.html
├── netlify.toml
├── package.json
├── package-lock.json                     # generated by npm
├── playwright.config.ts
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.functions.json
├── vite.config.ts
├── vitest.config.ts
├── infra/
│   ├── supabase/                         # generated byte-for-byte from official tag v1.26.05 docker/
│   ├── supabase.override.yaml            # Kondate SMTP/DB-port override, outside vendor tree
│   └── supabase.version                  # generated full upstream commit
├── scripts/
│   ├── apply-migrations.sh               # ordered, tracked forward-only SQL runner
│   ├── generate-database-types.sh        # atomic Supabase type generation
│   ├── generate-local-secrets.mjs        # creates ignored root .env
│   ├── generate-local-secrets.sh         # stable shell entry point
│   ├── run-pgtap.sh                      # container pg_prove entry point
│   ├── vendor-supabase.sh                # verified sparse vendor operation
│   └── wait-for-supabase.sh              # bounded Kong readiness probe
├── shared/contracts/
│   ├── domain.test.ts
│   ├── domain.ts
│   ├── http.test.ts
│   └── http.ts
├── netlify/functions/
│   ├── _shared/{env,http,supabase-admin,auth-continuation-crypto}.ts
│   ├── auth-continuation-create.ts
│   ├── auth-continuation-deposit.ts
│   └── auth-continuation-claim.ts
├── src/
│   ├── main.tsx
│   ├── styles.css
│   ├── test/setup.ts
│   ├── vite-env.d.ts
│   ├── app/
│   │   ├── providers.test.tsx
│   │   ├── providers.tsx
│   │   ├── router.tsx
│   │   └── layouts/app-shell.tsx
│   ├── shared/
│   │   ├── config/public-env.test.ts
│   │   ├── config/public-env.ts
│   │   ├── lib/supabase.test.ts
│   │   ├── lib/supabase.ts
│   │   ├── types/database.generated.ts  # generated from migrated local DB
│   │   └── ui/placeholder-page.tsx
│   └── features/
│       ├── auth/
│       │   ├── auth-callback-page.test.tsx
│       │   ├── auth-callback-page.tsx
│       │   ├── auth-flow.test.ts
│       │   ├── auth-flow.ts
│       │   ├── auth-continuation-recovery.test.ts
│       │   ├── auth-continuation-recovery.ts
│       │   ├── auth-gateway.test.ts
│       │   ├── auth-gateway.ts
│       │   ├── auth-provider.test.tsx
│       │   ├── auth-provider.tsx
│       │   ├── login-page.test.tsx
│       │   ├── login-page.tsx
│       │   ├── magic-link-state.ts
│       │   ├── protected-routes.test.tsx
│       │   ├── protected-routes.tsx
│       │   └── session.ts
│       ├── household/
│       │   ├── allergy-editor.test.tsx
│       │   ├── allergy-editor.tsx
│       │   ├── household-api.ts
│       │   ├── household-api.test.ts
│       │   ├── household-defaults.test.ts
│       │   ├── household-defaults.ts
│       │   ├── household-onboarding-page.test.tsx
│       │   ├── household-onboarding-page.tsx
│       │   ├── household-queries.ts
│       │   ├── household-settings-page.test.tsx
│       │   └── household-settings-page.tsx
│       └── privacy/
│           ├── privacy-api.ts
│           ├── privacy-copy.ts
│           ├── privacy-notice-page.test.tsx
│           ├── privacy-notice-page.tsx
│           └── privacy-queries.ts
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   ├── 20260711000100_extensions_and_schemas.sql
│   │   ├── 20260711000200_profiles_household_privacy.sql
│   │   ├── 20260711000300_safety_catalogs.sql
│   │   └── 20260711000330_auth_continuations.sql
│   ├── seed.sql
│   └── tests/database/
│       ├── 000_helpers.sql
│       ├── 001_extensions_and_schemas.test.sql
│       ├── 002_household_rls.test.sql
│       ├── 003_catalog_grants.test.sql
│       └── 004_auth_continuations.test.sql
├── tools/openrouter-mock/
│   ├── server.mjs
│   └── server.test.mjs
├── tools/oauth-mock/
│   ├── fixtures/google-user.json
│   ├── server.mjs
│   └── server.test.mjs
├── tests/tooling/
│   ├── compose.test.mjs
│   └── project-config.test.mjs
└── e2e/
    ├── fixtures/auth.ts
    └── specs/
        ├── auth-recovery.spec.ts
        ├── foundation.spec.ts
        ├── oauth-mock.spec.ts
        ├── onboarding.spec.ts
        └── settings.spec.ts
```

### Locked interfaces produced by this increment

- `shared/contracts/domain.ts` exports every roadmap constant/type unchanged, plus `onboardingStatuses`, `householdMemberStatuses`, `portionSizes`, `spiceLevels`, `easePreferences`, `requiredSafetyConstraints`, `unsupportedDietKinds`, and `privacyNoticeVersion`.
- `src/shared/config/public-env.ts` exports `PublicEnv`, `PublicEnvParseContext`, `parsePublicEnv(source: Record<string, unknown>, context?: PublicEnvParseContext): PublicEnv`, and `getPublicEnv(): PublicEnv`. `PublicEnv.authContinuationTtlMs` is a `number` whose schema accepts only `300_000`; it is not an unsound numeric-literal assertion. Local browser auth is the exact discriminant `authProviderMode: "oauth_mock"` plus `oauthMockOrigin: "http://127.0.0.1:8788"`; production is `authProviderMode: "supabase"` plus `oauthMockOrigin: null`, and a production parse rejects any mock mode, mock origin, non-managed Supabase host, lookalike, credentials, port, or non-origin suffix. `_shared/env.ts` exports `parseManagedSupabaseProjectRef(value): string | null` as the canonical server/deployment helper; Plan 6 uses it to bind all Supabase endpoints to one project ref.
- `src/shared/lib/supabase.ts` exports `BrowserSupabaseClient`, `createBrowserSupabaseClient(env: Pick<PublicEnv, "supabaseUrl" | "supabasePublishableKey">): BrowserSupabaseClient`, and `getBrowserSupabaseClient(): BrowserSupabaseClient`.
- `src/features/auth/auth-flow.ts` owns and exports `AuthFlow`, `FlowDeps`, `browserFlowDeps`, `ContinuationApi`, `createContinuationApi`, `createAuthFlow`, `readAuthFlow`, `clearAuthFlow`, `listUnexpiredAuthFlows`, `sanitizeReturnPath`, `buildAuthCallbackUrl`, `ownedAuthStoragePrefixes = ["kondate.auth.flow.", "kondate.auth.supabase"] as const`, and `clearOwnedAuthStorage(storage)`. `createAuthFlow` has one production default `deps = browserFlowDeps`; production call sites pass three arguments and deterministic tests alone inject the fourth. The browser Supabase client uses exact `storageKey: "kondate.auth.supabase"`. Account-deletion cleanup imports this export and never deletes a broad `sb-` prefix.
- `src/shared/types/database.generated.ts` exports `Database`, `Tables`, `TablesInsert`, and `TablesUpdate` exactly as emitted by Supabase CLI.
- `src/features/auth/session.ts` exports `AuthSessionRequiredError` and `requireAccessToken(client: BrowserSupabaseClient): Promise<string>`.
- `src/features/household/household-api.ts` exports `HouseholdMemberPatch`, its onboarding alias `HouseholdDraftPatch`, `getProfile`, `listHouseholdMembers`, `createHouseholdMemberDraft`, `updateHouseholdMemberDraft`, `updateCompleteHouseholdMember`, `completeHouseholdMember`, `deleteHouseholdMember`, `setOnboardingStatus`, and explicit allergen/dislike CRUD functions.
- `src/features/household/household-queries.ts` exports `householdSafetyChangedEvent`, `householdSafetyRevisionStorageKey`, `householdSafetyQueryPrefixes`, and `invalidateHouseholdSafetyDependents(queryClient,userId)`. The canonical shopping prefix is `['shopping']`, matching Plan 5's `['shopping','active']`; every successful member, allergy, or dislike mutation calls the helper so current-safety, visible menu, history/revalidation, generation, and shopping queries become stale immediately.
- `src/features/privacy/privacy-api.ts` exports `getCurrentPrivacyConsent`, `acceptCurrentPrivacyConsent`, and `hasCurrentPrivacyConsent`.
- `src/app/router.tsx` exports `createAppRouter(): Router`. Protected shell paths are `/planner`, `/pantry`, `/history`, `/shopping`, and `/settings`.
- `e2e/fixtures/auth.ts` exports `test` with `authenticatedPage`, `completedOnboardingPage`, and `authEmail` fixtures, `expect`, `requestMagicLinkAndReadUrl`, and `completeMinimumOnboarding`.
- Compose owns the deterministic local-only `oauth-mock` service. Its browser origin is exactly `http://127.0.0.1:8788`, container origin is `http://oauth-mock:8788`, and health route is `GET /health`; success and cancellation return through `/auth/callback` with the initiating `flow` and `state`, never a token. Real Supabase Google OAuth remains the sole production mode and Plan 6 owns its staging evidence.
- `netlify/functions/auth-continuation-{create,deposit,claim}.ts` and `private.auth_continuations` own the unauthenticated PKCE handoff. Their only custom routes are `POST /api/auth/continuations`, `POST /api/auth/continuations/:continuationId/callback`, and `POST /api/auth/continuations/:continuationId/claim`; both dynamic handlers read the UUID only from `context.params.continuationId`. Plan 1 also creates the minimal `_shared/env.ts`, `_shared/http.ts`, and `_shared/supabase-admin.ts`; Plan 2 extends these exact helpers rather than recreating them.

### Task 1: Pin Node/npm and establish static-analysis/test runners

**Files:**
- Create: `package.json`
- Create: `package-lock.json` (generated)
- Create: `.nvmrc`
- Create: `.node-version`
- Create: `.npmrc`
- Create: `.gitignore`
- Create: `.dockerignore`
- Create: `.prettierignore`
- Create: `.prettierrc.json`
- Create: `eslint.config.js`
- Create: `tsconfig.json`
- Create: `tsconfig.app.json`
- Create: `tsconfig.functions.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/vite-env.d.ts`
- Test: `tests/tooling/project-config.test.mjs`

**Interfaces:**
- Consumes: Node `>=24 <25` and an empty npm workspace.
- Produces: npm scripts `dev`, `build`, `format`, `format:check`, `lint`, `typecheck`, `test`, `db:test`, `db:types`, and `e2e`; path aliases `@/*` and `@shared/*`.

- [x] **Step 1: Write the failing project-configuration test (3 minutes)**

Create `tests/tooling/project-config.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("pins Node 24 and exposes every verification script", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(manifest.type, "module");
  assert.equal(manifest.engines.node, ">=24 <25");
  assert.match(manifest.devDependencies["@netlify/functions"], /^\^5\./u);
  for (const name of [
    "build",
    "format:check",
    "lint",
    "typecheck",
    "test",
    "db:test",
    "db:types",
    "e2e",
  ]) {
    assert.equal(typeof manifest.scripts[name], "string", `missing ${name}`);
  }
  assert.equal(await readFile(".nvmrc", "utf8"), "24\n");
});
```

- [x] **Step 2: Run the test and verify the red state (2 minutes)**

Run: `node --test tests/tooling/project-config.test.mjs`

Expected: FAIL with `ENOENT: no such file or directory, open 'package.json'`.

- [x] **Step 3: Create the complete npm and TypeScript configuration (5 minutes)**

Create `package.json`:

```json
{
  "name": "kondate",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24 <25"
  },
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "tsc -b && vite build",
    "preview": "vite preview --host 0.0.0.0",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "lint": "eslint .",
    "typecheck": "tsc -b",
    "test": "vitest",
    "db:push": "docker compose run --rm migrate",
    "db:reset": "docker compose down --volumes && docker compose up -d --wait",
    "db:test": "docker compose run --rm db-test",
    "db:types": "bash scripts/generate-database-types.sh",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.57.0",
    "@tanstack/react-query": "^5.87.0",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "react-hook-form": "^7.62.0",
    "react-router": "^8.0.0",
    "zod": "^4.1.0"
  },
  "devDependencies": {
    "@eslint/js": "^9.35.0",
    "@netlify/functions": "^5.3.0",
    "@netlify/vite-plugin": "^2.5.0",
    "@playwright/test": "^1.55.0",
    "@tailwindcss/vite": "^4.1.0",
    "@testing-library/dom": "^10.4.0",
    "@testing-library/jest-dom": "^6.8.0",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.6.0",
    "@types/node": "^24.0.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^5.0.0",
    "eslint": "^9.35.0",
    "eslint-plugin-react-hooks": "^5.2.0",
    "eslint-plugin-react-refresh": "^0.4.20",
    "globals": "^16.3.0",
    "jsdom": "^27.0.0",
    "prettier": "^3.6.0",
    "supabase": "^2.50.0",
    "tailwindcss": "^4.1.0",
    "typescript": "^5.9.0",
    "typescript-eslint": "^8.42.0",
    "vite": "^8.0.0",
    "vitest": "^4.0.0"
  }
}
```

Create `.nvmrc` and `.node-version` with exactly:

```text
24
```

Create `.npmrc`:

```ini
engine-strict=true
fund=false
audit=true
```

Create `tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.functions.json" }
  ]
}
```

Create `tsconfig.app.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "useDefineForClassFields": true,
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@shared/*": ["shared/*"]
    },
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"]
  },
  "include": [
    "src",
    "shared",
    "e2e",
    "vite.config.ts",
    "vitest.config.ts",
    "playwright.config.ts"
  ]
}
```

Create `tsconfig.functions.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "strict": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "noEmit": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "types": ["node"],
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["shared/*"]
    }
  },
  "include": [
    "netlify/functions/**/*.ts",
    "shared/**/*.ts",
    "src/shared/types/database.generated.ts"
  ]
}
```

Create `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_MAGIC_LINK_RESEND_SECONDS?: string;
  readonly VITE_AUTH_CONTINUATION_TTL_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [x] **Step 4: Create lint, format, Vite, Vitest, and Playwright configuration (5 minutes)**

Create `eslint.config.js`:

```js
import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage", "playwright-report", "test-results", "infra/supabase", "src/shared/types/database.generated.ts"] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-return": "error"
    },
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off"
    }
  }
);
```

Create `.prettierrc.json`:

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100
}
```

Create `.prettierignore`:

```text
dist
coverage
infra/supabase
playwright-report
test-results
src/shared/types/database.generated.ts
package-lock.json
```

Create `vite.config.ts`:

```ts
import netlify from "@netlify/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss(), netlify()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
});
```

Create `vitest.config.ts`:

```ts
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/**/*.test.{ts,tsx}",
      "shared/**/*.test.ts",
      "tools/**/*.test.mjs"
    ],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
```

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/specs",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "mobile-chromium", use: { ...devices["iPhone SE"] } },
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
```

Create `src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});
```

Create `.gitignore`:

```gitignore
node_modules/
dist/
coverage/
.env
.env.local
playwright-report/
test-results/
.DS_Store
*.log
```

Create `.dockerignore`:

```text
.git
node_modules
dist
coverage
playwright-report
test-results
.env
```

- [x] **Step 5: Install dependencies and verify the green state (5 minutes)**

Run:

```bash
npm install
node --test tests/tooling/project-config.test.mjs
npm run format:check
npm run lint
```

Expected: `package-lock.json` is created, the Node test reports `1 pass`, and both static commands exit 0. If npm resolves a package outside the major lines in `package.json`, stop and correct the manifest before committing.

- [x] **Step 6: Commit the tooling baseline (2 minutes)**

```bash
git add package.json package-lock.json .nvmrc .node-version .npmrc .gitignore .dockerignore .prettierignore .prettierrc.json eslint.config.js tsconfig.json tsconfig.app.json tsconfig.functions.json vite.config.ts vitest.config.ts playwright.config.ts src/test/setup.ts src/vite-env.d.ts tests/tooling/project-config.test.mjs
git commit -m "chore: establish Node and test toolchain"
```

### Task 2: Lock shared domain and HTTP contracts

**Files:**
- Create: `shared/contracts/domain.test.ts`
- Create: `shared/contracts/domain.ts`
- Create: `shared/contracts/http.test.ts`
- Create: `shared/contracts/http.ts`

**Interfaces:**
- Consumes: Vitest from Task 1.
- Produces: the exact roadmap domain names; household enum names used by SQL/UI; `privacyNoticeVersion = "2026-07-11.v1"`; stable `ApiResponse<T>`.

- [ ] **Step 1: Write failing contract tests (3 minutes)**

Create `shared/contracts/domain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ageBands,
  allergyStatuses,
  changeReasons,
  cuisineGenres,
  easePreferences,
  generationStatuses,
  householdMemberStatuses,
  mealTypes,
  onboardingStatuses,
  pantryPriorities,
  portionSizes,
  privacyNoticeVersion,
  requiredSafetyConstraints,
  spiceLevels,
  unsupportedDietKinds,
  unsupportedDietStatuses,
} from "./domain";

describe("domain contracts", () => {
  it("keeps roadmap values stable", () => {
    expect(mealTypes).toEqual(["breakfast", "lunch", "dinner"]);
    expect(cuisineGenres).toEqual(["japanese", "western", "chinese", "any"]);
    expect(ageBands).toHaveLength(7);
    expect(allergyStatuses).toEqual(["none", "registered", "unconfirmed"]);
    expect(unsupportedDietStatuses).toEqual(["none", "present", "unconfirmed"]);
    expect(generationStatuses[0]).toBe("not_started");
    expect(pantryPriorities).toEqual(["must_use", "prefer_use"]);
    expect(changeReasons).toHaveLength(5);
  });

  it("keeps household values aligned with database checks", () => {
    expect(onboardingStatuses).toEqual(["not_started", "in_progress", "complete"]);
    expect(householdMemberStatuses).toEqual(["draft", "complete"]);
    expect(portionSizes).toEqual(["small", "regular", "large"]);
    expect(spiceLevels).toEqual(["none", "mild", "regular"]);
    expect(easePreferences).toEqual(["small_pieces", "boneless", "soft"]);
    expect(requiredSafetyConstraints).toEqual(["remove_bones", "cut_small"]);
    expect(unsupportedDietKinds).toEqual([
      "weaning_food",
      "swallowing_concern",
      "therapeutic_diet",
    ]);
    expect(privacyNoticeVersion).toBe("2026-07-11.v1");
  });
});
```

Create `shared/contracts/http.test.ts`:

```ts
import { expectTypeOf, it } from "vitest";
import type { ApiFailure, ApiResponse, ApiSuccess } from "./http";

it("keeps the discriminated API envelope", () => {
  expectTypeOf<ApiSuccess<{ id: string }>>().toMatchTypeOf<{
    ok: true;
    data: { id: string };
  }>();
  expectTypeOf<ApiFailure>().toMatchTypeOf<{
    ok: false;
    error: { code: string; message: string; details?: Record<string, unknown> };
  }>();
  expectTypeOf<ApiResponse<number>>().toEqualTypeOf<ApiSuccess<number> | ApiFailure>();
});
```

- [ ] **Step 2: Run tests and verify the red state (2 minutes)**

Run: `npm test -- --run shared/contracts/domain.test.ts shared/contracts/http.test.ts`

Expected: FAIL because `./domain` and `./http` do not exist.

- [ ] **Step 3: Implement the complete contracts (4 minutes)**

Create `shared/contracts/domain.ts`:

```ts
export const mealTypes = ["breakfast", "lunch", "dinner"] as const;
export type MealType = (typeof mealTypes)[number];

export const cuisineGenres = ["japanese", "western", "chinese", "any"] as const;
export type CuisineGenre = (typeof cuisineGenres)[number];

export const ageBands = [
  "post_weaning_to_2",
  "age_3_5",
  "age_6_8",
  "age_9_12",
  "age_13_17",
  "adult",
  "senior",
] as const;
export type AgeBand = (typeof ageBands)[number];

export const allergyStatuses = ["none", "registered", "unconfirmed"] as const;
export type AllergyStatus = (typeof allergyStatuses)[number];

export const unsupportedDietStatuses = ["none", "present", "unconfirmed"] as const;
export type UnsupportedDietStatus = (typeof unsupportedDietStatuses)[number];

export const generationStatuses = [
  "not_started",
  "processing",
  "succeeded",
  "failed",
  "constraint_conflict",
] as const;
export type GenerationStatus = (typeof generationStatuses)[number];

export const pantryPriorities = ["must_use", "prefer_use"] as const;
export type PantryPriority = (typeof pantryPriorities)[number];

export const changeReasons = [
  "simpler",
  "different_ingredient",
  "child_friendly",
  "different_flavor",
  "custom",
] as const;
export type ChangeReason = (typeof changeReasons)[number];

export const onboardingStatuses = ["not_started", "in_progress", "complete"] as const;
export type OnboardingStatus = (typeof onboardingStatuses)[number];

export const householdMemberStatuses = ["draft", "complete"] as const;
export type HouseholdMemberStatus = (typeof householdMemberStatuses)[number];

export const portionSizes = ["small", "regular", "large"] as const;
export type PortionSize = (typeof portionSizes)[number];

export const spiceLevels = ["none", "mild", "regular"] as const;
export type SpiceLevel = (typeof spiceLevels)[number];

export const easePreferences = ["small_pieces", "boneless", "soft"] as const;
export type EasePreference = (typeof easePreferences)[number];

export const requiredSafetyConstraints = ["remove_bones", "cut_small"] as const;
export type RequiredSafetyConstraint = (typeof requiredSafetyConstraints)[number];

export const unsupportedDietKinds = [
  "weaning_food",
  "swallowing_concern",
  "therapeutic_diet",
] as const;
export type UnsupportedDietKind = (typeof unsupportedDietKinds)[number];

export const privacyNoticeVersion = "2026-07-11.v1" as const;
```

Create `shared/contracts/http.ts`:

```ts
export type ApiSuccess<T> = { ok: true; data: T };

export type ApiFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
```

- [ ] **Step 4: Run focused tests and typecheck (3 minutes)**

Run:

```bash
npm test -- --run shared/contracts/domain.test.ts shared/contracts/http.test.ts
npm run typecheck
```

Expected: both contract tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit shared contracts (2 minutes)**

```bash
git add shared/contracts
git commit -m "feat: define shared domain contracts"
```

### Task 3: Bootstrap the React/Tailwind/Query application surface

**Files:**
- Create: `index.html`
- Create: `netlify.toml`
- Create: `src/app/providers.test.tsx`
- Create: `src/app/providers.tsx`
- Create: `src/main.tsx`
- Create: `src/styles.css`

**Interfaces:**
- Consumes: React 19, Tailwind Vite plugin, and TanStack Query from Task 1.
- Produces: `AppProviders({ children, queryClient? })` with a stable test injection seam, Japanese product heading, and the approved color/target-size CSS tokens.

- [ ] **Step 1: Write the failing provider/render test (3 minutes)**

Create `src/app/providers.test.tsx`:

```tsx
import { useQueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { AppProviders } from "./providers";

function Probe() {
  const client = useQueryClient();
  return <output>{client.getDefaultOptions().queries?.staleTime}</output>;
}

it("provides the configured query client", () => {
  render(
    <AppProviders>
      <Probe />
    </AppProviders>,
  );
  expect(screen.getByText("30000")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test and verify failure (2 minutes)**

Run: `npm test -- --run src/app/providers.test.tsx`

Expected: FAIL because `./providers` does not exist.

- [ ] **Step 3: Implement the application provider and initial entry point (5 minutes)**

Create `src/app/providers.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type PropsWithChildren } from "react";

type AppProvidersProps = PropsWithChildren<{
  queryClient?: QueryClient;
}>;

function createDefaultQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

export function AppProviders({ children, queryClient }: AppProvidersProps) {
  const [ownedClient] = useState(createDefaultQueryClient);
  return (
    <QueryClientProvider client={queryClient ?? ownedClient}>{children}</QueryClientProvider>
  );
}
```

Create `src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProviders } from "./app/providers";
import "./styles.css";

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Application root element was not found");
}

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <main className="page-frame">
        <p className="eyebrow">毎日の献立を、家族に合わせて</p>
        <h1>こんだて日和</h1>
        <p>ログインと家族設定の準備をしています。</p>
      </main>
    </AppProviders>
  </StrictMode>,
);
```

Create `index.html`:

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#f7f1e8" />
    <title>こんだて日和</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Add the complete mobile-first visual baseline (4 minutes)**

Create `src/styles.css`:

```css
@import "tailwindcss";

:root {
  color: #332c27;
  background: #f7f1e8;
  font-family:
    "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", system-ui, sans-serif;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  --surface: #fffaf3;
  --text: #332c27;
  --muted: #6f6258;
  --primary: #b85f44;
  --primary-hover: #97462f;
  --pantry: #5f745f;
  --danger: #a33b35;
  --border: #d9cabc;
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  min-width: 320px;
  min-height: 100%;
  margin: 0;
}

body {
  min-height: 100vh;
  font-size: 16px;
  line-height: 1.6;
}

button,
a,
input,
select,
textarea {
  font: inherit;
}

button,
.button-link {
  min-width: 44px;
  min-height: 44px;
}

button:focus-visible,
a:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: 3px solid #3f6f88;
  outline-offset: 2px;
}

.page-frame {
  width: min(100% - 32px, 680px);
  margin-inline: auto;
  padding-block: 32px 96px;
}

.card {
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--surface);
  padding: 20px;
  box-shadow: 0 8px 24px rgb(82 60 43 / 8%);
}

.stack {
  display: grid;
  gap: 16px;
}

.eyebrow {
  color: var(--primary);
  font-weight: 700;
}

.primary-button,
.secondary-button,
.text-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  padding: 10px 16px;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
}

.primary-button {
  border: 1px solid var(--primary);
  color: #fff;
  background: var(--primary);
}

.primary-button:hover {
  background: var(--primary-hover);
}

.secondary-button {
  border: 1px solid var(--primary);
  color: var(--primary-hover);
  background: transparent;
}

.text-button {
  border: 0;
  color: var(--primary-hover);
  background: transparent;
  text-decoration: underline;
}

.field {
  display: grid;
  gap: 6px;
}

.field input,
.field select {
  width: 100%;
  min-height: 48px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff;
  padding: 10px 12px;
}

.status-message {
  min-height: 24px;
  color: var(--muted);
  font-size: 14px;
}

.error-message {
  color: var(--danger);
  font-weight: 700;
}

@media (min-width: 720px) {
  .page-frame {
    padding-top: 56px;
  }
}
```

Create `netlify.toml`:

```toml
[build]
  command = "npm run build"
  publish = "dist"
  functions = "netlify/functions"

[build.environment]
  NODE_VERSION = "24"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

- [ ] **Step 5: Verify component, build, and 320px CSS invariants (4 minutes)**

Run:

```bash
npm test -- --run src/app/providers.test.tsx
npm run typecheck
npm run build
```

Expected: one component test passes, typecheck exits 0, and Vite writes `dist/index.html`. Inspect `src/styles.css` and confirm `min-width: 320px` applies only to the viewport/root, not to a child that could force horizontal overflow.

- [ ] **Step 6: Commit the UI foundation (2 minutes)**

```bash
git add index.html netlify.toml src/app/providers.test.tsx src/app/providers.tsx src/main.tsx src/styles.css
git commit -m "feat: bootstrap React application shell"
```

### Task 4: Vendor and compose the complete local development stack

**Files:**
- Create: `tests/tooling/compose.test.mjs`
- Create: `Dockerfile`
- Create: `compose.yaml`
- Create: `.env.example`
- Create: `infra/supabase.override.yaml`
- Create: `infra/supabase/**` (generated)
- Create: `infra/supabase.version` (generated)
- Create: `scripts/vendor-supabase.sh`
- Create: `scripts/generate-local-secrets.sh`
- Create: `scripts/generate-local-secrets.mjs`
- Create: `scripts/wait-for-supabase.sh`
- Create: `scripts/apply-migrations.sh`
- Create: `scripts/run-pgtap.sh`
- Create: `tools/openrouter-mock/server.test.mjs`
- Create: `tools/openrouter-mock/server.mjs`
- Create: `tools/oauth-mock/fixtures/google-user.json`
- Create: `tools/oauth-mock/server.test.mjs`
- Create: `tools/oauth-mock/server.mjs`
- Create: `supabase/config.toml`
- Create: `supabase/seed.sql`

**Interfaces:**
- Consumes: Docker Compose 2.24 or newer, Git, OpenSSL, official `supabase/supabase` tag `v1.26.05`.
- Produces: root services `app`, `mailpit`, `openrouter-mock`, `oauth-mock`, `migrate`, `db-test` plus official Supabase service names; health endpoints `GET http://127.0.0.1:8787/health` and `GET http://127.0.0.1:8788/health` returning `{"status":"ok"}`; deterministic Google-style authorize/exchange at browser origin `http://127.0.0.1:8788`; local DB `127.0.0.1:54322`.

- [ ] **Step 1: Write failing infrastructure contract tests (4 minutes)**

Create `tests/tooling/compose.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("root compose owns every local entry-point service", async () => {
  const compose = await readFile("compose.yaml", "utf8");
  for (const name of ["app:", "mailpit:", "openrouter-mock:", "oauth-mock:", "migrate:", "db-test:"]) {
    assert.match(compose, new RegExp(`^  ${name}`, "m"));
  }
  assert.match(compose, /infra\/supabase\/docker-compose\.yml/);
});

test("uses one canonical loopback hostname for public browser services", async () => {
  const [compose, example, config] = await Promise.all([
    readFile("compose.yaml", "utf8"), readFile(".env.example", "utf8"),
    readFile("supabase/config.toml", "utf8"),
  ]);
  for (const source of [compose, example, config]) assert.doesNotMatch(source, /http:\/\/local(?:host)/u);
  assert.match(example, /^SERVER_SITE_ORIGIN=http:\/\/127\.0\.0\.1:5173$/mu);
  assert.match(example, /^API_EXTERNAL_URL=http:\/\/127\.0\.0\.1:8000$/mu);
  assert.match(example, /^VITE_AUTH_PROVIDER_MODE=oauth_mock$/mu);
  assert.match(example, /^VITE_OAUTH_MOCK_ORIGIN=http:\/\/127\.0\.0\.1:8788$/mu);
  assert.match(config, /site_url = "http:\/\/127\.0\.0\.1:5173"/u);
});

test("Dockerfile uses Node 24", async () => {
  assert.match(await readFile("Dockerfile", "utf8"), /^FROM node:24-/m);
});
```

Create `tools/openrouter-mock/server.test.mjs`:

```js
// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { createOpenRouterMockServer } from "./server.mjs";

let server;

afterEach(async () => {
  if (server) {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("returns a deterministic health payload", async () => {
  server = createOpenRouterMockServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Mock server did not bind a TCP port");
  }
  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});
```

Create `tools/oauth-mock/server.test.mjs`. The test starts the server with an injected fixture and injected local-session issuer, so it needs no Supabase process. It proves the exact app redirect, cancellation, one-time exchange, five-minute expiry, CORS binding, and absence of tokens in redirects/loggable values:

```js
// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import fixture from "./fixtures/google-user.json" with { type: "json" };
import { createOAuthMockServer } from "./server.mjs";

let server;
afterEach(async () => {
  if (server !== undefined) await new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()));
});

async function start(now = () => new Date("2026-07-11T00:00:00.000Z")) {
  server = createOAuthMockServer({
    appOrigin: "http://127.0.0.1:5173", fixture, now,
    issueLocalCredentials: vi.fn().mockResolvedValue({
      email: fixture.email, password: "local-random-password",
    }),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("oauth mock did not bind");
  return `http://127.0.0.1:${address.port}`;
}

it("redirects deterministic Google success and cancel to the exact app callback", async () => {
  const origin = await start();
  const common = new URLSearchParams({
    redirect_uri: "http://127.0.0.1:5173/auth/callback",
    flow: "10000000-0000-4000-8000-000000000001", state: "state-value",
  });
  const success = await fetch(`${origin}/authorize?${common}&action=approve`, { redirect: "manual" });
  const successUrl = new URL(success.headers.get("location"));
  expect(successUrl.origin + successUrl.pathname).toBe("http://127.0.0.1:5173/auth/callback");
  expect(successUrl.searchParams.get("flow")).toBe(common.get("flow"));
  expect(successUrl.searchParams.get("state")).toBe("state-value");
  expect(successUrl.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(successUrl.href).not.toMatch(/token|password|email/iu);

  const cancel = await fetch(`${origin}/authorize?${common}&action=cancel`, { redirect: "manual" });
  expect(new URL(cancel.headers.get("location")).searchParams.get("error")).toBe("access_denied");
});

it("exchanges an opaque code once, from the canonical app origin, within 300 seconds", async () => {
  const origin = await start();
  const authorize = await fetch(`${origin}/authorize?${new URLSearchParams({
    redirect_uri: "http://127.0.0.1:5173/auth/callback", action: "approve",
    flow: "10000000-0000-4000-8000-000000000001", state: "state-value",
  })}`, { redirect: "manual" });
  const code = new URL(authorize.headers.get("location")).searchParams.get("code");
  const exchange = () => fetch(`${origin}/exchange`, { method: "POST",
    headers: { origin: "http://127.0.0.1:5173", "content-type": "application/json" },
    body: JSON.stringify({ code }) });
  expect((await exchange()).status).toBe(200);
  expect((await exchange()).status).toBe(404);
  expect((await fetch(`${origin}/exchange`, { method: "POST",
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify({ code: "A".repeat(43) }) })).status).toBe(403);
});
```

- [ ] **Step 2: Run tests and verify the red state (2 minutes)**

Run:

```bash
node --test tests/tooling/compose.test.mjs
npm test -- --run tools/openrouter-mock/server.test.mjs tools/oauth-mock/server.test.mjs
```

Expected: both commands fail because the Dockerfile, Compose file, and both mock servers do not exist.

- [ ] **Step 3: Add the verified Supabase vendor script and execute it (5 minutes)**

Create `scripts/vendor-supabase.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

readonly TAG="v1.26.05"
readonly EXPECTED_SHORT_COMMIT="23b55d6"
readonly TARGET="infra/supabase"
readonly VERSION_FILE="infra/supabase.version"

if [[ -e "$TARGET" && "${1:-}" != "--refresh" ]]; then
  echo "$TARGET already exists; pass --refresh to replace generated vendor content" >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

git -C "$tmp_dir" init --quiet
git -C "$tmp_dir" remote add origin https://github.com/supabase/supabase.git
git -C "$tmp_dir" fetch --quiet --depth 1 origin "refs/tags/$TAG"
actual_short="$(git -C "$tmp_dir" rev-parse --short=7 FETCH_HEAD)"
if [[ "$actual_short" != "$EXPECTED_SHORT_COMMIT" ]]; then
  echo "unexpected Supabase commit: $actual_short" >&2
  exit 1
fi

rm -rf "$TARGET"
mkdir -p "$TARGET"
git -C "$tmp_dir" archive --format=tar FETCH_HEAD:docker | tar -xf - -C "$TARGET"
git -C "$tmp_dir" rev-parse FETCH_HEAD > "$VERSION_FILE"

echo "Vendored supabase/supabase $TAG ($actual_short) docker/"
```

Run:

```bash
chmod +x scripts/vendor-supabase.sh
./scripts/vendor-supabase.sh
test "$(cut -c1-7 infra/supabase.version)" = "23b55d6"
test -f infra/supabase/docker-compose.yml
```

Expected: the script prints `Vendored supabase/supabase v1.26.05 (23b55d6) docker/` and both checks exit 0. Review `git diff -- infra/supabase` only to confirm the official directory was copied; do not edit it.

- [ ] **Step 4: Implement local secrets, migration, pgTAP, and readiness scripts (5 minutes)**

Create `scripts/generate-local-secrets.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
exec node scripts/generate-local-secrets.mjs "$@"
```

Create `scripts/generate-local-secrets.mjs`:

```js
import { createHmac, randomBytes } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";

const force = process.argv.includes("--force");
const output = ".env";

if (!force) {
  try {
    await access(output);
    throw new Error(".env already exists; pass --force to rotate local-only credentials");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(".env already")) throw error;
  }
}

const source = await readFile("infra/supabase/.env.example", "utf8");
const values = new Map();
for (const line of source.split(/\r?\n/u)) {
  if (line.length === 0 || line.startsWith("#") || !line.includes("=")) continue;
  const separator = line.indexOf("=");
  values.set(line.slice(0, separator), line.slice(separator + 1));
}

const base64url = (value) => Buffer.from(value).toString("base64url");
const jwtSecret = randomBytes(32).toString("hex");
const now = Math.floor(Date.now() / 1000);
const signRole = (role) => {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ role, iss: "supabase", iat: now, exp: now + 315_576_000 }),
  );
  const signature = createHmac("sha256", jwtSecret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
};

values.set("POSTGRES_PASSWORD", randomBytes(24).toString("hex"));
values.set("JWT_SECRET", jwtSecret);
values.set("ANON_KEY", signRole("anon"));
values.set("SERVICE_ROLE_KEY", signRole("service_role"));
values.set("AUTH_CONTINUATION_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
values.set("AUTH_CONTINUATION_TTL_SECONDS", "300");
values.set("SERVER_SITE_ORIGIN", "http://127.0.0.1:5173");
values.set("DASHBOARD_USERNAME", "kondate");
values.set("DASHBOARD_PASSWORD", randomBytes(24).toString("base64url"));
values.set("SECRET_KEY_BASE", randomBytes(48).toString("hex"));
values.set("VAULT_ENC_KEY", randomBytes(16).toString("hex"));
values.set("SITE_URL", "http://127.0.0.1:5173");
values.set(
  "ADDITIONAL_REDIRECT_URLS",
  "http://127.0.0.1:5173/**",
);
values.set("API_EXTERNAL_URL", "http://127.0.0.1:8000");
values.set("SUPABASE_PUBLIC_URL", "http://127.0.0.1:8000");
values.set("SMTP_HOST", "mailpit");
values.set("SMTP_PORT", "1025");
values.set("SMTP_USER", "mailpit");
values.set("SMTP_PASS", "mailpit");
values.set("SMTP_ADMIN_EMAIL", "noreply@kondate.local");
values.set("SMTP_SENDER_NAME", "こんだて日和");
values.set("ENABLE_EMAIL_AUTOCONFIRM", "false");
values.set("ENABLE_GOOGLE_SIGNUP", "false");
values.set("GOOGLE_CLIENT_ID", "");
values.set("GOOGLE_SECRET", "");
values.set("GOOGLE_REDIRECT_URI", "http://127.0.0.1:8000/auth/v1/callback");
values.set("OAUTH_MOCK_USER_PASSWORD", randomBytes(24).toString("base64url"));
values.set("VITE_SUPABASE_URL", "http://127.0.0.1:8000");
values.set("VITE_MAGIC_LINK_RESEND_SECONDS", "60");
values.set("VITE_AUTH_CONTINUATION_TTL_MS", "300000");
values.set("VITE_AUTH_PROVIDER_MODE", "oauth_mock");
values.set("VITE_OAUTH_MOCK_ORIGIN", "http://127.0.0.1:8788");
values.set("LOCAL_DB_URL", `postgresql://postgres:${values.get("POSTGRES_PASSWORD")}@127.0.0.1:54322/postgres`);
values.set("OPENROUTER_BASE_URL", "http://openrouter-mock:8787");

const rendered = [...values.entries()].map(([key, value]) => `${key}=${value}`).join("\n");
await writeFile(output, `${rendered}\n`, { mode: 0o600 });
console.log("Created .env with local-only credentials");
```

Create `scripts/wait-for-supabase.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
url="${1:-http://kong:8000/auth/v1/health}"
for attempt in $(seq 1 60); do
  if curl --fail --silent --show-error "$url" >/dev/null; then
    echo "Supabase is ready"
    exit 0
  fi
  sleep 1
done
echo "Supabase did not become ready within 60 seconds" >&2
exit 1
```

Create `scripts/apply-migrations.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"

psql "$DATABASE_URL" --set ON_ERROR_STOP=1 <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[] not null default '{}',
  name text
);
SQL

shopt -s nullglob
for file in /workspace/supabase/migrations/*.sql; do
  filename="$(basename "$file")"
  version="${filename%%_*}"
  name="${filename#*_}"
  name="${name%.sql}"
  applied="$(psql "$DATABASE_URL" --tuples-only --no-align --command     "select 1 from supabase_migrations.schema_migrations where version = '$version'")"
  if [[ "$applied" == "1" ]]; then
    continue
  fi
  {
    echo "begin;"
    cat "$file"
    printf "\ninsert into supabase_migrations.schema_migrations(version, name) values ('%s', '%s');\n" "$version" "$name"
    echo "commit;"
  } | psql "$DATABASE_URL" --set ON_ERROR_STOP=1
done
```

Create `scripts/run-pgtap.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
if [[ "$#" -eq 0 ]]; then
  set -- /workspace/supabase/tests/database/*.test.sql
else
  requested=()
  for file in "$@"; do
    requested+=("/workspace/${file#/workspace/}")
  done
  set -- "${requested[@]}"
fi
pg_prove --failures --dbname "$DATABASE_URL" "$@"
```

Create `scripts/generate-database-types.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
if [[ ! -f .env ]]; then
  echo "Run ./scripts/generate-local-secrets.sh first" >&2
  exit 1
fi
set -a
source .env
set +a
: "${LOCAL_DB_URL:?LOCAL_DB_URL is required}"
tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT
npx supabase gen types typescript   --db-url "$LOCAL_DB_URL"   --schema public,private > "$tmp_file"
mv "$tmp_file" src/shared/types/database.generated.ts
trap - EXIT
echo "Generated src/shared/types/database.generated.ts"
```

Run: `chmod +x scripts/*.sh`

Expected: all six shell entry points are executable.

- [ ] **Step 5: Implement the OpenRouter mock, Docker image, and root Compose model (5 minutes)**

Create `tools/openrouter-mock/server.mjs`:

```js
import { createServer } from "node:http";

export function createOpenRouterMockServer() {
  return createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? "8787");
  createOpenRouterMockServer().listen(port, "0.0.0.0", () => {
    console.log(`openrouter-mock listening on ${port}`);
  });
}
```

Create the non-secret deterministic identity fixture `tools/oauth-mock/fixtures/google-user.json`:

```json
{
  "provider": "google",
  "subject": "kondate-local-google-1",
  "email": "google.oauth.local@kondate.test",
  "displayName": "Google テスト利用者"
}
```

Create `tools/oauth-mock/server.mjs`. The mock is a local test provider, not a replacement Supabase implementation: `/authorize` returns only an opaque one-time code to the app callback; `/exchange` is origin-bound, consumes the code, ensures the fixture user exists through the local GoTrue admin API, and returns only random local fixture credentials. Browser code then calls Supabase `signInWithPassword`; no token appears in a URL or mock log. The service accepts only the canonical app origin and a 300-second TTL:

```js
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const json = (response, status, value, origin) => {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...(origin === undefined ? {} : { "access-control-allow-origin": origin, vary: "Origin" }),
  });
  response.end(JSON.stringify(value));
};
const readJson = async (request) => {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2_048) throw new Error("body_too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

export function createOAuthMockServer({ appOrigin, fixture, now, issueLocalCredentials }) {
  const pending = new Map();
  const callback = new URL("/auth/callback", appOrigin).href;
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://oauth-mock.invalid");
    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, { status: "ok" });
    }
    if (request.method === "GET" && url.pathname === "/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri");
      const flow = url.searchParams.get("flow");
      const state = url.searchParams.get("state");
      const action = url.searchParams.get("action");
      if (redirectUri !== callback || !/^[0-9a-f-]{36}$/u.test(flow ?? "") ||
          state === null || state.length < 32 || state.length > 256 ||
          ![null, "approve", "cancel"].includes(action)) {
        return json(response, 400, { error: "invalid_request" });
      }
      if (action === null) {
        const approve = new URL(url); approve.searchParams.set("action", "approve");
        const cancel = new URL(url); cancel.searchParams.set("action", "cancel");
        response.writeHead(200, { "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
          "cache-control": "no-store" });
        return response.end(`<!doctype html><html lang="ja"><meta charset="utf-8">
          <title>ローカルGoogle認証</title><main><h1>ローカルGoogle認証</h1>
          <p>${fixture.displayName}として続けます。</p>
          <a href="${approve.pathname}${approve.search}">Googleテスト利用者で続ける</a>
          <a href="${cancel.pathname}${cancel.search}">キャンセル</a></main></html>`);
      }
      const destination = new URL(callback);
      destination.searchParams.set("flow", flow);
      destination.searchParams.set("state", state);
      if (action === "cancel") {
        destination.searchParams.set("error", "access_denied");
      } else {
        const code = randomBytes(32).toString("base64url");
        pending.set(code, { createdAt: now().getTime(), fixture });
        destination.searchParams.set("code", code);
      }
      response.writeHead(302, { location: destination.href, "cache-control": "no-store" });
      return response.end();
    }
    if (request.method === "OPTIONS" && url.pathname === "/exchange") {
      if (request.headers.origin !== appOrigin) return json(response, 403, { error: "origin_forbidden" });
      response.writeHead(204, { "access-control-allow-origin": appOrigin,
        "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type",
        vary: "Origin" });
      return response.end();
    }
    if (request.method === "POST" && url.pathname === "/exchange") {
      if (request.headers.origin !== appOrigin) return json(response, 403, { error: "origin_forbidden" });
      try {
        const body = await readJson(request);
        const code = typeof body.code === "string" ? body.code : "";
        const record = pending.get(code);
        pending.delete(code);
        if (record === undefined || now().getTime() - record.createdAt > 300_000) {
          return json(response, 404, { error: "code_unavailable" }, appOrigin);
        }
        const credentials = await issueLocalCredentials(record.fixture);
        return json(response, 200, credentials, appOrigin);
      } catch {
        return json(response, 400, { error: "invalid_request" }, appOrigin);
      }
    }
    return json(response, 404, { error: "not_found" });
  });
}

async function createLocalCredentialIssuer(env) {
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OAUTH_MOCK_USER_PASSWORD"];
  for (const key of required) if (typeof env[key] !== "string" || env[key] === "") {
    throw new Error(`oauth_mock_missing_${key.toLowerCase()}`);
  }
  return async (fixture) => {
    const response = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST", headers: { authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: env.SUPABASE_SERVICE_ROLE_KEY, "content-type": "application/json" },
      body: JSON.stringify({ email: fixture.email, password: env.OAUTH_MOCK_USER_PASSWORD,
        email_confirm: true, user_metadata: { provider: fixture.provider,
          providerSubject: fixture.subject, displayName: fixture.displayName } }),
    });
    if (!response.ok && response.status !== 422) throw new Error("oauth_mock_user_unavailable");
    return { email: fixture.email, password: env.OAUTH_MOCK_USER_PASSWORD };
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/google-user.json", import.meta.url), "utf8"));
  const issueLocalCredentials = await createLocalCredentialIssuer(process.env);
  const port = Number(process.env.PORT ?? "8788");
  createOAuthMockServer({ appOrigin: "http://127.0.0.1:5173", fixture,
    now: () => new Date(), issueLocalCredentials }).listen(port, "0.0.0.0", () => {
      console.log(`oauth-mock listening on ${port}`);
    });
}
```

Create `Dockerfile`:

```dockerfile
FROM node:24-bookworm-slim AS dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS development
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

FROM dependencies AS build
COPY . .
RUN npm run build
```

Create `infra/supabase.override.yaml`:

```yaml
services:
  db:
    ports:
      - "127.0.0.1:54322:5432"
  auth:
    environment:
      GOTRUE_SITE_URL: ${SITE_URL}
      GOTRUE_URI_ALLOW_LIST: ${ADDITIONAL_REDIRECT_URLS}
      GOTRUE_SMTP_HOST: mailpit
      GOTRUE_SMTP_PORT: 1025
      GOTRUE_SMTP_USER: ${SMTP_USER}
      GOTRUE_SMTP_PASS: ${SMTP_PASS}
      GOTRUE_SMTP_ADMIN_EMAIL: ${SMTP_ADMIN_EMAIL}
      GOTRUE_SMTP_SENDER_NAME: ${SMTP_SENDER_NAME}
      GOTRUE_EXTERNAL_GOOGLE_ENABLED: ${ENABLE_GOOGLE_SIGNUP:-false}
      GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}
      GOTRUE_EXTERNAL_GOOGLE_SECRET: ${GOOGLE_SECRET:-}
      GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI: ${GOOGLE_REDIRECT_URI}
```

Create `compose.yaml`:

```yaml
name: kondate

include:
  - path:
      - ./infra/supabase/docker-compose.yml
      - ./infra/supabase.override.yaml
    env_file: ./.env

services:
  mailpit:
    image: axllent/mailpit:v1.27
    restart: unless-stopped
    ports:
      - "127.0.0.1:1025:1025"
      - "127.0.0.1:8025:8025"
    healthcheck:
      test: ["CMD", "/mailpit", "readyz"]
      interval: 2s
      timeout: 2s
      retries: 30

  openrouter-mock:
    image: node:24-bookworm-slim
    working_dir: /workspace
    command: ["node", "tools/openrouter-mock/server.mjs"]
    environment:
      PORT: "8787"
    volumes:
      - .:/workspace:ro
    ports:
      - "127.0.0.1:8787:8787"
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)})",
        ]
      interval: 2s
      timeout: 2s
      retries: 30

  oauth-mock:
    image: node:24-bookworm-slim
    working_dir: /workspace
    command: ["node", "tools/oauth-mock/server.mjs"]
    depends_on:
      auth:
        condition: service_healthy
    environment:
      PORT: "8788"
      SUPABASE_URL: http://kong:8000
      SUPABASE_SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY}
      OAUTH_MOCK_USER_PASSWORD: ${OAUTH_MOCK_USER_PASSWORD}
    volumes:
      - .:/workspace:ro
    ports:
      - "127.0.0.1:8788:8788"
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:8788/health').then(r=>{if(!r.ok)process.exit(1)})",
        ]
      interval: 2s
      timeout: 2s
      retries: 30

  migrate:
    image: supabase/postgres:15.8.1.085
    depends_on:
      db:
        condition: service_healthy
    entrypoint: ["/workspace/scripts/apply-migrations.sh"]
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/postgres
    volumes:
      - .:/workspace:ro
    restart: "no"

  db-test:
    image: supabase/postgres:15.8.1.085
    depends_on:
      migrate:
        condition: service_completed_successfully
    entrypoint: ["/workspace/scripts/run-pgtap.sh"]
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/postgres
    volumes:
      - .:/workspace:ro
    restart: "no"

  app:
    build:
      context: .
      target: development
    depends_on:
      migrate:
        condition: service_completed_successfully
      mailpit:
        condition: service_healthy
      openrouter-mock:
        condition: service_healthy
      oauth-mock:
        condition: service_healthy
    environment:
      VITE_SUPABASE_URL: http://127.0.0.1:8000
      VITE_SUPABASE_PUBLISHABLE_KEY: ${ANON_KEY}
      VITE_MAGIC_LINK_RESEND_SECONDS: ${VITE_MAGIC_LINK_RESEND_SECONDS:-60}
      VITE_AUTH_CONTINUATION_TTL_MS: ${VITE_AUTH_CONTINUATION_TTL_MS:-300000}
      VITE_AUTH_PROVIDER_MODE: ${VITE_AUTH_PROVIDER_MODE:-oauth_mock}
      VITE_OAUTH_MOCK_ORIGIN: ${VITE_OAUTH_MOCK_ORIGIN:-http://127.0.0.1:8788}
      SUPABASE_URL: http://kong:8000
      SUPABASE_SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY}
      SERVER_SITE_ORIGIN: ${SERVER_SITE_ORIGIN:-http://127.0.0.1:5173}
      AUTH_CONTINUATION_ENCRYPTION_KEY: ${AUTH_CONTINUATION_ENCRYPTION_KEY}
      AUTH_CONTINUATION_TTL_SECONDS: ${AUTH_CONTINUATION_TTL_SECONDS:-300}
      OPENROUTER_BASE_URL: http://openrouter-mock:8787
    ports:
      - "127.0.0.1:5173:5173"
    volumes:
      - .:/workspace
      - node_modules:/workspace/node_modules

volumes:
  node_modules:
```

Create `.env.example`:

```dotenv
# Generate real local-only values with ./scripts/generate-local-secrets.sh.
POSTGRES_PASSWORD=
JWT_SECRET=
ANON_KEY=
SERVICE_ROLE_KEY=
AUTH_CONTINUATION_ENCRYPTION_KEY=
AUTH_CONTINUATION_TTL_SECONDS=300
SERVER_SITE_ORIGIN=http://127.0.0.1:5173
SITE_URL=http://127.0.0.1:5173
ADDITIONAL_REDIRECT_URLS=http://127.0.0.1:5173/**
API_EXTERNAL_URL=http://127.0.0.1:8000
SUPABASE_PUBLIC_URL=http://127.0.0.1:8000
SMTP_USER=mailpit
SMTP_PASS=mailpit
SMTP_ADMIN_EMAIL=noreply@kondate.local
SMTP_SENDER_NAME=こんだて日和
ENABLE_GOOGLE_SIGNUP=false
GOOGLE_CLIENT_ID=
GOOGLE_SECRET=
GOOGLE_REDIRECT_URI=http://127.0.0.1:8000/auth/v1/callback
OAUTH_MOCK_USER_PASSWORD=
VITE_SUPABASE_URL=http://127.0.0.1:8000
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_MAGIC_LINK_RESEND_SECONDS=60
VITE_AUTH_CONTINUATION_TTL_MS=300000
VITE_AUTH_PROVIDER_MODE=oauth_mock
VITE_OAUTH_MOCK_ORIGIN=http://127.0.0.1:8788
LOCAL_DB_URL=postgresql://postgres:REPLACE@127.0.0.1:54322/postgres
OPENROUTER_BASE_URL=http://openrouter-mock:8787
```

Create `supabase/config.toml`:

```toml
project_id = "kondate"

[api]
enabled = true
port = 54321
schemas = ["public", "graphql_public"]

[db]
port = 54322
major_version = 15

[auth]
enabled = true
site_url = "http://127.0.0.1:5173"
additional_redirect_urls = ["http://127.0.0.1:5173/auth/callback"]
jwt_expiry = 3600
enable_signup = true

[auth.email]
enable_signup = true
double_confirm_changes = true
enable_confirmations = true
```

Create `supabase/seed.sql`:

```sql
begin;
commit;
```

- [ ] **Step 6: Verify the isolated mock and resolved Compose graph (5 minutes)**

Run:

```bash
./scripts/generate-local-secrets.sh
node --test tests/tooling/compose.test.mjs
npm test -- --run tools/openrouter-mock/server.test.mjs tools/oauth-mock/server.test.mjs
docker compose config --quiet
docker compose up -d mailpit openrouter-mock oauth-mock db auth rest kong
docker compose run --rm migrate
curl --fail --silent http://127.0.0.1:8787/health
curl --fail --silent http://127.0.0.1:8788/health
curl --fail --silent http://127.0.0.1:8000/auth/v1/health
```

Expected: tests pass; Compose config exits 0; migration exits 0 even with no migration files; both mock health curls return `{"status":"ok"}`; Auth health returns HTTP 200. The OAuth test proves exact success/cancel redirects, one-time exchange, 300-second expiry, canonical CORS, and no token-bearing callback. If the official tag changed a service/image name referenced by the override, `docker compose config` must fail and the override—not vendor content—must be corrected.

- [ ] **Step 7: Commit reproducible local infrastructure (3 minutes)**

```bash
git add Dockerfile compose.yaml .env.example infra scripts tools/openrouter-mock tools/oauth-mock supabase/config.toml supabase/seed.sql tests/tooling/compose.test.mjs
git commit -m "chore: add reproducible local Supabase stack"
```

### Task 5: Create extensions, the non-exposed private schema, and pgTAP helpers

**Files:**
- Create: `supabase/migrations/20260711000100_extensions_and_schemas.sql`
- Create: `supabase/tests/database/000_helpers.sql`
- Create: `supabase/tests/database/001_extensions_and_schemas.test.sql`
- Modify: `scripts/run-pgtap.sh`

**Interfaces:**
- Consumes: Task 4 migration and `db-test` services.
- Produces: `extensions` and non-exposed `private` schemas; `pgcrypto` and `pgtap`; test-only functions `tests.create_supabase_user(uuid,text)`, `tests.authenticate_as(uuid)`, and `tests.clear_authentication()`.

- [ ] **Step 1: Write the failing schema boundary test and test helpers (4 minutes)**

Create `supabase/tests/database/000_helpers.sql`:

```sql
create schema if not exists tests;

create or replace function tests.create_supabase_user(
  p_user_id uuid,
  p_email text default 'test@example.invalid'
)
returns void
language sql
security definer
set search_path = ''
as $function$
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    p_user_id,
    'authenticated',
    'authenticated',
    p_email,
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  )
  on conflict (id) do nothing;
$function$;

create or replace function tests.authenticate_as(p_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $function$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_user_id, 'role', 'authenticated')::text,
    true
  );
end;
$function$;

create or replace function tests.clear_authentication()
returns void
language plpgsql
set search_path = ''
as $function$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
end;
$function$;
```

Create `supabase/tests/database/001_extensions_and_schemas.test.sql`:

```sql
\ir 000_helpers.sql
begin;
select plan(6);

select has_schema('extensions', 'extensions schema exists');
select has_schema('private', 'private schema exists');
select has_extension('pgcrypto', 'pgcrypto is installed');
select has_extension('pgtap', 'pgtap is installed');
select ok(
  not has_schema_privilege('anon', 'private', 'usage'),
  'anon cannot use private schema'
);
select ok(
  not has_schema_privilege('authenticated', 'private', 'usage'),
  'authenticated cannot use private schema'
);

select * from finish();
rollback;
```

Change `scripts/run-pgtap.sh` to the following complete content so helper SQL is included by each test rather than treated as a test itself:

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
if [[ "$#" -eq 0 ]]; then
  set -- /workspace/supabase/tests/database/*.test.sql
else
  requested=()
  for file in "$@"; do
    requested+=("/workspace/${file#/workspace/}")
  done
  set -- "${requested[@]}"
fi
cd /workspace/supabase/tests/database
pg_prove --failures --dbname "$DATABASE_URL" "$@"
```

- [ ] **Step 2: Run the focused DB test and verify failure (3 minutes)**

Run: `npm run db:test -- supabase/tests/database/001_extensions_and_schemas.test.sql`

Expected: FAIL because `private`, `pgcrypto`, or `pgtap` has not been created by a Kondate migration.

- [ ] **Step 3: Implement the base migration (3 minutes)**

Create `supabase/migrations/20260711000100_extensions_and_schemas.sql`:

```sql
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgtap with schema extensions;

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;
grant usage on schema private to service_role;

alter default privileges in schema private revoke all on tables from public, anon, authenticated;
alter default privileges in schema private revoke all on sequences from public, anon, authenticated;
alter default privileges in schema private revoke all on functions from public, anon, authenticated;
```

- [ ] **Step 4: Apply and pass the DB test (4 minutes)**

Run:

```bash
docker compose run --rm migrate
npm run db:test -- supabase/tests/database/001_extensions_and_schemas.test.sql
```

Expected: migration records version `20260711000100` and pgTAP reports `All tests successful` with six assertions.

- [ ] **Step 5: Commit the database base (2 minutes)**

```bash
git add scripts/run-pgtap.sh supabase/migrations/20260711000100_extensions_and_schemas.sql supabase/tests/database/000_helpers.sql supabase/tests/database/001_extensions_and_schemas.test.sql
git commit -m "feat: establish private database boundary"
```

### Task 6: Add household/privacy tables, final catalog schema, RLS, and generated types

**Files:**
- Create: `supabase/tests/database/002_household_rls.test.sql`
- Create: `supabase/tests/database/003_catalog_grants.test.sql`
- Create: `supabase/migrations/20260711000200_profiles_household_privacy.sql`
- Create: `supabase/migrations/20260711000300_safety_catalogs.sql`
- Create: `src/shared/types/database.generated.ts` (generated)

**Interfaces:**
- Consumes: `auth.users`, `auth.uid()`, and Task 5 schemas.
- Produces: `public.profiles`, `household_members`, `member_allergies`, `member_dislikes`, `privacy_consents`, RPC `complete_household_member(p_member_id uuid)`, and the final empty read-only schema for `allergen_catalog`, `allergen_aliases`, and `food_safety_rules`. Plan 2 exclusively owns reviewed catalog data migration `20260711000400_safety_catalog_data.sql`.
- Produces exact household columns: `id,user_id,status,display_name,age_band,portion_size,spice_level,ease_preferences,required_safety_constraints,allergy_status,unsupported_diet_status,unsupported_diet_kinds,sort_order,created_at,updated_at`.
- Produces exact allergy columns: `id,user_id,member_id,allergen_id,custom_name,custom_aliases,custom_confirmed,created_at`.

- [ ] **Step 1: Write failing RLS and completion tests (5 minutes)**

Create `supabase/tests/database/002_household_rls.test.sql`:

```sql
\ir 000_helpers.sql
begin;
select plan(12);

select tests.create_supabase_user('11111111-1111-1111-1111-111111111111', 'one@example.invalid');
select tests.create_supabase_user('22222222-2222-2222-2222-222222222222', 'two@example.invalid');

select tests.authenticate_as('11111111-1111-1111-1111-111111111111');
set local role authenticated;

select lives_ok(
  $sql$
    insert into public.household_members (
      id, user_id, age_band, allergy_status, unsupported_diet_status
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      '11111111-1111-1111-1111-111111111111',
      'adult', 'none', 'none'
    )
  $sql$,
  'owner can insert a draft member'
);
select is(
  (select count(*)::integer from public.household_members),
  1,
  'owner sees their member'
);
select throws_ok(
  $sql$
    insert into public.household_members (user_id)
    values ('22222222-2222-2222-2222-222222222222')
  $sql$,
  '42501',
  null,
  'owner cannot insert for another user'
);
select lives_ok(
  $sql$select public.complete_household_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$sql$,
  'required fields permit completion'
);
select is(
  (
    select status
    from public.household_members
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  'complete',
  'completion RPC writes complete status'
);

reset role;
select tests.authenticate_as('22222222-2222-2222-2222-222222222222');
set local role authenticated;
select is(
  (select count(*)::integer from public.household_members),
  0,
  'second user cannot read first user member'
);
with changed as (
  update public.household_members set display_name = 'x' returning 1
)
select is((select count(*)::integer from changed), 0, 'second user cannot update first user member');
with removed as (
  delete from public.household_members returning 1
)
select is((select count(*)::integer from removed), 0, 'second user cannot delete first user member');
select is(
  (select count(*)::integer from public.profiles),
  1,
  'auth trigger created only the current visible profile'
);
select ok(
  has_table_privilege('authenticated', 'public.privacy_consents', 'select'),
  'authenticated has explicit privacy select grant'
);
select ok(
  not has_table_privilege('anon', 'public.household_members', 'select'),
  'anon has no household select grant'
);
select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'delete'),
  'browser cannot delete profiles'
);

select * from finish();
rollback;
```

Create `supabase/tests/database/003_catalog_grants.test.sql`:

```sql
\ir 000_helpers.sql
begin;
select plan(8);
select has_table('public', 'allergen_catalog');
select has_table('public', 'allergen_aliases');
select has_table('public', 'food_safety_rules');
select ok(has_table_privilege('authenticated', 'public.allergen_catalog', 'select'), 'authenticated reads catalog');
select ok(not has_table_privilege('authenticated', 'public.allergen_catalog', 'insert'), 'authenticated cannot insert catalog');
select ok(not has_table_privilege('anon', 'public.allergen_catalog', 'select'), 'anonymous cannot read catalog');
select ok((select relrowsecurity from pg_class where oid = 'public.allergen_catalog'::regclass), 'catalog RLS is enabled');
select is((select count(*)::integer from public.allergen_catalog), 0, 'Plan 1 creates no unreviewed catalog data');
select * from finish();
rollback;
```

- [ ] **Step 2: Run both tests and verify failure (3 minutes)**

Run: `npm run db:test -- supabase/tests/database/002_household_rls.test.sql supabase/tests/database/003_catalog_grants.test.sql`

Expected: FAIL with missing relation `public.household_members` or `public.allergen_catalog`.

- [ ] **Step 3: Implement profiles, household, allergies, dislikes, privacy, RLS, and grants (5 minutes)**

Create `supabase/migrations/20260711000200_profiles_household_privacy.sql`:

```sql
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  onboarding_status text not null default 'not_started'
    check (onboarding_status in ('not_started', 'in_progress', 'complete')),
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (onboarding_status = 'complete' and onboarding_completed_at is not null)
    or (onboarding_status <> 'complete' and onboarding_completed_at is null)
  )
);

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  status text not null default 'draft' check (status in ('draft', 'complete')),
  display_name text check (display_name is null or char_length(display_name) between 1 and 30),
  age_band text check (
    age_band is null or age_band in (
      'post_weaning_to_2', 'age_3_5', 'age_6_8', 'age_9_12',
      'age_13_17', 'adult', 'senior'
    )
  ),
  portion_size text check (portion_size is null or portion_size in ('small', 'regular', 'large')),
  spice_level text check (spice_level is null or spice_level in ('none', 'mild', 'regular')),
  ease_preferences text[] not null default '{}'
    check (ease_preferences <@ array['small_pieces', 'boneless', 'soft']::text[]),
  required_safety_constraints text[] not null default '{}'
    check (required_safety_constraints <@ array['remove_bones', 'cut_small']::text[]),
  allergy_status text check (allergy_status is null or allergy_status in ('none', 'registered', 'unconfirmed')),
  unsupported_diet_status text check (
    unsupported_diet_status is null or unsupported_diet_status in ('none', 'present', 'unconfirmed')
  ),
  unsupported_diet_kinds text[] not null default '{}'
    check (
      unsupported_diet_kinds <@ array[
        'weaning_food', 'swallowing_concern', 'therapeutic_diet'
      ]::text[]
    ),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  check (
    status = 'draft'
    or (age_band is not null and allergy_status is not null and unsupported_diet_status is not null)
  ),
  check (
    (unsupported_diet_status = 'present' and cardinality(unsupported_diet_kinds) > 0)
    or (unsupported_diet_status is distinct from 'present' and cardinality(unsupported_diet_kinds) = 0)
  )
);

create table public.member_allergies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  member_id uuid not null,
  allergen_id text,
  custom_name text check (custom_name is null or char_length(btrim(custom_name)) between 1 and 80),
  custom_aliases text[] not null default '{}',
  custom_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (member_id, user_id)
    references public.household_members(id, user_id) on delete cascade,
  check (
    (allergen_id is not null and custom_name is null and not custom_confirmed and cardinality(custom_aliases) = 0)
    or (allergen_id is null and custom_name is not null and custom_confirmed)
  )
);

create unique index member_allergies_standard_unique
  on public.member_allergies(member_id, allergen_id)
  where allergen_id is not null;

create table public.member_dislikes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  member_id uuid not null,
  ingredient_name text not null check (char_length(btrim(ingredient_name)) between 1 and 80),
  created_at timestamptz not null default now(),
  foreign key (member_id, user_id)
    references public.household_members(id, user_id) on delete cascade
);

create unique index member_dislikes_name_unique
  on public.member_dislikes(member_id, lower(btrim(ingredient_name)));

create table public.privacy_consents (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  notice_version text not null check (char_length(notice_version) between 1 and 50),
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, notice_version)
);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger household_members_set_updated_at
before update on public.household_members
for each row execute function private.set_updated_at();

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.profiles(user_id) values (new.id);
  return new;
end;
$function$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

create or replace function public.complete_household_member(p_member_id uuid)
returns public.household_members
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  result public.household_members;
begin
  update public.household_members
  set status = 'complete'
  where id = p_member_id
    and user_id = auth.uid()
    and age_band is not null
    and allergy_status is not null
    and unsupported_diet_status is not null
    and (
      allergy_status <> 'registered'
      or exists (
        select 1 from public.member_allergies
        where member_id = p_member_id and user_id = auth.uid()
      )
    )
  returning * into result;
  if result.id is null then
    raise exception using
      errcode = '23514',
      message = 'member_required_fields_incomplete';
  end if;
  return result;
end;
$function$;

alter table public.profiles enable row level security;
alter table public.household_members enable row level security;
alter table public.member_allergies enable row level security;
alter table public.member_dislikes enable row level security;
alter table public.privacy_consents enable row level security;

create policy profiles_select_own on public.profiles
for select to authenticated using (user_id = auth.uid());
create policy profiles_update_own on public.profiles
for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy members_select_own on public.household_members
for select to authenticated using (user_id = auth.uid());
create policy members_insert_own on public.household_members
for insert to authenticated with check (user_id = auth.uid());
create policy members_update_own on public.household_members
for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy members_delete_own on public.household_members
for delete to authenticated using (user_id = auth.uid());

create policy allergies_select_own on public.member_allergies
for select to authenticated using (user_id = auth.uid());
create policy allergies_insert_own on public.member_allergies
for insert to authenticated with check (user_id = auth.uid());
create policy allergies_update_own on public.member_allergies
for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy allergies_delete_own on public.member_allergies
for delete to authenticated using (user_id = auth.uid());

create policy dislikes_select_own on public.member_dislikes
for select to authenticated using (user_id = auth.uid());
create policy dislikes_insert_own on public.member_dislikes
for insert to authenticated with check (user_id = auth.uid());
create policy dislikes_update_own on public.member_dislikes
for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy dislikes_delete_own on public.member_dislikes
for delete to authenticated using (user_id = auth.uid());

create policy consents_select_own on public.privacy_consents
for select to authenticated using (user_id = auth.uid());
create policy consents_insert_own on public.privacy_consents
for insert to authenticated with check (user_id = auth.uid());

revoke all on public.profiles, public.household_members, public.member_allergies,
  public.member_dislikes, public.privacy_consents from anon;
revoke all on public.profiles, public.household_members, public.member_allergies,
  public.member_dislikes, public.privacy_consents from authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.household_members to authenticated;
grant select, insert, update, delete on public.member_allergies to authenticated;
grant select, insert, update, delete on public.member_dislikes to authenticated;
grant select, insert on public.privacy_consents to authenticated;

revoke all on function public.complete_household_member(uuid) from public, anon;
grant execute on function public.complete_household_member(uuid) to authenticated;
```

- [ ] **Step 4: Create the final empty catalog schema and read-only boundary (5 minutes)**

Create `supabase/migrations/20260711000300_safety_catalogs.sql`:

```sql
create table public.allergen_catalog (
  id text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  display_name text not null unique check (char_length(display_name) between 1 and 40),
  regulatory_class text not null check (regulatory_class in ('mandatory', 'recommended')),
  catalog_version text not null check (char_length(catalog_version) between 1 and 80),
  created_at timestamptz not null default now()
);

create table public.allergen_aliases (
  id uuid primary key default gen_random_uuid(),
  allergen_id text not null references public.allergen_catalog(id) on delete restrict,
  alias text not null check (char_length(alias) between 1 and 80),
  normalized_alias text not null check (char_length(normalized_alias) between 1 and 80),
  alias_kind text not null check (alias_kind in ('direct', 'derived', 'processed')),
  requires_label_confirmation boolean not null,
  dictionary_version text not null check (char_length(dictionary_version) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (allergen_id, normalized_alias, dictionary_version),
  check ((alias_kind = 'processed') = requires_label_confirmation)
);
create index allergen_aliases_normalized_alias_idx on public.allergen_aliases(normalized_alias);

create table public.food_safety_rules (
  id text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  applies_to_age_bands text[] not null check (cardinality(applies_to_age_bands) > 0),
  match_terms text[] not null check (cardinality(match_terms) > 0),
  rule_kind text not null check (rule_kind in ('forbidden', 'requires_tag')),
  required_safety_tag text,
  user_message text not null check (char_length(user_message) between 1 and 200),
  rule_version text not null check (char_length(rule_version) between 1 and 80),
  created_at timestamptz not null default now(),
  check (
    (rule_kind = 'forbidden' and required_safety_tag is null)
    or (rule_kind = 'requires_tag' and required_safety_tag ~ '^[a-z][a-z0-9_]*$')
  ),
  check (applies_to_age_bands <@ array[
    'post_weaning_to_2','age_3_5','age_6_8','age_9_12','age_13_17','adult','senior'
  ]::text[])
);

alter table public.member_allergies
  add constraint member_allergies_allergen_id_fkey
  foreign key (allergen_id) references public.allergen_catalog(id) on delete restrict;

alter table public.allergen_catalog enable row level security;
alter table public.allergen_aliases enable row level security;
alter table public.food_safety_rules enable row level security;
revoke all on public.allergen_catalog, public.allergen_aliases, public.food_safety_rules
  from public, anon, authenticated;
grant select on public.allergen_catalog, public.allergen_aliases, public.food_safety_rules
  to authenticated;
create policy allergen_catalog_authenticated_read on public.allergen_catalog
  for select to authenticated using (true);
create policy allergen_aliases_authenticated_read on public.allergen_aliases
  for select to authenticated using (true);
create policy food_safety_rules_authenticated_read on public.food_safety_rules
  for select to authenticated using (true);
```

- [ ] **Step 5: Apply the migrations and verify RLS/grants (5 minutes)**

Run:

```bash
docker compose run --rm migrate
npm run db:test -- supabase/tests/database/002_household_rls.test.sql supabase/tests/database/003_catalog_grants.test.sql
```

Expected: both files report `All tests successful`; owner CRUD succeeds, cross-user CRUD is invisible/rejected, anon has no data access, and catalog writes remain unavailable to browser roles.

- [ ] **Step 6: Generate and typecheck the exact database contract (4 minutes)**

Run:

```bash
mkdir -p src/shared/types
npm run db:types
rg 'household_members|member_allergies|privacy_consents|allergen_catalog' src/shared/types/database.generated.ts
npm run typecheck
```

Expected: the generator exits 0; `rg` finds all four names; generated `Database` includes both `public` and `private` schemas and helper aliases; typecheck exits 0. Never paste or manually normalize the generated file.

- [ ] **Step 7: Commit household, privacy, and catalog schema boundaries (3 minutes)**

```bash
git add supabase/migrations/20260711000200_profiles_household_privacy.sql supabase/migrations/20260711000300_safety_catalogs.sql supabase/tests/database/002_household_rls.test.sql supabase/tests/database/003_catalog_grants.test.sql src/shared/types/database.generated.ts scripts/generate-database-types.sh
git commit -m "feat: protect household and privacy data with RLS"
```

### Task 7: Add validated public configuration, browser Supabase, session recovery, and auth-flow storage

**Files:**
- Create: `supabase/migrations/20260711000330_auth_continuations.sql`
- Create: `supabase/tests/database/004_auth_continuations.test.sql`
- Create: `netlify/functions/_shared/env.ts`
- Create: `netlify/functions/_shared/env.test.ts`
- Create: `netlify/functions/_shared/http.ts`
- Create: `netlify/functions/_shared/http.test.ts`
- Create: `netlify/functions/_shared/supabase-admin.ts`
- Create: `netlify/functions/_shared/auth-continuation-crypto.ts`
- Create: `netlify/functions/_shared/auth-continuation-crypto.test.ts`
- Create: `netlify/functions/auth-continuation-create.test.ts`
- Create: `netlify/functions/auth-continuation-create.ts`
- Create: `netlify/functions/auth-continuation-deposit.test.ts`
- Create: `netlify/functions/auth-continuation-deposit.ts`
- Create: `netlify/functions/auth-continuation-claim.test.ts`
- Create: `netlify/functions/auth-continuation-claim.ts`
- Create: `src/shared/config/public-env.test.ts`
- Create: `src/shared/config/public-env.ts`
- Create: `src/shared/lib/supabase.ts`
- Create: `src/features/auth/auth-flow.test.ts`
- Create: `src/features/auth/auth-flow.ts`
- Create: `src/features/auth/auth-provider.test.tsx`
- Create: `src/features/auth/auth-provider.tsx`
- Create: `src/features/auth/auth-continuation-recovery.test.ts`
- Create: `src/features/auth/auth-continuation-recovery.ts`
- Create: `src/features/auth/session.ts`

**Interfaces:**
- Consumes: generated `Database`, the four server continuation secrets/settings plus `AUTH_CONTINUATION_TTL_SECONDS=300`, and only browser-safe Vite variables in browser code. Local auth additionally consumes exact `VITE_AUTH_PROVIDER_MODE=oauth_mock` and `VITE_OAUTH_MOCK_ORIGIN=http://127.0.0.1:8788`; production consumes `VITE_AUTH_PROVIDER_MODE=supabase`, must not define a mock origin, and uses the exact managed Supabase origin `https://<project-ref>.supabase.co` on both browser and server sides.
- Produces: `ServerEnv`, compile-consistent `PublicEnv`, the server-backed single-use continuation, exact fetch-style routes `/api/auth/continuations`, `/api/auth/continuations/:continuationId/callback`, and `/api/auth/continuations/:continuationId/claim`, `BrowserSupabaseClient`, `AuthProvider`, `useAuth()`, complete safe return-path/flow helpers, and `requireAccessToken`.
- `useAuth()` returns `{ status: "loading" | "authenticated" | "unauthenticated"; session: Session | null; refreshSession(): Promise<void> }`.

- [ ] **Step 1: Write failing environment and auth-flow tests (5 minutes)**

Create `src/shared/config/public-env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parsePublicEnv } from "./public-env";

describe("parsePublicEnv", () => {
  it("normalizes valid browser-only settings", () => {
    expect(
      parsePublicEnv({
        VITE_SUPABASE_URL: "http://127.0.0.1:8000",
        VITE_SUPABASE_PUBLISHABLE_KEY: "public-key",
        VITE_MAGIC_LINK_RESEND_SECONDS: "60",
        VITE_AUTH_CONTINUATION_TTL_MS: "300000",
        VITE_AUTH_PROVIDER_MODE: "oauth_mock",
        VITE_OAUTH_MOCK_ORIGIN: "http://127.0.0.1:8788",
      }),
    ).toEqual({
      supabaseUrl: "http://127.0.0.1:8000",
      supabasePublishableKey: "public-key",
      magicLinkResendSeconds: 60,
      authContinuationTtlMs: 300_000,
      authProviderMode: "oauth_mock",
      oauthMockOrigin: "http://127.0.0.1:8788",
    });
  });

  it("rejects a missing publishable key without echoing its value", () => {
    expect(() =>
      parsePublicEnv({
        VITE_SUPABASE_URL: "http://127.0.0.1:8000",
        VITE_MAGIC_LINK_RESEND_SECONDS: "60",
        VITE_AUTH_CONTINUATION_TTL_MS: "300000",
        VITE_AUTH_PROVIDER_MODE: "oauth_mock",
        VITE_OAUTH_MOCK_ORIGIN: "http://127.0.0.1:8788",
      }),
    ).toThrow("公開設定を読み込めません");
  });

  it("accepts real Supabase Google only in production and rejects every mock value", () => {
    const base = {
      VITE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "public-key",
      VITE_MAGIC_LINK_RESEND_SECONDS: "60",
      VITE_AUTH_CONTINUATION_TTL_MS: "300000",
    };
    expect(parsePublicEnv({ ...base, VITE_AUTH_PROVIDER_MODE: "supabase" },
      { production: true })).toMatchObject({
        authProviderMode: "supabase", oauthMockOrigin: null,
        authContinuationTtlMs: 300_000,
      });
    expect(() => parsePublicEnv({ ...base, VITE_AUTH_PROVIDER_MODE: "oauth_mock",
      VITE_OAUTH_MOCK_ORIGIN: "http://127.0.0.1:8788" }, { production: true })).toThrow();
    expect(() => parsePublicEnv({ ...base, VITE_AUTH_PROVIDER_MODE: "supabase",
      VITE_OAUTH_MOCK_ORIGIN: "http://127.0.0.1:8788" }, { production: true })).toThrow();
    expect(() => parsePublicEnv({ ...base, VITE_SUPABASE_URL: "http://127.0.0.1:8000",
      VITE_AUTH_PROVIDER_MODE: "supabase" }, { production: true })).toThrow();
    for (const unsafeUrl of [
      "https://collector.example",
      "https://short.supabase.co",
      "https://ABCDEFGHIJKLMNOPQRST.supabase.co",
      "https://abcdefghijklmnopqrst.supabase.co.evil.example",
      "https://user@abcdefghijklmnopqrst.supabase.co",
      "https://abcdefghijklmnopqrst.supabase.co:443",
      "https://abcdefghijklmnopqrst.supabase.co/",
      "https://abcdefghijklmnopqrst.supabase.co/rest/v1",
      "https://abcdefghijklmnopqrst.supabase.co?redirect=evil",
      "https://abcdefghijklmnopqrst.supabase.co#fragment",
    ]) {
      expect(() => parsePublicEnv({ ...base, VITE_SUPABASE_URL: unsafeUrl,
        VITE_AUTH_PROVIDER_MODE: "supabase" }, { production: true })).toThrow(
          "公開設定を読み込めません",
        );
    }
  });
});
```

Create `netlify/functions/_shared/env.test.ts`:

```ts
import { expect, it } from "vitest";
import { parseManagedSupabaseProjectRef, parseServerEnv } from "./env";

const validServerEnv = {
  SUPABASE_URL: "http://kong:8000",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-at-least-twenty-characters",
  SERVER_SITE_ORIGIN: "http://127.0.0.1:5173",
  AUTH_CONTINUATION_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  AUTH_CONTINUATION_TTL_SECONDS: "300",
};

it("parses the exact five-minute server continuation TTL in seconds", () => {
  expect(parseServerEnv(validServerEnv).AUTH_CONTINUATION_TTL_SECONDS).toBe(300);
});

it("accepts only an exact managed Supabase origin for an HTTPS deployment", () => {
  const production = {
    ...validServerEnv,
    SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SERVER_SITE_ORIGIN: "https://kondate.example",
  };
  expect(parseServerEnv(production).SUPABASE_URL).toBe(production.SUPABASE_URL);
  for (const unsafeUrl of [
    "https://collector.example",
    "https://short.supabase.co",
    "https://ABCDEFGHIJKLMNOPQRST.supabase.co",
    "https://abcdefghijklmnopqrst.supabase.co.evil.example",
    "https://abcdefghijklmnopqrst.supabase.co:443",
    "https://abcdefghijklmnopqrst.supabase.co/",
    "https://abcdefghijklmnopqrst.supabase.co/rest/v1",
    "https://abcdefghijklmnopqrst.supabase.co?redirect=evil",
    "https://abcdefghijklmnopqrst.supabase.co#fragment",
    "https://user@abcdefghijklmnopqrst.supabase.co",
  ]) {
    expect(() => parseServerEnv({ ...production, SUPABASE_URL: unsafeUrl }))
      .toThrow("server_configuration_invalid");
  }
});

it.each(["299", "300000"])("rejects a wrong server TTL unit/value: %s", (value) => {
  expect(() => parseServerEnv({
    ...validServerEnv,
    AUTH_CONTINUATION_TTL_SECONDS: value,
  })).toThrow();
});

it("does not accept the browser millisecond key in place of the server key", () => {
  expect(() => parseServerEnv({
    SUPABASE_URL: validServerEnv.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: validServerEnv.SUPABASE_SERVICE_ROLE_KEY,
    SERVER_SITE_ORIGIN: validServerEnv.SERVER_SITE_ORIGIN,
    AUTH_CONTINUATION_ENCRYPTION_KEY: validServerEnv.AUTH_CONTINUATION_ENCRYPTION_KEY,
    VITE_AUTH_CONTINUATION_TTL_MS: "300000",
  })).toThrow();
});
```

Create `src/features/auth/auth-flow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  clearAuthFlow,
  createAuthFlow,
  readAuthFlow,
  sanitizeReturnPath,
} from "./auth-flow";

const fixedFlowDeps = {
  randomBytes: () => new Uint8Array(32).fill(7),
  now: () => new Date("2026-07-11T00:00:00Z"),
};
const continuationApiMock = () => ({
  lastCreateInput: null as null | { state: string; secret: string; returnTo: string },
  async create(input: { state: string; secret: string; returnTo: string }) {
    this.lastCreateInput = input;
    return { id: "10000000-0000-4000-8000-000000000001", expiresAt: "2026-07-11T00:05:00Z" };
  },
  async deposit() {},
  async claim() { throw new Error("not deposited"); },
});

describe("auth flow storage", () => {
  it("accepts only same-origin path values", () => {
    expect(sanitizeReturnPath("/planner?resume=1")).toBe("/planner?resume=1");
    expect(sanitizeReturnPath("https://attacker.example")).toBe("/planner");
    expect(sanitizeReturnPath("//attacker.example")).toBe("/planner");
  });

  it("keeps the claim secret only in the initiating browser", async () => {
    const shared = new MapStorage();
    const isolated = new MapStorage();
    const api = continuationApiMock();
    const flow = await createAuthFlow("/onboarding", api, shared, fixedFlowDeps);
    expect(readAuthFlow(flow.id, shared)).toEqual(flow);
    expect(readAuthFlow(flow.id, isolated)).toBeNull();
    expect(api.lastCreateInput).not.toHaveProperty("verifier");
    clearAuthFlow(flow.id, shared);
    expect(readAuthFlow(flow.id, shared)).toBeNull();
  });
});

class MapStorage implements Storage {
  readonly #values = new Map<string, string>();
  get length() {
    return this.#values.size;
  }
  clear() {
    this.#values.clear();
  }
  getItem(key: string) {
    return this.#values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.#values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.#values.delete(key);
  }
  setItem(key: string, value: string) {
    this.#values.set(key, value);
  }
}
```

Create `src/features/auth/auth-provider.test.tsx`:

```tsx
import type { Session } from "@supabase/supabase-js";
import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth-provider";

const session = { access_token: "token", user: { id: "user-1" } } as Session;

function Probe() {
  const auth = useAuth();
  useEffect(() => {
    if (auth.status === "authenticated") document.title = auth.session.user.id;
  }, [auth]);
  return <output>{auth.status}</output>;
}

describe("AuthProvider", () => {
  it("loads the initial session and refreshes on focus", async () => {
    const getSession = vi
      .fn()
      .mockResolvedValueOnce({ data: { session: null }, error: null })
      .mockResolvedValueOnce({ data: { session }, error: null });
    const client = {
      auth: {
        getSession,
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
      },
    };

    render(
      <AuthProvider client={client}>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(await screen.findByText("authenticated")).toBeInTheDocument();
    expect(getSession).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the tests and verify failure (2 minutes)**

Run: `npm test -- --run netlify/functions/_shared/env.test.ts src/shared/config/public-env.test.ts src/features/auth/auth-flow.test.ts src/features/auth/auth-provider.test.tsx`

Expected: FAIL because the server/public environment and three auth implementation modules do not exist.

- [ ] **Step 3: Implement separate server-seconds and browser-milliseconds environment parsing plus the lazy typed client (4 minutes)**

Create `netlify/functions/_shared/env.ts` first; this is the schema Plan 2 and Plan 3 extend without replacing:

```ts
import { Buffer } from "node:buffer";
import { z } from "zod";

const localServerSupabaseUrl = "http://kong:8000";
const localSiteOrigin = "http://127.0.0.1:5173";
const managedSupabaseOrigin = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/u;
const serverSupabaseUrlSchema = z.union([
  z.literal(localServerSupabaseUrl),
  z.string().regex(managedSupabaseOrigin, "managed Supabase origin required"),
]);
export function parseManagedSupabaseProjectRef(value: string): string | null {
  return managedSupabaseOrigin.exec(value)?.[1] ?? null;
}
const originSchema = z.string().url()
  .refine((value) => new URL(value).origin === value)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" || url.origin === "http://127.0.0.1:5173";
  }, "production origin must use HTTPS; only the canonical loopback origin may use HTTP");
const encryptionKeySchema = z.string().refine(
  (value) => Buffer.from(value, "base64").byteLength === 32,
  "AUTH_CONTINUATION_ENCRYPTION_KEY must decode to 32 bytes",
);
export const continuationServerEnvSchema = z.object({
  SUPABASE_URL: serverSupabaseUrlSchema,
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SERVER_SITE_ORIGIN: originSchema,
  AUTH_CONTINUATION_ENCRYPTION_KEY: encryptionKeySchema,
  AUTH_CONTINUATION_TTL_SECONDS: z.coerce.number().int().min(300).max(300),
});
export type ServerEnv = z.infer<typeof continuationServerEnvSchema>;
export function parseServerEnv(source: Record<string, unknown>): ServerEnv {
  if (source.VITE_AUTH_CONTINUATION_ENCRYPTION_KEY !== undefined) {
    throw new Error("server secret must not use a VITE_ prefix");
  }
  const result = continuationServerEnvSchema.safeParse(source);
  if (!result.success) throw new Error("server_configuration_invalid");
  const local = result.data.SERVER_SITE_ORIGIN === localSiteOrigin;
  const validSupabaseUrl = local
    ? result.data.SUPABASE_URL === localServerSupabaseUrl
    : parseManagedSupabaseProjectRef(result.data.SUPABASE_URL) !== null;
  if (!validSupabaseUrl) throw new Error("server_configuration_invalid");
  return result.data;
}
export function getServerEnv(): ServerEnv {
  return parseServerEnv(process.env);
}
```

Create `src/shared/config/public-env.ts`:

```ts
import { z } from "zod";

const localBrowserSupabaseUrl = "http://127.0.0.1:8000";
const managedSupabaseOrigin = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/u;
const publicSupabaseUrlSchema = z.union([
  z.literal(localBrowserSupabaseUrl),
  z.string().regex(managedSupabaseOrigin, "managed Supabase origin required"),
]);
const publicEnvSchema = z.object({
  VITE_SUPABASE_URL: publicSupabaseUrlSchema,
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  VITE_MAGIC_LINK_RESEND_SECONDS: z.coerce.number().int().min(1).max(3_600),
  VITE_AUTH_CONTINUATION_TTL_MS: z.coerce.number().int()
    .refine((value) => value === 300_000, "continuation TTL must be exactly 300000 ms"),
  VITE_AUTH_PROVIDER_MODE: z.enum(["supabase", "oauth_mock"]),
  VITE_OAUTH_MOCK_ORIGIN: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().url().optional(),
  ),
});

export type PublicEnvParseContext = { production: boolean };

export type PublicEnv = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  magicLinkResendSeconds: number;
  authContinuationTtlMs: number;
  authProviderMode: "supabase" | "oauth_mock";
  oauthMockOrigin: string | null;
};

export function parsePublicEnv(
  source: Record<string, unknown>, context: PublicEnvParseContext = { production: false },
): PublicEnv {
  const result = publicEnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error("公開設定を読み込めません");
  }
  const mode = result.data.VITE_AUTH_PROVIDER_MODE;
  const mockOrigin = result.data.VITE_OAUTH_MOCK_ORIGIN;
  const validLocalMock = mode === "oauth_mock" && !context.production &&
    mockOrigin === "http://127.0.0.1:8788";
  const validSupabase = mode === "supabase" && mockOrigin === undefined;
  const validSupabaseUrl = context.production
    ? managedSupabaseOrigin.test(result.data.VITE_SUPABASE_URL)
    : result.data.VITE_SUPABASE_URL === localBrowserSupabaseUrl ||
      managedSupabaseOrigin.test(result.data.VITE_SUPABASE_URL);
  if ((!validLocalMock && !validSupabase) || !validSupabaseUrl) {
    throw new Error("公開設定を読み込めません");
  }
  return {
    supabaseUrl: result.data.VITE_SUPABASE_URL,
    supabasePublishableKey: result.data.VITE_SUPABASE_PUBLISHABLE_KEY,
    magicLinkResendSeconds: result.data.VITE_MAGIC_LINK_RESEND_SECONDS,
    authContinuationTtlMs: result.data.VITE_AUTH_CONTINUATION_TTL_MS,
    authProviderMode: mode,
    oauthMockOrigin: mockOrigin ?? null,
  };
}

let cached: PublicEnv | undefined;

export function getPublicEnv(): PublicEnv {
  cached ??= parsePublicEnv(import.meta.env, { production: import.meta.env.PROD });
  return cached;
}
```

Create `src/shared/lib/supabase.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PublicEnv } from "@/shared/config/public-env";
import { getPublicEnv } from "@/shared/config/public-env";
import type { Database } from "@/shared/types/database.generated";

export type BrowserSupabaseClient = SupabaseClient<Database>;

export function createBrowserSupabaseClient(
  env: Pick<PublicEnv, "supabaseUrl" | "supabasePublishableKey">,
): BrowserSupabaseClient {
  return createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      storageKey: "kondate.auth.supabase",
    },
  });
}

let browserClient: BrowserSupabaseClient | undefined;

export function getBrowserSupabaseClient(): BrowserSupabaseClient {
  browserClient ??= createBrowserSupabaseClient(getPublicEnv());
  return browserClient;
}
```

- [ ] **Step 4: Implement the server-backed continuation, safe flow storage, and callback URLs (4 minutes)**

Create the Task 7 migration, pgTAP file, `_shared/http.ts`, `_shared/supabase-admin.ts`, crypto helper/tests, all three continuation Functions/tests, and `auth-continuation-recovery.ts` using the complete locked contract in Task 13 Step 3. The create Function must pass `getServerEnv().AUTH_CONTINUATION_TTL_SECONDS` to the database create transition; only the browser recovery module uses `VITE_AUTH_CONTINUATION_TTL_MS`. These are Task 7 implementations, not deferred Task 13 alternatives.

Create `src/features/auth/auth-flow.ts` with the server-backed `AuthFlow`, `ContinuationApi`, async `createAuthFlow`, `readAuthFlow`, `clearAuthFlow`, and `buildAuthCallbackUrl` contract specified in Task 13 Step 3. There is no local-only `classifyAuthContinuation`: missing local storage means the callback may deposit but cannot claim or establish a session.

- [ ] **Step 5: Implement session state and access-token retrieval (5 minutes)**

Create `src/features/auth/auth-provider.tsx`:

```tsx
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { getBrowserSupabaseClient, type BrowserSupabaseClient } from "@/shared/lib/supabase";
import { sanitizeReturnPath } from "./auth-flow";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export type AuthContextValue = {
  status: AuthStatus;
  session: Session | null;
  refreshSession(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type AuthClient = {
  auth: {
    getSession(): ReturnType<BrowserSupabaseClient["auth"]["getSession"]>;
    onAuthStateChange(
      callback: (event: AuthChangeEvent, session: Session | null) => void,
    ): ReturnType<BrowserSupabaseClient["auth"]["onAuthStateChange"]>;
  };
};

function recoverOriginalTab(nextSession: Session | null): void {
  if (nextSession === null || window.location.pathname !== "/login") return;
  const returnTo = sanitizeReturnPath(
    new URLSearchParams(window.location.search).get("returnTo"),
  );
  window.history.replaceState(null, "", returnTo);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function AuthProvider({
  children,
  client = getBrowserSupabaseClient(),
}: PropsWithChildren<{ client?: AuthClient }>) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  const refreshSession = useCallback(async () => {
    const { data, error } = await client.auth.getSession();
    if (error !== null) {
      setSession(null);
      setStatus("unauthenticated");
      return;
    }
    setSession(data.session);
    setStatus(data.session === null ? "unauthenticated" : "authenticated");
    recoverOriginalTab(data.session);
  }, [client]);

  useEffect(() => {
    void refreshSession();
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setStatus(nextSession === null ? "unauthenticated" : "authenticated");
      recoverOriginalTab(nextSession);
    });
    const onFocus = () => void refreshSession();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refreshSession();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [client, refreshSession]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, refreshSession }),
    [refreshSession, session, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
```

Create `src/features/auth/session.ts`:

```ts
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";

export class AuthSessionRequiredError extends Error {
  constructor() {
    super("ログインが必要です");
    this.name = "AuthSessionRequiredError";
  }
}

export async function requireAccessToken(client: BrowserSupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getSession();
  if (error !== null || data.session === null) {
    throw new AuthSessionRequiredError();
  }
  return data.session.access_token;
}
```

- [ ] **Step 6: Run focused tests and typecheck (4 minutes)**

Run:

```bash
npm test -- --run src/shared/config/public-env.test.ts src/features/auth/auth-flow.test.ts src/features/auth/auth-provider.test.tsx
npm test -- --run netlify/functions/_shared/env.test.ts netlify/functions/_shared/auth-continuation-crypto.test.ts netlify/functions/auth-continuation-create.test.ts netlify/functions/auth-continuation-deposit.test.ts netlify/functions/auth-continuation-claim.test.ts
npm run db:test -- supabase/tests/database/004_auth_continuations.test.sql
npm run typecheck
! rg -n 'SUPABASE_URL:\s*z\.string\(\)\.url\(\)' netlify/functions/_shared/env.ts src/shared/config/public-env.ts
```

Expected: all tests pass, TypeScript exits 0, and the negative search confirms neither executable schema can regress to a generic URL validator. pgTAP proves five-minute expiry and atomic one-time claim; Function tests prove origin/state/secret binding and encrypted code storage; the provider test proves original-browser polling/focus recovery.

- [ ] **Step 7: Commit browser auth primitives (2 minutes)**

```bash
git add src/shared/config src/shared/lib/supabase.ts src/features/auth supabase/migrations/20260711000330_auth_continuations.sql supabase/tests/database/004_auth_continuations.test.sql netlify/functions
git commit -m "feat: add recoverable browser auth state"
```

### Task 8: Implement Google OAuth, complete magic-link states, and callback continuation UI

**Files:**
- Create: `src/features/auth/magic-link-state.ts`
- Create: `src/features/auth/auth-gateway.test.ts`
- Create: `src/features/auth/auth-gateway.ts`
- Create: `src/features/auth/login-page.test.tsx`
- Create: `src/features/auth/login-page.tsx`
- Create: `src/features/auth/auth-callback-page.test.tsx`
- Create: `src/features/auth/auth-callback-page.tsx`

**Interfaces:**
- Consumes: Task 7 server-backed continuation, browser client with library-owned PKCE verifier, `VITE_MAGIC_LINK_RESEND_SECONDS`, and the parsed `supabase | oauth_mock` browser-provider discriminant.
- Produces: `AuthGateway` with `signInWithGoogle`, `sendMagicLink`, `completeCallback`, and `resumeFlow`; all seven required magic-link states; callback result distinguishes a locally claimed completion from an isolated deposit awaiting the original browser.
- Google refusal/cancel maps to `oauth_cancelled`; expired/used email links map to `magic_link_expired`; neither error contains provider query text.

- [ ] **Step 1: Write failing login and callback component tests (5 minutes)**

Create `src/features/auth/login-page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import type { AuthGateway } from "./auth-gateway";
import { LoginPage } from "./login-page";

it("places Google first and renders the complete sent state", async () => {
  const user = userEvent.setup();
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn().mockResolvedValue({
      flowId: "flow-1",
      email: "user@example.com",
      resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
    }),
    completeCallback: vi.fn(),
    resumeFlow: vi.fn(),
  };

  render(
    <MemoryRouter>
      <LoginPage gateway={gateway} />
    </MemoryRouter>,
  );

  const actions = screen.getAllByRole("button");
  expect(actions[0]).toHaveTextContent("Googleで続ける");
  await user.type(screen.getByLabelText("メールアドレス"), "user@example.com");
  await user.click(screen.getByRole("button", { name: "ログイン用メールを送る" }));

  expect(await screen.findByText("user@example.com に送りました")).toBeInTheDocument();
  expect(screen.getByText("迷惑メールフォルダも確認してください")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "メールアドレスを変更" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Googleに切り替える" })).toBeInTheDocument();
});
```

Create `src/features/auth/auth-callback-page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { expect, it, vi } from "vitest";
import type { AuthGateway } from "./auth-gateway";
import { AuthCallbackPage } from "./auth-callback-page";

it("deposits in an isolated WebView and directs the user to the original browser", async () => {
  const gateway: AuthGateway = {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    completeCallback: vi.fn().mockResolvedValue({
      kind: "deposited",
      continuation: "original_browser",
      returnTo: "/onboarding",
      flowId: "flow-1",
    }),
    resumeFlow: vi.fn(),
  };
  const router = createMemoryRouter(
    [
      { path: "/auth/callback", element: <AuthCallbackPage gateway={gateway} /> },
      { path: "/onboarding", element: <h1>家族設定</h1> },
    ],
    { initialEntries: ["/auth/callback?flow=flow-1"] },
  );

  render(<RouterProvider router={router} />);
  expect(
    await screen.findByText("元のブラウザでログインを続けてください。この画面に認証情報は保存されません"),
  ).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "家族設定" })).not.toBeInTheDocument();
});
```

Create `src/features/auth/auth-gateway.test.ts` with the Task 7 `MapStorage`/continuation factory. This test fixes the provider discriminant and proves that local mode navigates only to the canonical Compose mock while production delegates only to Supabase:

```ts
it("uses the local Compose provider only in oauth_mock mode", async () => {
  const navigate = vi.fn();
  const client = authClientMock();
  const gateway = createAuthGateway(client, continuationApiMock(), new MapStorage(), {
    getPublicEnv: () => ({ authProviderMode: "oauth_mock",
      oauthMockOrigin: "http://127.0.0.1:8788" }),
    fetchImpl: vi.fn(), appOrigin: "http://127.0.0.1:5173", navigate,
  });
  await gateway.signInWithGoogle("/onboarding");
  const target = new URL(String(navigate.mock.calls[0]?.[0]));
  expect(target.origin + target.pathname).toBe("http://127.0.0.1:8788/authorize");
  expect(target.searchParams.get("redirect_uri"))
    .toBe("http://127.0.0.1:5173/auth/callback");
  expect(target.searchParams.get("flow")).toMatch(/^[0-9a-f-]{36}$/u);
  expect(target.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(client.auth.signInWithOAuth).not.toHaveBeenCalled();
});

it("uses Supabase Google and never the mock URL in production mode", async () => {
  const fetchImpl = vi.fn();
  const client = authClientMock({ oauthResult: { data: {}, error: null } });
  const gateway = createAuthGateway(client, continuationApiMock(), new MapStorage(), {
    getPublicEnv: () => ({ authProviderMode: "supabase", oauthMockOrigin: null }),
    fetchImpl, appOrigin: "http://127.0.0.1:5173", navigate: vi.fn(),
  });
  await gateway.signInWithGoogle("/planner");
  expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({ provider: "google",
    options: { redirectTo: expect.stringMatching(/^http:\/\/127\.0\.0\.1:5173\/auth\/callback\?/u) } });
  expect(fetchImpl).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests and verify failure (2 minutes)**

Run: `npm test -- --run src/features/auth/auth-gateway.test.ts src/features/auth/login-page.test.tsx src/features/auth/auth-callback-page.test.tsx`

Expected: FAIL because the gateway and pages do not exist.

- [ ] **Step 3: Define the exact state machine and Supabase gateway (5 minutes)**

Create `src/features/auth/magic-link-state.ts`:

```ts
export type MagicLinkState =
  | { status: "idle"; email: string }
  | { status: "sending"; email: string }
  | { status: "sent"; email: string; flowId: string; resendAvailableAt: string }
  | { status: "verifying" }
  | { status: "complete" }
  | { status: "expired"; email: string }
  | { status: "send_failed"; email: string; message: string };
```

Create `src/features/auth/auth-gateway.ts`:

```ts
import type { AuthError } from "@supabase/supabase-js";
import { z } from "zod";
import {
  buildAuthCallbackUrl,
  clearAuthFlow,
  createAuthFlow,
  readAuthFlow,
  sanitizeReturnPath,
  createContinuationApi,
  type ContinuationApi,
} from "./auth-flow";
import { getPublicEnv, type PublicEnv } from "@/shared/config/public-env";
import { getBrowserSupabaseClient, type BrowserSupabaseClient } from "@/shared/lib/supabase";

export type SentMagicLink = {
  flowId: string;
  email: string;
  resendAvailableAt: string;
};

export type AuthCallbackResult =
  | {
      kind: "complete";
      continuation: "same_browser";
      returnTo: string;
      flowId: string;
    }
  | { kind: "deposited"; continuation: "original_browser"; flowId: string; returnTo: string }
  | { kind: "expired"; flowId: string; returnTo: string }
  | { kind: "error"; code: "oauth_cancelled" | "auth_callback_failed" | "unbound_callback"; returnTo: string };

export interface AuthGateway {
  signInWithGoogle(returnTo: string): Promise<void>;
  sendMagicLink(email: string, returnTo: string): Promise<SentMagicLink>;
  completeCallback(url: URL): Promise<AuthCallbackResult>;
  resumeFlow(flowId: string): Promise<AuthCallbackResult>;
}

export type AuthGatewayDeps = {
  getPublicEnv(): Pick<PublicEnv, "authProviderMode" | "oauthMockOrigin">;
  fetchImpl: typeof fetch;
  appOrigin: string;
  navigate(url: string): void;
};
const browserAuthGatewayDeps: AuthGatewayDeps = {
  getPublicEnv,
  fetchImpl: (...args) => fetch(...args),
  appOrigin: window.location.origin,
  navigate: (url) => window.location.assign(url),
};
const localCredentialsSchema = z.object({
  email: z.string().email(), password: z.string().min(16),
}).strict();

function isExpired(error: AuthError | null, url: URL): boolean {
  const code = error?.code ?? url.searchParams.get("error_code");
  return code === "otp_expired" || code === "otp_disabled" || code === "token_expired";
}

export function createAuthGateway(
  client: BrowserSupabaseClient = getBrowserSupabaseClient(),
  continuationApi: ContinuationApi = createContinuationApi(),
  storage: Storage = window.localStorage,
  deps: AuthGatewayDeps = browserAuthGatewayDeps,
): AuthGateway {
  return {
    async signInWithGoogle(returnTo) {
      const flow = await createAuthFlow(returnTo, continuationApi, storage);
      const redirectTo = buildAuthCallbackUrl(deps.appOrigin, flow);
      const provider = deps.getPublicEnv();
      if (provider.authProviderMode === "oauth_mock") {
        if (provider.oauthMockOrigin !== "http://127.0.0.1:8788") {
          throw new Error("Googleログインを開始できませんでした");
        }
        const authorize = new URL("/authorize", provider.oauthMockOrigin);
        authorize.searchParams.set("redirect_uri",
          new URL("/auth/callback", deps.appOrigin).href);
        authorize.searchParams.set("flow", flow.id);
        authorize.searchParams.set("state", flow.state);
        deps.navigate(authorize.href);
        return;
      }
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (error !== null) throw new Error("Googleログインを開始できませんでした");
    },

    async sendMagicLink(email, returnTo) {
      const flow = await createAuthFlow(returnTo, continuationApi, storage);
      const emailRedirectTo = buildAuthCallbackUrl(deps.appOrigin, flow);
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo, shouldCreateUser: true },
      });
      if (error !== null) {
        clearAuthFlow(flow.id, storage);
        throw new Error("ログイン用メールを送信できませんでした");
      }
      return {
        flowId: flow.id,
        email,
        resendAvailableAt: new Date(
          Date.now() + getPublicEnv().magicLinkResendSeconds * 1_000,
        ).toISOString(),
      };
    },

    async completeCallback(url) {
      if (url.hash !== "") return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
      const flowId = url.searchParams.get("flow");
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const stored = flowId === null ? null : readAuthFlow(flowId, storage);
      const returnTo = sanitizeReturnPath(stored?.returnTo);
      if (isExpired(null, url)) return { kind: "expired", flowId: flowId ?? "", returnTo };
      const providerError = url.searchParams.get("error");
      if (providerError !== null) {
        if (flowId !== null) clearAuthFlow(flowId, storage);
        return {
          kind: "error",
          code: providerError === "access_denied" ? "oauth_cancelled" : "auth_callback_failed",
          returnTo,
        };
      }
      if (flowId === null || state === null || code === null) {
        return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
      }
      try {
        await continuationApi.deposit(flowId, { state, code });
      } catch {
        return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
      }
      if (stored === null) {
        return { kind: "deposited", continuation: "original_browser", flowId, returnTo: "/planner" };
      }
      return this.resumeFlow(flowId);
    },

    async resumeFlow(flowId) {
      const flow = readAuthFlow(flowId, storage);
      if (flow === null) return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
      let claimed = false;
      try {
        const claimedCode = await continuationApi.claim(flow.id, {
          secret: flow.secret,
          state: flow.state,
        });
        claimed = true;
        const provider = deps.getPublicEnv();
        const result = provider.authProviderMode === "oauth_mock"
          ? await (async () => {
              if (provider.oauthMockOrigin !== "http://127.0.0.1:8788") {
                throw new Error("invalid mock origin");
              }
              const response = await deps.fetchImpl(`${provider.oauthMockOrigin}/exchange`, {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ code: claimedCode.code }),
              });
              if (!response.ok) throw new Error("mock exchange failed");
              return client.auth.signInWithPassword(localCredentialsSchema.parse(await response.json()));
            })()
          : client.auth.exchangeCodeForSession(claimedCode.code);
        const { error } = await result;
        if (error !== null) throw new Error("provider exchange failed");
        clearAuthFlow(flow.id, storage);
        return { kind: "complete", continuation: "same_browser",
          returnTo: claimedCode.returnTo, flowId: flow.id };
      } catch {
        if (claimed) clearAuthFlow(flow.id, storage);
        return { kind: "error", code: "unbound_callback", returnTo: flow.returnTo };
      }
    },
  };
}
```

- [ ] **Step 4: Implement the complete login/sent/error UI (5 minutes)**

Create `src/features/auth/login-page.tsx`:

```tsx
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation } from "react-router";
import { createAuthGateway, type AuthGateway } from "./auth-gateway";
import type { MagicLinkState } from "./magic-link-state";
import { sanitizeReturnPath } from "./auth-flow";

type LoginLocationState = {
  authError?: "oauth_cancelled" | "auth_callback_failed" | "magic_link_expired";
};

function readLoginLocationState(value: unknown): LoginLocationState {
  if (typeof value !== "object" || value === null || !("authError" in value)) return {};
  const authError = value.authError;
  if (
    authError === "oauth_cancelled" ||
    authError === "auth_callback_failed" ||
    authError === "magic_link_expired"
  ) {
    return { authError };
  }
  return {};
}

export function LoginPage({ gateway = createAuthGateway() }: { gateway?: AuthGateway }) {
  const location = useLocation();
  const locationState = readLoginLocationState(location.state);
  const params = new URLSearchParams(location.search);
  const returnTo = sanitizeReturnPath(params.get("returnTo"));
  const [state, setState] = useState<MagicLinkState>({ status: "idle", email: "" });
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (state.status !== "sent") return;
    const update = () =>
      setSecondsLeft(
        Math.max(0, Math.ceil((new Date(state.resendAvailableAt).getTime() - Date.now()) / 1_000)),
      );
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [state]);

  const authErrorCopy = useMemo(() => {
    if (locationState.authError === "oauth_cancelled") {
      return "Googleログインがキャンセルされました。もう一度試すか、別の方法を選べます。";
    }
    if (locationState.authError === "auth_callback_failed") {
      return "ログインを確認できませんでした。もう一度お試しください。";
    }
    if (locationState.authError === "magic_link_expired") {
      return "このリンクは期限切れか、すでに使用されています。";
    }
    return null;
  }, [locationState.authError]);

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const email = state.status === "idle" || state.status === "send_failed" ? state.email : state.email;
    setState({ status: "sending", email });
    try {
      const sent = await gateway.sendMagicLink(email, returnTo);
      setState({ status: "sent", ...sent });
    } catch {
      setState({
        status: "send_failed",
        email,
        message: "送信できませんでした。通信を確認して、もう一度お試しください。",
      });
    }
  };

  if (state.status === "sent") {
    return (
      <main className="page-frame stack">
        <h1>メールを確認してください</h1>
        <section className="card stack" aria-live="polite">
          <strong>{state.email} に送りました</strong>
          <p>迷惑メールフォルダも確認してください</p>
          <p>リンクを開くと認証を確認します。</p>
          <button
            className="primary-button"
            type="button"
            disabled={secondsLeft > 0}
            onClick={() => void send()}
          >
            {secondsLeft > 0 ? `${secondsLeft}秒後に再送できます` : "ログイン用メールを再送"}
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => setState({ status: "idle", email: state.email })}
          >
            メールアドレスを変更
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void gateway.signInWithGoogle(returnTo)}
          >
            Googleに切り替える
          </button>
        </section>
      </main>
    );
  }

  const email = state.status === "verifying" || state.status === "complete" ? "" : state.email;
  return (
    <main className="page-frame stack">
      <div>
        <p className="eyebrow">毎日の献立を、家族に合わせて</p>
        <h1>こんだて日和</h1>
      </div>
      {authErrorCopy !== null && (
        <section className="card stack" role="alert">
          <p className="error-message">{authErrorCopy}</p>
          <p>Googleを再試行、別のGoogleアカウント、またはメールを選べます。</p>
        </section>
      )}
      <button
        className="primary-button"
        type="button"
        onClick={() => void gateway.signInWithGoogle(returnTo)}
      >
        Googleで続ける
      </button>
      <form className="card stack" onSubmit={(event) => void send(event)}>
        <label className="field">
          <span>メールアドレス</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setState({ status: "idle", email: event.target.value })}
          />
        </label>
        <button className="secondary-button" disabled={state.status === "sending"} type="submit">
          {state.status === "sending" ? "送信中…" : "ログイン用メールを送る"}
        </button>
        {state.status === "send_failed" && (
          <p className="error-message" role="alert">
            {state.message}
          </p>
        )}
      </form>
    </main>
  );
}
```

- [ ] **Step 5: Implement callback verification, expiry, same-tab, and isolated-WebView UI (5 minutes)**

Create `src/features/auth/auth-callback-page.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { createAuthGateway, type AuthCallbackResult, type AuthGateway } from "./auth-gateway";

export function AuthCallbackPage({ gateway }: { gateway?: AuthGateway }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [result, setResult] = useState<AuthCallbackResult | null>(null);
  const [defaultGateway] = useState(createAuthGateway);
  const activeGateway = gateway ?? defaultGateway;

  useEffect(() => {
    let active = true;
    void activeGateway
      .completeCallback(new URL(window.location.href))
      .then((next) => {
        if (!active) return;
        setResult(next);
        if (next.kind === "complete" && next.continuation === "same_browser") {
          navigate(next.returnTo, { replace: true });
        } else if (next.kind === "expired") {
          navigate("/login", {
            replace: true,
            state: { authError: "magic_link_expired" },
          });
        } else if (next.kind === "error") {
          navigate("/login", {
            replace: true,
            state: { authError: next.code },
          });
        }
      });
    return () => {
      active = false;
    };
  }, [activeGateway, location.key, navigate]);

  if (result?.kind === "deposited" && result.continuation === "original_browser") {
    return (
      <main className="page-frame stack">
        <h1>ログイン情報を元のブラウザへ渡しました</h1>
        <section className="card stack">
          <p>元のブラウザでログインを続けてください。この画面に認証情報は保存されません</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page-frame" aria-live="polite">
      <h1>ログインを確認中</h1>
      <p>この画面を閉じずにお待ちください。</p>
    </main>
  );
}
```

- [ ] **Step 6: Run auth component tests and static checks (4 minutes)**

Run:

```bash
npm test -- --run src/features/auth/auth-gateway.test.ts src/features/auth/login-page.test.tsx src/features/auth/auth-callback-page.test.tsx
npm run typecheck
npm run lint
```

Expected: tests pass; copy for sent, cancel, expiry, and isolated continuation is reachable; lint/typecheck exit 0. Add a focused gateway unit test before commit if the installed Supabase JS returns a callback error code not covered by `isExpired`.

- [ ] **Step 7: Commit authentication UI (2 minutes)**

```bash
git add src/features/auth/magic-link-state.ts src/features/auth/auth-gateway.test.ts src/features/auth/auth-gateway.ts src/features/auth/login-page.test.tsx src/features/auth/login-page.tsx src/features/auth/auth-callback-page.test.tsx src/features/auth/auth-callback-page.tsx
git commit -m "feat: add Google and magic-link login flows"
```

### Task 9: Add typed household/privacy repositories and conservative member defaults

**Files:**
- Create: `src/features/household/household-defaults.test.ts`
- Create: `src/features/household/household-defaults.ts`
- Create: `src/features/household/household-api.ts`
- Create: `src/features/household/household-queries.ts`
- Create: `src/features/privacy/privacy-api.ts`
- Create: `src/features/privacy/privacy-queries.ts`
- Create: `src/features/privacy/privacy-copy.ts`

**Interfaces:**
- Consumes: generated table/RPC types and Task 6 grants.
- Produces: exact repository functions listed under Locked interfaces; `householdKeys.profile(userId)`, `householdKeys.members(userId)`, `householdKeys.allergies(userId,memberId)`, `householdKeys.dislikes(userId,memberId)`, `invalidateHouseholdSafetyDependents(queryClient,userId)`, and `privacyKeys.current(userId)`.
- A custom allergy is inserted only with `custom_confirmed: true`; a standard allergy uses the stable catalog `id`.

- [ ] **Step 1: Write failing age-default tests (3 minutes)**

Create `src/features/household/household-defaults.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defaultsForAgeBand } from "./household-defaults";

describe("defaultsForAgeBand", () => {
  it("uses conservative toddler defaults", () => {
    expect(defaultsForAgeBand("post_weaning_to_2")).toEqual({
      portion_size: "small",
      spice_level: "none",
      ease_preferences: ["small_pieces", "boneless", "soft"],
      required_safety_constraints: ["remove_bones", "cut_small"],
    });
  });

  it("does not silently add mandatory constraints for an adult", () => {
    expect(defaultsForAgeBand("adult")).toEqual({
      portion_size: "regular",
      spice_level: "regular",
      ease_preferences: [],
      required_safety_constraints: [],
    });
  });
});
```

- [ ] **Step 2: Run the test and verify failure (2 minutes)**

Run: `npm test -- --run src/features/household/household-defaults.test.ts`

Expected: FAIL because `household-defaults.ts` does not exist.

- [ ] **Step 3: Implement conservative defaults (3 minutes)**

Create `src/features/household/household-defaults.ts`:

```ts
import type {
  AgeBand,
  EasePreference,
  PortionSize,
  RequiredSafetyConstraint,
  SpiceLevel,
} from "@shared/contracts/domain";

export type HouseholdDefaults = {
  portion_size: PortionSize;
  spice_level: SpiceLevel;
  ease_preferences: EasePreference[];
  required_safety_constraints: RequiredSafetyConstraint[];
};

export function defaultsForAgeBand(ageBand: AgeBand): HouseholdDefaults {
  if (ageBand === "post_weaning_to_2" || ageBand === "age_3_5") {
    return {
      portion_size: "small",
      spice_level: "none",
      ease_preferences: ["small_pieces", "boneless", "soft"],
      required_safety_constraints: ["remove_bones", "cut_small"],
    };
  }
  if (ageBand === "age_6_8" || ageBand === "age_9_12") {
    return {
      portion_size: "regular",
      spice_level: "mild",
      ease_preferences: ["boneless"],
      required_safety_constraints: ["remove_bones"],
    };
  }
  if (ageBand === "senior") {
    return {
      portion_size: "small",
      spice_level: "mild",
      ease_preferences: ["soft"],
      required_safety_constraints: [],
    };
  }
  return {
    portion_size: "regular",
    spice_level: "regular",
    ease_preferences: [],
    required_safety_constraints: [],
  };
}
```

- [ ] **Step 4: Implement the complete typed household repository (5 minutes)**

Create `src/features/household/household-api.ts`:

```ts
import type { OnboardingStatus } from "@shared/contracts/domain";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/shared/types/database.generated";

export type ProfileRow = Tables<"profiles">;
export type HouseholdMemberRow = Tables<"household_members">;
export type MemberAllergyRow = Tables<"member_allergies">;
export type AllergenCatalogRow = Tables<"allergen_catalog">;

export type HouseholdDraftPatch = Pick<
  TablesUpdate<"household_members">,
  | "display_name"
  | "age_band"
  | "portion_size"
  | "spice_level"
  | "ease_preferences"
  | "required_safety_constraints"
  | "allergy_status"
  | "unsupported_diet_status"
  | "unsupported_diet_kinds"
>;

function dataError(message: string): Error {
  return new Error(message);
}

export async function getProfile(
  client: BrowserSupabaseClient,
  userId: string,
): Promise<ProfileRow> {
  const { data, error } = await client.from("profiles").select("*").eq("user_id", userId).single();
  if (error !== null) throw dataError("初回設定の状態を読み込めませんでした");
  return data;
}

export async function listHouseholdMembers(
  client: BrowserSupabaseClient,
  userId: string,
): Promise<HouseholdMemberRow[]> {
  const { data, error } = await client
    .from("household_members")
    .select("*")
    .eq("user_id", userId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error !== null) throw dataError("家族情報を読み込めませんでした");
  return data;
}

export async function createHouseholdMemberDraft(
  client: BrowserSupabaseClient,
  userId: string,
  sortOrder: number,
): Promise<HouseholdMemberRow> {
  const input: TablesInsert<"household_members"> = {
    user_id: userId,
    status: "draft",
    sort_order: sortOrder,
  };
  const { data, error } = await client.from("household_members").insert(input).select("*").single();
  if (error !== null) throw dataError("家族の下書きを作成できませんでした");
  return data;
}

export async function updateHouseholdMemberDraft(
  client: BrowserSupabaseClient,
  userId: string,
  memberId: string,
  patch: HouseholdDraftPatch,
): Promise<HouseholdMemberRow> {
  const { data, error } = await client
    .from("household_members")
    .update(patch)
    .eq("id", memberId)
    .eq("user_id", userId)
    .eq("status", "draft")
    .select("*")
    .single();
  if (error !== null) throw dataError("家族情報を保存できませんでした");
  return data;
}

export async function completeHouseholdMember(
  client: BrowserSupabaseClient,
  _userId: string,
  memberId: string,
): Promise<HouseholdMemberRow> {
  const { data, error } = await client.rpc("complete_household_member", {
    p_member_id: memberId,
  });
  if (error !== null) {
    if (error.message.includes("member_required_fields_incomplete")) {
      throw dataError("年齢、アレルギー、対象外の確認を完了してください");
    }
    throw dataError("家族設定を完了できませんでした");
  }
  return data;
}

export async function setOnboardingStatus(
  client: BrowserSupabaseClient,
  userId: string,
  status: OnboardingStatus,
): Promise<ProfileRow> {
  const patch: TablesUpdate<"profiles"> = {
    onboarding_status: status,
    onboarding_completed_at: status === "complete" ? new Date().toISOString() : null,
  };
  const { data, error } = await client
    .from("profiles")
    .update(patch)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error !== null) throw dataError("初回設定の進捗を保存できませんでした");
  return data;
}

export async function listAllergenCatalog(
  client: BrowserSupabaseClient,
): Promise<AllergenCatalogRow[]> {
  const { data, error } = await client
    .from("allergen_catalog")
    .select("*")
    .order("display_name");
  if (error !== null) throw dataError("アレルゲン一覧を読み込めませんでした");
  return data;
}

export async function listMemberAllergies(
  client: BrowserSupabaseClient,
  userId: string,
  memberId: string,
): Promise<MemberAllergyRow[]> {
  const { data, error } = await client
    .from("member_allergies")
    .select("*")
    .eq("user_id", userId)
    .eq("member_id", memberId)
    .order("created_at");
  if (error !== null) throw dataError("アレルギー情報を読み込めませんでした");
  return data;
}

export async function addStandardMemberAllergy(
  client: BrowserSupabaseClient,
  userId: string,
  memberId: string,
  allergenId: string,
): Promise<MemberAllergyRow> {
  const input: TablesInsert<"member_allergies"> = {
    user_id: userId,
    member_id: memberId,
    allergen_id: allergenId,
    custom_confirmed: false,
    custom_aliases: [],
  };
  const { data, error } = await client.from("member_allergies").insert(input).select("*").single();
  if (error !== null) throw dataError("アレルギーを登録できませんでした");
  return data;
}

export async function addCustomMemberAllergy(
  client: BrowserSupabaseClient,
  userId: string,
  memberId: string,
  customName: string,
  aliases: string[],
): Promise<MemberAllergyRow> {
  const input: TablesInsert<"member_allergies"> = {
    user_id: userId,
    member_id: memberId,
    allergen_id: null,
    custom_name: customName.trim(),
    custom_aliases: aliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0),
    custom_confirmed: true,
  };
  const { data, error } = await client.from("member_allergies").insert(input).select("*").single();
  if (error !== null) throw dataError("自由登録アレルギーを保存できませんでした");
  return data;
}

export async function deleteMemberAllergy(
  client: BrowserSupabaseClient,
  userId: string,
  allergyId: string,
): Promise<void> {
  const { error } = await client
    .from("member_allergies")
    .delete()
    .eq("id", allergyId)
    .eq("user_id", userId);
  if (error !== null) throw dataError("アレルギーを削除できませんでした");
}
```

Create `src/features/household/household-queries.ts`:

```ts
export const householdKeys = {
  all: ["household"] as const,
  profile: (userId: string) => ["household", "profile", userId] as const,
  members: (userId: string) => ["household", "members", userId] as const,
  allergies: (userId: string, memberId: string) =>
    ["household", "allergies", userId, memberId] as const,
  dislikes: (userId: string, memberId: string) =>
    ["household", "dislikes", userId, memberId] as const,
  catalog: ["household", "allergen-catalog"] as const,
};
```

- [ ] **Step 5: Implement current privacy consent and the exact three-part copy (5 minutes)**

Create `src/features/privacy/privacy-api.ts`:

```ts
import { privacyNoticeVersion } from "@shared/contracts/domain";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";
import type { Tables, TablesInsert } from "@/shared/types/database.generated";

export type PrivacyConsentRow = Tables<"privacy_consents">;

export async function getCurrentPrivacyConsent(
  client: BrowserSupabaseClient,
  userId: string,
): Promise<PrivacyConsentRow | null> {
  const { data, error } = await client
    .from("privacy_consents")
    .select("*")
    .eq("user_id", userId)
    .eq("notice_version", privacyNoticeVersion)
    .maybeSingle();
  if (error !== null) throw new Error("AI情報の確認状態を読み込めませんでした");
  return data;
}

export async function acceptCurrentPrivacyConsent(
  client: BrowserSupabaseClient,
  userId: string,
): Promise<PrivacyConsentRow> {
  const input: TablesInsert<"privacy_consents"> = {
    user_id: userId,
    notice_version: privacyNoticeVersion,
    accepted_at: new Date().toISOString(),
  };
  const { data, error } = await client
    .from("privacy_consents")
    .upsert(input, { onConflict: "user_id,notice_version", ignoreDuplicates: false })
    .select("*")
    .single();
  if (error !== null) throw new Error("AI情報の確認を保存できませんでした");
  return data;
}

export function hasCurrentPrivacyConsent(row: PrivacyConsentRow | null): boolean {
  return row?.notice_version === privacyNoticeVersion;
}
```

Create `src/features/privacy/privacy-queries.ts`:

```ts
export const privacyKeys = {
  all: ["privacy"] as const,
  current: (userId: string) => ["privacy", "current", userId] as const,
};
```

Create `src/features/privacy/privacy-copy.ts`:

```ts
export const privacySections = [
  {
    title: "AIへ送る情報",
    body: "年齢帯、食べる量、アレルギー、安全上の配慮、苦手な食材、献立の希望を、member_1のような呼び方に置き換えて送ります。",
  },
  {
    title: "AIへ送らない情報",
    body: "家族の呼び名、メールアドレス、家族メンバーのデータベースIDは送りません。",
  },
  {
    title: "アプリに保存する情報",
    body: "家族設定、確認した説明の版、完成した献立と条件を保存します。未検証のAI生回答は保存しません。",
  },
] as const;

export const providerExplanation =
  "OpenRouterを通じて無料モデルへ送信します。混雑時のフォールバックで、実際の無料モデル提供者が変わることがあります。";
```

- [ ] **Step 6: Pass repository-adjacent tests and static checks (4 minutes)**

Run:

```bash
npm test -- --run src/features/household/household-defaults.test.ts
npm run typecheck
npm run lint
```

Expected: defaults tests pass and every repository query is typechecked against generated DB types without `any` or a cast.

- [ ] **Step 7: Commit typed household/privacy access (2 minutes)**

```bash
git add src/features/household src/features/privacy/privacy-api.ts src/features/privacy/privacy-queries.ts src/features/privacy/privacy-copy.ts
git commit -m "feat: add typed household and privacy repositories"
```

### Task 10: Build resumable draft/complete household onboarding and privacy consent UI

**Files:**
- Create: `src/features/household/household-onboarding-page.test.tsx`
- Create: `src/features/household/household-onboarding-page.tsx`
- Create: `src/features/privacy/privacy-notice-page.test.tsx`
- Create: `src/features/privacy/privacy-notice-page.tsx`

**Interfaces:**
- Consumes: Task 9 repositories and query keys.
- Produces: one-row-at-a-time draft resume, per-field autosave status, three-required-field progress, registered-allergy capture, unsupported-diet blocking data, one-member completion, additional-member start, and privacy acceptance.
- Completing only the three required confirmations keeps conservative age defaults and is labeled `残りはあとで設定して完了`. A draft row is never treated as a generation target.

- [ ] **Step 1: Write failing onboarding and privacy component tests (5 minutes)**

Create `src/features/household/household-onboarding-page.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { HouseholdMemberRow } from "./household-api";
import {
  HouseholdOnboardingForm,
  type HouseholdOnboardingApi,
} from "./household-onboarding-page";

const draft: HouseholdMemberRow = {
  id: "member-1",
  user_id: "user-1",
  status: "draft",
  display_name: null,
  age_band: null,
  portion_size: null,
  spice_level: null,
  ease_preferences: [],
  required_safety_constraints: [],
  allergy_status: null,
  unsupported_diet_status: null,
  unsupported_diet_kinds: [],
  sort_order: 0,
  created_at: "2026-07-11T00:00:00.000Z",
  updated_at: "2026-07-11T00:00:00.000Z",
};

it("resumes one draft and saves each required selection", async () => {
  const user = userEvent.setup();
  const updateDraft = vi.fn(async (_memberId, patch) => ({ ...draft, ...patch }));
  const completeMember = vi.fn(async () => ({
    ...draft,
    age_band: "adult",
    allergy_status: "none",
    unsupported_diet_status: "none",
    status: "complete",
  }));
  const api: HouseholdOnboardingApi = {
    listMembers: vi.fn().mockResolvedValue([draft]),
    createDraft: vi.fn(),
    updateDraft,
    completeMember,
    listAllergies: vi.fn().mockResolvedValue([]),
    addCustomAllergy: vi.fn(),
    setProgress: vi.fn(),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />
    </QueryClientProvider>,
  );

  expect(await screen.findByText("必須項目 0 / 3")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("年齢区分"), "adult");
  await user.selectOptions(screen.getByLabelText("アレルギーの確認"), "none");
  await user.selectOptions(screen.getByLabelText("対象外の食事の確認"), "none");
  expect(await screen.findByText("必須項目 3 / 3")).toBeInTheDocument();
  expect(updateDraft).toHaveBeenCalledTimes(3);
  await user.click(screen.getByRole("button", { name: "残りはあとで設定して完了" }));
  expect(completeMember).toHaveBeenCalledWith("member-1");
});
```

Create `src/features/privacy/privacy-notice-page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { PrivacyNoticeContent } from "./privacy-notice-page";

it("explains sent, unsent, and stored data before accepting", async () => {
  const user = userEvent.setup();
  const onAccept = vi.fn();
  render(<PrivacyNoticeContent saving={false} onAccept={onAccept} onSkip={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "AIへ送る情報" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "AIへ送らない情報" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "アプリに保存する情報" })).toBeInTheDocument();
  const accept = screen.getByRole("button", { name: "確認して進む" });
  expect(accept).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /説明を確認しました/ }));
  await user.click(accept);
  expect(onAccept).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run tests and verify failure (2 minutes)**

Run: `npm test -- --run src/features/household/household-onboarding-page.test.tsx src/features/privacy/privacy-notice-page.test.tsx`

Expected: FAIL because both page modules do not exist.

- [ ] **Step 3: Implement the resumable household form and explicit save states (5 minutes)**

Create `src/features/household/household-onboarding-page.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type {
  AgeBand,
  AllergyStatus,
  UnsupportedDietKind,
  UnsupportedDietStatus,
} from "@shared/contracts/domain";
import { useAuth } from "@/features/auth/auth-provider";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import {
  addCustomMemberAllergy,
  completeHouseholdMember,
  createHouseholdMemberDraft,
  listHouseholdMembers,
  listMemberAllergies,
  setOnboardingStatus,
  updateHouseholdMemberDraft,
  type HouseholdDraftPatch,
  type HouseholdMemberRow,
} from "./household-api";
import { defaultsForAgeBand } from "./household-defaults";
import { householdKeys } from "./household-queries";

const unsupportedDietOptions: ReadonlyArray<readonly [UnsupportedDietKind, string]> = [
  ["weaning_food", "離乳食"],
  ["swallowing_concern", "飲み込み・むせの不安"],
  ["therapeutic_diet", "医師等から指示された治療食"],
];

export interface HouseholdOnboardingApi {
  listMembers(): Promise<HouseholdMemberRow[]>;
  createDraft(sortOrder: number): Promise<HouseholdMemberRow>;
  updateDraft(memberId: string, patch: HouseholdDraftPatch): Promise<HouseholdMemberRow>;
  completeMember(memberId: string): Promise<HouseholdMemberRow>;
  listAllergies(memberId: string): Promise<Awaited<ReturnType<typeof listMemberAllergies>>>;
  addCustomAllergy(memberId: string, name: string, aliases: string[]): Promise<unknown>;
  setProgress(status: "in_progress" | "complete"): Promise<unknown>;
}

function createHouseholdApi(userId: string): HouseholdOnboardingApi {
  const client = getBrowserSupabaseClient();
  return {
    listMembers: () => listHouseholdMembers(client, userId),
    createDraft: (sortOrder) => createHouseholdMemberDraft(client, userId, sortOrder),
    updateDraft: (memberId, patch) =>
      updateHouseholdMemberDraft(client, userId, memberId, patch),
    completeMember: (memberId) => completeHouseholdMember(client, userId, memberId),
    listAllergies: (memberId) => listMemberAllergies(client, userId, memberId),
    addCustomAllergy: (memberId, name, aliases) =>
      addCustomMemberAllergy(client, userId, memberId, name, aliases),
    setProgress: (status) => setOnboardingStatus(client, userId, status),
  };
}

export function HouseholdOnboardingPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  if (auth.session === null) return null;
  const api = createHouseholdApi(auth.session.user.id);
  return (
    <HouseholdOnboardingForm
      userId={auth.session.user.id}
      api={api}
      onDone={() => navigate("/privacy?returnTo=/planner")}
    />
  );
}

export function HouseholdOnboardingForm({
  userId,
  api,
  onDone,
}: {
  userId: string;
  api: HouseholdOnboardingApi;
  onDone(): void;
}) {
  const queryClient = useQueryClient();
  const [saveState, setSaveState] = useState<"saved" | "saving" | "failed">("saved");
  const [customAllergy, setCustomAllergy] = useState("");
  const [customConfirmed, setCustomConfirmed] = useState(false);
  const membersQuery = useQuery({
    queryKey: householdKeys.members(userId),
    queryFn: api.listMembers,
  });
  const members = membersQuery.data ?? [];
  const draft = members.find((member) => member.status === "draft") ?? null;
  const completeMembers = members.filter((member) => member.status === "complete");
  const allergiesQuery = useQuery({
    queryKey: householdKeys.allergies(userId, draft?.id ?? "none"),
    queryFn: () => (draft === null ? Promise.resolve([]) : api.listAllergies(draft.id)),
    enabled: draft !== null,
  });
  const allergies = allergiesQuery.data ?? [];

  const replaceMember = (member: HouseholdMemberRow) => {
    queryClient.setQueryData<HouseholdMemberRow[]>(
      householdKeys.members(userId),
      (current = []) => current.map((item) => (item.id === member.id ? member : item)),
    );
  };

  const startMutation = useMutation({
    mutationFn: async () => {
      const created = await api.createDraft(members.length);
      await api.setProgress("in_progress");
      return created;
    },
    onSuccess: (created) => {
      queryClient.setQueryData<HouseholdMemberRow[]>(
        householdKeys.members(userId),
        (current = []) => [...current, created],
      );
    },
  });

  const save = async (patch: HouseholdDraftPatch) => {
    if (draft === null) return;
    setSaveState("saving");
    try {
      const saved = await api.updateDraft(draft.id, patch);
      replaceMember(saved);
      setSaveState("saved");
    } catch {
      setSaveState("failed");
    }
  };

  const completedRequired = useMemo(() => {
    if (draft === null) return 0;
    return [
      draft.age_band !== null,
      draft.allergy_status !== null,
      draft.unsupported_diet_status !== null,
    ].filter(Boolean).length;
  }, [draft]);

  const canComplete =
    draft !== null &&
    completedRequired === 3 &&
    (draft.allergy_status !== "registered" || allergies.length > 0) &&
    (draft.unsupported_diet_status !== "present" || draft.unsupported_diet_kinds.length > 0);

  if (membersQuery.isPending) {
    return <main className="page-frame">家族設定を読み込んでいます…</main>;
  }
  if (membersQuery.isError) {
    return (
      <main className="page-frame">
        <p className="error-message" role="alert">
          家族設定を読み込めませんでした。通信を確認して再読み込みしてください。
        </p>
      </main>
    );
  }

  if (draft === null) {
    return (
      <main className="page-frame stack">
        <h1>家族の初回設定</h1>
        <p>年齢区分、アレルギー、対象外の食事の3項目から始めます。</p>
        {completeMembers.length > 0 && <p>{completeMembers.length}人の設定が完了しています。</p>}
        <button
          className="primary-button"
          type="button"
          disabled={startMutation.isPending}
          onClick={() => startMutation.mutate()}
        >
          {completeMembers.length === 0 ? "家族設定を始める" : "家族を追加"}
        </button>
        {completeMembers.length > 0 && (
          <button
            className="secondary-button"
            type="button"
            onClick={() => void api.setProgress("complete").then(onDone)}
          >
            AI情報の説明へ
          </button>
        )}
      </main>
    );
  }

  return (
    <main className="page-frame stack">
      <div>
        <p className="eyebrow">約60秒の必須設定</p>
        <h1>家族の初回設定</h1>
        <p>必須項目 {completedRequired} / 3</p>
        <p className={saveState === "failed" ? "error-message" : "status-message"} aria-live="polite">
          {saveState === "saving" && "保存中…"}
          {saveState === "saved" && "保存済み"}
          {saveState === "failed" && "保存できませんでした。選び直して再試行してください。"}
        </p>
      </div>

      <section className="card stack">
        <label className="field">
          <span>呼び名（任意・AIには送りません）</span>
          <input
            value={draft.display_name ?? ""}
            maxLength={30}
            onChange={(event) => void save({ display_name: event.target.value || null })}
          />
        </label>
        <label className="field">
          <span>年齢区分</span>
          <select
            aria-label="年齢区分"
            value={draft.age_band ?? ""}
            onChange={(event) => {
              const ageBand = event.target.value as AgeBand;
              void save({ age_band: ageBand, ...defaultsForAgeBand(ageBand) });
            }}
          >
            <option value="">選んでください</option>
            <option value="post_weaning_to_2">離乳食完了後〜2歳</option>
            <option value="age_3_5">3〜5歳</option>
            <option value="age_6_8">6〜8歳</option>
            <option value="age_9_12">9〜12歳</option>
            <option value="age_13_17">13〜17歳</option>
            <option value="adult">大人</option>
            <option value="senior">高齢者</option>
          </select>
        </label>
        <label className="field">
          <span>アレルギーの確認</span>
          <select
            aria-label="アレルギーの確認"
            value={draft.allergy_status ?? ""}
            onChange={(event) =>
              void save({ allergy_status: event.target.value as AllergyStatus })
            }
          >
            <option value="">選んでください</option>
            <option value="none">なし</option>
            <option value="registered">登録あり</option>
            <option value="unconfirmed">未確認</option>
          </select>
        </label>

        {draft.allergy_status === "registered" && (
          <fieldset className="stack">
            <legend>登録するアレルギー</legend>
            <label className="field">
              <span>自由登録名</span>
              <input
                value={customAllergy}
                maxLength={80}
                onChange={(event) => setCustomAllergy(event.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={customConfirmed}
                onChange={(event) => setCustomConfirmed(event.target.checked)}
              />
              標準項目の候補を確認し、この表記で登録します
            </label>
            <button
              className="secondary-button"
              type="button"
              disabled={!customConfirmed || customAllergy.trim() === ""}
              onClick={() =>
                void api
                  .addCustomAllergy(draft.id, customAllergy, [])
                  .then(() => queryClient.invalidateQueries({
                    queryKey: householdKeys.allergies(userId, draft.id),
                  }))
                  .then(() => {
                    setCustomAllergy("");
                    setCustomConfirmed(false);
                  })
              }
            >
              アレルギーを追加
            </button>
            <p>{allergies.length}件登録済み</p>
          </fieldset>
        )}

        <label className="field">
          <span>対象外の食事の確認</span>
          <select
            aria-label="対象外の食事の確認"
            value={draft.unsupported_diet_status ?? ""}
            onChange={(event) => {
              const value = event.target.value as UnsupportedDietStatus;
              void save({
                unsupported_diet_status: value,
                unsupported_diet_kinds: value === "present" ? draft.unsupported_diet_kinds : [],
              });
            }}
          >
            <option value="">選んでください</option>
            <option value="none">該当なし</option>
            <option value="present">該当あり</option>
            <option value="unconfirmed">未確認</option>
          </select>
        </label>

        {draft.unsupported_diet_status === "present" && (
          <fieldset>
            <legend>該当する項目</legend>
            {unsupportedDietOptions.map(([value, label]) => (
              <label key={value} className="field">
                <span>
                  <input
                    type="checkbox"
                    checked={draft.unsupported_diet_kinds.includes(value)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...draft.unsupported_diet_kinds, value]
                        : draft.unsupported_diet_kinds.filter((item) => item !== value);
                      void save({ unsupported_diet_kinds: next });
                    }}
                  />
                  {label}
                </span>
              </label>
            ))}
            <p>通常の献立では対応できません。対象メンバーから外すか、専門職の指示に従ってください。</p>
          </fieldset>
        )}
      </section>

      <button
        className="primary-button"
        type="button"
        disabled={!canComplete}
        onClick={() =>
          void api.completeMember(draft.id).then((member) => {
            replaceMember(member);
          })
        }
      >
        残りはあとで設定して完了
      </button>
      {draft.allergy_status === "unconfirmed" && (
        <p className="error-message">アレルギーを確認するまで、このメンバーは献立生成に使えません。</p>
      )}
      {draft.unsupported_diet_status === "unconfirmed" && (
        <p className="error-message">対象外の食事を確認するまで、このメンバーは献立生成に使えません。</p>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Implement privacy explanation, consent, and non-consent path (5 minutes)**

Create `src/features/privacy/privacy-notice-page.tsx`:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth } from "@/features/auth/auth-provider";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { sanitizeReturnPath } from "@/features/auth/auth-flow";
import { acceptCurrentPrivacyConsent } from "./privacy-api";
import { privacySections, providerExplanation } from "./privacy-copy";
import { privacyKeys } from "./privacy-queries";

export function PrivacyNoticePage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const userId = auth.session?.user.id;
  const returnTo = sanitizeReturnPath(params.get("returnTo"));
  const mutation = useMutation({
    mutationFn: async () => {
      if (userId === undefined) throw new Error("ログインが必要です");
      return acceptCurrentPrivacyConsent(getBrowserSupabaseClient(), userId);
    },
    onSuccess: (consent) => {
      queryClient.setQueryData(privacyKeys.current(consent.user_id), consent);
      navigate(returnTo, { replace: true });
    },
  });

  return (
    <PrivacyNoticeContent
      saving={mutation.isPending}
      error={mutation.isError ? "確認状態を保存できませんでした。通信を確認してください。" : undefined}
      onAccept={() => mutation.mutate()}
      onSkip={() => navigate(returnTo, { replace: true })}
    />
  );
}

export function PrivacyNoticeContent({
  saving,
  error,
  onAccept,
  onSkip,
}: {
  saving: boolean;
  error?: string | undefined;
  onAccept(): void;
  onSkip(): void;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <main className="page-frame stack">
      <div>
        <p className="eyebrow">AIを使う前の確認</p>
        <h1>家族情報の取り扱い</h1>
      </div>
      {privacySections.map((section) => (
        <section className="card" key={section.title}>
          <h2>{section.title}</h2>
          <p>{section.body}</p>
        </section>
      ))}
      <section className="card">
        <h2>送信先について</h2>
        <p>{providerExplanation}</p>
        <a href="/privacy" target="_blank" rel="noreferrer">
          運営者のプライバシー説明
        </a>
      </section>
      <p>
        AI生成レシピだけでアレルギーの安全は保証できません。加工品の原材料表示と家庭内の混入を確認してください。
      </p>
      <label>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
        />
        説明を確認しました
      </label>
      {error !== undefined && <p className="error-message">{error}</p>}
      <button
        className="primary-button"
        type="button"
        disabled={!checked || saving}
        onClick={onAccept}
      >
        {saving ? "保存中…" : "確認して進む"}
      </button>
      <button className="text-button" type="button" onClick={onSkip}>
        今はAIを使わない
      </button>
      <p>同意しなくても、AIを使わない緊急献立は利用できます。</p>
    </main>
  );
}
```

- [ ] **Step 5: Run onboarding/privacy tests and typecheck (5 minutes)**

Run:

```bash
npm test -- --run src/features/household/household-onboarding-page.test.tsx src/features/privacy/privacy-notice-page.test.tsx
npm run typecheck
npm run lint
```

Expected: both component tests pass; selecting each required value calls one save; the draft remains the same row; completion stays disabled for registered-with-zero-allergies and present-with-zero-kinds; consent cannot be submitted before checking the explanation.

- [ ] **Step 6: Commit onboarding and privacy UI (2 minutes)**

```bash
git add src/features/household/household-onboarding-page.test.tsx src/features/household/household-onboarding-page.tsx src/features/privacy/privacy-notice-page.test.tsx src/features/privacy/privacy-notice-page.tsx
git commit -m "feat: add resumable household onboarding"
```

### Task 11: Wire protected routes, onboarding guard, and the five-item app shell

**Files:**
- Create: `src/features/auth/protected-routes.test.tsx`
- Create: `src/features/auth/protected-routes.tsx`
- Create: `src/shared/ui/placeholder-page.tsx`
- Create: `src/app/layouts/app-shell.tsx`
- Create: `src/app/router.tsx`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: `useAuth`, `getProfile`, onboarding page, privacy page, login, and callback.
- Produces: public `/login` and `/auth/callback`; session-protected `/onboarding` and `/privacy`; completed-onboarding shell `/planner`, `/pantry`, `/history`, `/shopping`, `/settings`; root redirect `/` → `/planner`.
- Plans 2–6 replace individual `PlaceholderPage` route elements without changing the pathless guards or `AppShell`.

- [ ] **Step 1: Write the failing protected-route test (4 minutes)**

Create `src/features/auth/protected-routes.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, Outlet } from "react-router";
import { RouterProvider } from "react-router/dom";
import { expect, it, vi } from "vitest";
import { RequireSession } from "./protected-routes";

vi.mock("./auth-provider", () => ({
  useAuth: vi.fn(() => ({
    status: "unauthenticated",
    session: null,
    refreshSession: vi.fn(),
  })),
}));

it("returns an unauthenticated visitor to login with a safe return path", async () => {
  const router = createMemoryRouter(
    [
      {
        element: <RequireSession />,
        children: [{ path: "/pantry", element: <h1>冷蔵庫</h1> }],
      },
      {
        path: "/login",
        element: (
          <>
            <h1>ログイン</h1>
            <Outlet />
          </>
        ),
      },
    ],
    { initialEntries: ["/pantry?from=test"] },
  );
  render(<RouterProvider router={router} />);
  expect(await screen.findByRole("heading", { name: "ログイン" })).toBeInTheDocument();
  expect(router.state.location.search).toBe("?returnTo=%2Fpantry%3Ffrom%3Dtest");
});
```

- [ ] **Step 2: Run the test and verify failure (2 minutes)**

Run: `npm test -- --run src/features/auth/protected-routes.test.tsx`

Expected: FAIL because `protected-routes.tsx` does not exist.

- [ ] **Step 3: Implement session and completed-onboarding guards (5 minutes)**

Create `src/features/auth/protected-routes.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet, useLocation } from "react-router";
import { getProfile } from "@/features/household/household-api";
import { householdKeys } from "@/features/household/household-queries";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { useAuth } from "./auth-provider";
import { sanitizeReturnPath } from "./auth-flow";

export function RequireSession() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === "loading") {
    return <main className="page-frame">ログイン状態を確認しています…</main>;
  }
  if (auth.status === "unauthenticated" || auth.session === null) {
    const returnTo = sanitizeReturnPath(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }
  return <Outlet />;
}

export function RequireCompletedOnboarding() {
  const auth = useAuth();
  const userId = auth.session?.user.id;
  const profileQuery = useQuery({
    queryKey: householdKeys.profile(userId ?? "none"),
    queryFn: () => {
      if (userId === undefined) throw new Error("ログインが必要です");
      return getProfile(getBrowserSupabaseClient(), userId);
    },
    enabled: userId !== undefined,
  });

  if (profileQuery.isPending) {
    return <main className="page-frame">初回設定を確認しています…</main>;
  }
  if (profileQuery.isError) {
    return (
      <main className="page-frame">
        <p className="error-message" role="alert">
          初回設定を確認できませんでした。通信を確認して再読み込みしてください。
        </p>
      </main>
    );
  }
  if (profileQuery.data === undefined) {
    return <main className="page-frame">初回設定を確認しています…</main>;
  }
  if (profileQuery.data.onboarding_status !== "complete") {
    return <Navigate to="/onboarding" replace />;
  }
  return <Outlet />;
}
```

- [ ] **Step 4: Implement the app shell and explicit route placeholders (5 minutes)**

Create `src/shared/ui/placeholder-page.tsx`:

```tsx
export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <main className="page-frame stack">
      <h1>{title}</h1>
      <section className="card">
        <p>{description}</p>
      </section>
    </main>
  );
}
```

Create `src/app/layouts/app-shell.tsx`:

```tsx
import { NavLink, Outlet } from "react-router";

const items = [
  { to: "/planner", label: "献立" },
  { to: "/pantry", label: "冷蔵庫" },
  { to: "/history", label: "履歴" },
  { to: "/shopping", label: "買い物" },
  { to: "/settings", label: "設定" },
] as const;

export function AppShell() {
  return (
    <div>
      <Outlet />
      <nav className="bottom-nav" aria-label="メインメニュー">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => (isActive ? "nav-item nav-item-active" : "nav-item")}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
```

Append these complete rules to `src/styles.css`:

```css
.bottom-nav {
  position: fixed;
  z-index: 10;
  right: 0;
  bottom: 0;
  left: 0;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  border-top: 1px solid var(--border);
  background: rgb(255 250 243 / 96%);
  backdrop-filter: blur(8px);
}

.nav-item {
  display: flex;
  min-width: 0;
  min-height: 56px;
  align-items: center;
  justify-content: center;
  border-top: 3px solid transparent;
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  text-decoration: none;
}

.nav-item-active {
  border-top-color: var(--primary);
  color: var(--primary-hover);
}

@media (min-width: 720px) {
  .bottom-nav {
    right: 50%;
    left: auto;
    width: min(680px, 100%);
    transform: translateX(50%);
    border-right: 1px solid var(--border);
    border-left: 1px solid var(--border);
  }
}
```

- [ ] **Step 5: Wire the complete router and replace the temporary root render (5 minutes)**

Create `src/app/router.tsx`:

```tsx
import { createBrowserRouter, Navigate } from "react-router";
import { AppShell } from "./layouts/app-shell";
import { AuthCallbackPage } from "@/features/auth/auth-callback-page";
import { LoginPage } from "@/features/auth/login-page";
import {
  RequireCompletedOnboarding,
  RequireSession,
} from "@/features/auth/protected-routes";
import { HouseholdOnboardingPage } from "@/features/household/household-onboarding-page";
import { PrivacyNoticePage } from "@/features/privacy/privacy-notice-page";
import { PlaceholderPage } from "@/shared/ui/placeholder-page";

export type AppRouter = ReturnType<typeof createBrowserRouter>;

export function createAppRouter(): AppRouter {
  return createBrowserRouter([
    { path: "/login", element: <LoginPage /> },
    { path: "/auth/callback", element: <AuthCallbackPage /> },
    {
      element: <RequireSession />,
      children: [
        { path: "/onboarding", element: <HouseholdOnboardingPage /> },
        { path: "/privacy", element: <PrivacyNoticePage /> },
        {
          element: <RequireCompletedOnboarding />,
          children: [
            {
              element: <AppShell />,
              children: [
                { path: "/", element: <Navigate to="/planner" replace /> },
                {
                  path: "/planner",
                  element: (
                    <PlaceholderPage
                      title="献立"
                      description="朝食・昼食・夕食から1食分の献立を作ります。"
                    />
                  ),
                },
                {
                  path: "/pantry",
                  element: (
                    <PlaceholderPage
                      title="冷蔵庫"
                      description="使いたい食材を登録する画面です。"
                    />
                  ),
                },
                {
                  path: "/history",
                  element: (
                    <PlaceholderPage
                      title="履歴"
                      description="完成した献立とお気に入りを確認する画面です。"
                    />
                  ),
                },
                {
                  path: "/shopping",
                  element: (
                    <PlaceholderPage
                      title="買い物"
                      description="使用中の買い物リストを確認する画面です。"
                    />
                  ),
                },
                {
                  path: "/settings",
                  element: (
                    <PlaceholderPage
                      title="設定"
                      description="家族情報とアカウントを管理する画面です。"
                    />
                  ),
                },
              ],
            },
          ],
        },
      ],
    },
  ]);
}
```

Replace `src/main.tsx` with:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { AppProviders } from "./app/providers";
import { createAppRouter } from "./app/router";
import { AuthProvider } from "./features/auth/auth-provider";
import "./styles.css";

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Application root element was not found");
}

const router = createAppRouter();

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </AppProviders>
  </StrictMode>,
);
```

- [ ] **Step 6: Pass route tests and static checks (4 minutes)**

Run:

```bash
npm test -- --run src/features/auth/protected-routes.test.tsx
npm run typecheck
npm run lint
npm run build
```

Expected: the redirect test passes, every command exits 0, and build output contains no SSR bundle. At 320px the five labels fit without horizontal scroll, each nav target is 56px high, and active state uses border/text weight in addition to color.

- [ ] **Step 7: Commit protected routing and shell (2 minutes)**

```bash
git add src/features/auth/protected-routes.test.tsx src/features/auth/protected-routes.tsx src/shared/ui/placeholder-page.tsx src/app/layouts/app-shell.tsx src/app/router.tsx src/main.tsx src/styles.css
git commit -m "feat: protect the application shell"
```

### Task 12: Prove auth recovery, draft resume, consent, and the complete increment gate in E2E

**Files:**
- Create: `e2e/fixtures/auth.ts`
- Create: `e2e/specs/foundation.spec.ts`
- Create: `e2e/specs/auth-recovery.spec.ts`
- Create: `e2e/specs/oauth-mock.spec.ts`
- Create: `e2e/specs/onboarding.spec.ts`

**Interfaces:**
- Consumes: local GoTrue, Mailpit API at `http://127.0.0.1:8025`, deterministic `oauth-mock` at `http://127.0.0.1:8788`, migrated DB, and browser routes.
- Produces: extended Playwright `test` with `authEmail` and `authenticatedPage`, plus reusable `requestMagicLinkAndReadUrl` and `completeMinimumOnboarding`.
- E2E never uses `SERVICE_ROLE_KEY` in browser code and never calls a real Google/OpenRouter service. The OAuth mock container alone receives the local service-role value to ensure its fixed fixture user exists; it never serializes or logs that value.

- [ ] **Step 1: Add failing E2E specifications before the fixture exists (5 minutes)**

Create `e2e/specs/foundation.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("protects app routes and fits the active viewport", async ({ page }) => {
  await page.goto("/pantry");
  await expect(page.getByRole("heading", { name: "こんだて日和" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/login");
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  for (const button of await page.getByRole("button").all()) {
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
```

Create `e2e/specs/auth-recovery.spec.ts`:

```ts
import { expect, requestMagicLinkAndReadUrl, test } from "../fixtures/auth";

test("same-browser callback restores both callback and original tabs", async ({
  page,
  context,
  authEmail,
}) => {
  const magicLink = await requestMagicLinkAndReadUrl(page, authEmail);
  const callbackTab = await context.newPage();
  await callbackTab.goto(magicLink);
  await expect(callbackTab.getByRole("heading", { name: "家族の初回設定" })).toBeVisible();
  await page.bringToFront();
  await expect(page).toHaveURL(/\/onboarding$/u);
});

test("isolated WebView deposits once and the original browser claims with its secret", async ({
  page,
  browser,
  authEmail,
}) => {
  const magicLink = await requestMagicLinkAndReadUrl(page, authEmail);
  const isolated = await browser.newContext();
  const webView = await isolated.newPage();
  await webView.goto(magicLink);
  await expect(
    webView.getByText("元のブラウザでログインを続けてください。この画面に認証情報は保存されません"),
  ).toBeVisible();
  await page.bringToFront();
  await expect(page).toHaveURL(/\/onboarding$/u);
  await expect(webView).not.toHaveURL(/\/onboarding$/u);
  await isolated.close();
});

test("Google cancel and expired links return actionable login choices", async ({ page }) => {
  await page.goto("/auth/callback?error=access_denied&returnTo=%2Fplanner");
  await expect(page.getByText(/Googleログインがキャンセルされました/u)).toBeVisible();
  await page.goto(
    "/auth/callback?error=access_denied&error_code=otp_expired&flow=expired&returnTo=%2Fplanner",
  );
  await expect(page.getByText(/期限切れか、すでに使用/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Googleで続ける" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ログイン用メールを送る" })).toBeVisible();
});
```

Create `e2e/specs/oauth-mock.spec.ts`. This is the normal-CI Google success/cancel proof required by the design; it traverses the Compose provider page rather than synthesizing an app callback URL:

```ts
import { expect, test } from "@playwright/test";

test("local Google success returns the bound code to the app and establishes a Supabase session",
  async ({ page }) => {
    await page.goto("/login?returnTo=%2Fonboarding");
    await page.getByRole("button", { name: "Googleで続ける" }).click();
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:8788\/authorize\?/u);
    const providerUrl = new URL(page.url());
    expect(providerUrl.searchParams.get("redirect_uri"))
      .toBe("http://127.0.0.1:5173/auth/callback");
    expect(providerUrl.searchParams.get("flow")).toMatch(/^[0-9a-f-]{36}$/u);
    expect(providerUrl.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(providerUrl.href).not.toMatch(/token|password|email/iu);

    const callbackRequest = page.waitForRequest((request) =>
      new URL(request.url()).origin === "http://127.0.0.1:5173" &&
      new URL(request.url()).pathname === "/auth/callback");
    await page.getByRole("link", { name: "Googleテスト利用者で続ける" }).click();
    const callbackUrl = new URL((await callbackRequest).url());
    expect(callbackUrl.searchParams.get("flow")).toBe(providerUrl.searchParams.get("flow"));
    expect(callbackUrl.searchParams.get("state")).toBe(providerUrl.searchParams.get("state"));
    expect(callbackUrl.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(callbackUrl.href).not.toMatch(/access_token|refresh_token|password|email/iu);
    await expect(page).toHaveURL(/\/onboarding$/u);
    await expect(page.getByRole("heading", { name: "家族の初回設定" })).toBeVisible();
  });

test("local Google cancellation returns through the app callback with actionable choices",
  async ({ page }) => {
    await page.goto("/login?returnTo=%2Fplanner");
    await page.getByRole("button", { name: "Googleで続ける" }).click();
    const providerUrl = new URL(page.url());
    const callbackRequest = page.waitForRequest((request) =>
      new URL(request.url()).pathname === "/auth/callback");
    await page.getByRole("link", { name: "キャンセル" }).click();
    const callbackUrl = new URL((await callbackRequest).url());
    expect(callbackUrl.searchParams.get("flow")).toBe(providerUrl.searchParams.get("flow"));
    expect(callbackUrl.searchParams.get("state")).toBe(providerUrl.searchParams.get("state"));
    expect(callbackUrl.searchParams.get("error")).toBe("access_denied");
    expect(callbackUrl.searchParams.has("code")).toBe(false);
    await expect(page.getByText(/Googleログインがキャンセルされました/u)).toBeVisible();
    await expect(page.getByRole("button", { name: "Googleで続ける" })).toBeVisible();
    await expect(page.getByRole("button", { name: "ログイン用メールを送る" })).toBeVisible();
  });
```

Create `e2e/specs/onboarding.spec.ts`:

```ts
import { expect, test } from "../fixtures/auth";

test("resumes a partially saved member and records privacy consent", async ({
  authenticatedPage: page,
}) => {
  await page.getByRole("button", { name: "家族設定を始める" }).click();
  await page.getByLabel("年齢区分").selectOption("adult");
  await expect(page.getByText("保存済み")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("年齢区分")).toHaveValue("adult");
  await page.getByLabel("アレルギーの確認").selectOption("none");
  await page.getByLabel("対象外の食事の確認").selectOption("none");
  await page.getByRole("button", { name: "残りはあとで設定して完了" }).click();
  await page.getByRole("button", { name: "AI情報の説明へ" }).click();
  await expect(page.getByRole("heading", { name: "AIへ送る情報" })).toBeVisible();
  await page.getByRole("checkbox", { name: /説明を確認しました/u }).check();
  await page.getByRole("button", { name: "確認して進む" }).click();
  await expect(page).toHaveURL(/\/planner$/u);
  await expect(page.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();
});
```

- [ ] **Step 2: Run E2E and verify the red state (3 minutes)**

Run: `npm run e2e -- --project=mobile-chromium`

Expected: TypeScript/module loading fails because `e2e/fixtures/auth.ts` does not exist. This is the red state; do not weaken the scenarios.

- [ ] **Step 3: Implement the complete Mailpit-backed auth fixture (5 minutes)**

Create `e2e/fixtures/auth.ts`:

```ts
import { expect, test as base, type Page } from "@playwright/test";
import { z } from "zod";

const messageListSchema = z.object({
  messages: z.array(
    z.object({
      ID: z.string(),
      To: z.array(z.object({ Address: z.string() })),
    }),
  ),
});

const messageSchema = z.object({
  HTML: z.string().nullable().optional(),
  Text: z.string().nullable().optional(),
});

type AuthFixtures = {
  authEmail: string;
  authenticatedPage: Page;
};

export const test = base.extend<AuthFixtures>({
  authEmail: async ({ browserName }, use, testInfo) => {
    const safeTitle = testInfo.title.replaceAll(/[^a-z0-9]+/giu, "-").slice(0, 30);
    await use(
      `${safeTitle}-${browserName}-${testInfo.workerIndex}-${Date.now()}@example.invalid`,
    );
  },

  authenticatedPage: async ({ page, authEmail }, use) => {
    const magicLink = await requestMagicLinkAndReadUrl(page, authEmail);
    await page.goto(magicLink);
    await expect(page.getByRole("heading", { name: "家族の初回設定" })).toBeVisible();
    await use(page);
  },
});

export { expect };

export async function requestMagicLinkAndReadUrl(
  page: Page,
  email: string,
): Promise<string> {
  await page.goto("/login?returnTo=%2Fplanner");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByRole("button", { name: "ログイン用メールを送る" }).click();
  await expect(page.getByText(`${email} に送りました`)).toBeVisible();

  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const listResponse = await page.request.get("http://127.0.0.1:8025/api/v1/messages");
        if (!listResponse.ok()) return "";
        const parsedList = messageListSchema.safeParse(await listResponse.json());
        if (!parsedList.success) return "";
        const message = parsedList.data.messages.find((candidate) =>
          candidate.To.some((recipient) => recipient.Address === email),
        );
        if (message === undefined) return "";
        const detailResponse = await page.request.get(
          `http://127.0.0.1:8025/api/v1/message/${message.ID}`,
        );
        if (!detailResponse.ok()) return "";
        const parsedMessage = messageSchema.safeParse(await detailResponse.json());
        if (!parsedMessage.success) return "";
        const body = parsedMessage.data.HTML ?? parsedMessage.data.Text ?? "";
        const match = body.match(/https?:\/\/[^"'<>\s]+\/auth\/v1\/verify[^"'<>\s]*/u);
        link = match?.[0].replaceAll("&amp;", "&");
        return link ?? "";
      },
      { timeout: 15_000, intervals: [250, 500, 1_000] },
    )
    .toContain("/auth/v1/verify");

  if (link === undefined) throw new Error("Magic-link URL was not found in Mailpit");
  return link;
}

export async function completeMinimumOnboarding(page: Page): Promise<void> {
  await page.getByRole("button", { name: "家族設定を始める" }).click();
  await page.getByLabel("年齢区分").selectOption("adult");
  await page.getByLabel("アレルギーの確認").selectOption("none");
  await page.getByLabel("対象外の食事の確認").selectOption("none");
  await page.getByRole("button", { name: "残りはあとで設定して完了" }).click();
  await page.getByRole("button", { name: "AI情報の説明へ" }).click();
}
```

- [ ] **Step 4: Run focused component, DB, and E2E proof (5 minutes)**

Run:

```bash
npm test -- --run src/features/auth src/features/household src/features/privacy
npm run db:test
docker compose up -d app
npm run e2e -- e2e/specs/oauth-mock.spec.ts --project=mobile-chromium
npm run e2e -- --project=mobile-chromium
npm run e2e -- --project=desktop-chromium
```

Expected: Vitest reports zero failures; pgTAP includes the auth-continuation tests; both Playwright projects pass. Same-browser callback claims once; isolated callback deposits without a session and the original browser alone reaches `/onboarding` using its secret and PKCE verifier.

- [ ] **Step 5: Run the roadmap global verification gate (5 minutes)**

Run exactly:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test -- --run
npm run db:test
npm run e2e
npm run build
docker compose config --quiet
```

Expected: every command exits 0; Vitest, pgTAP, and Playwright report zero failed tests; Vite creates `dist/`; Docker Compose reports no configuration error. Also run `git diff --check` and expect no output.

- [ ] **Step 6: Commit the verified increment (2 minutes)**

```bash
git add e2e
git commit -m "test: cover auth and onboarding recovery"
```

After the commit, run `git status --short`. Expected: no tracked implementation changes remain; documentation changes belonging to the plan author are outside the execution commit sequence.

### Task 13: Close the reviewed PKCE, deterministic OAuth, canonical-origin, full household-settings, and E2E fixture contracts

**Files:**
- Modify: `scripts/generate-local-secrets.mjs`
- Modify: `.env.example`
- Modify: `compose.yaml`
- Modify: `tools/oauth-mock/fixtures/google-user.json`
- Modify: `tools/oauth-mock/server.test.mjs`
- Modify: `tools/oauth-mock/server.mjs`
- Modify: `supabase/config.toml`
- Modify: `supabase/tests/database/002_household_rls.test.sql`
- Modify: `supabase/migrations/20260711000330_auth_continuations.sql`
- Modify: `supabase/tests/database/004_auth_continuations.test.sql`
- Regenerate: `src/shared/types/database.generated.ts`
- Modify: `netlify/functions/_shared/auth-continuation-crypto.test.ts`
- Modify: `netlify/functions/_shared/auth-continuation-crypto.ts`
- Modify: `netlify/functions/auth-continuation-create.test.ts`
- Modify: `netlify/functions/auth-continuation-create.ts`
- Modify: `netlify/functions/auth-continuation-deposit.test.ts`
- Modify: `netlify/functions/auth-continuation-deposit.ts`
- Modify: `netlify/functions/auth-continuation-claim.test.ts`
- Modify: `netlify/functions/auth-continuation-claim.ts`
- Modify: `package.json`
- Modify: `tests/tooling/project-config.test.mjs`
- Modify: `tests/tooling/compose.test.mjs`
- Modify: `playwright.config.ts`
- Modify: `src/shared/config/public-env.test.ts`
- Modify: `src/shared/config/public-env.ts`
- Create: `src/shared/lib/supabase.test.ts`
- Modify: `src/shared/lib/supabase.ts`
- Modify: `src/features/auth/auth-flow.test.ts`
- Modify: `src/features/auth/auth-flow.ts`
- Modify: `src/features/auth/auth-continuation-recovery.test.ts`
- Modify: `src/features/auth/auth-continuation-recovery.ts`
- Modify: `src/features/auth/auth-provider.test.tsx`
- Modify: `src/features/auth/auth-provider.tsx`
- Modify: `src/features/auth/auth-gateway.test.ts`
- Modify: `src/features/auth/auth-gateway.ts`
- Modify: `src/features/auth/login-page.test.tsx`
- Modify: `src/features/auth/login-page.tsx`
- Modify: `src/features/auth/auth-callback-page.test.tsx`
- Modify: `src/features/auth/auth-callback-page.tsx`
- Create: `src/features/household/allergy-editor.test.tsx`
- Create: `src/features/household/allergy-editor.tsx`
- Create: `src/features/household/household-settings-page.test.tsx`
- Create: `src/features/household/household-settings-page.tsx`
- Modify: `src/features/household/household-api.ts`
- Create: `src/features/household/household-api.test.ts`
- Modify: `src/features/household/household-queries.ts`
- Modify: `src/features/household/household-onboarding-page.test.tsx`
- Modify: `src/features/household/household-onboarding-page.tsx`
- Modify: `src/app/router.tsx`
- Modify: `e2e/fixtures/auth.ts`
- Modify: `e2e/specs/auth-recovery.spec.ts`
- Modify: `e2e/specs/oauth-mock.spec.ts`
- Modify: `e2e/specs/onboarding.spec.ts`
- Create: `e2e/specs/settings.spec.ts`

**Interfaces:**
- `PublicEnv.authContinuationTtlMs` is the ordinary TypeScript type `number`; `publicEnvSchema` enforces the exact runtime value `300_000` with an equality refinement. Local parse yields `{authProviderMode:"oauth_mock",oauthMockOrigin:"http://127.0.0.1:8788"}` and retains exact local Supabase URLs. A production parse accepts only `{authProviderMode:"supabase",oauthMockOrigin:null}` plus exact `https://<20-character-project-ref>.supabase.co`; it rejects mock mode, a defined mock origin, arbitrary HTTPS, lookalikes, credentials, ports, trailing slash, path, query, and fragment. The server parser permits exact `http://kong:8000` only with the canonical local site origin and otherwise requires the same exact managed-origin shape. Plan 6 compares the browser/server project refs and binds the maintenance direct host or Session-pooler username suffix to that same value.
- `createBrowserSupabaseClient()` has `flowType: "pkce"`, `detectSessionInUrl: false`, and browser storage enabled. Supabase owns the PKCE verifier; application code never reads, logs, or puts it in a URL.
- `createBrowserSupabaseClient()` also sets exact `storageKey: "kondate.auth.supabase"`. `auth-flow.ts` exports `ownedAuthStoragePrefixes=["kondate.auth.flow.","kondate.auth.supabase"] as const`; Plan 6 account deletion and any later logout cleanup remove only keys beginning with either prefix and retain unrelated application/storage keys.
- `AuthFlow` is `{ id, secret, state, origin, returnTo, startedAt }`; `FlowDeps` is `{randomBytes(size?:number):Uint8Array;now():Date}` and `browserFlowDeps` uses `crypto.getRandomValues(new Uint8Array(size))` plus `new Date()`. `createAuthFlow(returnTo,api,storage,deps=browserFlowDeps)` is the sole signature: production passes three arguments and tests alone inject the fourth. Browser base64url is implemented from bytes without Node `Buffer`. `listUnexpiredAuthFlows(storage,now,ttlMs=300_000)` parses, filters, and deletes malformed/expired owned records. Only the initiating browser stores `secret`, `state`, and Supabase's PKCE verifier. PostgreSQL stores SHA-256 secret/state hashes, never their plaintext. The server parses and uses exactly `AUTH_CONTINUATION_TTL_SECONDS=300`; the browser separately parses `VITE_AUTH_CONTINUATION_TTL_MS=300_000` for local expiry/recovery. The units are never interchanged.
- The continuation route ledger is exact: create owns `POST /api/auth/continuations`; deposit owns `POST /api/auth/continuations/:continuationId/callback`; claim owns `POST /api/auth/continuations/:continuationId/claim`. Deposit and claim parse `continuationId` only from Netlify `context.params`; neither JSON body contains `id`. Claim presents both the initiating browser's `secret` and `state`, and the atomic database claim compares both hashes plus the stored origin.
- Every continuation Function exports a fetch-style default handler and a typed Netlify `Config`. Its outer, unauthenticated flood ceiling is exactly 20 requests per 60 seconds per IP, within Netlify's 180-second maximum. The database still enforces five-minute expiry, first-deposit-wins, one claim, ciphertext erasure, and opportunistic expired-row cleanup; this flood ceiling is not the later AI quota.
- `createContinuationApi(fetchImpl=fetch)` owns the three exact fetch paths, strict request bodies, standard envelope parsing, and URL-encoded dynamic IDs. `completeCallback()` rejects every fragment, deposits a query `code` into the server continuation after state/origin verification, and never calls `setSession`. In production `resumeFlow` calls `exchangeCodeForSession(code)` with Supabase's local PKCE verifier. In local `oauth_mock` mode only, it POSTs the opaque claimed code to `http://127.0.0.1:8788/exchange`, parses fixture credentials, and calls Supabase `signInWithPassword`; the mock never returns or installs a token directly.
- Compose service `oauth-mock` owns deterministic Google approve/cancel redirects and a one-time 300-second exchange. Local E2E must click `Googleで続ける`, traverse `/authorize`, return through `/auth/callback` with the exact flow/state, establish a local Supabase session on approve, and return actionable cancellation copy on cancel. No real Google traffic occurs; real Google success remains Plan 6 staging evidence.
- An isolated WebView can deposit but cannot claim. It renders `元のブラウザでログインを続けてください`; the original browser's poll/focus recovery claims and exchanges. Expired, wrong-origin, wrong-state, wrong-secret, replayed, or already-claimed continuations reveal no code.
- `AllergyEditor` is the single standard/custom allergy editor used by both first onboarding and `/settings`. It searches all 29 reviewed catalog rows after Plan 2 seeds them, adds a standard item by catalog ID, lists every selected standard/custom item by human name with an accessible remove action, and shows standard matches before custom registration can be confirmed.
- `HouseholdSettingsPage` is the full post-onboarding household editor. It adds, completes, selects, edits, and deletes household members and edits display name, age band, allergy status/selections, unsupported-diet status/kinds, required safety constraints, portion, dislikes, spice, and ease preferences. It never owns account deletion; Plan 6 remains the sole owner of account deletion UI and API.
- Every successful settings mutation updates the member/allergy/dislike query immediately, calls `invalidateHouseholdSafetyDependents`, publishes the privacy-minimal `kondate:household-safety-changed` browser event, and renders `家族設定が変わりました。献立・履歴・買い物リストは最新条件で再確認します`. Later result/history/regeneration/shopping consumers must treat that event or invalidated query as stale and run their current-safety revalidation before enabling actions.
- Historical menu consumers must keep a human snapshot and nullable member link (`on delete set null` or an equivalent deletion-safe reference); no later foreign key may prevent an owner from deleting a household member. If the final member is deleted, settings shows `家族を追加してください` and generation remains unavailable until another member is completed. Account deletion remains a distinct Plan 6 operation.
- Plan 2 and later E2E consume `completedOnboardingPage`; they do not repeat onboarding or privacy-consent setup.

- [ ] **Step 1: Write failing configuration, callback-binding, catalog, and fixture tests (5 minutes)**

Extend `tests/tooling/project-config.test.mjs`:

```js
test("installs direct testing peers and avoids explicit undefined config", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(typeof manifest.devDependencies["@testing-library/dom"], "string");
  const playwright = await readFile("playwright.config.ts", "utf8");
  assert.match(playwright, /\.\.\.\(process\.env\.CI \? \{ workers: 1 \} : \{\}\)/u);
  assert.doesNotMatch(playwright, /workers:\s*process\.env\.CI\s*\?\s*1\s*:\s*undefined/u);
});

test("uses one canonical loopback host for browser-visible local URLs", async () => {
  const paths = [
    "playwright.config.ts", "compose.yaml", ".env.example", "supabase/config.toml",
    "scripts/generate-local-secrets.mjs",
  ];
  const sources = await Promise.all(paths.map((path) => readFile(path, "utf8")));
  assert.ok(sources.every((source) => !/http:\/\/local(?:host)/u.test(source)));
  assert.match(sources[0], /baseURL:\s*"http:\/\/127\.0\.0\.1:5173"/u);
  assert.match(sources[4], /SERVER_SITE_ORIGIN",\s*"http:\/\/127\.0\.0\.1:5173"/u);
});
```

Write the browser/server handoff cases in `auth-flow.test.ts`, the three Function tests, and `auth-gateway.test.ts`:

```ts
it("locks Supabase storage and clears only the two exported auth prefixes", () => {
  expect(ownedAuthStoragePrefixes).toEqual([
    "kondate.auth.flow.", "kondate.auth.supabase",
  ]);
  const storage = new MapStorage();
  for (const [key, value] of Object.entries({
    "kondate.auth.flow.flow-1": "flow",
    "kondate.auth.supabase": "session",
    "kondate.auth.supabase-code-verifier": "verifier",
    "kondate:generation:v1": "pending",
    "sb-unrelated-cache": "keep",
    "theme": "warm",
  })) storage.setItem(key, value);
  clearOwnedAuthStorage(storage);
  expect(Array.from({ length: storage.length }, (_, index) => storage.key(index))).toEqual([
    "kondate:generation:v1", "sb-unrelated-cache", "theme",
  ]);
});

it.each([
  "#access_token=attacker&refresh_token=attacker",
  "#provider_token=attacker",
  "#unknown=value",
])("rejects an unbound fragment without installing a session: %s", async (hash) => {
  const client = authClientMock();
  const gateway = createAuthGateway(client, continuationApiMock(), new MapStorage());
  await expect(gateway.completeCallback(new URL(`https://app.test/auth/callback${hash}`)))
    .resolves.toMatchObject({ kind: "error", code: "unbound_callback" });
  expect(client.auth.setSession).not.toHaveBeenCalled();
  expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();
});

it("deposits in an isolated WebView and lets only the original secret claim and exchange", async () => {
  const storage = new MapStorage();
  const api = inMemoryContinuationApi({ now: () => new Date("2026-07-11T00:00:00Z") });
  const flow = await createAuthFlow("/onboarding", api, storage, fixedFlowDeps);
  const client = authClientMock({ exchangeResult: { data: { session }, error: null } });
  const isolated = createAuthGateway(client, api, new MapStorage());
  const url = new URL(buildAuthCallbackUrl("https://app.test", flow));
  url.searchParams.set("code", "single-use-code");
  await expect(isolated.completeCallback(url)).resolves.toMatchObject({
    kind: "deposited", continuation: "original_browser", flowId: flow.id,
  });
  expect(client.auth.exchangeCodeForSession).not.toHaveBeenCalled();

  const original = createAuthGateway(client, api, storage);
  await expect(original.resumeFlow(flow.id)).resolves.toMatchObject({ kind: "complete" });
  await expect(original.resumeFlow(flow.id)).resolves.toMatchObject({ kind: "error", code: "unbound_callback" });
  expect(client.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
  expect(client.auth.setSession).not.toHaveBeenCalled();
});

it.each([
  ["wrong state", { state: "wrong" }],
  ["wrong origin", { origin: "https://evil.example" }],
  ["expired", { now: "2026-07-11T00:05:00.001Z" }],
  ["wrong secret", { secret: "wrong" }],
])("never reveals a deposited code for %s", async (_name, variant) => {
  const result = await exerciseContinuationBoundary(variant);
  expect(result.response).toMatchObject({ ok: false, error: { code: "continuation_unavailable" } });
  expect(JSON.stringify(result.response)).not.toContain("single-use-code");
});

it("uses exact Netlify paths, param-only IDs, state-bound claim, and a valid flood window", async () => {
  expect(createConfig).toMatchObject({ path: "/api/auth/continuations", method: "POST",
    rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip"] } });
  expect(depositConfig).toMatchObject({
    path: "/api/auth/continuations/:continuationId/callback", method: "POST",
    rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip"] },
  });
  expect(claimConfig).toMatchObject({
    path: "/api/auth/continuations/:continuationId/claim", method: "POST",
    rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip"] },
  });

  const deposit = await depositHandler(
    jsonRequest({ id: FLOW_ID, state: STATE, code: CODE }),
    context({ continuationId: FLOW_ID }),
  );
  expect(deposit.status).toBe(400); // body id is an unknown field
  const claim = await claimHandler(
    jsonRequest({ secret: SECRET, state: "wrong-state" }),
    context({ continuationId: FLOW_ID }),
  );
  expect(await claim.json()).toMatchObject({ ok: false,
    error: { code: "continuation_unavailable" } });
});

it("allows HTTP only for the canonical local site origin", () => {
  expect(parseServerEnv({ ...validServerEnv,
    SERVER_SITE_ORIGIN: "http://127.0.0.1:5173" })).toBeDefined();
  expect(() => parseServerEnv({ ...validServerEnv,
    SERVER_SITE_ORIGIN: "http://app.example" })).toThrow(/HTTPS/u);
  expect(parseServerEnv({ ...validServerEnv,
    SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SERVER_SITE_ORIGIN: "https://app.example" })).toBeDefined();
});

it("rejects an arbitrary or non-origin Supabase service-role destination", () => {
  const production = { ...validServerEnv,
    SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SERVER_SITE_ORIGIN: "https://app.example" };
  expect(parseManagedSupabaseProjectRef(production.SUPABASE_URL))
    .toBe("abcdefghijklmnopqrst");
  for (const SUPABASE_URL of ["https://collector.example",
    "https://abcdefghijklmnopqrst.supabase.co.evil.example",
    "https://abcdefghijklmnopqrst.supabase.co/",
    "https://abcdefghijklmnopqrst.supabase.co/rest/v1",
    "https://user@abcdefghijklmnopqrst.supabase.co"]){
    expect(() => parseServerEnv({ ...production, SUPABASE_URL }))
      .toThrow("server_configuration_invalid");
  }
});

it("calls dynamic continuation routes without serializing an id in either body", async () => {
  const fetchImpl = recordingFetch([
    ok({ id: FLOW_ID, expiresAt: "2026-07-11T00:05:00Z" }), noContent(),
    ok({ code: CODE, returnTo: "/planner" }),
  ]);
  const api = createContinuationApi(fetchImpl);
  await api.create({ state: STATE, secret: SECRET, returnTo: "/planner" });
  await api.deposit(FLOW_ID, { state: STATE, code: CODE });
  await api.claim(FLOW_ID, { secret: SECRET, state: STATE });
  expect(fetchImpl.mock.calls.map(([request]) => String(request))).toEqual([
    "/api/auth/continuations",
    `/api/auth/continuations/${FLOW_ID}/callback`,
    `/api/auth/continuations/${FLOW_ID}/claim`,
  ]);
  expect(fetchImpl.mock.calls.slice(1).map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
    { state: STATE, code: CODE }, { secret: SECRET, state: STATE },
  ]);
});
```

Create `src/shared/lib/supabase.test.ts` and mock only the SDK constructor:

```ts
import { createClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { createBrowserSupabaseClient } from "./supabase";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({ auth: {} })) }));

it("uses the owned Supabase auth storage prefix for sessions and PKCE", () => {
  createBrowserSupabaseClient({
    supabaseUrl: "http://127.0.0.1:8000", supabasePublishableKey: "anon-key",
  });
  expect(vi.mocked(createClient)).toHaveBeenCalledWith(
    "http://127.0.0.1:8000", "anon-key",
    { auth: expect.objectContaining({ flowType: "pkce", detectSessionInUrl: false,
      storageKey: "kondate.auth.supabase" }) },
  );
});
```

In `002_household_rls.test.sql`, replace `plan(12)` with `plan(16)`. Before switching from user one to user two, insert one custom allergy and one dislike with stable IDs for member `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`. Under user two append these four assertions:

```sql
-- While authenticated as user one, before reset role:
insert into public.member_allergies(
  id,user_id,member_id,custom_name,custom_confirmed
) values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','えんどう豆たんぱく',true
);
insert into public.member_dislikes(id,user_id,member_id,ingredient_name) values (
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ねぎ'
);

-- After authenticating as user two:
with changed as (
  update public.member_allergies set custom_name='other' returning 1
)
select is((select count(*)::integer from changed),0,'second user cannot update first user allergy');
with removed as (
  delete from public.member_allergies returning 1
)
select is((select count(*)::integer from removed),0,'second user cannot delete first user allergy');
with changed as (
  update public.member_dislikes set ingredient_name='other' returning 1
)
select is((select count(*)::integer from changed),0,'second user cannot update first user dislike');
with removed as (
  delete from public.member_dislikes returning 1
)
select is((select count(*)::integer from removed),0,'second user cannot delete first user dislike');
```

Create `src/features/household/allergy-editor.test.tsx` with one 29-row catalog fixture and prove both entry points use the same editor:

```tsx
it("searches all 29 standard items and adds the selected catalog id", async () => {
  const user = userEvent.setup();
  const addStandard = vi.fn().mockResolvedValue(undefined);
  render(<AllergyEditor memberId="member-1" catalog={catalog29} allergies={[]}
    addStandard={addStandard} addCustom={vi.fn()} remove={vi.fn()} />);
  await user.type(screen.getByRole("searchbox", { name: "標準29品目を検索" }), "くるみ");
  await user.click(screen.getByRole("button", { name: "くるみを追加" }));
  expect(addStandard).toHaveBeenCalledWith("member-1", "walnut");
});

it.each(["初回設定", "設定"])("uses the standard editor after %s", async (entry) => {
  render(entry === "初回設定" ? <OnboardingHarness /> : <SettingsHarness />);
  expect(await screen.findByRole("searchbox", { name: "標準29品目を検索" })).toBeVisible();
  expect(screen.getByText("自由登録は候補にない場合だけ使用してください")).toBeVisible();
});

it("lists selected standard and custom allergies by name and removes either", async () => {
  const remove = vi.fn().mockResolvedValue(undefined);
  render(<AllergyEditor memberId="member-1" catalog={catalog29}
    allergies={[standardWalnut, customPeaProtein]} addStandard={vi.fn()}
    addCustom={vi.fn()} remove={remove} />);
  const selected = screen.getByRole("list", { name: "選択済みアレルギー" });
  expect(selected).toHaveTextContent("くるみ");
  expect(selected).toHaveTextContent("えんどう豆たんぱく");
  await userEvent.click(screen.getByRole("button", { name: "くるみを削除" }));
  expect(remove).toHaveBeenCalledWith(standardWalnut.id);
});

it("edits every household safety and preference field then invalidates dependents", async () => {
  const api = completeSettingsApi();
  render(<SettingsHarness api={api} />);
  await userEvent.selectOptions(await screen.findByLabelText("年齢区分"), "age_3_5");
  await userEvent.selectOptions(screen.getByLabelText("アレルギーの確認"), "registered");
  await userEvent.selectOptions(screen.getByLabelText("対象外の食事の確認"), "none");
  await userEvent.click(screen.getByLabelText("骨を除く"));
  await userEvent.selectOptions(screen.getByLabelText("食べる量"), "small");
  await userEvent.type(screen.getByLabelText("苦手食材を追加"), "ねぎ{enter}");
  await userEvent.selectOptions(screen.getByLabelText("辛さ"), "none");
  await userEvent.click(screen.getByLabelText("小さめ"));
  expect(api.updateMember).toHaveBeenCalled();
  expect(api.addDislike).toHaveBeenCalledWith(expect.any(String), "ねぎ");
  expect(api.invalidateSafety).toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent("最新条件で再確認します");
});

it("keeps account deletion out of the household settings owner", async () => {
  render(<SettingsHarness api={completeSettingsApi()} />);
  expect(await screen.findByRole("heading", { name: "家族設定" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "アカウントを削除" })).not.toBeInTheDocument();
});
```

Extend `e2e/fixtures/auth.ts`, keep the first compile-time consumer in `e2e/specs/onboarding.spec.ts`, and create `e2e/specs/settings.spec.ts` for the second full editor journey:

```ts
test("completed fixture opens the protected planner", async ({ completedOnboardingPage: page }) => {
  await expect(page).toHaveURL(/\/planner$/u);
  await expect(page.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();
});

test("adds, fully edits, and deletes a household member without owning account deletion",
  async ({ completedOnboardingPage: page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/settings");
    await page.getByRole("button", { name: "家族を追加" }).click();
    await page.getByRole("button", { name: "この家族の設定を完了" }).click();
    await expect(page.getByRole("alert")).toContainText("年齢区分を選んでください");
    await expect(page.getByLabel("年齢区分")).toBeFocused();
    await page.getByLabel("呼び名").fill("子ども");
    await page.getByLabel("年齢区分").selectOption("age_3_5");
    await page.getByLabel("アレルギーの確認").selectOption("registered");
    await page.getByRole("button", { name: "くるみを追加" }).click();
    await page.getByLabel("対象外の食事の確認").selectOption("none");
    await page.getByLabel("骨を除く").check();
    await page.getByLabel("食べる量").selectOption("small");
    await page.getByLabel("苦手食材を追加").fill("ねぎ");
    await page.getByRole("button", { name: "苦手食材を追加" }).click();
    await page.getByLabel("辛さ").selectOption("none");
    await page.getByLabel("小さめ").check();
    await page.getByRole("button", { name: "この家族の設定を完了" }).click();
    await expect(page.getByRole("status")).toContainText("最新条件で再確認します");
    await page.getByLabel("自由登録名").fill("えんどう豆たんぱく");
    await page.getByLabel("標準候補に該当しないことを確認").check();
    await page.getByRole("button", { name: "自由登録を追加" }).click();
    await page.getByRole("button", { name: "くるみを削除" }).click();
    await page.getByRole("button", { name: "子どもを削除" }).click();
    await page.getByRole("button", { name: "家族だけを削除" }).click();
    await expect(page.getByText("子ども")).not.toBeVisible();
    await expect(page.getByRole("button", { name: "アカウントを削除" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
```

- [ ] **Step 2: Run the focused tests and verify RED (3 minutes)**

Run:

```bash
node --test tests/tooling/project-config.test.mjs tests/tooling/compose.test.mjs
npm test -- --run src/shared/lib/supabase.test.ts src/features/auth/auth-flow.test.ts src/features/auth/auth-gateway.test.ts src/features/auth/auth-callback-page.test.tsx netlify/functions/_shared/auth-continuation-crypto.test.ts netlify/functions/auth-continuation-create.test.ts netlify/functions/auth-continuation-deposit.test.ts netlify/functions/auth-continuation-claim.test.ts src/features/household/allergy-editor.test.tsx src/features/household/household-api.test.ts src/features/household/household-settings-page.test.tsx
npm run db:test -- supabase/tests/database/002_household_rls.test.sql supabase/tests/database/004_auth_continuations.test.sql
npm run e2e -- e2e/specs/onboarding.spec.ts e2e/specs/settings.spec.ts
```

Expected on the reviewed pre-correction branch: configuration/auth tests report missing canonical origin, exact `config.path`, param-only IDs, state-bound claim, fixed storage ownership, or valid outer limit. On a fresh execution that already followed Task 7's forward reference to this final contract, those cases may already be green; the aggregate command must still remain RED at the first missing complete-member/dislike CRUD, selected-allergy removal, full settings field, invalidation, accessible error, completed fixture, or `/settings` journey. Do not implement Step 4 until at least one new product-behavior assertion has failed for the expected reason.

- [ ] **Step 3: Implement PKCE state binding and the single-use continuation (5 minutes)**

Implement this continuation boundary as part of Task 7, before Task 8 calls `createAuthFlow`; Task 13 supplies the final adversarial gate.

Create `20260711000330_auth_continuations.sql`:

```sql
create table private.auth_continuations (
  id uuid primary key default gen_random_uuid(),
  state_hash bytea not null check (octet_length(state_hash)=32),
  secret_hash bytea not null check (octet_length(secret_hash)=32),
  origin text not null check (origin ~ '^https?://[^/]+$'),
  return_to text not null check (return_to ~ '^/[^/]' and char_length(return_to)<=500),
  encrypted_code bytea,
  code_iv bytea check (code_iv is null or octet_length(code_iv)=12),
  deposited_at timestamptz,
  claimed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  check ((encrypted_code is null)=(code_iv is null)),
  check (claimed_at is null or encrypted_code is null)
);
revoke all on private.auth_continuations from public, anon, authenticated;

create or replace function public.claim_auth_continuation(
  p_id uuid, p_state_hash bytea, p_secret_hash bytea, p_origin text, p_now timestamptz
) returns table(encrypted_code bytea, code_iv bytea, return_to text)
language plpgsql security definer set search_path=''
as $$
declare v private.auth_continuations%rowtype;
begin
  select * into v from private.auth_continuations where id=p_id for update;
  if not found or v.state_hash<>p_state_hash or v.secret_hash<>p_secret_hash or v.origin<>p_origin or
     v.expires_at<=p_now or v.claimed_at is not null or v.encrypted_code is null then return; end if;
  update private.auth_continuations set claimed_at=p_now, encrypted_code=null, code_iv=null where id=p_id;
  return query select v.encrypted_code,v.code_iv,v.return_to;
end $$;
revoke all on function public.claim_auth_continuation(uuid,bytea,bytea,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.claim_auth_continuation(uuid,bytea,bytea,text,timestamptz)
  to service_role;
```

The same migration defines these service-role-only transitions:

```sql
create or replace function public.cleanup_auth_continuations(p_now timestamptz)
returns bigint language plpgsql security definer set search_path='' as $$
declare n bigint;
begin delete from private.auth_continuations where expires_at<=p_now; get diagnostics n=row_count; return n; end $$;

create or replace function public.create_auth_continuation(
  p_state_hash bytea,p_secret_hash bytea,p_origin text,p_return_to text,p_now timestamptz,
  p_ttl_seconds integer
) returns table(id uuid,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  if p_ttl_seconds <> 300 then
    raise exception 'invalid continuation ttl' using errcode='22023';
  end if;
  perform public.cleanup_auth_continuations(p_now);
  return query insert into private.auth_continuations as c
    (state_hash,secret_hash,origin,return_to,created_at,expires_at)
    values(p_state_hash,p_secret_hash,p_origin,p_return_to,p_now,
      p_now+make_interval(secs => p_ttl_seconds))
    returning c.id,c.expires_at;
end $$;

create or replace function public.deposit_auth_continuation(
  p_id uuid,p_state_hash bytea,p_origin text,p_ciphertext bytea,p_iv bytea,p_now timestamptz
) returns boolean language plpgsql security definer set search_path='' as $$
declare changed_count bigint;
begin
  update private.auth_continuations set encrypted_code=p_ciphertext,code_iv=p_iv,deposited_at=p_now
   where id=p_id and state_hash=p_state_hash and origin=p_origin and expires_at>p_now
     and claimed_at is null and deposited_at is null;
  get diagnostics changed_count=row_count;
  if changed_count=1 then return true; end if;
  -- A deposit replay is opaque and never overwrites ciphertext.
  return exists(select 1 from private.auth_continuations where id=p_id and state_hash=p_state_hash
    and origin=p_origin and expires_at>p_now and deposited_at is not null and claimed_at is null);
end $$;

revoke all on function public.cleanup_auth_continuations(timestamptz),
  public.create_auth_continuation(bytea,bytea,text,text,timestamptz,integer),
  public.deposit_auth_continuation(uuid,bytea,text,bytea,bytea,timestamptz)
  from public,anon,authenticated;
grant execute on function public.cleanup_auth_continuations(timestamptz),
  public.create_auth_continuation(bytea,bytea,text,text,timestamptz,integer),
  public.deposit_auth_continuation(uuid,bytea,text,bytea,bytea,timestamptz)
  to service_role;
```

The pgTAP file proves table/grants, the exact five-argument claim signature, `p_ttl_seconds=300` giving exact five-minute expiry while any other value is rejected, wrong claim state/origin/secret, wrong deposit state, first-deposit-wins, one successful claim, replay returning zero rows, ciphertext/IV nulling after claim, and cleanup deleting expired ciphertext. `create_auth_continuation` calls cleanup before every insert; handlers may also call the expiry-only cleanup after any unavailable claim. Wrong credentials never delete a still-live row, avoiding an unauthenticated denial-of-service, while the 20-per-60-second outer limit and exact five-minute TTL bound create spam and expired ciphertext retention.

`netlify/functions/_shared/env.ts` parses exactly `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SERVER_SITE_ORIGIN`, `AUTH_CONTINUATION_ENCRYPTION_KEY`, and `AUTH_CONTINUATION_TTL_SECONDS`; the TTL is the exact integer `300`. It exports `parseManagedSupabaseProjectRef`, which accepts only the exact raw string `https://<20 lowercase-alphanumeric characters>.supabase.co` and therefore rejects credentials, explicit ports, a trailing slash, paths, queries, fragments, arbitrary HTTPS hosts, and suffix lookalikes. `SERVER_SITE_ORIGIN` is an origin with no path/query/hash, permits HTTP only for exact local `http://127.0.0.1:5173`, and otherwise requires HTTPS; the local site requires exact Function URL `http://kong:8000`, while every non-local site requires the managed origin above. Plan 6 independently parses the browser origin, requires its project ref and publishable key to equal the server values, and passes that same ref into maintenance URL validation. The decoded encryption key is exactly 32 bytes. `AUTH_CONTINUATION_ENCRYPTION_KEY` is server-only and any `VITE_AUTH_CONTINUATION_ENCRYPTION_KEY` key in the source object is rejected. `auth-continuation-crypto.ts` imports WebCrypto and uses AES-256-GCM with a random 12-byte IV and associated data `${continuationId}\n${origin}`. Only `deposit` encrypts and only a successful atomic claim decrypts. Parser errors and logs contain closed codes only; they never echo a URL, project ref, key, or Zod input.

All three fetch-style Functions require `Origin === SERVER_SITE_ORIGIN === stored origin`, `content-type: application/json`, a body under 8 KiB, and exact `.strict()` Zod schemas. Create accepts `{ state, secret, returnTo }`, hashes state/secret with SHA-256, passes `AUTH_CONTINUATION_TTL_SECONDS` to `create_auth_continuation`, and returns `{ id, expiresAt }`. Deposit parses the UUID only from `context.params.continuationId`, accepts body `{ state, code }`, validates code length 1–2,048, encrypts it, and returns 204. Claim parses the UUID only from `context.params.continuationId`, accepts body `{ secret, state }`, hashes both, atomically compares both hashes plus origin, decrypts, and returns `{ code, returnTo }`. Malformed params/bodies, including a body `id`, return the standard closed `400 invalid_request`; every well-shaped unknown, wrong-state, wrong-secret, wrong-origin, expired, or replayed request returns the indistinguishable `404 continuation_unavailable`.

Each Function exports its own typed config; the 20-per-60-second value is only an outer unauthenticated flood ceiling and is within Netlify's 180-second maximum:

```ts
import type { Config } from "@netlify/functions";

// auth-continuation-create.ts
export const config: Config = {
  path: "/api/auth/continuations", method: "POST",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip"] },
};

// auth-continuation-deposit.ts
export const config: Config = {
  path: "/api/auth/continuations/:continuationId/callback", method: "POST",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip"] },
};

// auth-continuation-claim.ts
export const config: Config = {
  path: "/api/auth/continuations/:continuationId/claim", method: "POST",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip"] },
};
```

The create default export has signature `(request: Request) => Promise<Response>`. Deposit and claim have signature `(request: Request, context: Context) => Promise<Response>`, parse `z.string().uuid().parse(context.params.continuationId)` before database access, and pass that parsed value to their internal transition. Claim calls `claim_auth_continuation` with exact `{ p_id, p_state_hash: sha256(body.state), p_secret_hash: sha256(body.secret), p_origin, p_now }`. They do not fall back to a query string, body field, or Function filename route.

The final browser contract is:

```ts
import { z } from "zod";

const authFlowSchema = z.object({
  id: z.string().uuid(), secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/u), origin: z.string().url(),
  returnTo: z.string().startsWith("/"), startedAt: z.string().datetime({ offset: true }),
}).strict();
export type AuthFlow = {
  id: string; secret: string; state: string; origin: string;
  returnTo: string; startedAt: string;
};
export type FlowDeps = {
  randomBytes(size?: number): Uint8Array;
  now(): Date;
};
export const browserFlowDeps: FlowDeps = {
  randomBytes: (size = 32) => crypto.getRandomValues(new Uint8Array(size)),
  now: () => new Date(),
};
export const ownedAuthStoragePrefixes = [
  "kondate.auth.flow.", "kondate.auth.supabase",
] as const;
const flowPrefix = ownedAuthStoragePrefixes[0];

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
export function sanitizeReturnPath(value: string | null | undefined): string {
  if (value === undefined || value === null || !value.startsWith("/") || value.startsWith("//")) {
    return "/planner";
  }
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.origin === window.location.origin
      ? `${parsed.pathname}${parsed.search}${parsed.hash}` : "/planner";
  } catch { return "/planner"; }
}
export function buildAuthCallbackUrl(origin: string, flow: Pick<AuthFlow,"id"|"state">): string {
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.origin !== origin) throw new Error("invalid app origin");
  const callback = new URL("/auth/callback", parsedOrigin);
  callback.searchParams.set("flow", flow.id);
  callback.searchParams.set("state", flow.state);
  return callback.href;
}
export function readAuthFlow(id: string, storage: Storage): AuthFlow | null {
  const key = `${flowPrefix}${id}`;
  const raw = storage.getItem(key);
  if (raw === null) return null;
  try {
    const parsed = authFlowSchema.safeParse(JSON.parse(raw));
    if (parsed.success && parsed.data.id === id) return parsed.data;
  } catch { /* delete below */ }
  storage.removeItem(key);
  return null;
}
export function clearAuthFlow(id: string, storage: Storage = window.localStorage): void {
  storage.removeItem(`${flowPrefix}${id}`);
}
export function listUnexpiredAuthFlows(
  storage: Storage, now: Date, ttlMs = 300_000,
): AuthFlow[] {
  const result: AuthFlow[] = [];
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => key?.startsWith(flowPrefix) === true);
  for (const key of keys) {
    const id = key.slice(flowPrefix.length);
    const flow = readAuthFlow(id, storage);
    if (flow === null) continue;
    const age = now.getTime() - new Date(flow.startedAt).getTime();
    if (!Number.isFinite(age) || age < 0 || age > ttlMs) clearAuthFlow(id, storage);
    else result.push(flow);
  }
  return result.toSorted((left, right) => left.startedAt.localeCompare(right.startedAt));
}
export function clearOwnedAuthStorage(storage: Storage): void {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => key !== null);
  for (const key of keys) {
    if (ownedAuthStoragePrefixes.some((prefix) => key.startsWith(prefix))) storage.removeItem(key);
  }
}
export interface ContinuationApi {
  create(input: { state: string; secret: string; returnTo: string }): Promise<{ id: string; expiresAt: string }>;
  deposit(continuationId: string, input: { state: string; code: string }): Promise<void>;
  claim(continuationId: string, input: { secret: string; state: string }): Promise<{ code: string; returnTo: string }>;
}

const createResponseSchema = z.object({ id: z.string().uuid(),
  expiresAt: z.string().datetime({ offset: true }) }).strict();
const claimResponseSchema = z.object({ code: z.string().min(1).max(2_048),
  returnTo: z.string() }).strict();
const successEnvelope = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({ ok: z.literal(true), data: schema }).strict();

export function createContinuationApi(fetchImpl: typeof fetch = fetch): ContinuationApi {
  const post = async <T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> => {
    const response = await fetchImpl(path, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const value: unknown = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error("continuation_unavailable");
    return successEnvelope(schema).parse(value).data;
  };
  return {
    create: (input) => post("/api/auth/continuations", input, createResponseSchema),
    async deposit(continuationId, input) {
      const response = await fetchImpl(
        `/api/auth/continuations/${encodeURIComponent(continuationId)}/callback`,
        { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(input) },
      );
      if (response.status !== 204) throw new Error("continuation_unavailable");
    },
    claim: (continuationId, input) => post(
      `/api/auth/continuations/${encodeURIComponent(continuationId)}/claim`,
      input, claimResponseSchema,
    ),
  };
}

export async function createAuthFlow(returnTo: string, api: ContinuationApi,
  storage: Storage, deps: FlowDeps = browserFlowDeps): Promise<AuthFlow> {
  const secret=base64url(deps.randomBytes(32)), state=base64url(deps.randomBytes(32));
  const created=await api.create({ state,secret,returnTo:sanitizeReturnPath(returnTo) });
  const flow=authFlowSchema.parse({ id:created.id,secret,state,origin:window.location.origin,
    returnTo:sanitizeReturnPath(returnTo),startedAt:deps.now().toISOString() });
  storage.setItem(`${flowPrefix}${flow.id}`,JSON.stringify(flow));
  return flow;
}
```

The code above is the complete owned `auth-flow.ts` contract; no helper named there is left to another task. `createContinuationApi(fetchImpl=fetch)` POSTs exact bodies to exact paths, URL-encodes the separately supplied `continuationId`, parses the standard success envelope with Zod, and never serializes `id`, `origin`, a verifier, or a token into JSON. `completeCallback` calls `continuationApi.deposit(flowId,{state,code})`; `resumeFlow` loads the local `AuthFlow` and calls `continuationApi.claim(flow.id,{secret:flow.secret,state:flow.state})`.

Pass `storage: window.localStorage` explicitly to Supabase so the library-owned verifier remains in the original browser. `completeCallback` rejects every non-empty fragment, requires `flow/state/code`, deposits code through the param-only callback route before reading local storage, and returns `deposited/original_browser` when no secret is present. If the flow is local it calls `resumeFlow(id)`, which sends the locally stored secret and state to the param-only claim route. Supabase production mode exchanges the returned code with `exchangeCodeForSession`; local mock mode exchanges it once at the canonical mock origin and signs into local GoTrue with the returned fixture credentials. Both delete local secret/state after terminal exchange. `AuthProvider` polls pending flow IDs on focus/visibility and every two seconds until the parsed browser TTL expires, so an isolated deposit is claimed by the original browser. Neither path calls `setSession`.

Implement that recovery loop in `auth-continuation-recovery.ts`; it enumerates only `kondate.auth.flow.*` records, deletes malformed/expired records, and serializes claims so StrictMode cannot claim twice:

```ts
export function startAuthContinuationRecovery(input: {
  gateway: Pick<AuthGateway,"resumeFlow">; storage: Storage;
  onComplete(result: Extract<AuthCallbackResult,{kind:"complete"}>): void;
  ttlMs?: number; now?: () => Date; setInterval?: typeof window.setInterval;
}): () => void {
  let running=false, stopped=false;
  const poll=async () => {
    if (running || stopped) return; running=true;
    try {
      for (const flow of listUnexpiredAuthFlows(input.storage,
        input.now?.() ?? new Date(),input.ttlMs ?? 300_000)) {
        const result=await input.gateway.resumeFlow(flow.id);
        if (result.kind==="complete") { input.onComplete(result); break; }
      }
    } finally { running=false; }
  };
  const timer=(input.setInterval ?? window.setInterval)(() => void poll(),2_000);
  const wake=() => void poll();
  window.addEventListener("focus",wake); document.addEventListener("visibilitychange",wake);
  void poll();
  return () => { stopped=true; clearInterval(timer); window.removeEventListener("focus",wake);
    document.removeEventListener("visibilitychange",wake); };
}
```

`AuthProvider` starts this once with the same client/gateway, passes `getPublicEnv().authContinuationTtlMs` as `ttlMs`, and calls `refreshSession()` plus same-origin navigation only on `complete`. The test mounts under StrictMode, deposits once, fires focus/visibility/timer concurrently, and asserts one claim and one code exchange.

The isolated callback renders `元のブラウザでログインを続けてください。この画面に認証情報は保存されません`; same-browser success navigates only after claim+exchange. Unknown fragments, wrong state/origin/secret, expiry, and replay render a generic retry without revealing whether a continuation exists.

- [ ] **Step 4: Implement the reusable allergy editor and full household settings boundary (5 minutes)**

Extend Task 9's typed repository instead of adding settings-only Supabase calls. The same patch shape is used for a draft or a complete member, but the two functions keep their status guards explicit:

```ts
export type MemberDislikeRow = Tables<"member_dislikes">;
export type HouseholdMemberPatch = Pick<TablesUpdate<"household_members">,
  "display_name" | "age_band" | "portion_size" | "spice_level" |
  "ease_preferences" | "required_safety_constraints" | "allergy_status" |
  "unsupported_diet_status" | "unsupported_diet_kinds">;
export type HouseholdDraftPatch = HouseholdMemberPatch;

export async function updateCompleteHouseholdMember(client: BrowserSupabaseClient,
  userId: string, memberId: string, patch: HouseholdMemberPatch): Promise<HouseholdMemberRow> {
  const { data, error } = await client.from("household_members").update(patch)
    .eq("id", memberId).eq("user_id", userId).eq("status", "complete")
    .select("*").single();
  if (error !== null) throw dataError("家族設定を保存できませんでした");
  return data;
}
export async function deleteHouseholdMember(client: BrowserSupabaseClient,
  userId: string, memberId: string): Promise<void> {
  const { error } = await client.from("household_members").delete()
    .eq("id", memberId).eq("user_id", userId);
  if (error !== null) throw dataError("家族を削除できませんでした");
}
export async function listMemberDislikes(client: BrowserSupabaseClient,
  userId: string, memberId: string): Promise<MemberDislikeRow[]> {
  const { data, error } = await client.from("member_dislikes").select("*")
    .eq("user_id", userId).eq("member_id", memberId).order("created_at");
  if (error !== null) throw dataError("苦手食材を読み込めませんでした");
  return data;
}
export async function addMemberDislike(client: BrowserSupabaseClient,
  userId: string, memberId: string, ingredientName: string): Promise<MemberDislikeRow> {
  const normalized = ingredientName.normalize("NFKC").trim();
  if (normalized.length < 1 || normalized.length > 80) {
    throw dataError("苦手食材は1〜80文字で入力してください");
  }
  const input: TablesInsert<"member_dislikes"> = {
    user_id: userId, member_id: memberId, ingredient_name: normalized,
  };
  const { data, error } = await client.from("member_dislikes").insert(input).select("*").single();
  if (error !== null) throw dataError("苦手食材は1〜80文字で重複なく登録してください");
  return data;
}
export async function deleteMemberDislike(client: BrowserSupabaseClient,
  userId: string, dislikeId: string): Promise<void> {
  const { error } = await client.from("member_dislikes").delete()
    .eq("id", dislikeId).eq("user_id", userId);
  if (error !== null) throw dataError("苦手食材を削除できませんでした");
}
```

`household-api.test.ts` proves every update/delete includes both `id` and `user_id`, complete updates include `status='complete'`, draft updates retain `status='draft'`, dislike names are NFKC-trimmed, 1–80 characters, and duplicate errors receive field-specific Japanese copy. `002_household_rls.test.sql` proves another user cannot update/delete a complete member, allergy, or dislike. Deleting the final owned member is allowed as a family-data operation, but the empty state immediately requires adding a member and cannot generate a menu; it never implies account deletion.

Both `HouseholdOnboardingApi` and the complete settings API expose the same allergy operations. The settings API also owns member and dislike operations and one injected invalidator:

```ts
export interface HouseholdSettingsApi {
  listMembers(): Promise<HouseholdMemberRow[]>;
  createDraft(sortOrder: number): Promise<HouseholdMemberRow>;
  updateDraft(memberId: string, patch: HouseholdMemberPatch): Promise<HouseholdMemberRow>;
  updateMember(memberId: string, patch: HouseholdMemberPatch): Promise<HouseholdMemberRow>;
  completeMember(memberId: string): Promise<HouseholdMemberRow>;
  deleteMember(memberId: string): Promise<void>;
  listCatalog(): Promise<AllergenCatalogRow[]>;
  listAllergies(memberId: string): Promise<MemberAllergyRow[]>;
  addStandardAllergy(memberId: string, allergenId: string): Promise<MemberAllergyRow>;
  addCustomAllergy(memberId: string, name: string, aliases: readonly string[]): Promise<MemberAllergyRow>;
  removeAllergy(allergyId: string): Promise<void>;
  listDislikes(memberId: string): Promise<MemberDislikeRow[]>;
  addDislike(memberId: string, name: string): Promise<MemberDislikeRow>;
  removeDislike(dislikeId: string): Promise<void>;
  invalidateSafety(): Promise<void>;
}
```

Create one explicit safety invalidation contract in `household-queries.ts`. Mutation handlers first update or invalidate the directly changed member/allergy/dislike query, then await this helper before announcing success:

```ts
export const householdSafetyChangedEvent = "kondate:household-safety-changed" as const;
export const householdSafetyRevisionStorageKey =
  "kondate:household-safety-revision" as const;
export const householdSafetyQueryPrefixes = {
  currentSafety: ["current-safety"], menuResult: ["menu-result"],
  history: ["history"], historyRevalidation: ["history-revalidation"],
  generation: ["generation"], shopping: ["shopping"],
} as const;
export async function invalidateHouseholdSafetyDependents(
  queryClient: QueryClient, userId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: householdKeys.members(userId) }),
    ...Object.values(householdSafetyQueryPrefixes)
      .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  ]);
  try {
    localStorage.setItem(householdSafetyRevisionStorageKey, crypto.randomUUID());
  } catch {
    // Current-tab query invalidation still prevents a stale action when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(householdSafetyChangedEvent));
}
```

The revision value contains no user or household data. The `storage` event covers other tabs; the custom event covers the current tab. Plans 3–5 subscribe to this contract or their invalidated prefix, mark visible results/history/shopping derivations stale, and require current-safety revalidation before cooking, regeneration, or shopping actions are enabled.

Create `AllergyEditor` as a controlled component. `filterAllergenCatalog()` NFKC-normalizes the query and searches all 29 rows. Its standard path stores only `allergen_id`. Its custom form accepts one 1–80-character name plus at most 10 unique 1–80-character aliases, shows normalized standard matches before the checkbox `標準候補に該当しないことを確認`, and enables `自由登録を追加` only after that confirmation and only when there is no exact standard match. Render selected rows separately:

```tsx
<ul aria-label="選択済みアレルギー">
  {props.allergies.map((allergy) => {
    const name = allergy.allergen_id === null
      ? allergy.custom_name
      : props.catalog.find((row) => row.id === allergy.allergen_id)?.display_name;
    const displayName = name ?? "表示名を確認できない項目";
    return <li key={allergy.id}>{displayName}
      <button type="button" aria-label={`${displayName}を削除`}
        onClick={() => void props.remove(allergy.id)}>削除</button>
    </li>;
  })}
</ul>
```

Do not permit the final selected allergy to be removed while a complete member remains `allergy_status='registered'`; show `登録ありの場合は1つ以上選んでください`. The user may add a replacement first or explicitly change the status to `none`/`unconfirmed`. A catalog query error shows `標準項目を読み込めませんでした` and never converts the attempted standard selection into custom data.

`HouseholdSettingsPage` loads complete members and any one in-progress draft. `家族を追加` creates a draft, exposes the same required-field completion flow, and calls `completeMember` only after age, allergy, and unsupported-diet requirements pass. Existing complete members use `updateMember`, never a replacement draft. Its closed form schema contains every editable field:

```ts
export const householdSettingsSchema = z.object({
  displayName: z.string().trim().min(1).max(30).nullable(),
  ageBand: z.enum(ageBands),
  allergyStatus: z.enum(allergyStatuses),
  unsupportedDietStatus: z.enum(unsupportedDietStatuses),
  unsupportedDietKinds: z.array(z.enum(unsupportedDietKinds)).max(3),
  requiredSafetyConstraints: z.array(z.enum(requiredSafetyConstraints)).max(2),
  portionSize: z.enum(portionSizes),
  spiceLevel: z.enum(spiceLevels),
  easePreferences: z.array(z.enum(easePreferences)).max(3),
}).strict().superRefine((value, ctx) => {
  if (value.unsupportedDietStatus === "present" && value.unsupportedDietKinds.length === 0)
    ctx.addIssue({ code: "custom", path: ["unsupportedDietKinds"], message: "該当する項目を選んでください" });
  if (value.unsupportedDietStatus !== "present" && value.unsupportedDietKinds.length !== 0)
    ctx.addIssue({ code: "custom", path: ["unsupportedDietKinds"], message: "対象外状態と項目を確認してください" });
});

export type HouseholdSettingsValue = z.infer<typeof householdSettingsSchema>;
export type HouseholdFieldErrors = Partial<Record<keyof HouseholdSettingsValue, string>>;
export function toHouseholdFieldErrors(error: z.ZodError<HouseholdSettingsValue>): HouseholdFieldErrors {
  const result: HouseholdFieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path.at(0);
    if (typeof field !== "string" || !(field in householdSettingsSchema.shape)) continue;
    const key = field as keyof HouseholdSettingsValue;
    if (result[key] === undefined) {
      result[key] = issue.message;
    }
  }
  return result;
}
```

Render display name, age, allergy status/editor, unsupported status/kinds, required constraints, portion, dislikes, spice, and ease inside labelled `fieldset` groups. Each control has a stable `<label>`, 44-pixel target, `aria-invalid`, and field-specific `aria-describedby`; the first invalid control receives focus and an error summary uses `role="alert"`. Save state uses `aria-live="polite"`. Member deletion uses a labelled confirmation dialog with `家族だけを削除`; it never offers account deletion. Successful safety/preference changes show the stale/revalidation notice; failed changes retain the user's values and show the relevant field error rather than a generic toast.

Use the same `AllergyEditor` from `HouseholdOnboardingForm` whenever `allergy_status === "registered"`. Replace only the `/settings` placeholder in `src/app/router.tsx`:

```tsx
import { HouseholdSettingsPage } from "@/features/household/household-settings-page";
{ path: "/settings", element: <HouseholdSettingsPage /> },
```

Historical tables introduced later must preserve member/allergen/source display snapshots and use nullable deletion-safe member references; settings member deletion cannot be converted into account deletion or blocked by historical rows.

- [ ] **Step 5: Lift the completed-onboarding fixture and prove the green state (5 minutes)**

Replace the fixture type and add the dependent fixture in `e2e/fixtures/auth.ts`:

```ts
type AuthFixtures = {
  authEmail: string;
  authenticatedPage: Page;
  completedOnboardingPage: Page;
};

completedOnboardingPage: async ({ authenticatedPage: page }, use) => {
  await completeMinimumOnboarding(page);
  await page.getByRole("checkbox", { name: /説明を確認しました/u }).check();
  await page.getByRole("button", { name: "確認して進む" }).click();
  await expect(page).toHaveURL(/\/planner$/u);
  await use(page);
},
```

Use `completedOnboardingPage` in Plan 2–6 specs that start on protected product pages. Do not call `completeMinimumOnboarding` again in those tests.

Run:

```bash
node --test tests/tooling/project-config.test.mjs tests/tooling/compose.test.mjs
npm run format:check
npm test -- --run tools/oauth-mock/server.test.mjs src/shared/config/public-env.test.ts src/shared/lib/supabase.test.ts src/features/auth src/features/household
npm test -- --run netlify/functions/_shared/auth-continuation-crypto.test.ts netlify/functions/auth-continuation-create.test.ts netlify/functions/auth-continuation-deposit.test.ts netlify/functions/auth-continuation-claim.test.ts
npm run db:reset
npm run db:test -- supabase/tests/database/002_household_rls.test.sql supabase/tests/database/004_auth_continuations.test.sql
npm run db:types
npm run typecheck
npm run lint
npm run e2e -- e2e/specs/oauth-mock.spec.ts e2e/specs/auth-recovery.spec.ts e2e/specs/onboarding.spec.ts e2e/specs/settings.spec.ts
npm run build
docker compose config --quiet
rg -n 'path: "/api/auth/continuations|windowLimit: 20|windowSize: 60' netlify/functions/auth-continuation-*.ts
rg -n 'authContinuationTtlMs: number|export type FlowDeps|browserFlowDeps|listUnexpiredAuthFlows|createContinuationApi|resumeFlow:' src/shared/config/public-env.ts src/features/auth
rg -n 'VITE_AUTH_PROVIDER_MODE|VITE_OAUTH_MOCK_ORIGIN|oauth-mock:|127\.0\.0\.1:8788' compose.yaml .env.example scripts/generate-local-secrets.mjs src/shared/config src/features/auth tools/oauth-mock
rg -n 'parseManagedSupabaseProjectRef|\[a-z0-9\]\{20\}|abcdefghijklmnopqrst\.supabase\.co' netlify/functions/_shared/env.ts netlify/functions/_shared/env.test.ts src/shared/config/public-env.ts src/shared/config/public-env.test.ts
! rg -n 'SUPABASE_URL:\s*z\.string\(\)\.url\(\)' netlify/functions/_shared/env.ts src/shared/config/public-env.ts
rg -n 'http://local(host)|windowSize:\s*(?:18[1-9]|19[0-9]|[2-9][0-9]{2,})|deposit\(input:\s*\{\s*id|claim\(input:\s*\{\s*id' playwright.config.ts compose.yaml .env.example supabase/config.toml scripts/generate-local-secrets.mjs netlify/functions src/features/auth
! rg -n 'authContinuationTtlMs:\s*300_000;|createAuthFlow\([^,]+,[^,]+\)|VITE_AUTH_PROVIDER_MODE=oauth_mock' src tools netlify --glob '!**/*.test.*'
git diff --check
```

Expected: every build/test/config command exits 0; the route search finds all three exact paths and all three valid 20/60 outer limits; the type-level search finds the complete owned auth helpers and every `AuthGateway` double includes `resumeFlow`; the OAuth search finds one exact local mode/origin/service; the managed-origin search finds the canonical 20-character project-ref parser in both production boundaries and their negative tests, while the negative schema search proves neither executable Supabase URL schema uses generic `z.string().url()`. Obsolete literal-TTL typing, two-argument flow creation, production mock mode, localhost, body IDs, oversized windows, arbitrary production Supabase hosts, path-bearing URLs, and suffix lookalikes are absent. Generated types contain the five-argument state-bound claim RPC. The database proves exact five-minute expiry, cleanup, and one atomic claim; wrong claim state/secret/origin and replay reveal no code. The Compose OAuth provider proves success and cancel redirect through the app with bound flow/state and no token URL, while production parsing rejects it. The isolated WebView only deposits, the original browser claims with local state+secret and exchanges once, and neither path calls `setSession`. Supabase uses `kondate.auth.supabase`; cleanup removes only the two exported auth prefixes and preserves unrelated keys. Onboarding and settings share the 29-item editor; settings add/edit/delete a member, expose all required fields and selected-allergy removal, invalidate safety-dependent queries, retain accessible field errors at 320 px, omit account deletion, and the completed fixture lands on `/planner` with current consent.

- [ ] **Step 6: Commit the reviewed foundation corrections (2 minutes)**

```bash
git add package.json package-lock.json playwright.config.ts compose.yaml .env.example \
  scripts/generate-local-secrets.mjs supabase/config.toml \
  tests/tooling/project-config.test.mjs tests/tooling/compose.test.mjs \
  supabase/tests/database/002_household_rls.test.sql \
  supabase/migrations/20260711000330_auth_continuations.sql \
  supabase/tests/database/004_auth_continuations.test.sql \
  src/shared/config src/shared/lib/supabase.test.ts src/shared/lib/supabase.ts \
  src/shared/types/database.generated.ts netlify/functions src/features/auth \
  src/features/household src/app/router.tsx tools/oauth-mock e2e/fixtures/auth.ts e2e/specs
git commit -m "fix: harden auth continuation and household settings"
```

Expected: one correction commit is created only after Step 5 is green; no unrelated path is staged.

## Execution Notes

- Execute Tasks 1–13 in order; each existing commit boundary is a review gate and must pass its focused verification before the next task starts. Task 13 is the mandatory final correction gate; do not hand off to Plan 2 before it passes.
- Local and normal CI Google journeys use only Compose `oauth-mock` at `http://127.0.0.1:8788`; local GoTrue's external Google provider stays disabled and no real Google credential is required. Production must set `VITE_AUTH_PROVIDER_MODE=supabase`, omit `VITE_OAUTH_MOCK_ORIGIN`, enable the managed Supabase Google provider with explicit HTTPS callbacks, and pass Plan 6 preflight. Real Google success is tested only on the same-SHA staging candidate under Plan 6.
- The official Supabase vendor refresh is allowed only by explicitly running `./scripts/vendor-supabase.sh --refresh`; the short-commit check prevents a moved tag from silently changing local infrastructure.
- Plan 1 owns the first custom Functions and minimal `_shared/env.ts`, `_shared/http.ts`, and `_shared/supabase-admin.ts` for the server-backed auth continuation. Plan 2 extends these same files with `requireUser`, `HttpError`, `json`, `methodNotAllowed`, `parseJson`, and `handleError`; it must not create a conflicting second helper contract.
- Plan 3 adds `_shared/supabase-user.ts` `createUserScopedSupabase(accessToken: string): SupabaseClient<Database>`, consumes `privacyNoticeVersion`, and independently queries `privacy_consents` before any OpenRouter call. Browser consent state is never sufficient authorization.
