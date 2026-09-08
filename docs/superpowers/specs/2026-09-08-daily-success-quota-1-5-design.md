# 日次献立成功枠を Free 1 / Plus 5 にする

- 日付: 2026-09-08
- 状態: **レビュー確定分を反映済み。実装計画待ち**
- 対象: 1 日献立の**成功回数**（`planQuota.*.successPerDay`）と、それを見せる UI / ENV / SQL 許可リスト
- 種別: 既存ロック値の改訂。新機能は作らない
- レビュー: `docs/superpowers/reviews/2026-09-08-daily-success-quota-1-5-{primary,secondary,adversarial,false-positive-check}.md`
  偽陽性チェック **REVISE**。確定 Critical 1（U-C1）+ Important 6（U-I1..U-I6）を本文へ反映済み。

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
6. スナップショット CHECK は discovery drop してから named で付け直す。ADD だけの ALTER は禁止する（U-C1）。
7. RPC はファイル単位コピー禁止。関数本体だけをコピーし、whitelist 行以外はバイト一致させる（U-I1）。
8. SQL と Functions は同一メンテ窓で適用する。片側だけだと reserve / status / usage-today が同時に死ぬ（U-I6）。

## 3. 変えるもの / 変えないもの

### 3.1 変える

- Free 成功枠: `FREE_SUCCESS_PER_DAY = 1`、`FREE_SUCCESS_PER_DAY_ENV = "1"`
- Plus 成功枠: `plusQuota.successPerDay = 5`
- TS の `planQuota.defense.maxSuccessPerDay`（Plus 成功枠から導出されるため **5** になる）
- Zod の `userDailyLimit` リテラル（`1 | 5`）
- SQL RPC の `p_user_limit` 許可: `(3, 10)` → `(1, 5)`
- リクエスト行の `quota_success_limit` 列: 既定値 `1`。CHECK は歴史値を残して **1 本だけ** `in (1, 3, 5, 10)`（旧 `in (3, 10)` は DROP する）
- 画面文言の「1 日最大 10 回」→「1 日最大 5 回」（Plus）。残数表示は定数から組み立てる
- ロック ENV `USER_DAILY_AI_LIMIT`: リポジトリ側の compose / `.env.example` / preflight 期待を `"1"` にする
- 運用文書のうち現行の成功回数を書くもの: `README.md` の枠表とスモーク、「枠 10」表記、`docs/deployment/netlify.md`、`docs/deployment/README.md`
- `generation-repository.ts` の Free 埋め込みリテラル `3` → `planQuota.free.successPerDay`（裸の `1` 禁止）

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

`docs/archive/` の旧設計・旧計画は更新しない。隣接する現行 spec（例: `2026-08-09-free-tier-monetization-decision.md`、`2026-09-02-weekly-plan-design.md`）の 3/10 記述も編集しない。本切替後の製品正は本書の 1/5 である。

ルート `README.md` に `USER_DAILY_AI_LIMIT` キーは無い。キーを新しくミラーしない。表の成功回数（3 / 10）とスモークの「成功枠 10」だけを 1 / 5 に直す。

## 4. 正本と同期

既存コメントどおり、数値の無断ミラーを増やさない。

| 値 | 正本 | 追随 |
| --- | --- | --- |
| Free 成功 | `shared/contracts/plan-quota-constants.mjs` の `FREE_SUCCESS_PER_DAY` / `_ENV` | `plan-quota.ts` の `planQuota.free`、`releaseQuota.userDailySuccessLimit`、preflight の `USER_DAILY_AI_LIMIT`、compose、`.env.example` |
| Plus 成功 | `shared/contracts/plan-quota.ts` の `plusQuota.successPerDay` | `planQuota.plus`、`planQuota.defense.maxSuccessPerDay`、Zod リテラル |
| SQL `p_user_limit` | 新規マイグレーション（dual-write 残差。mjs を変えても SQL は自動追随しない） | 下記 3 関数の現行 CREATE OR REPLACE **本体だけ** |

### 4.1 コピーしてよい関数（U-I1）

