# ローカル専用運用管理コンソール Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本番（または staging）Postgres を SELECT 専用 LOGIN で読むローカル専用 read-only 運用 UI を `admin/` + `compose.admin.yaml` で提供する。

**Architecture:** (1) migration で `kondate_ops_readonly` と最小 GRANT・ops 索引を入れる (2) Hono BFF が `BEGIN READ ONLY` + 名前付き列列挙 SELECT のみ実行 (3) Vite React が同一 origin で 6 画面を表示 (4) 本編 lint/format から `admin/` を切り離し、秘密は `.env.admin` のみ。

**Tech Stack:** Node 24、Hono、`pg`、Zod、React 19、Vite、Tailwind 4、Vitest、pgTAP、Docker Compose

**Spec:** `docs/superpowers/specs/2026-08-11-local-ops-admin-console-design.md`（レビュー反映・案 A 改訂後）  
**Reviews (spec):** `docs/superpowers/reviews/2026-08-11-local-ops-admin-console-{primary,adversarial,secondary}.md`  
**Reviews (plan):** `docs/superpowers/reviews/2026-08-11-local-ops-admin-console-plan-{primary,adversarial,secondary}.md`（**本改訂は plan 二次 must-fix 反映済み**）

## Global Constraints

- Node.js `>=24 <25`、ESM、TypeScript `strict: true`、境界で `any` 禁止
- ユーザー向け文言は日本語。コードコメント・コミットメッセージは日本語（Conventional Commits）
- Docker: 本編コマンドは `docker compose run --rm --no-deps app <cmd>`。admin は `docker compose -f compose.admin.yaml`。エージェントは `&&` / `;` でコマンド連結しない
- `git push` / 本番 deploy / 破壊的 git は人間の明示指示なしで行わない
- 識別は `user_id` UUID のみ。`identity_key` / email / Stripe ID / `request_hmac*` を SELECT・DTO・画面に出さない
- DB 権限の正は `kondate_ops_readonly`。`postgres` URL での admin 起動は reject
- API は GET のみ。`SELECT *` 禁止。本文 ILIKE 検索は第1版なし
- ホスト ports は `127.0.0.1:5193:5193` 固定。Host allowlist: `127.0.0.1:5193` / `localhost:5193`
- 本編 Netlify / e2e / CI E2E に admin を載せない

## File map

| パス | 責務 |
| --- | --- |
| `supabase/migrations/20260811180000_ops_readonly_role.sql` | ロール・GRANT・RLS policy・索引 |
| `supabase/tests/database/ops_readonly_role.test.sql` | pgTAP（行可視 + DML 拒否） |
| `scripts/provision-ops-readonly-role.sh` | ローカル LOGIN パスワード（単一ロール） |
| `.gitignore` / `.dockerignore` / `admin/.dockerignore` | `.env.admin` 等 |
| `eslint.config.js` / `package.json` format | `admin/**` 除外 |
| `compose.admin.yaml` | admin サービス（project 名は `-admin` 接尾辞） |
| `tests/tooling/admin-compose.test.mjs` | ports / ignore / format prune 契約 |
| `admin/package.json` 他 | 独立パッケージ |
| `admin/shared/schemas.ts` | Zod DTO |
| `admin/server/src/db.ts` | pool + READ ONLY + URL 検証 |
| `admin/server/src/app.ts` | Hono routes + Host |
| `admin/server/src/queries/*.ts` | 名前付き SELECT |
| `admin/client/src/**` | 6 画面 UI |
| `admin/Dockerfile` | 1 プロセス配信 |
| `docs/local-development.md`（短い節） | 起動手順 |
| `.env.admin.example` | キー名のみ |

---

### Task 1: リポジトリ境界と compose 骨格

**Files:**
- Modify: `.gitignore`
- Modify: `.dockerignore`
- Modify: `eslint.config.js`
- Modify: `package.json`（`format` / `format:check` の find に admin prune）
- Create: `compose.admin.yaml`
- Create: `.env.admin.example`
- Create: `admin/.dockerignore`
- Create: `tests/tooling/admin-compose.test.mjs`

**Interfaces:**
- Compose service 名: `admin`
- Compose project 名: `${KONDATE_COMPOSE_PROJECT_NAME:-kondate}-admin`（本編 project と衝突させない。`.env.admin` は DB 秘密専用で project 名の正本ではない）
- Ports 文字列: 正確に `127.0.0.1:5193:5193`
- Env 例キー: `ADMIN_DATABASE_URL`, `ADMIN_PORT`, `ADMIN_BIND_HOST`, `ADMIN_LOCAL_TOKEN`, `ADMIN_ALLOW_INSECURE_LOCAL_DB`

