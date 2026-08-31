# 献立の「ひねり」軸（noveltyPreference）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 献立生成に任意軸 `noveltyPreference`（`standard` / `twist` / 未指定）を追加し、`twist` のときだけ主菜に「定番回避」の指示と定番料理名の名指し除外リストをプロンプトへ載せる。

**Architecture:** 既存 `ingredientPreference` と同型の任意軸を、契約 → DB → snapshot RPC → Function 読み取り → プロンプト → UI の順に一本通す。プロンプトへの注入は `recentDishHints` と同じく `buildGenerationMessages` の new_menu 分岐で行い、再生成経路と `PromptPreferences` には触れない。安全評価・quota・fingerprint・検証には一切載せない。

**Tech Stack:** TypeScript strict / Zod / Supabase Postgres (plpgsql, pgTAP) / React 19 + React Router 8 Data Mode / Vitest / Playwright

**Spec:** `docs/superpowers/specs/2026-08-31-menu-novelty-axis-design.md`

## Global Constraints

- Node.js `>=24 <25`、ESM、TypeScript `strict: true`。`any` と network/DB 境界の無検査キャストは禁止。
- 利用者向け文言はすべて日本語。コメント・コミットメッセージも日本語。識別子とテスト名は英語。
- モバイル優先 320 CSS px、横スクロールなし、タップ対象 44×44 CSS px。
- 検証コマンドは Docker 経由。`docker compose run --rm --no-deps app npm test -- --run <files>` / `npm run typecheck` / `npm run lint` / `npm run format:check`（`format` ではない）。
- `db:test` と `e2e` はホストで直接実行する。`docker compose --profile test run --rm db-test` / `./scripts/run-e2e.sh`。`app` コンテナには Docker socket が無く、`npm run db:test` は必ず失敗する。
- `src/shared/types/database.generated.ts`、`package-lock.json`、`infra/supabase/**` は生成物。手編集禁止。
- 所有境界: `shared/contracts` はブラウザ + Functions、`netlify/functions` はサーバー専用、`src/features` はブラウザ専用。定番辞書は Functions 専用に置き `shared/` を経由しない。
- `git push`、PR 作成、デプロイは禁止。`--no-verify` 禁止。
- ひねり軸は fingerprint / quota / `validate-generated-menu` / 生成ハードゲートの入力にしない。
- `temperature` は送らない。`openrouter.ts` の送信 body は本計画で一切変更しない。

---

## File Structure

**新規作成**

| ファイル | 責務 |
|---|---|
| `supabase/migrations/20260831120000_novelty_preference.sql` | 2 テーブルの列追加、3 関数の再作成、grant |
| `netlify/functions/_shared/staple-dish-catalog.ts` | 食材 → 定番料理名の静的辞書と照合関数（純データ + 純関数） |
| `netlify/functions/_shared/staple-dish-catalog.test.ts` | 辞書照合のテスト |
| `netlify/functions/_shared/novelty-hints.ts` | kill-switch、マーカー、段落本体、件数上限 |
| `netlify/functions/_shared/generation-prompt-novelty-off.test.ts` | kill-switch off で段落とキーが両方消えること |

**変更**

| ファイル | 変更内容 |
|---|---|
| `shared/contracts/planner.ts` | `noveltyPreferences` 列挙、`draftShape` / `submissionCommonShape` へ追加 |
| `shared/testing/factories.ts` | 契約変更の型波及（Task 1 Step 9b） |
| `netlify/functions/_shared/generation-context.ts` | `snapshotRowSchema` と `mapSnapshot` |
| `supabase/tests/database/03_pantry_and_planner_drafts.test.sql` | `has_function` 型配列と全 positional 呼び出しへ 14 番目の引数 |
| `supabase/tests/database/03a_pantry_and_planner_drafts_hardening.test.sql` | 同上 |
| `supabase/tests/database/ai_control_and_quota.test.sql` | 同上 + snapshot 往復アサート |
| `src/shared/types/database.ts` | overlay `NullableDraftArgs` と `SaveDraftArgs`（Task 1） |
| `src/features/planner/planner-api.ts` | `buildSaveGenerationDraftArgs`（Task 1）、select 列と `mapPlannerDraft`（Task 2） |
| `src/features/planner/use-draft-autosave.ts` | 保存値のコピーと「空下書き」判定 |
| `src/features/planner/planner-route.tsx` | 初期値・hydrate・送信コピー |
| `src/features/planner/model/planner-labels.ts` | 日本語ラベル |
| `src/features/planner/model/draft-from-menu.ts` | 履歴からの条件引き継ぎ |
| `src/features/planner/components/review-step.tsx` | 2 択 UI |
| `netlify/functions/_shared/generation-prompt.ts` | new_menu 分岐での段落挿入とキー注入 |
| `supabase/tests/database/rls_inventory.test.sql` | GRANT 台帳のシグネチャを 14 引数へ |
| `e2e/specs/full-journey.spec.ts` | 確認画面でひねりを選ぶ 1 手 |

---

### Task 1: 契約・migration・サーバー読み取り面

**この Task は単一 commit で閉じる。4 要素を分けてコミットしてはならない。**
`mapSnapshot` は `plannerSubmissionSchema.parse({ ... })` にオブジェクトリテラルを直渡ししており、同 schema は両枝 `.strict()` である。契約より先に `mapSnapshot` を更新すると `unrecognized_keys` で throw し、ひねりを選んでいない利用者を含む new_menu 経路全体が HTTP 422 になる。`parse` の引数は `unknown` なので typecheck は素通りする。逆に migration より先に `mapSnapshot` を更新すると、RPC が返さない列を読むことになる。この 3 つは同時にしか正しくならない。

**Files:**
- Modify: `shared/contracts/planner.ts`
- Modify: `shared/contracts/planner.test.ts`
- Create: `supabase/migrations/20260831120000_novelty_preference.sql`
- Modify: `netlify/functions/_shared/generation-context.ts:63-81`（`snapshotRowSchema`）, `:211-223`（`mapSnapshot`）
- Modify: `netlify/functions/_shared/generation-context.test.ts`
- Modify: `supabase/tests/database/03_pantry_and_planner_drafts.test.sql`
- Modify: `supabase/tests/database/03a_pantry_and_planner_drafts_hardening.test.sql`
- Modify: `supabase/tests/database/ai_control_and_quota.test.sql`
- Modify: `supabase/tests/database/rls_inventory.test.sql`
- Modify: `src/shared/types/database.ts`（overlay）, `src/shared/types/database.test.ts`
- Modify: `src/features/planner/planner-api.ts`（`buildSaveGenerationDraftArgs` のみ）
- Modify: `shared/testing/factories.ts`, `src/features/planner/use-draft-autosave.ts`, `src/features/planner/planner-route.tsx`（Step 9b の型波及。値の写経を含む）
- Regenerate: `src/shared/types/database.generated.ts`

**Interfaces:**
- Produces: `noveltyPreferences: readonly ["standard", "twist"]`、`type NoveltyPreference = "standard" | "twist"`、`PlannerDraftInput["noveltyPreference"]: NoveltyPreference | null`、`PlannerSubmission["noveltyPreference"]: NoveltyPreference | null`（両枝）
- Produces: RPC `public.save_generation_draft` は 14 引数、14 番目が `p_novelty_preference text`
- Produces: RPC `public.get_ai_generation_submission_snapshot` の返り値に `novelty_preference text`

- [ ] **Step 1: 契約の failing test を書く**

`shared/contracts/planner.test.ts` へ追記する。

```ts
describe("noveltyPreference", () => {
  it("accepts standard, twist and null on draft and submission", () => {
    for (const noveltyPreference of ["standard", "twist", null] as const) {
      expect(
        plannerDraftInputSchema.parse({ ...incompleteDraft, noveltyPreference }),
      ).toMatchObject({ noveltyPreference });
    }
  });

  it("rejects an unknown novelty value", () => {
    expect(() =>
      plannerDraftInputSchema.parse({ ...incompleteDraft, noveltyPreference: "wild" }),
    ).toThrow();
  });

  it("defaults a missing noveltyPreference to null on draft and submission", () => {
    const { noveltyPreference: _draftOmitted, ...draftWithout } = {
      ...incompleteDraft,
      noveltyPreference: null,
    };
    expect(plannerDraftInputSchema.parse(draftWithout)).toMatchObject({
      noveltyPreference: null,
    });
  });
});
```

`incompleteDraft` は同ファイルの既存フィクスチャ。同ファイルの `ingredientPreference` テスト群（21-91 行目付近）が形の手本なので、submission 側のケースもそこの書き方に合わせて 1 件足す。

