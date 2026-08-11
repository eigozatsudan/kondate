# 敵対的レビュー: ローカル専用運用管理コンソール Implementation Plan

- **役割:** 独立 adversarial reviewer（実装・設計改訂の著者ではない。コンテキスト非共有）
- **日付:** 2026-08-11
- **対象 plan:** [`docs/superpowers/plans/2026-08-11-local-ops-admin-console.md`](../plans/2026-08-11-local-ops-admin-console.md)
- **照合 spec:** [`docs/superpowers/specs/2026-08-11-local-ops-admin-console-design.md`](../specs/2026-08-11-local-ops-admin-console-design.md)（案 A 改訂後）
- **照合 live tree:**  
  `supabase/migrations/`（`user_feedback` RLS、private 台帳、maintenance ロール）、  
  `supabase/tests/database/`、`docs/testing/database-access-matrix.md`、  
  `netlify/functions/_shared/maintenance-env.ts` / `maintenance-db.ts`、  
  `scripts/provision-maintenance-role.sh` / `compose-project-name.sh` / `ci.sh`、  
  `package.json` / `eslint.config.js` / `vitest.config.ts` / `.gitignore` / `.dockerignore` / `compose.yaml` / `Dockerfile`
- **攻撃焦点（指示）:** false-green tests、role LOGIN timing、GRANT gaps、SQL injection residual、compose project name vs `.env.admin`、Dockerfile multi-stage secret leak、root CI still eating admin、missing pgTAP for INSERT on private tables、token/host bypass、`identity_key` in SQL by mistake、pooler username parsing bugs、Task ordering（admin before migration）
- **編集範囲:** 本レビューファイルのみ（product code 不変）

---

## Summary

改訂設計（案 A: `kondate_ops_readonly` SELECT 専用 LOGIN、Host allowlist、root tooling 境界、`.env.admin` ignore、Session 5432 fail-closed）を Task 分割した plan は **方向として設計と概ね一致**している。Task 2 で migration + pgTAP、Task 4 で URL/canary、Task 5 で Host/GET、Task 6 で列列挙 SQL と sql-guard、という順序も「権限の正を先に固める」意図は読める。

一方、**live の RLS / GRANT 事実と plan の migration・pgTAP が噛み合っておらず**、実装完了を装うテストが複数 **false-green** になり得る。最重は:

1. **`public.user_feedback` は RLS ON + deny policy（authenticated/anon）**。`GRANT SELECT` だけでは非 owner の `kondate_ops_readonly` に **行が見えない**（default-deny）。plan の `lives_ok(SELECT … LIMIT 1)` は **0 行でも成功**する。
2. **URL ユーザー名検証が maintenance 正本より弱い prefix 許容**になっており、`kondate_ops_readonly*` を受け得る。
3. **pgTAP / unit が「禁止の有無」を証明しきらない**（private 全表の INSERT/UPDATE/DELETE、書き込み RPC EXECUTE、DTO 実効 strip、format prune の実行時契約）。

設計レビューで要求された「SELECT 専用 LOGIN」自体は plan に入ったが、**RLS 下での実 SELECT 成立**と **テストの非 false-green 化**が欠けたまま実装に入ると、受け入れ条件 4（不具合・要望画面）と §10.1 pgTAP が空振りする。

**総合判定: `BLOCK_WITH_CONDITIONS`**

条件を plan 本文（必要なら migration/pgTAP 節と Task 2/4/1 のテスト契約）へ反映するまで、Task 実装の「完了扱い」は不可。条件充足後は `PROCEED`（残差は token 任意・共有 PC・監査ログなし等、設計受容済み）。

---

## Verdict

| 項目 | 値 |
| --- | --- |
| **判定** | **`BLOCK_WITH_CONDITIONS`** |
| **Critical** | **2** |
| **Important** | **7** |
| **Minor（参考）** | 3 |
| **解除後** | 下記 must-fix を plan に固定すれば **PROCEED**（設計受容残差は残る） |

---

## Attack table

