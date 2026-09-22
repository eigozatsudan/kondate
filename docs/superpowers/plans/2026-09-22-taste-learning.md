# 好みの学習（tasteHints）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 利用者自身の履歴から好みのスタイルを都度集計し、new_menu の system プロンプトへ prompt 専用ヒントとして載せる。

**Architecture:** 蓄積テーブルを作らない。集計は `public.get_taste_signals()` 1 本で `menus` / `dishes` / `dish_ingredients` を RLS 準拠（`security invoker`）に読む。Function は既存 `loadRecentDishHints` と同じ 200ms・fail-open のローダで取得し、現行の安全制約でフィルタしてからプロンプトへ載せる。指紋・quota・検証には一切載せない。

**Tech Stack:** PostgreSQL 15 / pgTAP、TypeScript strict、Zod、Netlify Functions、React 19 + TanStack Query 5、Vitest、Docker Compose

**Spec:** `docs/superpowers/specs/2026-09-22-taste-learning-design.md`

## Global Constraints

- Node.js `>=24 <25`、ESM、TypeScript `strict: true`。境界で `any` と未検査キャストを使わない。
- 利用者向け文言はすべて日本語。コメントとコミットメッセージも日本語。識別子とテスト名は英語。
- モバイル優先 320 CSS px、横スクロールなし、タップ領域 44×44 CSS px。
- 作業ブランチは `main`。`git push` とデプロイは禁止。`--no-verify` 禁止。
- 生成ファイルの手編集禁止: `package-lock.json`、`infra/supabase/**`、`src/shared/types/database.generated.ts`。
- 名前・メール・アレルギー・自由記述・プロンプト・AI の生出力をログや永続へ出さない。Zod 検証済み構造のみ保存する。
- 現行の家庭安全制約は常に履歴スナップショットに優先する。
- `shared/contracts` はブラウザと Functions の双方から読める。`shared/safety` はブラウザから import しない。
- Node コマンドは Docker 経由で実行する。
  - ホスト非依存: `docker compose run --rm --no-deps app <cmd>`
  - 兄弟コンテナへ通信するもの（`db:types` 等）: `docker compose run --rm app <cmd>`（スタック起動済み）
  - `db:test` はホストで `docker compose --profile test run --rm db-test`
- 出力が大きいコマンドはファイルへリダイレクトし、要約と失敗だけを読む。

## 実装順の制約

**Task 4（トグルと告知文）は Task 6（配線）より前に完了させる。** 初期値が ON であるため、切る手段と説明文が利用者に届く前に学習が有効になってはならない。Task 1〜7 は同一リリースにまとめる。

---

### Task 1: マイグレーションと集計関数

**Files:**
- Create: `supabase/migrations/20260922120000_taste_learning.sql`
- Create: `supabase/tests/database/taste_signals.test.sql`
- Modify: `src/shared/types/database.generated.ts`（`npm run db:types` の成果物。手編集しない）

**Interfaces:**
- Consumes: なし
- Produces:
  - `public.profiles.taste_learning_enabled boolean not null default true`
  - `public.set_taste_learning_enabled(p_enabled boolean) returns boolean`（`authenticated` に execute）。
    未認証は `42501 authentication_required`、null は `22023 invalid_taste_learning_enabled`、
    行欠落は `P0002 profile_not_found`（`set_onboarding_status` と同じ規約）
  - `public.get_taste_signals(p_now timestamptz default now()) returns jsonb`（`authenticated` に execute）。
    未認証は `42501 authentication_required`。service クライアントで呼ぶと no_history ではなくこの
    エラーになるので、Task 6 の配線は **owner-scoped client 必須**。`p_now` は Function から渡さない
  - 戻り jsonb は 3 形のいずれか:
    `{"reason":"disabled"}` / `{"reason":"no_history"}` /
    `{"reason":null,"likedDishes":[{"dishName":string,"role":string}],"likedGenres":[string],"likedIngredients":[string],"likedTimeBand":"short"|"standard"|"slow"|null,"overusedIngredients":[string],"avoidAxes":["child_unfriendly"],"signalStrength":"weak"|"medium"|"strong","dishIngredientIndex":[{"dishName":string,"ingredients":[string]}]}`

- [ ] **Step 1: pgTAP テストを 1 ファイルで書き切る（RED）**

`supabase/tests/database/taste_signals.test.sql` を新規作成する。

**このファイルの決まりごと。**

- `plan(N)` の N は下のアサーション数と一致させる。pgTAP は計画数と実行数がずれると、
  列と関数を足したあとでも落ちる。アサーションを増やしたら N も直す。
- **行を作る間はスーパーユーザーのまま**にし、RPC を呼ぶ直前だけ `set local role authenticated`
  ＋ `tests.authenticate_as()` に切り替える。`authenticated` に `public.menus` の INSERT 権限は無い。
- 認証は `tests.authenticate_as()` を使う。このヘルパは `request.jwt.claim.sub` と
  `request.jwt.claims` の両方を立てる。`request.jwt.claims` だけを手で `set_config` しても
  このリポジトリの `auth.uid()` には効かない。
- `auth.users` への挿入は `tests.create_supabase_user()` を使う。素の INSERT では
  `instance_id` / `aud` / `role` / `encrypted_password` などが欠ける。
- `public.profiles` の行は自分で入れない。`auth.users` の `on_auth_user_created` トリガ
  （`private.handle_new_auth_user`）が既定値つきで作るため、明示 INSERT は
  `profiles_pkey` の重複で落ちる。
- ケースごとに `truncate public.menus cascade` で入れ替える。同じトランザクションに行を足し
  続けると、強さ・時間帯の加重平均・ジャンル比率が前のケースの行を巻き込んで壊れる。