- [ ] **Step 1: 失敗する tooling テストを書く**

`tests/tooling/admin-compose.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";

const root = join(import.meta.dirname, "../..");

test("compose.admin.yaml publishes only loopback 5193", () => {
  const yaml = readFileSync(join(root, "compose.admin.yaml"), "utf8");
  assert.match(yaml, /127\.0\.0\.1:5193:5193/);
  assert.doesNotMatch(yaml, /^\s*-\s*["']?5193:5193["']?\s*$/m);
  assert.match(yaml, /context:\s*\.\/admin/);
});

test(".env.admin is gitignored", () => {
  const out = execFileSync("git", ["check-ignore", "-v", ".env.admin"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.match(out, /\.env\.admin/);
});

test(".dockerignore lists .env.admin", () => {
  const text = readFileSync(join(root, ".dockerignore"), "utf8");
  assert.match(text, /^\.env\.admin$/m);
});

test("eslint ignores admin", () => {
  const text = readFileSync(join(root, "eslint.config.js"), "utf8");
  assert.match(text, /admin\/\*\*/);
});

test("root format scripts prune ./admin", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const key of ["format", "format:check"]) {
    assert.match(pkg.scripts[key], /'-path' ['"]\.\/admin['"] '-prune'| -path '\.\/admin' -prune /);
  }
});

test("admin/.dockerignore exists for build context", () => {
  const text = readFileSync(join(root, "admin/.dockerignore"), "utf8");
  assert.match(text, /\.env/);
  assert.match(text, /node_modules/);
});
```

（format prune の assert は実装後の実際の find 文字列に合わせてよいが、**`./admin` と `prune` の両方が format / format:check に含まれること**は必須。）

- [ ] **Step 2: テスト実行（失敗を確認）**

Run: `docker compose run --rm --no-deps app node --test tests/tooling/admin-compose.test.mjs`  
Expected: FAIL（compose / ignore 未整備）

- [ ] **Step 3: 境界ファイルを実装**

`.gitignore` に追加（コメント付き）:

```gitignore
# admin 本番 DB URL。`.env` だけでは一致しない
.env.admin
```

ルート `.dockerignore` に `.env.admin` を追加（root context 用の保険）。

**必須:** `admin/.dockerignore`（`build.context: ./admin` ではルート `.dockerignore` は使われない）:

```
node_modules
dist
.env
.env.*
*.log
```

`eslint.config.js` の `ignores` に `"admin/**"`。

`package.json` の `format` / `format:check` の find に、既存 prune と同様の形で  
`-path './admin' -prune -o` を挿入（admin 配下を format 対象外）。

`compose.admin.yaml`:

```yaml
name: "${KONDATE_COMPOSE_PROJECT_NAME:-kondate}-admin"

services:
  admin:
    build:
      context: ./admin
      dockerfile: Dockerfile
    env_file:
      - path: .env.admin
        required: false
    ports:
      - "127.0.0.1:5193:5193"
    restart: "no"
```

（`env_file` の `required: false` が Compose 版で使えない場合は通常の `env_file: [.env.admin]` とし、build のみなら file 無しでよい旨を README に書く。project 名は本編と別。`.env.admin` を project 名解決に使わない。）

`.env.admin.example`:

```bash
# 実値をコミットしない。ユーザーは kondate_ops_readonly の Session pooler URL。
# direct: postgresql://kondate_ops_readonly:[password]@db.[ref].supabase.co:5432/postgres?sslmode=require
# session pooler: postgresql://kondate_ops_readonly.[ref]:[password]@aws-0-….pooler.supabase.com:5432/postgres?sslmode=require
ADMIN_DATABASE_URL=
ADMIN_PORT=5193
ADMIN_BIND_HOST=0.0.0.0
# 推奨: 高エントロピー。設定時は API が Bearer を要求
# ADMIN_LOCAL_TOKEN=
# ローカル Compose DB のみ: ADMIN_ALLOW_INSECURE_LOCAL_DB=1
```

- [ ] **Step 4: テスト再実行**

Run: `docker compose run --rm --no-deps app node --test tests/tooling/admin-compose.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add .gitignore .dockerignore admin/.dockerignore eslint.config.js package.json compose.admin.yaml .env.admin.example tests/tooling/admin-compose.test.mjs
git commit -m "chore(admin): リポジトリ境界と compose.admin 骨格を追加する"
```