**このステップで `incompleteDraft` 自身へ `noveltyPreference: null,` を足しておく。** フィクスチャが `PlannerDraftInput` として型付けされている場合、`z.infer` の出力型ではキーが必須になるため、Step 3 で契約を変えた瞬間にこのフィクスチャが型エラーになる。Step 4 の「契約テスト PASS」を成立させるには、フィクスチャの更新がそこより前にある必要がある。

- [ ] **Step 2: テストが落ちることを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run shared/contracts/planner.test.ts
```

期待: `noveltyPreference` を渡した parse が `unrecognized_keys` で FAIL。

- [ ] **Step 3: 契約を実装**

`shared/contracts/planner.ts`、`ingredientPreferences` の直後へ:

```ts
/**
 * 献立のひねり。standard=いつもの / twist=ひねりたい。
 * null は未指定で、挙動は standard と同一（プロンプト段落なし）。
 * null を残すのは導入前 snapshot の互換読み込みのためだけ。
 */
export const noveltyPreferences = ["standard", "twist"] as const;
```

`draftShape` と `submissionCommonShape` の両方、`ingredientPreference` の直後へ:

```ts
  // default(null): 導入前の preference_snapshot / 下書き JSON にキーが無くても
  // 再生成・条件引き継ぎが 422 にならないよう欠損を未指定として読む。
  noveltyPreference: z.enum(noveltyPreferences).nullable().default(null),
```

ファイル末尾の型 export 群へ:

```ts
export type NoveltyPreference = (typeof noveltyPreferences)[number];
```

- [ ] **Step 4: 契約テストが通ることを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run shared/contracts/planner.test.ts
```

期待: PASS。

- [ ] **Step 5: migration を書く**

`supabase/migrations/20260831120000_novelty_preference.sql` を新規作成する。

**正本の取り違えに注意する。** 写す前に各関数の最新定義を確定すること:

```bash
grep -rn "create or replace function public.save_generation_draft" supabase/migrations/
grep -rn "create or replace function public.reserve_ai_generation" supabase/migrations/
grep -rn "create or replace function public.get_ai_generation_submission_snapshot" supabase/migrations/
```

確定済みの正本（2026-08-31 時点）:
- `save_generation_draft` → `20260730120000_ingredient_preference.sql:23`（13 引数）
- `reserve_ai_generation` → `20260808120000_quality_monthly_retry_and_usage_stale_cleanup.sql:25`
- `get_ai_generation_submission_snapshot` → `20260730120000_ingredient_preference.sql:605`

migration の中身:

```sql
-- novelty_preference: 献立のひねり（standard=いつもの / twist=ひねりたい）
-- 後方互換は不要。列追加後、下書き保存・予約・snapshot 取得の 3 関数を再作成する。

alter table public.generation_drafts
  add column novelty_preference text
  check (
    novelty_preference is null
    or novelty_preference in ('standard', 'twist')
  );

alter table private.generation_draft_submission_versions
  add column novelty_preference text
  check (
    novelty_preference is null
    or novelty_preference in ('standard', 'twist')
  );

-- save_generation_draft: 現行は 13 引数。12 引数の DROP を書くと 13 引数版が残り
-- 14 引数版と overload 曖昧になって下書き保存が全面的に失敗する。
drop function if exists public.save_generation_draft(
  bigint, text, text[], text, text, uuid[], smallint, smallint, text, text, text[], text, jsonb
);
```

続けて `20260730120000` の `save_generation_draft` 本体を写し、次の 3 点だけを変える。

1. 引数リスト末尾へ `p_novelty_preference text` を追加（14 番目）
2. `p_ingredient_preference` の検証句の直後へ:

```sql
  if p_novelty_preference is not null
     and p_novelty_preference not in ('standard', 'twist') then
    raise exception using errcode = '22023', message = 'invalid_draft_save';
  end if;
```

3. INSERT の列リスト・VALUES と、2 箇所の UPDATE 代入へ `novelty_preference` / `p_novelty_preference` を追加（`ingredient_preference` が出てくる箇所すべて。元ファイルの 64・69・82・108 行目に相当）

次に `reserve_ai_generation` を `20260808120000` の本体から写し、`private.generation_draft_submission_versions` への INSERT へ `novelty_preference` と `v_draft.novelty_preference` を加える（`20260730120000` の 261・266 行目に相当する位置）。**snapshot へ写すのはこの INSERT であって `save_generation_draft` ではない。** ここを落とすと下書きには値が入るのに生成が読む snapshot は常に `null` になり、機能が一切効かない。

次に snapshot 取得関数:

```sql
drop function if exists public.get_ai_generation_submission_snapshot(uuid, uuid);
```

DROP の引数は `(uuid, uuid)` で固定。この関数の引数は `p_request_id uuid, p_user_id uuid` の 2 つのままで、返り値だけが増える。`20260730120000:605` の本体を写し、`returns table (...)` へ `novelty_preference text` を、select 句へ `snapshot.novelty_preference` を、それぞれ `ingredient_preference` の直後に追加する。

最後に、再作成した 3 関数へ `revoke all` / `grant execute` を貼り直す。**Postgres の GRANT は引数リストで関数を同定するため、`save_generation_draft` の revoke/grant は 14 引数で書く。** 元ファイルの 13 引数のまま貼ると、存在しない関数への GRANT で migrate が止まる。

```sql
revoke all on function public.save_generation_draft(
  bigint, text, text[], text, text, uuid[], smallint, smallint,
  text, text, text[], text, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.save_generation_draft(
  bigint, text, text[], text, text, uuid[], smallint, smallint,
  text, text, text[], text, jsonb, text
) to authenticated;
```

ロール一覧は `20260730120000_ingredient_preference.sql:120-125` と同一である（`authenticated` を含めて revoke してから `authenticated` へ grant し直す。この順序を崩さない）。`reserve_ai_generation` と `get_ai_generation_submission_snapshot` は引数が変わらないので、元ファイルの revoke/grant をそのまま写す。

- [ ] **Step 6: 既存 pgTAP の 13 引数依存をすべて 14 引数へ更新**

`save_generation_draft` は pgTAP から **positional 呼び出し・型配列・シグネチャ文字列** の 3 通りで参照されている。どれか 1 つでも 13 引数のまま残すと db-test が止まる。次のコマンドで漏れを洗い出す。

```bash
grep -rn "save_generation_draft" supabase/tests/database/
```

更新する箇所は 4 種類ある。

**(a) positional 呼び出し（3 ファイル）** — `03_pantry_and_planner_drafts.test.sql`、`03a_pantry_and_planner_drafts_hardening.test.sql`、`ai_control_and_quota.test.sql`。末尾の `jsonb` 引数の**後ろ**へ `,null` を足す。例（`03_pantry_and_planner_drafts.test.sql:65`）:

```sql
select public.save_generation_draft(0,'dinner',array['鶏肉'],'japanese',null,array[]::uuid[],null::smallint,
  30::smallint,'standard',null,array[]::text[],'',
  '[{"pantryItemId":"20000000-0000-0000-0000-000000000001","priority":"must_use"}]'::jsonb,null);
```

**(b) `has_function` の型配列**（`03_pantry_and_planner_drafts.test.sql:42`）:

```sql
select has_function('public','save_generation_draft',
  array['bigint','text','text[]','text','text','uuid[]','smallint','smallint','text','text','text[]','text','jsonb','text']);
```

**(c) `03a_pantry_and_planner_drafts_hardening.test.sql:86-88` の `to_regprocedure`** — 3 行とも 13 引数の識別子が埋め込まれている。`jsonb` の後ろへ `,text` を足す。

```sql
  coalesce(has_function_privilege('authenticated', to_regprocedure('public.save_generation_draft(bigint,text,text[],text,text,uuid[],smallint,smallint,text,text,text[],text,jsonb,text)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('anon', to_regprocedure('public.save_generation_draft(bigint,text,text[],text,text,uuid[],smallint,smallint,text,text,text[],text,jsonb,text)'), 'EXECUTE'), false)
  and not coalesce(has_function_privilege('service_role', to_regprocedure('public.save_generation_draft(bigint,text,text[],text,text,uuid[],smallint,smallint,text,text,text[],text,jsonb,text)'), 'EXECUTE'), false),
```

`to_regprocedure` は存在しない関数へ `null` を返し、`has_function_privilege(null)` も `null` になるため、更新を忘れると「権限が無い」ではなく静かに false 側へ倒れる。

