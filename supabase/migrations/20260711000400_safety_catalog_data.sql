-- Reviewed against the Consumer Affairs Agency April 2026 allergen material.

insert into public.allergen_catalog (id, display_name, regulatory_class, catalog_version) values
  ('shrimp', 'えび', 'mandatory', 'jp-caa-2026-04.v1'),
  ('cashew_nut', 'カシューナッツ', 'mandatory', 'jp-caa-2026-04.v1'),
  ('crab', 'かに', 'mandatory', 'jp-caa-2026-04.v1'),
  ('walnut', 'くるみ', 'mandatory', 'jp-caa-2026-04.v1'),
  ('wheat', '小麦', 'mandatory', 'jp-caa-2026-04.v1'),
  ('buckwheat', 'そば', 'mandatory', 'jp-caa-2026-04.v1'),
  ('egg', '卵', 'mandatory', 'jp-caa-2026-04.v1'),
  ('milk', '乳', 'mandatory', 'jp-caa-2026-04.v1'),
  ('peanut', '落花生（ピーナッツ）', 'mandatory', 'jp-caa-2026-04.v1'),
  ('almond', 'アーモンド', 'recommended', 'jp-caa-2026-04.v1'),
  ('abalone', 'あわび', 'recommended', 'jp-caa-2026-04.v1'),
  ('squid', 'いか', 'recommended', 'jp-caa-2026-04.v1'),
  ('salmon_roe', 'いくら', 'recommended', 'jp-caa-2026-04.v1'),
  ('orange', 'オレンジ', 'recommended', 'jp-caa-2026-04.v1'),
  ('kiwi', 'キウイフルーツ', 'recommended', 'jp-caa-2026-04.v1'),
  ('beef', '牛肉', 'recommended', 'jp-caa-2026-04.v1'),
  ('sesame', 'ごま', 'recommended', 'jp-caa-2026-04.v1'),
  ('salmon', 'さけ', 'recommended', 'jp-caa-2026-04.v1'),
  ('mackerel', 'さば', 'recommended', 'jp-caa-2026-04.v1'),
  ('soy', '大豆', 'recommended', 'jp-caa-2026-04.v1'),
  ('chicken', '鶏肉', 'recommended', 'jp-caa-2026-04.v1'),
  ('banana', 'バナナ', 'recommended', 'jp-caa-2026-04.v1'),
  ('pistachio', 'ピスタチオ', 'recommended', 'jp-caa-2026-04.v1'),
  ('pork', '豚肉', 'recommended', 'jp-caa-2026-04.v1'),
  ('macadamia_nut', 'マカダミアナッツ', 'recommended', 'jp-caa-2026-04.v1'),
  ('peach', 'もも', 'recommended', 'jp-caa-2026-04.v1'),
  ('yam', 'やまいも', 'recommended', 'jp-caa-2026-04.v1'),
  ('apple', 'りんご', 'recommended', 'jp-caa-2026-04.v1'),
  ('gelatin', 'ゼラチン', 'recommended', 'jp-caa-2026-04.v1')
on conflict (id) do update set
  display_name = excluded.display_name,
  regulatory_class = excluded.regulatory_class,
  catalog_version = excluded.catalog_version;

insert into public.allergen_aliases
  (allergen_id, alias, normalized_alias, alias_kind, requires_label_confirmation, dictionary_version)
select id, display_name, lower(regexp_replace(display_name, '[[:space:]（）()]', '', 'g')),
  'direct', false, 'jp-caa-2026-04.v1'
from public.allergen_catalog
on conflict (allergen_id, normalized_alias, dictionary_version) do nothing;

