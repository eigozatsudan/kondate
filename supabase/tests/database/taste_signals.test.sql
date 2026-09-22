begin;
select plan(27);

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

-- ============ 1-6: 構造と権限 ============
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

-- ============ 7-10: 履歴ゼロとトグル ============
select is(pg_temp.signals() ->> 'reason', 'no_history', 'empty history reports no_history');

select tests.authenticate_as('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select is(public.set_taste_learning_enabled(false), false,
  'set_taste_learning_enabled returns the stored value');
reset role;

-- 分岐順は disabled -> no_history。OFF の利用者は窓が空でも disabled になる
select is(pg_temp.signals() ->> 'reason', 'disabled', 'disabled wins over an empty window');

select tests.authenticate_as('11111111-1111-4111-8111-111111111111');
set local role authenticated;
select is(public.set_taste_learning_enabled(true), true, 'toggle back on');
reset role;

-- ============ 11: 派生行は強さを膨らませない ============
truncate public.menus cascade;
select pg_temp.seed_menu(
  '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333331', 1,
  '2026-09-21T00:00:00Z', true, false, 'japanese', 'japanese', 30::smallint,
  null, null, '[]'::jsonb, '子1', array['にんじん']
);
-- 同じグループの 2-4 版。parent は上で作った親を引く
with parent as (
  select id from public.menus where derivation_group_id = '33333333-3333-4333-8333-333333333331'
)
select pg_temp.seed_menu(
  '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333331', v,
  '2026-09-21T00:00:00Z', true, false, 'japanese', 'japanese', 30::smallint,
  (select id from parent), 'simpler', '[]'::jsonb, '子' || v::text, array['にんじん']
)
from generate_series(2, 4) as v;
select is(pg_temp.signals() ->> 'signalStrength', 'weak',
  'four rows in one derivation group stay weak');

-- ============ 12-15: 強さの境界（4/5 と 14/15 グループ） ============
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

-- ============ 16-17: 重みの加算と半減期 ============
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

-- ============ 18: 窓の境界（89 日と 91 日） ============
truncate public.menus cascade;
select pg_temp.seed_simple(gen_random_uuid(), '2026-06-25T00:00:00Z', true, false, '窓内89日');
select pg_temp.seed_simple(gen_random_uuid(), '2026-06-23T00:00:00Z', true, false, '窓外91日');
select is(
  (select jsonb_agg(d ->> 'dishName' order by d ->> 'dishName')
   from jsonb_array_elements(pg_temp.signals() -> 'likedDishes') as d),
  '["窓内89日"]'::jsonb,
  'the 90-day window excludes day 91 and keeps day 89'
);

-- ============ 19-20: 使いすぎは派生グループ単位 ============
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

-- ============ 21: 時間帯の境界は連続している ============
truncate public.menus cascade;
-- 20 分と 21 分の等重み平均 = 20.5。`21-40` と刻むとどの帯にも入らない値
select pg_temp.seed_simple(gen_random_uuid(), '2026-09-21T00:00:00Z', true, false, '20分', array['にんじん'], 20::smallint);
select pg_temp.seed_simple(gen_random_uuid(), '2026-09-21T00:00:00Z', true, false, '21分', array['にんじん'], 21::smallint);
select is(pg_temp.signals() ->> 'likedTimeBand', 'standard',
  'a weighted average of 20.5 falls into standard, not a gap');

-- ============ 22-23: ジャンルはおまかせ依頼だけを母集団にし、生成 any を分子から外す ============
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

-- ============ 24-25: child_friendly は 2 グループ以上で軸になる ============
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
  '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444441', 2,
  '2026-09-21T00:00:00Z', false, false, 'japanese', 'japanese', 30::smallint,
  (select id from parent), 'child_friendly', '[]'::jsonb, '子1', array['にんじん']
);
select is(pg_temp.signals() -> 'avoidAxes', '[]'::jsonb,
  'child_friendly in one derivation group is not a standing axis');

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

-- ============ 26: 対応表に上限が無い ============
truncate public.menus cascade;
-- likedDishes は 12 件で切れるが、対応表は 13 件すべてを持つ。
-- ここを切ると §5.3 の差集合が両方向に壊れる
select pg_temp.seed_simple(gen_random_uuid(), '2026-09-21T00:00:00Z', true, false, '好き' || g::text)
from generate_series(1, 13) as g;
select is(
  jsonb_array_length(pg_temp.signals() -> 'dishIngredientIndex'), 13,
  'dishIngredientIndex covers every liked dish, past the likedDishes cap'
);

-- ============ 27: 他人の献立は入らない ============
select is(
  pg_temp.signals('22222222-2222-4222-8222-222222222222') ->> 'reason', 'no_history',
  'another user sees none of the owner history'
);

select * from finish();
rollback;