**(d) `rls_inventory.test.sql:284` の GRANT 台帳** — 引数名付きのシグネチャ文字列で列挙されている。`p_pantry_selections jsonb` の後ろへ `, p_novelty_preference text` を足す。

```sql
  ('public.save_generation_draft(p_expected_revision bigint, p_meal_type text, p_main_ingredients text[], p_cuisine_genre text, p_target_mode text, p_target_member_ids uuid[], p_servings smallint, p_time_limit_minutes smallint, p_budget_preference text, p_ingredient_preference text, p_avoid_ingredients text[], p_memo text, p_pantry_selections jsonb, p_novelty_preference text)', 'authenticated', 'EXECUTE'),
```

この台帳は「認可された GRANT の全集合」であり、実 GRANT との差分を検出する。放置すると 14 引数版が台帳外の GRANT として db-test を落とす。

- [ ] **Step 7: 新しい pgTAP アサートを足す**

**貼る前に、その時点の `revision` と `plan()` 方式を必ず確認すること。** 下のコードは live の現状（`03_pantry` は 194 行目の `finish()` 直前で revision 4、`ai_control_and_quota` は `no_plan()`）に合わせてある。

**(a) `03_pantry_and_planner_drafts.test.sql`** — 162 行目の idea 保存が成功して revision は 4 になっている。したがって新しい保存は `p_expected_revision = 4` から始める。194 行目の `select * from finish();` の直前へ:

```sql
select public.save_generation_draft(4,'dinner',array['豚肉'],'japanese','idea',
  array[]::uuid[],2::smallint,30::smallint,'standard',null,array[]::text[],'', '[]'::jsonb,'twist');
select is((select novelty_preference from public.generation_drafts), 'twist',
  'save persists novelty preference');

select throws_ok(
  $$select public.save_generation_draft(5,'dinner',array['豚肉'],'japanese','idea',
    array[]::uuid[],2::smallint,30::smallint,'standard',null,array[]::text[],'', '[]'::jsonb,'wild')$$,
  '22023', 'invalid_draft_save', 'save rejects an unknown novelty value');

-- P-03: has_function(14 型) は 13 引数版の残留を検出しない。overload 数を直接数える
select is(
  (select count(*)::integer
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'save_generation_draft'),
  1, 'save_generation_draft has exactly one overload');
```

targetMode / servings は 162 行目の idea 保存と同じ形へ揃えてある。これは `refineTargetAndServings` 相当の DB CHECK（household は member 非空、idea は servings 必須）を満たすためで、`null` モードへ戻すと別の CHECK に当たる可能性がある。162 行目の実引数を読んで合わせること。

**(b)** 上の 3 件に加えて、同ファイルの既存の `has_column` 群の並びへ 1 件足す。したがって `plan(43)` は最終的に **`plan(47)`** になる（新規 4 件）。

```sql
select has_column('private','generation_draft_submission_versions','novelty_preference',
  'submission snapshot stores novelty preference');
```

**(c) `ai_control_and_quota.test.sql`** — このファイルは `no_plan()`（3 行目）なので **`plan()` の数を触らない**。

**既存シナリオへ assert を足してはならない。** 1158 行目付近の `selected_only` 往復は JWT を張らず `revision` 1 固定で回っており、そこへ保存を差し込むと save 自体が落ちるか、後続が `draft_revision_conflict` になる。1990 行目付近（canonical success）と 3185 行目付近（idea finalize）が採っている **自己完結 DO ブロック**の形に倣い、専用 owner・専用 UUID 帯で 1 本足す。3185 行目の `do $idea_finalize$` ブロックが最も近い手本である。

3185 行目のブロックの後ろへ:

```sql
-- ひねり軸: reserve が submission snapshot へ novelty_preference を写すことの往復
do $novelty_snapshot$
declare
  -- live 未使用の専用 UUID 帯（f5/f6/f7/f8 は使用済み）
  v_owner constant uuid := '10000000-0000-4000-8000-0000000000f9';
  v_idempotency constant uuid := '30000000-0000-4000-8000-0000000000f9';
  v_draft public.generation_drafts;
begin
  insert into auth.users(
    id,instance_id,aud,role,email,encrypted_password,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  ) values(
    v_owner,'00000000-0000-0000-0000-000000000000','authenticated',
    'authenticated','novelty-snapshot@example.invalid','','{}','{}',now(),now()
  );
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  -- idea モードで 14 引数保存。expected_revision は新規 owner なので 0
  v_draft := public.save_generation_draft(0::bigint,'dinner',array['豚肉'],'japanese',
    'idea',array[]::uuid[],2::smallint,30::smallint,'standard',null,
    array[]::text[],'','[]'::jsonb,'twist');

  perform public.reserve_ai_generation(v_owner,v_idempotency,
    'new_menu',v_draft.id,v_draft.revision,null,null,null,
    'generation-command.v3',repeat('f',64), jsonb_build_object(
      'kind', 'new_menu',
      'target_mode', 'idea',
      'servings', to_jsonb(v_draft.servings),
      'target_member_ids', '[]'::jsonb,
      'source_menu_version', null
    ), tests.quota_identity_key(v_owner), 3, 6, 4, 20, false, false, 180,
    '2026-07-11 00:00:10+00');
end
$novelty_snapshot$;

select is(
  (select snapshot.novelty_preference
     from private.ai_generation_requests request
     cross join lateral public.get_ai_generation_submission_snapshot(
       request.id, request.user_id) snapshot
    where request.idempotency_key = '30000000-0000-4000-8000-0000000000f9'),
  'twist',
  'reserve copies novelty preference into the submission snapshot');
```

`reserve_ai_generation` の引数列は 1997 行目付近の既存呼び出しから写してある。**貼る前にその行を読み、引数の数と順序が今も一致することを確かめること**（quota 系の引数が多く、1 つずれると別の失敗になる）。`tests.quota_identity_key` も同ファイルの既存呼び出しが使っているヘルパーである。

UUID 帯 `...f9` は live で未使用である。`...f5` / `...f6` / `...f7` / `...f8` は既存 fixture が占有しており、とくに `...f7` は `do $pantry_recheck$` が owner を 3663 行目、idempotency を 3756 行目で使っている。ここへ重ねると `auth.users` の主キーか `(user_id, idempotency_key)` の一意制約で Step 8 が止まる。

`repeat('f',64)` は一意制約を持たない列なので、他ブロックと同じ値でも衝突しない。

貼る位置は `do $idea_finalize$` ブロックの**終端の後ろ**である。3185 行目はブロックの開始行なので、対応する `$idea_finalize$;` を探してその後ろへ置くこと。

- [ ] **Step 8: migration を適用して pgTAP を走らせる**

ホストで直接実行する（`app` コンテナからは Docker daemon に届かない）。

```bash
docker compose run --rm migrate
docker compose --profile test run --rm db-test
```

期待: 全 PASS。失敗したら overload 曖昧（`function is not unique`）を最初に疑い、13 引数版が残っていないか `\df public.save_generation_draft` 相当で確かめる。

- [ ] **Step 9: 型を再生成**

```bash
docker compose run --rm app npm run db:types
```

`--no-deps` を付けない。この script（`scripts/generate-database-types.sh`）は起動中の Postgres へ接続するため、先に `docker compose up -d --wait` でスタックが上がっていること。`src/shared/types/database.generated.ts` は手編集しない。

```bash
grep -n "novelty_preference" src/shared/types/database.generated.ts
```

期待: `p_novelty_preference` と `novelty_preference` が現れる。

- [ ] **Step 9a: 型 overlay と RPC 送信引数を配線**

**overlay は Task 2 ではなくこの Task に属し、しかも型波及の掃除（Step 9b）より前に来る。** 型再生成後の `SaveDraftArgs` は `p_novelty_preference: string`（非 null 必須）になるため、`buildSaveGenerationDraftArgs` の戻り値と `database.test.ts` の `satisfies SaveDraftArgs` が赤くなる。これは `noveltyPreference: null` を足しても直らない。したがって **overlay を先に入れないと、Step 9b の「typecheck 全 PASS」ゲートは到達不能**である。

`src/shared/types/database.ts`、`NullableDraftArgs` の union へ:

```ts
  | "p_novelty_preference";
```

同ファイルの `SaveDraftArgs` の交差型へ:

```ts
  p_novelty_preference: GeneratedSaveDraftArgs["p_novelty_preference"] | null;
```

`src/features/planner/planner-api.ts` の `buildSaveGenerationDraftArgs`、`p_ingredient_preference` の直後へ:

