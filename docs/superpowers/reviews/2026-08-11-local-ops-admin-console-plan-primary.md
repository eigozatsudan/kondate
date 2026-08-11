# 1次レビュー: ローカル専用運用管理コンソール Implementation Plan

**対象 Plan:** [`docs/superpowers/plans/2026-08-11-local-ops-admin-console.md`](../plans/2026-08-11-local-ops-admin-console.md)  
**対象 Spec:** [`docs/superpowers/specs/2026-08-11-local-ops-admin-console-design.md`](../specs/2026-08-11-local-ops-admin-console-design.md)  
**照合先（実装が正）:** live tree `/home/dev/projects/kondate`（`supabase/migrations/` / `scripts/provision-maintenance-role.sh` / `docs/deployment/supabase.md` / `package.json` format / `eslint.config.js` / `.gitignore` / `.dockerignore` / `compose.yaml` / `docs/testing/database-access-matrix.md` / `netlify/functions/_shared/maintenance-db.ts` / `shared/contracts/share-quota.ts`）  
**レビュー種別:** Plan 一次レビュー（Spec↔Plan 網羅・Task 順序・欠落ファイル・セキュリティ・TDD 実行可能性・compose 名衝突・provision vs migration LOGIN・root format prune・admin install 経路）  
**レビュー日:** 2026-08-11  
**編集:** なし（read-only。本ファイルのみ成果物）

---

## Summary

Plan は改訂後 Spec（案 A: `kondate_ops_readonly` SELECT 専用 LOGIN、Host allowlist、`SELECT *` 禁止、root tooling 境界、Session 5432 fail-closed、6 画面 API/UI）を **Task 1–9 に概ね落としており**、File map・self-coverage 表・TDD の骨格（tooling → migration/pgTAP → admin package → db helper → Hono → queries → UI → Docker）も実装可能な粒度である。compose project 名の `-admin` 接尾辞、ports `127.0.0.1:5193:5193`、context `./admin`、`.env.admin` の git/docker ignore は live 慣習と整合し、本編 `compose.yaml` サービス名との衝突は見当たらない。

一方、**このまま Task 実行に入るとフィードバック画面が常に空になる Critical** がある。live の `public.user_feedback` は RLS 有効かつ policy が `authenticated, anon` の deny-all のみで、**GRANT SELECT だけでは `kondate_ops_readonly` に行が見えない**（PG の default-deny）。Plan の migration / pgTAP はこれを扱わず、`lives_ok … SELECT … LIMIT 1` は 0 行でも通るため **false-green** になる。加えて (1) provision を「maintenance と同型」と誤記しつつ同一ロール LOGIN 昇格にしている・本番 LOGIN 手順が薄い、(2) root `format` prune が tooling テスト未固定、(3) URL ユーザー名の **prefix 許可が過剰**、(4) Spec が要求する node-pg SSL 1 行固定が Task 4 に無い、(5) admin `npm install` / lock 生成経路が曖昧、が Important。Spec §12 の「最初の Task = migration」からの順序ずれは実用上許容できるが、上記を直すまで **REVISE**。

## Verdict

**REVISE**

- Critical: 1
- Important: 6
- Minor: 3

---

## Findings

### F1 — Severity: Critical

- **Location:** Plan Task 2 migration / pgTAP skeleton; Spec §7.4 GRANT 表 / §5.3 / §10.1
- **Description:** Plan は `grant select on public.user_feedback to kondate_ops_readonly` のみで、**RLS policy を追加しない**。live 実装では:

  - `20260725120000_user_feedback.sql`: `enable row level security`
  - `20260726120000_adversarial_review_fixes.sql`: `user_feedback_deny_all` は **`TO authenticated, anon` のみ**
  - matrix: `on + deny-all policy` / browser none

  PostgreSQL は RLS 有効表で **適用ポリシーが無いロールに default-deny**（表 owner / BYPASSRLS 以外）。Plan ロールは `nobypassrls` のため、ops は GRANT があっても **常に 0 行**。private 表は RLS off のため他画面は動くが、不具合・要望画面と dashboard の feedback 集計が空になる。pgTAP の `lives_ok(SELECT id … LIMIT 1)` は 0 行でも成功し、**権限「可」を偽陽性で固定**する。
