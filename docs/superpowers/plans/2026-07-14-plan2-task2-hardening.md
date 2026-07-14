# Plan 2 Task 2 保存境界強化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 2 Task 2の保存境界を、削除後も単調増加するrevision、Zodと一致するDB制約、実効性のあるRLSテスト、nullable RPC型で強化する。

**Architecture:** 未配備の既存migrationを直接修正し、`generation_drafts`はRLSで隠すソフト削除へ変更する。DB生成型は再生成可能な成果物として維持し、Postgres Metaが表現できないnullable RPC引数だけをアプリ所有の型overlayで補正する。

**Tech Stack:** PostgreSQL 17、Supabase/PostgREST、pgTAP、TypeScript 5.9、Vitest、Docker Compose

## Global Constraints

- Node 24を使用する。
- SQL migrationとRLSは本番影響を持つものとして、ローカルDocker stackで検証する。
- `20260711001000_pantry_and_planner_drafts.sql`は破棄可能なローカル環境以外へ未適用なので、追補migrationを作らず直接修正する。
- `database.generated.ts`は手編集せず、`npm run db:types`で再生成する。
- コード内コメントを追加する場合は日本語で背景・意図・制約を書く。
- コミットメッセージは日本語のConventional Commits形式にする。

---

### Task 1: DB保存境界とrevision lifecycleを修正する

**Files:**
- Modify: `supabase/tests/database/03_pantry_and_planner_drafts.test.sql`
- Modify: `supabase/migrations/20260711001000_pantry_and_planner_drafts.sql`
- Regenerate: `src/shared/types/database.generated.ts`

**Interfaces:**
- Consumes: `auth.uid()`、既存`save_generation_draft(bigint,text,text[],text,uuid[],smallint,text,text[],text,jsonb)`。
- Produces: `private.is_valid_draft_text_array(text[],integer,integer)`、`private.is_valid_draft_uuid_array(uuid[],integer)`、`private.soft_delete_generation_draft(uuid,uuid,bigint)`、`public.delete_generation_draft(bigint)`、`generation_drafts.deleted_at`、単調増加revision。

- [ ] **Step 1: 敵対的pgTAPを先に追加する**

`03_pantry_and_planner_drafts.test.sql`を拡張し、`select plan(68);`を使用する。既存24 assertionを維持したうえで、次のassertionを追加・整理する。

```sql
select has_column('public', 'generation_drafts', 'deleted_at');
select has_function('public', 'delete_generation_draft', array['bigint']);

select throws_ok(
  $$insert into public.pantry_items(user_id,name,quantity,unit)
    values ('10000000-0000-0000-0000-000000000001','NaN','NaN'::numeric,'g')$$,
  '23514', null, 'quantity rejects numeric NaN'
);
select throws_ok(
  $$insert into public.pantry_items(user_id,name,quantity,unit)
    values ('10000000-0000-0000-0000-000000000001','上限超過',1000000,'g')$$,
  '23514', null, 'quantity rejects values above the contract maximum'
);
select throws_ok(
  $$insert into public.pantry_items(user_id,name) values
    ('10000000-0000-0000-0000-000000000001',' padded ')$$,
  '23514', null, 'pantry name must be stored canonically'
);
select throws_ok(
  $$insert into public.pantry_items(user_id,name,quantity,unit) values
    ('10000000-0000-0000-0000-000000000001','単位',1,' g ')$$,
  '23514', null, 'pantry unit must be stored canonically'
);
```

owner 2へロールを切り替えて実在するpantry rowとdraftを作り、owner 1へ戻したあと、foreign IDがSELECTで見えず、UPDATE/DELETEが0行であり、postgresへ戻すと行が残ることを`is(...)`で検証する。owner 1自身のUPDATE/DELETE成功も別assertionにする。

RPCについて、次の入力をそれぞれ`23514`として拒否するassertionを追加する。