---

### Task 2: `kondate_ops_readonly` migration と pgTAP

**Files:**
- Create: `supabase/migrations/20260811180000_ops_readonly_role.sql`
- Create: `supabase/tests/database/ops_readonly_role.test.sql`
- Create: `scripts/provision-ops-readonly-role.sh`
- Modify: `docs/testing/database-access-matrix.md`（ops ロール行を短く追記）
- Modify: `docs/deployment/supabase.md`（§ に ops readonly 用意手順を短く追記）

**Interfaces:**
- Role name: `kondate_ops_readonly`（exact、**単一ロール**。maintenance のような executor/login 二段は使わない）
- Attributes: `NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`、provision 後 `CONNECTION LIMIT 4`
- `statement_timeout`: `15s`
- `default_transaction_read_only`: `on`
- SELECT 対象表（exact）: 下記 6 表のみ
- **Critical:** `public.user_feedback` は RLS 有効のため **`GRANT SELECT` だけでは常に 0 行**。  
  `to kondate_ops_readonly` の `FOR SELECT USING (true)` policy が必須。
- Indexes:
  - `ai_generation_requests_ops_created_id_idx` on `(created_at desc, id desc)`
  - `user_feedback_ops_created_id_idx` on `(created_at desc, id desc)`

- [ ] **Step 1: RED — pgTAP（行可視を必須。`lives_ok(SELECT…)` だけでは不足）**

`ops_readonly_role.test.sql` の必須ケース:

1. ロール存在・`rolsuper=false`・`rolbypassrls=false`・`rolinherit=false`
2. seed: `service_role` または table owner で `user_feedback` に 1 行 insert（既存 test helper に合わせる）
3. `set local role kondate_ops_readonly` 後  
   `isnt_empty('select id from public.user_feedback where id = <seed>', 'ops sees feedback rows under RLS')`
4. 6 表それぞれ: SELECT が permission エラーにならない / 代表列が読める
5. 6 表それぞれ: INSERT（または UPDATE/DELETE のいずれか）が `42501` 等で失敗
6. `set local role kondate_ops_readonly` 後 `auth.users` SELECT が失敗（schema USAGE 無し）
7. 書き込み系 RPC（例: `public.run_kondate_maintenance`）の EXECUTE が失敗
8. `has_table_privilege('kondate_ops_readonly', 'private.ai_generation_requests', 'INSERT')` is false

`lives_ok` のみで「SELECT 可」と断言しないこと。

- [ ] **Step 2: migration を書く**

`20260811180000_ops_readonly_role.sql`:

```sql
-- ローカル運用コンソール用 SELECT 専用ロール（LOGIN パスワードは provision script）
do $body$
begin
  if not exists (select 1 from pg_roles where rolname = 'kondate_ops_readonly') then
    create role kondate_ops_readonly
      nologin
      noinherit
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls;
  end if;
end
$body$;

alter role kondate_ops_readonly set statement_timeout = '15s';
alter role kondate_ops_readonly set default_transaction_read_only = on;

grant usage on schema public to kondate_ops_readonly;
grant usage on schema private to kondate_ops_readonly;

grant select on public.user_feedback to kondate_ops_readonly;
grant select on private.ai_generation_requests to kondate_ops_readonly;
grant select on private.ai_global_daily_usage to kondate_ops_readonly;
grant select on private.billing_subscriptions to kondate_ops_readonly;
grant select on private.billing_webhook_events to kondate_ops_readonly;
grant select on private.share_generalization_jobs to kondate_ops_readonly;

-- RLS: policy 無しだと non-owner は 0 行（false-green の温床）
drop policy if exists user_feedback_ops_readonly_select on public.user_feedback;
create policy user_feedback_ops_readonly_select
  on public.user_feedback
  for select
  to kondate_ops_readonly
  using (true);

create index if not exists ai_generation_requests_ops_created_id_idx
  on private.ai_generation_requests (created_at desc, id desc);

create index if not exists user_feedback_ops_created_id_idx
  on public.user_feedback (created_at desc, id desc);
```

- [ ] **Step 3: provision script（単一ロール LOGIN 化）**

`scripts/provision-ops-readonly-role.sh`:

- 前提: migration 済みで NOLOGIN ロール + GRANT が存在
- 環境変数 `OPS_READONLY_DB_PASSWORD`（なければ `.env`）
- `ALTER ROLE kondate_ops_readonly WITH LOGIN PASSWORD … NOINHERIT CONNECTION LIMIT 4`
- **executor への GRANT はしない**（maintenance と混同しない）
- パスワードを argv / xtrace に載せない
- 成功時 `provision-ops-readonly-role: ok`

