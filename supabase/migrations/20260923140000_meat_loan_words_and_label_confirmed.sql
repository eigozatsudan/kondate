-- 2026-09-23: 20260923130000 のレビュー指摘を反映する追補マイグレーション。
-- 1) 鶏の「鳥」表記・ひらがな表記（鳥もも/とりもも/焼き鳥 等）を chicken へ足す。
--    「もも」（桃）alias の EXCLUDED_ALIAS_CONTEXTS には既に「鶏もも」「とりもも」が
--    登録済みのため、桃とは衝突しない。
-- 2) 合いびき（合いびき/合挽/あいびき）を pork・beef の両方へ足す。
-- 3) 種を断定できない加工品・料理名（ハム・レバー・もつ・ホルモン・コンソメ・
--    ブイヨン・とんかつソース）を requires_label_confirmation=true の processed として足す。
--    断定はせず確認を促すだけで、他アレルゲンの既存 label 確認（ハムの卵・乳等）は消さない。
-- 4) とんかつソースは pork の hard 一致（豚・とんかつ）から誤検知として除外し
--    （shared/safety/allergens.ts の EXCLUDED_ALIAS_CONTEXTS）、代わりに上の
--    processed alias で label 確認だけを出す。
-- TS 側 currentAllergenAliasManifest（netlify/functions/_shared/current-safety.ts）と
-- exact 一致させること。

insert into public.allergen_aliases
  (allergen_id, alias, normalized_alias, alias_kind, requires_label_confirmation, dictionary_version) values
  ('chicken', '鳥もも', '鳥もも', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', '鳥むね', '鳥むね', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', 'とりもも', 'とりもも', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', 'とりむね', 'とりむね', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', '焼き鳥', '焼き鳥', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', '焼鳥', '焼鳥', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', 'やきとり', 'やきとり', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', 'とりにく', 'とりにく', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', '鳥ガラ', '鳥ガラ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', 'とりがら', 'とりがら', 'derived', false, 'jp-caa-2026-04.v1'),
  ('pork', '合いびき', '合いびき', 'derived', false, 'jp-caa-2026-04.v1'),
  ('pork', '合挽', '合挽', 'derived', false, 'jp-caa-2026-04.v1'),
  ('pork', 'あいびき', 'あいびき', 'derived', false, 'jp-caa-2026-04.v1'),
  ('beef', '合いびき', '合いびき', 'derived', false, 'jp-caa-2026-04.v1'),
  ('beef', '合挽', '合挽', 'derived', false, 'jp-caa-2026-04.v1'),
  ('beef', 'あいびき', 'あいびき', 'derived', false, 'jp-caa-2026-04.v1'),
  ('pork', 'ハム', 'ハム', 'processed', true, 'jp-caa-2026-04.v1'),
  ('chicken', 'レバー', 'レバー', 'processed', true, 'jp-caa-2026-04.v1'),
  ('pork', 'レバー', 'レバー', 'processed', true, 'jp-caa-2026-04.v1'),
  ('beef', 'レバー', 'レバー', 'processed', true, 'jp-caa-2026-04.v1'),
  ('pork', 'もつ', 'もつ', 'processed', true, 'jp-caa-2026-04.v1'),
  ('beef', 'もつ', 'もつ', 'processed', true, 'jp-caa-2026-04.v1'),
  ('pork', 'ホルモン', 'ホルモン', 'processed', true, 'jp-caa-2026-04.v1'),
  ('beef', 'ホルモン', 'ホルモン', 'processed', true, 'jp-caa-2026-04.v1'),
  ('chicken', 'コンソメ', 'コンソメ', 'processed', true, 'jp-caa-2026-04.v1'),
  ('pork', 'コンソメ', 'コンソメ', 'processed', true, 'jp-caa-2026-04.v1'),
  ('beef', 'コンソメ', 'コンソメ', 'processed', true, 'jp-caa-2026-04.v1'),
  ('chicken', 'ブイヨン', 'ブイヨン', 'processed', true, 'jp-caa-2026-04.v1'),
  ('pork', 'ブイヨン', 'ブイヨン', 'processed', true, 'jp-caa-2026-04.v1'),
  ('beef', 'ブイヨン', 'ブイヨン', 'processed', true, 'jp-caa-2026-04.v1'),
  ('pork', 'とんかつソース', 'とんかつソース', 'processed', true, 'jp-caa-2026-04.v1')
on conflict (allergen_id, normalized_alias, dictionary_version) do update set
  alias = excluded.alias,
  alias_kind = excluded.alias_kind,
  requires_label_confirmation = excluded.requires_label_confirmation;
