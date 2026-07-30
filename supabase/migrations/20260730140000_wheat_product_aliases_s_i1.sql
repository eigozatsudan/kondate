-- S-I1: 高頻度小麦製品 alias を hard-match に追加。
-- TS 側 currentAllergenAliasManifest と exact 一致させること。
-- 裸の「パン」はフライパン衝突のため載せない。

insert into public.allergen_aliases
  (allergen_id, alias, normalized_alias, alias_kind, requires_label_confirmation, dictionary_version) values
  ('wheat', 'フランスパン', 'フランスパン', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'ロールパン', 'ロールパン', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'コッペパン', 'コッペパン', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'ベーグル', 'ベーグル', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'クロワッサン', 'クロワッサン', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'ナン', 'ナン', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', '中華麺', '中華麺', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', '焼きそば', '焼きそば', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', '天ぷら粉', '天ぷら粉', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'ホットケーキミックス', 'ホットケーキミックス', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'お好み焼き粉', 'お好み焼き粉', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', '餃子の皮', '餃子の皮', 'derived', false, 'jp-caa-2026-04.v1')
on conflict (allergen_id, normalized_alias, dictionary_version) do update set
  alias = excluded.alias,
  alias_kind = excluded.alias_kind,
  requires_label_confirmation = excluded.requires_label_confirmation;