**本番手順（docs/deployment/supabase.md に exact で書く）:**

1. migration 適用（ロール NOLOGIN + GRANT + policy + index）
2. 管理者 psql で `ALTER ROLE kondate_ops_readonly WITH LOGIN PASSWORD … CONNECTION LIMIT 4`（stdin 経由）
3. Session pooler URL を  
   `postgresql://kondate_ops_readonly.<project-ref>:<password>@…pooler…:5432/postgres?sslmode=require`  
   で組み立て `.env.admin` のみに保存
4. admin 起動 canary が通ることを確認

- [ ] **Step 4: db-test**

Run: `docker compose --profile test run --rm db-test`  
Expected: `ops_readonly_role` PASS（行可視含む）

- [ ] **Step 5: matrix / deploy 文書を追記**（policy 行・LOGIN 手順・6 表 SELECT only）

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260811180000_ops_readonly_role.sql \
  supabase/tests/database/ops_readonly_role.test.sql \
  scripts/provision-ops-readonly-role.sh \
  docs/testing/database-access-matrix.md \
  docs/deployment/supabase.md
git commit -m "feat(db): 運用閲覧用 kondate_ops_readonly ロールを追加する"
```

---

### Task 3: admin パッケージ骨格と共有 Zod

**Files:**
- Create: `admin/package.json`, `admin/package-lock.json`（`npm install` で生成）
- Create: `admin/tsconfig.json`, `admin/tsconfig.server.json`, `admin/tsconfig.client.json`
- Create: `admin/vitest.config.ts`
- Create: `admin/shared/schemas.ts`
- Create: `admin/shared/schemas.test.ts`
- Create: `admin/server/src/index.ts`（listen の仮）
- Create: `admin/client/index.html`, `admin/client/src/main.tsx`（最小）

**Interfaces（DTO — 後 Task が依存）:**

```ts
// admin/shared/schemas.ts
import { z } from "zod";

export const closedErrorSchema = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
  message: z.string().min(1).max(200),
});

export const generationListItemSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  status: z.enum(["processing", "succeeded", "failed", "constraint_conflict"]),
  requestKind: z.string(),
  failureCode: z.string().nullable(),
  durationMs: z.number().nullable(),
  actualModelIds: z.array(z.string()),
  qualityMode: z.boolean(),
  repairAttempted: z.boolean(),
  userId: z.string().uuid(),
});

// feedbackListItem, dashboardResponse, quotaHealthResponse,
// billingResponse, shareJobsResponse を同様に定義
// 禁止: identityKey, requestHmac, stripe*, email フィールド名をスキーマに置かない

export const FORBIDDEN_DTO_KEYS = [
  "identityKey",
  "identity_key",
  "requestHmac",
  "request_hmac",
  "stripeSubscriptionId",
  "stripe_customer_id",
  "email",
] as const;
```

- [ ] **Step 1: RED — schemas.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { generationListItemSchema, FORBIDDEN_DTO_KEYS } from "./schemas.js";

describe("admin DTOs", () => {
  it("parses a safe generation row", () => {
    const row = {
      id: "11111111-1111-1111-1111-111111111111",
      createdAt: "2026-08-11T00:00:00.000Z",
      status: "succeeded",
      requestKind: "new_menu",
      failureCode: null,
      durationMs: 1200,
      actualModelIds: ["x"],
      qualityMode: false,
      repairAttempted: false,
      userId: "22222222-2222-2222-2222-222222222222",
    };
    expect(generationListItemSchema.parse(row).status).toBe("succeeded");
  });

  it("forbidden keys are listed for mapper guards", () => {
    expect(FORBIDDEN_DTO_KEYS).toContain("identity_key");
    expect(FORBIDDEN_DTO_KEYS).toContain("request_hmac");
  });
});
```

- [ ] **Step 2: admin package を作成し依存を入れる（lock をコミット）**

**Install の正（どれか1つを Task report に記録し、`admin/package-lock.json` を必ずコミット）:**

```bash
docker compose run --rm --no-deps -v "$PWD/admin:/admin" -w /admin node:24-bookworm-slim npm install
```

または worktree ホストに Node 24 がある場合のみ `cd admin && npm install`。  
root `app` イメージの `/workspace` に admin を無理に混ぜて `npm install` しない（本編 lock を汚さない）。

`admin/package.json` scripts:

```json
{
  "name": "kondate-admin",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24 <25" },
  "scripts": {
    "dev": "tsx watch server/src/index.ts",
    "build": "npm run build:client && npm run build:server",
    "build:client": "vite build",
    "build:server": "tsc -p tsconfig.server.json",
    "start": "node dist/server/index.js",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.client.json --noEmit",
    "lint": "eslint .",
    "format:check": "prettier --check ."
  },
  "dependencies": {
    "@hono/node-server": "^1.19.0",
    "@tanstack/react-query": "^5.87.0",
    "hono": "^4.9.0",
    "pg": "8.22.0",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "react-router": "^8.3.0",
    "zod": "^4.1.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@types/pg": "^8.15.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "tsx": "^4.20.0",
    "typescript": "^5.9.0",
    "vite": "^8.0.0",
    "vitest": "^3.2.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "prettier": "^3.6.0",
    "eslint": "^9.35.0"
  }
}
```

（バージョンは実装時に本編 lock と大きく乖離しないよう調整可。）

Run（host または admin 用一時コンテナ）:  
`cd admin && npm install`  
※ Docker 経由が望ましい場合:  
`docker compose run --rm --no-deps -w /workspace/admin app npm install`  
は root の app image 依存。**Task では `admin` 内で `npm ci` できる Dockerfile 前提の lock を作る。**

- [ ] **Step 3: schemas 実装と test PASS**

Run: `cd admin && npm test`（または compose 経由）  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add admin/
git commit -m "feat(admin): パッケージ骨格と共有 DTO スキーマを追加する"
```

---

### Task 4: DB 層 — URL 検証・READ ONLY helper・起動 canary

**Files:**
- Create: `admin/server/src/config.ts`
- Create: `admin/server/src/db.ts`
- Create: `admin/server/src/db.test.ts`
- Create: `admin/server/src/errors.ts`

**Interfaces:**

```ts
// config.ts
export type AdminConfig = {
  databaseUrl: string;
  port: number;
  bindHost: string;
  localToken: string | null;
  allowInsecureLocalDb: boolean;
};
export function loadConfig(env: NodeJS.ProcessEnv): AdminConfig;

// db.ts
export function assertDatabaseUrl(url: string, opts: { allowInsecureLocalDb: boolean }): URL;
export function createPool(config: AdminConfig): pg.Pool;
export function withReadOnly<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T>;
export async function runStartupDbChecks(pool: pg.Pool): Promise<void>;
// runStartupDbChecks:
//  - session_user = kondate_ops_readonly
//  - statement_timeout 確認
//  - BEGIN READ ONLY; SELECT 1
//  - 書込 canary が失敗
//  - has_table_privilege INSERT = false on ai_generation_requests
```

**URL 受理規則（maintenance-env と同型・prefix 禁止）:**

`localLoginUser = "kondate_ops_readonly"` 固定。

- **accept only:**
  1. `username === "kondate_ops_readonly"` かつ direct host 形（local または `db.<ref>.supabase.co`）
  2. `username === "kondate_ops_readonly." + projectRef`（projectRef は **ちょうど 20 文字** `[a-z0-9]{20}`）かつ pooler host（`*.pooler.supabase.com`）
- **reject:** 任意 prefix（例: `kondate_ops_readonly_evil`）、`postgres`、他ロール名、port `6543`
- 本番相当: query `sslmode` が `require|verify-ca|verify-full` 以外 → reject  
  （`allowInsecureLocalDb=true` のときのみ `sslmode=disable` + loopback/docker ホストを許可）
- node-pg: `ssl: { rejectUnauthorized: true }` を本番経路の既定とする（`maintenance-db.ts` に準拠。local insecure フラグ時のみ ssl off）

- [ ] **Step 1: RED — db.test.ts（assertDatabaseUrl）**

```ts
import { describe, it, expect } from "vitest";
import { assertDatabaseUrl } from "./db.js";