- **Suggestion:**
  1. migration に SELECT 専用 policy を追加する。例:
     ```sql
     create policy user_feedback_ops_readonly_select
       on public.user_feedback
       for select
       to kondate_ops_readonly
       using (true);
     ```
     （`FOR ALL` / INSERT/UPDATE/DELETE policy は付けない。）
  2. pgTAP で seed 後に `SET LOCAL ROLE kondate_ops_readonly` → `isnt_empty(...)`（または件数 ≥1）、authenticated の deny が壊れていないことを回帰確認。
  3. matrix の `user_feedback` 行に ops SELECT policy を追記する Task Step を必須化。
- **Status:** open

### F2 — Severity: Important

- **Location:** Plan Task 2 Step 3 provision / Spec §7.4 / live `scripts/provision-maintenance-role.sh` + `docs/deployment/supabase.md` §4
- **Description:** Plan は provision を「**maintenance と同型**」と書くが、live の maintenance は:

  | | maintenance（正） | Plan ops（案） |
  | --- | --- | --- |
  | migration | **NOLOGIN** `kondate_maintenance_executor` のみ | **NOLOGIN** `kondate_ops_readonly` |
  | LOGIN 名 | **別ロール** `kondate_maintenance_login` | **同一ロールを LOGIN 昇格** |
  | 権限の渡し方 | `GRANT executor TO login` | ロール自身が SELECT |
  | ローカル配線 | `ci.sh` / `generate-local-secrets` / `MAINTENANCE_DB_PASSWORD` | **未配線** |
  | 本番手順 | deploy 文書 §4 が CREATE LOGIN を exact 列挙 | Task 2 Step 5 が「5–15 行追記」のみ |

  同一ロール昇格自体は Spec の `session_user = kondate_ops_readonly` と整合し得るが、「同型」誤記は実装者が **二重ロール**（`*_login` + GRANT）に流れて起動 canary が落ちる経路を作る。また migration のみ適用した本番は **NOLOGIN のまま接続不能**で、Dashboard での `ALTER ROLE … LOGIN PASSWORD … CONNECTION LIMIT 4 NOINHERIT` が必須なのに Plan が exact SQL / 秘密の stdin 経路を固定していない。local も `OPS_READONLY_DB_PASSWORD` の secrets 生成・reset 後 re-provision・source テスト（maintenance の `provision-maintenance-role.test.mjs` 相当）が無い。
- **Suggestion:**
  1. 文言を「maintenance と同型」→「**パスワードは migration に含めず、LOGIN 化だけを migration 外 script / 本番 psql で行う（ロール名は単一 `kondate_ops_readonly`）**」に修正。
  2. Task 2 に本番手順の exact 箇条書き（NOLOGIN 作成済み前提の `ALTER ROLE … LOGIN …`、timeout / `default_transaction_read_only`、CONNECTION LIMIT 4、NOINHERIT、パスワード非ログ）を Step 本文に埋め込む。
  3. local: `generate-local-secrets` にパスワード、provision script の呼び出し箇所（docs と任意で reset 後手順）、`provision-ops-readonly-role.test.mjs`（argv に秘密を載せない）を Files に追加。
- **Status:** open

### F3 — Severity: Important

