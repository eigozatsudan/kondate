do $$
declare
  updated_rows integer;
begin
  update public.food_safety_rules
  set match_terms = array[
    '小骨','骨付き','魚','鮭','さけ','サケ','鯖','さば','サバ','鯵','あじ','アジ','鰯',
    'いわし','イワシ','鯛','たい','タイ','ぶり','ブリ','たら','タラ','さんま','サンマ',
    'ししゃも','うなぎ','穴子'
  ]::text[]
  where id = 'bones_for_young_and_senior';

  get diagnostics updated_rows = row_count;
  if updated_rows <> 1 then
    raise exception 'bones_for_young_and_senior must update exactly one row; updated %', updated_rows;
  end if;
end
$$;
