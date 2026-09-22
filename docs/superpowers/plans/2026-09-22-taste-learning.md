# 好みの学習（tasteHints）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 利用者自身の履歴から好みのスタイルを都度集計し、new_menu の system プロンプトへ prompt 専用ヒントとして載せる。

**Architecture:** 蓄積テーブルを作らない。集計は `public.get_taste_signals()` 1 本で `menus` / `dishes` / `dish_ingredients` を RLS 準拠（`security invoker`）に読む。Function は既存 `loadRecentDishHints` と同じ 200ms・fail-open のローダで取得し、現行の安全制約でフィルタしてからプロンプトへ載せる。指紋・quota・検証には一切載せない。

**Tech Stack:** PostgreSQL 15 / pgTAP、TypeScript strict、Zod、Netlify Functions、React 19 + TanStack Query 5、Vitest、Docker Compose

**Spec:** `docs/superpowers/specs/2026-09-22-taste-learning-design.md`

## Global Constraints

- Node.js `>=24 <25`、ESM、TypeScript `strict: true`。境界で `any` と未検査キャストを使わない。
- 利用者向け文言はすべて日本語。コメントとコミットメッセージも日本語。識別子とテスト名は英語。
- モバイル優先 320 CSS px、横スクロールなし、タップ領域 44×44 CSS px。
- 作業ブランチは `main`。`git push` とデプロイは禁止。`--no-verify` 禁止。
- 生成ファイルの手編集禁止: `package-lock.json`、`infra/supabase/**`、`src/shared/types/database.generated.ts`。
- 名前・メール・アレルギー・自由記述・プロンプト・AI の生出力をログや永続へ出さない。Zod 検証済み構造のみ保存する。
- 現行の家庭安全制約は常に履歴スナップショットに優先する。
- `shared/contracts` はブラウザと Functions の双方から読める。`shared/safety` はブラウザから import しない。
- Node コマンドは Docker 経由で実行する。
  - ホスト非依存: `docker compose run --rm --no-deps app <cmd>`
  - 兄弟コンテナへ通信するもの（`db:types` 等）: `docker compose run --rm app <cmd>`（スタック起動済み）
  - `db:test` はホストで `docker compose --profile test run --rm db-test`
- 出力が大きいコマンドはファイルへリダイレクトし、要約と失敗だけを読む。

## 実装順の制約

**Task 4（トグルと告知文）は Task 6（配線）より前に完了させる。** 初期値が ON であるため、切る手段と説明文が利用者に届く前に学習が有効になってはならない。Task 1〜7 は同一リリースにまとめる。

---

### Task 1: マイグレーションと集計関数

**Files:**
- Create: `supabase/migrations/20260922120000_taste_learning.sql`
- Create: `supabase/tests/database/taste_signals.test.sql`
- Modify: `src/shared/types/database.generated.ts`（`npm run db:types` の成果物。手編集しない）

**Interfaces:**
- Consumes: なし
- Produces:
  - `public.profiles.taste_learning_enabled boolean not null default true`
  - `public.set_taste_learning_enabled(p_enabled boolean) returns boolean`（`authenticated` に execute）
  - `public.get_taste_signals(p_now timestamptz default now()) returns jsonb`（`authenticated` に execute）
  - 戻り jsonb は 3 形のいずれか:
    `{"reason":"disabled"}` / `{"reason":"no_history"}` /
    `{"reason":null,"likedDishes":[{"dishName":string,"role":string}],"likedGenres":[string],"likedIngredients":[string],"likedTimeBand":"short"|"standard"|"slow"|null,"overusedIngredients":[string],"avoidAxes":["child_unfriendly"],"signalStrength":"weak"|"medium"|"strong","dishIngredientIndex":[{"dishName":string,"ingredients":[string]}]}`

- [ ] **Step 1: pgTAP テストを書く（RED）**

`supabase/tests/database/taste_signals.test.sql` を新規作成する。既存テストと同じく `begin;` / `select plan(N);` / `select * from finish();` / `rollback;` で囲む。

```sql
begin;
select plan(24);

-- 構造
select has_column('public', 'profiles', 'taste_learning_enabled',
  'profiles has taste_learning_enabled');
select col_not_null('public', 'profiles', 'taste_learning_enabled',
  'taste_learning_enabled is not null');
select col_default_is('public', 'profiles', 'taste_learning_enabled', 'true',
  'taste_learning_enabled defaults to true');
select has_function('public', 'get_taste_signals', array['timestamptz']);
select has_function('public', 'set_taste_learning_enabled', array['boolean']);

-- 20260712000100 で外したテーブル単位 UPDATE を復活させていない
select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'),
  'profiles table-level UPDATE stays revoked for authenticated'
);

-- 固定データ
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'other@example.test');

-- profiles 行は auth.users トリガで作られる前提。無い環境では明示 insert する。
insert into public.profiles (user_id)
  select '11111111-1111-4111-8111-111111111111'
  where not exists (select 1 from public.profiles
    where user_id = '11111111-1111-4111-8111-111111111111');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

-- 履歴ゼロ
select is(
  (select public.get_taste_signals('2026-09-22T00:00:00Z'::timestamptz) ->> 'reason'),
  'no_history',
  'empty history reports no_history'
);

-- OFF
select is(public.set_taste_learning_enabled(false), false,
  'set_taste_learning_enabled returns the stored value');
select is(
  (select public.get_taste_signals('2026-09-22T00:00:00Z'::timestamptz) ->> 'reason'),
  'disabled',
  'disabled user reports disabled'
);
select is(public.set_taste_learning_enabled(true), true, 'toggle back on');

select * from finish();
rollback;
```

このファイルには続く Step で本体アサーションを足す。まずここまでで落ちることを確認する。

- [ ] **Step 2: テストが落ちることを確認する**

Run:
```bash
docker compose --profile test run --rm db-test > /tmp/dbtest.log 2>&1; \
  grep -nE "not ok|Failed|ERROR" /tmp/dbtest.log | head -20 || tail -n 40 /tmp/dbtest.log
```
Expected: FAIL。`column "taste_learning_enabled" does not exist` と `function public.get_taste_signals(...) does not exist`。

- [ ] **Step 3: マイグレーションを書く**

`supabase/migrations/20260922120000_taste_learning.sql`:

```sql
-- 好みの学習（tasteHints）。prompt 専用・fail-open。
-- 指紋・quota・安全検証には一切載せない。

alter table public.profiles
  add column taste_learning_enabled boolean not null default true;

-- 20260712000100 でテーブル単位 UPDATE と profiles_update_own を外している。
-- 復活させると onboarding_status まで書き換え可能に戻るため、関数経由だけを足す。
create or replace function public.set_taste_learning_enabled(p_enabled boolean)
returns boolean
language sql
security definer
set search_path = ''
as $function$
  update public.profiles
  set taste_learning_enabled = p_enabled,
      updated_at = pg_catalog.now()
  where user_id = (select auth.uid())
  returning taste_learning_enabled;
$function$;

revoke all on function public.set_taste_learning_enabled(boolean) from public, anon;
grant execute on function public.set_taste_learning_enabled(boolean) to authenticated;

-- 集計。security invoker なので所有者 select ポリシーがそのまま効く。
-- 窓 90 日・50 件、半減期 30 日。回数はすべて derivation_group_id 単位で数える。
create or replace function public.get_taste_signals(
  p_now timestamptz default pg_catalog.now()
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
with settings as (
  select p.taste_learning_enabled as enabled
  from public.profiles p
  where p.user_id = (select auth.uid())
),
recent as (
  select
    m.id,
    m.derivation_group_id,
    m.cuisine_genre,
    m.total_elapsed_minutes,
    m.change_reason,
    m.preference_snapshot,
    pg_catalog.power(
      0.5::double precision,
      pg_catalog.extract(epoch from (p_now - m.created_at))::double precision / 86400.0 / 30.0
    ) as decay,
    pg_catalog.power(
      0.5::double precision,
      pg_catalog.extract(epoch from (p_now - m.created_at))::double precision / 86400.0 / 30.0
    ) * (
      (case when m.is_favorite then 1.0 else 0.0 end)
      + (case when m.is_selected then 0.3 else 0.0 end)
    )::double precision as score
  from public.menus m
  where m.user_id = (select auth.uid())
    and m.created_at >= p_now - interval '90 days'
  order by m.created_at desc
  limit 50
),
liked as (select * from recent where score > 0),
-- 料理: score 合計降順。同名は 1 つに畳み、role は最も重い出現のものを採る
liked_dish_rows as (
  select
    d.name as dish_name,
    (pg_catalog.array_agg(d.role order by l.score desc, d.id))[1] as role,
    pg_catalog.sum(l.score) as weight
  from liked l
  join public.dishes d on d.menu_id = l.id
  group by d.name
  order by pg_catalog.sum(l.score) desc, d.name
  limit 12
),
-- 食材: 献立内の重複を潰してから派生グループ単位で数える
liked_ingredient_rows_raw as (
  select distinct l.derivation_group_id, l.score, di.name
  from liked l
  join public.dishes d on d.menu_id = l.id
  join public.dish_ingredients di on di.dish_id = d.id
),
liked_ingredient_rows as (
  select name
  from liked_ingredient_rows_raw
  group by name
  having pg_catalog.count(distinct derivation_group_id) >= 2
  order by pg_catalog.sum(score) desc, name
  limit 8
),
-- 対応表: prompt へは出さない。落とした料理の食材を消すためだけに使う
dish_index_rows as (
  select
    ld.dish_name,
    (pg_catalog.array_agg(distinct di.name))[1:12] as ingredients
  from liked_dish_rows ld
  join public.dishes d on d.name = ld.dish_name
  join liked l on l.id = d.menu_id
  join public.dish_ingredients di on di.dish_id = d.id
  group by ld.dish_name
),
-- 時間帯: 加重平均は小数になるため <=20 / <=40 / それ以外で連続させる
time_band as (
  select case
    when pg_catalog.sum(score) is null or pg_catalog.sum(score) = 0 then null
    when pg_catalog.sum(score * total_elapsed_minutes) / pg_catalog.sum(score) <= 20 then 'short'
    when pg_catalog.sum(score * total_elapsed_minutes) / pg_catalog.sum(score) <= 40 then 'standard'
    else 'slow'
  end as band
  from liked
),
-- ジャンル: 母集団はおまかせ依頼のみ。比率は生成結果の cuisine_genre で取る
genre_pool as (
  select l.cuisine_genre, l.score
  from liked l
  where l.preference_snapshot #>> '{submission,cuisineGenre}' = 'any'
),
genre_total as (select pg_catalog.sum(score) as total from genre_pool),
genre_rows as (
  select g.cuisine_genre
  from genre_pool g, genre_total t
  where g.cuisine_genre <> 'any' and t.total > 0
  group by g.cuisine_genre, t.total
  having pg_catalog.sum(g.score) / t.total >= 0.35
  order by pg_catalog.sum(g.score) desc, g.cuisine_genre
  limit 2
),
-- 使いすぎ: 窓内全献立のメイン食材。派生グループ単位で 3 回以上
main_ingredient_groups as (
  select r.derivation_group_id, ing as name, pg_catalog.max(r.decay) as decay
  from recent r,
    lateral pg_catalog.jsonb_array_elements_text(
      coalesce(r.preference_snapshot #> '{submission,mainIngredients}', '[]'::jsonb)
    ) as ing
  group by r.derivation_group_id, ing
),
overused_rows as (
  select name
  from main_ingredient_groups
  group by name
  having pg_catalog.count(*) >= 3
  order by pg_catalog.sum(decay) desc, name
  limit 3
),
-- 避ける軸: 恒常と読めるのは child_friendly だけ。派生グループ単位で 2 回以上
child_groups as (
  select pg_catalog.count(distinct derivation_group_id) as group_count
  from recent
  where change_reason = 'child_friendly'
),
group_count as (
  select pg_catalog.count(distinct derivation_group_id) as total from recent
)
select case
  when coalesce((select enabled from settings), false) is not true
    then pg_catalog.jsonb_build_object('reason', 'disabled')
  when (select total from group_count) = 0
    then pg_catalog.jsonb_build_object('reason', 'no_history')
  else pg_catalog.jsonb_build_object(
    'reason', null,
    'likedDishes', coalesce(
      (select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('dishName', dish_name, 'role', role))
       from liked_dish_rows), '[]'::jsonb),
    'likedGenres', coalesce(
      (select pg_catalog.jsonb_agg(cuisine_genre) from genre_rows), '[]'::jsonb),
    'likedIngredients', coalesce(
      (select pg_catalog.jsonb_agg(name) from liked_ingredient_rows), '[]'::jsonb),
    'likedTimeBand', (select band from time_band),
    'overusedIngredients', coalesce(
      (select pg_catalog.jsonb_agg(name) from overused_rows), '[]'::jsonb),
    'avoidAxes', case
      when (select group_count from child_groups) >= 2
        then pg_catalog.jsonb_build_array('child_unfriendly')
      else '[]'::jsonb
    end,
    'signalStrength', case
      when (select total from group_count) >= 15 then 'strong'
      when (select total from group_count) >= 5 then 'medium'
      else 'weak'
    end,
    'dishIngredientIndex', coalesce(
      (select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'dishName', dish_name,
          'ingredients', pg_catalog.to_jsonb(ingredients)))
       from dish_index_rows), '[]'::jsonb)
  )
end;
$function$;

revoke all on function public.get_taste_signals(timestamptz) from public, anon;
grant execute on function public.get_taste_signals(timestamptz) to authenticated;
```

- [ ] **Step 4: マイグレーションを適用し、Step 1 のテストが通ることを確認する**

Run:
```bash
docker compose run --rm migrate
docker compose --profile test run --rm db-test > /tmp/dbtest.log 2>&1; \
  grep -nE "not ok|Failed|ERROR" /tmp/dbtest.log | head -20 || tail -n 20 /tmp/dbtest.log
```
Expected: PASS（`not ok` が 0 件）。

- [ ] **Step 5: 本体アサーションを pgTAP へ足す（RED）**

`select plan(24);` を `select plan(40);` に変え、`select * from finish();` の直前へ次を挿入する。ヘルパで献立を作る。

```sql
-- 献立を 1 件作るヘルパ（同一 tx 内のみ）
create or replace function pg_temp.seed_menu(
  p_user uuid, p_group uuid, p_created timestamptz,
  p_favorite boolean, p_selected boolean,
  p_genre text, p_minutes smallint,
  p_change_reason text, p_main_ingredients jsonb,
  p_submission_genre text
) returns uuid language plpgsql as $$
declare v_id uuid := pg_catalog.gen_random_uuid();
begin
  insert into public.menus (
    id, user_id, meal_type, cuisine_genre, servings, total_elapsed_minutes,
    preference_snapshot, safety_snapshot, safety_fingerprint,
    allergen_dictionary_version, food_safety_rule_version, output_schema_version,
    derivation_group_id, parent_menu_id, change_reason,
    is_selected, is_favorite, created_at
  ) values (
    v_id, p_user, 'dinner', p_genre, 2, p_minutes,
    pg_catalog.jsonb_build_object('submission', pg_catalog.jsonb_build_object(
      'cuisineGenre', p_submission_genre, 'mainIngredients', p_main_ingredients)),
    '{}'::jsonb, pg_catalog.repeat('a', 64),
    'v1', 'v1', 'v1',
    p_group,
    case when p_change_reason is null then null else v_id end,
    p_change_reason,
    p_selected, p_favorite, p_created
  );
  return v_id;
end;
$$;
```

> 注: `parent_menu_id` は自己参照になるため、`change_reason` を伴う行は先に親を作ってからその id を渡す形に置き換える。上の簡略形は `menus` の check（parent と reason の同時性）だけを満たすための最小形であり、外部キー制約が自己参照を拒む場合は親行を別途 insert してその id を渡す。

続けてアサーションを書く。

```sql
-- 強さは派生グループで数える: 同じ 1 食を 4 回作り直しても weak のまま
select is(
  (select public.get_taste_signals('2026-09-22T00:00:00Z'::timestamptz) ->> 'signalStrength'),
  'weak',
  'regeneration children do not inflate signalStrength'
);

-- 使いすぎは派生グループ単位: 同じ食材を 3 グループで使って初めて載る
select is(
  (select pg_catalog.jsonb_array_length(
    public.get_taste_signals('2026-09-22T00:00:00Z'::timestamptz) -> 'overusedIngredients')),
  1,
  'main ingredient used in 3 derivation groups is overused'
);

-- 時間帯の境界: 20 は short、20.5 は standard、40 は standard、40.5 は slow
select is(
  (select public.get_taste_signals('2026-09-22T00:00:00Z'::timestamptz) ->> 'likedTimeBand'),
  'standard',
  'weighted average above 20 falls into standard, not a gap'
);

-- ジャンルは生成結果側で比率を取る。おまかせ依頼のみが母集団
select is(
  (select public.get_taste_signals('2026-09-22T00:00:00Z'::timestamptz) -> 'likedGenres'),
  '["japanese"]'::jsonb,
  'genre ratio comes from menus.cuisine_genre over any-request favourites'
);

-- 結果が any の行は分子に入らない
select ok(
  not (public.get_taste_signals('2026-09-22T00:00:00Z'::timestamptz) -> 'likedGenres'
       @> '["any"]'::jsonb),
  'generated any is never reported as a liked genre'
);

-- child_friendly は 2 グループ以上で初めて軸になる
select is(
  (select public.get_taste_signals('2026-09-22T00:00:00Z'::timestamptz) -> 'avoidAxes'),
  '["child_unfriendly"]'::jsonb,
  'child_friendly in two derivation groups becomes a standing axis'
);

-- 対応表は score > 0 の料理だけを含む
select ok(
  (select pg_catalog.jsonb_array_length(
    public.get_taste_signals('2026-09-22T00:00:00Z'::timestamptz) -> 'dishIngredientIndex')) > 0,
  'dishIngredientIndex covers liked dishes'
);

-- 他人の献立は入らない
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select is(
  (select public.get_taste_signals('2026-09-22T00:00:00Z'::timestamptz) ->> 'reason'),
  'no_history',
  'another user sees none of the owner history'
);
```

各アサーションの直前に、そのケースを満たす `pg_temp.seed_menu(...)` 呼び出しを置く。件数と日付は上のアサーションが期待する値に合わせる（例: 強さのケースは同一 `derivation_group_id` で 4 行、使いすぎのケースは異なる 3 グループで同じ食材）。

- [ ] **Step 6: RED を確認してから合わせる**

Run:
```bash
docker compose --profile test run --rm db-test > /tmp/dbtest.log 2>&1; \
  grep -nE "not ok|Failed|ERROR" /tmp/dbtest.log | head -20 || tail -n 20 /tmp/dbtest.log
```
落ちたアサーションがあれば、**テストではなく SQL 関数を直す**。ただし seed の作り方（件数・グループ・日付）の誤りはテスト側を直す。

- [ ] **Step 7: 生成型を更新する**

