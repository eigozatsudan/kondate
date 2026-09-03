# 今週の献立（週献立）設計 — Plus 差別化 Phase 1

作成日: 2026-09-02
改訂: 2026-09-02 rev2（一次 / 敵対的 / 裁定レビュー P-01〜P-11 を反映。
`docs/superpowers/reviews/2026-09-02-weekly-plan-{primary,adversarial,adjudication}.md`）
改訂: 2026-09-02 rev3（再レビュー R-01〜R-10 を反映。P-05 / P-08 / P-09 / P-10 / P-11 の残穴を閉じる）
改訂: 2026-09-02 rev4（rev3 レビュー N-C-1 / N-C-2 / N-I-3 / R-03 mock / R-05 入口 / R-07 POST / R-10 client / I5 を反映。
`docs/superpowers/reviews/2026-09-02-weekly-plan-rev3-{primary,adversarial,adjudication}.md`）
改訂: 2026-09-02 rev5（rev4 レビュー N-C-3（`run_kondate_maintenance` の 9 キー契約）/ R-07（sticky 再生から 400 を撤去し GET と同じ `staleSafety` 規則へ統一）/ N-I-4（replayed+stash insert の intent 読取）/ N-I-5（503 timeout は sticky 破棄、500 persist/stash は同一キー）/ N-I-8（maintenance 再定義のクローン元と executor 限定 GRANT）を反映。
`docs/superpowers/reviews/2026-09-02-weekly-plan-rev4-{primary,adversarial,adjudication}.md`）
改訂: 2026-09-02 rev6（rev5 レビュー N-I-10 を反映。R-07 の「再 assert では本文を止めない」を replayed+stash 再試行にも適用し、チラシ PE11 の finalize_failure 経路をそのまま流用しない旨を明記。400 写像を新規生成のみに限定し、client sticky 破棄も同コードに限定）。
`docs/superpowers/reviews/2026-09-02-weekly-plan-rev5-{primary,adversarial,adjudication}.md`）
状態: 設計改訂済み（実装計画は別途 `docs/superpowers/plans/` に作成）

## 1. 目的と範囲

### 背景

無料プランは 1 日 3 回の日次献立生成で「毎日の一食」に十分であり、Plus（月 580 円 / 年 5,800 円）との差が「回数」と「くわしく作る」に限られている。チラシ週次（`/api/flyer-weekly`）は Plus 限定機能として実装済みだが、`FLYER_WEEKLY_UI_ENABLED = false` で UI は非表示。Stripe は未契約で、Plus の申込ゲート（`PLUS_LP_UPGRADE_COMING_SOON = true`）も閉じたまま。

本設計は、Free と Plus の線引きを「回数」から「価値」へ移す第一歩として、**「今日の一食は Free、今週の食卓は Plus」** を成立させる「今週の献立」機能を定義する。

### スコープ

- 家族条件から 7 日分の主菜骨格（主菜名・副菜名・食材名・メモ）を 1 回の AI 呼び出しで作る Plus 限定機能。
- 各日をタップすると既存のプランナー下書きに主菜と食材を入れ、日次生成へ展開できる。
- 結果は public テーブルに保存し、履歴タブから再訪できる。
- Free にはチラシと同型のロック表示のみ。
- Plus LP の「チラシから 1 週間」を「今週の献立」へ全面差し替える（LEAD・カード・比較表・bullet）。

### スコープ外

- 7 日分のレシピ・買い物リストの一括生成（完成型）。
- 週の買い物リスト集約。
- 骨格出力への食材タグ付与（年齢帯タグ規則の充足）。
- Free 向けの月次お試し枠。
- チラシ UI の再表示、日次生成枠・Plus 価格・週次枠の数値変更、チラシ SQL 関数（reserve / mark / finalize / stash / lookup / cleanup_stale）の改修。
- PostgREST の露出スキーマ（`PGRST_DB_SCHEMAS = public,graphql_public`）の変更。private schema は Data API に出さない。
- Stripe 契約と申込ゲートの開放。

### ロックした前提（レビューで維持と判定）

- 週次枠はチラシと共有（成功 2 / 試行 6 per JST 週）。
- 安全検査の集合は「フォームで選んだ対象メンバー」（日次と同基準）。空集合は契約の `min(1)` で拒否。
- 骨格はタグを持たない。
- fingerprint 不一致でも「この日の献立を作る」は有効のまま（日次生成が現行条件で再検査する）。
- `/weekly` にルートガードは置かない。作成はサーバが 403 で止め、予約は発生しない。
- ブラウザは `@shared/safety-pure/*` と contracts のみ参照。

## 2. アーキテクチャ

### 構成

| 層 | 追加 / 変更 | 内容 |
|---|---|---|
| 契約 | `shared/contracts/weekly-plan.ts` 新設 | リクエスト / レスポンス / エラーコード / 文言 / 写像表 |
| Function | `netlify/functions/weekly-plan.ts` 新設 | `POST /api/weekly-plan`（JSON body）、`GET /api/weekly-plan/:id` |
| サービス | `netlify/functions/_shared/weekly-plan-service.ts` 新設 | lookup → 予約 → 生成 → 検査 → finalize → public 保存 |
| プロンプト | `netlify/functions/_shared/weekly-plan-prompt.ts` 新設 | 対象メンバー安全条件を載せた週献立専用プロンプト（テキストのみ） |
| 共用切り出し | `generation-prompt.ts` の member 整形部を関数化 | 日次と週で同じ整形。日次の挙動は不変 |
| DB | `supabase/migrations/<ts>_weekly_plans.sql` 新設 | `public.weekly_plans` + RLS + GRANT、`private.weekly_plan_intents`、intent 用 SECURITY DEFINER RPC 3 本、`run_kondate_maintenance` の再定義（intent 孤児回収） |
| ブラウザ | `src/features/weekly-plan/` 新設 | 入口カード、フォーム、結果、履歴カード、ロック表示 |
| ルート | `src/app/router.tsx` | `/weekly`, `/weekly/:weeklyPlanId` 追加。ボトムナビは 5 タブのまま |
| プランナー | `planner-route.tsx` | footer 枠に入口カード。下書き引き継ぎは既存 `savePlannerDraft` を使う |
| 履歴 | `history-page.tsx` | 先頭に「今週の献立」枠 |
| Plus LP / 設定 | `plus-landing-page.tsx` ほか | チラシ文言を「今週の献立」へ全面差し替え |

