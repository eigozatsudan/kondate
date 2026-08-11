# 敵対的レビュー: ローカル専用運用管理コンソール 実装

- **役割:** 独立 adversarial reviewer（実装著者コンテキスト非共有・read-only。本ファイルのみ書込）
- **日付:** 2026-08-11
- **Worktree:** `/home/dev/projects/kondate/.worktrees/local-ops-admin-console`
- **Diff 正本:** `/tmp/admin-impl-review/full.diff`
- **照合 spec:** [`docs/superpowers/specs/2026-08-11-local-ops-admin-console-design.md`](../specs/2026-08-11-local-ops-admin-console-design.md)
- **照合 plan:** [`docs/superpowers/plans/2026-08-11-local-ops-admin-console.md`](../plans/2026-08-11-local-ops-admin-console.md)
- **攻撃焦点:** Host/token/method バイパス、SQLi / `SELECT *` / 禁止列 JSON 漏洩、READ ONLY canary 偽 green、RLS/GRANT・pgTAP 空 `lives_ok`、feedback body 常時返却、billing Stripe ID、Docker root/秘密、静的 path traversal、session_user vs pooler、日付範囲、compose `env_file` 欠落

---

## Summary

実装は設計案 A（`kondate_ops_readonly` SELECT 専用 LOGIN、Host allowlist、GET のみ、列列挙 SQL、`BEGIN READ ONLY`、Session 5432 fail-closed、feedback RLS policy、`.env.admin` ignore、compose loopback publish、`USER node`）の **大半を正しく具体化**している。plan 敵対で BLOCK だった C1（feedback RLS）と C2（username prefix）は **実装で反証可能**。billing は Stripe 列を SELECT せず、feedback 全文は `includeBody=1` 明示時のみ、Docker イメージに `.env.admin` を焼かない。

一方、静的配信が `@hono/node-server` の `serveStatic({ root })` を **パス封じ込めなし**で載せており、Node の `path.join(root, absoluteRequestPath)` が root を捨てるため、**loopback 到達だけで `/proc/self/environ` 等の任意読取 → `ADMIN_DATABASE_URL` / token 漏洩**が成立し得る。これは token 有無に依存しない（token は `/api/*` のみ）。脅威モデル「同一マシンの他 UID / マルウェア」に対し、filtered API より遥かに重い credential theft になる。

加えて pgTAP の `plan(20)` と実テスト数の不一致、DML/RPC 拒否の網羅不足、DTO/sql-guard の自己参照・列網羅不足が **検証の false-green / red 混在**を残す。

**総合判定: `BLOCK`**

Critical 1 件（静的 LFI → 秘密漏洩）を修するまで PROCEED 不可。修後は Important を消化すれば `PROCEED`（設計受容残差: token 任意・共有 PC 禁止・監査ログなしは残る）。

---

## Verdict

| 項目 | 値 |
| --- | --- |
| **判定** | **`BLOCK`** |
| **Critical** | **1** |
| **Important** | **5** |
| **Minor（参考）** | 3 |
| **解除条件** | C1 修了（静的 root 封じ込め + 回帰テスト）。I1–I3 は同 PR 推奨、I4–I5 は follow-up 可 |

---

## Attack table

