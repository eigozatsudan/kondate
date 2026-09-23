-- 2026-09-23: 裸の「鶏」「豚」「牛」と高頻度部位名・料理名を hard-match する。
-- 20260731140000_meat_allergen_aliases_u2_c1.sql は「鶏卵・牛乳衝突のため裸の一字は載せない」
-- 方針だったが、その結果「鶏の照り焼き」「豚の生姜焼き」「牛丼」「手羽先」等が
-- hard gate をすり抜けていた。人間の決定によりこの方針を置き換える: 一字も足し、
-- 誤検知は shared/safety/allergens.ts の EXCLUDED_ALIAS_CONTEXTS（鶏卵・牛乳・牛蒡・
-- 蝸牛・水牛・河豚）で守る。
-- TS 側 currentAllergenAliasManifest と exact 一致させること。

insert into public.allergen_aliases
  (allergen_id, alias, normalized_alias, alias_kind, requires_label_confirmation, dictionary_version) values
  ('chicken', '鶏', '鶏', 'direct', false, 'jp-caa-2026-04.v1'),
  ('chicken', '手羽', '手羽', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', '砂肝', '砂肝', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', 'せせり', 'せせり', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', 'ぼんじり', 'ぼんじり', 'derived', false, 'jp-caa-2026-04.v1'),
  ('pork', '豚', '豚', 'direct', false, 'jp-caa-2026-04.v1'),
  ('pork', 'とんかつ', 'とんかつ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('pork', 'チャーシュー', 'チャーシュー', 'derived', false, 'jp-caa-2026-04.v1'),
  ('pork', '叉焼', '叉焼', 'derived', false, 'jp-caa-2026-04.v1'),
  ('pork', '肩ロース', '肩ロース', 'derived', false, 'jp-caa-2026-04.v1'),
  ('beef', '牛', '牛', 'direct', false, 'jp-caa-2026-04.v1'),
  ('beef', '肩ロース', '肩ロース', 'derived', false, 'jp-caa-2026-04.v1'),
  ('beef', 'サーロイン', 'サーロイン', 'derived', false, 'jp-caa-2026-04.v1'),
  ('beef', 'カルビ', 'カルビ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('beef', 'ハラミ', 'ハラミ', 'derived', false, 'jp-caa-2026-04.v1')
on conflict (allergen_id, normalized_alias, dictionary_version) do update set
  alias = excluded.alias,
  alias_kind = excluded.alias_kind,
  requires_label_confirmation = excluded.requires_label_confirmation;