### 処理順（POST、チラシ PE11 と同順）

チラシの SQL 関数 `reserve_flyer_weekly` / `mark_flyer_weekly_sent` / `finalize_flyer_weekly_success` / `stash_flyer_weekly_result` / `finalize_flyer_weekly_failure` / `lookup_flyer_weekly` はそのまま呼び、改修しない。**週献立固有の SQL は intent 用 RPC 3 本と `run_kondate_maintenance` の再定義に限る**（rev3 の「SQL 関数は増やさない」は撤回。N-C-1）。

1. entitlement 読取（読取失敗は 503、予約なし）
2. **lookup を Plus 判定より前に置く**（PE2 と同型）。同一 `idempotencyKey` の `succeeded` 行があれば **sticky 再生経路**（§2「同一キー再 POST の 3 経路」）へ。OpenRouter は呼ばない。Plus 失効後もこの経路だけは通る
3. Plus でなければ 403、予約なし
4. 現行 privacy notice への同意確認（未同意は 422、予約なし）
5. 対象メンバーの現在安全条件を読取。**日次と同じ reserve 前 422 集合**（§5）に該当すれば 422、予約なし
6. `reserve_flyer_weekly`（週次成功 / 試行、日次試行、短時間窓、全体枠）
6'. 新規予約（`replayed` でない）なら `public.put_weekly_plan_intent(p_request_id, p_user_id, p_snapshot, p_fingerprint)` を admin の `rpc()` で呼ぶ。失敗は `finalize_failure(p_sent: false)` で reserved を解放して 500（試行非消費）
7. 残り予算が `REQUIRED_SEND_BUDGET_MS`（OpenRouter timeout + finalize 予約）未満なら `finalize_failure(p_sent: false)` で閉じる（試行非消費）
8. モデル政策確認（`plusModels`）。失敗は `finalize_failure(model_unavailable, p_sent: false)`。成功後に **同じ予算ゲートを再度**かけてから `mark_flyer_weekly_sent`
9. OpenRouter 呼び出し（テキストのみ、structured output）
10. Zod 検証 → 保証フレーズ検査 → 対象メンバー安全条件で 7 日全食材を検査。失敗は `finalize_flyer_weekly_failure`（試行のみ消費）
11. `finalize_flyer_weekly_success(p_result = { weekStartJst, days })`。失敗時は `stash_flyer_weekly_result` して 500。**`finalize_failure` は呼ばない**（reserved を解放すると週次成功 2 を踏まずに 200 を繰り返せる）
12. finalize 成功後に `public.weekly_plans` へ admin クライアントで insert（`request_id` UNIQUE、public 表なので PostgREST 経由で可）。insert 失敗は 500 `weekly_plan_persist_failed`。**成功枠は返さない**。同一キー再 POST が手順 2 の再試行経路で insert をやり直す
13. insert 成功後に `public.delete_weekly_plan_intent(p_request_id)` を best-effort で呼ぶ（失敗しても 200）

### 同一キー再 POST の 3 経路（R-08 / R-09 / R-10）

チラシ PE1 / PE11 と同型で、`lookup` / `reserve` の戻りに応じて分岐する。いずれも OpenRouter を呼ばない。**ただし現行安全条件の再 assert 失敗時の扱いはチラシ本体（`finalize_flyer_weekly_failure` を呼んで 400 terminal failed にする）から意図的に外れる**（R-07 / N-I-10）: 週献立は再生時点で本文を止めず、GET と同じ `staleSafety` 表示フラグに落とす。チラシの `flyer-weekly-service.ts` 自体は変更しない。

| 台帳の状態 | 経路 | 枠 | HTTP |
|---|---|---|---|
| `succeeded`（lookup hit）+ `weekly_plans` 行あり | `weekly_plans` 行を正とする。**intent は参照しない**（成功後に削除済みで正常。N-I-3）。GET と同じ規則で `staleSafety` を計算するだけで、**再 assert では本文を止めない**（対象メンバー欠損・非 complete・安全条件の読取不能は `staleSafety: true` のまま返す） | なし | 200（+`staleSafety`） |
| `succeeded`（lookup hit）+ `weekly_plans` 行なし | `result_payload`（`weekStartJst` + `days`）+ `get_weekly_plan_intent` で復元し insert → intent delete。**行あり経路と同じく本文は止めない**。GET と同じ規則で `staleSafety` を計算して返す。**intent が必須な経路の一つ**（もう一つは下の `replayed` + stash 経路）。intent も無ければ 500 `internal_error`（body から補完しない） | なし | 200（+`staleSafety`） |
| `succeeded` で `weekly_plans` 行自体が読めない（DB 接続エラー等） | 行あり・行なしのどちらの経路かも判定できない。GET の「行自体が読めない場合だけ 503」と同型 | なし | 503 |
| `processing` + `replayed: true` + stash 済み `result` あり（reserve hit） | finalize 失敗後の再入場。**stash から `finalize_flyer_weekly_success` だけ再試行**し、成功したら `weekly_plans` insert → 200。insert には `preference_snapshot` / `safety_fingerprint` が要るが body は使わない（当時の条件が正）ので `get_weekly_plan_intent` で読む（N-I-4。intent 書き込みは reserve 直後なのでこの経路では必ず存在する）。intent も無ければ 500 `internal_error`。finalize がまた失敗なら 500 のまま。**この経路もチラシ PE11 の再 assert をそのまま流用しない（N-I-10）**: lookup 再生と同じく現行安全条件の再 assert では本文を止めない。現行安全ヒット／保証フレーズ検査失敗でも `finalize_flyer_weekly_failure` は呼ばず、`finalize_flyer_weekly_success` の確定は保ったまま insert → 200 + `staleSafety: true`。400 は出さない（チラシ本体の PE11 実装は変えない。週献立サービス側で再 assert の失敗を「terminal failure」として finalize_failure へ渡さず、GET と同じ表示用フラグとして扱う分岐を追加する）。finalize の RPC 呼び出し自体が失敗した場合（安全性とは無関係）は従来どおり 500 | 成功枠は reserved のまま確定 | 200 / 500 |
| `processing` + `replayed: true` + stash なし | 他端末 / 前回リクエストが処理中 | なし | 409 `generation_in_progress` |

