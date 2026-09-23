-- 2026-09-23: 20260923160000 のレビュー指摘（fix-round-3）を反映する追補。
-- 適用済みの 20260923130000〜20260923160000 は編集せず、この 1 本で足す。
-- 1) I3: 合い挽き肉の表記ゆれ 相挽き肉・相挽肉・相びき肉・合いひき肉・合ひき肉 が豚・牛の
--    どちらにも一致していなかった。相挽・相びき・合いひき・合ひき を pork・beef の両方へ
--    derived（label 確認なし）で足す。既存行の部分一致で拾える形は足さない。
-- 2) M5: とり胸肉・地どり が chicken に一致していなかった。とり胸・地どり を derived で足す。
--    とりむね肉 は既存の とりむね 行で一致するため足さない。
-- 一字の「鳥」の除外文脈（鳥取 を地名の形へ狭め、鳥貝 を外す）は shared/safety/allergens.ts の
-- EXCLUDED_ALIAS_CONTEXTS 側の変更で、DB の行は変わらない。
-- TS 側 currentAllergenAliasManifest（netlify/functions/_shared/current-safety.ts）と
-- exact 一致させること。

insert into public.allergen_aliases
  (allergen_id, alias, normalized_alias, alias_kind, requires_label_confirmation, dictionary_version) values
  ('pork', '相挽', '相挽', 'derived', false, 'jp-caa-2026-04.v1'),
  ('pork', '相びき', '相びき', 'derived', false, 'jp-caa-2026-04.v1'),
  ('pork', '合いひき', '合いひき', 'derived', false, 'jp-caa-2026-04.v1'),
  ('pork', '合ひき', '合ひき', 'derived', false, 'jp-caa-2026-04.v1'),
  ('beef', '相挽', '相挽', 'derived', false, 'jp-caa-2026-04.v1'),
  ('beef', '相びき', '相びき', 'derived', false, 'jp-caa-2026-04.v1'),
  ('beef', '合いひき', '合いひき', 'derived', false, 'jp-caa-2026-04.v1'),
  ('beef', '合ひき', '合ひき', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', 'とり胸', 'とり胸', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', '地どり', '地どり', 'derived', false, 'jp-caa-2026-04.v1')
on conflict (allergen_id, normalized_alias, dictionary_version) do update set
  alias = excluded.alias,
  alias_kind = excluded.alias_kind,
  requires_label_confirmation = excluded.requires_label_confirmation;
