begin;
select plan(63);

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
select has_column('public', 'profiles', 'taste_learning_seq',
  'profiles has taste_learning_seq');
select col_not_null('public', 'profiles', 'taste_learning_seq',
  'taste_learning_seq is not null');
select col_default_is('public', 'profiles', 'taste_learning_seq', '0',
  'taste_learning_seq defaults to 0');
select has_function('public', 'get_taste_signals', array['timestamptz'],
  'get_taste_signals exists');
select has_function('public', 'set_taste_learning_enabled', array['boolean', 'bigint'],
  'set_taste_learning_enabled exists');
-- 1 引数版は残さない。残すと連番の照合を素通りする書き込み口になる
select hasnt_function('public', 'set_taste_learning_enabled', array['boolean'],
  'the one-argument setter without a sequence is gone');
-- 20260712000100 で外したテーブル単位 UPDATE を復活させていない
select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'),
  'profiles table-level UPDATE stays revoked for authenticated'
);

-- ============ 履歴ゼロとトグル ============
select is(pg_temp.signals() ->> 'reason', 'no_history', 'empty history reports no_history');

select tests.authenticate_as('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select is(
  public.set_taste_learning_enabled(false, 0),
  '{"enabled": false, "seq": 1, "applied": true}'::jsonb,
  'a matching sequence applies the write and advances the sequence'
);
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
  'select public.set_taste_learning_enabled(true, 1)',
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
  'select public.set_taste_learning_enabled(null, 1)',
  '22023', 'invalid_taste_learning_enabled',
  'the setter rejects null'
);
select throws_ok(
  'select public.set_taste_learning_enabled(true, null)',
  '22023', 'invalid_taste_learning_seq',
  'the setter rejects a null sequence'
);
-- 遅れて届いた古い書き込み（連番 0 のまま）は捨て、現在値をそのまま返す
select is(
  public.set_taste_learning_enabled(true, 0),
  '{"enabled": false, "seq": 1, "applied": false}'::jsonb,
  'a stale sequence is not applied and reports the current state'
);
reset role;
select is(
  (select pg_catalog.jsonb_build_object('enabled', taste_learning_enabled, 'seq', taste_learning_seq)
   from public.profiles where user_id = '11111111-1111-4111-8111-111111111111'),
  '{"enabled": false, "seq": 1}'::jsonb,
  'a stale write leaves the stored value and sequence unchanged'
);

-- 連番はブラウザから直接書けない（テーブル単位 UPDATE は revoke のまま）
select tests.authenticate_as('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select throws_ok(
  $$update public.profiles set taste_learning_seq = 99
    where user_id = '11111111-1111-4111-8111-111111111111'$$,
  '42501', null,
  'authenticated cannot update taste_learning_seq directly'
);
reset role;

select tests.authenticate_as('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select is(
  public.set_taste_learning_enabled(true, 1),
  '{"enabled": true, "seq": 2, "applied": true}'::jsonb,
  'toggle back on with the latest sequence'
);
-- 他人の連番（0）と一致しても、照合するのは自分の行だけ
select is(
  public.set_taste_learning_enabled(false, 0),
  '{"enabled": true, "seq": 2, "applied": false}'::jsonb,
  'a sequence matching another user row is still checked against the caller row only'
);
reset role;
select is(
  (select taste_learning_seq from public.profiles
   where user_id = '11111111-1111-4111-8111-111111111111'),
  2::bigint,
  'each applied write advances the stored sequence by one'
);
select is(
  (select pg_catalog.jsonb_build_object('enabled', taste_learning_enabled, 'seq', taste_learning_seq)
   from public.profiles where user_id = '22222222-2222-4222-8222-222222222222'),
  '{"enabled": true, "seq": 0}'::jsonb,
  'the setter never touches another user row or sequence'
);

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
