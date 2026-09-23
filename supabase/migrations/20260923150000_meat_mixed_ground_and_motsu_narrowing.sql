-- 2026-09-23: 20260923140000 のレビュー指摘（fix-round-1）と人間の決定を反映する追補。
-- 適用済みの 20260923130000・20260923140000 は編集せず、この 1 本で足し引きする。
-- 1) C1: 合い挽き肉の表記ゆれ（合い挽き・合びき・あい挽き）が豚・牛のどちらにも
--    一致していなかった。pork・beef の両方へ derived（label 確認なし）で足す。
--    合挽き肉・あいびき肉は既存の 合挽・あいびき で拾えるため足さない。
-- 2) m2: 「鳥」表記の鶏の複合語を chicken へ derived で足す。一字の「鳥」は
--    鳥取・千鳥・白鳥等と衝突するため足さない。鳥肉（既存）・鳥手羽（手羽で一致）は足さない。
-- 3) I3: 裸の「もつ」は「3日ほどもつ」「形をたもつ」等の動詞に一致していたため削除し、
--    具体形（もつ煮・もつ鍋・もつ焼き・牛もつ・豚もつ）を label 確認つき processed で足す。
--    レバー・ホルモンの動詞・医学語の誤検知は shared/safety/allergens.ts の
--    EXCLUDED_ALIAS_CONTEXTS で除外する（辞書行は変えない）。
-- 4) m3: 豚カツソースは「豚」の hard 一致から除外し（EXCLUDED_ALIAS_CONTEXTS）、
--    とんかつソースと同じく label 確認つき processed として pork へ足す。
-- allergen_aliases を参照する FK・保存済みスナップショットは無い（current safety は
-- 毎回ライブの辞書から組み立てる）ため、行の削除で壊れる参照は無い。
-- TS 側 currentAllergenAliasManifest（netlify/functions/_shared/current-safety.ts）と
-- exact 一致させること。

delete from public.allergen_aliases
where dictionary_version = 'jp-caa-2026-04.v1'
  and allergen_id in ('pork', 'beef')
  and normalized_alias = 'もつ';

insert into public.allergen_aliases
  (allergen_id, alias, normalized_alias, alias_kind, requires_label_confirmation, dictionary_version) values
  ('pork', '合い挽き', '合い挽き', 'derived', false, 'jp-caa-2026-04.v1'),
  ('pork', '合びき', '合びき', 'derived', false, 'jp-caa-2026-04.v1'),
  ('pork', 'あい挽き', 'あい挽き', 'derived', false, 'jp-caa-2026-04.v1'),
  ('beef', '合い挽き', '合い挽き', 'derived', false, 'jp-caa-2026-04.v1'),
  ('beef', '合びき', '合びき', 'derived', false, 'jp-caa-2026-04.v1'),
  ('beef', 'あい挽き', 'あい挽き', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', '鳥ひき', '鳥ひき', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', '鳥挽', '鳥挽', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', '鳥皮', '鳥皮', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', 'とりかわ', 'とりかわ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', '鳥つくね', '鳥つくね', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', '鳥の唐揚げ', '鳥の唐揚げ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', '鳥から', '鳥から', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', '焼きとり', '焼きとり', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', 'やき鳥', 'やき鳥', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', '鳥そぼろ', '鳥そぼろ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('pork', 'もつ煮', 'もつ煮', 'processed', true, 'jp-caa-2026-04.v1'),
  ('beef', 'もつ煮', 'もつ煮', 'processed', true, 'jp-caa-2026-04.v1'),
  ('pork', 'もつ鍋', 'もつ鍋', 'processed', true, 'jp-caa-2026-04.v1'),
  ('beef', 'もつ鍋', 'もつ鍋', 'processed', true, 'jp-caa-2026-04.v1'),
  ('pork', 'もつ焼き', 'もつ焼き', 'processed', true, 'jp-caa-2026-04.v1'),
  ('beef', 'もつ焼き', 'もつ焼き', 'processed', true, 'jp-caa-2026-04.v1'),
  ('beef', '牛もつ', '牛もつ', 'processed', true, 'jp-caa-2026-04.v1'),
  ('pork', '豚もつ', '豚もつ', 'processed', true, 'jp-caa-2026-04.v1'),
  ('pork', '豚カツソース', '豚カツソース', 'processed', true, 'jp-caa-2026-04.v1')
on conflict (allergen_id, normalized_alias, dictionary_version) do update set
  alias = excluded.alias,
  alias_kind = excluded.alias_kind,
  requires_label_confirmation = excluded.requires_label_confirmation;