| # | 攻撃シナリオ | 判定 | 根拠（plan × live） |
| --- | --- | --- | --- |
| A1 | `GRANT SELECT` のみの ops ロールで `user_feedback` を読む | **成立（空結果 / 機能不全）** | live: `alter table public.user_feedback enable row level security` + `user_feedback_deny_all`（`to authenticated, anon`）。PG は RLS ON かつ当該ロール向け policy 無し → **default deny（0 行）**。owner/`service_role` 以外は表 GRANT だけでは読めない。plan Task 2 migration は policy を作らない。 |
| A2 | pgTAP `lives_ok(SELECT id … LIMIT 1)` が「SELECT 可」と偽陽性 | **成立（false-green）** | 0 行 SELECT は privilege error にならない。plan スケッチは `lives_ok` のみで **非空 or `has_table_privilege` + 明示 policy 下の行可視**を要求していない。 |
| A3 | private 台帳への INSERT を 1 表だけ試し、他表の誤 GRANT を見逃す | **成立しうる（false-green）** | plan は `user_feedback` INSERT の `throws_ok` を例示し private は「等を同様に」。**6 表すべての INSERT/UPDATE/DELETE** と代表書き込み RPC の EXECUTE 拒否が Task 契約として固定されていない。 |
| A4 | pooler ユーザー名を `kondate_ops_readonly` **prefix** で受理 | **成立（plan 文面）** | plan Task 4: 「local-part が `kondate_ops_readonly` で始まらない…」「prefix または exact」。live 正本 `maintenance-env.ts` は **exact** `login` または **exact** `login.<20-char-ref>` のみ。prefix は `kondate_ops_readonly_evil` 等を理論上通す。 |
| A5 | Transaction pooler `6543` / `postgres` URL | **plan 上は反証予定** | Task 4 に 6543 reject・postgres reject。テスト RED 例あり。実装逸脱時のみ成立。 |
| A6 | SQL 注入で任意 SELECT / DML | **設計・plan 上は反証予定・実装依存** | `$1` bind、任意 SQL API なし、sql-guard。RO ロールなら DML 被害は限定。**列名連結バグは残差**。 |
| A7 | クエリに `identity_key` / `request_hmac` / `SELECT *` を混入 | **部分成立しうる** | sql-guard は `select *` / `identity_key` を想定。`request_hmac`・Stripe 列・禁止表名の網羅が Task 6 で弱い。FORBIDDEN_DTO_KEYS テストは **配列に文字列があるだけ**で schema/mapper の実効を見ない。 |
| A8 | `.env.admin` が git / Docker context に混入 | **plan は対策・Dockerfile 文脈に穴** | Task 1 で root gitignore/dockerignore。**build context は `./admin`** のため **root `.dockerignore` は効かない**。plan は `admin/.dockerignore` を作らない。admin 配下に秘密を置いた場合に context 漏洩。 |
| A9 | multi-stage build で秘密が runtime イメージに残る | **概ね反証・条件付き** | runtime は `npm ci --omit=dev` + `dist` のみ。build-arg 秘密なし。中間 stage に source は残るが local compose 前提。**admin context 内秘密**が主リスク（A8）。 |
| A10 | root CI（`format:check` / `lint` / `vitest` / `build`）が `admin/` を噛む | **部分対策・検証が false-green** | Task 1: eslint `admin/**`、find prune。`vitest.config.ts` include に admin 無し、`tsconfig` references に admin 無し、`ci.sh` も admin 非実行 → **実行時は概ね隔離**。ただし tooling テストは **eslint ソース正規表現のみ**で、**format の `-path './admin' -prune` を検証しない**。prune 文法ミスで CI 赤 or admin 未 prune を見逃し得る。 |
| A11 | compose `name: ${KONDATE_COMPOSE_PROJECT_NAME:-kondate}-admin` と `.env.admin` の取り違え | **低〜中（運用混乱）** | Compose の `name:` 補間は **プロジェクト `.env` / shell** であり、service `env_file: .env.admin` は **コンテナ env のみ**。`.env.admin` に `KONDATE_COMPOSE_PROJECT_NAME` を書いても project 名に効かない。未設定時は常に `kondate-admin` に寄り、worktree 衝突し得る（本編は hash 付き必須）。 |
| A12 | migration が `NOLOGIN` のまま本番で LOGIN 未昇格 | **運用手順依存** | plan は maintenance と同型（migration NOLOGIN + provision LOGIN）。本番 Dashboard で LOGIN/password/CONNECTION LIMIT を付け忘れると admin 起動失敗（fail-closed 寄り）。**NOINHERIT / CONNECTION LIMIT が migration CREATE に無い**点は spec §7.4 とズレ。 |
| A13 | Host allowlist / token バイパス | **Host: plan で必須。token: 任意＝設計受容残差** | Task 5 で Host 400。token 未設定時は loopback 上の他 UID が GET 可能（設計 §9 残差）。timing-safe compare は plan 未記載。 |
| A14 | Task 1 で compose/admin 境界を先に入れ、migration 前に「admin 完成」と誤認 | **プロセス上の軽微リスク** | spec §12 は「最初の Task に migration + pgTAP」。plan は Task 1 境界 → Task 2 migration。セキュリティ上は migration 前に本番接続できない方がよいが、**compose が存在しない Dockerfile を指す中間状態**と「Task 1 完了＝使える」誤認に注意。 |
| A15 | Supabase pooler の TLS（SELF_SIGNED_CERT_IN_CHAIN） | **plan 未固定で実装失敗しうる** | live `maintenance-db.ts`: connectionString の `sslmode` を剥がし `ssl: { rejectUnauthorized: false }`。設計 §7.2 は「plan で1行固定」と書いたが **Task 4 にその1行が無い**。 |
| A16 | アプリ `BEGIN READ ONLY` を外して DML | **RO ロールなら表 DML は反証** | SELECT only GRANT + canary。**書き込み SECURITY DEFINER RPC の EXECUTE が残っていれば別経路**（現行 migration は主要 RPC を public/anon から revoke 済み → 残差は pgTAP で固定すべき）。 |
| A17 | DNS rebinding + 無 token | **Host allowlist で概ね反証** | Task 5。token 任意は残差。 |
| A18 | Netlify / 本編 dist に admin 混入 | **概ね反証** | 独立 package、root vite/tsconfig 非参照、ci 非接続。 |