ファイルをコピーするな。関数本体だけをコピーしろ。古い migration は編集しない。

| コピーしてよい関数 | コピー元ファイル（最終 CREATE OR REPLACE） | 同じファイル内で触るな関数 |
| --- | --- | --- |
| `reserve_ai_generation` | `supabase/migrations/20260831120000_novelty_preference.sql` | `save_generation_draft`、`get_ai_generation_submission_snapshot`。同ファイル外の stale reserve（`20260808` / `20260729`）も禁止 |
| `get_ai_usage_today` | `supabase/migrations/20260808120000_quality_monthly_retry_and_usage_stale_cleanup.sql` | 同ファイルの stale `reserve_ai_generation`（novelty なし）。`20260729` の usage も禁止 |
| `get_ai_generation_status` | `supabase/migrations/20260729140000_plan_aware_quota.sql` | 同ファイルの stale reserve / usage |

新規ファイル名は `supabase/migrations/20260908120000_daily_success_quota_1_5.sql`（既存 `20260903` より後）。

各関数はコピー元とバイト一致させ、次の 1 行だけを変える。

```
if p_user_limit is null or p_user_limit not in (3, 10)
```

↓

```
if p_user_limit is null or p_user_limit not in (1, 5)
```

`p_attempt_limit in (6, 20)` と `p_short_window_limit in (4, 8)` は触らない。usage の quality.limit 3 / flyerWeekly 2/6 リテラルと `least(consumed, p_user_limit)` も触らない。reserve は `novelty_preference` を submission に書いたままにする。

## 5. SQL の防御と歴史行

### 5.1 RPC 許可リストと片側適用（U-I6）

`p_user_limit` が `1` または `5` 以外なら現行どおり `release_quota_mismatch`（SQLSTATE `22023`）。

SQL と Functions（1 / 5 を送る側）は**同一メンテ窓**で適用する。片方が古いと、献立作成だけでなく次が同時に死ぬ。ゼロダウンタイム用の新旧併記は採用しない。

| 経路 | 片側適用時 |
| --- | --- |
| reserve / status | SQLSTATE 22023 `release_quota_mismatch` → Functions は 500 `release_quota_mismatch` |
| `GET /api/usage/today` | 同じ 22023 を写像せず throw → 500 `request_failed` |
| finalize | `p_user_limit` を取らない。進行中の succeed 自体は生き得る。status poll は 500 |

### 5.2 スナップショット列（U-C1）

`private.ai_generation_requests.quota_success_limit` の現行 CHECK は無名 inline `in (3, 10)`（`20260729140000_plan_aware_quota.sql`）。PostgreSQL は CHECK を AND する。旧制約を残して新 CHECK だけ足すと ALTER は成功し、切替後の 1|5 INSERT だけが `23514` になる。

新 migration で次をこの順に行う。ADD だけの ALTER は禁止。

1. `pg_constraint` から `private.ai_generation_requests` かつ定義に `quota_success_limit` を含む CHECK を discovery drop する（identity CHECK の `20260729140000` 9–30 行と同型。制約名の決め打ち DROP は禁止）。
2. named で `CHECK (quota_success_limit in (1, 3, 5, 10))` を付け直す。
3. `ALTER COLUMN quota_success_limit SET DEFAULT 1`。

歴史行を 3→1 / 10→5 に書き換えない。当日すでに成功 2 以上の Free、および 6〜10 の Plus は、新上限により残数 0 になる。これは意図した切替である。in-flight の reserved→success は和が不変なので identity CHECK 10 のままで壊れない。

### 5.3 identity CHECK

`private.ai_identity_daily_usage` の `reserved_count + success_count <= 10` は維持する。Plus 成功を 5 に下げても、既存行が 6〜10 のときに CHECK を 5 へ落とすと進行中の予約更新が壊れる。物理天井 10 と製品上限 5 の差は受け入れる。Zod / Functions は `planQuota.defense.maxSuccessPerDay`（5）を超える limit を受理しない。usage の `least(consumed, p_user_limit)` をコピー元どおり残すので、台帳 8 + `p_user_limit=5` は `{limit:5, remaining:0, consumed:5}` で閉じる。

