# 今週の献立（週献立）設計 — Plus 差別化 Phase 1

作成日: 2026-09-02
状態: 設計承認済み（実装計画は別途 `docs/superpowers/plans/` に作成）

## 1. 目的と範囲

### 背景

無料プランは 1 日 3 回の日次献立生成で「毎日の一食」に十分であり、Plus（月 580 円 / 年 5,800 円）との差が「回数」と「くわしく作る」に限られている。チラシ週次（`/api/flyer-weekly`）は Plus 限定機能として実装済みだが、`FLYER_WEEKLY_UI_ENABLED = false` で UI は非表示。Stripe は未契約で、Plus の申込ゲート（`PLUS_LP_UPGRADE_COMING_SOON = true`）も閉じたまま。

本設計は、Free と Plus の線引きを「回数」から「価値」へ移す第一歩として、**「今日の一食は Free、今週の食卓は Plus」** を成立させる「今週の献立」機能を定義する。

### スコープ

- 家族条件から 7 日分の主菜骨格（主菜名・副菜名・食材名・メモ）を 1 回の AI 呼び出しで作る Plus 限定機能。
- 各日をタップすると既存のプランナー下書きに主菜と食材を入れ、日次生成へ展開できる。
- 結果は public テーブルに保存し、履歴タブから再訪できる。
- Free にはチラシと同型のロック表示のみ。
- Plus LP の 3 メリットの 3 枚目を「チラシから 1 週間」から「今週の献立」へ差し替える。

### スコープ外

- 7 日分のレシピ・買い物リストの一括生成（完成型）。
- 週の買い物リスト集約。
- 骨格出力への食材タグ付与（年齢帯タグ規則の充足）。
- Free 向けの月次お試し枠。
- チラシ UI の再表示、日次生成枠・Plus 価格・週次枠の数値変更。
- Stripe 契約と申込ゲートの開放。

## 2. アーキテクチャ

### 構成

| 層 | 追加 / 変更 | 内容 |
|---|---|---|
| 契約 | `shared/contracts/weekly-plan.ts` 新設 | リクエスト / レスポンス / エラーコード / 文言 |
| Function | `netlify/functions/weekly-plan.ts` 新設 | `POST /api/weekly-plan`（JSON body） |
| サービス | `netlify/functions/_shared/weekly-plan-service.ts` 新設 | 予約 → 生成 → 検査 → 保存 → 確定 |
| プロンプト | `netlify/functions/_shared/weekly-plan-prompt.ts` 新設 | 対象メンバー安全条件を載せた週献立専用プロンプト |
| 共用切り出し | `generation-prompt.ts` の member 整形部を関数化 | 日次と週で同じ整形を使う。日次の挙動は不変 |
| DB | `supabase/migrations/<ts>_weekly_plans.sql` 新設 | `public.weekly_plans` + RLS |
| ブラウザ | `src/features/weekly-plan/` 新設 | 入口カード、フォーム、結果、履歴カード、ロック表示 |
| ルート | `src/app/router.tsx` | `/weekly`, `/weekly/:weeklyPlanId` 追加。ボトムナビは 5 タブのまま |
| プランナー | `planner-route.tsx` | footer 枠に入口カード、下書き引き継ぎの受け口 |
| 履歴 | `history-page.tsx` | 先頭に「今週の献立」枠 |
| Plus LP | `plus-landing-page.tsx` | 3 枚目カードの文言とアイコン差し替え |

### 処理順（サービス）

チラシ週次と同一順序。SQL 関数は既存の `reserve_flyer_weekly` / `mark_flyer_weekly_sent` / `finalize_flyer_weekly_success` / `finalize_flyer_weekly_failure` をそのまま呼び、SQL 側は改修しない。

1. 現行 privacy notice への同意確認（未同意は 422、予約なし）
2. entitlement 読取。Plus でなければ 403、予約なし
3. 対象メンバーの現在安全条件を読取。満たせない制約があれば 422、予約なし
4. `reserve_flyer_weekly`（週次成功 / 試行、日次試行、短時間窓、全体枠）
5. モデル政策確認 → `mark_flyer_weekly_sent`
6. OpenRouter 呼び出し（structured output、既存 allowlist）
7. Zod 検証 → 保証フレーズ検査 → 対象メンバー安全条件で 7 日全食材を検査
8. `public.weekly_plans` へ admin クライアントで 1 行 insert
9. `finalize_flyer_weekly_success`（`result_payload` にも従来どおり保存し、sticky 再表示経路を維持）

