# 1次レビュー: ローカル専用運用管理コンソール 実装

**対象:** worktree `feat/local-ops-admin-console`（HEAD `efd05926` 以降）  
**Diff package:** `/tmp/admin-impl-review/`（vs main）  
**Spec:** `docs/superpowers/specs/2026-08-11-local-ops-admin-console-design.md`  
**Plan:** `docs/superpowers/plans/2026-08-11-local-ops-admin-console.md`  
**照合:** live ファイル（`admin/**`, migration, pgTAP, compose, docs）を diff のみに頼らず確認  
**レビュー種別:** 実装一次（security / privacy / クエリ正しさ / Docker / テスト / 受け入れギャップ）  
**レビュー日:** 2026-08-11  
**編集:** 本ファイルのみ（read-only レビュー）

---

## Summary

実装は承認済み Spec / Plan の骨格を高い忠実度で満たしている。DB 権限の正は `kondate_ops_readonly`（migration で SELECT + `user_feedback` RLS policy、provision で LOGIN）、アプリ防御層は `assertDatabaseUrl` fail-closed・pool `default_transaction_read_only`・`withReadOnly`（`BEGIN READ ONLY`）・起動 canary の多重化。HTTP 面は loopback publish・Host allowlist・GET のみ・optional Bearer。禁止列は列挙 SELECT + Zod DTO + sql-guard で概ね排除。JST 日付・stuck 生成・共有 15 分滞留・上限付近 SQL は Spec/Plan と一致。6 画面 SPA と Docker 1 プロセス配信・運用文書も揃っている。

一方、受け入れ・防御層の穴がいくつか残る。**生成ログ詳細 UI が未配線**（API のみ）、**pgTAP の DML 拒否が Plan 要求の 6 表網羅になっていない**、**admin パッケージに ESLint 設定が無く `npm run lint` が実質不能**、**sql-guard が `stripe_price_id` を未監視**。いずれも Critical（即時の権限昇格や秘密漏洩）ではないが、マージ前に直す価値がある **Important**。設計論争の再燃（token 任意・`rejectUnauthorized: false` 等）は Spec 残差として受容済みとみなし、再リトゲートしない。

## Verdict

**REVISE**

| 区分 | 件数 |
| --- | ---: |
| Critical | 0 |
| Important | 4 |
| Minor | 4（参考。判定には使わない） |

---

## Findings

### F1 — Severity: Important · Confidence: 90

- **Location:** `admin/client/src/pages/GenerationsPage.tsx`（一覧のみ） / `admin/server/src/routes/register.ts` L87–98（`GET /api/generations/:id` は実装済み） / Spec §5.2
- **Why it matters:** Spec §5.2 は生成ログに **詳細**（`started_at`, `completed_at`, `user_usage_day`, `global_sent_calls`, `terminal_details`, `change_reason`, 参照 UUID 等）を要求する。サーバは `getGeneration` + DETAIL_COLUMNS で満たしているが、UI は行クリックも詳細パネルも無く API を呼んでいない。オペレータが「画面群で把握する」目的（Spec §2.1）のうち、失敗調査に必要な詳細が第1版 UI から欠落する。受け入れ §10.2-4「6 画面がデータまたは空表示で落ちない」は通るが、画面仕様 §5.2 自体は未達。
- **Suggestion:** Feedback と同様に行の「詳細」→ `GET /api/generations/:id` を表示。禁止列を出さないことだけ再確認（identity_key / request_hmac は既に SELECT 外）。
- **Status:** open

### F2 — Severity: Important · Confidence: 88

- **Location:** `supabase/tests/database/ops_readonly_role.test.sql` / Plan Task 2 Step 1 必須ケース 5
- **Why it matters:** Plan は **6 表それぞれ**で INSERT（または UPDATE/DELETE）が `42501` 等で失敗することを必須としている。live テストは:

  - `has_table_privilege(..., 'INSERT')` が false なのは `ai_generation_requests` と `user_feedback` のみ
  - `throws_ok` の実 DML は `user_feedback` INSERT のみ
  - `billing_*` / `ai_global_daily_usage` / `share_generalization_jobs` の書込拒否は未検証

  GRANT は migration 上 SELECT のみなので現状は安全だが、将来の migration が誤って INSERT/UPDATE を足したとき **false-green** になる。pgTAP が「書込不能」を固定する役割を Spec §10.1 / Plan が明示しているため、網羅不足は受け入れ上の欠陥。