```sql
begin;
select plan(52);

select tests.create_supabase_user('11111111-1111-4111-8111-111111111111', 'owner@example.invalid');
select tests.create_supabase_user('22222222-2222-4222-8222-222222222222', 'other@example.invalid');

-- profiles 行は auth.users の on_auth_user_created トリガ
-- （private.handle_new_auth_user）が既定値つきで作る

-- 献立 1 件＋料理 1 品＋食材を作る。menus の現行制約をすべて満たす:
--   target_mode は NOT NULL・既定値なし。household は allergen/food_rule version が NOT NULL。
--   is_selected = (selected_at is not null)。version は (user_id, group) で一意。
--   parent_menu_id は (parent_menu_id, user_id) -> (id, user_id) の自己 FK なので、
--   派生行は先に作った親の id を渡す（自分の id を入れた 1 文の INSERT は通らない）。
create or replace function pg_temp.seed_menu(
  p_user uuid,
  p_group uuid,
  p_version integer,
  p_created timestamptz,
  p_favorite boolean,
  p_selected boolean,
  p_genre text,
  p_submission_genre text,
  p_minutes smallint,
  p_parent uuid,
  p_change_reason text,
  p_main_ingredients jsonb,
  p_dish_name text,
  p_ingredients text[]
) returns uuid
language plpgsql
as $$
declare
  v_menu uuid := gen_random_uuid();
  v_dish uuid := gen_random_uuid();
  v_position smallint := 0;
  v_ingredient text;
begin
  insert into public.menus (
    id, user_id, target_mode, meal_type, cuisine_genre, servings,
    total_elapsed_minutes, preference_snapshot, safety_snapshot, safety_fingerprint,
    allergen_dictionary_version, food_safety_rule_version, output_schema_version,
    derivation_group_id, version, parent_menu_id, change_reason,
    is_selected, selected_at, is_favorite, created_at
  ) values (
    v_menu, p_user, 'household', 'dinner', p_genre, 2,
    p_minutes,
    jsonb_build_object(
      'submission',
      jsonb_build_object('cuisineGenre', p_submission_genre, 'mainIngredients', p_main_ingredients)
    ),
    '{}'::jsonb, repeat('a', 64),
    'v1', 'v1', 'v1',
    p_group, p_version, p_parent, p_change_reason,
    p_selected, case when p_selected then p_created else null end,
    p_favorite, p_created
  );

  insert into public.dishes (
    id, menu_id, user_id, role, position, name, description, cooking_time_minutes, created_at
  ) values (
    v_dish, v_menu, p_user, 'main', 1, p_dish_name, '説明', 20, p_created
  );

  foreach v_ingredient in array p_ingredients loop
    v_position := v_position + 1;
    insert into public.dish_ingredients (
      menu_id, dish_id, user_id, position, name, quantity_text, store_section, created_at
    ) values (
      v_menu, v_dish, p_user, v_position, v_ingredient, '適量', 'other', p_created
    );
  end loop;

  return v_menu;
end;
$$;

-- 既定の引数を埋めた薄いラッパ。各ケースは必要な軸だけを指定する
create or replace function pg_temp.seed_simple(
  p_group uuid,
  p_created timestamptz,
  p_favorite boolean,
  p_selected boolean,
  p_dish_name text,
  p_ingredients text[] default array['たまねぎ'],
  p_minutes smallint default 30,
  p_genre text default 'japanese',
  p_submission_genre text default 'japanese',
  p_main_ingredients jsonb default '[]'::jsonb
) returns uuid
language sql
as $$
  select pg_temp.seed_menu(
    '11111111-1111-4111-8111-111111111111', p_group, 1, p_created,
    p_favorite, p_selected, p_genre, p_submission_genre, p_minutes,
    null, null, p_main_ingredients, p_dish_name, p_ingredients
  );
$$;

-- 認証済みで RPC を 1 回呼ぶ。行を作る権限は残したいので、毎回 role を戻す
create or replace function pg_temp.signals(p_user uuid default '11111111-1111-4111-8111-111111111111')
returns jsonb
language plpgsql
as $$
declare v_result jsonb;
begin
  perform tests.authenticate_as(p_user);
  set local role authenticated;
  select public.get_taste_signals('2026-09-22T00:00:00Z'::timestamptz) into v_result;
  reset role;
  return v_result;
end;
$$;

-- ============ 構造と権限 ============
select has_column('public', 'profiles', 'taste_learning_enabled',
  'profiles has taste_learning_enabled');
select col_not_null('public', 'profiles', 'taste_learning_enabled',
  'taste_learning_enabled is not null');
select col_default_is('public', 'profiles', 'taste_learning_enabled', 'true',
  'taste_learning_enabled defaults to true');
select has_function('public', 'get_taste_signals', array['timestamptz'],
  'get_taste_signals exists');
select has_function('public', 'set_taste_learning_enabled', array['boolean'],
  'set_taste_learning_enabled exists');
-- 20260712000100 で外したテーブル単位 UPDATE を復活させていない
select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'),
  'profiles table-level UPDATE stays revoked for authenticated'
);

-- ============ 履歴ゼロとトグル ============
select is(pg_temp.signals() ->> 'reason', 'no_history', 'empty history reports no_history');

select tests.authenticate_as('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select is(public.set_taste_learning_enabled(false), false,
  'set_taste_learning_enabled returns the stored value');
reset role;

-- 分岐順は disabled -> no_history。OFF の利用者は窓が空でも disabled になる
select is(pg_temp.signals() ->> 'reason', 'disabled', 'disabled wins over an empty window');
-- security definer でも自分の行しか書かない
select is(
  (select taste_learning_enabled from public.profiles
   where user_id = '22222222-2222-4222-8222-222222222222'),
  true,
  'the setter leaves another user profile untouched'
);

-- 未認証（authenticated ロールで sub なし）は null で黙らせず 42501
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select throws_ok(
  'select public.set_taste_learning_enabled(true)',
  '42501', 'authentication_required',
  'the setter rejects an unauthenticated caller'
);
select throws_ok(
  $$select public.get_taste_signals('2026-09-22T00:00:00Z'::timestamptz)$$,
  '42501', 'authentication_required',
  'signals reject an unauthenticated caller instead of reporting no_history'
);
reset role;

select tests.authenticate_as('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select throws_ok(
  'select public.set_taste_learning_enabled(null)',
  '22023', 'invalid_taste_learning_enabled',
  'the setter rejects null'
);
reset role;

select tests.authenticate_as('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select is(public.set_taste_learning_enabled(true), true, 'toggle back on');
reset role;

-- ============ 派生行は強さを膨らませない ============
truncate public.menus cascade;
select pg_temp.seed_menu(
  '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333331', 1,
  '2026-09-21T00:00:00Z', true, false, 'japanese', 'japanese', 30::smallint,
  null, null, '[]'::jsonb, '子1', array['にんじん']
);
-- 同じグループの 2-5 版。行数だけなら medium の 5 に届くが、グループは 1 つ
with parent as (
  select id from public.menus where derivation_group_id = '33333333-3333-4333-8333-333333333331'
)
select pg_temp.seed_menu(
  '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333331', v,
  '2026-09-21T00:00:00Z', true, false, 'japanese', 'japanese', 30::smallint,
  (select id from parent), 'simpler', '[]'::jsonb, '子' || v::text, array['にんじん']
)
from generate_series(2, 5) as v;
select is(pg_temp.signals() ->> 'signalStrength', 'weak',
  'five rows in one derivation group stay weak');
-- 本体の分岐でも reason キーは JSON null として必ず出る（契約の strict schema 向け）
select ok(
  pg_temp.signals() ? 'reason' and pg_temp.signals() -> 'reason' = 'null'::jsonb,
  'a populated result carries reason as JSON null'
);

-- ============ 強さの境界（4/5 と 14/15 グループ） ============
truncate public.menus cascade;
select pg_temp.seed_simple(gen_random_uuid(), '2026-09-21T00:00:00Z', true, false, '料理' || g::text)
from generate_series(1, 4) as g;
select is(pg_temp.signals() ->> 'signalStrength', 'weak', 'four groups are weak');

select pg_temp.seed_simple(gen_random_uuid(), '2026-09-21T00:00:00Z', true, false, '料理5');
select is(pg_temp.signals() ->> 'signalStrength', 'medium', 'five groups reach medium');

select pg_temp.seed_simple(gen_random_uuid(), '2026-09-21T00:00:00Z', true, false, '料理' || g::text)
from generate_series(6, 14) as g;
select is(pg_temp.signals() ->> 'signalStrength', 'medium', 'fourteen groups are still medium');

select pg_temp.seed_simple(gen_random_uuid(), '2026-09-21T00:00:00Z', true, false, '料理15');
select is(pg_temp.signals() ->> 'signalStrength', 'strong', 'fifteen groups reach strong');

-- ============ 重みの加算と半減期 ============
truncate public.menus cascade;
-- ★のみ = 1.0、★＋採用 = 1.3（乗算ではなく加算）
select pg_temp.seed_simple(gen_random_uuid(), '2026-09-21T00:00:00Z', true, false, '★だけ');
select pg_temp.seed_simple(gen_random_uuid(), '2026-09-21T00:00:00Z', true, true, '★と採用');
select is(
  pg_temp.signals() #>> '{likedDishes,0,dishName}', '★と採用',
  'favourite and selected add up above favourite alone'
);

truncate public.menus cascade;
-- 半減期 30 日: 30 日前の 1.3 (=0.65) は当日の 1.0 に負ける。減衰が無ければ逆順になる
select pg_temp.seed_simple(gen_random_uuid(), '2026-09-21T00:00:00Z', true, false, '当日★');
select pg_temp.seed_simple(gen_random_uuid(), '2026-08-22T00:00:00Z', true, true, '30日前★採用');
select is(
  pg_temp.signals() #>> '{likedDishes,0,dishName}', '当日★',
  'the 30-day half-life outweighs the selected bonus'
);

-- 半減期の値そのものを固定する。基準時刻の★のみ (1.0) と k 日前の★＋採用 1.3·0.5^(k/30)
-- の交点は k = 30·log2(1.3) ≈ 11.36。半減期が 20 日なら ≈ 7.6、40 日なら ≈ 15.1 にずれる
truncate public.menus cascade;
select pg_temp.seed_simple(gen_random_uuid(), '2026-09-22T00:00:00Z', true, false, '基準★');
select pg_temp.seed_simple(gen_random_uuid(), '2026-09-11T00:00:00Z', true, true, '11日前★採用');
select is(
  pg_temp.signals() #>> '{likedDishes,0,dishName}', '11日前★採用',
  'eleven days of decay still leaves 1.3 above 1.0'
);

truncate public.menus cascade;
select pg_temp.seed_simple(gen_random_uuid(), '2026-09-22T00:00:00Z', true, false, '基準★');
select pg_temp.seed_simple(gen_random_uuid(), '2026-09-10T00:00:00Z', true, true, '12日前★採用');
select is(
  pg_temp.signals() #>> '{likedDishes,0,dishName}', '基準★',
  'twelve days of decay drops 1.3 below 1.0'
);

-- 採用だけ（0.3）でも好みに入る
truncate public.menus cascade;
select pg_temp.seed_simple(gen_random_uuid(), '2026-09-21T00:00:00Z', false, true, '採用だけ');
select is(pg_temp.signals() -> 'likedDishes', '[{"dishName": "採用だけ", "role": "main"}]'::jsonb,
  'a selected menu without a star still counts as liked');

-- 対応表は score 0 の料理を持たない
select pg_temp.seed_simple(gen_random_uuid(), '2026-09-21T00:00:00Z', false, false, '無反応');
select is(
  (select jsonb_agg(d ->> 'dishName') from jsonb_array_elements(pg_temp.signals() -> 'dishIngredientIndex') as d),
  '["採用だけ"]'::jsonb,
  'dishIngredientIndex leaves out dishes with no score'
);

-- ============ 窓の境界（89 日と 91 日） ============
truncate public.menus cascade;
select pg_temp.seed_simple(gen_random_uuid(), '2026-06-25T00:00:00Z', true, false, '窓内89日');
select pg_temp.seed_simple(gen_random_uuid(), '2026-06-23T00:00:00Z', true, false, '窓外91日');
select is(
  (select jsonb_agg(d ->> 'dishName' order by d ->> 'dishName')
   from jsonb_array_elements(pg_temp.signals() -> 'likedDishes') as d),
  '["窓内89日"]'::jsonb,
  'the 90-day window excludes day 91 and keeps day 89'
);

truncate public.menus cascade;
select pg_temp.seed_simple(gen_random_uuid(), '2026-06-24T00:00:00Z', true, false, 'ちょうど90日');
select is(pg_temp.signals() #>> '{likedDishes,0,dishName}', 'ちょうど90日',
  'a menu exactly 90 days old is inside the window');

-- 基準時刻より後の行は窓に入れない（経過が負だと重みが 1 を超える）
truncate public.menus cascade;
select pg_temp.seed_simple(gen_random_uuid(), '2026-09-23T00:00:00Z', true, false, '未来');
select is(pg_temp.signals() ->> 'reason', 'no_history',
  'menus created after p_now are outside the window');

-- 50 件の上限: 51 グループの★から最も古い 1 件が落ちる
truncate public.menus cascade;
select pg_temp.seed_simple(
  gen_random_uuid(), '2026-09-21T00:00:00Z'::timestamptz - g * interval '1 hour', true, false, '古' || g::text
) from generate_series(1, 51) as g;
select is(jsonb_array_length(pg_temp.signals() -> 'dishIngredientIndex'), 50,
  'the window stops at 50 menus');
select ok(
  not exists (
    select 1 from jsonb_array_elements(pg_temp.signals() -> 'dishIngredientIndex') as d
    where d ->> 'dishName' = '古51'
  ),
  'the oldest menu is the one past the 50 cap'
);

-- ============ 食材は派生グループ単位で 2 回以上 ============
truncate public.menus cascade;
-- A 版 1・2: 「ん」「しょうが」。B: 「ん」「あ」。C: 「あ」。全件 score 1.0。
-- しょうがは 1 グループだけなので出ない。ん は A の 2 行ぶん重く (3.0)、あ (2.0) より前
with a1 as (
  select pg_temp.seed_menu(
    '11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555551', 1,
    '2026-09-22T00:00:00Z', true, false, 'japanese', 'japanese', 30::smallint,
    null, null, '[]'::jsonb, 'A1', array['ん', 'しょうが']
  ) as id
)
select pg_temp.seed_menu(
  '11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555551', 2,
  '2026-09-22T00:00:00Z', true, false, 'japanese', 'japanese', 30::smallint,
  (select id from a1), 'simpler', '[]'::jsonb, 'A2', array['ん', 'しょうが']
);
select pg_temp.seed_simple(gen_random_uuid(), '2026-09-22T00:00:00Z', true, false, 'B', array['ん', 'あ']);
select pg_temp.seed_simple(gen_random_uuid(), '2026-09-22T00:00:00Z', true, false, 'C', array['あ']);
select ok(
  not (pg_temp.signals() -> 'likedIngredients' @> '["しょうが"]'::jsonb),
  'an ingredient repeated inside one derivation group is not liked'
);
select is(pg_temp.signals() -> 'likedIngredients', '["ん", "あ"]'::jsonb,
  'liked ingredients need two groups and sum every menu of equal score');

-- ============ 使いすぎは派生グループ単位 ============
truncate public.menus cascade;
-- 2 グループでは出ない（★の有無は問わない。母集団は窓内の全献立）
select pg_temp.seed_simple(
  gen_random_uuid(), '2026-09-21T00:00:00Z', false, false, '料理' || g::text,
  array['たまねぎ'], 30::smallint, 'japanese', 'japanese', '["豚肉"]'::jsonb
) from generate_series(1, 2) as g;
select is(pg_temp.signals() -> 'overusedIngredients', '[]'::jsonb,
  'a main ingredient in two derivation groups is not overused');

select pg_temp.seed_simple(
  gen_random_uuid(), '2026-09-21T00:00:00Z', false, false, '料理3',
  array['たまねぎ'], 30::smallint, 'japanese', 'japanese', '["豚肉"]'::jsonb
);
select is(pg_temp.signals() -> 'overusedIngredients', '["豚肉"]'::jsonb,
  'a main ingredient in three derivation groups is overused');

truncate public.menus cascade;
-- 同じグループで 3 回作り直しても 1 回
with v1 as (
  select pg_temp.seed_menu(
    '11111111-1111-4111-8111-111111111111', '66666666-6666-4666-8666-666666666661', 1,
    '2026-09-21T00:00:00Z', false, false, 'japanese', 'japanese', 30::smallint,
    null, null, '["鶏肉"]'::jsonb, '再1', array['たまねぎ']
  ) as id
)
select pg_temp.seed_menu(
  '11111111-1111-4111-8111-111111111111', '66666666-6666-4666-8666-666666666661', v,
  '2026-09-21T00:00:00Z', false, false, 'japanese', 'japanese', 30::smallint,
  (select id from v1), 'simpler', '["鶏肉"]'::jsonb, '再' || v::text, array['たまねぎ']
) from generate_series(2, 3) as v;
select is(pg_temp.signals() -> 'overusedIngredients', '[]'::jsonb,
  'three regenerations in one derivation group are not overuse');

truncate public.menus cascade;
-- 配列でない値・文字列でない要素は読み飛ばし、関数全体を落とさない
select pg_temp.seed_simple(
  gen_random_uuid(), '2026-09-21T00:00:00Z', false, false, '崩れ' || g::text,
  array['たまねぎ'], 30::smallint, 'japanese', 'japanese', '[1, null, "豚肉", {"a": 1}, " "]'::jsonb
) from generate_series(1, 3) as g;
select pg_temp.seed_simple(
  gen_random_uuid(), '2026-09-21T00:00:00Z', false, false, 'スカラー',
  array['たまねぎ'], 30::smallint, 'japanese', 'japanese', '"豚肉"'::jsonb
);
select is(pg_temp.signals() -> 'overusedIngredients', '["豚肉"]'::jsonb,
  'malformed mainIngredients are skipped without failing the whole call');

-- ============ 時間帯の境界は連続している ============
truncate public.menus cascade;
-- 20 分と 21 分の等重み平均 = 20.5。`21-40` と刻むとどの帯にも入らない値
select pg_temp.seed_simple(gen_random_uuid(), '2026-09-21T00:00:00Z', true, false, '20分', array['にんじん'], 20::smallint);
select pg_temp.seed_simple(gen_random_uuid(), '2026-09-21T00:00:00Z', true, false, '21分', array['にんじん'], 21::smallint);
select is(pg_temp.signals() ->> 'likedTimeBand', 'standard',
  'a weighted average of 20.5 falls into standard, not a gap');

truncate public.menus cascade;
select pg_temp.seed_simple(gen_random_uuid(), '2026-09-21T00:00:00Z', true, false, '20分', array['にんじん'], 20::smallint);
select is(pg_temp.signals() ->> 'likedTimeBand', 'short', 'exactly 20 minutes is short');

truncate public.menus cascade;
select pg_temp.seed_simple(gen_random_uuid(), '2026-09-21T00:00:00Z', true, false, '40分', array['にんじん'], 40::smallint);
select is(pg_temp.signals() ->> 'likedTimeBand', 'standard', 'exactly 40 minutes is standard');

select pg_temp.seed_simple(gen_random_uuid(), '2026-09-21T00:00:00Z', true, false, '41分', array['にんじん'], 41::smallint);
select is(pg_temp.signals() ->> 'likedTimeBand', 'slow', 'a weighted average of 40.5 is slow');

truncate public.menus cascade;
-- 全件 20 分でも重みが違うと浮動小数の平均が 20 をわずかに超える。丸めて short に留める
select pg_temp.seed_simple(gen_random_uuid(), '2026-09-21T00:00:00Z', true, false, '20分a', array['にんじん'], 20::smallint);
select pg_temp.seed_simple(gen_random_uuid(), '2026-09-05T00:00:00Z', true, false, '20分b', array['にんじん'], 20::smallint);
select is(pg_temp.signals() ->> 'likedTimeBand', 'short',
  'twenty-minute favourites of different ages stay short despite float error');

-- ============ ジャンルはおまかせ依頼だけを母集団にし、生成 any を分子から外す ============
truncate public.menus cascade;
select pg_temp.seed_simple(
  gen_random_uuid(), '2026-09-21T00:00:00Z', true, false, '和' || g::text,
  array['にんじん'], 30::smallint, 'japanese', 'any'
) from generate_series(1, 3) as g;
select pg_temp.seed_simple(
  gen_random_uuid(), '2026-09-21T00:00:00Z', true, false, 'any1',
  array['にんじん'], 30::smallint, 'any', 'any'
);
select is(pg_temp.signals() -> 'likedGenres', '["japanese"]'::jsonb,
  'genre share comes from menus.cuisine_genre over any-request favourites');
select ok(
  not (pg_temp.signals() -> 'likedGenres' @> '["any"]'::jsonb),
  'a generated any is never reported as a liked genre'
);

truncate public.menus cascade;
-- ジャンルを指定した依頼は母集団に入らない
select pg_temp.seed_simple(
  gen_random_uuid(), '2026-09-21T00:00:00Z', true, false, '和',
  array['にんじん'], 30::smallint, 'japanese', 'any'
);
select pg_temp.seed_simple(
  gen_random_uuid(), '2026-09-21T00:00:00Z', true, false, '洋' || g::text,
  array['にんじん'], 30::smallint, 'western', 'western'
) from generate_series(1, 3) as g;
select is(pg_temp.signals() -> 'likedGenres', '["japanese"]'::jsonb,
  'favourites from genre-specified requests stay out of the population');

truncate public.menus cascade;
-- 生成 any は分子から外れるが分母には残る: 和 1 / 全 3 = 0.33 < 0.35
select pg_temp.seed_simple(
  gen_random_uuid(), '2026-09-21T00:00:00Z', true, false, '和',
  array['にんじん'], 30::smallint, 'japanese', 'any'
);
select pg_temp.seed_simple(
  gen_random_uuid(), '2026-09-21T00:00:00Z', true, false, 'any' || g::text,
  array['にんじん'], 30::smallint, 'any', 'any'
) from generate_series(1, 2) as g;
select is(pg_temp.signals() -> 'likedGenres', '[]'::jsonb,
  'generated any stays in the denominator');

truncate public.menus cascade;
-- 閾値 0.35 ちょうどは含む。score 1.0 に揃えて 7/20 を正確に作る
select pg_temp.seed_simple(
  gen_random_uuid(), '2026-09-22T00:00:00Z', true, false, '和' || g::text,
  array['にんじん'], 30::smallint, 'japanese', 'any'
) from generate_series(1, 7) as g;
select pg_temp.seed_simple(
  gen_random_uuid(), '2026-09-22T00:00:00Z', true, false, '中' || g::text,
  array['にんじん'], 30::smallint, 'chinese', 'any'
) from generate_series(1, 13) as g;
select is(pg_temp.signals() -> 'likedGenres', '["chinese", "japanese"]'::jsonb,
  'a genre share of exactly 0.35 is liked');

-- 6/19 ≈ 0.316 は外れる
delete from public.menus where id = (
  select id from public.menus where cuisine_genre = 'japanese' order by id limit 1
);
select is(pg_temp.signals() -> 'likedGenres', '["chinese"]'::jsonb,
  'a genre share below 0.35 is not liked');

-- ============ child_friendly は 2 グループ以上で軸になる ============
truncate public.menus cascade;
select pg_temp.seed_menu(
  '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444441', 1,
  '2026-09-21T00:00:00Z', false, false, 'japanese', 'japanese', 30::smallint,
  null, null, '[]'::jsonb, '親1', array['にんじん']
);
with parent as (
  select id from public.menus where derivation_group_id = '44444444-4444-4444-8444-444444444441'
)
select pg_temp.seed_menu(
  '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444441', v,
  '2026-09-21T00:00:00Z', false, false, 'japanese', 'japanese', 30::smallint,
  (select id from parent), 'child_friendly', '[]'::jsonb, '子1-' || v::text, array['にんじん']
) from generate_series(2, 3) as v;
select is(pg_temp.signals() -> 'avoidAxes', '[]'::jsonb,
  'two child_friendly rows in one derivation group are not a standing axis');

select pg_temp.seed_menu(
  '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444442', 1,
  '2026-09-21T00:00:00Z', false, false, 'japanese', 'japanese', 30::smallint,
  null, null, '[]'::jsonb, '親2', array['にんじん']
);
with parent as (
  select id from public.menus
  where derivation_group_id = '44444444-4444-4444-8444-444444444442' and version = 1
)
select pg_temp.seed_menu(
  '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444442', 2,
  '2026-09-21T00:00:00Z', false, false, 'japanese', 'japanese', 30::smallint,
  (select id from parent), 'child_friendly', '[]'::jsonb, '子2', array['にんじん']
);
select is(pg_temp.signals() -> 'avoidAxes', '["child_unfriendly"]'::jsonb,
  'child_friendly in two derivation groups becomes a standing axis');

-- ============ 対応表に上限が無い ============
truncate public.menus cascade;
-- likedDishes は 12 件で切れるが、対応表は 13 件すべてを持つ。
-- ここを切ると §5.3 の差集合が両方向に壊れる
select pg_temp.seed_simple(gen_random_uuid(), '2026-09-21T00:00:00Z', true, false, '好き' || g::text)
from generate_series(1, 13) as g;
select is(
  jsonb_array_length(pg_temp.signals() -> 'dishIngredientIndex'), 13,
  'dishIngredientIndex covers every liked dish, past the likedDishes cap'
);

-- ============ 他人の献立は入らない ============
select is(
  pg_temp.signals('22222222-2222-4222-8222-222222222222') ->> 'reason', 'no_history',
  'another user sees none of the owner history'
);

select * from finish();
rollback;
```

