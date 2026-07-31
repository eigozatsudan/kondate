-- U3-001: きな粉・バゲット・パルメザンの hard-match alias。
-- TS 側 currentAllergenAliasManifest と exact 一致させること。

insert into public.allergen_aliases
  (allergen_id, alias, normalized_alias, alias_kind, requires_label_confirmation, dictionary_version) values
  ('soy', 'きな粉', 'きな粉', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'バゲット', 'バゲット', 'derived', false, 'jp-caa-2026-04.v1'),
  ('milk', 'パルメザン', 'パルメザン', 'derived', false, 'jp-caa-2026-04.v1')
on conflict (allergen_id, normalized_alias, dictionary_version) do update set
  alias = excluded.alias,
  alias_kind = excluded.alias_kind,
  requires_label_confirmation = excluded.requires_label_confirmation;