- 再 POST の body に新しい `targetMemberIds` / `cuisineGenre` が来ても**当時の snapshot と days を上書きしない**。当時の条件は `weekly_plans` 行（あれば）か intent（無ければ）から取り、body との差分は無視する（チラシの「同一キーは同一画像」と同じ扱い）。
- lookup の `succeeded` だけを見て「insert 再試行」を済ませると、finalize 失敗（stash 済み・status は `processing`）の再入場を取りこぼす。R-08 の経路は reserve の `replayed` で拾う。

### 順序の根拠（P-01）

insert → finalize の順にすると、finalize 失敗時に 180 秒 cleanup が reserved を解放し、`weekly_plans` だけが残る。同一 sticky は failed 再生で死に、新キーで再 POST すると週次成功 2 を踏まずに行が増える。finalize を先に確定し、public 行は finalize 済み request からいつでも再生成できる副産物として扱う。

### 週次枠と残数コピー（P-02）

`planQuota.flyerWeekly` をチラシと共有する。数値は変えない。ブラウザの残数表示と契約コメントは「今週の週献立（チラシ献立と共通）: 成功 n / 2、試行 m / 6」と明記する。

### モデルと wire（P-08）

- モデルは `env.openRouter.plusModels`。`flyerModels`（vision 専用）は使わない。
- メッセージは system + user のテキストのみ。`image_url` は送らない。
- wire は **既存の `mode: "flyer_weekly"` をそのまま使う**（R-03 案 A）。出力型はチラシと同一の `WeeklyFlyerMenu` なので、`GenerationWireMode` の union には値を足さず、`response_format` も既存の `weeklyFlyerMenuResponseFormat`（name `kondate_weekly_flyer_menu`、`strict: true`）を再利用する。週献立専用の json_schema 名は作らない。
- モデル政策は既存の allowlist / 価格上限 / `structured_outputs` と `response_format` 両対応チェックをそのまま通す。
- **予算ゲートは 2 段**（R-04）: reserve 直後と、`ensureModelPolicy` 成功直後の両方で `remainingMs() < REQUIRED_SEND_BUDGET_MS` を見る。後段で不足なら `finalize_flyer_weekly_failure(p_failure_code: "generation_timeout", p_sent: false)` で reserved を解放して 503。`ensureModelPolicy` 自体の `model_unavailable` も同じく `p_sent: false` で閉じる（試行非消費）。

### 境界

- ブラウザは `@shared/contracts/weekly-plan`、`@shared/contracts/planner`、`@shared/safety-pure/*` のみ参照。`@shared/safety/*`（`node:crypto` 依存の fingerprint を含む）は参照しない。
- 安全検査、fingerprint 算出と比較、保証フレーズ検査は Functions 側に閉じる。
- 既存の locked export は再定義しない。`generation-prompt.ts` からの切り出しは新関数 export の追加のみ。

## 3. データと契約

### リクエスト（POST）

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

### AI 出力 / `p_result`（P-03）

`finalize_flyer_weekly_success` の `p_result` と `stash` に渡すのは **`weeklyFlyerMenuResultSchema` 形（`weekStartJst` + `days` のみ）**。週献立固有のキー（`weeklyPlanId`、`targetMemberIds`、`safetyFingerprint`）は載せない。チラシの sticky 再生（`weeklyFlyerMenuResultSchema` strict parse）を壊さないため。

`weeklyPlanId` の正は `public.weekly_plans` 行。再生時は `request_id` で引く。

### レスポンス（POST 成功 / GET）

```ts
weeklyPlanResultSchema = z.object({
  weeklyPlanId: z.uuid(),
  weekStartJst: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  days: z.array(weeklyFlyerDaySchema).length(7),     // チラシと同一の日型を再利用
  targetMemberIds: z.array(z.uuid()),
  cuisineGenre: z.enum(cuisineGenres),
  /** true: snapshot の targetMemberIds 集合が現行 complete メンバー集合と一致しない（P-11 開示用。件数比較ではなく集合一致） */
  partialHousehold: z.boolean(),
  /** サーバ計算。保存時 fingerprint と現行対象メンバー条件の fingerprint が不一致（P-04） */
  staleSafety: z.boolean(),
}).strict();
```

`safetyFingerprint` はレスポンスに載せない。ブラウザは比較しない。

### GET `/api/weekly-plan/:weeklyPlanId`（P-04）

- 所有者は **`requireUser(request)` の JWT から取る `userId` のみ**（email 正規化は identity 枠用で GET には不要。POST は `requireUserWithEmail`。I5）。body / query / header の user 指定は受け取らず、あれば無視する（R-02）。`weekly_plans` 行は admin クライアントで `id = :id and user_id = :jwtUserId` で引き、無ければ 404（他人の id も 404）。
- `preference_snapshot.targetMemberIds` の現行安全条件から `createCurrentSafetyFingerprint` を再計算し、保存 `safety_fingerprint` と比較して `staleSafety` を返す。
- **対象メンバーの欠損・非 complete・安全条件の読取不能は 500 にしない**（R-07）。fingerprint を計算できない場合は `staleSafety: true` の 200 を返す。本文（days）はそのまま返す。DB 接続エラーなど行自体が読めない場合だけ 503。
- 再検査（食材の再 assert）は行わない。AI も呼ばない。枠も消費しない。
- Plus 失効後も所有者なら読める。