- [ ] **Step 2: テストが落ちることを確認する**

Run:
```bash
docker compose --profile test run --rm db-test > /tmp/dbtest.log 2>&1; \
  grep -nE "not ok|Failed|ERROR" /tmp/dbtest.log | head -20 || tail -n 40 /tmp/dbtest.log
```
Expected: FAIL。`column "taste_learning_enabled" does not exist` と
`function public.get_taste_signals(...) does not exist`。

- [ ] **Step 3: マイグレーションを書く**

`supabase/migrations/20260922120000_taste_learning.sql`:

```sql
-- 好みの学習（tasteHints）。prompt 専用・fail-open。
-- 指紋・quota・安全検証には一切載せない。

alter table public.profiles
  add column taste_learning_enabled boolean not null default true;

-- 20260712000100 でテーブル単位 UPDATE と profiles_update_own を外している。
-- 復活させると onboarding_status まで書き換え可能に戻るため、関数経由だけを足す。
create or replace function public.set_taste_learning_enabled(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result boolean;
begin
  -- set_onboarding_status と同じ規約。未認証・行欠落を null で黙らせない。
  -- updated_at は profiles_set_updated_at トリガが入れる
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  if p_enabled is null then
    raise exception using errcode = '22023', message = 'invalid_taste_learning_enabled';
  end if;

  update public.profiles as profile
  set taste_learning_enabled = p_enabled
  where profile.user_id = auth.uid()
  returning profile.taste_learning_enabled into v_result;

  if not found then
    raise exception using errcode = 'P0002', message = 'profile_not_found';
  end if;

  return v_result;
end;
$function$;

revoke all on function public.set_taste_learning_enabled(boolean) from public, anon;
grant execute on function public.set_taste_learning_enabled(boolean) to authenticated;

-- 集計。security invoker なので所有者 select ポリシーがそのまま効く。
-- 窓 90 日・50 件、半減期 30 日。回数はすべて derivation_group_id 単位で数える。
-- 未認証（service クライアント経由の誤用を含む）は no_history に紛れさせず 42501 で落とす。
-- 呼び出し側は fail-open なので生成は止まらず、誤配線だけがエラーとして見える。
create or replace function public.get_taste_signals(
  p_now timestamptz default pg_catalog.now()
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  return (
with settings as (
  select p.taste_learning_enabled as enabled
  from public.profiles p
  where p.user_id = (select auth.uid())
),
recent as (
  select
    m.id,
    m.derivation_group_id,
    m.cuisine_genre,
    m.total_elapsed_minutes,
    m.change_reason,
    m.preference_snapshot,
    pg_catalog.power(
      0.5::double precision,
      pg_catalog.date_part('epoch', v_now - m.created_at)::double precision / 86400.0 / 30.0
    ) as decay,
    pg_catalog.power(
      0.5::double precision,
      pg_catalog.date_part('epoch', v_now - m.created_at)::double precision / 86400.0 / 30.0
    ) * (
      (case when m.is_favorite then 1.0 else 0.0 end)
      + (case when m.is_selected then 0.3 else 0.0 end)
    )::double precision as score
  from public.menus m
  where m.user_id = (select auth.uid())
    -- 上端も切る。基準時刻より後の行は経過が負になり重みが 1 を超える
    and m.created_at >= v_now - interval '90 days'
    and m.created_at <= v_now
  order by m.created_at desc, m.id desc
  limit 50
),
liked as (select * from recent where score > 0),
-- 料理: score 合計降順。同名は 1 つに畳み、role は最も重い出現のものを採る
liked_dish_rows as (
  select
    d.name as dish_name,
    (pg_catalog.array_agg(d.role order by l.score desc, d.id))[1] as role,
    pg_catalog.sum(l.score) as weight
  from liked l
  join public.dishes d on d.menu_id = l.id
  group by d.name
  order by pg_catalog.sum(l.score) desc, d.name
  limit 12
),
-- 食材: 献立内の重複を潰してから派生グループ単位で数える。
-- l.id を含めないと、同じグループ・同じ score の別献立が 1 行に潰れて重みが減る
liked_ingredient_rows_raw as (
  select distinct l.id, l.derivation_group_id, l.score, di.name
  from liked l
  join public.dishes d on d.menu_id = l.id
  join public.dish_ingredients di on di.dish_id = d.id
),
liked_ingredient_rows as (
  select name, pg_catalog.sum(score) as weight
  from liked_ingredient_rows_raw
  group by name
  having pg_catalog.count(distinct derivation_group_id) >= 2
  order by pg_catalog.sum(score) desc, name
  limit 8
),
-- 対応表: prompt へは出さない。落とした料理の食材を消すためだけに使う。
-- likedDishes の 12 件上限も 1 料理あたりの食材上限も掛けない。切ると差集合が
-- 両方向に壊れる（残した料理の食材が表から漏れて誤って消える／落とした料理の
-- 食材が表から漏れて likedIngredients に残り同じ皿へ戻す）。
-- 名前の畳み方は liked_dish_rows と同じ group by d.name に揃える。
dish_index_rows as (
  select d.name as dish_name, pg_catalog.array_agg(distinct di.name) as ingredients
  from liked l
  join public.dishes d on d.menu_id = l.id
  join public.dish_ingredients di on di.dish_id = d.id
  group by d.name
),
-- 時間帯: 加重平均は小数になるため <=20 / <=40 / それ以外で連続させる。
-- 全件 20 分でも減衰の違いで 20.000000000000004 になり得るので、比較前に丸める
time_band as (
  select case
    when w.total is null or w.total = 0 then null
    when w.avg_minutes <= 20 then 'short'
    when w.avg_minutes <= 40 then 'standard'
    else 'slow'
  end as band
  from (
    select
      pg_catalog.sum(score) as total,
      pg_catalog.round(
        (pg_catalog.sum(score * total_elapsed_minutes) / nullif(pg_catalog.sum(score), 0))::numeric,
        6
      ) as avg_minutes
    from liked
  ) w
),
-- ジャンル: 母集団はおまかせ依頼のみ。比率は生成結果の cuisine_genre で取る
genre_pool as (
  select l.cuisine_genre, l.score
  from liked l
  where l.preference_snapshot #>> '{submission,cuisineGenre}' = 'any'
),
genre_total as (select pg_catalog.sum(score) as total from genre_pool),
genre_rows as (
  select g.cuisine_genre, pg_catalog.sum(g.score) as weight
  from genre_pool g, genre_total t
  where g.cuisine_genre <> 'any' and t.total > 0
  group by g.cuisine_genre, t.total
  having pg_catalog.sum(g.score) / t.total >= 0.35
  order by pg_catalog.sum(g.score) desc, g.cuisine_genre
  limit 2
),
-- 使いすぎ: 窓内全献立のメイン食材。派生グループ単位で 3 回以上。
-- 配列でない値や文字列でない要素は読み飛ばす。1 行の崩れで関数全体を落とさない
main_ingredient_groups as (
  select r.derivation_group_id, e.value #>> '{}' as name, pg_catalog.max(r.decay) as decay
  from recent r,
    lateral pg_catalog.jsonb_array_elements(
      case
        when pg_catalog.jsonb_typeof(r.preference_snapshot #> '{submission,mainIngredients}') = 'array'
          then r.preference_snapshot #> '{submission,mainIngredients}'
        else '[]'::jsonb
      end
    ) as e(value)
  where pg_catalog.jsonb_typeof(e.value) = 'string'
    and pg_catalog.btrim(e.value #>> '{}') <> ''
  group by r.derivation_group_id, e.value #>> '{}'
),
overused_rows as (
  select name, pg_catalog.sum(decay) as weight
  from main_ingredient_groups
  group by name
  having pg_catalog.count(*) >= 3
  order by pg_catalog.sum(decay) desc, name
  limit 3
),
-- 避ける軸: 恒常と読めるのは child_friendly だけ。派生グループ単位で 2 回以上
child_groups as (
  select pg_catalog.count(distinct derivation_group_id) as group_count
  from recent
  where change_reason = 'child_friendly'
),
group_count as (
  select pg_catalog.count(distinct derivation_group_id) as total from recent
)
-- 分岐順は disabled -> no_history -> 本体。OFF の利用者は窓が空でも disabled を返す
select case
  -- profiles 行は on_auth_user_created トリガが作るため通常は存在する。
  -- 万一無い場合も列の既定値と同じ ON として扱う（false に倒すと既定 ON と食い違う）
  when coalesce((select enabled from settings), true) is not true
    then pg_catalog.jsonb_build_object('reason', 'disabled')
  when (select total from group_count) = 0
    then pg_catalog.jsonb_build_object('reason', 'no_history')
  -- jsonb_agg には明示の order by が要る。CTE 側の order by は集約の順序にならず、
  -- LIMIT で中身は守られてもプロンプトへ出る並びが重み順にならない
  else pg_catalog.jsonb_build_object(
    'reason', null,
    'likedDishes', coalesce(
      (select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('dishName', dish_name, 'role', role)
        order by weight desc, dish_name)
       from liked_dish_rows), '[]'::jsonb),
    'likedGenres', coalesce(
      (select pg_catalog.jsonb_agg(cuisine_genre order by weight desc, cuisine_genre)
       from genre_rows), '[]'::jsonb),
    'likedIngredients', coalesce(
      (select pg_catalog.jsonb_agg(name order by weight desc, name)
       from liked_ingredient_rows), '[]'::jsonb),
    'likedTimeBand', (select band from time_band),
    'overusedIngredients', coalesce(
      (select pg_catalog.jsonb_agg(name order by weight desc, name)
       from overused_rows), '[]'::jsonb),
    'avoidAxes', case
      when (select group_count from child_groups) >= 2
        then pg_catalog.jsonb_build_array('child_unfriendly')
      else '[]'::jsonb
    end,
    'signalStrength', case
      when (select total from group_count) >= 15 then 'strong'
      when (select total from group_count) >= 5 then 'medium'
      else 'weak'
    end,
    'dishIngredientIndex', coalesce(
      (select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'dishName', dish_name,
          'ingredients', pg_catalog.to_jsonb(ingredients))
        order by dish_name)
       from dish_index_rows), '[]'::jsonb)
  )
end
  );
end;
$function$;

revoke all on function public.get_taste_signals(timestamptz) from public, anon;
grant execute on function public.get_taste_signals(timestamptz) to authenticated;
```

- [ ] **Step 4: マイグレーションを適用し、テストが通ることを確認する**