---

## Findings

### Critical

#### C1. `user_feedback` の RLS を無視した GRANT のみ — 実 SELECT 不能 + pgTAP false-green

- **信頼度:** 96  
- **箇所:** plan Task 2 migration（`grant select on public.user_feedback` のみ）/ pgTAP スケッチ `lives_ok(SELECT …)`  
  live: `supabase/migrations/20260725120000_user_feedback.sql` L22、`20260726120000_adversarial_review_fixes.sql` L11–16、`docs/testing/database-access-matrix.md`（`user_feedback` RLS on + deny-all）  
- **説明:**  
  - `public.user_feedback` は **RLS 有効**。policy `user_feedback_deny_all` は **`TO authenticated, anon` のみ**。  
  - `kondate_ops_readonly` は table owner でも `BYPASSRLS` でもない（plan も `nobypassrls`）。  
  - PostgreSQL: RLS 有効かつロールに適用される permissive policy が無い → **SELECT は権限エラーではなく 0 行**。  
  - よって feedback 画面は常に空、起動 canary「代表 SELECT が権限エラーにならない」も **空振りでパス**し得る。  
  - private 台帳は matrix 上 RLS off のため GRANT SELECT で足りるが、**feedback だけ別ルール**なのに plan が一律 GRANT で済ませている。  
- **修正要求（BLOCK 解除必須）:**  
  1. migration に ops 向け **permissive SELECT policy** を追加する（例: `CREATE POLICY user_feedback_ops_select ON public.user_feedback FOR SELECT TO kondate_ops_readonly USING (true);`）。`BYPASSRLS` は使わない。  
  2. pgTAP で (a) seed 1 行を **postgres で挿入**、(b) `SET ROLE kondate_ops_readonly` 後に **その id が見える** `is`/`results_eq`、(c) authenticated は依然 deny、を必須化。`lives_ok(LIMIT 1)` 単独を「SELECT 可」の証拠にしない。  
  3. `rls_inventory` / access matrix に ops policy 行を追記する Task を明示。

#### C2. pooler ユーザー名検証が prefix 許容になっており、maintenance 正本より弱い

- **信頼度:** 91  
- **箇所:** plan Task 4「URL reject 規則」L497–498、accept テストが `kondate_ops_readonly.abc` を通すのみ  
  live: `netlify/functions/_shared/maintenance-env.ts` L111–119（exact `login` or exact `login.<projectRef>`）  