履歴一覧のカードは Supabase 直読（RLS select）で `id, week_start, created_at, days, preference_snapshot` を使い、`staleSafety` は結果画面（GET）でのみ表示する。

### エラーコードと SQL 写像（P-02）

| SQL / 内部コード | 週献立 HTTP コード | HTTP | 文言 |
|---|---|---|---|
| — | weekly_plan_requires_plus | 403 | 今週の献立づくりは Plus の機能です。 |
| flyer_weekly_limit | weekly_plan_weekly_limit | 429 | 今週の週献立（チラシ献立と共通）の作成上限に達しています。 |
| flyer_weekly_try_limit | weekly_plan_try_limit | 429 | しばらくしてから再度お試しください。 |
| user_attempt_limit / user_short_window_limit / global_daily_limit | 同名（既存） | 429 | 既存 `issueMessages` |
| generation_in_progress | 同名（既存） | 409 | 既存 |
| consent_required | 同名（既存） | 422 | 既存 |
| allergy_unconfirmed / allergen_missing / unsupported_diet_unconfirmed / unsupported_diet / current_target_member_required | 同名（既存） | 422 | 既存 |
| （cut_small / requires_tag 該当） | weekly_plan_unsatisfiable_member | 422 | この家族向けの週献立は作れません。日ごとの献立作成をご利用ください。 |
| model_unavailable / generation_timeout | 同名（既存） | 503 | 既存 |
| Zod 不一致 / 保証フレーズ / 安全ヒット（**新規生成のみ**。手順 10 の初回検査。lookup 再生・`replayed`+stash 再試行の再 assert はここに含めない。N-I-10） | weekly_plan_invalid_ai_response | 400 | 週献立を正しく確認できませんでした。作成の試行回数は使われている場合があります。 |
| finalize 失敗（stash 済み） | internal_error | 500 | 既存 |
| weekly_plans insert 失敗 | weekly_plan_persist_failed | 500 | 週献立を保存できませんでした。同じ条件でもう一度お試しください。 |

`mapFailureHttp` の週献立版は、この表を契約側の `weeklyPlanFailureCodeMap` として持ち、写像に無いコードは既存 `issueMessages` にフォールバックする。

### DB: `public.weekly_plans`（P-10）

| 列 | 型 | 制約 |
|---|---|---|
| id | uuid | PK default gen_random_uuid() |
| user_id | uuid | not null, FK auth.users on delete cascade |
| week_start | date | not null。JST 月曜（`private.ai_jst_week_start` と同式） |
| source | text | not null, CHECK in ('household') |
| request_id | uuid | not null, **UNIQUE**。`private.flyer_weekly_requests.id`。FK は張らない |
| preference_snapshot | jsonb | not null。`{ targetMemberIds, cuisineGenre, budgetPreference, noveltyPreference }` のみ |
| safety_fingerprint | text | not null, CHECK `~ '^[a-f0-9]{64}$'`。日次 menus と同じ算出 |
| days | jsonb | not null。Zod 通過後の 7 日分 |
| created_at | timestamptz | not null default now() |

- インデックス: `(user_id, created_at desc)`。同一週に複数行を許す。
- RLS / GRANT は menus と同型で、マイグレーション内で明示する:
  ```sql
  alter table public.weekly_plans enable row level security;
  revoke all on public.weekly_plans from anon, authenticated;
  grant select on public.weekly_plans to authenticated;
  create policy weekly_plans_owner_select on public.weekly_plans
    for select to authenticated using ((select auth.uid()) = user_id);
  grant all on table public.weekly_plans to service_role;
  ```
  `service_role` への `grant all` は必須（R-01）。`user_feedback` / `user_share_consents` と同じく明示する。これが無いと Function の admin insert が本番で 42501 になり、finalize 先行と組み合わさって「成功枠を焼いたのに public 行が作れない」状態になる。authenticated に insert / update / delete は grant しない。
- 保存しないもの: プロンプト、生の AI 出力、メンバー名・呼び名、アレルギー本文。
- `src/shared/types/database.generated.ts` は手編集せず、マイグレーション適用後に既存の生成コマンドで更新する。
- pgTAP で「他人 select 0 行」「authenticated insert が 42501」「service_role insert / update / delete 可」「request_id 重複が 23505」を固定する。

### DB: `private.weekly_plan_intents`（R-09 の条件保管）

sticky 再生と insert 再試行で「当時の条件」を body に頼らず復元するための AI 制御テーブル。private schema に置き、既定の revoke（extensions_and_schemas の default privileges）で anon / authenticated から見えない。

**アクセス経路（N-C-1）**: `getSupabaseAdmin()` は supabase-js → PostgREST で、露出スキーマは `public,graphql_public` のみ。private 表は PostgREST から届かないので、**表 GRANT は付けず、public の SECURITY DEFINER RPC 3 本だけで CRUD する**。`PGRST_DB_SCHEMAS` には private を足さない。

| RPC | 引数 | 動作 |
|---|---|---|
| `public.put_weekly_plan_intent` | `(p_request_id uuid, p_user_id uuid, p_snapshot jsonb, p_fingerprint text)` | upsert。`p_fingerprint` の形式を CHECK と同じ regex で検証 |
| `public.get_weekly_plan_intent` | `(p_request_id uuid, p_user_id uuid)` | `user_id` 一致行を返す。無ければ null |
| `public.delete_weekly_plan_intent` | `(p_request_id uuid)` | 削除。0 行でもエラーにしない |

3 本とも `security definer`、`set search_path = ''`、`revoke all on function ... from public, anon, authenticated` → `grant execute on function ... to service_role`（`lookup_flyer_weekly` と同じ型）。

| 列 | 型 | 制約 |
|---|---|---|
| request_id | uuid | PK。`private.flyer_weekly_requests.id`（FK は張らない） |
| user_id | uuid | not null, FK auth.users on delete cascade |
| preference_snapshot | jsonb | not null。`weekly_plans` と同形 |
| safety_fingerprint | text | not null, CHECK `~ '^[a-f0-9]{64}$'` |
| created_at | timestamptz | not null default now() |