Run:
```bash
docker compose run --rm migrate
docker compose --profile test run --rm db-test > /tmp/dbtest.log 2>&1; \
  grep -nE "not ok|Failed|ERROR" /tmp/dbtest.log | head -20 || tail -n 20 /tmp/dbtest.log
```
Expected: PASS（`not ok` が 0 件）。

- [ ] **Step 5: 生成型を更新する**

スタックを起動したうえで（`docker compose up -d --wait`）:
```bash
docker compose run --rm app npm run db:types
git diff --stat src/shared/types/database.generated.ts
```
Expected: `taste_learning_enabled` と 2 つの関数が差分に現れる。**このファイルは手編集しない。**

- [ ] **Step 6: コミット**

```bash
git add supabase/migrations/20260922120000_taste_learning.sql \
  supabase/tests/database/taste_signals.test.sql \
  src/shared/types/database.generated.ts
git commit -m "feat(db): 好みの学習の集計関数とトグル列を追加する

profiles へ taste_learning_enabled を足し、更新は set_taste_learning_enabled
経由だけにする。20260712000100 で外したテーブル単位 UPDATE は復活させない。

get_taste_signals は security invoker で所有者の menus/dishes/dish_ingredients を
読み、窓 90 日・50 件・半減期 30 日で集計する。強さも最低出現回数も
derivation_group_id 単位で数える。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 契約（Zod・定数）

**Files:**
- Create: `shared/contracts/taste-hints.ts`
- Test: `shared/contracts/taste-hints.test.ts`

**Interfaces:**
- Consumes: `dishRoles`（`shared/contracts/generation.ts` の既存 export）
- Produces: `tasteHintsSchema` / `TasteHints` / `tasteSignalsSchema` / `TasteSignals` / `tasteHintsRecordSchema` / `TasteSignalStrength` / `hasTasteContent()` と全定数

- [ ] **Step 1: 失敗するテストを書く**

`shared/contracts/taste-hints.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  TASTE_HALF_LIFE_DAYS,
  TASTE_LIKED_DISHES_MAX,
  TASTE_STRENGTH_MEDIUM_MIN,
  TASTE_STRENGTH_STRONG_MIN,
  TASTE_WINDOW_DAYS,
  TASTE_WINDOW_MENUS,
  hasTasteContent,
  tasteHintsSchema,
  tasteHintsRecordSchema,
  tasteSignalsSchema,
  type TasteHints,
} from "./taste-hints.js";

const empty: TasteHints = {
  likedDishes: [],
  likedGenres: [],
  likedIngredients: [],
  likedTimeBand: null,
  overusedIngredients: [],
  avoidAxes: [],
  signalStrength: "strong",
};

