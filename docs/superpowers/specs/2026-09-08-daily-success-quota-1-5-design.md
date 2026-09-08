# 日次献立成功枠を Free 1 / Plus 5 にする

- 日付: 2026-09-08
- 状態: **人間承認済みの製品方針。実装計画待ち**
- 対象: 1 日献立の**成功回数**（`planQuota.*.successPerDay`）と、それを見せる UI / ENV / SQL 許可リスト
- 種別: 既存ロック値の改訂。新機能は作らない

---

## 1. 結論

1 日に作れる献立（成功した生成）の上限を次に変える。

| プラン | 現行 | 変更後 |
| --- | ---: | ---: |
| Free | 3 | **1** |
| Plus | 10 | **5** |

試行枠・短時間窓・週献立・チラシ週次・「くわしく作る」は変えない。

実装は一括切替とする。SQL の `p_user_limit` 許可リストは `(1, 5)` だけを受け、Functions が送る値と一致させる。移行期間の `(1, 3, 5, 10)` 併用は採用しない。

## 2. 決定事項

1. ユーザーに見える「1 日に作れる回数」は成功回数だけである。失敗や再試行で消費する外部 AI 試行枠は現行のままにする。
2. 週献立・チラシ週次・品質モードの別枠は対象外。
3. 過去の生成行の `quota_success_limit`（3 または 10）は書き換えない。
4. identity 日次テーブルの防御 CHECK（`reserved_count + success_count <= 10`）は下げない。製品上限 5 は RPC の `p_user_limit` で止める。
5. 本番 Netlify の `USER_DAILY_AI_LIMIT` を `1` にする作業はコード外のリリース手順である。エージェントは deploy しない。

## 3. 変えるもの / 変えないもの

### 3.1 変える

- Free 成功枠: `FREE_SUCCESS_PER_DAY = 1`、`FREE_SUCCESS_PER_DAY_ENV = "1"`
- Plus 成功枠: `plusQuota.successPerDay = 5`
- TS の `planQuota.defense.maxSuccessPerDay`（Plus 成功枠から導出されるため **5** になる）
- Zod の `userDailyLimit` リテラル（`1 | 5`）
- SQL RPC の `p_user_limit` 許可: `(3, 10)` → `(1, 5)`
- リクエスト行の `quota_success_limit` 列: 既定値 `1`。CHECK は歴史値を残して `in (1, 3, 5, 10)`
- 画面文言の「1 日最大 10 回」→「1 日最大 5 回」（Plus）。残数表示は定数から組み立てる
- ロック ENV `USER_DAILY_AI_LIMIT`: リポジトリ側の compose / `.env.example` / preflight 期待を `"1"` にする
- 運用文書のうち現行値を書くもの: `README.md`、`docs/deployment/netlify.md`、`docs/deployment/README.md`

### 3.2 変えない

| 項目 | 値 |
| --- | --- |
| Free 試行 / 日 | 6 |
| Plus 試行 / 日 | 20 |
| Free 短時間窓 | 4 / 600 秒 |
| Plus 短時間窓 | 8 / 600 秒 |
| 品質モード | 3 / 日、20 / 月 |
| チラシ・週献立の週次成功 | 2 / JST 週 |
| チラシ・週献立の週次試行 | 6 / JST 週 |
| アプリ全体 AI 日次の製品 max | 500 |
| identity CHECK | `reserved + success <= 10`、`reserved + sent <= 20`、short `<= 8` |
| 過去の `ai_generation_requests.quota_success_limit` | 3 または 10 のまま |

`docs/archive/` の旧設計・旧計画は更新しない。実装と契約が正である。

## 4. 正本と同期

既存コメントどおり、数値の無断ミラーを増やさない。

| 値 | 正本 | 追随 |
| --- | --- | --- |
| Free 成功 | `shared/contracts/plan-quota-constants.mjs` の `FREE_SUCCESS_PER_DAY` / `_ENV` | `plan-quota.ts` の `planQuota.free`、`releaseQuota.userDailySuccessLimit`、preflight の `USER_DAILY_AI_LIMIT`、compose、`.env.example` |
| Plus 成功 | `shared/contracts/plan-quota.ts` の `plusQuota.successPerDay` | `planQuota.plus`、`planQuota.defense.maxSuccessPerDay`、Zod リテラル |
| SQL `p_user_limit` | 新規マイグレーション（dual-write 残差。mjs を変えても SQL は自動追随しない） | `reserve_ai_generation`、`get_ai_generation_status`、`get_ai_usage_today` の現行 CREATE OR REPLACE 本体 |

現行の最終定義（これだけを `CREATE OR REPLACE` のコピー元にする。古い migration は編集しない）:

- `reserve_ai_generation`: `supabase/migrations/20260831120000_novelty_preference.sql`
- `get_ai_usage_today`: `supabase/migrations/20260808120000_quality_monthly_retry_and_usage_stale_cleanup.sql`
- `get_ai_generation_status`: `supabase/migrations/20260729140000_plan_aware_quota.sql`

新規ファイル名は `supabase/migrations/20260908120000_daily_success_quota_1_5.sql`。許可リスト以外の RPC ロジックはコピー元とバイト一致させる。