### 週次枠

`planQuota.flyerWeekly`（成功 2 回 / JST 週、試行 6 回 / JST 週）をチラシと**共有**する。契約側に共有である旨をコメントで固定する。数値は変えない。

### 境界

- ブラウザは `@shared/contracts/weekly-plan`、`@shared/contracts/planner`、`@shared/safety-pure/*` のみ参照。`@shared/safety/*` は参照しない。
- 安全検査（`assertFlyerMenuAgainstSafety` の流用と保証フレーズ検査）は Functions 側に閉じる。
- 既存の locked export は再定義しない。`generation-prompt.ts` からの切り出しは新関数 export の追加のみ。

## 3. データと契約

### リクエスト

```ts
weeklyPlanRequestSchema = z.object({
  idempotencyKey: z.uuid(),
  targetMemberIds: z.array(z.uuid()).min(1).max(PLANNER_TARGET_MEMBER_LIMIT),
  cuisineGenre: z.enum(cuisineGenres),              // japanese | western | chinese | any
  budgetPreference: z.enum(budgetPreferences).nullable(),
  noveltyPreference: z.enum(noveltyPreferences).nullable(),
}).strict();
```

household モードのみ。idea モード（人数指定）は持たない。enum と上限は `shared/contracts/planner.ts` / `domain.ts` の既存定数を import する。

### レスポンス

```ts
weeklyPlanResultSchema = z.object({
  weeklyPlanId: z.uuid(),
  weekStartJst: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  days: z.array(weeklyFlyerDaySchema).length(7),     // チラシと同一の日型を再利用（dayIndex 1..7 一意）
  targetMemberIds: z.array(z.uuid()),
  safetyFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
```

### エラーコードと文言（日本語固定）

| コード | 文言 |
|---|---|
| weekly_plan_requires_plus | 今週の献立づくりは Plus の機能です。 |
| weekly_plan_weekly_limit | 今週の週献立の作成上限に達しています。 |
| weekly_plan_try_limit | しばらくしてから再度お試しください。 |
| weekly_plan_invalid_ai_response | 週献立を正しく確認できませんでした。作成の試行回数は使われている場合があります。 |
| weekly_plan_persist_failed | 週献立を保存できませんでした。時間をおいてもう一度お試しください。 |
| weekly_plan_unsatisfiable_member | この家族向けの週献立は作れません。日ごとの献立作成をご利用ください。 |

日次・短時間窓・全体枠・同意・モデル不可・タイムアウト・処理中重複は既存 `issueMessages` のコードをそのまま使う。

### DB: `public.weekly_plans`

| 列 | 型 | 制約 |
|---|---|---|
| id | uuid | PK default gen_random_uuid() |
| user_id | uuid | not null, FK auth.users on delete cascade |
| week_start | date | not null。JST 月曜（`private.ai_jst_week_start` と同式） |
| source | text | not null, CHECK in ('household') |
| request_id | uuid | not null。`private.flyer_weekly_requests.id`。FK は張らない |
| preference_snapshot | jsonb | not null。`{ targetMemberIds, cuisineGenre, budgetPreference, noveltyPreference }` のみ |
| safety_fingerprint | text | not null, CHECK `~ '^[a-f0-9]{64}$'`。日次 menus と同じ算出 |
| days | jsonb | not null。Zod 通過後の 7 日分 |
| created_at | timestamptz | not null default now() |

- インデックス: `(user_id, created_at desc)`。同一週に複数行を許す（unique なし）。
- RLS: 所有者 select のみ（`(select auth.uid()) = user_id`）。authenticated に insert / update / delete を grant しない。書き込みは Function の admin クライアントのみ。
- 保存しないもの: プロンプト、生の AI 出力、メンバー名・呼び名、アレルギー本文。
- `src/shared/types/database.generated.ts` は手編集せず、マイグレーション適用後に既存の生成コマンドで更新する。

### 下書きへの引き継ぎ

結果画面の「この日の献立を作る」は既存 `savePlannerDraft` で次を書いて `/planner` へ遷移する。新しい下書き列は足さない。