describe("taste-hints contract", () => {
  it("locks the window, half-life, and strength boundaries", () => {
    expect(TASTE_WINDOW_DAYS).toBe(90);
    expect(TASTE_WINDOW_MENUS).toBe(50);
    expect(TASTE_HALF_LIFE_DAYS).toBe(30);
    expect(TASTE_STRENGTH_MEDIUM_MIN).toBe(5);
    expect(TASTE_STRENGTH_STRONG_MIN).toBe(15);
    expect(TASTE_LIKED_DISHES_MAX).toBe(12);
  });

  it("rejects unknown keys and over-long arrays", () => {
    expect(tasteHintsSchema.safeParse({ ...empty, extra: 1 }).success).toBe(false);
    expect(
      tasteHintsSchema.safeParse({
        ...empty,
        likedDishes: Array.from({ length: 13 }, (_, index) => ({ dishName: `d${String(index)}` })),
      }).success,
    ).toBe(false);
  });

  it("accepts the signals shape with the index but not the hints shape", () => {
    const signals = { ...empty, dishIngredientIndex: [{ dishName: "肉じゃが", ingredients: ["牛肉"] }] };
    expect(tasteSignalsSchema.safeParse(signals).success).toBe(true);
    expect(tasteHintsSchema.safeParse(signals).success).toBe(false);
  });

  it("treats strength alone as no content", () => {
    expect(hasTasteContent(empty)).toBe(false);
    expect(hasTasteContent({ ...empty, likedTimeBand: "standard" })).toBe(true);
    expect(hasTasteContent({ ...empty, likedDishes: [{ dishName: "肉じゃが" }] })).toBe(true);
    expect(hasTasteContent({ ...empty, avoidAxes: ["child_unfriendly"] })).toBe(true);
  });

  it("records only applied:true with a strength", () => {
    expect(tasteHintsRecordSchema.safeParse({ applied: true, strength: "medium" }).success).toBe(true);
    expect(tasteHintsRecordSchema.safeParse({ applied: false, strength: "medium" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: 落ちることを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run shared/contracts/taste-hints.test.ts`
Expected: FAIL（`Cannot find module './taste-hints.js'`）

- [ ] **Step 3: 契約を実装する**

`shared/contracts/taste-hints.ts`:

```ts
import { z } from "zod";
import { dishRoles } from "./generation.js";

/** 学習の強さ。窓内の derivation_group_id の個数から決まる */
export const tasteSignalStrengths = ["weak", "medium", "strong"] as const;
export type TasteSignalStrength = (typeof tasteSignalStrengths)[number];

/**
 * 所要時間帯。加重平均は小数になるため、境界は <=20 / <=40 / それ以外で連続させる
 * （21-40 と刻むと 20.5 分がどの帯にも入らない）。
 */
export const tasteTimeBands = ["short", "standard", "slow"] as const;

/** 恒常シグナルとして読めるのは child_friendly だけ（設計 §4.3） */
export const tasteAvoidAxes = ["child_unfriendly"] as const;

/** 集計窓と減衰。SQL 側はリテラルで持ち、境界の同値性は pgTAP が担保する */
export const TASTE_WINDOW_DAYS = 90 as const;
export const TASTE_WINDOW_MENUS = 50 as const;
export const TASTE_HALF_LIFE_DAYS = 30 as const;
export const TASTE_FAVORITE_WEIGHT = 1.0 as const;
export const TASTE_SELECTED_WEIGHT = 0.3 as const;

/** 強さの境界（窓内の derivation_group_id の個数） */
export const TASTE_STRENGTH_MEDIUM_MIN = 5 as const;
export const TASTE_STRENGTH_STRONG_MIN = 15 as const;

/** 最低出現回数。1 回だけの食材を「好き」「使いすぎ」と言わない */
export const TASTE_LIKED_INGREDIENT_MIN_COUNT = 2 as const;
export const TASTE_OVERUSED_INGREDIENT_MIN_COUNT = 3 as const;
export const TASTE_AVOID_AXIS_MIN_COUNT = 2 as const;

/** ジャンルを出す最低比率。和洋中 3 値のうち 2 つが常に入るのを防ぐ */
export const TASTE_GENRE_MIN_SHARE = 0.35 as const;

/** prompt 肥大を防ぐ各上限 */
export const TASTE_LIKED_DISHES_MAX = 12 as const;
export const TASTE_LIKED_GENRES_MAX = 2 as const;
export const TASTE_LIKED_INGREDIENTS_MAX = 8 as const;
export const TASTE_OVERUSED_INGREDIENTS_MAX = 3 as const;

const foodNameSchema = z.string().min(1).max(100);

/** prompt と preference_snapshot に出る形。対応表は含まない */
export const tasteHintsSchema = z
  .object({
    likedDishes: z
      .array(z.object({ dishName: foodNameSchema, role: z.enum(dishRoles).optional() }))
      .max(TASTE_LIKED_DISHES_MAX),
    likedGenres: z.array(z.enum(["japanese", "western", "chinese"])).max(TASTE_LIKED_GENRES_MAX),
    likedIngredients: z.array(foodNameSchema).max(TASTE_LIKED_INGREDIENTS_MAX),
    likedTimeBand: z.enum(tasteTimeBands).nullable(),
    overusedIngredients: z.array(foodNameSchema).max(TASTE_OVERUSED_INGREDIENTS_MAX),
    avoidAxes: z.array(z.enum(tasteAvoidAxes)).max(1),
    signalStrength: z.enum(tasteSignalStrengths),
  })
  .strict();

export type TasteHints = z.infer<typeof tasteHintsSchema>;

/**
 * 集計関数の戻り。dishIngredientIndex は落とした料理の食材を消すための対応表で、
 * prompt にも preference_snapshot にもログにも出さない（sanitize で捨てる）。
 *
 * 対応表には上限を掛けない。prompt へ出ないので肥大を防ぐ理由が無く、切ると差集合が
 * 両方向に壊れる: お気に入りが 13 件あると、残した料理の食材が表から漏れて誤って消え、
 * 落とした料理の食材も表から漏れて likedIngredients に残る。
 * 窓（90 日・50 献立）が実質の上限になる。
 */
export const tasteSignalsSchema = z
  .object({
    ...tasteHintsSchema.shape,
    dishIngredientIndex: z.array(
      z.object({ dishName: foodNameSchema, ingredients: z.array(foodNameSchema) }),
    ),
  })
  .strict();

export type TasteSignals = z.infer<typeof tasteSignalsSchema>;

/**
 * 中身が空なら prompt にも記録にも出さない。
 * signalStrength は「中身」ではないので、それだけでは載せない。
 */
export function hasTasteContent(hints: TasteHints): boolean {
  return (
    hints.likedDishes.length > 0 ||
    hints.likedGenres.length > 0 ||
    hints.likedIngredients.length > 0 ||
    hints.overusedIngredients.length > 0 ||
    hints.avoidAxes.length > 0 ||
    hints.likedTimeBand !== null
  );
}

/** preference_snapshot へ記録する形。ブラウザはこれだけを読む */
export const tasteHintsRecordSchema = z
  .object({ applied: z.literal(true), strength: z.enum(tasteSignalStrengths) })
  .strict();

export type TasteHintsRecord = z.infer<typeof tasteHintsRecordSchema>;
```

- [ ] **Step 4: 通ることを確認する**

Run:
```bash
docker compose run --rm --no-deps app npx vitest run shared/contracts/taste-hints.test.ts
docker compose run --rm --no-deps app npm run typecheck
```
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add shared/contracts/taste-hints.ts shared/contracts/taste-hints.test.ts
git commit -m "feat(contracts): 好みの学習の Zod 契約と定数を追加する

prompt へ出す TasteHints と、対応表を含む集計戻り TasteSignals を分ける。
対応表は sanitize で捨てるため契約上も別型にする。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: ローダ・安全フィルタ・sanitize

**Files:**
- Create: `netlify/functions/_shared/taste-hints.ts`
- Test: `netlify/functions/_shared/taste-hints.test.ts`

**Interfaces:**
- Consumes: Task 2 の契約、`shared/safety/allergens.js` の `foodTextContainsAlias`、`shared/safety-pure/normalize-food-text.js` の `normalizeFoodText`、`shared/safety/generation-context.js` の `GenerationContext`、`diversity-hints.js` の `RecentDishHint`
- Produces:
  - `TASTE_HINTS_ENABLED: true`、`TASTE_SYSTEM_MARKER: "【学習】"`、`TASTE_HINTS_TIMEOUT_MS: 200`
  - `type TasteHintsOutcome`（8 値）
  - `loadTasteHints(input: { ownerClient: unknown; timeoutMs?: number }): Promise<{ signals: TasteSignals | null; outcome: TasteHintsOutcome }>`
  - `filterTasteHintsForSafety(signals: TasteSignals, context: GenerationContext): TasteSignals`
  - `sanitizeTasteHints(signals: TasteSignals, recentDishHints: readonly RecentDishHint[]): TasteHints | null`
  - `isTasteHintsEnabled(flag: boolean): boolean`

- [ ] **Step 1: 失敗するテストを書く**

`netlify/functions/_shared/taste-hints.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeGenerationContext, makeIdeaGenerationContext } from "../../../shared/testing/factories.js";
import type { TasteSignals } from "../../../shared/contracts/taste-hints.js";
import {
  TASTE_HINTS_ENABLED,
  TASTE_HINTS_TIMEOUT_MS,
  TASTE_SYSTEM_MARKER,
  filterTasteHintsForSafety,
  loadTasteHints,
  sanitizeTasteHints,
} from "./taste-hints.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function makeOwnerClient(result: { data: unknown; error: { message?: string } | null; delayMs?: number }): unknown {
  const delayMs = result.delayMs ?? 0;
  return {
    rpc: () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve({ data: result.data, error: result.error });
        }, delayMs);
      }),
  };
}

const signals: TasteSignals = {
  likedDishes: [{ dishName: "肉じゃが", role: "main" }, { dishName: "ぶり大根", role: "main" }],
  likedGenres: ["japanese"],
  likedIngredients: ["牛肉", "じゃがいも", "ぶり", "大根"],
  likedTimeBand: "standard",
  overusedIngredients: ["豚肉"],
  avoidAxes: ["child_unfriendly"],
  signalStrength: "medium",
  dishIngredientIndex: [
    { dishName: "肉じゃが", ingredients: ["牛肉", "じゃがいも"] },
    { dishName: "ぶり大根", ingredients: ["ぶり", "大根"] },
  ],
};

describe("taste-hints constants", () => {
  it("locks default-on flag, marker, and timeout", () => {
    expect(TASTE_HINTS_ENABLED).toBe(true);
    expect(TASTE_SYSTEM_MARKER).toBe("【学習】");
    expect(TASTE_HINTS_TIMEOUT_MS).toBe(200);
  });
});

describe("loadTasteHints", () => {
  it("reads reason before schema parsing so disabled is not invalid_shape", async () => {
    const result = await loadTasteHints({ ownerClient: makeOwnerClient({ data: { reason: "disabled" }, error: null }) });
    expect(result).toEqual({ signals: null, outcome: "disabled_user" });
  });

  it("maps no_history without parsing", async () => {
    const result = await loadTasteHints({ ownerClient: makeOwnerClient({ data: { reason: "no_history" }, error: null }) });
    expect(result.outcome).toBe("no_history");
  });

  it("strips reason before parsing so the success object clears the strict schema", async () => {
    const result = await loadTasteHints({
      ownerClient: makeOwnerClient({ data: { reason: null, ...signals }, error: null }),
    });
    expect(result.outcome).toBe("applied");
    expect(result.signals).toEqual(signals);
  });

  it("reports invalid_shape for a broken payload", async () => {
    const result = await loadTasteHints({ ownerClient: makeOwnerClient({ data: { reason: null, likedDishes: "no" }, error: null }) });
    expect(result).toEqual({ signals: null, outcome: "invalid_shape" });
  });

  it("returns query_failed on error and never throws", async () => {
    const result = await loadTasteHints({ ownerClient: makeOwnerClient({ data: null, error: { message: "boom" } }) });
    expect(result.outcome).toBe("query_failed");
  });

  it("times out at the budget", async () => {
    vi.useFakeTimers();
    const promise = loadTasteHints({
      ownerClient: makeOwnerClient({ data: { reason: null, ...signals }, error: null, delayMs: 500 }),
      timeoutMs: 200,
    });
    await vi.advanceTimersByTimeAsync(250);
    await expect(promise).resolves.toEqual({ signals: null, outcome: "timeout" });
  });
});

describe("filterTasteHintsForSafety", () => {
  it("drops liked foods that hit a current dislike and clears them from the index too", () => {
    const context = makeGenerationContext({
      memberPreferences: [
        {
          householdMemberId: "11111111-1111-4111-8111-111111111111",
          anonymousMemberRef: "member_1",
          portionSize: "regular",
          spiceLevel: "mild",
          easePreferences: [],
          dislikes: ["じゃがいも"],
        },
      ],
    });
    const filtered = filterTasteHintsForSafety(signals, context);
    expect(filtered.likedIngredients).not.toContain("じゃがいも");
    expect(filtered.dishIngredientIndex.find((entry) => entry.dishName === "肉じゃが")?.ingredients).not.toContain("じゃがいも");
  });

  it("clears avoidAxes for idea mode", () => {
    const filtered = filterTasteHintsForSafety(signals, makeIdeaGenerationContext());
    expect(filtered.avoidAxes).toEqual([]);
  });
});

describe("sanitizeTasteHints", () => {
  it("drops recent dishes and the ingredients only they contributed", () => {
    const hints = sanitizeTasteHints(signals, [{ dishName: "肉じゃが", role: "main" }]);
    expect(hints).not.toBeNull();
    expect(hints?.likedDishes.map((dish) => dish.dishName)).toEqual(["ぶり大根"]);
    // 牛肉・じゃがいもは肉じゃがにしか出ないので落ちる。ぶり・大根は残る
    expect(hints?.likedIngredients).toEqual(["ぶり", "大根"]);
  });

  it("never returns the index", () => {
    const hints = sanitizeTasteHints(signals, []);
    expect(hints).not.toBeNull();
    expect(Object.keys(hints ?? {})).not.toContain("dishIngredientIndex");
  });

  it("returns null when nothing is left", () => {
    const bare: TasteSignals = {
      likedDishes: [],
      likedGenres: [],
      likedIngredients: [],
      likedTimeBand: null,
      overusedIngredients: [],
      avoidAxes: [],
      signalStrength: "strong",
      dishIngredientIndex: [],
    };
    expect(sanitizeTasteHints(bare, [])).toBeNull();
  });
});
```

`makeGenerationContext` / `makeIdeaGenerationContext` の引数形は `shared/testing/factories.ts` の既存シグネチャに合わせる。上書きを受け付けない場合は、返り値をスプレッドして必要なフィールドだけ差し替える。

- [ ] **Step 2: 落ちることを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/taste-hints.test.ts`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 実装する**

`netlify/functions/_shared/taste-hints.ts`:

```ts
/**
 * 好みの学習ヒント（tasteHints）。fail-open・prompt 専用。
 * fingerprint / quota / 検証には載せない。diversity-hints.ts と同型。
 */
import {
  hasTasteContent,
  tasteSignalsSchema,
  type TasteHints,
  type TasteSignals,
} from "../../../shared/contracts/taste-hints.js";
import { foodTextContainsAlias } from "../../../shared/safety/allergens.js";
import { normalizeFoodText } from "../../../shared/safety-pure/normalize-food-text.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";
import type { RecentDishHint } from "./diversity-hints.js";

export const TASTE_HINTS_ENABLED = true as const;
export const TASTE_SYSTEM_MARKER = "【学習】" as const;
export const TASTE_HINTS_TIMEOUT_MS = 200 as const;

export type TasteHintsOutcome =
  | "disabled_flag"
  | "disabled_user"
  | "no_history"
  | "timeout"
  | "query_failed"
  | "invalid_shape"
  | "filtered_empty"
  | "applied";

export type TasteHintsLoadResult = {
  signals: TasteSignals | null;
  outcome: TasteHintsOutcome;
};

/** `true as const` を三項へ直接置くと lint が死枝扱いするため boolean 引数で広げる */
export function isTasteHintsEnabled(flag: boolean): boolean {
  return flag;
}

type OwnerClientForTaste = {
  rpc: (
    name: "get_taste_signals",
    args: Record<string, never>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

function isOwnerClientForTaste(client: unknown): client is OwnerClientForTaste {
  if (typeof client !== "object" || client === null || !("rpc" in client)) return false;
  return typeof client.rpc === "function";
}

function readReason(data: unknown): string | null | undefined {
  if (typeof data !== "object" || data === null || !("reason" in data)) return undefined;
  const reason = (data as { reason: unknown }).reason;
  if (reason === null) return null;
  return typeof reason === "string" ? reason : undefined;
}

async function querySignals(client: OwnerClientForTaste): Promise<TasteHintsLoadResult> {
  const { data, error } = await client.rpc("get_taste_signals", {});
  if (error !== null) return { signals: null, outcome: "query_failed" };

  // reason は safeParse より先に見る。理由オブジェクトを schema に通すと
  // disabled / no_history が invalid_shape へ潰れる。
  const reason = readReason(data);
  if (reason === "disabled") return { signals: null, outcome: "disabled_user" };
  if (reason === "no_history") return { signals: null, outcome: "no_history" };
  if (reason !== null) return { signals: null, outcome: "invalid_shape" };

  const { reason: _ignored, ...rest } = data as { reason: null } & Record<string, unknown>;
  const parsed = tasteSignalsSchema.safeParse(rest);
  if (!parsed.success) return { signals: null, outcome: "invalid_shape" };
  return { signals: parsed.data, outcome: "applied" };
}

/**
 * 集計ヒントを owner 境界で読む。
 * 失敗・タイムアウト・0 件はすべて signals: null。決して throw しない。
 */
export async function loadTasteHints(input: {
  ownerClient: unknown;
  timeoutMs?: number;
}): Promise<TasteHintsLoadResult> {
  try {
    if (!isOwnerClientForTaste(input.ownerClient)) {
      return { signals: null, outcome: "query_failed" };
    }
    const timeoutMs = input.timeoutMs ?? TASTE_HINTS_TIMEOUT_MS;
    const ownerClient = input.ownerClient;
    const queryPromise = querySignals(ownerClient).catch(
      () => ({ signals: null, outcome: "query_failed" }) as TasteHintsLoadResult,
    );

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeoutId = setTimeout(() => {
        resolve("timeout");
      }, timeoutMs);
    });

    const raced = await Promise.race([
      queryPromise.then((result) => ({ kind: "ok" as const, result })),
      timeoutPromise.then(() => ({ kind: "timeout" as const })),
    ]);

    if (timeoutId !== undefined) clearTimeout(timeoutId);

    if (raced.kind === "timeout") {
      // 遅延 resolve した結果は採用しない（race 勝者のみ）。未処理 reject を避ける
      void queryPromise.catch(() => {
        /* ignore late failure */
      });
      return { signals: null, outcome: "timeout" };
    }
    return raced.result;
  } catch {
    return { signals: null, outcome: "query_failed" };
  }
}

/** 現行制約の語を集める。household は安全文脈も見る */
function collectBlockedTerms(context: GenerationContext): readonly string[] {
  const terms: string[] = [...context.submission.avoidIngredients];
  for (const preference of context.memberPreferences) {
    terms.push(...preference.dislikes);
  }
  if (context.targetMode === "household") {
    const allergenIds = new Set<string>();
    for (const member of context.safety.members) {
      for (const custom of member.customAllergies) {
        terms.push(custom.name, ...custom.aliases);
      }
      for (const allergenId of member.allergenIds) {
        allergenIds.add(allergenId);
      }
    }
    // AllergenDictionary は id キーの辞書ではなく { version, catalog, aliases } なので
    // aliases を allergenId で絞り込む
    for (const alias of context.safety.allergenDictionary.aliases) {
      if (allergenIds.has(alias.allergenId)) {
        terms.push(alias.alias);
      }
    }
  }
  return terms.filter((term) => normalizeFoodText(term) !== "");
}

function hitsBlocked(text: string, blocked: readonly string[]): boolean {
  return blocked.some((term) => foodTextContainsAlias(text, term));
}

/**
 * 過去の好みを現在の制約へ持ち込まないための prompt 衛生。
 * これは安全ゲートではない（実判定は validate-generated-menu と生成ハードゲート）。
 * あわせて idea の avoidAxes を空にする。集計関数はモードを知らないため、
 * generationContext が揃うこの位置が最初の適用点になる。
 */
export function filterTasteHintsForSafety(
  signals: TasteSignals,
  context: GenerationContext,
): TasteSignals {
  const blocked = collectBlockedTerms(context);
  return {
    ...signals,
    likedDishes: signals.likedDishes.filter((dish) => !hitsBlocked(dish.dishName, blocked)),
    likedIngredients: signals.likedIngredients.filter((name) => !hitsBlocked(name, blocked)),
    dishIngredientIndex: signals.dishIngredientIndex.map((entry) => ({
      dishName: entry.dishName,
      ingredients: entry.ingredients.filter((name) => !hitsBlocked(name, blocked)),
    })),
    avoidAxes: context.targetMode === "idea" ? [] : signals.avoidAxes,
  };
}

/**
 * 軸分けの確定。最近出した料理を落とし、その料理にしか出てこない食材も落とす。
 * 対応表は使い切ってここで捨てる（prompt にも記録にも出さない）。
 */
export function sanitizeTasteHints(
  signals: TasteSignals,
  recentDishHints: readonly RecentDishHint[],
): TasteHints | null {
  const recentNames = new Set(recentDishHints.map((hint) => normalizeFoodText(hint.dishName)));
  const keptDishes = signals.likedDishes.filter(
    (dish) => !recentNames.has(normalizeFoodText(dish.dishName)),
  );
  const keptNames = new Set(keptDishes.map((dish) => normalizeFoodText(dish.dishName)));

  // 残った料理に現れる食材だけを「まだ好き」と扱う。
  // 対応表に載っていない食材は由来が辿れないため保守的に残す。
  const survivingIngredients = new Set<string>();
  const indexedIngredients = new Set<string>();
  for (const entry of signals.dishIngredientIndex) {
    for (const name of entry.ingredients) {
      indexedIngredients.add(normalizeFoodText(name));
      if (keptNames.has(normalizeFoodText(entry.dishName))) {
        survivingIngredients.add(normalizeFoodText(name));
      }
    }
  }

  const hints: TasteHints = {
    likedDishes: keptDishes.slice(0, 12),
    likedGenres: signals.likedGenres.slice(0, 2),
    likedIngredients: signals.likedIngredients
      .filter((name) => {
        const normalized = normalizeFoodText(name);
        if (!indexedIngredients.has(normalized)) return true;
        return survivingIngredients.has(normalized);
      })
      .slice(0, 8),
    likedTimeBand: signals.likedTimeBand,
    overusedIngredients: signals.overusedIngredients.slice(0, 3),
    avoidAxes: signals.avoidAxes.slice(0, 1),
    signalStrength: signals.signalStrength,
  };

  return hasTasteContent(hints) ? hints : null;
}
```

上限のマジックナンバーは契約の定数（`TASTE_LIKED_DISHES_MAX` 等）を import して置き換える。

- [ ] **Step 4: 通ることを確認する**

Run:
```bash
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/taste-hints.test.ts
docker compose run --rm --no-deps app npm run typecheck
```
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add netlify/functions/_shared/taste-hints.ts netlify/functions/_shared/taste-hints.test.ts
git commit -m "feat(functions): 好みの学習ヒントのローダと安全フィルタを追加する

reason を safeParse より先に見て disabled / no_history を invalid_shape へ
潰さない。現行のアレルギー・苦手・避けたい食材で語を落とし、idea では
avoidAxes を空にする。最近出した料理とその料理にしか出ない食材を落とし、
対応表は sanitize で捨てる。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 設定トグルと告知文（配線より前に置く）

**Files:**
- Create: `src/features/account/taste-learning-api.ts`
- Create: `src/features/account/taste-learning-section.tsx`
- Test: `src/features/account/taste-learning-section.test.tsx`
- Modify: `src/features/privacy/privacy-copy.ts:41`（`privacySections` の「AIへ送る情報」）
- Modify: `src/features/privacy/privacy-copy.test.ts`
- Modify: `src/features/household/household-settings-page.tsx:1776-1779` と `:2536-2540`（2 箇所とも）

**Interfaces:**
- Consumes: Task 1 の `set_taste_learning_enabled` と `profiles.taste_learning_enabled`
- Produces: `getTasteLearningEnabled(client)` / `setTasteLearningEnabled(client, enabled)` / `<TasteLearningSection />`

- [ ] **Step 1: 失敗するテストを書く**

`src/features/account/taste-learning-section.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TasteLearningSection } from "./taste-learning-section";

function renderSection(props: Parameters<typeof TasteLearningSection>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TasteLearningSection {...props} />
    </QueryClientProvider>,
  );
}

describe("TasteLearningSection", () => {
  it("shows the stored value and the disclosure copy", async () => {
    renderSection({ enabled: true, onToggle: vi.fn() });
    const toggle = await screen.findByRole("switch", { name: "好みの学習" });
    expect(toggle).toBeChecked();
    expect(screen.getByText(/料理名と食材名/u)).toBeInTheDocument();
    expect(screen.getByText(/90日/u)).toBeInTheDocument();
  });

  it("sends the next value on toggle", async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    renderSection({ enabled: true, onToggle });
    await userEvent.click(await screen.findByRole("switch", { name: "好みの学習" }));
    await waitFor(() => {
      expect(onToggle).toHaveBeenCalledWith(false);
    });
  });

  it("restores the previous state when the update fails", async () => {
    const onToggle = vi.fn().mockRejectedValue(new Error("boom"));
    renderSection({ enabled: true, onToggle });
    await userEvent.click(await screen.findByRole("switch", { name: "好みの学習" }));
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "好みの学習" })).toBeChecked();
    });
    expect(screen.getByRole("status")).toHaveTextContent(/変更できませんでした/u);
  });
});
```

`src/features/privacy/privacy-copy.test.ts` へ追記:

```ts
it("discloses that liked dish and ingredient names are sent for up to 90 days", () => {
  const section = privacySections.find((entry) => entry.title === "AIへ送る情報");
  expect(section).toBeDefined();
  expect(section?.body).toMatch(/料理名と食材名/u);
  // overusedIngredients は ★ の付いていない献立も母集団に含むため、
  // 「お気に入り由来」だけの記述では実際に送る範囲より狭い
  expect(section?.body).toMatch(/繰り返し指定したメイン食材名/u);
  expect(section?.body).toMatch(/90日/u);
  expect(section?.body).toMatch(/設定/u);
});
```

- [ ] **Step 2: 落ちることを確認する**

Run:
```bash
docker compose run --rm --no-deps app npx vitest run \
  src/features/account/taste-learning-section.test.tsx \
  src/features/privacy/privacy-copy.test.ts
```
Expected: FAIL

- [ ] **Step 3: API を書く**

`src/features/account/taste-learning-api.ts`:

```ts
import { z } from "zod";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";

const profileRowSchema = z.object({ taste_learning_enabled: z.boolean() }).strict();

/** 設定画面用の読み取り。household の select("*") とは別に持つ */
export async function getTasteLearningEnabled(
  client: BrowserSupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("profiles")
    .select("taste_learning_enabled")
    .eq("user_id", userId)
    .single();
  if (error !== null) throw new Error("taste_learning_read_failed");
  return profileRowSchema.parse(data).taste_learning_enabled;
}

/** 更新は RPC 経由のみ。profiles のテーブル単位 UPDATE は revoke されたまま */
export async function setTasteLearningEnabled(
  client: BrowserSupabaseClient,
  enabled: boolean,
): Promise<boolean> {
  const { data, error } = await client.rpc("set_taste_learning_enabled", { p_enabled: enabled });
  if (error !== null) throw new Error("taste_learning_write_failed");
  return z.boolean().parse(data);
}
```

- [ ] **Step 4: セクションを書く**

`src/features/account/taste-learning-section.tsx`:

```tsx
import { useId, useState } from "react";

export const tasteLearningCopy = {
  title: "好みの学習",
  toggleLabel: "好みの学習",
  body: "★を付けた献立、「この献立にする」で選んだ献立、再生成の理由、入力したメイン食材から傾向を読み取り、次の提案に反映します。",
  sending:
    "献立を作るときに、そこから読み取った料理名と食材名（最長90日・最大50献立）がAIへ送られます。",
  storage: "OFFにすると読み取りをやめます。設定と反映の記録は保存されます。",
  failed: "設定を変更できませんでした。時間をおいてもう一度お試しください",
} as const;

export type TasteLearningSectionProps = {
  enabled: boolean;
  onToggle: (nextEnabled: boolean) => Promise<void>;
};

/**
 * 好みの学習の ON/OFF。読み取りは呼び出し側、書き込みは RPC。
 * 楽観表示はせず、失敗したら元の値へ戻す。
 */
export function TasteLearningSection({ enabled, onToggle }: TasteLearningSectionProps) {
  const [current, setCurrent] = useState(enabled);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const describedById = useId();

  return (
    <section className="card stack settings-section" aria-labelledby="taste-learning-title">
      <h2 id="taste-learning-title" className="settings-section-title">
        {tasteLearningCopy.title}
      </h2>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          role="switch"
          className="min-h-11 min-w-11"
          checked={current}
          aria-checked={current}
          aria-describedby={describedById}
          disabled={pending}
          onChange={(event) => {
            const next = event.target.checked;
            const previous = current;
            setPending(true);
            setFailed(false);
            setCurrent(next);
            void onToggle(next)
              .catch(() => {
                setCurrent(previous);
                setFailed(true);
              })
              .finally(() => {
                setPending(false);
              });
          }}
        />
        {tasteLearningCopy.toggleLabel}
      </label>
      <p id={describedById} className="type-small text-ink/80">
        {tasteLearningCopy.body}
        {tasteLearningCopy.sending}
        {tasteLearningCopy.storage}
      </p>
      {failed ? (
        <p className="type-small" role="status">
          {tasteLearningCopy.failed}
        </p>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 5: プライバシー文言を追記する**

`src/features/privacy/privacy-copy.ts` の `privacySections`「AIへ送る情報」の `body` 末尾へ次を連結する（既存文はそのまま残す）。

```ts
"また、好みの学習をONにしている場合は、★を付けた献立や選んだ献立から読み取った料理名と食材名、および直近で繰り返し指定したメイン食材名（最長90日・最大50献立）も送ります。設定でいつでも止められます。"
```

- [ ] **Step 6: 設定ページへ差し込む**

`src/features/household/household-settings-page.tsx` の 2 箇所（`:1776` 付近と `:2536` 付近）で `<ShareConsentSettingsSection userId={userId} />` の直後に置く。読み取りは `useQuery`、書き込みは `useMutation` で `setTasteLearningEnabled` を呼び、成功後に query を invalidate する。**2 箇所とも差し込む**（片方だけだとオンボーディング未完了の導線から設定が消える）。

- [ ] **Step 7: 通ることを確認する**

Run:
```bash
docker compose run --rm --no-deps app npx vitest run \
  src/features/account/taste-learning-section.test.tsx \
  src/features/privacy/privacy-copy.test.ts \
  src/features/household
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint > /tmp/lint.log 2>&1; \
  grep -nE "error" /tmp/lint.log | head -20 || tail -n 5 /tmp/lint.log
```
Expected: PASS

- [ ] **Step 8: コミット**

```bash
git add src/features/account/taste-learning-api.ts \
  src/features/account/taste-learning-section.tsx \
  src/features/account/taste-learning-section.test.tsx \
  src/features/privacy/privacy-copy.ts src/features/privacy/privacy-copy.test.ts \
  src/features/household/household-settings-page.tsx
git commit -m "feat(settings): 好みの学習のトグルと送信の告知を追加する

更新は set_taste_learning_enabled RPC 経由のみ。読み取りは設定画面用に
新設する。プライバシーページの「AIへ送る情報」に、料理名と食材名が
最長90日・最大50献立ぶん送られることと停止手段を書く。

配線より先にこの Task を入れ、初期値 ON のまま切る手段が無い状態を作らない。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: プロンプト合成

**Files:**
- Modify: `netlify/functions/_shared/diversity-hints.ts`（`DIVERSITY_PARAGRAPH_WITH_TASTE` を追加）
- Modify: `netlify/functions/_shared/taste-hints.ts`（`TASTE_PARAGRAPH` を追加）
- Modify: `netlify/functions/_shared/generation-prompt.ts:287-298`（`buildNewMenuSystemPrompt`）と `:549-590`（`buildGenerationMessages`）
- Modify: `netlify/functions/_shared/generation-service.ts:129-136`（`GenerationExecutionContext` の `new_menu` へフィールド追加）
- Modify: `netlify/functions/_shared/generation-prompt.test.ts`
- Create: `netlify/functions/_shared/generation-prompt-taste-off.test.ts`
- Modify（`tasteHints: null` を足すだけ）: `GenerationExecutionContext` の `new_menu` を構築している **9 箇所**
  - `netlify/functions/_shared/generation-prompt.test.ts:29`（`asNewMenuExecution`）
  - `netlify/functions/_shared/generation-prompt-diversity-off.test.ts:53`
  - `netlify/functions/_shared/generation-prompt-novelty-off.test.ts:50`
  - `netlify/functions/_shared/generation-prompt-kitchen-off.test.ts:55`
  - `netlify/functions/_shared/generation-context.test.ts:664`
  - `netlify/functions/_shared/generation-service.test.ts:180` と `:2083`
  - `netlify/functions/_shared/generation-adversarial.integration.test.ts:535` と `:798`
  - `netlify/functions/_shared/generation-quality-review-entry.ts:273`
  - `netlify/functions/_shared/paid-openrouter-benchmark-harness.ts:406`
  - `netlify/functions/_tests/generate-menu.test.ts:417`

**Interfaces:**
- Consumes: Task 2 の `TasteHints`、Task 3 の `TASTE_SYSTEM_MARKER` / `isTasteHintsEnabled` / `TASTE_HINTS_ENABLED`
- Produces: `buildGenerationMessages` が `GenerationExecutionContext` の `tasteHints: TasteHints | null`（new_menu のみ、**必須フィールド**）を読み、user payload の `tasteHints` キーと system の【学習】段落を出す

**フィールドは必須にし、構築箇所は同じ Task で埋める。** 省略可能にすると Task 6 の配線を
忘れても型が通り、「載せたつもりで載っていない」状態が検出できない。代わりに、この Task の
検証は `npm run typecheck` なので、上の 9 箇所へ `tasteHints: null` を**同時に**足す。
`recentDishHints` の隣に 1 行足すだけで、`generation-service.ts` が実際の値を入れるのは Task 6。

- [ ] **Step 1: 失敗するテストを書く**

`netlify/functions/_shared/generation-prompt.test.ts` へ追記:

```ts
現行の `asNewMenuExecution(context, recentDishHints)` は第 2 引数が配列である。第 3 引数を足す。

```ts
function asNewMenuExecution(
  context: GenerationContext,
  recentDishHints: readonly RecentDishHint[] = [],
  tasteHints: TasteHints | null = null,
): Extract<GenerationExecutionContext, { kind: "new_menu" }> {
  return {
    // ...既存フィールドはそのまま
    recentDishHints,
    tasteHints,
  };
}

const someTasteHints: TasteHints = {
  likedDishes: [{ dishName: "ぶり大根", role: "main" }],
  likedGenres: ["japanese"],
  likedIngredients: ["大根"],
  likedTimeBand: "standard",
  overusedIngredients: ["豚肉"],
  avoidAxes: [],
  signalStrength: "medium",
};
```

```ts
it("adds the taste paragraph and payload key only for new_menu", () => {
  const messages = buildGenerationMessages(
    asNewMenuExecution(makeGenerationContext(), [], someTasteHints),
  );
  const system = messages.find((message) => message.role === "system");
  const user = messages.find((message) => message.role === "user");
  expect(system?.content).toContain(TASTE_SYSTEM_MARKER);
  expect(user?.content).toContain("tasteHints");
  // 料理名は system 文へ連結しない（user JSON のエスケープ経由だけ）
  expect(system?.content).not.toContain("ぶり大根");
});

it("states the priority order exactly once", () => {
  const messages = buildGenerationMessages(
    asNewMenuExecution(makeGenerationContext(), [], someTasteHints),
  );
  const system = messages.find((message) => message.role === "system")?.content ?? "";
  expect(system.split("優先順位は次のとおりです。").length - 1).toBe(1);
});

it("omits the key entirely when there are no hints", () => {
  const messages = buildGenerationMessages(
    asNewMenuExecution(makeGenerationContext(), [], null),
  );
  const user = messages.find((message) => message.role === "user");
  expect(user?.content).not.toContain("tasteHints");
  expect(messages.find((message) => message.role === "system")?.content).not.toContain(
    TASTE_SYSTEM_MARKER,
  );
});
```

`generation-prompt-taste-off.test.ts` は `generation-prompt-diversity-off.test.ts` をひな型にし、`vi.hoisted` + `vi.mock("./taste-hints.js")` で `TASTE_HINTS_ENABLED` を `false` にしたうえで、段落もキーも出ないことを固定する。

- [ ] **Step 2: 落ちることを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/generation-prompt.test.ts netlify/functions/_shared/generation-prompt-taste-off.test.ts`
Expected: FAIL

- [ ] **Step 3: 段落を書く**

`netlify/functions/_shared/taste-hints.ts` へ追加:

```ts
/**
 * system 文の学習段落。先頭マーカーでテスト・運用識別する。
 * 値は載せない（料理名・食材名は user JSON の tasteHints にだけ出す）。
 */
export const TASTE_PARAGRAPH =
  TASTE_SYSTEM_MARKER +
  "優先順位は次のとおりです。" +
  "1)アレルギー・必須安全・must_use・品数・時間、" +
  "2)当日のpreferences（メイン食材・避けたい等）、" +
  "3)tasteHintsが示す好みのスタイル、" +
  "4)最近の料理に近くないこと（recentDishHints）、" +
  "5)季節。" +
  "tasteHints.likedDishesは、味の方向と調理法の傾向を汲むための材料です。" +
  "そこに挙げた料理名をそのまま出すためのリストとして使わないでください。" +
  "tasteHints.likedTimeBandとlikedGenresは、当日のpreferencesに指定があるときは無視してください。" +
  "tasteHints.signalStrengthがweakのときは参考程度に留めてください。" +
  "tasteHints.overusedIngredientsは連続を避ける対象であり、禁止食材ではありません。" +
  "tasteHints.avoidAxesは献立全体の寄せ方であり、constraint_conflictの理由にしないでください。" +
  "学習と他の制約が両立しないときは、通常どおりoutcome=successで返してください。" +
  "学習だけを理由にconstraint_conflictにしないでください。";
```

`netlify/functions/_shared/diversity-hints.ts` へ追加（既存 `DIVERSITY_PARAGRAPH` は変更しない）:

```ts
/**
 * 学習段落が同じ system 文に載るときの多様性段落。
 * 優先順位の文は学習段落側が持つため、ここでは番号を繰り返さない。
 */
export const DIVERSITY_PARAGRAPH_WITH_TASTE =
  DIVERSITY_SYSTEM_MARKER +
  "可能ならrecentDishHintsの料理名・役割が近い案は避けてください。" +
  "避けられない場合、履歴が空の場合、他の制約と両立できない場合は通常どおりoutcome=successで返してください。" +
  "多様性だけを理由にconstraint_conflictにしないでください。";
```

- [ ] **Step 4: 合成へ配線する**

`generation-prompt.ts`:

```ts
function buildNewMenuSystemPrompt(
  targetMode: GenerationContext["targetMode"],
  diversityEnabled: boolean,
  noveltyEnabled: boolean,
  tasteEnabled: boolean,
): string {
  const coreBody = buildGenerationSystemPromptCoreBody(readHouseholdKitchenPromptEnabledFlag());
  // 優先順位の文は 1 つの system 文に 1 回だけ。学習が載る版では多様性側から外す
  const diversity = diversityEnabled
    ? tasteEnabled
      ? DIVERSITY_PARAGRAPH_WITH_TASTE
      : DIVERSITY_PARAGRAPH
    : "";
  const taste = tasteEnabled ? TASTE_PARAGRAPH : "";
  const novelty = noveltyEnabled ? NOVELTY_PARAGRAPH : "";
  const modeExtra =
    targetMode === "idea"
      ? GENERATION_SYSTEM_PROMPT_IDEA_EXTRA
      : GENERATION_SYSTEM_PROMPT_HOUSEHOLD_EXTRA;
  return `${coreBody}${diversity}${taste}${novelty}${GENERATION_SYSTEM_PROMPT_SEASON}${modeExtra}`;
}
```

`buildGenerationMessages` の `new_menu` 分岐で:

```ts
// 学習ヒントは配線側で sanitize 済み。ここでは載せるかどうかだけを決める
const tasteHints = readTasteHintsEnabledFlag() ? (context.tasteHints ?? null) : null;
const tasteEnabled = tasteHints !== null;
const systemContent = buildNewMenuSystemPrompt(
  context.generationContext.targetMode,
  diversityEnabled,
  noveltyEnabled,
  tasteEnabled,
);
const payload = {
  ...basePayload,
  recentDishHints,
  ...(noveltyEnabled ? { noveltyExcludedDishes } : {}),
  ...(tasteEnabled ? { tasteHints } : {}),
};
```

`readTasteHintsEnabledFlag()` は `readDiversityHintsEnabledFlag` と同型で `isTasteHintsEnabled(TASTE_HINTS_ENABLED)` を返す。

`generation-service.ts:129-136` の `new_menu` 分岐へ必須フィールドを足す。

```ts
  | (ExecutionBase & {
      kind: "new_menu";
      command: Extract<GenerationCommand, { kind: "new_menu" }>;
      regeneration: null;
      /** soft diversity 用。空配列可。fingerprint / quota に含めない */
      recentDishHints: readonly RecentDishHint[];
      /** 学習ヒント。安全フィルタと sanitize 済みの確定形。同じく fingerprint / quota に含めない */
      tasteHints: TasteHints | null;
    })
```

- [ ] **Step 5: 構築箇所 9 つへ `tasteHints: null` を足す**

必須フィールドなので、Task 6 で実値を入れるまでのあいだ全構築箇所が欠落で落ちる。
`recentDishHints:` を書いている行の隣へ 1 行足す。

```bash
grep -rn "recentDishHints:" --include=*.ts netlify/ | grep -v generation-prompt.ts
```

対象（Files 節と同じ 9 ファイル・11 箇所）。`generation-prompt.test.ts` だけは Step 1 の
第 3 引数で入るため、残りへ `tasteHints: null,` を足す。`generation-service.test.ts:180` は
オーバーライド形なので `tasteHints: overrides.tasteHints ?? null,` にしておくと Task 6 が楽になる。

- [ ] **Step 6: 通ることを確認する**

Run:
```bash
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/generation-prompt.test.ts \
  netlify/functions/_shared/generation-prompt-taste-off.test.ts \
  netlify/functions/_shared/generation-prompt-diversity-off.test.ts \
  netlify/functions/_shared/generation-prompt-novelty-off.test.ts \
  netlify/functions/_shared/generation-prompt-kitchen-off.test.ts
docker compose run --rm --no-deps app npm run typecheck
```
Expected: PASS（既存 3 本の off テストも通ること）。`typecheck` は全構築箇所を見るため、
Step 5 の追記漏れはここで落ちる。

- [ ] **Step 7: コミット**

```bash
git add netlify/functions/_shared/taste-hints.ts netlify/functions/_shared/diversity-hints.ts \
  netlify/functions/_shared/generation-prompt.ts netlify/functions/_shared/generation-service.ts \
  netlify/functions/_shared/generation-context.test.ts \
  netlify/functions/_shared/generation-service.test.ts \
  netlify/functions/_shared/generation-adversarial.integration.test.ts \
  netlify/functions/_shared/generation-quality-review-entry.ts \
  netlify/functions/_shared/paid-openrouter-benchmark-harness.ts \
  netlify/functions/_tests/generate-menu.test.ts \
  netlify/functions/_shared/generation-prompt-diversity-off.test.ts \
  netlify/functions/_shared/generation-prompt-novelty-off.test.ts \
  netlify/functions/_shared/generation-prompt-kitchen-off.test.ts \
  netlify/functions/_shared/generation-prompt.test.ts \
  netlify/functions/_shared/generation-prompt-taste-off.test.ts
git commit -m "feat(prompt): new_menu へ学習段落と tasteHints を載せる

優先順位の文が同じ system 文に二度出ないよう、学習が載る版の多様性段落を
別に用意して番号を持たせない。料理名と食材名は system 文へ連結せず、
user JSON の tasteHints にだけ出す。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: 配線・記録・観測ログ

**Files:**
- Modify: `netlify/functions/_shared/generation-service.ts:450-480`（`loadExecutionContext`）、`:675-700`（`buildSuccessInput`）、`:815-827`（`emitTerminalLog`）
- Modify: `netlify/functions/_shared/logger.ts` — `SafeGenerationLogEvent`（`:85-90`）、`logGenerationEvent`（`:470-485`）、`SafeLogEvent`（`:14`）、`createSafeLogger`（`:271-`）、`SAFE_LOG_SERIALIZED_KEYS`（`:207`）の 5 箇所
- Modify: `scripts/assert-privacy-logs.mjs:31`（`allowedLogKeys`）
- Modify: `netlify/functions/_shared/generation-service.test.ts`

**Interfaces:**
- Consumes: Task 3 のローダ一式、Task 5 の `tasteHints` フィールド
- Produces: `preference_snapshot.tasteHints = { applied: true, strength }`、ログの `taste_hints_outcome`

- [ ] **Step 1: 失敗するテストを書く**

`generation-service.test.ts` へ追記:

```ts
it("records the snapshot from the sanitized object, not the raw signals", async () => {
  // sanitize 後に空になるケース: liked はすべて recentDishHints と重なる
  const deps = makeDeps({
    tasteSignals: {
      likedDishes: [{ dishName: "肉じゃが", role: "main" }],
      likedGenres: [],
      likedIngredients: ["牛肉"],
      likedTimeBand: null,
      overusedIngredients: [],
      avoidAxes: [],
      signalStrength: "strong",
      dishIngredientIndex: [{ dishName: "肉じゃが", ingredients: ["牛肉"] }],
    },
    recentDishHints: [{ dishName: "肉じゃが", role: "main" }],
  });
  const result = await runNewMenu(deps);
  expect(result.preferenceSnapshot).not.toHaveProperty("tasteHints");
});

it("never feeds tasteHints into the safety fingerprint", async () => {
  const withHints = await runNewMenu(makeDeps({ tasteSignals: someSignals }));
  const withoutHints = await runNewMenu(makeDeps({ tasteSignals: null }));
  expect(withHints.safetyFingerprint).toBe(withoutHints.safetyFingerprint);
});

it("logs a closed outcome enum on the terminal log, not only on success", async () => {
  // 学習ヒントがタイムアウトしても生成自体は成功する。succeeded ログに結末が残ること
  const deps = makeDeps({ tasteSignals: null, tasteOutcome: "timeout" });
  await runNewMenu(deps);
  expect(deps.loggedEvents.at(-1)).toMatchObject({ tasteHintsOutcome: "timeout" });

  // 失敗経路（fail / constraint_conflict）も同じ emitTerminalLog を通る
  const failing = makeDeps({ tasteSignals: null, tasteOutcome: "query_failed", failWith: "generation_timeout" });
  await runNewMenu(failing);
  expect(failing.loggedEvents.at(-1)).toMatchObject({ tasteHintsOutcome: "query_failed" });
});
```

`netlify/functions/_shared/logger.test.ts` へも追記する。イベント型に足すだけでは
出力へ届かないため、**シリアライズ結果**を見る。

```ts
it("serializes tasteHintsOutcome and drops unknown values", () => {
  const lines: string[] = [];
  const sink = { info: (line: string) => lines.push(line), warn: () => {}, error: () => {} };

  logGenerationEvent(
    "info",
    { requestId: "req_1", errorCode: "ok", durationMs: 1, modelId: null, tasteHintsOutcome: "applied" },
    sink,
  );
  expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ taste_hints_outcome: "applied" });

  logGenerationEvent(
    "info",
    {
      requestId: "req_2",
      errorCode: "ok",
      durationMs: 1,
      modelId: null,
      tasteHintsOutcome: "肉じゃが" as never,
    },
    sink,
  );
  expect(JSON.parse(lines[1] ?? "{}")).not.toHaveProperty("taste_hints_outcome");
});
```

`makeDeps` / `runNewMenu` は同ファイルの既存ヘルパに合わせる。存在しない場合は既存テストの組み立て方をそのまま複製する（「Task N と同様」で済ませない）。

- [ ] **Step 2: 落ちることを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/generation-service.test.ts`
Expected: FAIL