- **Suggestion:** 6 表それぞれに `throws_ok`（代表 1 DML）または `has_table_privilege` の INSERT/UPDATE/DELETE が false を追加。`plan(N)` の件数を合わせる。
- **Status:** open

### F3 — Severity: Important · Confidence: 92

- **Location:** `admin/package.json` scripts `lint` / `admin/` に `eslint.config.*` 無し / Spec §4.5
- **Why it matters:** Spec §4.5 は admin 検証に format / **lint** / typecheck / test を含む。`admin/package.json` は `"lint": "eslint ."` だが、admin ツリーに flat config が無く、root `eslint.config.js` は `admin/**` を **ignore** している。ESLint 9 は設定ファイル無しでは失敗する。結果として文書化された検証経路の lint が常に赤、または誰も lint を回さない状態になり、admin 固有の退行を取りこぼす。
- **Suggestion:** `admin/eslint.config.js`（最小: recommended + TS、または root から共有できる薄い設定）を追加し、`docker compose -f compose.admin.yaml run --rm admin npm run lint`（または docs の同等コマンド）で通す。docs の検証節に lint / typecheck を明記。
- **Status:** open

### F4 — Severity: Important · Confidence: 85

- **Location:** `admin/server/src/queries/sql-guard.test.ts` L12–20 / Spec §3.1 禁止カラム表
- **Why it matters:** Spec §3.1 は課金の禁止に **すべての `stripe_*` / `*_stripe_*`**（明示例に `stripe_price_id`）を含む。sql-guard の FORBIDDEN は `stripe_subscription_id` / `stripe_customer_id` / `stripe_event_id` のみで、**`stripe_price_id` が無い**。現状クエリは未使用だが、sql-guard が「禁止列を SELECT に載せない」契約の回帰ネットである以上、正本リストと不一致だと将来の列追加を見逃す。`FORBIDDEN_DTO_KEYS` 側には `stripe_price_id` があり、ガード層が二重排除になっていない。
- **Suggestion:** sql-guard に `/stripe_price_id/i`（可能なら `/stripe_[a-z0-9_]+/i` で stripe 列全般）を追加。合わせて `request_hmac_version` も SQL 側で拒否すると Spec §3.1 と揃う。
- **Status:** open

---

## Minor（参考・判定外 / confidence は参考値）

### M1 — session_user 表示が起動検証結果ではなく固定文字列 · ~70

- **Location:** `admin/server/src/index.ts` L26–31  
- 起動 canary は実 `session_user` を見るが、health に渡す値は常に `"kondate_ops_readonly"`。pooler の role.ref 表示や将来の表示ずれの余地。canary で得た値を渡すとよい。

### M2 — 共有ジョブ UI 列の欠落 · ~75

- **Location:** `admin/client/src/pages/ShareJobsPage.tsx` / Spec §5.6  
- Spec 一覧の `claimed_at` / `finished_at` がテーブルに出ていない（API DTO にはある）。

### M3 — ヘッダの「最終取得時刻」不足 · ~70

- **Location:** `admin/client/src/components/Layout.tsx` / Spec §5 共通  
- 接続 host / session_user はあるが、最終取得時刻の常時表示はダッシュボード本文の `generatedAt` に限定。

### M4 — ローカル `OPS_READONLY_DB_PASSWORD` の secrets 自動配線なし · ~72

- **Location:** `scripts/provision-ops-readonly-role.sh` / `scripts/generate-local-secrets` 非連携  
- Plan 二次で指摘された local DX。docs 手順で手動なら運用可能。reset 後の re-provision 忘れで local admin が落ちる。

---

## Spec / 受け入れ対照（要点）

