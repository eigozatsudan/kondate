# 2次検証: ローカル専用運用管理コンソール Implementation Plan

- **役割:** 独立 secondary verifier（1次・敵対的 plan レビューの著者ではない。コンテキスト非共有）
- **日付:** 2026-08-11
- **対象 plan:** [`docs/superpowers/plans/2026-08-11-local-ops-admin-console.md`](../plans/2026-08-11-local-ops-admin-console.md)
- **照合 spec:** [`docs/superpowers/specs/2026-08-11-local-ops-admin-console-design.md`](../specs/2026-08-11-local-ops-admin-console-design.md)（案 A 改訂後）
- **入力:**
  - 1次: [`2026-08-11-local-ops-admin-console-plan-primary.md`](./2026-08-11-local-ops-admin-console-plan-primary.md)（**REVISE** / Critical 1 / Important 6）
  - 敵対: [`2026-08-11-local-ops-admin-console-plan-adversarial.md`](./2026-08-11-local-ops-admin-console-plan-adversarial.md)（**BLOCK_WITH_CONDITIONS** / Critical 2 / Important 7）
- **照合 live tree:**  
  `supabase/migrations/20260725120000_user_feedback.sql`、  
  `supabase/migrations/20260726120000_adversarial_review_fixes.sql`、  
  `docs/testing/database-access-matrix.md`、  
  `netlify/functions/_shared/maintenance-env.ts` / `maintenance-db.ts`、  
  `scripts/provision-maintenance-role.sh`、  
  `docs/deployment/supabase.md`、  
  `package.json`（format find）、  
  `.dockerignore`、  
  `compose.yaml`（project name 慣習）
- **手法:** 静的再照合のみ。plan / product code は編集しない（本ファイルのみ成果物）。
- **指示焦点:** Critical/Important を live の user_feedback RLS、maintenance URL パーサ、`.dockerignore` と `context: ./admin` に対して confirm / refute。

---

## Summary

plan は改訂 spec（案 A: `kondate_ops_readonly` SELECT 専用 LOGIN、Host allowlist、root tooling 境界、Session 5432 fail-closed、6 画面）を Task 1–9 に落としており、**方向と Task 分割は実装可能**である。1次・敵対が共に指摘する **「実装に入る前に plan 本文を直す」** 結論に二次も同意する。

二次の核（live 再照合）:

1. **`public.user_feedback` は RLS ON + deny policy が `authenticated, anon` のみ。**  
   plan Task 2 の `GRANT SELECT` だけでは `kondate_ops_readonly` に行が **見えない**（default-deny → 0 行）。pgTAP の `lives_ok(SELECT … LIMIT 1)` は **false-green**。1次 F1 / 敵対 C1 は **CONFIRMED・Critical 維持**。
2. **URL ユーザー名ゲートが live maintenance 正本より弱い。**  
   plan Task 4 は prefix / 曖昧な local-part 文言。live `maintenance-env.ts` は **exact** `login` または **exact** `login.<20-char-ref>`。敵対 C2 を **Critical 維持**（1次 F4 は Important だが、本番 Session URL が主経路なので Critical が妥当）。
3. **build context `./admin` では root `.dockerignore` は効かない。**  
   敵対 I3 **CONFIRMED**。root の `.env.admin` は context 外で安全だが、`admin/` 配下の誤配置秘密と `COPY . .` が残る。`admin/.dockerignore` が plan に無い。
4. 1次 Important（provision 誤記、format prune 未テスト、npm install 正本、pgTAP 薄さ、NOINHERIT）と敵対 Important（DML/RPC 契約、false-green unit、TLS 1 行、本番 LOGIN、compose project 名）は **ほぼすべて CONFIRMED**。重複は統合する。

**最終判定: `REVISE_PLAN`**

Critical must-fix（2）と Important must-fix（統合後 8）を plan 本文へ反映するまで、Task 実装の完了扱いは不可。反映後は **APPROVE**（残差は token 任意・共有 PC・監査ログなし・上限付近台帳近似＝設計受容済み）。

---

## Final recommendation

| 項目 | 値 |
| --- | --- |
| **判定** | **`REVISE_PLAN`** |
| **Critical must-fix** | **2**（MF-C1, MF-C2） |
| **Important must-fix（統合後）** | **8** |
| **解除後** | plan 改訂のみで足りる。spec 再改訂は不要（案 A の方向は維持）。 |
| **1次との差** | ユーザー名 prefix を Important→**Critical** に上げる（敵対と同調）。 |
| **敵対との差** | 総合ラベルは `BLOCK_WITH_CONDITIONS` 相当だが、二次の語彙は **`REVISE_PLAN`**（plan 改訂で解除可能）。 |