- 表 GRANT は付けない（service_role にも付けない）。
- 書き込みは reserve 直後（新規予約時のみ）。読み取りは「`weekly_plans` 行が無い sticky 再生」と「`replayed` + stash 済み finalize 再試行後の insert」の 2 経路のみ（N-I-4）。
- `weekly_plans` insert 成功後に `delete_weekly_plan_intent` を best-effort で呼ぶ（失敗しても 200）。
- **孤児回収（N-C-2）**: `maintenance-cleanup` Function は `run_kondate_maintenance` しか呼ばず、executor は private を revoke されているので、Function 側にクエリは足さない。`run_kondate_maintenance` を新マイグレーションで再定義し、intent 削除を本体に加える。**クローン元は最新定義の `supabase/migrations/20260801200000_share_claim_reaper_counts.sql`**（本文をそのままコピーし、intent 削除のロジックだけ差し込む）。GRANT も同ファイルと同型で **`kondate_maintenance_executor` にだけ execute を許可**（`revoke all ... from public, anon, authenticated, service_role` → `grant execute ... to kondate_maintenance_executor`）。intent RPC 3 本の「service_role にだけ許可」パターンをここへ流用しない（N-I-8。誤って `service_role` に grant すると hourly cron の実行ロールが変わり 42501 になる）。削除述語は次の 2 つ **だけ**:
  - 対応する `flyer_weekly_requests` が `failed`、かつ `created_at` から 24 時間経過
  - 対応する `flyer_weekly_requests` が `succeeded`、かつ `public.weekly_plans` に同 `request_id` 行が **ある**（delete 取りこぼし）
  - `succeeded` で public 行が無い intent、および `processing` の intent は**残す**（persist 再試行用）。対応する request 行が無い intent は request の retention 削除に合わせて消す。
- **キー数は変えない（N-C-3）**: `maintenance-db.ts` の `parseCounts` は戻り jsonb のキーが `COUNT_KEYS`（9 個）ちょうどでなければ `closedError()` を投げ、`run_kondate_maintenance` トランザクション全体を COMMIT 前に失敗させる。pgTAP `maintenance_cleanup.test.sql:607` も「exactly nine camelCase count keys」を固定している。新しいカウントキーは**足さない**。intent の削除件数は既存の `flyerLedgersDeleted`（flyer 週次台帳 + 終端 flyer request の削除合計）に合算する。
- pgTAP で authenticated の select が 42501、RPC 3 本が authenticated から実行不可、service_role から可、`run_kondate_maintenance` が「succeeded かつ public 行なし」を消さないこと、戻り jsonb が引き続きちょうど 9 キーであることを固定する。

### 下書きへの引き継ぎ（P-05）

結果画面の「この日の献立を作る」は既存 `savePlannerDraft(client, userId, input, revision)` を呼ぶ。`PlannerDraftInput` は strict かつ全キー必須なので、**12 キーすべてを明示して渡す**。新しい下書き列は足さない。

| キー | 値 |
|---|---|
| mealType | `"dinner"` |
| mainIngredients | その日の `ingredients` 先頭 `PLANNER_MAIN_INGREDIENT_LIMIT`（8）件。各要素は `PLANNER_INGREDIENT_TEXT_MAX`（80 code point）で切り詰め、trim 後に空なら除外 |
| cuisineGenre | 週献立の値 |
| targetMode | `"household"` |
| targetMemberIds | 週献立の対象メンバー。現行 complete メンバーに存在しない id は除外し、0 人になれば引き継ぎ不可としてエラー表示 |
| servings | `null` |
| timeLimitMinutes | `null` |
| budgetPreference | 週献立の値 |
| ingredientPreference | `null` |
| noveltyPreference | 週献立の値 |
| avoidIngredients | `[]` |
| memo | `主菜: {mainName}` を `PLANNER_MEMO_TEXT_MAX`（200）で切り詰め |
| pantrySelections | `[]` |

- `revision` は事前に `getPlannerDraft` で読んだ現在値。`DraftRevisionConflictError` は再読込して 1 回だけ再試行。
- **上書き確認**（R-05）: `getPlannerDraft` で読んだ既存下書きと、上表の手渡し値を **12 キー全部**で比較し、1 つでも「既存が非空で、かつ手渡し値と異なる」キーがあればモーダルで「いまの献立条件を置き換えますか」を出す。比較対象には `pantrySelections` / `avoidIngredients` / `servings` / `mealType` / `timeLimitMinutes` / `ingredientPreference` を含める（手渡し値が `[]` / `null` で既存が非空なら差分）。既存の `targetMode` が `"idea"` なら差分の有無に関わらず常に確認する。既存下書きが無い、または全キー空なら確認なし。これは planner の leave-flush（`registerPlannerLeaveFlush` の `proceed | blocked` ハンドラ）とは別物で、`/weekly/:id` にはハンドラを登録しない。
- 保存成功後に `/planner` へ遷移。プランナー側は通常どおり下書きを hydrate する。

## 4. 画面と導線

すべて `src/features/weekly-plan/` に閉じる。320 CSS px で横スクロールなし、タッチターゲット 44×44 以上、既存の `card` / `stack` / `primary-button` / `secondary-button` クラスに合わせる。

### 4.1 入口カード（プランナー home の footer 枠）

- Plus: 「今週の献立」カードと「今週の献立をつくる」ボタン。遷移は素の `Link` ではなく **`navigateAfterPlannerLeaveFlush(navigate, "/weekly")`** を使い、dirty な下書きを flush してから移動する（ホーム直近献立・冷蔵庫と同型。R-05）。`blocked` なら留まる。
- Free: チラシ `flyer-weekly-locked` と同型のロック表示。月〜水のダミー 3 行、「今週の献立づくりは Plus の機能です」、注記「作成できるかは Plus 契約をサーバーで確認します」、CTA「Plus を見る」（`/plus`）。
- 表示切替は `usage-today` の `plusEntitled`。作成可否はサーバが毎回確認する。

