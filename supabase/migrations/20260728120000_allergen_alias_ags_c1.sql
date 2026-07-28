-- AGS-C1: 高頻度アレルゲン表記の fail-open 残差を塞ぐ。
-- TS 側 currentAllergenAliasManifest と exact 一致させること。
-- みそは従来 processed+label-only だったが、家庭調理の主原料として hard match へ昇格する。

update public.allergen_aliases
set
  alias_kind = 'derived',
  requires_label_confirmation = false
where allergen_id = 'soy'
  and normalized_alias = 'みそ'
  and dictionary_version = 'jp-caa-2026-04.v1';

insert into public.allergen_aliases
  (allergen_id, alias, normalized_alias, alias_kind, requires_label_confirmation, dictionary_version) values
  ('soy', '味噌', '味噌', 'derived', false, 'jp-caa-2026-04.v1'),
  ('soy', '納豆', '納豆', 'derived', false, 'jp-caa-2026-04.v1'),
  ('soy', '油揚げ', '油揚げ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('soy', '厚揚げ', '厚揚げ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('soy', 'きなこ', 'きなこ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('soy', '枝豆', '枝豆', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'パン粉', 'パン粉', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'そうめん', 'そうめん', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', '素麺', '素麺', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', '薄力粉', '薄力粉', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', '強力粉', '強力粉', 'derived', false, 'jp-caa-2026-04.v1'),
  ('milk', 'ヨーグルト', 'ヨーグルト', 'derived', false, 'jp-caa-2026-04.v1'),
  ('milk', '生クリーム', '生クリーム', 'derived', false, 'jp-caa-2026-04.v1'),
  ('peanut', 'ピーナツ', 'ピーナツ', 'direct', false, 'jp-caa-2026-04.v1')
on conflict (allergen_id, normalized_alias, dictionary_version) do update set
  alias = excluded.alias,
  alias_kind = excluded.alias_kind,
  requires_label_confirmation = excluded.requires_label_confirmation;