---

## Cross-walk（Critical / Important）

| ID | 出典 | 元重大度 | 二次判定 | 二次重大度 | 統合先 | live 根拠（要約） |
| --- | --- | --- | --- | --- | --- | --- |
| **Pri F1** | 1次 | Critical | **CONFIRMED** | **Critical** | **MF-C1** | `20260725120000`: RLS ON。`20260726120000` L11–16: `user_feedback_deny_all` は `TO authenticated, anon` のみ。matrix L60/L297: `on + deny-all`。PG default-deny → ops は 0 行。 |
| **Adv C1** | 敵対 | Critical | **CONFIRMED** | **Critical** | **MF-C1** | 同上。`lives_ok(LIMIT 1)` は 0 行でも成功 → false-green。 |
| **Adv C2** | 敵対 | Critical | **CONFIRMED** | **Critical** | **MF-C2** | plan L497–498「prefix または exact」。live `maintenance-env.ts` L111–119: exact `login` / exact `login.<ref>` + ref `^[a-z0-9]{20}$`。 |
| **Pri F4** | 1次 | Important | **CONFIRMED / UPGRADE** | **Critical** | **MF-C2** | 同根。1次の regex 提案 `/role\.[A-Za-z0-9]+/` は **20 文字 ref 未固定**で live より弱い → 修正案は maintenance 同型に寄せる。 |
| **Pri F2** | 1次 | Important | **CONFIRMED** | **Important** | **MF-I1** | live maintenance は **別 LOGIN** + `GRANT executor TO login`（`provision-maintenance-role.sh` / supabase.md §）。plan は同一ロール昇格なのに「同型」と誤記。本番 LOGIN 手順が「5–15 行」のみ。 |
| **Adv I6** | 敵対 | Important | **CONFIRMED** | **Important** | **MF-I1** | F2 と同根（本番 LOGIN / closed 失敗文言）。 |
| **Pri F3** | 1次 | Important | **CONFIRMED** | **Important** | **MF-I2** | live `package.json` format find に `./admin` prune **無し**。plan 実装 Step はあるが tooling テストが eslint のみ。spec §10.1 は format prune 検証を要求。 |
| **Adv I2**（format 部分） | 敵対 | Important | **CONFIRMED** | **Important** | **MF-I2** | format prune 未 assert。DTO / sql-guard false-green は MF-I3 へ。 |
| **Adv I2**（DTO/sql-guard） | 敵対 | Important | **CONFIRMED** | **Important** | **MF-I3** | plan Task 3: `FORBIDDEN_DTO_KEYS` 配列自己参照のみ。Task 6 sql-guard が「import または fs」曖昧・禁止トークン狭い。 |
| **Adv I3** | 敵対 | Important | **CONFIRMED** | **Important** | **MF-I4** | Docker は **context ルート**の `.dockerignore` を使う。plan `context: ./admin` + root ignore のみ。live root `.dockerignore` に `.env.admin` すら未登録（plan Task 1 で root 追加予定だが **admin context には無効**）。 |
| **Adv I4** | 敵対 | Important | **CONFIRMED** | **Important** | **MF-I5** | spec §7.2「plan で1行固定」。plan Task 4 実装スケッチに無し。live `maintenance-db.ts` L52–89: sslmode 除去 + `ssl: { rejectUnauthorized: false }`。 |
| **Pri F4 SSL 部分** | 1次 | （F4 内） | **CONFIRMED** | **Important** | **MF-I5** | 同上。 |
| **Pri F6** | 1次 | Important | **CONFIRMED** | **Important** | **MF-I6** | plan pgTAP は role 存在 / lives_ok / 1 INSERT throws 程度。spec §10.1: 6 表 SELECT・INSERT 不可・auth 不可・書き込み RPC 不可。 |
| **Adv I1** | 敵対 | Important | **CONFIRMED** | **Important** | **MF-I6** | F6 と同根 + 全表 DML privilege / EXECUTE 拒否の列挙。 |
| **Pri F7** | 1次 | Important | **CONFIRMED** | **Important** | **MF-I7** | plan `create role` に `noinherit` 無し・CONNECTION LIMIT 無し。spec §7.4 と live maintenance executor（`noinherit`）より弱い。 |
| **Adv I5** | 敵対 | Important | **CONFIRMED** | **Important** | **MF-I7** | 同上。 |
| **Pri F5** | 1次 | Important | **CONFIRMED** | **Important** | **MF-I8** | Task 3 lock 生成が host `npm install` と docker 両論。Task 8 `npm ci` はコミット済み lock 必須。eslint 設定 Files 欠落。 |
| **Adv I7** | 敵対 | Important | **CONFIRMED** | **Important** | **MF-I9** | plan `name: ${…:-kondate}-admin`。本編 `compose.yaml` は project 名 **必須** + hash 慣習。`.env.admin` は compose `name:` 補間に効かない。 |
| Pri F8–F10 | 1次 | Minor | **CONFIRMED** | Minor | residual | Task 順序注記 / sql-guard トークン拡張（I3 に一部吸収）/ offset 明記。 |
| Adv M1–M3 | 敵対 | Minor | **CONFIRMED** | Minor | residual | Task 順序 / token timing-safe / 上限付近近似。 |