| §10.2 / 不変条件 | 判定 | 根拠（live） |
| --- | --- | --- |
| loopback `127.0.0.1:5193:5193` | OK | `compose.admin.yaml` L13–14 + `tests/tooling/admin-compose.test.mjs` |
| `.env.admin` gitignore | OK | `.gitignore` + tooling test |
| `postgres` URL 起動拒否 | OK | `assertDatabaseUrl` username reject + unit |
| Session 5432 / 6543 拒否 / sslmode | OK | `db.ts` + `db.test.ts` |
| Host allowlist | OK | `middleware/host.ts` + `app.test.ts` |
| GET のみ | OK | `middleware/method.ts` + POST テスト |
| optional Bearer | OK | `middleware/token.ts`（health 免除は Spec 可） |
| SELECT 専用 LOGIN + RLS policy | OK | migration + `isnt_empty` pgTAP |
| `SELECT *` / 禁止列 | 概ね OK | 列挙 SELECT + sql-guard（F4 で price_id 穴） |
| JST 日付・最大 31 日 | OK | `jst.ts` + `jst.test.ts` |
| stuck 生成 `processing` ∧ expires < now() | OK | `generations.ts` L109–135 |
| 共有滞留 15m | OK | `shareJobs.ts` / `dashboard.ts`（製品 lease と同値） |
| 上限付近 SQL | OK | `quotaHealth.ts` が Plan exact CTE と一致 |
| 6 画面 | 部分 | 画面は 6 つあるが生成 **詳細** UI 欠落（F1） |
| 共有 PC 禁止の文書 | OK | `docs/local-development.md` / Layout 注意文 |
| Docker context `./admin` / USER node | OK | `compose.admin.yaml` + `admin/Dockerfile` |
| root tooling が admin を噛まない | OK | eslint ignore + format prune + tooling test |

---

## Positive notes

1. **URL fail-closed が厚い:** bare / `role.<20-char-ref>` の exact 一致、prefix abuse 拒否、direct vs session のホスト組合せ、local は `ADMIN_ALLOW_INSECURE_LOCAL_DB=1` かつ local host かつ `sslmode=disable` のみ。`db.test.ts` で主要 reject/accept を固定。
2. **READ ONLY の三重防御:** ロール `default_transaction_read_only` + pool `options` + `withReadOnly`。起動時 CREATE TEMP canary と INSERT privilege 検査あり。
3. **プライバシー:** 生成台帳から `identity_key` / `request_hmac*` を SELECT しない。課金は Stripe ID 列を SELECT せず `billing_customers` 非 join。feedback 全文は `includeBody=1` 明示時のみ。UI に共有 PC・本文外部共有禁止の注意。
4. **RLS の落とし穴を回避:** `user_feedback_ops_readonly_select` + seed 後 `isnt_empty`（Plan 一次 Critical の修正が実装に入っている）。
5. **運用境界:** 本編 `compose.yaml` 非依存、`name: …-admin`、ports ソース固定テスト、deploy 文書 §6.1 に LOGIN 手順。
6. **TLS:** pooler 向け `sslmode` 剥がし + `rejectUnauthorized: false` が maintenance と同型で unit 固定（接続不能の既知問題を回避）。

---

## Residual（Spec 受容・再リトゲートしない）

- `ADMIN_LOCAL_TOKEN` 未設定時の同一マシン他プロセス GET（Spec §9 残差）。起動 WARN + 文書で運用。
- 表 SELECT があるため psql では Stripe 列や feedback 全文を読める（アプリ非露出が正。列 GRANT 締めは将来）。
- `rejectUnauthorized: false` は pooler 連鎖のための maintenance 同方針（MITM はローカル信頼オペレータ前提）。

---

## Suggested merge gate

1. F1: 生成詳細 UI（または Spec を「第1版は API のみ」と人間承認で改訂）  
2. F2: pgTAP で 6 表 DML 拒否を固定  
3. F3: admin ESLint 設定 + lint 緑  
4. F4: sql-guard を Spec §3.1 に揃える  

上記 Important を閉じれば **APPROVE** 相当。Critical は現状なし。