| # | 攻撃シナリオ | 判定 | 根拠 |
| --- | --- | --- | --- |
| 1 | Host spoof / DNS rebinding で `/api/*` を外から読む | **反証（API）** | `middleware/host.ts`: `Host` exact `127.0.0.1:${port}` / `localhost:${port}` 以外 400。`app.test.ts` で evil Host を固定。 |
| 2 | POST/PUT で書込 API | **反証** | `apiGetOnly`: `/api/*` は GET/HEAD 以外 405。業務ルートは `app.get` のみ。 |
| 3 | `ADMIN_LOCAL_TOKEN` 未設定時の loopback GET | **設計受容残差** | token null なら API 開放。spec §6.1/§9。**ただし C1 により token 設定時も静的経由で秘密が取れる**（下記）。 |
| 4 | SQL 注入で任意 SELECT/DML | **反証（実装）** | 全業務クエリは `$n` bind。識別子連結なし。`withReadOnly` のみ。 |
| 5 | `SELECT *` / `identity_key` / Stripe ID が JSON に出る | **現行クエリは反証 / ガード不完全** | billing/generations/feedback は列列挙。sql-guard は `stripe_price_id` 未禁止（I3）。DTO 自己テストは偽 green（I2）。 |
| 6 | feedback detail が常に `body` 全文 | **反証** | `getFeedback`: `includeBody` 時のみ `body` 列 SELECT。mapper は `body: includeBody ? … : null`。 |
| 7 | READ ONLY canary が書込可能でも green | **部分反証** | CREATE TEMP 失敗 + `has_table_privilege(INSERT)` on `ai_generation_requests`。**UPDATE/DELETE/他表/RPC は未検査**（I4）。任意例外→ writeBlocked は稀な偽 green 経路。 |
| 8 | RLS: ops が feedback 0 行 / pgTAP `lives_ok` 偽 green | **反証（本線）** | migration に `user_feedback_ops_readonly_select … USING (true)`。pgTAP `isnt_empty` + seed。private の `lives_ok` は権限エラー検知用で、RLS 表の行可視は feedback のみ必須。 |
| 9 | GRANT 穴で INSERT/EXECUTE | **部分反証** | migration は SELECT のみ。pgTAP は INSERT 2 表 + maintenance EXECUTE。**6 表 UPDATE/DELETE と他書込 RPC 未契約**（I4）。`plan(20)` vs 実 22 本でスイート自体が壊れている（I1）。 |
| 10 | Docker root / 秘密をイメージに焼く | **反証** | `USER node`、context `./admin`、`admin/.dockerignore` に `.env*`、runtime は `dist` + prod deps。`env_file` はランタイムのみ。 |
| 11 | 静的 path traversal / 任意ファイル読取 | **成立（Critical）** | C1。`path.join(root, c.req.path)` が絶対 path で root を破棄。token 非適用。 |
| 12 | pooler username / `session_user` 取り違え | **概ね反証** | URL: exact bare or `role.<20-char-ref>`。startup は実 `session_user` を `isOpsReadonlySessionUser`。**表示用 `sessionUser` は hardcode**（M1）。`current_user` 未検証（I5）。 |
| 13 | 日付範囲未強制で全表 scan | **概ね反証** | list/dashboard/share は `parseJstDateRange`（max 31）。detail by id は仕様どおり。stuck/pending 件数は現行状態定義。 |
| 14 | `compose.admin.yaml` の `env_file: .env.admin` 欠落 | **fail-closed（望ましい）** | Compose は欠落 env_file で起動失敗。秘密なし silent 起動にはならない。 |
| 15 | `postgres` / 6543 / prefix ロール URL | **反証** | `assertDatabaseUrl` + unit。 |
| 16 | `.env.admin` git / root docker context 漏れ | **反証** | `.gitignore` / root `.dockerignore` / tooling `admin-compose.test.mjs`。 |

---

## Findings

### Critical

#### C1. 静的 `serveStatic` が絶対パスで root を破棄し、token 外で任意ファイル（`/proc/self/environ` 含む）を読める

- **信頼度:** 94  
- **箇所:**  
  - `admin/server/src/index.ts` L41–46: `app.use("/*", serveStatic({ root: "./dist/client" }))`  
  - `admin/node_modules/@hono/node-server/dist/serve-static.mjs` L78–90: `filename = c.req.path` → `path.join(root, filename)`。`..` は拒否するが **leading `/` の絶対パスは未拒否**  
  - `admin/server/src/middleware/token.ts` L15–17: token は `/api/*` のみ  