### Refuted / 非採用

| 主張 | 二次結論 |
| --- | --- |
| 「GRANT SELECT があれば RLS 下でも行が読める」 | **REFUTED**。PG RLS ON + 適用 policy 無し = default-deny（0 行）。owner / BYPASSRLS のみ例外。plan ロールは `nobypassrls`。 |
| 「root `.dockerignore` が `./admin` context の `COPY . .` を守る」 | **REFUTED**。context が `admin/` のとき root ignore は適用されない。root `.env.admin` は **context 外**なのでその一点は分離で守られるが、**admin 配下秘密**は別問題。 |
| 「1次 F4 の `[A-Za-z0-9]+` pooler 受理で十分」 | **PARTIAL REFUTE**。prefix 排除には足りるが、live maintenance の **20 文字 project ref exact** までは達しない。MF-C2 は maintenance 同型を要求。 |
| compose project 名 default が Critical | **REFUTED as Critical**。運用衝突リスクとして Important（MF-I9）に留める。 |
| token 任意が Critical | **REFUTED as Critical**。設計 §9 受容残差。Host allowlist は plan Task 5 で必須化済み。 |

---

## Live evidence（指示 3 点の深掘り）

### 1. `user_feedback` RLS（MF-C1）

| 事実 | 場所 |
| --- | --- |
| 表作成 + `enable row level security` | `supabase/migrations/20260725120000_user_feedback.sql` L5–22 |
| ブラウザ向け GRANT なし（anon/authenticated revoke、service_role ALL） | 同 L24–27 |
| 明示 deny policy `TO authenticated, anon` のみ | `20260726120000_adversarial_review_fixes.sql` L11–16 |
| matrix: `on + deny-all policy` / browser none | `docs/testing/database-access-matrix.md` L60, L297 |
| private 6 表は matrix 上 RLS off | 同 L14–15, L22, L29 等 |

**結論:** plan migration の `grant select on public.user_feedback` だけでは ops ロールは **権限エラーにならず 0 行**。feedback 画面・dashboard 集計が空になり、`lives_ok` / 起動 canary「権限エラーにならない」も偽陽性。

**必須修正:**  
`CREATE POLICY … FOR SELECT TO kondate_ops_readonly USING (true);`（DML policy は付けない）。pgTAP は postgres seed → `SET ROLE` → **行可視**（`is` / `results_eq` / `isnt_empty`）。`lives_ok(LIMIT 1)` 単独を禁止。

### 2. maintenance URL パーサ（MF-C2 / MF-I5）

live `maintenance-env.ts`:

- local: username **exact** `kondate_maintenance_login`、host `db`、port `5432`、`sslmode=disable`
- production: username **exact** `login`（direct）または **exact** `login.<expectedProjectRef>`（session）、ref `^[a-z0-9]{20}$`、port `5432`、sslmode 限定
- **startsWith / 任意 suffix は受理しない**

live `maintenance-db.ts`:

- 本番: connectionString から検証用 `sslmode` を除去し `ssl: { rejectUnauthorized: false }`

plan Task 4:

- 「`kondate_ops_readonly` で始まる / prefix または exact」→ **`kondate_ops_readonly_evil` 等を理論上通す**
- accept テストが `kondate_ops_readonly.abc`（**非 20 文字 ref**）
- TLS option の 1 行が未記載

**結論:** C2 Critical 妥当。I4/MF-I5 は接続失敗→オペレータが弱い URL へ逃げる圧力として Important。

### 3. `.dockerignore` × `context: ./admin`（MF-I4）

| 事実 | 意味 |
| --- | --- |
| plan compose: `context: ./admin` | build context ルート = `admin/` |
| plan Task 1: root `.dockerignore` に `.env.admin` のみ | **admin context では読まれない** |
| plan Task 8: `COPY . .` | admin 配下の全ファイルが build stage に入る |
| live root `.dockerignore` | `.env` 系はあるが **`.env.admin` 未登録**（現状）。admin 未作成 |
| root `.env.admin` | context 外 → 通常は送られない（root ignore の有無と独立） |