- **説明:**  
  - plan 文面は「`kondate_ops_readonly` で始まらない → reject」「prefix または exact を許可」。  
  - これは `kondate_ops_readonly_backup` や将来の別 LOGIN 名を **誤受理**し得る。書込可能ロールを同 prefix で切った場合、起動時 `session_user` 検査より前の URL ゲートが意味を失う。  
  - Session pooler の正当形は **`kondate_ops_readonly.<20-char-ref>` の exact**（および local の exact `kondate_ops_readonly`）に限定すべきで、**startsWith は不可**。  
- **修正要求（BLOCK 解除必須）:**  
  1. 受理を maintenance と同型に固定:  
     - local insecure: username **exact** `kondate_ops_readonly`  
     - production session: username **exact** `kondate_ops_readonly.<managed-ref>`（ref は `[a-z0-9]{20}`）かつ host が pooler 形、port 5432  
  2. unit に **reject** 例: `kondate_ops_readonly_evil`、`kondate_ops_readonly.`、`kondate_ops_readonly.short`、`postgres.<ref>`。  
  3. 起動後 `session_user = current_user = 'kondate_ops_readonly'` は維持（URL ゲートの二重化）。

---

### Important

#### I1. pgTAP が private 全 GRANT 表の DML 拒否・書き込み RPC EXECUTE 拒否を契約化していない

- **信頼度:** 90  
- **箇所:** plan Task 2 Step 1（`plan(12)` と user_feedback INSERT 例のみ、「等を同様に」）; spec §10.1「INSERT 不可・auth 不可・書き込み RPC 不可」  
- **説明:** 攻撃 A3/A16。SELECT 専用の証明は **表ごと**の `has_table_privilege(..., 'INSERT'|'UPDATE'|'DELETE') = false` と `throws_ok`、および `run_kondate_maintenance` / `insert_user_feedback_rate_limited` / `reserve_ai_generation` 等の **EXECUTE 不可**が必要。現行 live は主要 RPC を public から revoke 済みだが、**ops ロール追加後に PUBLIC/デフォルトが残る関数**や将来 migration の回帰を Task が固定していない。  
- **修正要求:** Task 2 の pgTAP 必須ケースを列挙固定する:  
  - 6 SELECT 対象表それぞれ: SELECT 可（private は seed or privilege、feedback は C1）/ INSERT・UPDATE・DELETE 不可  
  - `auth.users` SELECT 不可（schema USAGE 無し）  
  - 代表書き込み RPC ≥3 の EXECUTE 不可  
  - `rolsuper` / `rolbypassrls` / `rolcanlogin`（migration 直後は NOLOGIN でも可）/ `statement_timeout` / `default_transaction_read_only`

#### I2. false-green unit / tooling テスト契約

- **信頼度:** 88  
- **箇所:** Task 3 `FORBIDDEN_DTO_KEYS` テスト; Task 1 `admin-compose.test.mjs`; Task 6 sql-guard の「import または fs」曖昧さ  
- **説明:**  
  - `expect(FORBIDDEN_DTO_KEYS).toContain("identity_key")` は **定数配列の自己参照**で、Zod schema / mapper / SQL が禁止キーを出さないことを証明しない。  
  - tooling は `eslint.config.js` に `admin/**` 文字列があることだけ。`package.json` の find に **`-path './admin' -prune`** があること、および（可能なら）意図しない `5193:5193` 全インターフェース公開の否定は YAML にあるが **format prune が未検証**。  
  - sql-guard が動的組み立て SQL や別ファイル文字列を読み漏らすと `identity_key` 混入を見逃す。  
- **修正要求:**  
  - DTO: 禁止キー付きオブジェクトを `safeParse` して **出力にキーが残らない / または strict reject** を assert。mapper 単体でも同値。  
  - tooling: `package.json` の `format` / `format:check` ソースに admin prune を assert。  
  - sql-guard: `queries/*.ts` を fs で全読し、`select *` / `identity_key` / `request_hmac` / `stripe_` / 禁止表名を case-insensitive で禁止。

#### I3. `admin/` build context に対する `.dockerignore` 不在（root ignore 無効）

- **信頼度:** 87  
- **箇所:** plan Task 1（root `.dockerignore` のみ）/ Task 8 Dockerfile `COPY . .` / compose `context: ./admin`  
- **説明:** Docker は **context ルートの `.dockerignore`** を使う。context が `./admin` のとき **リポジトリ root の `.dockerignore` は適用されない**。設計・plan が強調する「root `.env.admin` を context に載せない」は context 分離で達成されるが、**`admin/.env` / 誤配置秘密 / 将来の local 設定**は `COPY . .` で build stage に入る。  
- **修正要求:** Task 1 または 8 で `admin/.dockerignore`（少なくとも `.env` / `.env.*` / `node_modules` / `dist`）を追加し、tooling または admin テストで存在を固定。

