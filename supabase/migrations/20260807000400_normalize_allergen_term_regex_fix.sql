-- H12 follow-up: 20260807000200 の Cf strip が PG 無効な \x{} regexp を使っており
-- normalize_allergen_term 呼び出しで invalid regular expression になっていた。
-- 既に 002 を適用済みの DB 向けに、translate + U& リテラル版へ create or replace する。
-- 新規 install は 002 修正済み本文と同ロジック（002 の add_custom empty 拒否はそのまま）。

create or replace function private.normalize_allergen_term(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $function$
  -- 1) NFKC  2) カタカナ(ァ-ヶ)→ひらがな  3) lower
  -- 4) normalizeFoodText と同型の空白・句読点除去
  -- 5) 代表的な書式制御 Cf を translate の削除（to が短いと from 余剰文字を削除）で除去。
  --    PG regexp の \x{} は無効のため U& リテラルを使う（JS \p{Cf} の攻撃面: ZWSP 等）。
  select translate(
    regexp_replace(
      lower(
        translate(
          normalize(btrim(p_value), NFKC),
          'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ',
          'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔゕゖ'
        )
      ),
      -- normalizeFoodText: [\s\u3000、。・,./（）()「」『』']
      '[[:space:]　、。・,./（）()「」『』'']',
      '',
      'g'
    ),
    -- soft hyphen / ZWSP–RLM / bidi embeddings / WJ–FA / bidi isolates / BOM
    U&'\00AD\200B\200C\200D\200E\200F\202A\202B\202C\202D\202E\2060\2061\2062\2063\2064\2066\2067\2068\2069\206A\206B\206C\206D\206E\206F\FEFF',
    ''
  );
$function$;
