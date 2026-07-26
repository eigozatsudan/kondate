-- A-C1: 高頻度アレルゲン表記を dictionary version 固定のまま追加する。
-- TS 側 currentAllergenAliasManifest と exact 一致させること。

insert into public.allergen_aliases
  (allergen_id, alias, normalized_alias, alias_kind, requires_label_confirmation, dictionary_version) values
  ('egg', '玉子', '玉子', 'direct', false, 'jp-caa-2026-04.v1'),
  ('milk', 'ミルク', 'ミルク', 'direct', false, 'jp-caa-2026-04.v1'),
  ('milk', 'みるく', 'みるく', 'direct', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'うどん', 'うどん', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'パスタ', 'パスタ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'ラーメン', 'ラーメン', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'そばつゆ', 'そばつゆ', 'processed', true, 'jp-caa-2026-04.v1'),
  ('salmon', 'サーモン', 'サーモン', 'direct', false, 'jp-caa-2026-04.v1'),
  ('salmon', 'さーもん', 'さーもん', 'direct', false, 'jp-caa-2026-04.v1'),
  ('mackerel', 'サバ', 'サバ', 'direct', false, 'jp-caa-2026-04.v1'),
  ('walnut', 'クルミ', 'クルミ', 'direct', false, 'jp-caa-2026-04.v1'),
  ('buckwheat', 'ソバ', 'ソバ', 'direct', false, 'jp-caa-2026-04.v1')
on conflict (allergen_id, normalized_alias, dictionary_version) do update set
  alias = excluded.alias,
  alias_kind = excluded.alias_kind,
  requires_label_confirmation = excluded.requires_label_confirmation;