#### I4. node-pg TLS（`rejectUnauthorized`）が Task 4 で未固定

- **信頼度:** 90  
- **箇所:** 設計 §7.2「plan で1行固定」; plan Task 4 実装スケッチに無し  
  live: `maintenance-db.ts` L52–89 コメント（pooler で SELF_SIGNED_CERT_IN_CHAIN）  
- **説明:** 本番 Session pooler 接続は maintenance と同じ TLS 落とし穴を踏む。未固定のまま実装すると **起動 canary 前に接続失敗**し、オペレータが `sslmode=disable` や postgres URL へ逃げる圧力になる。  
- **修正要求:** Task 4 に maintenance と同方針を exact で書く: 本番は URL 検証後に検証用 `sslmode` を connectionString から除去し、`ssl: { rejectUnauthorized: false }`（またはプロジェクトが選ぶ verify-full 運用を文書化）。unit で option 形を固定。

#### I5. migration CREATE ROLE が spec の `NOINHERIT` / `CONNECTION LIMIT 4` を欠く

- **信頼度:** 84  
- **箇所:** plan Task 2 migration SQL; spec §7.4; 比較: maintenance executor は `noinherit`  
- **説明:** plan の `create role` は `nologin nosuperuser … nobypassrls` のみ。`NOINHERIT` 欠落は将来 `GRANT some_write_role TO kondate_ops_readonly` 事故時に権限が滲む。`CONNECTION LIMIT` が provision のみだと、本番 Dashboard 手作業 LOGIN 化で limit 無しになり得る。  
- **修正要求:** migration の CREATE/ALTER に `NOINHERIT` を入れる。`CONNECTION LIMIT 4` は migration（LOGIN 前でも属性として保持可能な範囲）または deploy 文書 + provision の **両方**に exact。pgTAP で `rolinherit = false` を assert。

#### I6. role LOGIN timing と本番 provision 手順が Task 契約として薄い

- **信頼度:** 83  
- **箇所:** Task 2 provision script（local 中心）; deploy 文書「5–15 行追記」のみ  
  live: `docs/deployment/supabase.md` §6 は maintenance LOGIN 手作業が正本  
- **説明:** migration `NOLOGIN` → local provision で `LOGIN` は maintenance と同型で妥当。ただし admin は **本番 Session URL が主経路**なのに、本番での `ALTER ROLE … LOGIN PASSWORD` / pooler ユーザー名形 / パスワードをリポジトリに置かない手順が「短く追記」に留まっている。LOGIN 前に compose up すると失敗する点はよいが、**失敗理由が closed error でオペレータが postgres URL に戻る**経路が残る。  
- **修正要求:** Task 2/8 の docs に maintenance § と同水準のチェックリスト（session_user、timeout、SELECT canary、DML 失敗）を必須化。起動失敗メッセージは「readonly ロールと migration 適用を確認」の固定文言のみ。

#### I7. compose project 名 default と `.env.admin` の責務分離が未テスト

- **信頼度:** 82  
- **箇所:** plan `compose.admin.yaml` `name: "${KONDATE_COMPOSE_PROJECT_NAME:-kondate}-admin"`  
  live: 本編 `compose.yaml` は `:? required` + `compose-project-name.sh` の hash 名  
- **説明:** 攻撃 A11。default `kondate-admin` は複数 worktree で **コンテナ/ネットワーク名衝突**し得る。`.env.admin` は DB URL 用で project 名の正本ではないことが plan に明記されていない。  
- **修正要求:** (a) 本編と同様に `KONDATE_COMPOSE_PROJECT_NAME` 必須 + `-admin` 接尾辞、または (b) default を残すなら docs と tooling で「本編 `.env` を読む / worktree では export する」を固定。`env_file: .env.admin` が欠落すると `up` が失敗することも受け入れ手順に明記。

---

### Minor（参考・80 未満またはプロセス）

#### M1. Task 順序が spec §12「最初の Task に migration」と不一致