- **攻撃:**  
  1. 同一ホストから（compose の `127.0.0.1:5193` 到達可）  
     `curl -H 'Host: 127.0.0.1:5193' http://127.0.0.1:5193/proc/self/environ`  
  2. Node の `path.join("./dist/client", "/proc/self/environ")` は POSIX で **`/proc/self/environ`**（root 破棄）  
  3. `USER node` でも自プロセス environ は読める → **`ADMIN_DATABASE_URL`（パスワード付き）・`ADMIN_LOCAL_TOKEN` が生漏洩**  
  4. 以降、app の列 allowlist を迂回して `psql` で ops が SELECT 可能な全列（Stripe ID 列を含む表 GRANT）を直接読める  
  5. `ADMIN_LOCAL_TOKEN` 設定済みでも **静的経路は Bearer 不要**のため無効化できない  
- **副次:** 通常アセット要求 `/assets/…` も `join(root, "/assets/…")` → FS ルート側を見に行くため、**本番静的配信自体が壊れている／偶然 SPA フォールバックに依存している**可能性が高い（機能バグ + セキュリティ）。  
- **修正要求（BLOCK 解除必須）:**  
  1. 自前の静的ハンドラにするか、`rewriteRequestPath` で leading `/` を落としたうえで **`path.resolve(root)` 配下であることを `relative`/`startsWith` で fail-closed** する。  
  2. `/api/*` 以外でも **root 外は 404**。可能なら静的は allowlist 拡張子のみ。  
  3. 回帰テスト: `GET /proc/self/environ`・`GET /etc/passwd`・`GET /%2e%2e/…` が 404、正規 `/assets/*` が 200。  
  4. （推奨）プロセス環境に載った DB URL を静的面から隔離する設計メモを docs に1行。

---

### Important

#### I1. pgTAP `plan(20)` と実アサーション 22 本が不一致 — セキュリティスイートが red か、数合わせ false-green の温床

- **信頼度:** 96  
- **箇所:** `supabase/tests/database/ops_readonly_role.test.sql` L4 `select plan(20);` と L5–173 の ok/is/isnt_empty/throws_ok/lives_ok（22 本）  
- **説明:** pgTAP は plan 不一致で fail。db:test を回すと本ファイルが落ち、**ops ロールの安全証明が CI に載らない**。逆に plan だけ 22 に直して不足ケースを足さないと、I4 の穴が固定されない。  
- **修正:** 実本数に合わせた `plan(N)` + I4 の不足ケースを同ファイルで追加。

#### I2. `FORBIDDEN_DTO_KEYS` テストが定数自己参照で、mapper/Zod の実効 strip を証明しない

- **信頼度:** 90  
- **箇所:** `admin/shared/schemas.test.ts` L21–24  
- **説明:** plan 敵対 I2 が未解消。`expect(FORBIDDEN_DTO_KEYS).toContain("identity_key")` は配列リテラルの存在証明に過ぎない。禁止キー付きオブジェクトを parse して出力に残らない／reject されることを assert していない。  
- **修正:** `generationListItemSchema.safeParse({ …合法, identity_key: "x", stripe_customer_id: "cus_x" })` で出力キー集合を検査。mapper 単体も同様。

#### I3. sql-guard が `stripe_price_id`（spec §3.1）を禁止していない

- **信頼度:** 88  
- **箇所:** `admin/server/src/queries/sql-guard.test.ts` FORBIDDEN 配列; spec §3.1  
- **説明:** 現行 `billing.ts` は Stripe 列を SELECT していない（現行リークは反証）。ガードが `stripe_subscription_id` / `customer` / `event` のみで **`stripe_price_id` 欠落**。将来クエリ追加の退行を止めない。  
- **修正:** `/stripe_price_id/i` および可能なら `/stripe_[a-z_]+/i` を追加。

#### I4. 起動 canary / pgTAP が「SELECT 専用」を 1 表 INSERT 中心にしか証明していない