### 4.2 条件フォーム（`/weekly`）

- 1 画面 4 項目。作る相手（家族チェックボックス。`audience-step` の部品を流用）、ジャンル、予算、目新しさ。既定値は complete 全員 / おまかせ / 標準 / 標準。
- 上部に「今週の週献立（チラシ献立と共通）: 成功 n / 2、試行 m / 6」を `usage-today` の flyerWeekly 投影から表示。残 0 は送信無効 + 理由表示。
- 日次と同じ開示文「献立には今回選んだ家族の条件だけが使われます。」を作る相手の下に置く。
- 満たせない制約（cut_small / requires_tag）を持つメンバーには警告を出し、チェックを外せる。未確認アレルギー等の日次 422 集合に該当するメンバーは、日次と同じ文言で家族設定への導線を出す。全員が該当なら送信無効。
- 送信中は `generation-status-panel` と同じ待機表現。`idempotencyKey` は sessionStorage に sticky 保持し二重送信を防ぐ。
- 今週すでに成功があれば「今週の献立はあります」と最新結果へのリンクを上部に出す。

### 4.3 結果画面（`/weekly/:weeklyPlanId`）

- データは GET `/api/weekly-plan/:id`。
- 見出し: `partialHousehold` が false なら「今週の献立」。true なら **主文言を「{n} 人分の今週の献立」とし、直下に「外した家族の条件は見ていません。全員分を作るには作り直してください」を必ず表示**（P-11）。
- 月〜日の 7 行。主菜名、副菜名、食材チップ、メモ。
- 各行「この日の献立を作る」→ §3 の引き継ぎ → `/planner`。
- 日次と同じ安全性注記（保証しない旨）を必ず表示。
- `staleSafety` が true なら「家族の設定が変わっています。作り直してください」を注記。「この日の献立を作る」は有効のまま。
- 履歴からも同じ画面へ着地。

### 4.4 履歴タブ

- 一覧先頭に「今週の献立」枠。最新の `weekly_plans` 1 件を RLS 直読でカード表示。`partialHousehold` は **`preference_snapshot.targetMemberIds` の ID 集合と現行 complete メンバー ID 集合の全件一致**で判定する（一致しなければ true）。件数比較はしない。true のカードには「{n} 人分」と「外した家族の条件は見ていません」を結果画面と同じ文言で出す。
- 過去週は「これまでの週献立」として折りたたみ。
- 日次の履歴グループ表示は変更しない。

### 4.5 Plus LP と設定（P-06）

「チラシから 1 週間」への言及を LP と設定から **すべて** 「今週の献立」へ差し替える。対象は次のとおり。

- `PLUS_LP_LEAD_BODY`: 「…チラシ写真から 1 週間の献立をつくったり…」→「…家族の条件から 1 週間分の献立の骨組みをつくったり…」
- 3 枚目カード: `PLUS_LP_FLYER_TITLE` / `PLUS_LP_FLYER_BODY` / bullet 3 行（「チラシの写真をアプリに送ります」等）/ アイコン画像
- 比較表の行見出し「チラシから 1 週間」と Free / Plus セル
- 設定の枠切れ CTA 文言
- チラシの文言定数（`FLYER_LOCKED_PREVIEW_COPY` 等）は削除せず残すが、LP / 設定からは参照しない。既存 LP テストの exact 文言は同時に更新する。

## 5. エラー処理と安全性

### 対象メンバー基準と reserve 前 422 集合（P-07）

検査対象は「フォームで選んだ対象メンバー」とし、日次生成と同じ基準にそろえる。reserve 前（予約・試行いずれも非消費）に 422 で止める集合は **日次の `generation-context` と同一**にし、週献立固有の 1 件を足す。

| 条件 | コード |
|---|---|
| 現行 notice 未同意 | consent_required |
| 対象メンバーが complete でない / 存在しない | current_target_member_required |
| allergy_status が unconfirmed | allergy_unconfirmed |
| アレルギー辞書に無い allergen | allergen_missing |
| unsupported_diet_status が unconfirmed / present | unsupported_diet_unconfirmed / unsupported_diet |
| cut_small 必須制約、または年齢帯 requires_tag 規則に該当 | weekly_plan_unsatisfiable_member |

判定は日次の context 読取関数を再利用し、週献立側で条件を削らない。

### エラー体系と枠消費

| 段階 | コード | HTTP | 枠消費 |
|---|---|---|---|
| lookup で succeeded 再生（行あり／行なし共通） | — | 200（+`staleSafety`） | なし（OpenRouter 0）。R-07: 再 assert では本文を止めない |
| succeeded 再生で `weekly_plans` 行自体が読めない | — | 503 | なし |
| replayed + stash 済み（finalize 再試行） | — / internal_error | 200 / 500 | 成功枠は reserved のまま。OpenRouter 0。N-I-10: 再 assert 失敗も finalize_failure を呼ばず 200+`staleSafety` |
| entitlement 読取失敗 | entitlement_unavailable（既存） | 503 | なし |
| Free | weekly_plan_requires_plus | 403 | なし |
| reserve 前 422 集合 | 上表 | 422 | なし |
| 週 2 回成功済み / 週 6 回試行済み | weekly_plan_weekly_limit / weekly_plan_try_limit | 429 | なし |
| 日次試行・短時間窓・全体枠 | 既存コード | 429 | なし |
| 処理中の重複 | generation_in_progress | 409 | なし |
| 残り予算不足（reserve 直後 / ensure 直後の 2 段） | generation_timeout | 503 | なし（`finalize_failure(p_sent: false)` で reserved 解放） |
| ensureModelPolicy 失敗 | model_unavailable | 503 | なし（`finalize_failure(p_sent: false)`） |
| モデル不可・タイムアウト（mark 後） | model_unavailable / generation_timeout | 503 | 試行のみ |
| Zod 不一致・保証フレーズ・安全ヒット（新規生成のみ） | weekly_plan_invalid_ai_response | 400 | 試行のみ |
| replayed+stash 再試行の再 assert 失敗（現行安全ヒット／保証フレーズ） | — | 200（+`staleSafety`） | なし。`finalize_flyer_weekly_failure` は呼ばない（N-I-10） |
| finalize_success 失敗 | internal_error（stash 済み） | 500 | 成功枠は reserved のまま。同一キー再 POST が finalize を再試行 |
| weekly_plans insert 失敗 | weekly_plan_persist_failed | 500 | 成功枠は確定済み。同一キー再 POST が insert を再試行 |