- **信頼度:** 78  
- Task 1 境界 → Task 2 migration は実務上合理的だが、spec 文言と異なる。セキュリティより **handoff/進捗の誤解**リスク。plan 冒頭で「Task 1 は境界のみで DB 権限は Task 2 が正」と明記すれば足りる。

#### M2. token 任意 + timing-safe 未記載

- **信頼度:** 76  
- 設計受容残差。実装時は `crypto.timingSafeEqual` を推奨として Task 5 に1行あるとよい。

#### M3. 上限付近クエリが `ai_identity_daily_usage` ではなく台帳近似

- **信頼度:** 72  
- 設計 §5.4 で意図的。identity_key 非 SELECT 方針と整合。残差として「成功数の正本との差分」を UI 注意に出せるとよい（plan 必須ではない）。

---

## Refuted attacks（成立しない / 十分に潰されている）

| 攻撃 | 結論 |
| --- | --- |
| PostgREST で `private` を公開する | plan/spec とも直 SQL。反証。 |
| service_role / `VITE_*` に DB 秘密 | 使わない方針。反証。 |
| Netlify publish に admin が混ざる | root build/tsconfig/vitest/ci 非接続。概ね反証。 |
| 本編 `compose.yaml` への depends_on | `compose.admin.yaml` 分離。反証。 |
| `SELECT *` を API 契約にする | 禁止 + sql-guard 方針。実装逸脱時のみ。 |
| transaction pooler 6543 を推奨 | reject 規則あり。反証（実装前提）。 |
| `postgres` スーパーユーザ URL を正規経路にする | reject + canary。反証（実装前提）。 |
| ブラウザに DB URL を載せる | BFF only。反証。 |
| root `vitest run` / `tsc -b` が admin を型検査する | include/references に admin 無し。反証。 |
| `identity_key` から email 逆算 | HMAC。キー非 SELECT なら直接攻撃は反証（設計残差のみ）。 |

---

## BLOCK 解除チェックリスト（plan 改訂必須）

- [ ] **C1:** `user_feedback` に `kondate_ops_readonly` 向け SELECT policy。pgTAP で **行可視**を証明（0 行 `lives_ok` 禁止）。  
- [ ] **C2:** ユーザー名は exact / exact `role.<20-char-ref>` のみ。prefix 文言を削除。reject テスト追加。  
- [ ] **I1:** 6 表 DML 拒否 + 書き込み RPC EXECUTE 拒否を pgTAP 必須リスト化。  
- [ ] **I2:** FORBIDDEN_DTO / format prune / sql-guard の false-green 排除。  
- [ ] **I3:** `admin/.dockerignore` 追加と検証。  
- [ ] **I4:** pooler TLS（maintenance と同型）を Task 4 に exact 記載。  
- [ ] **I5:** `NOINHERIT`（+ CONNECTION LIMIT 運用）を migration/pgTAP/docs に固定。  
- [ ] **I6–I7:** 本番 LOGIN 手順と compose project 名の正本を明文化。

すべて反映後は **PROCEED**（残差: token 任意、共有 PC 禁止の運用依存、監査ログなし、上限付近の台帳近似）。

---

## Spec ↔ plan カバレッジ（敵対視点の抜け）

| Spec 要件 | plan | 敵対評価 |
| --- | --- | --- |
| SELECT 専用 LOGIN + GRANT | Task 2 | GRANT は記載。**RLS policy 欠落（C1）** |
| 起動 canary / privilege | Task 4 | 方向正しい。feedback 空 SELECT で偽陽性しうる |
| Host / GET only / token 推奨 | Task 5 | 概ね充足。token 任意は設計残差 |
| 禁止列 / sql-guard | Task 6 | 方向正しい。テスト false-green（I2） |
| root tooling 境界 | Task 1 | 方向正しい。format prune 未検証（I2/A10） |
| `.env.admin` ignore + context `./admin` | Task 1, 8 | root は充足。**admin/.dockerignore 欠（I3）** |
| pooler 5432 / ssl | Task 4 | port/sslmode あり。**TLS 実装1行欠（I4）** |
| pgTAP INSERT 不可 | Task 2 | **private 全表・RPC が未契約（I1）** |

---

## メタ

- レビュー種別: **implementation plan** に対する敵対的レビュー（実装コード変更なし）  
- 成果物: 本ファイルのみ  
- 総合: **`BLOCK_WITH_CONDITIONS`** / Critical **2** / Important **7**
