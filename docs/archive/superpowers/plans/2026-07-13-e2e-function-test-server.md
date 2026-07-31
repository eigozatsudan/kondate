# E2E Function Test Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Plan 1 browser E2E tests without `@netlify/vite-plugin`'s failing local Function runner while preserving the production Netlify Function path.

**Architecture:** In E2E mode, a Node HTTP server at `127.0.0.1:5174` loads the existing TypeScript Function modules through Vite SSR and dispatches requests from each module's exported `config`. Vite proxies `/api` to that server and configures Netlify with `functions: { enabled: false }`; normal development remains unchanged.

**Tech Stack:** Node.js 24, Node HTTP, Fetch API, Vite SSR module loader and proxy, Netlify Vite plugin, Node test runner, Docker Compose, Playwright.

## Global Constraints

- Use Node.js `>=24 <25`, ESM, strict TypeScript, 2-space indentation, double quotes, and semicolons.
- The public app origin remains `http://127.0.0.1:5173`; the E2E-only Function server listens only at `http://127.0.0.1:5174`.
- `KONDATE_E2E_FUNCTION_SERVER=1` is the sole E2E-mode switch. It is set only by `compose.e2e.yaml`, which overrides the existing `app` service when it is explicitly passed after `compose.yaml`; ordinary Compose commands omit the override.
- Route method and path must be derived from every Function module's exported `config`; do not duplicate Function paths in the test server.
- Log only the fixed error code, HTTP method, and path. Never log request/response bodies, headers, exception messages, or stacks.
- Do not alter `netlify.toml`, production Function modules, Supabase configuration, or generated files.
- Run Node and test commands through Docker as specified by `CLAUDE.md`; do not claim E2E success without its actual Playwright output.

---

## File Structure

```text
tools/
├── e2e-function-server.mjs          # HTTP adapter, config-derived routing, Vite SSR module loader
├── e2e-function-server.test.mjs     # Node tests for routing, response conversion, and safe logging
└── run-e2e-app.mjs                  # supervises test server and Vite; forwards termination
tests/tooling/compose.test.mjs        # exact E2E override environment and command assertions
vite.config.ts                        # E2E proxy plus selective Netlify Function disablement
compose.e2e.yaml                      # app's E2E-only command/environment override
```

### Task 1: Config-Derived Function HTTP Adapter

**Files:**
- Create: `tools/e2e-function-server.mjs`
- Create: `tools/e2e-function-server.test.mjs`

**Interfaces:**
- Produces: `createE2eFunctionServer({ loadModule, logger }): Promise<http.Server>`.
- `loadModule(path: string)` resolves a module with `config: { path: string; method: string }` and `default(request: Request, context: { params: Record<string, string | undefined> }): Promise<Response>`.
- `logger.error({ code: "e2e_function_handler_failed", method: string, path: string }): void` receives no user-controlled data except the method and matched URL pathname.

- [ ] **Step 1: Write the failing adapter tests**

```js
import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createE2eFunctionServer } from "./e2e-function-server.mjs";

const routes = new Map([
  ["/netlify/functions/auth-continuation-create.ts", { config: { path: "/api/auth/continuations", method: "POST" }, default: async (request) => Response.json({ origin: request.headers.get("origin"), contentType: request.headers.get("content-type"), body: await request.text() }) }],
  ["/netlify/functions/auth-continuation-deposit.ts", { config: { path: "/api/auth/continuations/:continuationId/callback", method: "POST" }, default: async () => new Response(null, { status: 204 }) }],
  ["/netlify/functions/auth-continuation-claim.ts", { config: { path: "/api/auth/continuations/:continuationId/claim", method: "POST" }, default: async (_request, context) => Response.json(context.params) }],
]);

async function withServer(loadModule, run) {
  const server = await createE2eFunctionServer({ loadModule, logger: { error() {} } });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await run(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

test("routes from exported config, forwards required request fields, and passes route params", async () => {
  await withServer(async (path) => routes.get(path), async (origin) => {
    const createResponse = await fetch(`${origin}/api/auth/continuations`, { method: "POST", headers: { origin: "http://127.0.0.1:5173", "content-type": "application/json" }, body: '{"state":"test"}' });
    assert.deepEqual(await createResponse.json(), { origin: "http://127.0.0.1:5173", contentType: "application/json", body: '{"state":"test"}' });
    const claimResponse = await fetch(`${origin}/api/auth/continuations/11111111-1111-4111-8111-111111111111/claim`, { method: "POST" });
    assert.deepEqual(await claimResponse.json(), { continuationId: "11111111-1111-4111-8111-111111111111" });
  });
});

test("returns 404 when config has no matching method and logs no secret on handler failure", async () => {
  const entries = [];
  const server = await createE2eFunctionServer({
    loadModule: async () => ({ config: { path: "/api/auth/continuations", method: "POST" }, default: async () => { throw new Error("secret-code"); } }),
    logger: { error: (entry) => entries.push(entry) },
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${origin}/api/auth/continuations`, { method: "GET" })).status, 404);
    assert.equal((await fetch(`${origin}/api/auth/continuations`, { method: "POST", body: "secret-code" })).status, 500);
    assert.deepEqual(entries, [{ code: "e2e_function_handler_failed", method: "POST", path: "/api/auth/continuations" }]);
  } finally { server.close(); }
});
```

- [ ] **Step 2: Run the tests to verify RED**

Run: `docker compose run --rm --no-deps app node --test tools/e2e-function-server.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `tools/e2e-function-server.mjs`.