- [ ] **Step 3: ログのキーを 5 箇所へ足す**

型に足すだけでも許可一覧に足すだけでも出力されない。`logGenerationEvent` は
`createSafeLogger` へ渡すフィールドを手で写しており、`createSafeLogger` は自分が知っている
キーだけを `record` へ入れる。次の 5 箇所を**同時に**直す。

**(1) `SafeGenerationLogEvent`（`logger.ts:85`）**

```ts
export type SafeGenerationLogEvent = {
  requestId: string;
  errorCode: string;
  durationMs: number;
  modelId: string | null;
  /** 学習ヒントの結末。閉じた列挙のみ。料理名・食材名・件数の内訳は出さない */
  tasteHintsOutcome?: TasteHintsOutcome;
};
```

**(2) `logGenerationEvent`（`logger.ts:470`）— 写し先**

```ts
  createSafeLogger(write)({
    level,
    requestId: event.requestId,
    code: event.errorCode,
    durationMs: event.durationMs,
    ...(event.modelId === null ? {} : { modelId: event.modelId }),
    // ここへ写さないと createSafeLogger まで届かない
    ...(event.tasteHintsOutcome === undefined
      ? {}
      : { tasteHintsOutcome: event.tasteHintsOutcome }),
  });
```

**(3) `SafeLogEvent`（`logger.ts:14`）**