**結論:** 「root に `.env.admin` を ignore」は git / 誤って context を repo root にした事故への防御として有用だが、**指定どおり `./admin` context の防御には `admin/.dockerignore` が必要**。敵対 I3 を CONFIRMED。

---

## Merged must-fix（plan 改訂必須）

### Critical

#### MF-C1 — `user_feedback` SELECT policy + 行可視 pgTAP（Pri F1 ∪ Adv C1）

**plan 改訂内容:**

1. Task 2 migration に追加:
   ```sql
   create policy user_feedback_ops_readonly_select
     on public.user_feedback
     for select
     to kondate_ops_readonly
     using (true);
   ```
   （`FOR ALL` / INSERT/UPDATE/DELETE policy は付けない。`BYPASSRLS` 禁止。）
2. pgTAP: postgres で seed 1 行 → `SET LOCAL ROLE kondate_ops_readonly` → その `id` が **見える**。authenticated deny 回帰。`lives_ok(LIMIT 1)` 単独を「SELECT 可」の証拠にしない。
3. `docs/testing/database-access-matrix.md` と rls inventory に ops SELECT policy 行を追記する Step を必須化。
4. 起動 canary の「代表 SELECT」も、可能なら seed 前提または `has_table_privilege` + policy 存在と役割分担を Task 4 に明記（空 SELECT 成功だけにしない）。

#### MF-C2 — URL ユーザー名は exact / exact `role.<20-char-ref>` のみ（Adv C2 ∪ Pri F4 UPGRADE）

**plan 改訂内容（Task 4 Interfaces + RED テスト）:**

- local insecure: username **exact** `kondate_ops_readonly`
- production session: username **exact** `kondate_ops_readonly.<managed-ref>`、ref = `[a-z0-9]{20}`、host が pooler 形、port `5432`
- **reject 必須例:** `kondate_ops_readonly_evil`、`kondate_ops_readonlyx`、`kondate_ops_readonly.`、`kondate_ops_readonly.short`、`postgres`、`postgres.<ref>`、port `6543`
- accept 例の `.abc` を **20 文字 ref** に置換
- 起動後 `session_user = current_user = 'kondate_ops_readonly'` は維持（URL ゲートの二重化）
- plan 文面から「prefix」「で始まる」を削除。spec §7.2 の「local part が一致」は **exact match** と plan で明示

### Important

#### MF-I1 — provision / 本番 LOGIN 手順の exact 化（Pri F2 ∪ Adv I6）

1. 「maintenance と同型」→「**パスワードは migration に含めず、同一名ロールを migration 外で LOGIN 化（executor/login 二重ロールではない）**」。
2. 本番手順を Task 2/8 docs に checklist 化: `ALTER ROLE … LOGIN PASSWORD … NOINHERIT … CONNECTION LIMIT 4`、timeout / `default_transaction_read_only`、session_user canary、SELECT canary、DML 失敗。パスワード非 argv。
3. local: `OPS_READONLY_DB_PASSWORD` の生成・provision 呼び出し・source テスト（argv に秘密なし）を Files に追加。
4. 起動失敗メッセージは closed 固定文言のみ（postgres URL へ誘導しない）。

#### MF-I2 — root format prune の tooling 固定（Pri F3 ∪ Adv I2 一部）

Task 1 テストに `package.json` の `format` / `format:check` が `-path './admin' -prune` を含むことの assert を追加。実装 Step は「既存 prune 列の直後・`-type f` より前」を維持。

#### MF-I3 — false-green DTO / sql-guard 排除（Adv I2 残り ∪ Pri F9 強化）

1. DTO: 禁止キー付きオブジェクトを schema / mapper に通し、**出力にキーが残らない / strict reject** を assert（配列自己参照のみ禁止）。
2. sql-guard: `queries/*.ts` を fs 全読。case-insensitive で `select *` / `identity_key` / `request_hmac` / `stripe_` / `menu_payload` / `from auth.` 等を禁止。

#### MF-I4 — `admin/.dockerignore`（Adv I3）

Task 1 または 8 で `admin/.dockerignore` を作成（最低: `.env` / `.env.*` / `node_modules` / `dist`）。tooling または admin テストで存在を固定。root `.dockerignore` の `.env.admin` は git/誤 context 用に残してよいが **admin context の代替にしない**と 1 行注記。

#### MF-I5 — node-pg TLS を Task 4 に exact 記載（Adv I4 ∪ Pri F4 SSL）