## 6. UI 文言

ユーザー向けは日本語。回数は裸の `10` を残さず、原則 `planQuota.plus.successPerDay` / `planQuota.free.successPerDay` から組み立てる。

少なくとも次を新数字に合わせる。

- `src/features/billing/plus-cta.tsx` の `PLUS_HARD_LIMIT_COPY`
- `src/features/billing/plan-settings-section.tsx` の「1 日最大 10 回」
- Plus LP 比較表（すでに `planQuota` 参照なら定数変更で追随する）
- 関連 unit / e2e の exact 文面（`1 日最大 5 回`）
- `shared/copy/plan-tier.test.ts` の「1日最大10回」

Free 向けに成功回数を前面に出さない既存方針（定性表現）は維持する。硬上限 CTA の Plus 側回数だけが必須の数字である。

## 7. 環境変数（U-I5）

`USER_DAILY_AI_LIMIT` は Free 成功枠と同一文字列でなければならない。ゲートは二段ある。

1. 保護 runner の `scripts/preflight-production.mjs`（`FREE_SUCCESS_PER_DAY` 照合）。`netlify.toml` の production `build` はこの preflight を呼ばない。
2. ランタイム `parseServerEnv`（`env.ts` の `releaseLockedInteger(releaseQuota.userDailySuccessLimit, FREE_SUCCESS_PER_DAY_ENV)`）。失敗は `server_configuration_invalid`。`getServerEnv` は generation だけでなく usage-today / billing / auth / flyer / weekly-plan / delete-account も呼ぶ。

| 場所 | 変更後 |
| --- | --- |
| `shared/contracts/plan-quota-constants.mjs` | `1` / `"1"` |
| `compose.yaml` | `"1"`（ハードコード。`${USER_DAILY_AI_LIMIT}` ではない。ローカル app の正本） |
| `.env.example` | `1` |
| ローカル `.env`（gitignore） | app は読まない。compose を `"1"` にしないと起動しない |
| 本番 Netlify | **新デプロイと `USER_DAILY_AI_LIMIT=1` を同時**。稼働中の旧デプロイに向けて先に `env:set` しない |

新コード × ENV `"3"` も、旧コード × ENV `"1"` も起動不能。試行・短時間の ENV は現行のまま（`6` / `4` / `600`）。

## 8. テスト（U-I2 / U-I3）

RED で現行の成功枠期待を壊し、GREEN で `1` / `5` に合わせる。

変えてよい 3 / 10 は **Free 成功・Plus 成功・`USER_DAILY_AI_LIMIT`・「1 日最大」系だけ**。触るな: 品質 3/日、flyer 2/6、試行 6、短時間 4/8、`repeat('3', 64)`、品質台帳の `success_count = 3`。

### 8.1 契約 / ENV / copy

- `shared/contracts/plan-quota.test.ts`（free 1、plus 5、defense 5）
- `scripts/preflight-production.test.mjs` と `netlify/functions/_shared/env.test.ts` の `USER_DAILY_AI_LIMIT: "1"`。拒否に `"3"` を含める（`"5"` は ENV としては今も不正のまま残してよい）
- `tests/tooling/compose.test.mjs` の compose 文字列
- `netlify/functions/_shared/openrouter.test.ts` と `generation-adversarial.integration.test.ts` の ENV `"3"`

### 8.2 Zod / fixture

- `generation.test.ts` の「非製品 limit（例: 5）」を「非製品 10 および 3」に入れ替え。Plus remaining の上限例は 5 以下。`userDailyLimit: 10` / remaining 7 は 5 以下へ。
- `shared/testing/factories.ts` の **success** だけ `consumed + remaining === planQuota.free.successPerDay`（例: consumed 0 / remaining 1、または consumed 1 / remaining 0）。shortWindow の `remaining: 2`（limit 4）は触るな。quality の `limit: 3` は触るな。
- `userDailyLimit: 3` / `p_user_limit: 3` / Plus `limit: 10` / `consumed: 10` の unit 艦隊を 1|5 へ。