```sql
array[null::text]
array[['鶏肉']]::text[]
array['   ']::text[]
array[repeat('x',81)]::text[]
array[null::uuid]
array[['20000000-0000-0000-0000-000000000001'::uuid]]
```

上記を`main_ingredients`、`target_member_ids`、`avoid_ingredients`の該当位置へ渡す。NULL/負数expected revisionは`22023 / invalid_draft_save`、stale revisionは従来どおり`P0001 / draft_revision_conflict`とする。

create/update成功時はRPC戻り値と再SELECTの双方について、meal type、全配列、nullable 4項目、memo、pantry JSONが入力と一致することを`is(to_jsonb(...), expected_jsonb, ...)`で検証する。8/9 main ingredients、20/21 target members、20/21 avoid ingredients、200/201文字memo、50/51 pantry selectionsの境界をassertionにする。

削除lifecycleは次の順序を固定する。

```sql
select is(public.delete_generation_draft(2), 3::bigint,
  'delete increments the authoritative revision');
select is((select count(*)::integer from public.generation_drafts), 0,
  'soft-deleted draft is hidden from its owner');
select throws_ok(
  $$select public.delete_generation_draft(2)$$,
  'P0001', 'draft_revision_conflict', 'stale delete is rejected'
);
select is(
  (public.save_generation_draft(0,'dinner',array['再作成'],'japanese',array[]::uuid[],
    30::smallint,'standard',array[]::text[],'','[]'::jsonb)).revision,
  4::bigint,
  'recreation continues the deleted revision'
);
select throws_ok(
  $$select public.save_generation_draft(2,'dinner',array['古い画面'],'japanese',
    array[]::uuid[],30::smallint,'standard',array[]::text[],'','[]'::jsonb)$$,
  'P0001', 'draft_revision_conflict', 'pre-delete revision cannot overwrite recreation'
);
```

assertion追加後に実数を数え、`plan(68)`と一致させる。assertionをまとめて減らした場合も、テスト対象を削らずplan数だけを実数へ合わせる。

- [ ] **Step 2: REDを確認する**

Run:

```bash
npm run db:reset
npm run db:test -- supabase/tests/database/03_pantry_and_planner_drafts.test.sql
```

Expected: `deleted_at`/`delete_generation_draft`不在、およびNaN・不正配列・ABA反例の少なくとも一つを理由としてFAILする。構文エラーやplan件数不一致だけの失敗はREDとして受け入れない。

- [ ] **Step 3: migrationを最小修正する**

`pantry_items`のCHECKを次へ変更する。

```sql
name text not null check (
  name = btrim(name) and char_length(name) between 1 and 80
),
quantity numeric(12,3) check (quantity > 0 and quantity <= 999999),
unit text check (
  unit = btrim(unit) and char_length(unit) between 1 and 24
),
```

JSON validatorの後に次のprivate validatorを追加し、PUBLIC/anon/authenticatedから実行権限を剥奪する。

```sql
create or replace function private.is_valid_draft_text_array(
  p_value text[], p_max_count integer, p_max_length integer
) returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select p_value is not null
    and cardinality(p_value) <= p_max_count
    and (cardinality(p_value) = 0 or array_ndims(p_value) = 1)
    and not exists (
      select 1
      from unnest(p_value) as values_(value)
      where value is null
        or value <> btrim(value)
        or char_length(value) not between 1 and p_max_length
    );
$function$;

create or replace function private.is_valid_draft_uuid_array(
  p_value uuid[], p_max_count integer
) returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select p_value is not null
    and cardinality(p_value) <= p_max_count
    and (cardinality(p_value) = 0 or array_ndims(p_value) = 1)
    and not exists (
      select 1
      from unnest(p_value) as values_(value)
      where value is null
    );
$function$;
```

`generation_drafts`へ`deleted_at timestamptz`を追加し、cardinalityだけの3 CHECKを次へ置き換える。