- **信頼度:** 86  
- **箇所:**  
  - `admin/server/src/db.ts` L246–270: CREATE TEMP + `has_table_privilege(…, 'INSERT')` on `ai_generation_requests` のみ  
  - `ops_readonly_role.test.sql`: INSERT 否定は gen + feedback のみ。UPDATE/DELETE なし。書込 RPC は `run_kondate_maintenance` のみ  
- **説明:** migration 現状は SELECT のみなので **現行 GRANT では実害は小さい**。ただし誤 GRANT や将来 migration で billing に UPDATE が付いた場合、canary/pgTAP は緑のまま。spec §7.3/§10.1 の「INSERT 不可」契約として弱い。  
- **修正:** 6 GRANT 表すべてで INSERT/UPDATE/DELETE の `has_table_privilege = false`（または throws_ok）。代表書込 RPC を ≥3。startup も UPDATE 代表 1 本を追加推奨。

#### I5. startup が `current_user` を検証せず、health の `sessionUser` を hardcode

- **信頼度:** 82  
- **箇所:**  
  - `admin/server/src/db.ts` L215–221: `session_user` のみ `isOpsReadonlySessionUser`  
  - `admin/server/src/index.ts` L26: `const sessionUser = "kondate_ops_readonly"`（DB 読取結果を捨てる）  
- **説明:** spec §7.3 は `session_user` / `current_user` 両方。SET ROLE 等で `current_user` がずれる経路は NOINHERIT 下では限定的だが、**表示と canary が実セッションと乖離**するとオペレータが誤接続に気づけない。pooler で `session_user` が bare 以外を返す環境でも UI は常に bare 名。  
- **修正:** startup の実測値を `createApp({ sessionUser })` に渡し、`current_user` も同条件で検証。

---

### Minor（参考・信頼度 &lt; 80 または設計受容）

| ID | 内容 | メモ |
| --- | --- | --- |
| M1 | Bearer 比較が timing-safe でない | ローカル loopback 前提。任意。 |
| M2 | token 未設定警告のみで起動可能 | spec 受容残差。C1 修後も共有 PC 禁止は運用依存。 |
| M3 | 無効 UUID フィルタで PG エラー → 500 closed | 情報漏洩は closed。UX のみ。 |

---

## Refuted attacks（証拠付き）

| 主張 | 反証 |
| --- | --- |
| feedback 本文が常に API に載る | `feedback.ts` 二系統 SQL + `map-feedback.ts` の `includeBody` 分岐 |
| billing が `stripe_*` を JSON 化 | `billing.ts` SELECT 列に Stripe ID なし + Zod `billingSubscriptionRowSchema` |
| Host allowlist 欠落 | `createHostGuard` + tests |
| method フィルタ欠落 | `apiGetOnly` + POST test |
| username prefix 受理（plan C2） | `assertDatabaseUrl` exact + `kondate_ops_readonly_evil` reject test |
| feedback RLS 未設定（plan C1） | migration policy + pgTAP `isnt_empty` |
| 6543 / postgres URL 起動 | unit + assert で reject |
| イメージ root / `.env.admin` bake-in | `USER node`、context `./admin`、dockerignore |
| compose ports の LAN 公開 | `127.0.0.1:5193:5193` + tooling test |
| compose `env_file` 欠落で秘密なし silent 起動 | Compose は欠落で fail（fail-closed） |
| 日付 max 31 未実装 | `parseJstDateRange` + `jst.test.ts` |

---

## 修正優先度（実装者向け）

1. **即時 BLOCK 解除:** C1 静的 path 封じ込め + 回帰テスト  
2. **同 PR 強く推奨:** I1 plan 数修正、I2 DTO 実効テスト、I3 sql-guard `stripe_price_id`  
3. **短い follow-up:** I4 DML/RPC 網羅、I5 session/current_user 実測表示  

---

## メタ

- レビュー種別: **implementation** に対する敵対的レビュー  
- 編集: 本ファイルのみ（product code 不変）  
- 総合: **`BLOCK`** / Critical **1** / Important **5**