### 8.3 repository

- `parseRequestPayload(..., 3)` を `planQuota.free.successPerDay` に。コメント 3|10 を 1|5 へ。
- repository / usage-today の `p_user_limit: 10` と Plus remaining 9 を 5 系へ。

### 8.4 pgTAP（新 migration 適用後の `db:test` 全体。scoped 実行だけで SQL 完了としない）

- 拒否 fixture を現行の **5 から 3 および 10** に入れ替え（5 は Plus 正規値）。
- Plus 受理・スナップショット・usage の 10 は 5。Free 受理は 1。
- `3, 6, 4` → `1, 6, 4`、`10, 20, 8` → `5, 20, 8`（試行 6/20・短時間 4/8 は残す）。
- Free 残数断言（`consumed + remaining <> 3`、空台帳 remaining/limit 3、成功 2+予約 1 の満杯）を 1 枠に縮める。limit 1 では 2+1 は製品超過なので、満杯 fixture は reserved 1 または success 1 にする。
- 新 CHECK が **1 本だけ** `in (1, 3, 5, 10)` であること、既定値が 1 であること、INSERT 1|5 と歴史 3|10 が生き、2/4 は 23514。
- 品質台帳の `success_count = 3` は残す。`identity_daily_quota.test.sql` の不正 identity 引数は入れ替えてもよいが必須根拠ではない。

### 8.5 e2e / 文言

- `e2e/specs/billing-plus.spec.ts` の「1 日最大 10 回」と usage mock の `limit` / `remaining` を 5。quality.day.limit 3 は触るな。
- Plus CTA / planner / regeneration の文面テスト。

検証コマンドは Task 対象ファイルに絞る。`db:test` と e2e はホストの `docker compose` 直実行（`app` コンテナ内の `npm run db:test` は使わない）。

必須スキャン（実装コード）: `successPerDay: 10`、`in (3, 10)`、`not in (3, 10)`、`USER_DAILY_AI_LIMIT`、`1 日最大 10`、`1日最大10`、`quota_success_limit`。テストはそれに加え `userDailyLimit: 3`、`p_user_limit: 3`、`limit: 10`（成功枠）、`remaining: 7`、success の `remaining: 2`（Free フル残のつもり）、`consumed: 10`。

## 9. 対象外

- 試行枠・短時間窓の比率変更
- 週献立 / チラシ週次 / 品質モードの回数変更
- Plus 価格、trial、`PLUS_LP_UPGRADE_COMING_SOON`
- identity CHECK を 5 に下げる後続作業
- `docs/archive/` の歴史文書の改訂
- 隣接現行 spec の 3/10 記述の改訂
- git push、PR 作成、本番/staging deploy、Netlify ENV のエージェント操作
- `src/shared/types/database.generated.ts` の手編集（`p_user_limit: number` のままで足りる）

## 10. 受け入れ

- Free は JST 1 日あたり成功 1 回でそれ以上を予約できない。
- Plus は成功 5 回でそれ以上を予約できない。
- 試行 6/20・短時間 4/8/600s は現行どおり拒否・許可される。
- `GET /api/usage/today` の `success.limit` は entitlement に応じて 1 または 5。
- Free 硬上限画面と設定の Plus 案内は「1 日最大 5 回」。
- `p_user_limit` に 3 または 10 を渡すと `release_quota_mismatch`。5 を渡すと Plus として受理する。
- 歴史行の `quota_success_limit` が 3 または 10 でも読取・既存制約は壊れない。CHECK は 1 本だけ `in (1, 3, 5, 10)`。1 と 5 の INSERT が生き、2 と 4 は 23514。
- preflight と `parseServerEnv` は `USER_DAILY_AI_LIMIT=1` のみを受け入れ、`3` を拒否する。
- usage JSON に quality と flyerWeekly が残る。reserve が `novelty_preference` を submission に書く。
- Plus 台帳 success 8 + `p_user_limit=5` の usage は `{limit:5, remaining:0, consumed:5}` で 200。
- `generation-repository` の quality 降格 fill 後の `user_daily_limit` は 1。