`p_attempt_limit in (6, 20)` と `p_short_window_limit in (4, 8)` は触らない。

## 5. SQL の防御と歴史行

### 5.1 RPC 許可リスト

`p_user_limit` が `1` または `5` 以外なら現行どおり `release_quota_mismatch`（SQLSTATE `22023`）。

デプロイは SQL マイグレーションと Functions（1 / 5 を送る側）を同じリリースに載せる。片方が古いと献立作成は失敗する。ゼロダウンタイム用の新旧併記は採用しない。

### 5.2 スナップショット列

`private.ai_generation_requests.quota_success_limit`:

- 既定値を `3` から `1` へ
- CHECK を `in (3, 10)` から `in (1, 3, 5, 10)` へ

歴史行を 3→1 / 10→5 に書き換えない。当日すでに成功 2 以上の Free ユーザーは、新上限 1 により残数 0 になる。これは意図した切替である。

### 5.3 identity CHECK

`private.ai_identity_daily_usage` の `reserved_count + success_count <= 10` は維持する。Plus 成功を 5 に下げても、既存行が 6〜10 のときに CHECK を 5 へ落とすと進行中の予約更新が壊れる。物理天井 10 と製品上限 5 の差は受け入れる。Zod / Functions は `planQuota.defense.maxSuccessPerDay`（5）を超える limit を受理しない。

## 6. UI 文言

ユーザー向けは日本語。回数は裸の `10` を残さず、原則 `planQuota.plus.successPerDay` / `planQuota.free.successPerDay` から組み立てる。

少なくとも次を新数字に合わせる。

- `src/features/billing/plus-cta.tsx` の `PLUS_HARD_LIMIT_COPY`
- `src/features/billing/plan-settings-section.tsx` の「1 日最大 10 回」
- Plus LP 比較表（すでに `planQuota` 参照なら定数変更で追随する）
- 関連 unit / e2e の exact 文面（`1 日最大 5 回`）

Free 向けに成功回数を前面に出さない既存方針（定性表現）は維持する。硬上限 CTA の Plus 側回数だけが必須の数字である。

## 7. 環境変数

`USER_DAILY_AI_LIMIT` は Free 成功枠と同一文字列でなければならない（preflight が `FREE_SUCCESS_PER_DAY` と照合する）。

| 場所 | 変更後 |
| --- | --- |
| `shared/contracts/plan-quota-constants.mjs` | `1` / `"1"` |
| `compose.yaml` | `"1"` |
| `.env.example` | `1` |
| ローカル `.env`（gitignore） | 作業者が `1` にする。リポジトリには含めない |
| 本番 Netlify | リリース時に `1`。コード変更だけでは preflight が落ちる |

試行・短時間の ENV は現行のまま（`6` / `4` / `600`）。

## 8. テスト

RED で現行の `3` / `10` 期待を壊し、GREEN で `1` / `5` に合わせる。少なくとも:

- `shared/contracts/plan-quota.test.ts`（free 1、plus 5、defense 5）
- `scripts/preflight-production.test.mjs` と `netlify/functions/_shared/env.test.ts` の `USER_DAILY_AI_LIMIT: "1"`
- `tests/tooling/compose.test.mjs` の compose 文字列
- Zod / repository / usage-today で `userDailyLimit` や `p_user_limit` を 10 固定している箇所
- `supabase/tests/database/plan_aware_quota.test.sql`（`p_user_limit` が 3\|10 以外で拒否、Plus スナップショット 5）
- `e2e/specs/billing-plus.spec.ts` の「1 日最大 10 回」と usage mock の `limit: 10`
- Plus CTA / planner / regeneration の文面テスト

pgTAP は既存 migration を書き換えず、新 migration 適用後の関数を検証する。

検証コマンドは Task 対象ファイルに絞る。`db:test` と e2e はホストの `docker compose` 直実行（`app` コンテナ内の `npm run db:test` は使わない）。

## 9. 対象外

- 試行枠・短時間窓の比率変更
- 週献立 / チラシ週次 / 品質モードの回数変更
- Plus 価格、trial、`PLUS_LP_UPGRADE_COMING_SOON`
- identity CHECK を 5 に下げる後続作業
- `docs/archive/` の歴史文書の改訂
- git push、PR 作成、本番/staging deploy、Netlify ENV のエージェント操作

## 10. 受け入れ

- Free は JST 1 日あたり成功 1 回でそれ以上を予約できない。
- Plus は成功 5 回でそれ以上を予約できない。
- 試行 6/20・短時間 4/8/600s は現行どおり拒否・許可される。
- `GET /api/usage/today` の `success.limit` は entitlement に応じて 1 または 5。
- Free 硬上限画面と設定の Plus 案内は「1 日最大 5 回」。
- `p_user_limit` に 3 または 10 を渡すと `release_quota_mismatch`。
- 歴史行の `quota_success_limit` が 3 または 10 でも読取・既存制約は壊れない。
- preflight は `USER_DAILY_AI_LIMIT=1` のみを受け入れ、`3` を拒否する。