```sql
check (private.is_valid_draft_text_array(main_ingredients, 8, 80)),
check (private.is_valid_draft_uuid_array(target_member_ids, 20)),
check (private.is_valid_draft_text_array(avoid_ingredients, 20, 80)),
```

authenticatedのdraft権限は`select`だけにし、SELECT policyへ`deleted_at is null`を加える。owner DELETE policyは作成しない。

private helperは有効行だけを更新し、expected revisionがNULLなら内部finalizer用の無条件削除、非NULLなら一致を要求する。

```sql
create or replace function private.soft_delete_generation_draft(
  p_user_id uuid, p_draft_id uuid, p_expected_revision bigint
) returns public.generation_drafts
language plpgsql
set search_path = ''
as $function$
declare
  v_deleted public.generation_drafts;
begin
  update public.generation_drafts
  set deleted_at = statement_timestamp(), revision = revision + 1
  where user_id = p_user_id
    and deleted_at is null
    and (p_draft_id is null or id = p_draft_id)
    and (p_expected_revision is null or revision = p_expected_revision)
  returning * into v_deleted;
  if not found then
    raise exception using errcode = 'P0001', message = 'draft_revision_conflict';
  end if;
  return v_deleted;
end;
$function$;
```

`save_generation_draft`はNULL revision guardを追加し、初回INSERT失敗後に`deleted_at is not null`の同一ユーザー行を`revision = revision + 1, deleted_at = null`で復元する。有効行更新は`deleted_at is null and revision = p_expected_revision`を条件にする。

public削除RPCは次の契約にする。

```sql
create or replace function public.delete_generation_draft(p_expected_revision bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_deleted public.generation_drafts;
begin
  if v_user_id is null or p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'invalid_draft_save';
  end if;
  v_deleted := private.soft_delete_generation_draft(v_user_id, null, p_expected_revision);
  return v_deleted.revision;
end;
$function$;
```

private helperとpublic RPCの権限を明示的にrevokeし、public RPCだけauthenticatedへgrantする。

- [ ] **Step 4: focused GREENを確認する**

Run:

```bash
npm run db:reset
npm run db:test -- supabase/tests/database/03_pantry_and_planner_drafts.test.sql
```

Expected: 全assertionがPASSし、`Result: PASS`。

- [ ] **Step 5: DB型を再生成して検証する**

Run:

```bash
npm run db:types
npm run typecheck
git diff --check
```

Expected: `database.generated.ts`へ`deleted_at`、2つのpublic RPC、private helper/validatorが反映され、typecheckとdiff checkがexit 0。

- [ ] **Step 6: コミットする**

```bash
git add supabase/migrations/20260711001000_pantry_and_planner_drafts.sql \
  supabase/tests/database/03_pantry_and_planner_drafts.test.sql \
  src/shared/types/database.generated.ts
git commit -m "fix: 献立下書きの保存境界を強化"
```

---

### Task 2: nullable RPC型overlayを追加する

**Files:**
- Create: `src/shared/types/database.ts`
- Create: `src/shared/types/database.test.ts`
- Modify: `src/shared/lib/supabase.ts`

**Interfaces:**
- Consumes: generated `Database["public"]["Functions"]["save_generation_draft"]`。
- Produces: app-owned `Database`型。nullableになるのは`p_meal_type`、`p_cuisine_genre`、`p_time_limit_minutes`、`p_budget_preference`だけ。

- [ ] **Step 1: nullable incomplete draftの型テストを書く**

```ts
import { expect, expectTypeOf, it } from "vitest";
import type { Database } from "./database";

type SaveDraftArgs =
  Database["public"]["Functions"]["save_generation_draft"]["Args"];

it("未完成下書きのnullable項目をRPC引数として表現できる", () => {
  const args = {
    p_expected_revision: 0,
    p_meal_type: null,
    p_main_ingredients: [],
    p_cuisine_genre: null,
    p_target_member_ids: [],
    p_time_limit_minutes: null,
    p_budget_preference: null,
    p_avoid_ingredients: [],
    p_memo: "",
    p_pantry_selections: [],
  } satisfies SaveDraftArgs;

  expectTypeOf(args).toMatchTypeOf<SaveDraftArgs>();
  expect(args.p_meal_type).toBeNull();
});
```