`modelId` と同じ並びへ `tasteHintsOutcome?: string;` を足す。

**(4) 閉じた列挙ヘルパと `createSafeLogger` の分岐（`logger.ts:271-`）**

`closedMatchMode` と同型。`record` へ入れる分岐が無いキーは捨てられる。

```ts
/** 学習ヒントの結末の閉じた列挙。未知・free-text は省略。 */
const CLOSED_TASTE_HINTS_OUTCOMES = new Set([
  "disabled_flag",
  "disabled_user",
  "no_history",
  "timeout",
  "query_failed",
  "invalid_shape",
  "filtered_empty",
  "applied",
]);

function closedTasteHintsOutcome(raw: string): string | undefined {
  if (CLOSED_TASTE_HINTS_OUTCOMES.has(raw)) return raw;
  return undefined;
}
```

`createSafeLogger` の `record` 組み立てへ、`modelId` の分岐と同じ形で足す。

```ts
    if (event.tasteHintsOutcome !== undefined) {
      const outcome = closedTasteHintsOutcome(event.tasteHintsOutcome);
      if (outcome !== undefined) record.taste_hints_outcome = outcome;
    }
```

**(5) 許可一覧 2 つ**

`SAFE_LOG_SERIALIZED_KEYS`（`logger.ts:207`）と `scripts/assert-privacy-logs.mjs` の
`allowedLogKeys`（`:31`）へ `"taste_hints_outcome"` を足す。後者が無いと
`privacy_log_unexpected_field` で落ちる。

- [ ] **Step 4: 配線する**

`generation-service.ts` の `loadExecutionContext`:

```ts
const tasteEnabled = isTasteHintsEnabled(TASTE_HINTS_ENABLED);
const ownerClient = createUserScopedSupabase(user.accessToken);
const hintsPromise = diversityEnabled
  ? loadRecentDishHints({ ownerClient, userId: user.userId })
  : Promise.resolve([] as const);
// L13 と同型: flag off のときは load 自体を呼ばない
const tastePromise = tasteEnabled
  ? loadTasteHints({ ownerClient })
  : Promise.resolve({ signals: null, outcome: "disabled_flag" as const });

const [generationContext, recentDishHints, taste] = await Promise.all([
  loadGenerationContext(user, requestId, command.request),
  hintsPromise,
  tastePromise,
]);

// targetMode は generationContext が揃って初めて分かる（request は持たない）
const tasteHints =
  taste.signals === null
    ? null
    : sanitizeTasteHints(filterTasteHintsForSafety(taste.signals, generationContext), recentDishHints);
const tasteHintsOutcome: TasteHintsOutcome =
  taste.signals === null ? taste.outcome : tasteHints === null ? "filtered_empty" : "applied";

return {
  kind: "new_menu",
  // ...既存フィールド
  recentDishHints,
  tasteHints,
  tasteHintsOutcome,
};
```