describe("assertDatabaseUrl", () => {
  it("rejects transaction pooler port 6543", () => {
    expect(() =>
      assertDatabaseUrl(
        "postgresql://kondate_ops_readonly:x@host:6543/postgres?sslmode=require",
        { allowInsecureLocalDb: false },
      ),
    ).toThrow(/6543/);
  });

  it("rejects postgres superuser name", () => {
    expect(() =>
      assertDatabaseUrl(
        "postgresql://postgres:x@host:5432/postgres?sslmode=require",
        { allowInsecureLocalDb: false },
      ),
    ).toThrow(/kondate_ops_readonly/);
  });

  it("accepts session pooler with exact role.ref username", () => {
    const ref = "abcdefghij1234567890"; // 20 chars
    const u = assertDatabaseUrl(
      `postgresql://kondate_ops_readonly.${ref}:x@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require`,
      { allowInsecureLocalDb: false },
    );
    expect(u.port).toBe("5432");
  });

  it("rejects username prefix abuse", () => {
    expect(() =>
      assertDatabaseUrl(
        "postgresql://kondate_ops_readonly_evil:x@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require",
        { allowInsecureLocalDb: false },
      ),
    ).toThrow(/kondate_ops_readonly/);
  });
});
```

- [ ] **Step 2: 実装して PASS**

`withReadOnly`:

```ts
export async function withReadOnly<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin read only");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    try {
      await client.query("rollback");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}
```

Pool: `connectionString`, `max: 3`, `options: '-c default_transaction_read_only=on'`

- [ ] **Step 3: Commit**

```bash
git add admin/server/src/config.ts admin/server/src/db.ts admin/server/src/db.test.ts admin/server/src/errors.ts
git commit -m "feat(admin): DB URL 検証と READ ONLY ヘルパを追加する"
```

---

### Task 5: Hono app — Host allowlist・GET のみ・token・health

**Files:**
- Create: `admin/server/src/app.ts`
- Create: `admin/server/src/app.test.ts`
- Create: `admin/server/src/middleware/host.ts`
- Create: `admin/server/src/middleware/token.ts`
- Create: `admin/server/src/routes/health.ts`

**Interfaces:**

```ts
export function createApp(deps: {
  pool: Pool;
  config: AdminConfig;
  // query ports injected later; Task 5 は health + 空 404
}): Hono;

// Host: only 127.0.0.1:5193 | localhost:5193 (port は config.port と一致させる)
// Methods other than GET/HEAD on /api/* → 405
// If config.localToken set, require Authorization: Bearer <token> on /api/* except optional /api/health
```

- [ ] **Step 1: RED — app.test.ts with app.request**

```ts
import { describe, it, expect } from "vitest";
import { createApp } from "./app.js";

const baseConfig = {
  databaseUrl: "postgresql://kondate_ops_readonly:x@127.0.0.1:5432/postgres?sslmode=disable",
  port: 5193,
  bindHost: "0.0.0.0",
  localToken: "test-token-32chars-minimum-ok",
  allowInsecureLocalDb: true,
};

