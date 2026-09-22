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