- [ ] **Step 3: Implement the minimal adapter**

Implement `tools/e2e-function-server.mjs` with these rules:

```js
const functionModulePaths = [
  "/netlify/functions/auth-continuation-create.ts",
  "/netlify/functions/auth-continuation-deposit.ts",
  "/netlify/functions/auth-continuation-claim.ts",
];

export async function createE2eFunctionServer({ loadModule, logger }) {
  const modules = await Promise.all(functionModulePaths.map(loadModule));
  // config.path と config.method から安全に matcher を作り、:continuationId だけをparamsへ渡す。
  // Node受信リクエストの全ヘッダーと本文をFetch Requestへ転記する。GET/HEADには本文を渡さない。
  // Responseのヘッダーと本文をそのままNode応答へ書き戻す。
  // handler例外時のlogger.error引数は、固定code・request.method・new URL(request.url).pathnameだけに限定する。
}
```

The module must also export `startE2eFunctionServer()` which creates a Vite server in middleware mode, calls `vite.ssrLoadModule` for every path above, and listens on exactly `127.0.0.1:5174`.

- [ ] **Step 4: Run the focused tests to verify GREEN**

Run: `docker compose run --rm --no-deps app node --test tools/e2e-function-server.test.mjs`

Expected: PASS; both tests pass with no secret-bearing output.

- [ ] **Step 5: Commit Task 1**

```bash
git add tools/e2e-function-server.mjs tools/e2e-function-server.test.mjs
git commit -m "feat: E2E用関数テストサーバーを追加"
```

### Task 2: E2E Process Supervision and Vite Routing

**Files:**
- Create: `tools/run-e2e-app.mjs`
- Create: `compose.e2e.yaml`
- Modify: `vite.config.ts`
- Modify: `tests/tooling/compose.test.mjs`

**Interfaces:**
- Consumes: `startE2eFunctionServer(): Promise<{ close(): Promise<void> }>` from `tools/e2e-function-server.mjs`.
- Produces: E2E-overridden `app` process with Vite on `127.0.0.1:5173` and its `/api` proxy target fixed to `http://127.0.0.1:5174`.

- [ ] **Step 1: Write failing configuration tests**

Add this Node test to `tests/tooling/compose.test.mjs`:

```js
test("uses the isolated E2E Function server without changing the public origin", async () => {
  const [compose, composeE2e, viteConfig, runner] = await Promise.all([
    readFile("compose.yaml", "utf8"),
    readFile("compose.e2e.yaml", "utf8"),
    readFile("vite.config.ts", "utf8"),
    readFile("tools/run-e2e-app.mjs", "utf8"),
  ]);
  assert.doesNotMatch(compose, /KONDATE_E2E_FUNCTION_SERVER/u);
  assert.match(composeE2e, /KONDATE_E2E_FUNCTION_SERVER: "1"/u);
  assert.match(composeE2e, /command: \["node", "tools\/run-e2e-app\.mjs"\]/u);
  assert.match(viteConfig, /functions: \{ enabled: !isE2eFunctionServer \}/u);
  assert.match(viteConfig, /target: "http:\/\/127\.0\.0\.1:5174"/u);
  assert.match(runner, /SIGTERM/u);
  assert.match(runner, /SIGINT/u);
});
```

