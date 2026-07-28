-- F-SAF-001: private.normalize_allergen_term にカタカナ→ひらがな折り畳みを追加する。
-- TS normalizeAllergenTerm / normalizeFoodText と同型にし、カスタム「タマゴ」が
-- 標準卵 alias「たまご」と一致して custom_allergy_matches_standard で拒否されるようにする。

create or replace function private.normalize_allergen_term(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $function$
  -- 1) NFKC  2) カタカナ(ァ-ヶ)→ひらがな  3) lower  4) 空白・括弧除去
  select lower(
    regexp_replace(
      translate(
        normalize(btrim(p_value), NFKC),
        'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ',
        'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔゕゖ'
      ),
      '[[:space:]（）()]',
      '',
      'g'
    )
  );
$function$;
