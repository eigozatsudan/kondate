-- U2-C1: 鶏肉・豚肉・牛肉の高頻度部位名・外来語を hard-match する。
-- TS 側 currentAllergenAliasManifest と exact 一致させること。
-- 裸の「鶏」「牛」「豚」は 鶏卵・牛乳 衝突のため載せない。

insert into public.allergen_aliases
  (allergen_id, alias, normalized_alias, alias_kind, requires_label_confirmation, dictionary_version) values
  ('chicken', 'チキン', 'チキン', 'direct', false, 'jp-caa-2026-04.v1'),
  ('chicken', 'とり肉', 'とり肉', 'direct', false, 'jp-caa-2026-04.v1'),
  ('chicken', '鳥肉', '鳥肉', 'direct', false, 'jp-caa-2026-04.v1'),
  ('chicken', '鶏むね', '鶏むね', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', '鶏もも', '鶏もも', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', 'ささみ', 'ささみ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', '若鶏', '若鶏', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', '鶏ひき', '鶏ひき', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', '地鶏', '地鶏', 'derived', false, 'jp-caa-2026-04.v1'),
  ('pork', 'ポーク', 'ポーク', 'direct', false, 'jp-caa-2026-04.v1'),
  ('pork', '豚バラ', '豚バラ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('pork', '豚こま', '豚こま', 'derived', false, 'jp-caa-2026-04.v1'),
  ('pork', '豚ひき', '豚ひき', 'derived', false, 'jp-caa-2026-04.v1'),
  ('pork', 'ぶた肉', 'ぶた肉', 'direct', false, 'jp-caa-2026-04.v1'),
  ('pork', '豚ロース', '豚ロース', 'derived', false, 'jp-caa-2026-04.v1'),
  ('pork', 'スペアリブ', 'スペアリブ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('pork', 'ベーコン', 'ベーコン', 'processed', true, 'jp-caa-2026-04.v1'),
  ('pork', 'ソーセージ', 'ソーセージ', 'processed', true, 'jp-caa-2026-04.v1'),
  ('beef', 'ビーフ', 'ビーフ', 'direct', false, 'jp-caa-2026-04.v1'),
  ('beef', '牛こま', '牛こま', 'derived', false, 'jp-caa-2026-04.v1'),
  ('beef', '牛薄切り', '牛薄切り', 'derived', false, 'jp-caa-2026-04.v1'),
  ('beef', '和牛', '和牛', 'derived', false, 'jp-caa-2026-04.v1'),
  ('beef', '牛ひき', '牛ひき', 'derived', false, 'jp-caa-2026-04.v1'),
  ('beef', '牛バラ', '牛バラ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('beef', '牛もも', '牛もも', 'derived', false, 'jp-caa-2026-04.v1')
on conflict (allergen_id, normalized_alias, dictionary_version) do update set
  alias = excluded.alias,
  alias_kind = excluded.alias_kind,
  requires_label_confirmation = excluded.requires_label_confirmation;