- 安全ヒット・Zod 不一致時は本文を返さず、ログにも残さない。
- 処理中孤児は既存の 180 秒 stale 解放に任せる（finalize 前の reserved のみが対象。finalize 後は影響しない）。

### ブラウザの再試行（P-09）

- 429: 残り枠と週の切替日（次の JST 月曜）を表示。自動再送しない。
- 503（`generation_timeout` / `model_unavailable`）: チラシ PE1 と同型で **sticky キーを破棄**し、「もう一度試す」は新しい `idempotencyKey` で送る（N-I-5。共有台帳がこのキーで `failed` 確定済みのため、同一キーの再 reserve はできない）。
- 500（`internal_error` の finalize stash 済み / `weekly_plan_persist_failed`）: 台帳はまだ `succeeded` へ向かう途中か確定済みなので **同じ `idempotencyKey`** で「もう一度試す」ボタン（PE3 と同型）。いずれも自動再送しない。
- 400 `weekly_plan_invalid_ai_response`（R-10 client）: 新規生成（sticky 再生ではない。R-07 で再生経路からは 400 を出さなくした）が Zod 不一致・保証フレーズ・安全ヒットで落ちたときだけ発生し、この台帳は `failed` で試行のみ消費済み。**sticky キーを破棄**し、「家族の条件に合わなくなりました。作り直してください」を出す。作り直しボタンは新しいキーで送る。今週の `weekly_plans` 最新行が RLS 直読で見つかれば「前回の献立を見る」で結果 URL へ行ける（行は残っている）。
- 409 `generation_in_progress`: 「作成中です」を表示し、**`use-generation-recovery` の他端末 processing 再 POST と同じ間隔定数**で同一キーを再送する。上限は 3 回、超えたら手動ボタンへ落とす。Function 側の `rateLimit`（`{ windowLimit: 20, windowSize: 180, aggregateBy: ["ip"] }`、チラシと同値）と、サービス側の `REQUIRED_SEND_BUDGET_MS` ゲートを両方置く。

### 安全性の原則

- プロンプトに載せるのは対象メンバーの allergenIds、カスタムアレルギーの正規化名、必須制約、嫌いなもの。氏名・呼び名・非対象メンバーの情報は載せない。
- 生成後は対象メンバーの現在条件で 7 日全食材を検査。1 件でもヒットすれば全体を捨て、部分成功は返さない。
- 「安全です」「アレルギー対応済み」等の保証フレーズは既存検査で落とす。
- Plus 失効後は新規作成不可。lookup 再生と GET 閲覧は可。
- 現在の家族安全条件は常に保存済みスナップショットより優先する。`staleSafety` はサーバが計算した表示用フラグであり、再検査 API は作らない。

## 6. テスト

すべて TDD（RED → GREEN）。チラシ週次のテスト構成を写す。

### 契約 `shared/contracts/weekly-plan.test.ts`
- strict 拒否、対象 0 人拒否、上限、enum 外拒否。
- レスポンスの 7 日一意性、`weekStartJst` 形式、`safetyFingerprint` キーを含む入力の strict 拒否。
- `weeklyPlanFailureCodeMap` が SQL コード（`flyer_weekly_limit` 等）を週献立コードへ写し、未知コードは既存 `issueMessages` へ落ちる。
- エラーコード ↔ 文言の閉じた対応。文言に「チラシ献立と共通」を含む。

### プロンプト `weekly-plan-prompt.test.ts`
- 対象メンバーの安全条件がシステムメッセージに載る。呼び名・氏名・非対象メンバー情報が載らない。
- メッセージに `image_url` が無い。`response_format` は `weeklyFlyerMenuResponseFormat` と同一参照。
- 切り出し後も `generation-prompt` の既存テストが緑。