```ts
    p_novelty_preference: input.noveltyPreference,
```

`src/shared/types/database.test.ts` の 2 つのフィクスチャ（129 行目・159 行目付近の `p_ingredient_preference: null` を持つオブジェクト）へ `p_novelty_preference: null,` を、177 行目付近の nullable キー union のテストへ `| "p_novelty_preference"` を足す。

**この overlay が要る理由**: Postgres Meta は nullable 引数を非 null な `string` として生成する。overlay が無いと「未選択」を型として送れない。

このステップの時点では typecheck はまだ赤くてよい（Step 9b の対象が残っている）。

- [ ] **Step 9b: 契約変更の型波及をリポジトリ全体で潰す**

**`.default(null)` は入力を任意にするだけで、`z.infer` が出す出力型ではキーは必須である。** つまり `PlannerDraftInput` / `PlannerSubmission` として型付けされたオブジェクトリテラルはすべて `noveltyPreference` を持たなければならず、parse 結果を `toEqual` で比較しているテストはすべて新しいキーの分だけ落ちる。これは Task 2 以降ではなく **この Task の範囲**である。ここで潰さないと Task 1 の commit で main が赤くなる。

```bash
docker compose run --rm --no-deps app npm run typecheck > /tmp/tc.log 2>&1; grep -nE "error" /tmp/tc.log || tail -n 40 /tmp/tc.log
```

**エラー箇所へ機械的に `noveltyPreference: null,` を植えてはならない。** 落ちる箇所は 2 種類あり、扱いが逆である。

**(i) 定数 `null` を書く場所** — フィクスチャ、空の初期値。

- `shared/testing/factories.ts:246`, `:294`（共有ファクトリ。ここを直すと下流の多くが同時に片付く）
- `shared/contracts/planner.test.ts` のフィクスチャ（Step 1 で対応済み）
- `src/features/planner/planner-route.tsx:104` 付近の空下書き初期値
- `netlify/functions/_shared/**` の submission フィクスチャ

**(ii) 値を写す場所（コピー関数）** — ここへ定数 `null` を植えると、hydrate / persist / submit のいずれかが `twist` を静かに潰す。`ingredientPreference` が書かれているのと**同じ形**で値を写すこと。

| 場所 | 書く内容 |
|---|---|
| `src/features/planner/use-draft-autosave.ts:66` 付近 `toDraftInputFields` | `noveltyPreference: value.noveltyPreference,` |
| `src/features/planner/planner-route.tsx:135` 付近 `toPlannerDraftInput` | `noveltyPreference: draft.noveltyPreference,` |
| `src/features/planner/planner-route.tsx:1768` 付近 `submissionCandidate` | `noveltyPreference: value.noveltyPreference,` |

各行の直前に `ingredientPreference` が同じ形で書かれているので、それをそのまま真似れば判別できる。**判断に迷ったら「この関数は値を運んでいるか」を見る。運んでいるなら写す。**

`toEqual` が落ちた箇所は、期待値へ `noveltyPreference: null` を足す。`toMatchObject` へ書き換えて逃げない（部分一致にすると余剰キーの検出力が落ちる）。

**キー名を取り違えない。** ここで足すのは契約側の camelCase（`noveltyPreference`）だが、`planner-api.test.ts:104` の keepalive テストのように **RPC 引数を `toEqual` している箇所は snake_case（`p_novelty_preference: null`）** である。前者は schema parse の出力、後者は `buildSaveGenerationDraftArgs` の出力なので、落ちた `toEqual` がどちらを比べているかを見て書き分けること。

```bash
docker compose run --rm --no-deps app npm run typecheck > /tmp/tc.log 2>&1; grep -nE "error" /tmp/tc.log || tail -n 40 /tmp/tc.log
docker compose run --rm --no-deps app npm test -- --run > /tmp/vitest.log 2>&1; grep -nE "FAIL|✕" /tmp/vitest.log || tail -n 30 /tmp/vitest.log
```

期待: typecheck・全 vitest ともに PASS。**typecheck 全 PASS を要求するのはこの 1 回だけ**である（Step 9a の直後には要求しない）。出力が大きいので上のようにファイルへ落とし、失敗行だけを読むこと。

- [ ] **Step 10: サーバー読み取り面の failing test を書く**

`netlify/functions/_shared/generation-context.test.ts` の `describe("loadGenerationContext", ...)`（198 行目付近）へ追記する。**このテストの入口は `loadGenerationContext` であり、`mapSnapshot` を export してはならない。** 同 describe が既に使っている snapshot 行フィクスチャへ `novelty_preference` を足し、返る `submission` を見る。

```ts
it("maps every novelty preference value from the snapshot row", async () => {
  for (const value of ["standard", "twist", null] as const) {
    const context = await loadGenerationContextWithSnapshot({ novelty_preference: value });
    expect(context.submission.noveltyPreference).toBe(value);
  }
});
```

`loadGenerationContextWithSnapshot` は同 describe 内の既存ヘルパー名へ読み替えること。ヘルパーが無ければ、既存の最初のテストが snapshot 行を組み立てている箇所をそのまま真似て 3 回呼ぶ。

**このテストが要る理由**: `snapshotRowSchema` の単体テストではこの不具合を検知できない。落ちるのは後段の `plannerSubmissionSchema.parse` であり、そこは両枝 `.strict()` である。

- [ ] **Step 11: テストが落ちることを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/generation-context.test.ts
```

期待: `novelty_preference` が `snapshotRowSchema.strict()` に弾かれて FAIL。

- [ ] **Step 12: サーバー読み取り面を実装**

`netlify/functions/_shared/generation-context.ts`、`snapshotRowSchema` の `ingredient_preference` の直後へ:

```ts
    novelty_preference: z.enum(["standard", "twist"]).nullable(),
```

`mapSnapshot` の `ingredientPreference` の直後へ:

```ts
    noveltyPreference: row.novelty_preference,
```

- [ ] **Step 13: テストが通ることを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/generation-context.test.ts shared/contracts/planner.test.ts
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

期待: すべて PASS。**typecheck が赤いまま次へ進まない。** Step 9a と 9b で全体を緑にしてあるので、ここで落ちるなら Step 12 の変更が原因である。9b の (ii) の判別（定数 null か値の写経か）を誤っていないかも併せて見直すこと。

- [ ] **Step 14: コミット（単一 commit）**

Step 9a と Step 9b が触ったパスを漏れなく含める。`git status --short` で未追加が無いことを確認してからコミットすること（Step 9b の波及先はリポジトリ全体に散るため、`git add` の列挙だけに頼らない）。

```bash
git status --short
git add shared/contracts/planner.ts shared/contracts/planner.test.ts \
  shared/testing/factories.ts \
  src/features/planner/planner-route.tsx \
  src/features/planner/use-draft-autosave.ts \
  supabase/migrations/20260831120000_novelty_preference.sql \
  supabase/tests/database/ \
  netlify/functions/ \
  src/shared/types/database.generated.ts \
  src/shared/types/database.ts \
  src/shared/types/database.test.ts \
  src/features/planner/planner-api.ts \
  src/features/planner/planner-api.test.ts
git status --short
git commit -m "feat(generation): 献立のひねり軸を契約と snapshot 経路へ通す