`buildSuccessInput` の `preferenceSnapshot`:

```ts
// 反映の記録は、実際に user ペイロードへ載せた確定オブジェクトから導く
preferenceSnapshot:
  execution.kind === "new_menu" && execution.tasteHints !== null
    ? {
        ...context.preferenceSnapshot,
        tasteHints: { applied: true, strength: execution.tasteHints.signalStrength },
      }
    : context.preferenceSnapshot,
```

**結末は `emitTerminalLog` へ渡す。** `logGenerationEvent` を呼んでいるのは
`generation-service.ts:815` の `emitTerminalLog` クロージャ 1 箇所だけで、成功・失敗・
`constraint_conflict` のすべてがここを通る。**成功ログにだけ足すと足りない**: 学習ヒントが
タイムアウトしても生成自体は成功するため、最後のログが `succeeded` でも結末が残る必要がある。

`loggedModelId` と同じ形で、実行文脈が確定した時点で代入する可変クロージャ変数にする。

```ts
  // loggedModelId と同じ扱い。実行文脈が確定した時点で入り、終端ログ全種が読む
  let loggedTasteHintsOutcome: TasteHintsOutcome | undefined;

  const emitTerminalLog = (level: "info" | "warn" | "error", code: string): void => {
    const durationMs = Math.max(
      0,
      Math.trunc(deps.monotonicNow() - deps.requestStartedAtMonotonicMs),
    );
    const log = deps.logTerminalEvent ?? logGenerationEvent;
    log(level, {
      requestId,
      errorCode: code,
      durationMs,
      modelId: loggedModelId,
      ...(loggedTasteHintsOutcome === undefined
        ? {}
        : { tasteHintsOutcome: loggedTasteHintsOutcome }),
    });
  };
```

- [ ] **Step 5: 通ることを確認する**

Run:
```bash
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/generation-service.test.ts \
  netlify/functions/_shared/logger.test.ts
docker compose run --rm --no-deps app node scripts/assert-privacy-logs.mjs
docker compose run --rm --no-deps app npm run typecheck
```
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add netlify/functions/_shared/generation-service.ts netlify/functions/_shared/logger.ts \
  scripts/assert-privacy-logs.mjs netlify/functions/_shared/generation-service.test.ts
git commit -m "feat(functions): 学習ヒントを生成へ配線し結末を記録する

Promise.all の 3 本目として並列に取り、generationContext が揃ってから
安全フィルタと sanitize を通す。preference_snapshot へ書くのは確定
オブジェクトの強度で、切り詰めで空になったらキーごと載せない。

結末は閉じた列挙 1 フィールドとして、型・logGenerationEvent の写し先・
createSafeLogger の分岐・許可キー一覧・assert-privacy-logs の 5 箇所へ同時に足す。
分岐が無いと許可一覧に足しても出力に現れない。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: 結果画面の 1 行

**Files:**
- Modify: `shared/contracts/menu-result.ts:50-95`（`MenuResultViewModel`）
- Modify: `shared/testing/factories.ts`（`makeMenuResultViewModel` に新しい必須項目を足す。**これを忘れると全体の typecheck が落ちる**）
- Modify: `src/features/generation/api/menu-result-api.ts:330-405`
- Modify: `src/features/menu-detail/menu-hero.tsx`
- Modify: `src/features/generation/components/menu-result.tsx:338`（**`MenuHero` を描いているのはここだけ**。`household-menu-detail-body.tsx` と `idea-menu-detail-body.tsx` は `MenuResult` を呼んでおり、`MenuHero` を直接は呼ばない）
- Modify: `src/features/generation/api/menu-result-api.test.ts`
- Modify: `src/features/menu-detail/menu-hero.test.tsx`（既存 2 つの `render` にも prop が要る）

**Interfaces:**
- Consumes: Task 2 の `tasteHintsRecordSchema`、Task 6 が書く `preference_snapshot.tasteHints`
- Produces: `MenuResultViewModel.tasteHintsApplied: boolean`、`MenuHeroProps.tasteHintsApplied: boolean`

- [ ] **Step 1: 失敗するテストを書く**

`menu-result-api.test.ts` へ追記:

`toMenuResultViewModel` / `makeRow` は存在しない。既存の「`submission` が欠落している」テスト
（`:573` 付近）と同じ `rawMenuRow()` ＋ `getMenuResult(MENU_ID)` の形で書く。

```ts
async function resultWithSnapshot(snapshot: unknown) {
  const row = rawMenuRow();
  row.preference_snapshot = snapshot;
  getBrowserSupabaseClientMock.mockReturnValue(
    mockClient({ menu: { data: row, error: null }, pantryRows: [] }),
  );
  return await getMenuResult(MENU_ID);
}

it("medium 以上の記録のときだけ tasteHintsApplied を立てる", async () => {
  expect((await resultWithSnapshot({ tasteHints: { applied: true, strength: "medium" } })).tasteHintsApplied).toBe(true);
  expect((await resultWithSnapshot({ tasteHints: { applied: true, strength: "strong" } })).tasteHintsApplied).toBe(true);
  // 履歴の浅い利用者に「いつもの好み」と言わない
  expect((await resultWithSnapshot({ tasteHints: { applied: true, strength: "weak" } })).tasteHintsApplied).toBe(false);
});

it("記録が無い・壊れているときは false に倒す", async () => {
  expect((await resultWithSnapshot({})).tasteHintsApplied).toBe(false);
  expect((await resultWithSnapshot({ tasteHints: { applied: "yes" } })).tasteHintsApplied).toBe(false);
});
```

`menu-hero.test.tsx` は既存 2 つの `render` にも `tasteHintsApplied={false}` を足したうえで、
次を追記する。

```tsx
it("shows the taste line alongside the model label without replacing it", () => {
  render(
    <MenuHero
      totalElapsedMinutes={30}
      servings={2}
      generationModelId="inception/mercury-2"
      tasteHintsApplied
    />,
  );
  expect(screen.getByText(/作成モデル/u)).toBeInTheDocument();
  expect(screen.getByText("✨ いつもの好みを反映しました")).toBeInTheDocument();
});

it("omits the taste line when not applied", () => {
  render(<MenuHero totalElapsedMinutes={30} servings={2} generationModelId={null} tasteHintsApplied={false} />);
  expect(screen.queryByText(/いつもの好み/u)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 落ちることを確認する**

Run:
```bash
docker compose run --rm --no-deps app npx vitest run \
  src/features/generation/api/menu-result-api.test.ts src/features/menu-detail/menu-hero.test.tsx
```
Expected: FAIL

- [ ] **Step 3: 投影を足す**

`shared/contracts/menu-result.ts` の `MenuResultViewModel` へ:

```ts
/**
 * preference_snapshot.tasteHints を tasteHintsRecordSchema で再検証した結果。
 * strength が weak のときは false（履歴の浅い利用者に「いつもの好み」と言わない）。
 * 欠落・壊れた形も false（安全側）。
 */
tasteHintsApplied: boolean;
```

`menu-result-api.ts` の組み立て箇所で:

```ts
const tasteCandidate = (data.preference_snapshot as { tasteHints?: unknown } | null)?.tasteHints;
const tasteParsed = tasteHintsRecordSchema.safeParse(tasteCandidate);
const tasteHintsApplied = tasteParsed.success && tasteParsed.data.strength !== "weak";
```

- [ ] **Step 4: 1 行を描く**

`menu-hero.tsx` を fragment 返しに変える（`PageHeader` の `note` は作成モデルが使っており、置き換えない）:

```tsx
export type MenuHeroProps = {
  totalElapsedMinutes: number;
  servings: number;
  generationModelId: string | null;
  /** 学習ヒントを実際に載せて生成した献立にだけ true */
  tasteHintsApplied: boolean;
};

export function MenuHero({
  totalElapsedMinutes,
  servings,
  generationModelId,
  tasteHintsApplied,
}: MenuHeroProps) {
  const modelLabel =
    generationModelId !== null ? formatGenerationModelLabel(generationModelId) : "";
  const note = modelLabel !== "" ? `作成モデル: ${modelLabel}` : undefined;

  return (
    <>
      <PageHeader
        title="献立ができました"
        lead={`食卓まで約${String(totalElapsedMinutes)}分・${String(servings)}人分`}
        {...(note !== undefined ? { note } : {})}
      />
      {tasteHintsApplied ? (
        <p className="type-small text-ink/80">✨ いつもの好みを反映しました</p>
      ) : null}
    </>
  );
}
```

`src/features/generation/components/menu-result.tsx:338` の `MenuHero` 呼び出しへ
`tasteHintsApplied={result.tasteHintsApplied}` を渡す（`MenuHero` を描いているのはここだけ）。

`shared/testing/factories.ts` の `makeMenuResultViewModel` の既定値へ `tasteHintsApplied: false` を
足す。`MenuResultViewModel` へ必須項目を足しているため、これが無いと
`menu-dishes.test.tsx` / `menu-ingredients-summary.test.tsx` / `history-detail-page.test.tsx` が
欠落で落ち、全体の typecheck も通らない。

- [ ] **Step 5: 通ることを確認する**

Run:
```bash
docker compose run --rm --no-deps app npx vitest run \
  src/features/generation src/features/menu-detail src/features/history shared/contracts
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run format:check > /tmp/fmt.log 2>&1; \
  grep -n "Code style issues" /tmp/fmt.log || tail -n 3 /tmp/fmt.log
```
Expected: PASS

- [ ] **Step 6: 全体検証**

Run:
```bash
docker compose run --rm --no-deps app npm run lint > /tmp/lint.log 2>&1; \
  grep -nE "error" /tmp/lint.log | head -20 || tail -n 5 /tmp/lint.log
docker compose run --rm --no-deps app npx vitest run > /tmp/vitest.log 2>&1; \
  grep -nE "FAIL|failed" /tmp/vitest.log | head -20 || tail -n 15 /tmp/vitest.log
docker compose --profile test run --rm db-test > /tmp/dbtest.log 2>&1; \
  grep -nE "not ok|Failed" /tmp/dbtest.log | head -20 || tail -n 10 /tmp/dbtest.log
```
E2E（`./scripts/run-e2e.sh`）は出力が大きいため、人間の端末で実行して要約を貼ってもらう。

- [ ] **Step 7: コミット**

```bash
git add shared/contracts/menu-result.ts shared/testing/factories.ts \
  src/features/generation/api/menu-result-api.ts \
  src/features/generation/api/menu-result-api.test.ts \
  src/features/generation/components/menu-result.tsx \
  src/features/menu-detail/menu-hero.tsx src/features/menu-detail/menu-hero.test.tsx
git commit -m "feat(menu): 好みを反映した献立に 1 行を出す

preference_snapshot.tasteHints を再検証して投影する。weak では出さず、
欠落や壊れた形は false に倒す。PageHeader の note は作成モデルが使って
いるため置き換えず、独立した行として描く。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 自己レビュー結果

**仕様の網羅**

| 仕様 | 対応 Task |
| --- | --- |
| §3.1 契約 | Task 2 |
| §3.2 preference_snapshot 記録 | Task 6（書き）・Task 7（読み） |
| §3.3 列と更新関数 | Task 1 |
| §3.4 db:types / SQL 定数 | Task 1 Step 7 / Task 1 Step 5 |
| §4.1–4.5 集計 | Task 1 |
| §5.1 ローダ | Task 3 |
| §5.2 安全フィルタと idea の avoidAxes | Task 3 |
| §5.3 sanitize と対応表の破棄 | Task 3 |
| §5.4 段落と優先順位 | Task 5 |
| §5.5 配線 | Task 6 |
| §5.6 記録の確定タイミング | Task 6 |
| §5.7 観測性 5 箇所 | Task 6 |
| §6.1 トグルと告知 | Task 4 |
| §6.2 結果の 1 行 | Task 7 |
| §7 保存と送信 | Task 4（文言）・Task 6（記録） |
| §8 不変条件 1–11 | Task 5・6・7 のテスト |

**残る注意点**

- Task 1 の pgTAP は `plan(52)` とアサーション数を一致させる。ケースのあいだで
  `truncate public.menus cascade` を挟むこと（行を足し続けると強さ・時間帯・ジャンル比率が
  前のケースを巻き込む）。行を作る間はスーパーユーザーのままにし、RPC 直前だけ
  `tests.authenticate_as()` ＋ `set local role authenticated` に切り替える。
- Task 3 の `filterTasteHintsForSafety` は安全ゲートではない。実判定は `validate-generated-menu` と生成ハードゲートのままで、ここを通ったことを「安全」と読まない。
- Task 3 の sanitize は、改行・制御文字（`/[\p{Cc}]/u`）を含む語を捨てる。`overusedIngredients` は
  利用者が入力したメイン食材の文字列がそのまま載るため、【学習】段落への持ち越しを断つ
  （Task 1 敵対的レビュー M3）。料理名・食材名は AI 出力で Zod 済みだが同じ規則を掛ける。
- `memo` の語が AI 経由で料理名に写り、★で `likedDishes` として再送される経路は許容している
  （spec 不変条件 6 の字義には触れない。Task 1 敵対的レビュー M4）。
- Task 6 の配線は `get_taste_signals` を **owner-scoped client** で呼び、`p_now` は渡さない。
  service / admin クライアントでは `42501 authentication_required` になる（fail-open で生成は続く）。
- Task 6 の `makeDeps` / `runNewMenu` / `failWith` は `generation-service.test.ts` の既存ヘルパ名と
  オーバーライド形に置き換える。`mockClient` / `rawMenuRow` / `getBrowserSupabaseClientMock`
  （Task 7）も同様に、`menu-result-api.test.ts` の既存定義をそのまま使う。
- Task 5 は必須フィールドを足すため、9 ファイル 11 箇所の `tasteHints: null` を同じ Task で
  入れ切る。`npm run typecheck` が漏れを検出する。