### サービス `weekly-plan-service.test.ts` / `.pipeline.test.ts`
- **順序**: lookup が Plus 判定より前。succeeded 行があれば Free でも 200、OpenRouter 0、reserve 未呼出。
- **sticky 再生**: body に別の `targetMemberIds` を載せても当時の snapshot / days が返り、`weekly_plans` は更新されない（R-09）。行あり・行なしのどちらでも本文は止めず、GET と同じ規則で `staleSafety` を計算して 200（R-07）。行自体が読めないときだけ 503。
- **replayed + stash**: reserve が `replayed: true` と stash `result` を返したら OpenRouter 0 で finalize 再試行 → insert → 200。finalize 再失敗は 500（R-08）。
- **replayed + stash の再 assert 失敗（N-I-10）**: stash 済み結果が現行安全条件の再 assert（`assertFlyerMenuAgainstSafety` / `assertFlyerMenuHasNoGuaranteePhrases`）にヒットしても、`finalize_flyer_weekly_failure` は呼ばれず、`finalize_flyer_weekly_success` → insert → 200 + `staleSafety: true` になることを固定する。400 にならないこと・成功枠が焼かれないことをアサートする。
- **予算 2 段**: ensure 後の再ゲート不足で `finalize_failure(generation_timeout, p_sent: false)` が呼ばれ mark 未呼出（R-04）。
- 同意なし → 422 で reserve 未呼出。Free → 403 で reserve 未呼出。reserve 前 422 集合の各コードで mark 未呼出。
- モデルが `plusModels` で `flyerModels` を参照しない。wire は `mode: "flyer_weekly"`、`response_format.json_schema.name === "kondate_weekly_flyer_menu"`（R-03 案 A）。
- 429 の各種が SQL コードから正しく写像され、試行を焼かない。
- mark 後の 400 系は試行のみ消費、本文・ログに AI 出力なし。
- **finalize_success 失敗**: stash が呼ばれ、`finalize_failure` は呼ばれず、500。同一キー再 POST で finalize 再試行。
- **insert 失敗**: finalize は成功済み、500 `weekly_plan_persist_failed`、`finalize_failure` 未呼出。同一キー再 POST で insert のみ再試行し、OpenRouter 0。
- `p_result` が `weekStartJst` + `days` のみ。
- 成功時 `weekly_plans` 1 行、`preference_snapshot` は id と enum のみ、fingerprint は日次と同算出。intent 行が delete される。
- intent は `rpc("put_weekly_plan_intent")` で書く（`.from("weekly_plan_intents")` を呼ばない）。失敗で `finalize_failure(p_sent: false)`、mark 未呼出、500。
- sticky 再生で `weekly_plans` 行があれば intent RPC を呼ばず 200（N-I-3）。行欠損なら `get_weekly_plan_intent` + `result_payload` から insert し、body の条件は使わない。intent も無ければ 500。
- sticky 再生では現行安全条件の読取失敗・対象メンバー欠損のどちらも本文を止めない。`staleSafety: true` の 200 のまま返す（行なし経路も insert まで進める）。500 になるのは `weekly_plans` 行自体（または intent が必須な経路で intent 自体）が読めないときだけ（R-07）。
- GET: 所有者は JWT のみ（query / body の user 指定は無視）。他人の id は 404。`staleSafety` が現行条件差分で true になる。対象メンバー欠損でも 200 かつ `staleSafety: true`（R-07）。

### Function 境界 `netlify/functions/_tests/weekly-plan-idempotency.test.ts`
- 冪等キー再送、Plus 失効後の sticky 再表示、不正 JSON は 400、`rateLimit` 設定値がチラシと同値。GET が `requireUser`、POST が `requireUserWithEmail`。

### DB pgTAP `supabase/tests/database/weekly_plans.test.sql`
- 他人の select 0 行。authenticated の insert / update / delete が 42501。service_role の insert / update / delete 可（`grant all` の検証）。
- `request_id` 重複が 23505。`source` / `safety_fingerprint` CHECK。ユーザー削除で cascade。
- intent: authenticated から表 select と RPC 3 本の execute が拒否。service_role から RPC 経由で put / get / delete 可。`get` は `user_id` 不一致で null。
- `run_kondate_maintenance`: failed 24h 超の intent と、succeeded かつ public 行ありの intent は消える。succeeded かつ public 行なし、processing の intent は残る。既存の戻りキーが不変。

### ブラウザ Vitest
- 入口カード（Plus / Free）。Plus のボタンが `navigateAfterPlannerLeaveFlush` を経由し、`blocked` で留まる。
- 400 `weekly_plan_invalid_ai_response`（新規生成失敗のみ。lookup 再生・replayed+stash の再 assert 失敗はこのコードを返さないので対象外。N-I-10）受信で sticky キーが破棄され、作り直しが新キーで送られる。今週の行があれば「前回の献立を見る」が結果 URL を指す。他の 400（不正 JSON 等）で誤って sticky を破棄しないことも固定する。
- フォーム（既定値、残数コピー、開示文、残 0 無効、警告とチェック外し、日次 422 集合の導線）。
- 結果（7 行、`partialHousehold` の見出しと注記、`staleSafety` 注記、引き継ぎで `savePlannerDraft` に 12 キー全部・80 文字切り詰め・8 件上限、revision 衝突の 1 回再試行）。
- 上書き確認: pantry だけ非空 / avoid だけ非空 / idea 下書き のそれぞれでモーダルが出る。空下書き・同値下書きでは出ない（R-05）。
- 履歴カードの `partialHousehold` が ID 集合一致で決まる（同数で別メンバーなら true）（R-06）。
- 409 自動再送が上限 3 回で止まる。
- 履歴（先頭枠と折りたたみ）。
- Plus LP（LEAD・カード・比較表・bullet に「チラシ」が残らない）。
- 320px レイアウトとタッチターゲットは既存 accessibility テストに追加。

### E2E `e2e/specs/weekly-plan.spec.ts`
- Plus モック: 作成 → 結果 → 日タップ → プランナーに条件が入る。
- Free: ロック表示 → `/plus` 着地。
- **OpenRouter mock の改修**（R-03）: `tools/openrouter-mock/server.mjs` の `isValidBody` は `menuResponseFormat` と dish 再生成しか受理せず、チラシ形の `response_format` も拒否する。`weeklyFlyerMenuResponseFormat` との deep-equal を受理条件に加え、その形のときは system 文の週献立固有句で判定して 7 日分の固定応答（`kondate_weekly_flyer_menu` schema 準拠、`dayIndex 1..7`）を返す。fixture 追加だけでは E2E が 400 で落ちる。

### 検証コマンド
- 単体 / 契約 / lint / typecheck / format:check は `docker compose run --rm --no-deps app ...` で focused に実行。
- pgTAP は `docker compose --profile test run --rm db-test`、E2E は `./scripts/run-e2e.sh` をホストで実行し、結果要約を人が貼る。

## 7. 実装順（plan の章立て目安）

1. 契約（写像表を含む）+ マイグレーション（`weekly_plans` / `weekly_plan_intents` / intent RPC 3 本 / `run_kondate_maintenance` 再定義）+ pgTAP
2. プロンプト切り出し + 週献立プロンプト
3. サービス（lookup → finalize → insert の順と再試行経路）+ POST / GET Function + 境界テスト
4. ブラウザ API / hooks + 入口カード + ロック表示
5. フォーム + 結果画面 + 下書き引き継ぎ（12 キー・上書き確認）
6. 履歴枠 + Plus LP / 設定の全面差し替え
7. OpenRouter mock の週献立受理 + E2E + accessibility 追加