maintenance と同方針: 本番 URL 検証後に connectionString から sslmode を除去し、`ssl: { rejectUnauthorized: false }`。unit で option 形を固定。local `sslmode=disable` は option を付けない。

#### MF-I6 — pgTAP 必須ケース列挙（Pri F6 ∪ Adv I1 ∪ MF-C1）

Task 2 Step 1 に exact リスト（数は実数に合わせる）:

- 6 GRANT 表: SELECT 可（private は privilege または seed、feedback は **行可視**）
- 6 表: INSERT/UPDATE/DELETE 不可（`has_table_privilege` および/または `throws_ok`）
- `auth.users` / `auth` schema USAGE 不可
- 代表書き込み RPC ≥3 の EXECUTE 不可（例: `run_kondate_maintenance`、`insert_user_feedback_rate_limited`、`reserve_ai_generation` または live に存在する同等）
- `not rolsuper` / `not rolbypassrls` / migration 直後 `rolcanlogin` 期待 / `statement_timeout` / `default_transaction_read_only` / `rolinherit = false`（MF-I7）

#### MF-I7 — `NOINHERIT` + CONNECTION LIMIT（Pri F7 ∪ Adv I5）

migration `create role` / 既存時 `alter role` に `noinherit`。`CONNECTION LIMIT 4` は migration 属性または provision + 本番手順の **両方**に exact。pgTAP で `rolinherit = false`。

#### MF-I8 — admin lock / install 正本（Pri F5）

1. lock 生成コマンドを 1 本に固定（推奨: `docker compose run --rm --no-deps -w /workspace/admin app npm install`、本編 `.env` / project 名前提を明記）。
2. `admin/package-lock.json` を commit 対象として `git add` に明示。
3. `admin/eslint.config.js`（必要なら prettier）を Files に入れるか、lint script を後 Task へ遅延。

#### MF-I9 — compose project 名の正本（Adv I7）

(a) 本編同様 `KONDATE_COMPOSE_PROJECT_NAME` 必須 + `-admin` 接尾辞、または (b) default を残すなら docs/tooling で「本編 `.env` / shell export が正本。`.env.admin` は project 名に効かない」を固定。`env_file: .env.admin` 欠落時の `up` 失敗も受け入れ手順に明記。

---

## Residual（設計受容・plan 必須改訂外）

- token 任意 + 同一マシン他 UID の GET（spec §9）。実装時 `crypto.timingSafeEqual` 推奨は Minor。
- 監査ログなし。
- 上限付近クエリが `ai_identity_daily_usage` ではなく台帳近似（spec §5.4 意図）。
- Task 1 境界 → Task 2 migration の順序（spec §12 と不一致だが実用上可）。plan 冒頭に「Task 1 は境界のみ、DB 権限の正は Task 2」と 1 行あれば足りる。
- UI コンポーネントの見た目細部 / Task 7 の薄い RED。

---

## Spec ↔ plan カバレッジ（二次）

| Spec 要件 | plan | 二次 |
| --- | --- | --- |
| SELECT 専用 LOGIN + GRANT | Task 2 | GRANT 記載。**RLS policy 欠（MF-C1）** |
| ロール属性 NOINHERIT / LIMIT 4 | Task 2 | **欠（MF-I7）** |
| 起動 canary / privilege | Task 4 | 方向可。feedback 空 SELECT 偽陽性リスク |
| URL fail-closed / Session 5432 | Task 4 | port/sslmode あり。**username prefix（MF-C2）・TLS 1 行（MF-I5）** |
| Host / GET / token | Task 5 | 充足（token 任意は残差） |
| 禁止列 / sql-guard | Task 3/6 | 方向可。**テスト false-green（MF-I3）** |
| root tooling 境界 | Task 1 | 実装 Step あり。**format prune テスト欠（MF-I2）** |
| `.env.admin` + context `./admin` | Task 1, 8 | root ignore 方針は可。**admin/.dockerignore 欠（MF-I4）** |
| pgTAP INSERT/auth/RPC 不可 | Task 2 | **未契約（MF-I6）** |
| 6 API / 6 UI / Docker | Task 5–8 | 概ね充足 |
| admin 独立 package / lock | Task 3 | **install 正本曖昧（MF-I8）** |

---

## メタ

- レビュー種別: **implementation plan** 二次検証（実装コード変更なし）
- 成果物: 本ファイルのみ
- 総合: **`REVISE_PLAN`** / Critical must-fix **2** / Important must-fix **8**
- 1次 REVISE を支持し、敵対の Critical 2 件を維持。解除後は plan 実装開始可（`APPROVE` 相当）。