契約・列追加・3 関数の再作成・snapshot 読み取りは同時にしか正しくならない。
plannerSubmissionSchema は両枝 strict で mapSnapshot はリテラルを直渡しするため、
分割すると中間 commit で new_menu 全体が 422 になる。"
```

---

### Task 2: クライアント永続面（読み取りと下書き保持）

**overlay と `buildSaveGenerationDraftArgs` は Task 1 Step 9a で済んでいる。** この Task は「保存した値を読み戻して保持し続ける」側だけを扱う。開始時点で typecheck は緑のはずで、緑でないなら Task 1 が未完了である。

**着手前に、対象行に `noveltyPreference` が既にあるかを確認すること。** Task 1 Step 9b が型を通すために同じキーへ触れている。判断は 3 通りある。

| 現状 | すること |
|---|---|
| キーが無い | この Task の指示どおり足す |
| キーがあり、値が `value.noveltyPreference` などの写経 | 何もしない。重ねて足すと TS1117（重複プロパティ）になる |
| キーがあるが、値が定数 `null` | **写経へ置き換える。** Step 9b の (ii) の判別漏れであり、そのまま出荷すると hydrate / persist / submit が `twist` を潰す |

3 行目を見落とすと「キーがあるからスキップ」で wipe がそのまま出荷される。`grep -n "noveltyPreference" src/features/planner/use-draft-autosave.ts src/features/planner/planner-route.tsx` で 3 箇所すべての値を目で確かめること。

この Task の実質的な残作業は **select 列・`mapPlannerDraft`・autosave の空判定**の 3 点である。

**Files:**
- Modify: `src/features/planner/planner-api.ts:25-45`（`mapPlannerDraft`）, `:56`（select 列）
- Modify: `src/features/planner/planner-api.test.ts`
- Modify: `src/features/planner/use-draft-autosave.ts:76`, `:141`
- Modify: `src/features/planner/use-draft-autosave.test.tsx`
- Modify: `src/features/planner/planner-route.tsx:104`, `:145`, `:1776`

**Interfaces:**
- Consumes: Task 1 の `PlannerDraftInput["noveltyPreference"]`、overlay 済み `SaveDraftArgs`、RPC 14 引数
- Produces: `getPlannerDraft` が `noveltyPreference` を返す。ひねりだけを選んだ下書きが保存される。

- [ ] **Step 1: 読み取り側の failing test を書く**

`mapPlannerDraft` へ手組みの行を通すだけでは不十分である。`mapPlannerDraft` は `getPlannerDraft` の select 列文字列とは独立しており、select へ `novelty_preference` を足し忘れても `mapPlannerDraft` の単体テストは通る。そのとき GET はキーを欠いた行を返し、`.default(null)` が保存済みの `twist` を静かに `null` へ潰す。F-02 と同じ壊れ方がテスト緑のまま再発する。

したがって **select 列そのものをロックする**テストを足す。

```ts
it("selects the novelty preference column from generation_drafts", async () => {
  const select = vi.fn().mockReturnValue({
    eq: () => ({ maybeSingle: async () => ({ data: draftRowFixture, error: null }) }),
  });
  const client = makeFromStub({ from: () => ({ select }) });
  await getPlannerDraft(client, userId);
  expect(select).toHaveBeenCalledWith(expect.stringContaining("novelty_preference"));
});

it("returns the novelty preference from a fetched draft row", async () => {
  const client = makeFromStub({
    row: { ...draftRowFixture, novelty_preference: "twist" },
  });
  await expect(getPlannerDraft(client, userId)).resolves.toMatchObject({
    noveltyPreference: "twist",
  });
});
```

**このファイルには再利用できる読み取りスタブが無い。** live の `planner-api.test.ts` にあるのは `clientWithRpc`（22 行目）だけで、`from()` 系のスタブも `getPlannerDraft` の import も存在しない。したがって `from().select().eq().maybeSingle()` のチェーンと行フィクスチャを**このファイルへ最小限に新設する**（`clientWithRpc` の隣に置き、同じ命名・同じ `vi.fn()` の使い方に揃える）。`getPlannerDraft` の import も足すこと。

新設するのは上の 2 本のテストが必要とする分だけでよい。汎用のクライアントモックを作らない。

- [ ] **Step 2: テストが落ちることを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/planner-api.test.ts
```

期待: select 列に `novelty_preference` が無く FAIL。

- [ ] **Step 3: planner-api の読み取りを実装**

`mapPlannerDraft`（`ingredientPreference` の直後）:

```ts
    noveltyPreference: row.novelty_preference,
```

`getPlannerDraft` の select 列文字列（`*` ではなく明示列挙）— `ingredient_preference,` の直後へ `novelty_preference,` を挿入:

```ts
      "id,user_id,meal_type,main_ingredients,cuisine_genre,target_mode,target_member_ids,servings,time_limit_minutes,budget_preference,ingredient_preference,novelty_preference,avoid_ingredients,memo,pantry_selections,revision,created_at,updated_at,deleted_at",
```

- [ ] **Step 4: autosave の failing test を書く**

`src/features/planner/use-draft-autosave.test.tsx` へ、**「ひねりだけを選んだ下書きが保存される」** ケースを足す。他の項目がすべて未入力で `noveltyPreference: "twist"` だけがあるとき、保存が走ることを確かめる。

```ts
it("saves a draft whose only filled field is the novelty preference", async () => {
  // 既存テストの render / act ヘルパーへ合わせて呼ぶ
  // 期待: save が 1 回呼ばれ、p_novelty_preference: "twist" が渡る
});
```

**このテストが要る理由**: `use-draft-autosave.ts:141` の「空下書き」判定に新軸を足し忘れると、ひねりだけを選んだ下書きが空扱いで保存されない。気付きにくい壊れ方をする。

- [ ] **Step 5: テストが落ちることを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/use-draft-autosave.test.tsx
```

期待: FAIL（保存が走らない）。

- [ ] **Step 6: autosave と route を実装**

**空判定だけがこの Task の新規作業である。** 残りは Task 1 Step 9b の結果を検算する。

`use-draft-autosave.ts:141` 付近の空判定の連鎖へ（`fields.ingredientPreference === null &&` の直後）:

```ts
    fields.noveltyPreference === null &&
```

これは Step 9b の型波及では現れない（`&&` の連鎖は型ではなくロジックなので typecheck が要求しない）。**この Task で必ず足す。**

コピー 3 箇所は上の表に従って検算する。値が写経になっていれば触らない。定数 `null` なら次へ置き換える。

```ts
// use-draft-autosave.ts:66 付近 toDraftInputFields
    noveltyPreference: value.noveltyPreference,
// planner-route.tsx:135 付近 toPlannerDraftInput
    noveltyPreference: draft.noveltyPreference,
// planner-route.tsx:1768 付近 submissionCandidate
    noveltyPreference: value.noveltyPreference,
```

`planner-route.tsx:104` 付近の空下書き初期値は定数 `null` が正しい。ここは置き換えない。

- [ ] **Step 7: テストが通ることを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/ src/shared/types/database.test.ts
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

期待: すべて PASS。

- [ ] **Step 8: コミット**

```bash
git add src/features/planner/
git commit -m "feat(planner): ひねり軸を下書きの読み戻しと保持へ通す

select 列・autosave の空判定・route の 3 箇所を明示的に写す。
select 列を落とすと GET がキーを欠き default(null) が値を静かに潰す。"
```

---

### Task 3: 定番辞書

**Files:**
- Create: `netlify/functions/_shared/staple-dish-catalog.ts`
- Create: `netlify/functions/_shared/staple-dish-catalog.test.ts`

**Interfaces:**
- Produces: `type StapleDishEntry = { readonly ingredientAliases: readonly string[]; readonly stapleDishes: readonly string[] }`
- Produces: `STAPLE_DISH_CATALOG: readonly StapleDishEntry[]`
- Produces: `lookupStapleDishes(mainIngredients: readonly string[], max: number): readonly string[]`

- [ ] **Step 1: failing test を書く**

`netlify/functions/_shared/staple-dish-catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { lookupStapleDishes, STAPLE_DISH_CATALOG } from "./staple-dish-catalog.js";