スタックを起動したうえで（`docker compose up -d --wait`）:
```bash
docker compose run --rm app npm run db:types
git diff --stat src/shared/types/database.generated.ts
```
Expected: `taste_learning_enabled` と 2 つの関数が差分に現れる。**このファイルは手編集しない。**

- [ ] **Step 8: コミット**

```bash
git add supabase/migrations/20260922120000_taste_learning.sql \
  supabase/tests/database/taste_signals.test.sql \
  src/shared/types/database.generated.ts
git commit -m "feat(db): 好みの学習の集計関数とトグル列を追加する

profiles へ taste_learning_enabled を足し、更新は set_taste_learning_enabled
経由だけにする。20260712000100 で外したテーブル単位 UPDATE は復活させない。

get_taste_signals は security invoker で所有者の menus/dishes/dish_ingredients を
読み、窓 90 日・50 件・半減期 30 日で集計する。強さも最低出現回数も
derivation_group_id 単位で数える。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 契約（Zod・定数）

**Files:**
- Create: `shared/contracts/taste-hints.ts`
- Test: `shared/contracts/taste-hints.test.ts`

**Interfaces:**
- Consumes: `dishRoles`（`shared/contracts/generation.ts` の既存 export）
- Produces: `tasteHintsSchema` / `TasteHints` / `tasteSignalsSchema` / `TasteSignals` / `tasteHintsRecordSchema` / `TasteSignalStrength` / `hasTasteContent()` と全定数

- [ ] **Step 1: 失敗するテストを書く**

`shared/contracts/taste-hints.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  TASTE_HALF_LIFE_DAYS,
  TASTE_LIKED_DISHES_MAX,
  TASTE_STRENGTH_MEDIUM_MIN,
  TASTE_STRENGTH_STRONG_MIN,
  TASTE_WINDOW_DAYS,
  TASTE_WINDOW_MENUS,
  hasTasteContent,
  tasteHintsSchema,
  tasteHintsRecordSchema,
  tasteSignalsSchema,
  type TasteHints,
} from "./taste-hints.js";

const empty: TasteHints = {
  likedDishes: [],
  likedGenres: [],
  likedIngredients: [],
  likedTimeBand: null,
  overusedIngredients: [],
  avoidAxes: [],
  signalStrength: "strong",
};