- [ ] **Step 2: Run the test to verify RED**

Run: `docker compose run --rm --no-deps app node --test tests/tooling/compose.test.mjs`

Expected: FAIL because `tools/run-e2e-app.mjs` does not exist and E2E configuration is absent.

- [ ] **Step 3: Implement the E2E-only process path**

Implement `tools/run-e2e-app.mjs` to start `startE2eFunctionServer()`, spawn `npm run dev -- --host 0.0.0.0`, forward `SIGINT` and `SIGTERM` to the Vite child, and close the Function server before exit. It must never print environment values.

In `vite.config.ts`, define `const isE2eFunctionServer = process.env.KONDATE_E2E_FUNCTION_SERVER === "1";`, set `netlify({ functions: { enabled: !isE2eFunctionServer } })`, and add `proxy` inside the existing `server` object beside `host` and `port`:

```ts
proxy: isE2eFunctionServer
  ? { "/api": { target: "http://127.0.0.1:5174", changeOrigin: true } }
  : undefined,
```

Create `compose.e2e.yaml` with only an `app` service override containing `KONDATE_E2E_FUNCTION_SERVER: "1"` and `command: ["node", "tools/run-e2e-app.mjs"]`. Do not duplicate or modify the base service's build, port mapping, dependencies, volumes, tmpfs, or healthcheck, and do not create `app-e2e`. Keep the existing `e2e` service dependency on `app`.

- [ ] **Step 4: Run focused verification to verify GREEN**

Run:

```bash
docker compose run --rm --no-deps app node --test tests/tooling/compose.test.mjs
docker compose run --rm --no-deps app node --test tools/e2e-function-server.test.mjs
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

Expected: every command exits 0.

- [ ] **Step 5: Commit Task 2**

```bash
git add compose.e2e.yaml vite.config.ts tests/tooling/compose.test.mjs tools/run-e2e-app.mjs
git commit -m "fix: E2Eで関数テストサーバーを経由する"
```

### Task 3: Live Stack E2E Verification

**Files:**
- Modify: `.superpowers/sdd/progress.md`

**Interfaces:**
- Consumes: the E2E app startup path from Task 2 and the existing Playwright specs.
- Produces: observed E2E status recorded honestly in the ignored progress ledger.

- [ ] **Step 1: Start the complete local stack**

Run: `docker compose -f compose.yaml -f compose.e2e.yaml --profile e2e up -d --wait`

Expected: the E2E-overridden `app`, Supabase, Mailpit, OAuth mock, and OpenRouter mock are healthy; the one app healthcheck reaches `http://127.0.0.1:5173`.

- [ ] **Step 2: Run the previously blocked browser specifications**

Run: `docker compose -f compose.yaml -f compose.e2e.yaml --profile e2e run --rm e2e e2e/specs/oauth-mock.spec.ts e2e/specs/auth-recovery.spec.ts e2e/specs/onboarding.spec.ts e2e/specs/settings.spec.ts`

Expected: all selected Playwright tests pass; no `ECONNREFUSED` appears for a random loopback port.

- [ ] **Step 3: Record the result without secrets**

Update the Plan 1 Task 13 line in `.superpowers/sdd/progress.md` with the exact command and pass/fail summary. Do not include tokens, URLs containing credentials, email addresses, request bodies, or raw error text.

- [ ] **Step 4: Review and commit Task 3**

Run: `git diff --check && git status --short`

Expected: only the Task 3 ledger change is untracked/modified; if E2E fails, do not claim completion or create a success commit. If it passes, the ignored ledger is intentionally not committed.

## Plan Self-Review

- Scope coverage: Task 1 implements config-derived routing, HTTP conversion, and safe logging. Task 2 supplies the exact mode switch, ports, proxy, selective Netlify disablement, and process lifecycle. Task 3 runs the required live E2E verification and records the observed result.
- Placeholder scan: no TBD/TODO markers or unspecified routes, ports, environment names, or commands remain.
- Type consistency: Task 1 produces `startE2eFunctionServer`; Task 2 consumes it. Both use `KONDATE_E2E_FUNCTION_SERVER=1` and `127.0.0.1:5174`.
