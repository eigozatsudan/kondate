-- S-I2: 高頻度料理名・外来語の hard-match alias を追加し、食パン(wheat) を hard に昇格。
-- TS 側 currentAllergenAliasManifest と exact 一致させること。
-- 裸の「パン」はフライパン衝突のため載せない（S-I1 と同じ）。

insert into public.allergen_aliases
  (allergen_id, alias, normalized_alias, alias_kind, requires_label_confirmation, dictionary_version) values
  ('wheat', 'スパゲッティ', 'スパゲッティ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'スパゲティ', 'スパゲティ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'マカロニ', 'マカロニ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'ラザニア', 'ラザニア', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'ピザ', 'ピザ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'トースト', 'トースト', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'ホットケーキ', 'ホットケーキ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'お好み焼き', 'お好み焼き', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', '餃子', '餃子', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', '天ぷら', '天ぷら', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'クッキー', 'クッキー', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'ビスケット', 'ビスケット', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'ドーナツ', 'ドーナツ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', '中力粉', '中力粉', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', '全粒粉', '全粒粉', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', 'グルテン', 'グルテン', 'derived', false, 'jp-caa-2026-04.v1'),
  ('wheat', '麩', '麩', 'derived', false, 'jp-caa-2026-04.v1'),
  ('egg', 'オムレツ', 'オムレツ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('egg', 'オムライス', 'オムライス', 'derived', false, 'jp-caa-2026-04.v1'),
  ('egg', '目玉焼き', '目玉焼き', 'derived', false, 'jp-caa-2026-04.v1'),
  ('egg', 'エッグ', 'エッグ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('egg', 'スクランブルエッグ', 'スクランブルエッグ', 'derived', false, 'jp-caa-2026-04.v1'),
  ('shrimp', 'シュリンプ', 'シュリンプ', 'direct', false, 'jp-caa-2026-04.v1')
on conflict (allergen_id, normalized_alias, dictionary_version) do update set
  alias = excluded.alias,
  alias_kind = excluded.alias_kind,
  requires_label_confirmation = excluded.requires_label_confirmation;

-- 既存 食パン(wheat) を soft(processed/label) から hard(derived) へ昇格
update public.allergen_aliases
set
  alias_kind = 'derived',
  requires_label_confirmation = false
where allergen_id = 'wheat'
  and normalized_alias = '食パン'
  and dictionary_version = 'jp-caa-2026-04.v1';