insert into public.allergen_aliases
  (allergen_id, alias, normalized_alias, alias_kind, requires_label_confirmation, dictionary_version) values
  ('egg', '鶏卵', '鶏卵', 'derived', false, 'jp-caa-2026-04.v1'),
  ('egg', '卵白', '卵白', 'derived', false, 'jp-caa-2026-04.v1'),
  ('egg', '卵黄', '卵黄', 'derived', false, 'jp-caa-2026-04.v1'),
  ('milk', '牛乳', '牛乳', 'derived', false, 'jp-caa-2026-04.v1'),
  ('milk', 'バター', 'バター', 'derived', false, 'jp-caa-2026-04.v1'),
  ('milk', 'チーズ', 'チーズ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', '小麦粉', '小麦粉', 'derived', false, 'jp-caa-2026-04.v1'),
  ('shrimp', '海老', '海老', 'direct', false, 'jp-caa-2026-04.v1'),
  ('shrimp', 'エビ', 'エビ', 'direct', false, 'jp-caa-2026-04.v1'),
  ('crab', '蟹', '蟹', 'direct', false, 'jp-caa-2026-04.v1'),
  ('crab', 'カニ', 'カニ', 'direct', false, 'jp-caa-2026-04.v1'),
  ('walnut', '胡桃', '胡桃', 'direct', false, 'jp-caa-2026-04.v1'),
  ('buckwheat', '蕎麦', '蕎麦', 'direct', false, 'jp-caa-2026-04.v1'),
  ('egg', 'たまご', 'たまご', 'direct', false, 'jp-caa-2026-04.v1'),
  ('milk', '乳成分', '乳成分', 'derived', false, 'jp-caa-2026-04.v1'),
  ('peanut', '落花生', '落花生', 'direct', false, 'jp-caa-2026-04.v1'),
  ('peanut', 'ピーナッツ', 'ピーナッツ', 'direct', false, 'jp-caa-2026-04.v1'),
  ('sesame', '胡麻', '胡麻', 'direct', false, 'jp-caa-2026-04.v1'),
  ('salmon', '鮭', '鮭', 'direct', false, 'jp-caa-2026-04.v1'),
  ('mackerel', '鯖', '鯖', 'direct', false, 'jp-caa-2026-04.v1'),
  ('kiwi', 'キウイ', 'キウイ', 'direct', false, 'jp-caa-2026-04.v1'),
  ('peach', '桃', '桃', 'direct', false, 'jp-caa-2026-04.v1'),
  ('yam', '山芋', '山芋', 'direct', false, 'jp-caa-2026-04.v1'),
  ('apple', '林檎', '林檎', 'direct', false, 'jp-caa-2026-04.v1'),
  ('soy', '豆腐', '豆腐', 'derived', false, 'jp-caa-2026-04.v1'),
  ('soy', '豆乳', '豆乳', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'カレールー', 'カレールー', 'processed', true, 'jp-caa-2026-04.v1'),
  ('milk', 'カレールー', 'カレールー', 'processed', true, 'jp-caa-2026-04.v1'),
  ('wheat', 'しょうゆ', 'しょうゆ', 'processed', true, 'jp-caa-2026-04.v1'),
  ('soy', 'しょうゆ', 'しょうゆ', 'processed', true, 'jp-caa-2026-04.v1'),
  ('wheat', '醤油', '醤油', 'processed', true, 'jp-caa-2026-04.v1'),
  ('soy', '醤油', '醤油', 'processed', true, 'jp-caa-2026-04.v1'),
  ('mackerel', '顆粒だし', '顆粒だし', 'processed', true, 'jp-caa-2026-04.v1'),
  ('soy', '顆粒だし', '顆粒だし', 'processed', true, 'jp-caa-2026-04.v1'),
  ('egg', 'ドレッシング', 'ドレッシング', 'processed', true, 'jp-caa-2026-04.v1'),
  ('milk', 'ドレッシング', 'ドレッシング', 'processed', true, 'jp-caa-2026-04.v1'),
  ('wheat', 'ドレッシング', 'ドレッシング', 'processed', true, 'jp-caa-2026-04.v1'),
  ('soy', 'ドレッシング', 'ドレッシング', 'processed', true, 'jp-caa-2026-04.v1'),
  ('egg', 'マヨネーズ', 'マヨネーズ', 'processed', true, 'jp-caa-2026-04.v1'),
  ('milk', 'ホワイトソース', 'ホワイトソース', 'processed', true, 'jp-caa-2026-04.v1'),
  ('wheat', 'ホワイトソース', 'ホワイトソース', 'processed', true, 'jp-caa-2026-04.v1'),
  ('wheat', '食パン', '食パン', 'processed', true, 'jp-caa-2026-04.v1'),
  ('milk', '食パン', '食パン', 'processed', true, 'jp-caa-2026-04.v1'),
  ('egg', 'ハム', 'ハム', 'processed', true, 'jp-caa-2026-04.v1'),
  ('milk', 'ハム', 'ハム', 'processed', true, 'jp-caa-2026-04.v1'),
  ('wheat', 'コンソメ', 'コンソメ', 'processed', true, 'jp-caa-2026-04.v1'),
  ('soy', 'みそ', 'みそ', 'processed', true, 'jp-caa-2026-04.v1')