- [ ] **Step 2: REDを確認する**

Run: `npx vitest run src/shared/types/database.test.ts && npm run typecheck`

Expected: `./database`が存在しないためFAILする。

- [ ] **Step 3: generated型を狭くoverlayする**

`database.ts`を次の構造で作る。

```ts
import type { Database as GeneratedDatabase } from "./database.generated";

type GeneratedPublic = GeneratedDatabase["public"];
type GeneratedFunctions = GeneratedPublic["Functions"];
type GeneratedSaveDraft = GeneratedFunctions["save_generation_draft"];
type GeneratedSaveDraftArgs = GeneratedSaveDraft["Args"];

type NullableDraftArgs =
  | "p_meal_type"
  | "p_cuisine_genre"
  | "p_time_limit_minutes"
  | "p_budget_preference";

type SaveDraftArgs = Omit<GeneratedSaveDraftArgs, NullableDraftArgs> & {
  p_meal_type: GeneratedSaveDraftArgs["p_meal_type"] | null;
  p_cuisine_genre: GeneratedSaveDraftArgs["p_cuisine_genre"] | null;
  p_time_limit_minutes: GeneratedSaveDraftArgs["p_time_limit_minutes"] | null;
  p_budget_preference: GeneratedSaveDraftArgs["p_budget_preference"] | null;
};

export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<GeneratedPublic, "Functions"> & {
    Functions: Omit<GeneratedFunctions, "save_generation_draft"> & {
      save_generation_draft: Omit<GeneratedSaveDraft, "Args"> & {
        Args: SaveDraftArgs;
      };
    };
  };
};
```

`src/shared/lib/supabase.ts`の`Database` importだけを`@/shared/types/database`へ変更する。テーブル用helperを利用する既存ファイルとservice-role clientはgenerated型を継続利用する。

- [ ] **Step 4: GREENを確認する**

Run:

```bash
npx vitest run src/shared/types/database.test.ts
npm run typecheck
npm run lint
```

Expected: 新規テストPASS、typecheck/lint exit 0。既存lint warningは増加しない。

- [ ] **Step 5: コミットする**

```bash
git add src/shared/types/database.ts src/shared/types/database.test.ts \
  src/shared/lib/supabase.ts
git commit -m "fix: 下書きRPCのnullable型を補正"
```

---

### Task 3: 後続計画を安全な削除契約へ同期する

**Files:**
- Modify: `docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md`
- Modify: `docs/superpowers/plans/2026-07-11-kondate-mvp-03-ai-generation-results.md`

**Interfaces:**
- Consumes: Task 1の`delete_generation_draft(expectedRevision)`と`private.soft_delete_generation_draft(userId,draftId,expectedRevision)`。
- Produces: Task 7のrevision-aware `deletePlannerDraft`、Plan 3 finalizerの単調revision維持契約。

- [ ] **Step 1: Plan 2 Task 2の掲載コードを実装と一致させる**

Task 2の掲載pgTAPを実ファイルと同じassertionへ置換し、plan数も実数へ合わせる。掲載migrationには次をすべて明記する。

- canonical `name`/`unit` CHECKと`quantity > 0 and quantity <= 999999`
- `private.is_valid_draft_text_array(text[],integer,integer)`と`private.is_valid_draft_uuid_array(uuid[],integer)`の完全な定義・revoke
- `generation_drafts.deleted_at`
- 3配列に対するprivate validator CHECK
- authenticatedにはdraft SELECTだけをgrantし、SELECT policyは`auth.uid() = user_id and deleted_at is null`
- `private.soft_delete_generation_draft(uuid,uuid,bigint)`の完全な定義・revoke
- NULL/負数guard、deleted row復元、有効行だけのCAS更新を含む`save_generation_draft`
- `delete_generation_draft(bigint) returns bigint`の完全な定義・revoke/grant