- **Location:** Plan Task 1 tooling test / Spec §4.5 / §10.1 tooling
- **Description:** Spec は root `format` / `format:check` の `find` に `-path './admin' -prune` を **必須**とし、tooling で「root eslint/**format** が admin を prune」と受け入れる。Plan Task 1 の `tests/tooling/admin-compose.test.mjs` は:

  - compose ports / context
  - `git check-ignore .env.admin`
  - `.dockerignore`
  - **eslint `admin/**` のみ**

  を固定し、**`package.json` の format find に admin prune があることの断言が無い**。live の format は:

  ```text
  find . -path './.git' -prune -o -path './node_modules' -prune -o ... -type f (...) -print0
  ```

  prune の挿入位置を誤ると（例: `-type f` の後、`-o` 欠落、`-path 'admin'` で `./admin` に不一致）**admin が本編 format に巻き込まれ続ける**か、逆に意図しないパスが落ちる。Spec が言う `admin/node_modules` 追加 prune は `./admin` 全体 prune なら冗長だが、**機械検証が無い**ことが主問題。
- **Suggestion:** Task 1 テストに例えば次を追加する:

  ```js
  test("root format scripts prune admin", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    for (const key of ["format", "format:check"]) {
      assert.match(pkg.scripts[key], /-path '\.\/admin' -prune/);
    }
  });
  ```

  実装 Step の find 断片は「既存 prune 列の直後・`-type f` より前」と明記したままでよい（`-path './admin' -prune` で配下全体が descend されない点は正しい）。
- **Status:** open

### F4 — Severity: Important

- **Location:** Plan Task 4 URL reject 規則; Spec §7.2
- **Description:** Plan はユーザー名を「`kondate_ops_readonly` で**始まる** / prefix または exact」と書く。pooler 形 `kondate_ops_readonly.<ref>` を許す意図は正しいが、素の `startsWith("kondate_ops_readonly")` は次を **誤受理**し得る:

  - `kondate_ops_readonly_attacker`
  - `kondate_ops_readonlyx`
  - 将来の typo ロール

  Spec 本文は「pooler 接頭辞付きなら **local part が一致**」。maintenance-env の live 検証も **exact role / `role.ref` 形**に近い fail-closed である。
- **Suggestion:** 受理を次に固定する（Task 4 の Interfaces と db.test.ts に RED ケース）:

  - exact: `kondate_ops_readonly`
  - pooler: `/^kondate_ops_readonly\.[A-Za-z0-9]+$/`（project ref 形）
  - それ以外（`postgres` / `postgres.<ref>` / 上記 typo）は reject

  あわせて `rejectUnauthorized` / ssl オプションを **maintenance-db と同じ 1 行方針**（live: connectionString から sslmode を剥がし `ssl: { rejectUnauthorized: false }` 等）を Task 4 本文に書き、Spec §7.2 最終行を満たす。
- **Status:** open

### F5 — Severity: Important

- **Location:** Plan Task 3 Step 2 admin package install; Spec §4.3 / Task 8 Dockerfile `npm ci`
- **Description:** Task 3 は lock 生成を:

  - `cd admin && npm install`（host）
  - または `docker compose run --rm --no-deps -w /workspace/admin app npm install`

  と両論併記し、「Dockerfile 前提の lock を作る」とだけ言う。live の `app` は:

  - 作業ツリー bind: `.:/workspace`
  - **named volume** `node_modules:/workspace/node_modules`（**root のみ**）
  - entrypoint が `LOCAL_UID` へ drop

  のため `/workspace/admin` での install 自体は admin 配下に `node_modules` / lock を書ける一方、(1) host Node と container Node 24 の混在で lock が揺れる、(2) Task 中に **どのコマンドを正とするか**が未固定で Verifier が再現できない、(3) root `app` image に admin 用 devDependencies 解決の前提が無く、失敗時のフォールバックが無い、(4) `admin/eslint` / prettier 設定ファイルが Scripts にあるのに Files に無い、が残る。Task 8 の `npm ci` は **コミット済み package-lock.json** 必須。
- **Suggestion:**
  1. lock 生成の正を **1 本**に固定する。推奨:  
     `docker compose run --rm --no-deps -w /workspace/admin app npm install`  
     （本編 `.env` / `KONDATE_COMPOSE_PROJECT_NAME` 前提を Step に明記。）
  2. `admin/package-lock.json` を commit 対象として Step 4 の `git add` に明示。
  3. Task 3 Files に `admin/eslint.config.js`（および必要なら prettier 設定）を追加するか、`lint` script を後 Task まで持たない。
- **Status:** open

### F6 — Severity: Important

- **Location:** Plan Task 2 pgTAP skeleton; Spec §10.1 DB/pgTAP
- **Description:** Spec の pgTAP 要件は「対象表 SELECT 可・**INSERT 不可**・**auth 不可**・**書き込み RPC 不可**」。Plan 骨格は role 存在 / not superuser / user_feedback SELECT lives_ok / INSERT throws_ok 程度で、`plan(12)` に対し本文が不足し、次が落ちているか曖昧:

  - 全 GRANT 表（private 6 表）の SELECT 可
  - `auth.users` / `auth` schema USAGE 不可
  - `run_kondate_maintenance` 等書き込み RPC の EXECUTE 不可
  - **F1 の「実際に行が読める」**（isnt_empty）
  - `rolcanlogin` は migration 直後 false（NOLOGIN）であることの明示（provision 前後で期待が変わる）

  TDD として RED→GREEN は可能だが、Spec 受け入れを **薄い 4 断言で閉じる**と本番で auth/RPC 穴や feedback 空を逃す。
- **Suggestion:** Task 2 Step 1 に assertion 一覧を exact 列挙（12 または数を実数に合わせる）。最低: 6 表 SELECT、user_feedback isnt_empty after seed、INSERT 42501、auth.users 不可、maintenance RPC 不可、`not rolsuper` / `not rolbypassrls`、statement_timeout / default_transaction_read_only 設定。
- **Status:** open

### F7 — Severity: Important

- **Location:** Plan Task 2 migration 属性; Spec §7.4 ロール属性
- **Description:** Spec §7.4 は `LOGIN NOINHERIT NOSUPERUSER … CONNECTION LIMIT 4` をロール属性として固定。Plan migration は `nologin` で LOGIN/パスワードを避ける方針（良い）だが **`noinherit` を付けず**、`CONNECTION LIMIT` も migration / 共通 ALTER に無い（provision 箇条書きのみ）。NOINHERIT 欠落は将来の誤 `GRANT some_role TO kondate_ops_readonly` 時に権限が継承される面で Spec より弱い。CONNECTION LIMIT 未設定のまま Dashboard で LOGIN だけ有効化すると **接続数上限 4 が効かない**。
- **Suggestion:** migration の `create role` / 既存時 `alter role` に `noinherit` を必ず入れる。CONNECTION LIMIT は LOGIN 化と同時（provision + 本番手順）に exact で固定し、pgTAP で `rolconnlimit = 4`（provision 後）または migration 時点の期待値を文書化。
- **Status:** open

### F8 — Severity: Minor

- **Location:** Plan Task 1 vs Spec §12.2
- **Description:** Spec §12 は「**最初の Task に migration + pgTAP + provision**」と書く。Plan は Task 1 をリポジトリ境界 / compose、Task 2 を migration としており、依存のない tooling を先に置く判断自体は合理的だが Spec 手順文面とは不一致。
- **Suggestion:** Plan 冒頭か Spec coverage 表に「§12 の順序を tooling 境界 → DB ロールに入れ替えた」と 1 行残すか、Task 番号を入れ替えて Spec に合わせる。
- **Status:** open

### F9 — Severity: Minor

- **Location:** Plan Task 6 sql-guard.test.ts
- **Description:** SQL ガードが `select *` / `identity_key` 中心。Spec §3.1 の `request_hmac*` / `stripe_*` / draft・menu_payload 結合も禁止だが、文字列検査リストが狭いと将来クエリ追加時の回帰網が薄い（mapper/Zod と二重化は Task 3 にあるため Critical ではない）。
- **Suggestion:** 禁止トークンに `request_hmac` / `stripe_` / `identity_key` / `menu_payload` / `from auth.` を追加。
- **Status:** open

### F10 — Severity: Minor

- **Location:** Plan Task 6 paging; Spec §5 ページング
- **Description:** Spec は keyset または offset を Plan で 1 つに固定と要求。Plan は `offset` を Interfaces に採用しており決定自体は満たす。深ページのコストは ops 索引（created_at, id）で緩和されるが、offset 固定を coverage 表に明記すると実装者の再議論が減る。
- **Suggestion:** Spec coverage 行に「ページング = offset（keyset なし）」を追記。
- **Status:** open

---

## Spec ↔ Plan coverage（確認済み）

| Spec 領域 | Plan | 判定 |
| --- | --- | --- |
| `kondate_ops_readonly` + 最小 GRANT + ops 索引 | Task 2 | 部分（**F1 RLS / F7 属性**） |
| provision / 本番 LOGIN | Task 2 | 部分（**F2**） |
| `.env.admin` git/docker ignore、context `./admin` | Task 1, 8 | OK |
| root eslint ignore + format prune | Task 1 | 部分（**F3** テスト欠） |
| compose `127.0.0.1:5193:5193`、project `-admin` | Task 1 | OK（本編名と非衝突） |
| URL fail-closed / READ ONLY / canary | Task 4 | 部分（**F4** prefix / SSL 1 行） |
| Host allowlist / GET only / token | Task 5 | OK |
| 6 API・禁止列・日付・上限付近・滞留 15m | Task 6 | OK（sql-guard は F9） |
| 6 UI + feedback 全文明示 | Task 7 | OK |
| Docker 1 プロセス + docs | Task 8 | OK |
| 受け入れ | Task 9 | OK |
| 本編 e2e/CI 非載 | Global Constraints | OK |
| node-pg SSL 方針 1 行 | Task 4 | **欠落（F4 に含む）** |
| admin 独立 package / lock | Task 3 | 部分（**F5**） |

## compose / 名前衝突

- 本編 `compose.yaml`: `name: ${KONDATE_COMPOSE_PROJECT_NAME:?…}`（必須）。サービスに `admin` 無し。
- Plan `compose.admin.yaml`: `name: ${KONDATE_COMPOSE_PROJECT_NAME:-kondate}-admin` → 本編 project と **常に別名**。サービス名 `admin` のみで include/depends_on なし。
- ホスト port `5193` は本編 `5173` と非衝突。
- **問題なし**（追加 Finding なし）。

## root format prune 正しさ

- `-path './admin' -prune` を既存 prune 列の後・`-type f` 前に入れる方針は **find 意味論として正しい**（`./admin` で prune すれば配下は walk されない）。
- 欠落は **機械固定（F3）** と、Spec 表記の冗長な `admin/node_modules` prune（全体 prune なら不要）の説明不足のみ。

## provision vs migration LOGIN

- migration にパスワード / LOGIN を載せない方針は live maintenance と **精神は一致**。
- ロール分割（executor vs login）まで同型ではない（**F2**）。
- 本番は migration 後に **同一名ロールの LOGIN 化**が必須（deploy 文書 exact 化が必要）。

## admin package install path

- `app` コンテナの `/workspace/admin` は bind mount 上で成立し得るが、Plan が host/docker 両論で **正本コマンド未固定（F5）**。
- Dockerfile `npm ci` 前提の lock コミット手順を Task 3 の必須 Step に昇格すべき。

## TDD 実行可能性

- Task 1, 3–6 は RED 例があり実行可能。
- Task 2 は pgTAP 骨格が Spec より薄く、F1 により **GREEN が偽**になり得る。
- Task 7 UI は RED テストがほぼ無く build 中心（第1版として許容余地あり、Minor）。

---

## Residual（受容可・Status 記録のみ）

- 同一マシン他 UID が token 未設定時に GET し得る（Spec 残差）。token 推奨は Task 5/7 で触れ済み。
- 監査ログなし（Spec 対象外）。
- 本編 e2e に admin を載せない（意図的）。