- `targetMode: "household"`, `targetMemberIds`: 週献立の対象メンバー
- `cuisineGenre`: 週献立の値
- `mainIngredients`: その日の `ingredients` 先頭 `PLANNER_MAIN_INGREDIENT_LIMIT` 件
- `memo`: `主菜: {mainName}`（`PLANNER_MEMO_TEXT_MAX` 内に切り詰め）

## 4. 画面と導線

すべて `src/features/weekly-plan/` に閉じる。320 CSS px で横スクロールなし、タッチターゲット 44×44 以上、既存の `card` / `stack` / `primary-button` / `secondary-button` クラスに合わせる。

### 4.1 入口カード（プランナー home の footer 枠）

- Plus: 「今週の献立」カードと「今週の献立をつくる」ボタン（`/weekly`）。
- Free: チラシ `flyer-weekly-locked` と同型のロック表示。月〜水のダミー 3 行、「今週の献立づくりは Plus の機能です」、注記「作成できるかは Plus 契約をサーバーで確認します」、CTA「Plus を見る」（`/plus`）。
- 表示切替は `usage-today` の `plusEntitled`。作成可否はサーバが毎回確認する。

### 4.2 条件フォーム（`/weekly`、Plus のみ）

- 1 画面 4 項目。作る相手（家族チェックボックス。`audience-step` の部品を流用）、ジャンル、予算、目新しさ。既定値は家族全員 / おまかせ / 標準 / 標準。
- 上部に「今週の残り: 成功 n / 2、試行 m / 6」を `usage-today` の flyerWeekly 投影から表示。残 0 は送信無効 + 理由表示。
- 満たせない制約を持つメンバーには警告を出し、チェックを外せる。全員が該当なら送信無効。
- 送信中は `generation-status-panel` と同じ待機表現。`idempotencyKey` は sticky（sessionStorage）で二重送信を防ぐ。
- 今週すでに成功があれば「今週の献立はあります」と最新結果へのリンクを上部に出す。

### 4.3 結果画面（`/weekly/:weeklyPlanId`）

- 月〜日の 7 行。主菜名、副菜名、食材チップ、メモ。
- 各行「この日の献立を作る」→ 下書き保存 → `/planner`。下書きが dirty なら既存の leave-flush と同じ確認。
- 日次と同じ安全性注記（保証しない旨）を必ず表示。
- `safetyFingerprint` が現在の家族安全条件と一致しなければ「家族の設定が変わっています。作り直してください」を注記し、「この日の献立を作る」は有効のまま（日次生成側で現在条件により再検査される）。
- 履歴からも同じ画面へ着地。

### 4.4 履歴タブ

- 一覧先頭に「今週の献立」枠。最新の `weekly_plans` 1 件をカード表示。
- 過去週は「これまでの週献立」として折りたたみ。
- 日次の履歴グループ表示は変更しない。

### 4.5 Plus LP と設定

- LP の 3 枚目カードを「今週の献立」に差し替え（タイトル・本文・アイコン）。チラシの文言定数は残すが LP から参照しない。
- 設定の枠切れ CTA 文言に「今週の献立」の一言を追加。

## 5. エラー処理と安全性

### 対象メンバー基準

検査対象は「フォームで選んだ対象メンバー」とし、日次生成と同じ基準にそろえる（チラシの「全 complete メンバー」基準とは異なる）。「小さく切る」制約、または年齢帯の `requires_tag` 規則に該当するメンバーが対象に含まれる場合、骨格出力はタグ証拠を持てないため生成しない。ブラウザで事前に警告し、サーバでも試行消費前に 422 で二重に拒否する。

### エラー体系

| 段階 | コード | HTTP | 枠消費 |
|---|---|---|---|
| 同意なし | consent_required | 422 | なし |
| Free | weekly_plan_requires_plus | 403 | なし |
| 週 2 回成功済み | weekly_plan_weekly_limit | 429 | なし |
| 週 6 回試行済み | weekly_plan_try_limit | 429 | なし |
| 日次試行・短時間窓・全体枠 | 既存コード | 429 | なし |
| 対象に満たせない制約 | weekly_plan_unsatisfiable_member | 422 | なし |
| 処理中の重複 | generation_in_progress | 409 | なし |
| モデル不可・タイムアウト | model_unavailable / generation_timeout | 503 | 試行のみ |
| Zod 不一致・保証フレーズ・安全ヒット | weekly_plan_invalid_ai_response | 400 | 試行のみ |
| 保存失敗 | weekly_plan_persist_failed | 500 | 試行のみ（成功枠は返す） |