describe("lookupStapleDishes", () => {
  it("returns staple dishes for a known ingredient", () => {
    expect(lookupStapleDishes(["豚肉"], 12)).toContain("豚の生姜焼き");
  });

  it("matches katakana and hiragana spellings of the same alias", () => {
    // normalizeFoodText はカタカナ→ひらがなを畳む
    expect(lookupStapleDishes(["ブタニク"], 12)).toEqual(lookupStapleDishes(["ぶたにく"], 12));
  });

  it("does not fold kanji into kana, so both spellings are listed as aliases", () => {
    // normalizeFoodText は漢字を畳まない。豚肉 と ぶた肉 は alias 列挙でのみ一致する
    expect(lookupStapleDishes(["ぶた肉"], 12)).toContain("豚の生姜焼き");
  });

  it("returns an empty list for an ingredient outside the catalog", () => {
    expect(lookupStapleDishes(["ドラゴンフルーツ"], 12)).toEqual([]);
  });

  it("caps the result at max", () => {
    expect(lookupStapleDishes(["豚肉", "鶏肉", "牛肉", "卵"], 3)).toHaveLength(3);
  });

  it("does not repeat a dish name across ingredients", () => {
    const dishes = lookupStapleDishes(["豚肉", "ぶた肉"], 12);
    expect(new Set(dishes).size).toBe(dishes.length);
  });

  it("lists both kanji and kana aliases for every entry", () => {
    for (const entry of STAPLE_DISH_CATALOG) {
      expect(entry.ingredientAliases.length).toBeGreaterThan(1);
      expect(entry.stapleDishes.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/staple-dish-catalog.test.ts
```

期待: モジュール未作成で FAIL。

- [ ] **Step 3: 辞書と照合を実装**

`netlify/functions/_shared/staple-dish-catalog.ts`:

```ts
/**
 * メイン食材 → その食材で真っ先に思いつく定番料理名。
 * ひねり軸（noveltyPreference=twist）のプロンプト除外リスト専用。
 * Functions 専用に閉じる（ブラウザからは参照しない）。
 * 安全評価・検証・fingerprint の入力にはしない。
 */
import { normalizeFoodText } from "../../../shared/safety-pure/normalize-food-text.js";

export type StapleDishEntry = {
  readonly ingredientAliases: readonly string[];
  readonly stapleDishes: readonly string[];
};

/**
 * normalizeFoodText が畳むのは NFKC・カタカナ→ひらがな・小文字化・区切り除去だけで、
 * 漢字とかなは畳まない（ブタ = ぶた だが 豚肉 ≠ ぶた肉）。
 * したがって漢字・かな・カタカナの揺れは alias に列挙して吸収する。正規化に期待しない。
 */
export const STAPLE_DISH_CATALOG: readonly StapleDishEntry[] = [
  {
    ingredientAliases: ["豚肉", "ぶた肉", "ぶたにく", "豚", "ぶた", "豚こま", "豚バラ"],
    stapleDishes: ["豚の生姜焼き", "豚汁", "とんかつ", "回鍋肉", "豚キムチ"],
  },
  {
    ingredientAliases: ["鶏肉", "とり肉", "とりにく", "鶏", "とり", "鶏むね肉", "鶏もも肉"],
    stapleDishes: ["から揚げ", "鶏の照り焼き", "親子丼", "筑前煮", "チキン南蛮"],
  },
  {
    ingredientAliases: ["牛肉", "ぎゅう肉", "ぎゅうにく", "牛", "うし", "牛こま"],
    stapleDishes: ["肉じゃが", "牛丼", "青椒肉絲", "すき焼き"],
  },
  {
    ingredientAliases: ["ひき肉", "挽き肉", "ひきにく", "合いびき肉", "あいびき肉"],
    stapleDishes: ["ハンバーグ", "麻婆豆腐", "そぼろ丼", "餃子", "ミートソース"],
  },
  {
    ingredientAliases: ["鮭", "さけ", "しゃけ", "サーモン"],
    stapleDishes: ["鮭の塩焼き", "鮭のムニエル", "鮭のホイル焼き"],
  },
  {
    ingredientAliases: ["鯖", "さば"],
    stapleDishes: ["鯖の味噌煮", "鯖の塩焼き"],
  },
  {
    ingredientAliases: ["卵", "たまご", "玉子"],
    stapleDishes: ["卵焼き", "オムライス", "親子丼", "茶碗蒸し"],
  },
  {
    ingredientAliases: ["豆腐", "とうふ"],
    stapleDishes: ["麻婆豆腐", "冷奴", "湯豆腐", "豆腐の味噌汁"],
  },
  {
    ingredientAliases: ["なす", "ナス", "茄子"],
    stapleDishes: ["麻婆茄子", "なすの味噌炒め", "焼きなす"],
  },
  {
    ingredientAliases: ["キャベツ", "きゃべつ"],
    stapleDishes: ["回鍋肉", "野菜炒め", "コールスロー", "お好み焼き"],
  },
  {
    ingredientAliases: ["じゃがいも", "ジャガイモ", "馬鈴薯"],
    stapleDishes: ["肉じゃが", "ポテトサラダ", "粉ふきいも"],
  },
  {
    ingredientAliases: ["大根", "だいこん"],
    stapleDishes: ["ぶり大根", "おでん", "大根の煮物", "大根サラダ"],
  },
  {
    ingredientAliases: ["白菜", "はくさい"],
    stapleDishes: ["白菜と豚肉の重ね煮", "白菜の浅漬け", "八宝菜"],
  },
  {
    ingredientAliases: ["玉ねぎ", "たまねぎ", "タマネギ", "玉葱"],
    stapleDishes: ["オニオンスープ", "肉じゃが", "カレー"],
  },
  {
    ingredientAliases: ["にんじん", "ニンジン", "人参"],
    stapleDishes: ["きんぴら", "にんじんしりしり", "筑前煮"],
  },
  {
    ingredientAliases: ["ほうれん草", "ほうれんそう", "ホウレンソウ"],
    stapleDishes: ["ほうれん草のおひたし", "ほうれん草のごま和え", "ほうれん草のバター炒め"],
  },
  {
    ingredientAliases: ["ぶり", "ブリ", "鰤"],
    stapleDishes: ["ぶり大根", "ぶりの照り焼き"],
  },
  {
    ingredientAliases: ["えび", "エビ", "海老"],
    stapleDishes: ["エビフライ", "エビチリ", "エビマヨ"],
  },
  {
    ingredientAliases: ["いか", "イカ", "烏賊"],
    stapleDishes: ["イカと大根の煮物", "イカリング"],
  },
  {
    ingredientAliases: ["きのこ", "キノコ", "しめじ", "シメジ", "まいたけ", "マイタケ", "えのき", "エノキ"],
    stapleDishes: ["きのこのバター炒め", "きのこのホイル焼き", "きのこの味噌汁"],
  },
  {
    ingredientAliases: ["ちくわ", "チクワ", "竹輪"],
    stapleDishes: ["ちくわの磯辺揚げ", "ちくわのきゅうり詰め"],
  },
  {
    ingredientAliases: ["厚揚げ", "あつあげ"],
    stapleDishes: ["厚揚げの煮物", "厚揚げの焼き浸し"],
  },
];

const normalizedCatalog: readonly { readonly aliases: ReadonlySet<string>; readonly dishes: readonly string[] }[] =
  STAPLE_DISH_CATALOG.map((entry) => ({
    aliases: new Set(entry.ingredientAliases.map(normalizeFoodText)),
    dishes: entry.stapleDishes,
  }));

/**
 * メイン食材に対応する定番料理名を返す。正規化後の完全一致のみ。
 * 未収録の食材はヒット 0 件。辞書の欠落は生成失敗にしない（fail-open）。
 */
export function lookupStapleDishes(
  mainIngredients: readonly string[],
  max: number,
): readonly string[] {
  if (max <= 0) return [];
  const dishes: string[] = [];
  const seen = new Set<string>();
  for (const ingredient of mainIngredients) {
    const normalized = normalizeFoodText(ingredient);
    if (normalized === "") continue;
    for (const entry of normalizedCatalog) {
      if (!entry.aliases.has(normalized)) continue;
      for (const dish of entry.dishes) {
        if (seen.has(dish)) continue;
        seen.add(dish);
        dishes.push(dish);
        if (dishes.length >= max) return dishes;
      }
    }
  }
  return dishes;
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/staple-dish-catalog.test.ts
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

期待: すべて PASS。

- [ ] **Step 5: コミット**

```bash
git add netlify/functions/_shared/staple-dish-catalog.ts netlify/functions/_shared/staple-dish-catalog.test.ts
git commit -m "feat(generation): 定番料理名の辞書と照合を足す

normalizeFoodText は漢字とかなを畳まないため、揺れは alias 列挙で吸収し
照合は正規化後の完全一致にする。未収録食材は 0 件で fail-open。"
```

---

### Task 4: プロンプト

**Files:**
- Create: `netlify/functions/_shared/novelty-hints.ts`
- Create: `netlify/functions/_shared/generation-prompt-novelty-off.test.ts`
- Modify: `netlify/functions/_shared/generation-prompt.ts:238-255`（`buildNewMenuSystemPrompt`）, `:491-520`（`buildGenerationMessages` の new_menu 分岐）
- Modify: `netlify/functions/_shared/generation-prompt.test.ts`

**Interfaces:**
- Consumes: Task 3 の `lookupStapleDishes`、Task 1 の `PlannerSubmission["noveltyPreference"]`
- Produces: `NOVELTY_HINTS_ENABLED`, `NOVELTY_SYSTEM_MARKER`, `NOVELTY_PARAGRAPH`, `NOVELTY_EXCLUDED_DISHES_MAX`
- Produces: new_menu の user payload トップレベルキー `noveltyExcludedDishes: readonly string[]`

- [ ] **Step 1: failing test を書く**

`netlify/functions/_shared/generation-prompt.test.ts` へ追記する。同ファイルの既存の多様性テストが `GenerationExecutionContext` の組み立て方の手本になる。

```ts
describe("novelty hints", () => {
  it("adds the novelty paragraph and excluded dishes when twist is selected", () => {
    const messages = buildGenerationMessages(
      makeNewMenuContext({ noveltyPreference: "twist", mainIngredients: ["豚肉"] }),
    );
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    expect(system).toContain(NOVELTY_SYSTEM_MARKER);
    expect(JSON.parse(stripInputWrapper(user)).noveltyExcludedDishes).toContain("豚の生姜焼き");
  });

  it("omits the paragraph and the key when the axis is standard or unset", () => {
    for (const noveltyPreference of ["standard", null] as const) {
      const messages = buildGenerationMessages(
        makeNewMenuContext({ noveltyPreference, mainIngredients: ["豚肉"] }),
      );
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      const user = messages.find((m) => m.role === "user")?.content ?? "";
      expect(system).not.toContain(NOVELTY_SYSTEM_MARKER);
      expect(JSON.parse(stripInputWrapper(user))).not.toHaveProperty("noveltyExcludedDishes");
    }
  });

  it("keeps the twist paragraph even when the catalog has no match", () => {
    const messages = buildGenerationMessages(
      makeNewMenuContext({ noveltyPreference: "twist", mainIngredients: ["ドラゴンフルーツ"] }),
    );
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    expect(system).toContain(NOVELTY_SYSTEM_MARKER);
    expect(JSON.parse(stripInputWrapper(user)).noveltyExcludedDishes).toEqual([]);
  });

  it("leaves the regeneration user payload unchanged", () => {
    const messages = buildGenerationMessages(
      makeRegenerateMenuContext({ noveltyPreference: "twist" }),
    );
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const userContents = messages.filter((m) => m.role === "user").map((m) => m.content);
    expect(system).not.toContain(NOVELTY_SYSTEM_MARKER);
    for (const content of userContents) {
      expect(content).not.toContain("noveltyExcludedDishes");
      expect(content).not.toContain("noveltyPreference");
    }
  });
});
```

`makeNewMenuContext` / `makeRegenerateMenuContext` / `stripInputWrapper` は同ファイルの既存ヘルパー名へ読み替える。無ければ既存テストのコンテキスト組み立てをそのまま真似る。

**最後のテストが要る理由**: `buildBaseGenerationMessages` は new_menu と再生成の両方が呼ぶ。`PromptPreferences` へフィールドを足すと再生成の user JSON が黙って変わり、spec §2.2 の「再生成経路は対象外」に反する。この回帰テストがその再発を止める。

`generation-prompt-novelty-off.test.ts` は `generation-prompt-diversity-off.test.ts` を手本に、kill-switch を off へ mock したとき **段落とキーの両方が消える** ことを見る 1 本にする。

- [ ] **Step 2: テストが落ちることを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/generation-prompt.test.ts netlify/functions/_shared/generation-prompt-novelty-off.test.ts
```

期待: FAIL。

- [ ] **Step 3: novelty-hints.ts を実装**

```ts
/**
 * ひねり軸（noveltyPreference=twist）の prompt 専用ヒント。
 * fail-open・prompt 専用。fingerprint / quota / 検証には載せない。
 * diversity-hints.ts と同型。
 */

export const NOVELTY_HINTS_ENABLED = true as const;
export const NOVELTY_SYSTEM_MARKER = "【ひねり】" as const;
/** 1 リクエストあたりの除外料理名の上限。プロンプト肥大を防ぐ */
export const NOVELTY_EXCLUDED_DISHES_MAX = 12 as const;

/** system 文のひねり段落。先頭マーカーでテスト・運用識別する */
export const NOVELTY_PARAGRAPH =
  NOVELTY_SYSTEM_MARKER +
  "利用者は「ひねりたい」を選んでいます。" +
  "role=mainの料理では、preferences.mainIngredientsの最も一般的な調理法と定番の相方を避け、" +
  "別の加熱法や別の組み合わせで組んでください。" +
  "side・soup・stapleには適用しません。" +
  "noveltyExcludedDishesに挙げた料理名とその言い換えは、role=mainのnameに使わないでください。" +
  "家庭のキッチンで作れること、preferences.timeLimitMinutes、買い足しの現実性を優先します。" +
  "ひねりと他の制約が両立しないときは、通常どおりoutcome=successで定番の献立を返してください。" +
  "ひねりだけを理由にconstraint_conflictにしないでください。";
```

- [ ] **Step 4: generation-prompt.ts を実装**

**`PromptPreferences` にフィールドを追加してはならない。** `buildBaseGenerationMessages` は再生成と共用である。正しい前例は `recentDishHints` で、new_menu 分岐が base の user payload を parse し直して専用キーを足している。

まず import を足す。

```ts
import { lookupStapleDishes } from "./staple-dish-catalog.js";
import {
  NOVELTY_EXCLUDED_DISHES_MAX,
  NOVELTY_HINTS_ENABLED,
  NOVELTY_PARAGRAPH,
} from "./novelty-hints.js";
```

`readDiversityHintsEnabledFlag` の隣へ:

```ts
/** ひねり kill-switch を実行時 boolean として読む（diversity と同型） */
function readNoveltyHintsEnabledFlag(): boolean {
  return isEnabledFlag(NOVELTY_HINTS_ENABLED);
}
```

`buildNewMenuSystemPrompt` へ引数を 1 つ足す:

```ts
function buildNewMenuSystemPrompt(
  targetMode: GenerationContext["targetMode"],
  diversityEnabled: boolean,
  noveltyEnabled: boolean,
): string {
  const coreBody = buildGenerationSystemPromptCoreBody(readHouseholdKitchenPromptEnabledFlag());
  const diversity = diversityEnabled ? DIVERSITY_PARAGRAPH : "";
  const novelty = noveltyEnabled ? NOVELTY_PARAGRAPH : "";
  const modeExtra =
    targetMode === "idea"
      ? GENERATION_SYSTEM_PROMPT_IDEA_EXTRA
      : GENERATION_SYSTEM_PROMPT_HOUSEHOLD_EXTRA;
  return `${coreBody}${diversity}${novelty}${GENERATION_SYSTEM_PROMPT_SEASON}${modeExtra}`;
}
```

`buildGenerationMessages` の `kind === "new_menu"` 分岐、`recentDishHints` を組む箇所の直後へ:

```ts
    // ひねりは new_menu 専用。twist かつ flag on のときだけ段落とキーを載せる。
    // off・standard・未指定ではキーごと出さない（recentDishHints と違い後方互換の制約が無い）
    const noveltyEnabled =
      readNoveltyHintsEnabledFlag() &&
      context.generationContext.submission.noveltyPreference === "twist";
    const noveltyExcludedDishes = noveltyEnabled
      ? lookupStapleDishes(
          context.generationContext.submission.mainIngredients,
          NOVELTY_EXCLUDED_DISHES_MAX,
        )
      : [];
```

`systemContent` の組み立てへ `noveltyEnabled` を渡し、payload の組み立てを次へ変える:

```ts
    const payload = noveltyEnabled
      ? { ...basePayload, recentDishHints, noveltyExcludedDishes }
      : { ...basePayload, recentDishHints };
```

`buildSystemPrompt`（再生成経路）と再生成の user payload は一切変更しない。

- [ ] **Step 5: テストが通ることを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_shared/generation-prompt.test.ts netlify/functions/_shared/generation-prompt-novelty-off.test.ts netlify/functions/_shared/generation-prompt-diversity-off.test.ts netlify/functions/_shared/generation-prompt-kitchen-off.test.ts
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

期待: すべて PASS。既存の diversity / kitchen の off テストも巻き込んで走らせ、段落の並び順を壊していないことを確かめる。

- [ ] **Step 6: コミット**

```bash
git add netlify/functions/_shared/novelty-hints.ts netlify/functions/_shared/generation-prompt.ts netlify/functions/_shared/generation-prompt.test.ts netlify/functions/_shared/generation-prompt-novelty-off.test.ts
git commit -m "feat(generation): ひねり段落と定番除外リストを new_menu へ載せる

PromptPreferences は再生成と共用のため触らず、recentDishHints と同じ
new_menu 分岐で注入する。kill-switch off は段落とキーの両方を落とす。"
```

---

### Task 5: UI

**Files:**
- Modify: `src/features/planner/model/planner-labels.ts`
- Modify: `src/features/planner/components/review-step.tsx`
- Modify: `src/features/planner/components/planner-wizard.test.tsx`
- Modify: `src/features/planner/model/draft-from-menu.ts`
- Modify: `src/features/planner/model/draft-from-menu.test.ts`

**Interfaces:**
- Consumes: Task 1 の `NoveltyPreference`、Task 2 の draft 永続面
- Produces: `noveltyPreferenceLabels: Readonly<Record<NoveltyPreference, string>>` と `noveltyPreferenceLabel(value: NoveltyPreference | null): string`（既存 `ingredientPreferenceLabels` / `ingredientPreferenceLabel` と同じ API 形）

- [ ] **Step 1: failing test を書く**

**ウィジェットは `<select>` に固定する。** live の `review-step.tsx:592-625` の「材料の使い方」は radio ではなく `<select>` + `<option>` であり、隣に並べる以上そこへ揃える。`<select>` では空 option が未選択を表すので、「再押下で null に戻さない」という論点自体が発生しない。

`planner-wizard.test.tsx` へ:

```tsx
it("records the twist novelty preference from the review step", async () => {
  const user = userEvent.setup();
  renderWizardAtReviewStep();
  await user.selectOptions(screen.getByLabelText("献立の雰囲気"), "twist");
  expect(latestDraftValue().noveltyPreference).toBe("twist");
});

it("defaults the novelty preference to unset", () => {
  renderWizardAtReviewStep();
  expect(screen.getByLabelText("献立の雰囲気")).toHaveValue("");
  expect(latestDraftValue().noveltyPreference).toBeNull();
});

it("clears the novelty preference when the empty option is chosen", async () => {
  const user = userEvent.setup();
  renderWizardAtReviewStep({ noveltyPreference: "twist" });
  await user.selectOptions(screen.getByLabelText("献立の雰囲気"), "");
  expect(latestDraftValue().noveltyPreference).toBeNull();
});
```

`renderWizardAtReviewStep` / `latestDraftValue` は同ファイルの既存ヘルパー名へ読み替える。既存の「材料の使い方」テストが同じ `<select>` を扱っているので、その取得方法をそのまま真似ること。

`draft-from-menu.test.ts` へ:

```ts
it("carries the novelty preference over from a past menu", () => {
  expect(draftFromMenu({ ...menuFixture, noveltyPreference: "twist" })).toMatchObject({
    noveltyPreference: "twist",
  });
});

it("carries a missing novelty preference over as null", () => {
  expect(draftFromMenu(menuFixture)).toMatchObject({ noveltyPreference: null });
});
```

`draftFromMenu` / `menuFixture` は同ファイルの既存の名前へ読み替える。

- [ ] **Step 2: テストが落ちることを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/components/planner-wizard.test.tsx src/features/planner/model/draft-from-menu.test.ts
```

期待: FAIL。

- [ ] **Step 3: ラベルを実装**

`src/features/planner/model/planner-labels.ts` へ、既存の `ingredientPreferenceLabels` / `ingredientPreferenceLabel` と**同じ API 形**で足す（`Record` だけでなく null を扱う関数もある形）。

```ts
/**
 * 献立の雰囲気 → 利用者向け日本語。確認画面の任意条件で共有する。
 * twist は主菜の定番回避のソフト目安。定番が出ないことの保証ではない。
 */
export const noveltyPreferenceLabels: Readonly<Record<NoveltyPreference, string>> = {
  standard: "いつもの",
  twist: "ひねりたい（主菜を定番から外す）",
} as const;

export function noveltyPreferenceLabel(value: NoveltyPreference | null): string {
  if (value === null) return "指定なし";
  return noveltyPreferenceLabels[value];
}
```

`NoveltyPreference` は `shared/contracts/planner.js` から import する。コンポーネント内に日本語を直書きしない。

- [ ] **Step 4: 確認画面を実装**

`review-step.tsx` の「材料の使い方」の `<label className="field">` ブロック（592-625 行目）の**直後**へ、同じ構造で足す。`<select>` の `value` は `value.noveltyPreference ?? ""`、`onChange` は選択値を `"standard"` / `"twist"` / それ以外は `null` へ畳む（既存ブロックの三項の書き方に合わせる）。

```tsx
<label className="field">
  献立の雰囲気
  <select
    value={value.noveltyPreference ?? ""}
    disabled={disabled}
    onChange={(event) => {
      const selected = event.target.value;
      onChange({
        ...value,
        noveltyPreference:
          selected === "standard" ? "standard" : selected === "twist" ? "twist" : null,
      });
    }}
  >
    <option value="">{noveltyPreferenceLabel(null)}</option>
    <option value="standard">{noveltyPreferenceLabels.standard}</option>
    <option value="twist">{noveltyPreferenceLabels.twist}</option>
  </select>
</label>
```

既存ブロックは `aria-invalid` / `aria-describedby` を `fieldErrors` から引いている。新軸は必須項目ではなくバリデーションエラーを持たないので、`fieldErrors` 連動は付けない。90 行目付近の `fieldErrors` のキー union と 322 行目付近のエラー集約にも新軸を足さない。

タップ対象 44×44 CSS px、320 CSS px で横スクロールなしは、既存 `.field` クラスをそのまま使えば満たせる。

- [ ] **Step 5: draft-from-menu を実装**

`draft-from-menu.ts` の `ingredientPreference` を写している行の直後へ、`noveltyPreference` の 1 行を足す。

**Task 1 の Step 9b でこの関数が型波及に含まれていた場合、行は既にある。** その場合は何も足さない（重ねると TS1117: 同名プロパティの重複）。先に `grep -n noveltyPreference src/features/planner/model/draft-from-menu.ts` で確認し、値の写経（定数 `null` ではない）になっていれば、この Step の実装作業は無く、テストだけが増える。

- [ ] **Step 6: テストが通ることを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

期待: すべて PASS。

- [ ] **Step 7: コミット**

```bash
git add src/features/planner/
git commit -m "feat(planner): 確認画面へ献立の雰囲気の 2 択を足す"
```

---

### Task 6: E2E

**Files:**
- Modify: `e2e/specs/full-journey.spec.ts:73-90`

`menu-domain-pantry.spec.ts` は生成 success に到達しないシナリオなので使わない。生成が成功して献立ページまで進む経路は `full-journey.spec.ts` の 73-90 行目である。

- [ ] **Step 1: E2E を書く**

`full-journey.spec.ts:73` の「5. 確認」見出しアサートの後、77 行目の `const generate = ...` の**前**へ差し込む。

```ts
// 確認画面。ひねりを選んだ下書きが保存されたことを同期点にしてから生成へ進む
const noveltySaved = page.waitForResponse((response) => {
  if (!new URL(response.url()).pathname.endsWith("/rest/v1/rpc/save_generation_draft")) {
    return false;
  }
  const postData = response.request().postData();
  return postData !== null && postData.includes('"p_novelty_preference":"twist"');
});
await page.getByLabel("献立の雰囲気").selectOption("twist");
await noveltySaved;
```

`getByLabel` + `selectOption` は Task 5 で `<select>` に固定した実装に対応する。role で取るなら `getByRole("combobox", { name: "献立の雰囲気" })` だが、同ファイルの既存の取得スタイルへ合わせること。

以降は既存シナリオの `generate.click()` 以下をそのまま流す。追加のアサートは要らない。確かめたいのは「`twist` を選んでも生成が success で完了する」ことであり、80-90 行目の既存アサート（URL 遷移、「献立ができました」、主菜見出し）がそれを見ている。

**注意**: 主菜見出しのアサート（88 行目「鶏肉と白菜のやわらか煮」）は success fixture の固定値である。`twist` はモック応答を変えないので、この期待値は変えない。変える必要が出たならモックの実装を疑うこと。

- [ ] **Step 2: E2E を走らせる**

ホストで直接実行する。

```bash
./scripts/run-e2e.sh
```

**出力が数百行になるため、このコマンドは人間に依頼するか、verifier subagent 経由で走らせること。** 生ログを controller のコンテキストへ入れない。

期待: 全 PASS。

- [ ] **Step 3: コミット**

```bash
git add e2e/specs/full-journey.spec.ts
git commit -m "test(e2e): ひねりを選んだ献立生成が成功することを検証する"
```

---

## 全体検証

全 Task 完了後、一度だけ通しで走らせる。出力が大きいので verifier subagent 経由か、人間へ依頼する。

```bash
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm test -- --run
docker compose --profile test run --rm db-test
./scripts/run-e2e.sh
```

## 効果の確認（実装後）

spec §9 のとおり、初版で効きが弱かった場合の対処は **辞書の拡充のみ**である。2 パス生成（料理名候補を先に出させてから本生成）へは進まない。1 リクエストで OpenRouter attempt 予算を 2 回消費し、`shared/contracts/function-budget.ts` と Netlify 同期 60 秒の壁の前提を壊すためである。