describe("createApp security", () => {
  it("rejects bad Host", async () => {
    const app = createApp({ pool: null as never, config: baseConfig, dbReady: false });
    const res = await app.request("http://evil.example/api/health", {
      headers: { host: "evil.example" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects POST", async () => {
    const app = createApp({ pool: null as never, config: baseConfig, dbReady: false });
    const res = await app.request("http://127.0.0.1:5193/api/health", {
      method: "POST",
      headers: { host: "127.0.0.1:5193", authorization: "Bearer test-token-32chars-minimum-ok" },
    });
    expect([404, 405]).toContain(res.status);
  });
});
```

- [ ] **Step 2: 実装 PASS**

- [ ] **Step 3: Commit**

```bash
git add admin/server/src/app.ts admin/server/src/app.test.ts admin/server/src/middleware admin/server/src/routes/health.ts
git commit -m "feat(admin): Host 固定と GET のみの Hono 基盤を追加する"
```

---

### Task 6: クエリと API ルート（6 画面分）

**Files:**
- Create: `admin/server/src/queries/dashboard.ts`
- Create: `admin/server/src/queries/generations.ts`
- Create: `admin/server/src/queries/feedback.ts`
- Create: `admin/server/src/queries/quotaHealth.ts`
- Create: `admin/server/src/queries/billing.ts`
- Create: `admin/server/src/queries/shareJobs.ts`
- Create: `admin/server/src/lib/jst.ts`
- Create: `admin/server/src/lib/map*.ts`（row → DTO）
- Create: `admin/server/src/routes/*.ts`
- Create: `admin/server/src/queries/sql-guard.test.ts`（SQL 文字列に `select *` / `identity_key` が無いこと）

**Interfaces（query 関数）:**

```ts
// jst.ts
export function parseJstDateRange(query: {
  from?: string;
  to?: string;
}): { fromUtc: Date; toUtcExclusive: Date }; // 必須。最大 31 日。缺損時 default 直近 7 日

// generations.ts
export async function listGenerations(
  client: PoolClient,
  filter: {
    fromUtc: Date;
    toUtcExclusive: Date;
    status?: string;
    requestKind?: string;
    failureCode?: string;
    userId?: string;
    limit: number;
    offset: number;
  },
): Promise<GenerationListItem[]>;

export async function getGeneration(client: PoolClient, id: string): Promise<GenerationDetail | null>;
// SELECT 列に identity_key / request_hmac を含めない
```

**上限付近 SQL（exact 意図）:**

```sql
with day_success as (
  select user_id, count(*)::int as success_count
  from private.ai_generation_requests
  where status = 'succeeded'
    and created_at >= $1 and created_at < $2
  group by user_id
),
limits as (
  select distinct on (user_id) user_id, quota_success_limit
  from private.ai_generation_requests
  where created_at >= $1 and created_at < $2
  order by user_id, created_at desc
)
select d.user_id, d.success_count, l.quota_success_limit
from day_success d
join limits l using (user_id)
where d.success_count >= l.quota_success_limit - 1
order by d.success_count desc
limit 50
```

**滞留 share:**

```sql
select count(*)::int
from private.share_generalization_jobs
where status = 'running'
  and coalesce(heartbeat_at, claimed_at) < now() - interval '15 minutes'
```

- [ ] **Step 1: RED — sql-guard.test.ts**

`admin/server/src/queries/*.ts` を **filesystem で読み**（自己参照配列に頼らない）、各ファイルの SQL 文字列に次が **無い**ことを assert:

- `select *` / `SELECT *`（空白差は正規化して検出）
- `identity_key`
- `request_hmac`
- `stripe_subscription_id` / `stripe_customer_id` / `stripe_event_id`
- `auth.users`
- `menu_payload`

- [ ] **Step 2: 各 query を列列挙 SQL で実装し routes に接続**

Routes:

| Path | Handler |
| --- | --- |
| GET `/api/dashboard` | dashboard |
| GET `/api/generations` | list |
| GET `/api/generations/:id` | detail |
| GET `/api/feedback` | list（body は先頭 80 字） |
| GET `/api/feedback/:id` | detail; `includeBody=1` のとき全文 |
| GET `/api/quota-health` | quota |
| GET `/api/billing` | billing |
| GET `/api/share-jobs` | share |

エラー: `{ ok: false, error: { code, message } }` 日本語固定。

- [ ] **Step 3: unit tests PASS**

- [ ] **Step 4: Commit**

```bash
git add admin/server/src/queries admin/server/src/routes admin/server/src/lib
git commit -m "feat(admin): 6 画面分の READ ONLY クエリと API を追加する"
```

---

### Task 7: React クライアント（6 画面）

**Files:**
- Create: `admin/vite.config.ts`
- Create: `admin/client/src/styles.css`
- Create: `admin/client/src/app.tsx`
- Create: `admin/client/src/api/client.ts`
- Create: `admin/client/src/pages/DashboardPage.tsx`
- Create: `admin/client/src/pages/GenerationsPage.tsx`
- Create: `admin/client/src/pages/FeedbackPage.tsx`
- Create: `admin/client/src/pages/QuotaHealthPage.tsx`
- Create: `admin/client/src/pages/BillingPage.tsx`
- Create: `admin/client/src/pages/ShareJobsPage.tsx`
- Create: `admin/client/src/components/Layout.tsx`
- Create: `admin/client/src/components/DataTable.tsx`

**Interfaces:**

```ts
// api/client.ts
export async function apiGet<T>(path: string, init?: RequestInit): Promise<T>;
// credentials same-origin; if VITE_ADMIN_TOKEN は使わない（token は sessionStorage にオペレータが貼る任意 UI か、dev では未使用で Host のみ）
// 第1版: token は手動で Authorization を付ける小さな設定欄（localStorage 禁止推奨、sessionStorage 可）
```

UI 要件:

- ヘッダ: 「本番・閲覧のみ」バッジ、接続 host（`/api/health` または dashboard メタ）、注意文
- ナビ: 6 リンク
- 表 + フィルタ（日付 from/to 必須 UI、既定 7 日）
- feedback 全文はボタン後に `includeBody=1`
- UUID はコピー用テキストのみ

- [ ] **Step 1: Layout + Dashboard を実装し build**

- [ ] **Step 2: 残り 5 ページ**

- [ ] **Step 3: `npm run build` in admin PASS**

- [ ] **Step 4: Commit**

```bash
git add admin/client admin/vite.config.ts
git commit -m "feat(admin): 運用コンソール 6 画面 UI を追加する"
```

---

### Task 8: Dockerfile・server 静的配信・docs

**Files:**
- Create: `admin/Dockerfile`
- Modify: `admin/server/src/index.ts`（startup checks → listen → serve `client` dist）
- Modify: `docs/local-development.md`（「運用管理コンソール」節）
- Modify: `docs/README.md`（1 行リンク）

**Dockerfile 概形:**

```dockerfile
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
USER node
EXPOSE 5193
CMD ["node", "dist/server/index.js"]
```

（client 成果物パスは vite `outDir` と server static root を一致させる。）

`index.ts`:

```ts
const config = loadConfig(process.env);
const pool = createPool(config);
await runStartupDbChecks(pool);
const app = createApp({ pool, config });
// serve static from dist/client
serve({ fetch: app.fetch, hostname: config.bindHost, port: config.port });
```

- [ ] **Step 1: Dockerfile + static serve**

- [ ] **Step 2: docs 追記（起動・共有 PC 禁止・provision・readonly URL）**

- [ ] **Step 3: `docker compose -f compose.admin.yaml build`（URL 無しでも build 可）**

- [ ] **Step 4: Commit**

```bash
git add admin/Dockerfile admin/server/src/index.ts docs/local-development.md docs/README.md
git commit -m "feat(admin): Docker 配信と起動手順を追加する"
```

---

### Task 9: 受け入れ検証と仕上げ

**Files:**
- Modify: 必要ならテスト・README のみ
- Verify: Spec §10.2

- [ ] **Step 1: admin unit**

Run: admin 内 `npm test` / `npm run typecheck`  
Expected: PASS

- [ ] **Step 2: tooling**

Run: `docker compose run --rm --no-deps app node --test tests/tooling/admin-compose.test.mjs`  
Expected: PASS

- [ ] **Step 3: db-test（ロール）**

Run: `docker compose --profile test run --rm db-test`  
Expected: ops_readonly 関連 PASS

- [ ] **Step 4: 手動チェックリストを report に記録**

- [ ] compose ports loopback
- [ ] `git check-ignore -v .env.admin`
- [ ] postgres URL で起動失敗
- [ ] 6 画面 API が空でも 200
- [ ] DTO に禁止キーなし

- [ ] **Step 5: 最終 Commit（あれば）**

```bash
git commit -m "test(admin): 受け入れ検証の不足を補う"
```

---

## Spec coverage (self-review)

| Spec 要件 | Task |
| --- | --- |
| `kondate_ops_readonly` + GRANT + 索引 | 2 |
| `.env.admin` git/docker ignore、context `./admin` | 1, 8 |
| root tooling 境界 | 1 |
| compose `127.0.0.1:5193` | 1 |
| URL fail-closed / READ ONLY / canary | 4 |
| Host allowlist / GET only / token | 5 |
| 6 API + 禁止列 + 日付必須 + 上限付近 + 滞留 15m | 6 |
| 6 UI + feedback 全文明示 | 7 |
| Docker 1 プロセス + docs | 8 |
| 受け入れ | 9 |

## Placeholder scan

TBD / 「後で」なし。SQL・DTO・reject 規則は exact。UI コンポーネントはファイルパス固定、見た目の細部は実装者の Tailwind で可だが必須文言は Task 7 に列挙済み。

## Type consistency

- Role: `kondate_ops_readonly`
- Port: `5193`
- DTO camelCase in JSON; DB snake_case only inside queries/mappers
- Error envelope: `{ ok: false, error: { code, message } }` / success `{ ok: true, data: ... }` に Task 6 で統一

## Plan review must-fix（二次反映済み）

| ID | 反映箇所 |
| --- | --- |
| MF-C1 user_feedback RLS policy + 行可視 pgTAP | Task 2 |
| MF-C2 username exact / role.ref only | Task 4 |
| MF-I1 単一ロール provision・本番 LOGIN 手順 | Task 2 |
| MF-I2 format prune tooling | Task 1 |
| MF-I3 sql-guard が実ファイル読取 | Task 6 |
| MF-I4 `admin/.dockerignore` | Task 1 |
| MF-I5 node-pg TLS | Task 4 |
| MF-I6 6 表 DML + RPC pgTAP | Task 2 |
| MF-I7 NOINHERIT + connection limit | Task 2 |
| MF-I8 admin lock の install 正本 | Task 3 |
| MF-I9 compose project vs `.env.admin` | Task 1 |

---

## Execution

**subagent-driven-development** + **using-git-worktrees** で Task 1 から順に実装。  
各 Task 完了ごとに focused verify と commit。