- 安全ヒット・Zod 不一致時は本文を返さず、ログにも残さない。
- 保存失敗は `finalize_flyer_weekly_failure` で閉じる。処理中孤児は既存の 180 秒 stale 解放に任せる。
- 429 はブラウザで残り枠と週の切替日を表示。503 / 500 は同じ `idempotencyKey` で再試行ボタン。409 は「作成中です」表示後に自動再送。

### 安全性の原則

- プロンプトに載せるのは対象メンバーの allergenIds、カスタムアレルギーの正規化名、必須制約、嫌いなもの。氏名・呼び名・非対象メンバーの情報は載せない。
- 生成後は対象メンバーの現在条件で 7 日全食材を検査。1 件でもヒットすれば全体を捨て、部分成功は返さない。
- 「安全です」「アレルギー対応済み」等の保証フレーズは既存検査で落とす。
- Plus 失効後は新規作成不可、保存済み閲覧のみ可。
- 現在の家族安全条件は常に保存済みスナップショットより優先する。結果画面の fingerprint 不一致注記はそのための表示であり、再検査 API は作らない。

## 6. テスト

すべて TDD（RED → GREEN）。チラシ週次のテスト構成を写す。

### 契約 `shared/contracts/weekly-plan.test.ts`
- strict 拒否、対象 0 人拒否、上限、enum 外拒否。
- 7 日一意性、`weekStartJst` 形式、保証フレーズ含有本文の拒否。
- エラーコード ↔ 文言の閉じた対応。

### プロンプト `weekly-plan-prompt.test.ts`
- 対象メンバーの安全条件がシステムメッセージに載る。呼び名・氏名・非対象メンバー情報が載らない。
- 切り出し後も `generation-prompt` の既存テストが緑。

### サービス `weekly-plan-service.test.ts` / `.pipeline.test.ts`
- 同意なし → 422 で reserve 未呼出。Free → 403 で reserve 未呼出。満たせない制約 → 422 で mark 未呼出。
- 429 の各種が正しい retryAt を返し試行を焼かない。
- mark 後の 400 系は試行のみ消費、本文・ログに AI 出力なし。
- 保存失敗は failure で閉じ成功枠が戻る。
- 成功時 `weekly_plans` 1 行、`preference_snapshot` は id と enum のみ、fingerprint は日次と同算出。
- 同一 `idempotencyKey` 再送で OpenRouter 未呼出、保存済み結果を返す。

### Function 境界 `netlify/functions/_tests/weekly-plan-idempotency.test.ts`
- 冪等キー再送、Plus 失効後の sticky 再表示、不正 JSON は 400。

### DB pgTAP `supabase/tests/database/weekly_plans.test.sql`
- 他人の select 0 行。authenticated の insert / update / delete が権限エラー。
- `source` / `safety_fingerprint` CHECK。ユーザー削除で cascade。

### ブラウザ Vitest
- 入口カード（Plus / Free）、フォーム（既定値、残 0 無効、警告とチェック外し）、結果（7 行、下書き保存と遷移、dirty 確認、fingerprint 注記）、履歴（先頭枠と折りたたみ）、Plus LP（3 枚目差し替え）。
- 320px レイアウトとタッチターゲットは既存 accessibility テストに追加。

### E2E `e2e/specs/weekly-plan.spec.ts`
- Plus モック: 作成 → 結果 → 日タップ → プランナーに条件が入る。
- Free: ロック表示 → `/plus` 着地。
- OpenRouter mock に週献立用固定応答を 1 件追加。

### 検証コマンド
- 単体 / 契約 / lint / typecheck / format:check は `docker compose run --rm --no-deps app ...` で focused に実行。
- pgTAP は `docker compose --profile test run --rm db-test`、E2E は `./scripts/run-e2e.sh` をホストで実行し、結果要約を人が貼る。

## 7. 実装順（plan の章立て目安）

1. 契約 + マイグレーション + pgTAP
2. プロンプト切り出し + 週献立プロンプト
3. サービス + Function + 境界テスト
4. ブラウザ API / hooks + 入口カード + ロック表示
5. フォーム + 結果画面 + 下書き引き継ぎ
6. 履歴枠 + Plus LP 差し替え + 設定 CTA
7. E2E + accessibility 追加