Task 2 Step 4の期待値を新しいpgTAP plan数へ更新する。コミット例は`fix: 献立下書きの保存境界を強化`とする。

- [ ] **Step 2: Plan 2 Task 7の削除APIを置換する**

`deletePlannerDraft`を次の契約へ変更する。

```ts
export async function deletePlannerDraft(
  client: BrowserSupabaseClient,
  expectedRevision: number,
): Promise<void> {
  const { error } = await client.rpc("delete_generation_draft", {
    p_expected_revision: expectedRevision,
  });
  if (error?.message.includes("draft_revision_conflict") === true) {
    throw Object.assign(new Error("別の画面で献立条件が更新されました"), {
      code: "draft_revision_conflict" as const,
    });
  }
  if (error !== null) {
    throw new Error("献立条件の下書きを削除できませんでした");
  }
}
```

全callerとテスト記述も現在のdraft revisionを渡すよう更新し、直接`.delete()`する記述を残さない。

- [ ] **Step 3: Plan 3 finalizerの物理DELETEを置換する**

```sql
perform private.soft_delete_generation_draft(
  v_request.user_id,
  v_request.draft_id,
  null
);
```

Plan 3の説明を、成功時点の有効draftをソフト削除しrevisionを増加させる契約へ変更する。予約済みsnapshot、後続autosave許可、idempotent replayの説明は維持する。

- [ ] **Step 4: 文書整合性を検証する**

Run:

```bash
rg -n "generation_drafts.*delete|delete.*generation_drafts|deletePlannerDraft" \
  docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md \
  docs/superpowers/plans/2026-07-11-kondate-mvp-03-ai-generation-results.md
npx prettier --check \
  docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md \
  docs/superpowers/plans/2026-07-11-kondate-mvp-03-ai-generation-results.md
git diff --check
```

Expected: 検索結果にauthenticatedの直接DELETEやfinalizerの物理DELETEがなく、削除はpublic/private helper契約だけを参照する。formatとdiff checkはexit 0。

- [ ] **Step 5: コミットする**

```bash
git add docs/superpowers/plans/2026-07-11-kondate-mvp-02-menu-domain-pantry.md \
  docs/superpowers/plans/2026-07-11-kondate-mvp-03-ai-generation-results.md
git commit -m "docs: 下書き削除契約を単調revisionへ更新"
```

---

### Task 4: 全体検証と敵対的再レビュー

**Files:**
- Verify only: repository-wide relevant files

**Interfaces:**
- Consumes: Tasks 1〜3の全成果物。
- Produces: merge可否を判断できる検証証跡。

- [ ] **Step 1: fresh DBから全検証する**

```bash
npm run db:reset
npm run db:types
npm run db:test
npx vitest run
npm run typecheck
npm run lint
npm run format:check
npm run build
git diff --check
git status --short
```

Expected: 全コマンドexit 0。lintは既存warning以外を増やさない。`npm run db:types`後に意図しないdiffが生じない。

- [ ] **Step 2: 元の反例を再実行する**

rollback transaction内でauthenticated ownerとしてNaN、NULL/多次元/巨大配列、DELETE→再作成→旧revision保存を再実行する。

Expected: NaN/不正配列は`23514`、直接DELETEは`42501`、旧revision保存は`P0001 / draft_revision_conflict`。

- [ ] **Step 3: 独立サブエージェントレビューを実施する**

設計書、当計画、実装前後diff、テストレポートを読み取り専用reviewerへ渡し、spec complianceとcode qualityの両方で承認を得る。Critical/Importantがあれば一括修正し、focused testを再実行して再レビューする。
