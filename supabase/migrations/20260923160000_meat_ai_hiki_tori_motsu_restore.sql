-- 2026-09-23: 20260923150000 のレビュー指摘（fix-round-2）と人間の決定を反映する追補。
-- 適用済みの 20260923130000〜20260923150000 は編集せず、この 1 本で足す。
-- 1) C1': 送り仮名「き」のない 合い挽肉・あい挽肉・合い挽ミンチ が豚・牛のどちらにも
--    一致していなかった。合い挽・あい挽 を pork・beef の両方へ derived（label 確認なし）で足す。
--    既存の 合い挽き・あい挽き 行は冗長になるが消さない。
-- 2) I-C: 一字の「鳥」を chicken へ derived で足す。鳥取・千鳥・白鳥 等の衝突語は
--    shared/safety/allergens.ts の EXCLUDED_ALIAS_CONTEXTS で除外する。既存の 鳥 の複合語行は
--    冗長になるが消さない。送り仮名なしの「焼とり」も足す（一字の「鳥」では拾えない）。
-- 3) I-B: 20260923150000 で削除した裸の「もつ」を pork・beef へ label 確認つき processed で戻す。
--    「3日ほどもつ」「形をたもつ」「もつれないように」等の動詞は EXCLUDED_ALIAS_CONTEXTS で除外する。
--    もつ煮・もつ鍋・もつ焼き・牛もつ・豚もつ の具体形行は消さない。
-- TS 側 currentAllergenAliasManifest（netlify/functions/_shared/current-safety.ts）と
-- exact 一致させること。

insert into public.allergen_aliases
  (allergen_id, alias, normalized_alias, alias_kind, requires_label_confirmation, dictionary_version) values
  ('pork', '合い挽', '合い挽', 'derived', false, 'jp-caa-2026-04.v1'),
  ('pork', 'あい挽', 'あい挽', 'derived', false, 'jp-caa-2026-04.v1'),
  ('beef', '合い挽', '合い挽', 'derived', false, 'jp-caa-2026-04.v1'),
  ('beef', 'あい挽', 'あい挽', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', '鳥', '鳥', 'derived', false, 'jp-caa-2026-04.v1'),
  ('chicken', '焼とり', '焼とり', 'derived', false, 'jp-caa-2026-04.v1'),
  ('pork', 'もつ', 'もつ', 'processed', true, 'jp-caa-2026-04.v1'),
  ('beef', 'もつ', 'もつ', 'processed', true, 'jp-caa-2026-04.v1')
on conflict (allergen_id, normalized_alias, dictionary_version) do update set
  alias = excluded.alias,
  alias_kind = excluded.alias_kind,
  requires_label_confirmation = excluded.requires_label_confirmation;