describe("taste-hints contract", () => {
  it("locks the window, half-life, and strength boundaries", () => {
    expect(TASTE_WINDOW_DAYS).toBe(90);
    expect(TASTE_WINDOW_MENUS).toBe(50);
    expect(TASTE_HALF_LIFE_DAYS).toBe(30);
    expect(TASTE_STRENGTH_MEDIUM_MIN).toBe(5);
    expect(TASTE_STRENGTH_STRONG_MIN).toBe(15);
    expect(TASTE_LIKED_DISHES_MAX).toBe(12);
  });

  it("rejects unknown keys and over-long arrays", () => {
    expect(tasteHintsSchema.safeParse({ ...empty, extra: 1 }).success).toBe(false);
    expect(
      tasteHintsSchema.safeParse({
        ...empty,
        likedDishes: Array.from({ length: 13 }, (_, index) => ({ dishName: `d${String(index)}` })),
      }).success,
    ).toBe(false);
  });

  it("accepts the signals shape with the index but not the hints shape", () => {
    const signals = { ...empty, dishIngredientIndex: [{ dishName: "肉じゃが", ingredients: ["牛肉"] }] };
    expect(tasteSignalsSchema.safeParse(signals).success).toBe(true);
    expect(tasteHintsSchema.safeParse(signals).success).toBe(false);
  });

  it("treats strength alone as no content", () => {
    expect(hasTasteContent(empty)).toBe(false);
    expect(hasTasteContent({ ...empty, likedTimeBand: "standard" })).toBe(true);
    expect(hasTasteContent({ ...empty, likedDishes: [{ dishName: "肉じゃが" }] })).toBe(true);
    expect(hasTasteContent({ ...empty, avoidAxes: ["child_unfriendly"] })).toBe(true);
  });

  it("records only applied:true with a strength", () => {
    expect(tasteHintsRecordSchema.safeParse({ applied: true, strength: "medium" }).success).toBe(true);
    expect(tasteHintsRecordSchema.safeParse({ applied: false, strength: "medium" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: 落ちることを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run shared/contracts/taste-hints.test.ts`
Expected: FAIL（`Cannot find module './taste-hints.js'`）

- [ ] **Step 3: 契約を実装する**

`shared/contracts/taste-hints.ts`:

```ts
import { z } from "zod";
import { dishRoles } from "./generation.js";

/** 学習の強さ。窓内の derivation_group_id の個数から決まる */
export const tasteSignalStrengths = ["weak", "medium", "strong"] as const;
export type TasteSignalStrength = (typeof tasteSignalStrengths)[number];

/**
 * 所要時間帯。加重平均は小数になるため、境界は <=20 / <=40 / それ以外で連続させる
 * （21-40 と刻むと 20.5 分がどの帯にも入らない）。
 */
export const tasteTimeBands = ["short", "standard", "slow"] as const;

/** 恒常シグナルとして読めるのは child_friendly だけ（設計 §4.3） */
export const tasteAvoidAxes = ["child_unfriendly"] as const;

/** 集計窓と減衰。SQL 側はリテラルで持ち、境界の同値性は pgTAP が担保する */
export const TASTE_WINDOW_DAYS = 90 as const;
export const TASTE_WINDOW_MENUS = 50 as const;
export const TASTE_HALF_LIFE_DAYS = 30 as const;
export const TASTE_FAVORITE_WEIGHT = 1.0 as const;
export const TASTE_SELECTED_WEIGHT = 0.3 as const;

/** 強さの境界（窓内の derivation_group_id の個数） */
export const TASTE_STRENGTH_MEDIUM_MIN = 5 as const;
export const TASTE_STRENGTH_STRONG_MIN = 15 as const;

/** 最低出現回数。1 回だけの食材を「好き」「使いすぎ」と言わない */
export const TASTE_LIKED_INGREDIENT_MIN_COUNT = 2 as const;
export const TASTE_OVERUSED_INGREDIENT_MIN_COUNT = 3 as const;
export const TASTE_AVOID_AXIS_MIN_COUNT = 2 as const;

/** ジャンルを出す最低比率。和洋中 3 値のうち 2 つが常に入るのを防ぐ */
export const TASTE_GENRE_MIN_SHARE = 0.35 as const;

/** prompt 肥大を防ぐ各上限 */
export const TASTE_LIKED_DISHES_MAX = 12 as const;
export const TASTE_LIKED_GENRES_MAX = 2 as const;
export const TASTE_LIKED_INGREDIENTS_MAX = 8 as const;
export const TASTE_OVERUSED_INGREDIENTS_MAX = 3 as const;
export const TASTE_INDEX_INGREDIENTS_PER_DISH_MAX = 12 as const;

const foodNameSchema = z.string().min(1).max(100);

/** prompt と preference_snapshot に出る形。対応表は含まない */
export const tasteHintsSchema = z
  .object({
    likedDishes: z
      .array(z.object({ dishName: foodNameSchema, role: z.enum(dishRoles).optional() }))
      .max(TASTE_LIKED_DISHES_MAX),
    likedGenres: z.array(z.enum(["japanese", "western", "chinese"])).max(TASTE_LIKED_GENRES_MAX),
    likedIngredients: z.array(foodNameSchema).max(TASTE_LIKED_INGREDIENTS_MAX),
    likedTimeBand: z.enum(tasteTimeBands).nullable(),
    overusedIngredients: z.array(foodNameSchema).max(TASTE_OVERUSED_INGREDIENTS_MAX),
    avoidAxes: z.array(z.enum(tasteAvoidAxes)).max(1),
    signalStrength: z.enum(tasteSignalStrengths),
  })
  .strict();

export type TasteHints = z.infer<typeof tasteHintsSchema>;

/**
 * 集計関数の戻り。dishIngredientIndex は落とした料理の食材を消すための対応表で、
 * prompt にも preference_snapshot にもログにも出さない（sanitize で捨てる）。
 */
export const tasteSignalsSchema = z
  .object({
    ...tasteHintsSchema.shape,
    dishIngredientIndex: z
      .array(
        z.object({
          dishName: foodNameSchema,
          ingredients: z.array(foodNameSchema).max(TASTE_INDEX_INGREDIENTS_PER_DISH_MAX),
        }),
      )
      .max(TASTE_LIKED_DISHES_MAX),
  })
  .strict();

export type TasteSignals = z.infer<typeof tasteSignalsSchema>;

/**
 * 中身が空なら prompt にも記録にも出さない。
 * signalStrength は「中身」ではないので、それだけでは載せない。
 */
export function hasTasteContent(hints: TasteHints): boolean {
  return (
    hints.likedDishes.length > 0 ||
    hints.likedGenres.length > 0 ||
    hints.likedIngredients.length > 0 ||
    hints.overusedIngredients.length > 0 ||
    hints.avoidAxes.length > 0 ||
    hints.likedTimeBand !== null
  );
}

/** preference_snapshot へ記録する形。ブラウザはこれだけを読む */
export const tasteHintsRecordSchema = z
  .object({ applied: z.literal(true), strength: z.enum(tasteSignalStrengths) })
  .strict();

export type TasteHintsRecord = z.infer<typeof tasteHintsRecordSchema>;
```

- [ ] **Step 4: 通ることを確認する**

Run:
```bash
docker compose run --rm --no-deps app npx vitest run shared/contracts/taste-hints.test.ts
docker compose run --rm --no-deps app npm run typecheck
```
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add shared/contracts/taste-hints.ts shared/contracts/taste-hints.test.ts
git commit -m "feat(contracts): 好みの学習の Zod 契約と定数を追加する

prompt へ出す TasteHints と、対応表を含む集計戻り TasteSignals を分ける。
対応表は sanitize で捨てるため契約上も別型にする。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: ローダ・安全フィルタ・sanitize

**Files:**
- Create: `netlify/functions/_shared/taste-hints.ts`
- Test: `netlify/functions/_shared/taste-hints.test.ts`

**Interfaces:**
- Consumes: Task 2 の契約、`shared/safety/allergens.js` の `foodTextContainsAlias`、`shared/safety-pure/normalize-food-text.js` の `normalizeFoodText`、`shared/safety/generation-context.js` の `GenerationContext`、`diversity-hints.js` の `RecentDishHint`
- Produces:
  - `TASTE_HINTS_ENABLED: true`、`TASTE_SYSTEM_MARKER: "【学習】"`、`TASTE_HINTS_TIMEOUT_MS: 200`
  - `type TasteHintsOutcome`（8 値）
  - `loadTasteHints(input: { ownerClient: unknown; timeoutMs?: number }): Promise<{ signals: TasteSignals | null; outcome: TasteHintsOutcome }>`
  - `filterTasteHintsForSafety(signals: TasteSignals, context: GenerationContext): TasteSignals`
  - `sanitizeTasteHints(signals: TasteSignals, recentDishHints: readonly RecentDishHint[]): TasteHints | null`
  - `isTasteHintsEnabled(flag: boolean): boolean`

- [ ] **Step 1: 失敗するテストを書く**

`netlify/functions/_shared/taste-hints.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeGenerationContext, makeIdeaGenerationContext } from "../../../shared/testing/factories.js";
import type { TasteSignals } from "../../../shared/contracts/taste-hints.js";
import {
  TASTE_HINTS_ENABLED,
  TASTE_HINTS_TIMEOUT_MS,
  TASTE_SYSTEM_MARKER,
  filterTasteHintsForSafety,
  loadTasteHints,
  sanitizeTasteHints,
} from "./taste-hints.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function makeOwnerClient(result: { data: unknown; error: { message?: string } | null; delayMs?: number }): unknown {
  const delayMs = result.delayMs ?? 0;
  return {
    rpc: () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve({ data: result.data, error: result.error });
        }, delayMs);
      }),
  };
}

const signals: TasteSignals = {
  likedDishes: [{ dishName: "肉じゃが", role: "main" }, { dishName: "ぶり大根", role: "main" }],
  likedGenres: ["japanese"],
  likedIngredients: ["牛肉", "じゃがいも", "ぶり", "大根"],
  likedTimeBand: "standard",
  overusedIngredients: ["豚肉"],
  avoidAxes: ["child_unfriendly"],
  signalStrength: "medium",
  dishIngredientIndex: [
    { dishName: "肉じゃが", ingredients: ["牛肉", "じゃがいも"] },
    { dishName: "ぶり大根", ingredients: ["ぶり", "大根"] },
  ],
};

describe("taste-hints constants", () => {
  it("locks default-on flag, marker, and timeout", () => {
    expect(TASTE_HINTS_ENABLED).toBe(true);
    expect(TASTE_SYSTEM_MARKER).toBe("【学習】");
    expect(TASTE_HINTS_TIMEOUT_MS).toBe(200);
  });
});

describe("loadTasteHints", () => {
  it("reads reason before schema parsing so disabled is not invalid_shape", async () => {
    const result = await loadTasteHints({ ownerClient: makeOwnerClient({ data: { reason: "disabled" }, error: null }) });
    expect(result).toEqual({ signals: null, outcome: "disabled_user" });
  });

  it("maps no_history without parsing", async () => {
    const result = await loadTasteHints({ ownerClient: makeOwnerClient({ data: { reason: "no_history" }, error: null }) });
    expect(result.outcome).toBe("no_history");
  });

  it("reports invalid_shape for a broken payload", async () => {
    const result = await loadTasteHints({ ownerClient: makeOwnerClient({ data: { reason: null, likedDishes: "no" }, error: null }) });
    expect(result).toEqual({ signals: null, outcome: "invalid_shape" });
  });

  it("returns query_failed on error and never throws", async () => {
    const result = await loadTasteHints({ ownerClient: makeOwnerClient({ data: null, error: { message: "boom" } }) });
    expect(result.outcome).toBe("query_failed");
  });

  it("times out at the budget", async () => {
    vi.useFakeTimers();
    const promise = loadTasteHints({
      ownerClient: makeOwnerClient({ data: { reason: null, ...signals }, error: null, delayMs: 500 }),
      timeoutMs: 200,
    });
    await vi.advanceTimersByTimeAsync(250);
    await expect(promise).resolves.toEqual({ signals: null, outcome: "timeout" });
  });
});

describe("filterTasteHintsForSafety", () => {
  it("drops liked foods that hit a current dislike and clears them from the index too", () => {
    const context = makeGenerationContext({
      memberPreferences: [
        {
          householdMemberId: "11111111-1111-4111-8111-111111111111",
          anonymousMemberRef: "member_1",
          portionSize: "regular",
          spiceLevel: "mild",
          easePreferences: [],
          dislikes: ["じゃがいも"],
        },
      ],
    });
    const filtered = filterTasteHintsForSafety(signals, context);
    expect(filtered.likedIngredients).not.toContain("じゃがいも");
    expect(filtered.dishIngredientIndex.find((entry) => entry.dishName === "肉じゃが")?.ingredients).not.toContain("じゃがいも");
  });

  it("clears avoidAxes for idea mode", () => {
    const filtered = filterTasteHintsForSafety(signals, makeIdeaGenerationContext());
    expect(filtered.avoidAxes).toEqual([]);
  });
});

describe("sanitizeTasteHints", () => {
  it("drops recent dishes and the ingredients only they contributed", () => {
    const hints = sanitizeTasteHints(signals, [{ dishName: "肉じゃが", role: "main" }]);
    expect(hints).not.toBeNull();
    expect(hints?.likedDishes.map((dish) => dish.dishName)).toEqual(["ぶり大根"]);
    // 牛肉・じゃがいもは肉じゃがにしか出ないので落ちる。ぶり・大根は残る
    expect(hints?.likedIngredients).toEqual(["ぶり", "大根"]);
  });

  it("never returns the index", () => {
    const hints = sanitizeTasteHints(signals, []);
    expect(hints).not.toBeNull();
    expect(Object.keys(hints ?? {})).not.toContain("dishIngredientIndex");
  });

  it("returns null when nothing is left", () => {
    const bare: TasteSignals = {
      likedDishes: [],
      likedGenres: [],
      likedIngredients: [],
      likedTimeBand: null,
      overusedIngredients: [],
      avoidAxes: [],
      signalStrength: "strong",
      dishIngredientIndex: [],
    };
    expect(sanitizeTasteHints(bare, [])).toBeNull();
  });
});
```

`makeGenerationContext` / `makeIdeaGenerationContext` の引数形は `shared/testing/factories.ts` の既存シグネチャに合わせる。上書きを受け付けない場合は、返り値をスプレッドして必要なフィールドだけ差し替える。

- [ ] **Step 2: 落ちることを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/taste-hints.test.ts`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 実装する**

`netlify/functions/_shared/taste-hints.ts`:

```ts
/**
 * 好みの学習ヒント（tasteHints）。fail-open・prompt 専用。
 * fingerprint / quota / 検証には載せない。diversity-hints.ts と同型。
 */
import {
  hasTasteContent,
  tasteSignalsSchema,
  type TasteHints,
  type TasteSignals,
} from "../../../shared/contracts/taste-hints.js";
import { foodTextContainsAlias } from "../../../shared/safety/allergens.js";
import { normalizeFoodText } from "../../../shared/safety-pure/normalize-food-text.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";
import type { RecentDishHint } from "./diversity-hints.js";

export const TASTE_HINTS_ENABLED = true as const;
export const TASTE_SYSTEM_MARKER = "【学習】" as const;
export const TASTE_HINTS_TIMEOUT_MS = 200 as const;

export type TasteHintsOutcome =
  | "disabled_flag"
  | "disabled_user"
  | "no_history"
  | "timeout"
  | "query_failed"
  | "invalid_shape"
  | "filtered_empty"
  | "applied";

export type TasteHintsLoadResult = {
  signals: TasteSignals | null;
  outcome: TasteHintsOutcome;
};

/** `true as const` を三項へ直接置くと lint が死枝扱いするため boolean 引数で広げる */
export function isTasteHintsEnabled(flag: boolean): boolean {
  return flag;
}

type OwnerClientForTaste = {
  rpc: (
    name: "get_taste_signals",
    args: Record<string, never>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

function isOwnerClientForTaste(client: unknown): client is OwnerClientForTaste {
  if (typeof client !== "object" || client === null || !("rpc" in client)) return false;
  return typeof client.rpc === "function";
}

function readReason(data: unknown): string | null | undefined {
  if (typeof data !== "object" || data === null || !("reason" in data)) return undefined;
  const reason = (data as { reason: unknown }).reason;
  if (reason === null) return null;
  return typeof reason === "string" ? reason : undefined;
}

async function querySignals(client: OwnerClientForTaste): Promise<TasteHintsLoadResult> {
  const { data, error } = await client.rpc("get_taste_signals", {});
  if (error !== null) return { signals: null, outcome: "query_failed" };

  // reason は safeParse より先に見る。理由オブジェクトを schema に通すと
  // disabled / no_history が invalid_shape へ潰れる。
  const reason = readReason(data);
  if (reason === "disabled") return { signals: null, outcome: "disabled_user" };
  if (reason === "no_history") return { signals: null, outcome: "no_history" };
  if (reason !== null) return { signals: null, outcome: "invalid_shape" };

  const { reason: _ignored, ...rest } = data as { reason: null } & Record<string, unknown>;
  const parsed = tasteSignalsSchema.safeParse(rest);
  if (!parsed.success) return { signals: null, outcome: "invalid_shape" };
  return { signals: parsed.data, outcome: "applied" };
}

/**
 * 集計ヒントを owner 境界で読む。
 * 失敗・タイムアウト・0 件はすべて signals: null。決して throw しない。
 */
export async function loadTasteHints(input: {
  ownerClient: unknown;
  timeoutMs?: number;
}): Promise<TasteHintsLoadResult> {
  try {
    if (!isOwnerClientForTaste(input.ownerClient)) {
      return { signals: null, outcome: "query_failed" };
    }
    const timeoutMs = input.timeoutMs ?? TASTE_HINTS_TIMEOUT_MS;
    const ownerClient = input.ownerClient;
    const queryPromise = querySignals(ownerClient).catch(
      () => ({ signals: null, outcome: "query_failed" }) as TasteHintsLoadResult,
    );

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeoutId = setTimeout(() => {
        resolve("timeout");
      }, timeoutMs);
    });

    const raced = await Promise.race([
      queryPromise.then((result) => ({ kind: "ok" as const, result })),
      timeoutPromise.then(() => ({ kind: "timeout" as const })),
    ]);

    if (timeoutId !== undefined) clearTimeout(timeoutId);

    if (raced.kind === "timeout") {
      // 遅延 resolve した結果は採用しない（race 勝者のみ）。未処理 reject を避ける
      void queryPromise.catch(() => {
        /* ignore late failure */
      });
      return { signals: null, outcome: "timeout" };
    }
    return raced.result;
  } catch {
    return { signals: null, outcome: "query_failed" };
  }
}

/** 現行制約の語を集める。household は安全文脈も見る */
function collectBlockedTerms(context: GenerationContext): readonly string[] {
  const terms: string[] = [...context.submission.avoidIngredients];
  for (const preference of context.memberPreferences) {
    terms.push(...preference.dislikes);
  }
  if (context.targetMode === "household") {
    const allergenIds = new Set<string>();
    for (const member of context.safety.members) {
      for (const custom of member.customAllergies) {
        terms.push(custom.name, ...custom.aliases);
      }
      for (const allergenId of member.allergenIds) {
        allergenIds.add(allergenId);
      }
    }
    // AllergenDictionary は id キーの辞書ではなく { version, catalog, aliases } なので
    // aliases を allergenId で絞り込む
    for (const alias of context.safety.allergenDictionary.aliases) {
      if (allergenIds.has(alias.allergenId)) {
        terms.push(alias.alias);
      }
    }
  }
  return terms.filter((term) => normalizeFoodText(term) !== "");
}

function hitsBlocked(text: string, blocked: readonly string[]): boolean {
  return blocked.some((term) => foodTextContainsAlias(text, term));
}

/**
 * 過去の好みを現在の制約へ持ち込まないための prompt 衛生。
 * これは安全ゲートではない（実判定は validate-generated-menu と生成ハードゲート）。
 * あわせて idea の avoidAxes を空にする。集計関数はモードを知らないため、
 * generationContext が揃うこの位置が最初の適用点になる。
 */
export function filterTasteHintsForSafety(
  signals: TasteSignals,
  context: GenerationContext,
): TasteSignals {
  const blocked = collectBlockedTerms(context);
  return {
    ...signals,
    likedDishes: signals.likedDishes.filter((dish) => !hitsBlocked(dish.dishName, blocked)),
    likedIngredients: signals.likedIngredients.filter((name) => !hitsBlocked(name, blocked)),
    dishIngredientIndex: signals.dishIngredientIndex.map((entry) => ({
      dishName: entry.dishName,
      ingredients: entry.ingredients.filter((name) => !hitsBlocked(name, blocked)),
    })),
    avoidAxes: context.targetMode === "idea" ? [] : signals.avoidAxes,
  };
}

/**
 * 軸分けの確定。最近出した料理を落とし、その料理にしか出てこない食材も落とす。
 * 対応表は使い切ってここで捨てる（prompt にも記録にも出さない）。
 */
export function sanitizeTasteHints(
  signals: TasteSignals,
  recentDishHints: readonly RecentDishHint[],
): TasteHints | null {
  const recentNames = new Set(recentDishHints.map((hint) => normalizeFoodText(hint.dishName)));
  const keptDishes = signals.likedDishes.filter(
    (dish) => !recentNames.has(normalizeFoodText(dish.dishName)),
  );
  const keptNames = new Set(keptDishes.map((dish) => normalizeFoodText(dish.dishName)));

  // 残った料理に現れる食材だけを「まだ好き」と扱う。
  // 対応表に載っていない食材は由来が辿れないため保守的に残す。
  const survivingIngredients = new Set<string>();
  const indexedIngredients = new Set<string>();
  for (const entry of signals.dishIngredientIndex) {
    for (const name of entry.ingredients) {
      indexedIngredients.add(normalizeFoodText(name));
      if (keptNames.has(normalizeFoodText(entry.dishName))) {
        survivingIngredients.add(normalizeFoodText(name));
      }
    }
  }

  const hints: TasteHints = {
    likedDishes: keptDishes.slice(0, 12),
    likedGenres: signals.likedGenres.slice(0, 2),
    likedIngredients: signals.likedIngredients
      .filter((name) => {
        const normalized = normalizeFoodText(name);
        if (!indexedIngredients.has(normalized)) return true;
        return survivingIngredients.has(normalized);
      })
      .slice(0, 8),
    likedTimeBand: signals.likedTimeBand,
    overusedIngredients: signals.overusedIngredients.slice(0, 3),
    avoidAxes: signals.avoidAxes.slice(0, 1),
    signalStrength: signals.signalStrength,
  };

  return hasTasteContent(hints) ? hints : null;
}
```

上限のマジックナンバーは契約の定数（`TASTE_LIKED_DISHES_MAX` 等）を import して置き換える。

- [ ] **Step 4: 通ることを確認する**

Run:
```bash
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/taste-hints.test.ts
docker compose run --rm --no-deps app npm run typecheck
```
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add netlify/functions/_shared/taste-hints.ts netlify/functions/_shared/taste-hints.test.ts
git commit -m "feat(functions): 好みの学習ヒントのローダと安全フィルタを追加する

reason を safeParse より先に見て disabled / no_history を invalid_shape へ
潰さない。現行のアレルギー・苦手・避けたい食材で語を落とし、idea では
avoidAxes を空にする。最近出した料理とその料理にしか出ない食材を落とし、
対応表は sanitize で捨てる。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 設定トグルと告知文（配線より前に置く）

**Files:**
- Create: `src/features/account/taste-learning-api.ts`
- Create: `src/features/account/taste-learning-section.tsx`
- Test: `src/features/account/taste-learning-section.test.tsx`
- Modify: `src/features/privacy/privacy-copy.ts:41`（`privacySections` の「AIへ送る情報」）
- Modify: `src/features/privacy/privacy-copy.test.ts`
- Modify: `src/features/household/household-settings-page.tsx:1776-1779` と `:2536-2540`（2 箇所とも）

**Interfaces:**
- Consumes: Task 1 の `set_taste_learning_enabled` と `profiles.taste_learning_enabled`
- Produces: `getTasteLearningEnabled(client)` / `setTasteLearningEnabled(client, enabled)` / `<TasteLearningSection />`

- [ ] **Step 1: 失敗するテストを書く**

`src/features/account/taste-learning-section.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TasteLearningSection } from "./taste-learning-section";

function renderSection(props: Parameters<typeof TasteLearningSection>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TasteLearningSection {...props} />
    </QueryClientProvider>,
  );
}

describe("TasteLearningSection", () => {
  it("shows the stored value and the disclosure copy", async () => {
    renderSection({ enabled: true, onToggle: vi.fn() });
    const toggle = await screen.findByRole("switch", { name: "好みの学習" });
    expect(toggle).toBeChecked();
    expect(screen.getByText(/料理名と食材名/u)).toBeInTheDocument();
    expect(screen.getByText(/90日/u)).toBeInTheDocument();
  });

  it("sends the next value on toggle", async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    renderSection({ enabled: true, onToggle });
    await userEvent.click(await screen.findByRole("switch", { name: "好みの学習" }));
    await waitFor(() => {
      expect(onToggle).toHaveBeenCalledWith(false);
    });
  });

  it("restores the previous state when the update fails", async () => {
    const onToggle = vi.fn().mockRejectedValue(new Error("boom"));
    renderSection({ enabled: true, onToggle });
    await userEvent.click(await screen.findByRole("switch", { name: "好みの学習" }));
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "好みの学習" })).toBeChecked();
    });
    expect(screen.getByRole("status")).toHaveTextContent(/変更できませんでした/u);
  });
});
```

`src/features/privacy/privacy-copy.test.ts` へ追記:

```ts
it("discloses that liked dish and ingredient names are sent for up to 90 days", () => {
  const section = privacySections.find((entry) => entry.title === "AIへ送る情報");
  expect(section).toBeDefined();
  expect(section?.body).toMatch(/料理名と食材名/u);
  expect(section?.body).toMatch(/90日/u);
  expect(section?.body).toMatch(/設定/u);
});
```

- [ ] **Step 2: 落ちることを確認する**

Run:
```bash
docker compose run --rm --no-deps app npx vitest run \
  src/features/account/taste-learning-section.test.tsx \
  src/features/privacy/privacy-copy.test.ts
```
Expected: FAIL

- [ ] **Step 3: API を書く**

`src/features/account/taste-learning-api.ts`:

```ts
import { z } from "zod";
import type { BrowserSupabaseClient } from "@/shared/lib/supabase";

const profileRowSchema = z.object({ taste_learning_enabled: z.boolean() }).strict();

/** 設定画面用の読み取り。household の select("*") とは別に持つ */
export async function getTasteLearningEnabled(
  client: BrowserSupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("profiles")
    .select("taste_learning_enabled")
    .eq("user_id", userId)
    .single();
  if (error !== null) throw new Error("taste_learning_read_failed");
  return profileRowSchema.parse(data).taste_learning_enabled;
}

/** 更新は RPC 経由のみ。profiles のテーブル単位 UPDATE は revoke されたまま */
export async function setTasteLearningEnabled(
  client: BrowserSupabaseClient,
  enabled: boolean,
): Promise<boolean> {
  const { data, error } = await client.rpc("set_taste_learning_enabled", { p_enabled: enabled });
  if (error !== null) throw new Error("taste_learning_write_failed");
  return z.boolean().parse(data);
}
```

- [ ] **Step 4: セクションを書く**

`src/features/account/taste-learning-section.tsx`:

```tsx
import { useId, useState } from "react";

export const tasteLearningCopy = {
  title: "好みの学習",
  toggleLabel: "好みの学習",
  body: "★を付けた献立、「この献立にする」で選んだ献立、再生成の理由、入力したメイン食材から傾向を読み取り、次の提案に反映します。",
  sending:
    "献立を作るときに、そこから読み取った料理名と食材名（最長90日・最大50献立）がAIへ送られます。",
  storage: "OFFにすると読み取りをやめます。設定と反映の記録は保存されます。",
  failed: "設定を変更できませんでした。時間をおいてもう一度お試しください",
} as const;

export type TasteLearningSectionProps = {
  enabled: boolean;
  onToggle: (nextEnabled: boolean) => Promise<void>;
};

/**
 * 好みの学習の ON/OFF。読み取りは呼び出し側、書き込みは RPC。
 * 楽観表示はせず、失敗したら元の値へ戻す。
 */
export function TasteLearningSection({ enabled, onToggle }: TasteLearningSectionProps) {
  const [current, setCurrent] = useState(enabled);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const describedById = useId();

  return (
    <section className="card stack settings-section" aria-labelledby="taste-learning-title">
      <h2 id="taste-learning-title" className="settings-section-title">
        {tasteLearningCopy.title}
      </h2>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          role="switch"
          className="min-h-11 min-w-11"
          checked={current}
          aria-checked={current}
          aria-describedby={describedById}
          disabled={pending}
          onChange={(event) => {
            const next = event.target.checked;
            const previous = current;
            setPending(true);
            setFailed(false);
            setCurrent(next);
            void onToggle(next)
              .catch(() => {
                setCurrent(previous);
                setFailed(true);
              })
              .finally(() => {
                setPending(false);
              });
          }}
        />
        {tasteLearningCopy.toggleLabel}
      </label>
      <p id={describedById} className="type-small text-ink/80">
        {tasteLearningCopy.body}
        {tasteLearningCopy.sending}
        {tasteLearningCopy.storage}
      </p>
      {failed ? (
        <p className="type-small" role="status">
          {tasteLearningCopy.failed}
        </p>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 5: プライバシー文言を追記する**

`src/features/privacy/privacy-copy.ts` の `privacySections`「AIへ送る情報」の `body` 末尾へ次を連結する（既存文はそのまま残す）。

```ts
"また、好みの学習をONにしている場合は、★を付けた献立や選んだ献立から読み取った料理名と食材名（最長90日・最大50献立）も送ります。設定でいつでも止められます。"
```

- [ ] **Step 6: 設定ページへ差し込む**

`src/features/household/household-settings-page.tsx` の 2 箇所（`:1776` 付近と `:2536` 付近）で `<ShareConsentSettingsSection userId={userId} />` の直後に置く。読み取りは `useQuery`、書き込みは `useMutation` で `setTasteLearningEnabled` を呼び、成功後に query を invalidate する。**2 箇所とも差し込む**（片方だけだとオンボーディング未完了の導線から設定が消える）。

- [ ] **Step 7: 通ることを確認する**

Run:
```bash
docker compose run --rm --no-deps app npx vitest run \
  src/features/account/taste-learning-section.test.tsx \
  src/features/privacy/privacy-copy.test.ts \
  src/features/household
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint > /tmp/lint.log 2>&1; \
  grep -nE "error" /tmp/lint.log | head -20 || tail -n 5 /tmp/lint.log
```
Expected: PASS

- [ ] **Step 8: コミット**

```bash
git add src/features/account/taste-learning-api.ts \
  src/features/account/taste-learning-section.tsx \
  src/features/account/taste-learning-section.test.tsx \
  src/features/privacy/privacy-copy.ts src/features/privacy/privacy-copy.test.ts \
  src/features/household/household-settings-page.tsx
git commit -m "feat(settings): 好みの学習のトグルと送信の告知を追加する

更新は set_taste_learning_enabled RPC 経由のみ。読み取りは設定画面用に
新設する。プライバシーページの「AIへ送る情報」に、料理名と食材名が
最長90日・最大50献立ぶん送られることと停止手段を書く。

配線より先にこの Task を入れ、初期値 ON のまま切る手段が無い状態を作らない。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: プロンプト合成

**Files:**
- Modify: `netlify/functions/_shared/diversity-hints.ts`（`DIVERSITY_PARAGRAPH_WITH_TASTE` を追加）
- Modify: `netlify/functions/_shared/taste-hints.ts`（`TASTE_PARAGRAPH` を追加）
- Modify: `netlify/functions/_shared/generation-prompt.ts:287-298`（`buildNewMenuSystemPrompt`）と `:549-590`（`buildGenerationMessages`）
- Modify: `netlify/functions/_shared/generation-prompt.test.ts`
- Create: `netlify/functions/_shared/generation-prompt-taste-off.test.ts`

**Interfaces:**
- Consumes: Task 2 の `TasteHints`、Task 3 の `TASTE_SYSTEM_MARKER` / `isTasteHintsEnabled` / `TASTE_HINTS_ENABLED`
- Produces: `buildGenerationMessages` が `GenerationExecutionContext` の `tasteHints: TasteHints | null`（new_menu のみ）を読み、user payload の `tasteHints` キーと system の【学習】段落を出す

- [ ] **Step 1: 失敗するテストを書く**

`netlify/functions/_shared/generation-prompt.test.ts` へ追記:

```ts
it("adds the taste paragraph and payload key only for new_menu", () => {
  const messages = buildGenerationMessages(
    asNewMenuExecution(makeGenerationContext(), {
      tasteHints: {
        likedDishes: [{ dishName: "ぶり大根", role: "main" }],
        likedGenres: ["japanese"],
        likedIngredients: ["大根"],
        likedTimeBand: "standard",
        overusedIngredients: ["豚肉"],
        avoidAxes: [],
        signalStrength: "medium",
      },
    }),
  );
  const system = messages.find((message) => message.role === "system");
  const user = messages.find((message) => message.role === "user");
  expect(system?.content).toContain(TASTE_SYSTEM_MARKER);
  expect(user?.content).toContain("tasteHints");
  // 料理名は system 文へ連結しない（user JSON のエスケープ経由だけ）
  expect(system?.content).not.toContain("ぶり大根");
});

it("states the priority order exactly once", () => {
  const messages = buildGenerationMessages(
    asNewMenuExecution(makeGenerationContext(), { tasteHints: someTasteHints }),
  );
  const system = messages.find((message) => message.role === "system")?.content ?? "";
  expect(system.split("優先順位は次のとおりです。").length - 1).toBe(1);
});

it("omits the key entirely when there are no hints", () => {
  const messages = buildGenerationMessages(
    asNewMenuExecution(makeGenerationContext(), { tasteHints: null }),
  );
  const user = messages.find((message) => message.role === "user");
  expect(user?.content).not.toContain("tasteHints");
  expect(messages.find((message) => message.role === "system")?.content).not.toContain(
    TASTE_SYSTEM_MARKER,
  );
});
```

`generation-prompt-taste-off.test.ts` は `generation-prompt-diversity-off.test.ts` をひな型にし、`vi.hoisted` + `vi.mock("./taste-hints.js")` で `TASTE_HINTS_ENABLED` を `false` にしたうえで、段落もキーも出ないことを固定する。

- [ ] **Step 2: 落ちることを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/generation-prompt.test.ts netlify/functions/_shared/generation-prompt-taste-off.test.ts`
Expected: FAIL

- [ ] **Step 3: 段落を書く**

`netlify/functions/_shared/taste-hints.ts` へ追加:

```ts
/**
 * system 文の学習段落。先頭マーカーでテスト・運用識別する。
 * 値は載せない（料理名・食材名は user JSON の tasteHints にだけ出す）。
 */
export const TASTE_PARAGRAPH =
  TASTE_SYSTEM_MARKER +
  "優先順位は次のとおりです。" +
  "1)アレルギー・必須安全・must_use・品数・時間、" +
  "2)当日のpreferences（メイン食材・避けたい等）、" +
  "3)tasteHintsが示す好みのスタイル、" +
  "4)最近の料理に近くないこと（recentDishHints）、" +
  "5)季節。" +
  "tasteHints.likedDishesは、味の方向と調理法の傾向を汲むための材料です。" +
  "そこに挙げた料理名をそのまま出すためのリストとして使わないでください。" +
  "tasteHints.likedTimeBandとlikedGenresは、当日のpreferencesに指定があるときは無視してください。" +
  "tasteHints.signalStrengthがweakのときは参考程度に留めてください。" +
  "tasteHints.overusedIngredientsは連続を避ける対象であり、禁止食材ではありません。" +
  "tasteHints.avoidAxesは献立全体の寄せ方であり、constraint_conflictの理由にしないでください。" +
  "学習と他の制約が両立しないときは、通常どおりoutcome=successで返してください。" +
  "学習だけを理由にconstraint_conflictにしないでください。";
```

`netlify/functions/_shared/diversity-hints.ts` へ追加（既存 `DIVERSITY_PARAGRAPH` は変更しない）:

```ts
/**
 * 学習段落が同じ system 文に載るときの多様性段落。
 * 優先順位の文は学習段落側が持つため、ここでは番号を繰り返さない。
 */
export const DIVERSITY_PARAGRAPH_WITH_TASTE =
  DIVERSITY_SYSTEM_MARKER +
  "可能ならrecentDishHintsの料理名・役割が近い案は避けてください。" +
  "避けられない場合、履歴が空の場合、他の制約と両立できない場合は通常どおりoutcome=successで返してください。" +
  "多様性だけを理由にconstraint_conflictにしないでください。";
```

- [ ] **Step 4: 合成へ配線する**

`generation-prompt.ts`:

```ts
function buildNewMenuSystemPrompt(
  targetMode: GenerationContext["targetMode"],
  diversityEnabled: boolean,
  noveltyEnabled: boolean,
  tasteEnabled: boolean,
): string {
  const coreBody = buildGenerationSystemPromptCoreBody(readHouseholdKitchenPromptEnabledFlag());
  // 優先順位の文は 1 つの system 文に 1 回だけ。学習が載る版では多様性側から外す
  const diversity = diversityEnabled
    ? tasteEnabled
      ? DIVERSITY_PARAGRAPH_WITH_TASTE
      : DIVERSITY_PARAGRAPH
    : "";
  const taste = tasteEnabled ? TASTE_PARAGRAPH : "";
  const novelty = noveltyEnabled ? NOVELTY_PARAGRAPH : "";
  const modeExtra =
    targetMode === "idea"
      ? GENERATION_SYSTEM_PROMPT_IDEA_EXTRA
      : GENERATION_SYSTEM_PROMPT_HOUSEHOLD_EXTRA;
  return `${coreBody}${diversity}${taste}${novelty}${GENERATION_SYSTEM_PROMPT_SEASON}${modeExtra}`;
}
```

`buildGenerationMessages` の `new_menu` 分岐で:

```ts
// 学習ヒントは配線側で sanitize 済み。ここでは載せるかどうかだけを決める
const tasteHints = readTasteHintsEnabledFlag() ? (context.tasteHints ?? null) : null;
const tasteEnabled = tasteHints !== null;
const systemContent = buildNewMenuSystemPrompt(
  context.generationContext.targetMode,
  diversityEnabled,
  noveltyEnabled,
  tasteEnabled,
);
const payload = {
  ...basePayload,
  recentDishHints,
  ...(noveltyEnabled ? { noveltyExcludedDishes } : {}),
  ...(tasteEnabled ? { tasteHints } : {}),
};
```

`readTasteHintsEnabledFlag()` は `readDiversityHintsEnabledFlag` と同型で `isTasteHintsEnabled(TASTE_HINTS_ENABLED)` を返す。`GenerationExecutionContext` の `new_menu` 分岐へ `tasteHints: TasteHints | null` を足す（Task 6 で埋める。この Task ではフィールド追加とテストのみ）。

- [ ] **Step 5: 通ることを確認する**

Run:
```bash
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/generation-prompt.test.ts \
  netlify/functions/_shared/generation-prompt-taste-off.test.ts \
  netlify/functions/_shared/generation-prompt-diversity-off.test.ts \
  netlify/functions/_shared/generation-prompt-novelty-off.test.ts \
  netlify/functions/_shared/generation-prompt-kitchen-off.test.ts
docker compose run --rm --no-deps app npm run typecheck
```
Expected: PASS（既存 3 本の off テストも通ること）

- [ ] **Step 6: コミット**

```bash
git add netlify/functions/_shared/taste-hints.ts netlify/functions/_shared/diversity-hints.ts \
  netlify/functions/_shared/generation-prompt.ts \
  netlify/functions/_shared/generation-prompt.test.ts \
  netlify/functions/_shared/generation-prompt-taste-off.test.ts
git commit -m "feat(prompt): new_menu へ学習段落と tasteHints を載せる

優先順位の文が同じ system 文に二度出ないよう、学習が載る版の多様性段落を
別に用意して番号を持たせない。料理名と食材名は system 文へ連結せず、
user JSON の tasteHints にだけ出す。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: 配線・記録・観測ログ

**Files:**
- Modify: `netlify/functions/_shared/generation-service.ts:450-480`（`loadExecutionContext`）と `:675-700`（`buildSuccessInput`）
- Modify: `netlify/functions/_shared/logger.ts:85-90`（`SafeGenerationLogEvent`）と `:207`（`SAFE_LOG_SERIALIZED_KEYS`）
- Modify: `scripts/assert-privacy-logs.mjs:31`（`allowedLogKeys`）
- Modify: `netlify/functions/_shared/generation-service.test.ts`

**Interfaces:**
- Consumes: Task 3 のローダ一式、Task 5 の `tasteHints` フィールド
- Produces: `preference_snapshot.tasteHints = { applied: true, strength }`、ログの `taste_hints_outcome`

- [ ] **Step 1: 失敗するテストを書く**

`generation-service.test.ts` へ追記:

```ts
it("records the snapshot from the sanitized object, not the raw signals", async () => {
  // sanitize 後に空になるケース: liked はすべて recentDishHints と重なる
  const deps = makeDeps({
    tasteSignals: {
      likedDishes: [{ dishName: "肉じゃが", role: "main" }],
      likedGenres: [],
      likedIngredients: ["牛肉"],
      likedTimeBand: null,
      overusedIngredients: [],
      avoidAxes: [],
      signalStrength: "strong",
      dishIngredientIndex: [{ dishName: "肉じゃが", ingredients: ["牛肉"] }],
    },
    recentDishHints: [{ dishName: "肉じゃが", role: "main" }],
  });
  const result = await runNewMenu(deps);
  expect(result.preferenceSnapshot).not.toHaveProperty("tasteHints");
});

it("never feeds tasteHints into the safety fingerprint", async () => {
  const withHints = await runNewMenu(makeDeps({ tasteSignals: someSignals }));
  const withoutHints = await runNewMenu(makeDeps({ tasteSignals: null }));
  expect(withHints.safetyFingerprint).toBe(withoutHints.safetyFingerprint);
});

it("logs a closed outcome enum", async () => {
  const deps = makeDeps({ tasteSignals: null, tasteOutcome: "timeout" });
  await runNewMenu(deps);
  expect(deps.loggedEvents.at(-1)).toMatchObject({ tasteHintsOutcome: "timeout" });
});
```

`makeDeps` / `runNewMenu` は同ファイルの既存ヘルパに合わせる。存在しない場合は既存テストの組み立て方をそのまま複製する（「Task N と同様」で済ませない）。

- [ ] **Step 2: 落ちることを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/generation-service.test.ts`
Expected: FAIL

- [ ] **Step 3: ログのキーを 3 箇所へ足す**

`logger.ts`:

```ts
export type SafeGenerationLogEvent = {
  requestId: string;
  errorCode: string;
  durationMs: number;
  modelId: string | null;
  /** 学習ヒントの結末。閉じた列挙のみ。料理名・食材名は出さない */
  tasteHintsOutcome?: TasteHintsOutcome;
};
```

`SAFE_LOG_SERIALIZED_KEYS` へ `"taste_hints_outcome"` を足す。値は `closedErrorCode` と同型の閉じた列挙チェックを通し、未知の文字列は落とす。

`scripts/assert-privacy-logs.mjs` の `allowedLogKeys` へ同じキーを足す（無いと `privacy_log_unexpected_field` で落ちる）。

- [ ] **Step 4: 配線する**

`generation-service.ts` の `loadExecutionContext`:

```ts
const tasteEnabled = isTasteHintsEnabled(TASTE_HINTS_ENABLED);
const ownerClient = createUserScopedSupabase(user.accessToken);
const hintsPromise = diversityEnabled
  ? loadRecentDishHints({ ownerClient, userId: user.userId })
  : Promise.resolve([] as const);
// L13 と同型: flag off のときは load 自体を呼ばない
const tastePromise = tasteEnabled
  ? loadTasteHints({ ownerClient })
  : Promise.resolve({ signals: null, outcome: "disabled_flag" as const });

const [generationContext, recentDishHints, taste] = await Promise.all([
  loadGenerationContext(user, requestId, command.request),
  hintsPromise,
  tastePromise,
]);

// targetMode は generationContext が揃って初めて分かる（request は持たない）
const tasteHints =
  taste.signals === null
    ? null
    : sanitizeTasteHints(filterTasteHintsForSafety(taste.signals, generationContext), recentDishHints);
const tasteHintsOutcome: TasteHintsOutcome =
  taste.signals === null ? taste.outcome : tasteHints === null ? "filtered_empty" : "applied";

return {
  kind: "new_menu",
  // ...既存フィールド
  recentDishHints,
  tasteHints,
  tasteHintsOutcome,
};
```

`buildSuccessInput` の `preferenceSnapshot`:

```ts
// 反映の記録は、実際に user ペイロードへ載せた確定オブジェクトから導く
preferenceSnapshot:
  execution.kind === "new_menu" && execution.tasteHints !== null
    ? {
        ...context.preferenceSnapshot,
        tasteHints: { applied: true, strength: execution.tasteHints.signalStrength },
      }
    : context.preferenceSnapshot,
```

`logGenerationEvent` の呼び出しへ `tasteHintsOutcome` を渡す。

- [ ] **Step 5: 通ることを確認する**

Run:
```bash
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/generation-service.test.ts \
  netlify/functions/_shared/logger.test.ts
docker compose run --rm --no-deps app node scripts/assert-privacy-logs.mjs
docker compose run --rm --no-deps app npm run typecheck
```
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add netlify/functions/_shared/generation-service.ts netlify/functions/_shared/logger.ts \
  scripts/assert-privacy-logs.mjs netlify/functions/_shared/generation-service.test.ts
git commit -m "feat(functions): 学習ヒントを生成へ配線し結末を記録する

Promise.all の 3 本目として並列に取り、generationContext が揃ってから
安全フィルタと sanitize を通す。preference_snapshot へ書くのは確定
オブジェクトの強度で、切り詰めで空になったらキーごと載せない。

結末は閉じた列挙 1 フィールドとして SafeLogEvent・許可キー一覧・
assert-privacy-logs の 3 箇所へ同時に足す。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: 結果画面の 1 行

**Files:**
- Modify: `shared/contracts/menu-result.ts:50-95`（`MenuResultViewModel`）
- Modify: `src/features/generation/api/menu-result-api.ts:330-405`
- Modify: `src/features/menu-detail/menu-hero.tsx`
- Modify: `src/features/menu-detail/household-menu-detail-body.tsx` と `src/features/menu-detail/idea-menu-detail-body.tsx`（`MenuHero` へ prop を渡す）
- Modify: `src/features/generation/api/menu-result-api.test.ts`
- Modify: `src/features/menu-detail/menu-hero.test.tsx`

**Interfaces:**
- Consumes: Task 2 の `tasteHintsRecordSchema`、Task 6 が書く `preference_snapshot.tasteHints`
- Produces: `MenuResultViewModel.tasteHintsApplied: boolean`、`MenuHeroProps.tasteHintsApplied: boolean`

- [ ] **Step 1: 失敗するテストを書く**

`menu-result-api.test.ts` へ追記:

```ts
it("projects tasteHintsApplied only for medium or stronger records", () => {
  expect(
    toMenuResultViewModel(makeRow({ preference_snapshot: { tasteHints: { applied: true, strength: "medium" } } })),
  ).toMatchObject({ tasteHintsApplied: true });
  expect(
    toMenuResultViewModel(makeRow({ preference_snapshot: { tasteHints: { applied: true, strength: "weak" } } })),
  ).toMatchObject({ tasteHintsApplied: false });
});

it("falls back to false for missing or broken records", () => {
  expect(toMenuResultViewModel(makeRow({ preference_snapshot: {} }))).toMatchObject({ tasteHintsApplied: false });
  expect(
    toMenuResultViewModel(makeRow({ preference_snapshot: { tasteHints: { applied: "yes" } } })),
  ).toMatchObject({ tasteHintsApplied: false });
});
```

`menu-hero.test.tsx` へ追記:

```tsx
it("shows the taste line alongside the model label without replacing it", () => {
  render(
    <MenuHero
      totalElapsedMinutes={30}
      servings={2}
      generationModelId="inception/mercury-2"
      tasteHintsApplied
    />,
  );
  expect(screen.getByText(/作成モデル/u)).toBeInTheDocument();
  expect(screen.getByText("✨ いつもの好みを反映しました")).toBeInTheDocument();
});

it("omits the taste line when not applied", () => {
  render(<MenuHero totalElapsedMinutes={30} servings={2} generationModelId={null} tasteHintsApplied={false} />);
  expect(screen.queryByText(/いつもの好み/u)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 落ちることを確認する**

Run:
```bash
docker compose run --rm --no-deps app npx vitest run \
  src/features/generation/api/menu-result-api.test.ts src/features/menu-detail/menu-hero.test.tsx
```
Expected: FAIL

- [ ] **Step 3: 投影を足す**

`shared/contracts/menu-result.ts` の `MenuResultViewModel` へ:

```ts
/**
 * preference_snapshot.tasteHints を tasteHintsRecordSchema で再検証した結果。
 * strength が weak のときは false（履歴の浅い利用者に「いつもの好み」と言わない）。
 * 欠落・壊れた形も false（安全側）。
 */
tasteHintsApplied: boolean;
```

`menu-result-api.ts` の組み立て箇所で:

```ts
const tasteCandidate = (data.preference_snapshot as { tasteHints?: unknown } | null)?.tasteHints;
const tasteParsed = tasteHintsRecordSchema.safeParse(tasteCandidate);
const tasteHintsApplied = tasteParsed.success && tasteParsed.data.strength !== "weak";
```

- [ ] **Step 4: 1 行を描く**

`menu-hero.tsx` を fragment 返しに変える（`PageHeader` の `note` は作成モデルが使っており、置き換えない）:

```tsx
export type MenuHeroProps = {
  totalElapsedMinutes: number;
  servings: number;
  generationModelId: string | null;
  /** 学習ヒントを実際に載せて生成した献立にだけ true */
  tasteHintsApplied: boolean;
};

export function MenuHero({
  totalElapsedMinutes,
  servings,
  generationModelId,
  tasteHintsApplied,
}: MenuHeroProps) {
  const modelLabel =
    generationModelId !== null ? formatGenerationModelLabel(generationModelId) : "";
  const note = modelLabel !== "" ? `作成モデル: ${modelLabel}` : undefined;

  return (
    <>
      <PageHeader
        title="献立ができました"
        lead={`食卓まで約${String(totalElapsedMinutes)}分・${String(servings)}人分`}
        {...(note !== undefined ? { note } : {})}
      />
      {tasteHintsApplied ? (
        <p className="type-small text-ink/80">✨ いつもの好みを反映しました</p>
      ) : null}
    </>
  );
}
```

`household-menu-detail-body.tsx` と `idea-menu-detail-body.tsx` の `MenuHero` 呼び出しへ `tasteHintsApplied={result.tasteHintsApplied}` を渡す。

- [ ] **Step 5: 通ることを確認する**

Run:
```bash
docker compose run --rm --no-deps app npx vitest run \
  src/features/generation src/features/menu-detail src/features/history shared/contracts
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run format:check > /tmp/fmt.log 2>&1; \
  grep -n "Code style issues" /tmp/fmt.log || tail -n 3 /tmp/fmt.log
```
Expected: PASS

- [ ] **Step 6: 全体検証**

Run:
```bash
docker compose run --rm --no-deps app npm run lint > /tmp/lint.log 2>&1; \
  grep -nE "error" /tmp/lint.log | head -20 || tail -n 5 /tmp/lint.log
docker compose run --rm --no-deps app npx vitest run > /tmp/vitest.log 2>&1; \
  grep -nE "FAIL|failed" /tmp/vitest.log | head -20 || tail -n 15 /tmp/vitest.log
docker compose --profile test run --rm db-test > /tmp/dbtest.log 2>&1; \
  grep -nE "not ok|Failed" /tmp/dbtest.log | head -20 || tail -n 10 /tmp/dbtest.log
```
E2E（`./scripts/run-e2e.sh`）は出力が大きいため、人間の端末で実行して要約を貼ってもらう。

- [ ] **Step 7: コミット**

```bash
git add shared/contracts/menu-result.ts src/features/generation/api/menu-result-api.ts \
  src/features/generation/api/menu-result-api.test.ts \
  src/features/menu-detail/menu-hero.tsx src/features/menu-detail/menu-hero.test.tsx \
  src/features/menu-detail/household-menu-detail-body.tsx \
  src/features/menu-detail/idea-menu-detail-body.tsx
git commit -m "feat(menu): 好みを反映した献立に 1 行を出す

preference_snapshot.tasteHints を再検証して投影する。weak では出さず、
欠落や壊れた形は false に倒す。PageHeader の note は作成モデルが使って
いるため置き換えず、独立した行として描く。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 自己レビュー結果

**仕様の網羅**

| 仕様 | 対応 Task |
| --- | --- |
| §3.1 契約 | Task 2 |
| §3.2 preference_snapshot 記録 | Task 6（書き）・Task 7（読み） |
| §3.3 列と更新関数 | Task 1 |
| §3.4 db:types / SQL 定数 | Task 1 Step 7 / Task 1 Step 5 |
| §4.1–4.5 集計 | Task 1 |
| §5.1 ローダ | Task 3 |
| §5.2 安全フィルタと idea の avoidAxes | Task 3 |
| §5.3 sanitize と対応表の破棄 | Task 3 |
| §5.4 段落と優先順位 | Task 5 |
| §5.5 配線 | Task 6 |
| §5.6 記録の確定タイミング | Task 6 |
| §5.7 観測性 3 箇所 | Task 6 |
| §6.1 トグルと告知 | Task 4 |
| §6.2 結果の 1 行 | Task 7 |
| §7 保存と送信 | Task 4（文言）・Task 6（記録） |
| §8 不変条件 1–11 | Task 5・6・7 のテスト |

**残る注意点**

- Task 1 Step 5 の pgTAP seed は `menus` の `parent_menu_id` 自己参照制約に注意する。`change_reason` を持つ行は親行を先に作り、その id を渡す。
- Task 3 の `filterTasteHintsForSafety` は安全ゲートではない。実判定は `validate-generated-menu` と生成ハードゲートのままで、ここを通ったことを「安全」と読まない。
- Task 6 の `makeDeps` / `runNewMenu` は `generation-service.test.ts` の既存ヘルパ名に置き換える。