on conflict (allergen_id, normalized_alias, dictionary_version) do update set
  alias = excluded.alias,
  alias_kind = excluded.alias_kind,
  requires_label_confirmation = excluded.requires_label_confirmation;

insert into public.food_safety_rules
  (id, applies_to_age_bands, match_terms, rule_kind, required_safety_tag, user_message, rule_version) values
  ('hard_beans_and_reviewed_nuts_under_6', array['post_weaning_to_2','age_3_5'], array[
    '硬い豆','かたい豆','炒り大豆','煎り大豆','いり大豆','乾燥大豆','節分豆','豆まき豆',
    '落花生','ピーナッツ','ピーナツ','くるみ','胡桃','ウォールナッツ','アーモンド',
    'カシューナッツ','ピスタチオ','マカダミアナッツ'
  ], 'forbidden', null, '5歳以下を含む献立では、硬い豆とピーナッツ・くるみ・アーモンド・カシューナッツ・ピスタチオ・マカダミアナッツを原則使用できません', 'jp-caa-child-shape-2026-07.v1'),
  ('grapes_under_6', array['post_weaning_to_2','age_3_5'], array['ぶどう','ブドウ'], 'requires_tag', 'quarter_round_food', 'ぶどうは4等分する工程が必要です', 'jp-caa-child-shape-2026-07.v1'),
  ('cherry_tomato_under_6', array['post_weaning_to_2','age_3_5'], array['ミニトマト','プチトマト'], 'requires_tag', 'quarter_round_food', 'ミニトマトは4等分する工程が必要です', 'jp-caa-child-shape-2026-07.v1'),
  ('mochi_under_6', array['post_weaning_to_2','age_3_5'], array['餅','もち'], 'forbidden', null, '5歳以下を含む献立では餅を使用できません', 'jp-caa-child-shape-2026-07.v1'),
  ('mochi_senior', array['senior'], array['餅','もち'], 'forbidden', null, '高齢者を含む固定候補とAI献立では餅を原則除外します', 'jp-caa-child-shape-2026-07.v1'),
  ('bones_for_young_and_senior', array['post_weaning_to_2','age_3_5','senior'], array['小骨','骨付き','魚'], 'requires_tag', 'remove_bones', '小骨を完全に除く工程が必要です', 'jp-caa-child-shape-2026-07.v1'),
  ('hard_food_for_senior', array['senior'], array['硬い','かたい','根菜'], 'requires_tag', 'soften', '高齢者向けに十分やわらかくする工程が必要です', 'jp-caa-child-shape-2026-07.v1')
on conflict (id) do update set
  applies_to_age_bands = excluded.applies_to_age_bands,
  match_terms = excluded.match_terms,
  rule_kind = excluded.rule_kind,
  required_safety_tag = excluded.required_safety_tag,
  user_message = excluded.user_message,
  rule_version = excluded.rule_version;
