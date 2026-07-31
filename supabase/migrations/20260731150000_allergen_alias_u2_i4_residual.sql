-- U2-I4: やまいも・りんご・マカダミア・あわびの高頻度残差 alias。
-- TS currentAllergenAliasManifest と exact 一致させること。

insert into public.allergen_aliases
  (allergen_id, alias, normalized_alias, alias_kind, requires_label_confirmation, dictionary_version) values
  ('yam', '長芋', '長芋', 'direct', false, 'jp-caa-2026-04.v1'),
  ('yam', 'ながいも', 'ながいも', 'direct', false, 'jp-caa-2026-04.v1'),
  ('apple', 'アップル', 'アップル', 'direct', false, 'jp-caa-2026-04.v1'),
  ('macadamia_nut', 'マカデミア', 'マカデミア', 'direct', false, 'jp-caa-2026-04.v1'),
  ('abalone', '鮑', '鮑', 'direct', false, 'jp-caa-2026-04.v1')
on conflict (allergen_id, normalized_alias, dictionary_version) do update set
  alias = excluded.alias,
  alias_kind = excluded.alias_kind,
  requires_label_confirmation = excluded.requires_label_confirmation;
