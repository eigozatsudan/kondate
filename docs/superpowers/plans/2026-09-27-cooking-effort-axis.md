# 「手間のかかる料理は避ける」軸（effortPreference）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 献立生成・再生成・週献立に、揚げ物や蒸し物など手間のかかる料理を避けるよう AI へ頼む任意の切り替え `effortPreference` を足す。

**Architecture:** `noveltyPreference`（ひねり）と同じ経路をなぞる。planner 契約 → `generation_drafts` / submission snapshot（migration 1 本）→ Function の snapshot 読み → system 段落（prompt 専用・fail-open）→ ウィザード / 確認画面 / 週献立フォーム。strict な snapshot 読みの配備ずれを避けるため、Task 1 を独立したリリース 1 として先に出す。

**Tech Stack:** TypeScript strict / Zod / React 19 / React Router 8 / Vitest / Supabase Postgres + pgTAP / Netlify Functions / Playwright

**Spec:** `docs/superpowers/specs/2026-09-26-cooking-effort-axis-design.md`（実装者は spec も読むこと）

## Global Constraints

- Node.js `>=24 <25`、ESM、TypeScript `strict: true`。network / DB 境界で `any` や未検査のキャストを使わない。
- 利用者向けの文言はすべて日本語。コードのコメントとコミットメッセージは日本語、識別子とテスト名は英語（既存テストが日本語名のファイルはそれに合わせる）。
- 320 CSS px で横スクロールなし、タッチ対象は 44×44 CSS px 以上。
- 名前・メール・アレルギー・自由記述・プロンプト・生の AI 出力をログや永続化に出さない。
- この軸は prompt 専用。`validate-generated-menu`、生成ハードゲート、fingerprint、quota、`generation-quality-review-entry` の合否条件には入れない。
- 手で編集しない: `package-lock.json`、`infra/supabase/**`、`src/shared/types/database.generated.ts`（`db:types` で再生成する）。
- `src/` から `@shared/safety/*` を import しない。
- Node のコマンドは Docker 経由で実行する: `docker compose run --rm --no-deps app npx vitest run <files>` / `... app npm run typecheck` / `... app npm run lint` / `... app npm run format:check`。
- `db:test` は `docker compose --profile test run --rm db-test`、migration 適用は `docker compose run --rm migrate`、e2e は `./scripts/run-e2e.sh`。`npm run` で `app` の中から呼ばない。
- コミット先は `main`。push しない。コミットは日本語の Conventional Commit で、末尾に次の 2 行を付ける。

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014unHywzrdUis3WSG9mHdbv
  ```

## Review Focus

1. **配備ずれの間の new_menu**: DB の snapshot 戻り値に `effort_preference` が有っても無くても、生成が 400 にならないこと（Task 1 のテストで固定）。
2. **手間だけを選んだ下書き**: 他の項目が空で、手間だけを選んだ下書きも保存されること（Task 2 の autosave テストで固定）。
3. **週献立の保存と再表示**: POST で `easy` を選ぶと、insert される行にも残り、GET でも `easy` が返ること（Task 4 のテストで固定）。
4. **ひねりと手間の同時選択**: 両方の段落が載り、手間の段落に「避ける例の調理法は選ばない」の文が入ること（Task 3 のテストで固定）。
5. **確認画面から手間を変更して戻る**: 「変更」→ 手間の段 →「確認に戻る」で確認画面に戻り、値が反映されること（Task 5 のテストで固定）。

---

## File Structure

| ファイル | 責務 | Task |
| --- | --- | --- |
| `netlify/functions/_shared/generation-context.ts` | snapshot 行の読み。`effort_preference` を任意キーで受ける | 1, 2 |
| `shared/contracts/planner.ts` | `effortPreferences` と draft / submission のフィールド | 2 |
| `supabase/migrations/20260927120000_effort_preference.sql` | 列 2 本、`save_generation_draft` 15 引数化、reserve の写し、snapshot 取得関数 | 2 |
| `src/shared/types/database.ts` | 生成型の overlay（`p_effort_preference` を null 許容） | 2 |
| `src/features/planner/{planner-api,use-draft-autosave}.ts`、`model/draft-from-menu.ts`、`model/planner-labels.ts` | 下書きの読み書き、引き継ぎ、ラベル | 2 |
| `netlify/functions/_shared/effort-hints.ts`（新規） | kill-switch、段落、週献立の 1 文 | 3 |
| `netlify/functions/_shared/generation-prompt.ts` | payload と system 段落の組み立て | 3 |
| `netlify/functions/_shared/{taste,diversity}-hints.ts` | 優先順位の文 | 3 |
| `shared/contracts/weekly-plan.ts`、`netlify/functions/_shared/weekly-plan-{service,prompt}.ts` | 週献立の契約・保存・プロンプト | 4 |
| `src/features/weekly-plan/pages/weekly-plan-form-page.tsx`、`weekly-plan-draft-handoff.ts` | 週献立フォームと下書きへの引き継ぎ | 4 |
| `src/features/planner/model/planner-wizard.ts`、`components/{planner-wizard,review-step}.tsx` | ウィザードの段、確認画面の行 | 5 |
| `docs/deployment/README.md` | 2 回に分けた配備の注記 | 6 |

---

### Task 1: snapshot 読みを `effort_preference` の有無に寛容にする（リリース 1）

この Task だけを先に本番へ出す（spec §7.1）。migration、UI、プロンプトは含めない。

**Files:**
- Modify: `netlify/functions/_shared/generation-context.ts:63-82`
- Test: `netlify/functions/_shared/generation-context.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `snapshotRowSchema` が `effort_preference?: "standard" | "easy" | null` を受ける（Task 2 が `mapSnapshot` で使う）

- [ ] **Step 1: 失敗するテストを書く**

`generation-context.test.ts` の `it("maps every novelty preference value from the snapshot row", ...)` の直後に追加する。

```ts
  it("loads a snapshot row that carries effort_preference (post-migration DB)", async () => {
    for (const value of ["standard", "easy", null] as const) {
      arrangeLoader({ snapshotData: [{ ...snapshot, effort_preference: value }] });
      await expect(
        loadGenerationContext({ userId, accessToken: "access-token" }, requestId, request, now),
      ).resolves.toBeDefined();
    }
  });

  it("loads a snapshot row without effort_preference (pre-migration DB)", async () => {
    arrangeLoader({ snapshotData: [snapshot] });
    await expect(
      loadGenerationContext({ userId, accessToken: "access-token" }, requestId, request, now),
    ).resolves.toBeDefined();
  });

  it("rejects an unknown effort_preference value", async () => {
    arrangeLoader({ snapshotData: [{ ...snapshot, effort_preference: "wild" }] });
    await expect(
      loadGenerationContext({ userId, accessToken: "access-token" }, requestId, request, now),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
```

- [ ] **Step 2: 失敗を確認する**

Run: `docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/generation-context.test.ts`
Expected: 1 つ目のテストが `invalid_request` で FAIL（strict schema が未知キーを拒否する）。2 つ目と 3 つ目は PASS。

- [ ] **Step 3: 最小の実装**

`snapshotRowSchema` の `novelty_preference` の行の直後に追加する。

```ts
    novelty_preference: z.enum(["standard", "twist"]).nullable(),
    // 配備ずれ対策（spec §7.1）: migration 前の DB はこのキーを返さない。
    // strict のまま任意キーで受け、旧 DB でも新 DB でも new_menu を落とさない。
    effort_preference: z.enum(["standard", "easy"]).nullable().optional(),
```

`mapSnapshot` はこの Task では変えない（契約にまだフィールドが無いため）。

- [ ] **Step 4: 通ることを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/generation-context.test.ts`
Expected: PASS

Run: `docker compose run --rm --no-deps app npm run typecheck`、`... npm run lint`、`... npm run format:check`
Expected: いずれもエラーなし

- [ ] **Step 5: コミット**

```bash
git add netlify/functions/_shared/generation-context.ts netlify/functions/_shared/generation-context.test.ts
git commit -m "feat(generation): snapshot の effort_preference を有無どちらでも読めるようにする" -m "手間軸の migration より先に出すリリース 1。strict な snapshot 読みが未知キーで new_menu を落とす配備ずれを避ける。" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014unHywzrdUis3WSG9mHdbv"
```

---

### Task 2: 契約・DB・下書きの往復に `effortPreference` を通す

契約へフィールドを足すと、出力型が必須キーになるため、型が要求する箇所はすべてこの Task で直す。migration・型 overlay・pgTAP の追随は同じコミットに入れる（spec §7.1）。

**Files:**
- Modify: `shared/contracts/planner.ts`
- Create: `supabase/migrations/20260927120000_effort_preference.sql`
- Regenerate: `src/shared/types/database.generated.ts`（`db:types`）
- Modify: `src/shared/types/database.ts`、`src/shared/types/database.test.ts`
- Modify: `netlify/functions/_shared/generation-context.ts`（`mapSnapshot`）
- Modify: `netlify/functions/_shared/revalidation-adapter.ts:136,754`、`shared/emergency/filter-emergency-menus.ts:146`、`netlify/functions/_shared/generation-quality-review-entry.ts`、`netlify/functions/_shared/paid-openrouter-benchmark-harness.ts`、`shared/testing/factories.ts`
- Modify: `src/features/planner/planner-api.ts`、`src/features/planner/use-draft-autosave.ts`、`src/features/planner/model/draft-from-menu.ts`、`src/features/planner/model/planner-labels.ts`
- Modify: `src/features/planner/components/planner-wizard.tsx`（初期値と `skipRestOfOptionalSteps` だけ。段の追加は Task 5）、`src/features/planner/components/audience-step.tsx:169`、`src/features/planner/planner-route.tsx:127,154,2045`
- Modify (pgTAP): `supabase/tests/database/03_pantry_and_planner_drafts.test.sql`、`03a_pantry_and_planner_drafts_hardening.test.sql`、`ai_control_and_quota.test.sql`、`rls_inventory.test.sql`
- Test: `shared/contracts/planner.test.ts`、`netlify/functions/_shared/generation-context.test.ts`、`src/features/planner/use-draft-autosave.test.tsx`、`src/features/planner/model/draft-from-menu.test.ts`、`src/features/planner/planner-api.test.ts`

**Interfaces:**
- Consumes: Task 1 の `snapshotRowSchema.effort_preference`（optional）
- Produces:
  - `shared/contracts/planner.ts`: `export const effortPreferences = ["standard", "easy"] as const;`、`export type EffortPreference = (typeof effortPreferences)[number];`、`PlannerDraftInput` / `PlannerDraft` / `PlannerSubmission` の `effortPreference: EffortPreference | null`
  - `src/features/planner/model/planner-labels.ts`: `effortPreferenceLabels: Readonly<Record<EffortPreference, string>>`、`effortPreferenceLabel(value: EffortPreference | null): string`
  - DB: `public.save_generation_draft(..., p_novelty_preference text, p_effort_preference text default null)`、`get_ai_generation_submission_snapshot` の戻り値 `effort_preference text`

- [ ] **Step 1: 契約の失敗テストを書く**

`shared/contracts/planner.test.ts` の既存 fixture（22 行目と 35 行目の `noveltyPreference: null,`）の直後に `effortPreference: null,` を足す。`it("accepts declared novelty preference values ...")` の直後に次を追加する。

```ts
  it("accepts declared effort preference values and rejects unknown ones", () => {
    for (const effortPreference of ["standard", "easy", null] as const) {
      expect(
        plannerDraftInputSchema.parse({ ...incompleteDraft, effortPreference }),
      ).toMatchObject({ effortPreference });
      expect(
        plannerSubmissionSchema.parse({
          ...validBase,
          effortPreference,
          targetMode: "household" as const,
          targetMemberIds: [memberId],
          servings: null,
        }),
      ).toMatchObject({ effortPreference });
    }
    expect(
      plannerDraftInputSchema.safeParse({
        ...incompleteDraft,
        effortPreference: "wild",
      }).success,
    ).toBe(false);
  });
```

既存の `it("defaults missing noveltyPreference to null on draft and submission (pre-feature snapshots)", ...)` は、キーを列挙して `draftWithoutKey` / `submissionWithoutKey` を組み立てている。ここには `effortPreference` を**足さず**、2 つの `toMatchObject({ noveltyPreference: null })` を `toMatchObject({ noveltyPreference: null, effortPreference: null })` にする。テスト名は `"defaults missing noveltyPreference and effortPreference to null on draft and submission (pre-feature snapshots)"` にする。

- [ ] **Step 2: 失敗を確認する**

Run: `docker compose run --rm --no-deps app npx vitest run shared/contracts/planner.test.ts`
Expected: FAIL（`effortPreference` が strict schema の未知キー）

- [ ] **Step 3: 契約を実装する**

`shared/contracts/planner.ts` の `noveltyPreferences` の直後に追加する。

```ts
/**
 * 調理の手間。standard=指定どおり / easy=手間のかかる料理は避ける。
 * null は未指定で、挙動は standard と同一（プロンプト段落なし）。
 * null を残すのは導入前 snapshot の互換読み込みのためだけ。
 */
export const effortPreferences = ["standard", "easy"] as const;
```

`draftShape` と `submissionCommonShape` の `noveltyPreference` の行の直後に、それぞれ追加する。

```ts
  // default(null): 導入前の preference_snapshot / 下書き JSON にキーが無くても
  // 再生成・条件引き継ぎが 422 にならないよう欠損を未指定として読む。
  effortPreference: z.enum(effortPreferences).nullable().default(null),
```

型の export 群（`NoveltyPreference` の直後）に追加する。

```ts
export type EffortPreference = (typeof effortPreferences)[number];
```

- [ ] **Step 4: 契約テストが通ることを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run shared/contracts/planner.test.ts`
Expected: PASS

- [ ] **Step 5: migration を書く**

`supabase/migrations/20260927120000_effort_preference.sql` を作る。作る前に、3 関数の正本が変わっていないことを確かめる。

```bash
grep -l "function public.save_generation_draft" supabase/migrations/* | sort | tail -1
# 期待: supabase/migrations/20260831120000_novelty_preference.sql
grep -l "function public.reserve_ai_generation" supabase/migrations/* | sort | tail -1
# 期待: supabase/migrations/20260920120000_reserve_ai_generation_null_member_filter.sql
grep -l "function public.get_ai_generation_submission_snapshot" supabase/migrations/* | sort | tail -1
# 期待: supabase/migrations/20260831120000_novelty_preference.sql
```

期待と違うファイルが出たら、そのファイルを正本として以下を読み替える。

ファイルの構成は次の 5 節である。

**(1) 冒頭コメントと列の追加**

```sql
-- effort_preference: 調理の手間（standard=指定どおり / easy=手間のかかる料理は避ける）
-- 列追加後、下書き保存（DROP→CREATE）・予約（create or replace）・snapshot 取得（DROP→CREATE）を更新する。
-- 配備はリリース 1（snapshot 読みを任意キー化した Functions）の後に通常の順で当てる（docs/deployment/README.md §5.2）。

alter table public.generation_drafts
  add column effort_preference text
  check (
    effort_preference is null
    or effort_preference in ('standard', 'easy')
  );

alter table private.generation_draft_submission_versions
  add column effort_preference text
  check (
    effort_preference is null
    or effort_preference in ('standard', 'easy')
  );
```

**(2) `save_generation_draft`**

```sql
-- save_generation_draft: 現行は 14 引数（novelty migration）。14 引数版を DROP しないと
-- 15 引数版と overload が曖昧になり、下書き保存が全面的に失敗する。
-- p_effort_preference は default null。14 引数の位置指定呼び出し（pgTAP）と、配備ずれの間に
-- 旧ブラウザが送る named 引数 14 個の呼び出しを、そのまま 15 引数版へ解決させる。
drop function if exists public.save_generation_draft(
  bigint, text, text[], text, text, uuid[], smallint, smallint, text, text, text[], text, jsonb, text
);
```

続けて、`20260831120000_novelty_preference.sql` の 24〜128 行目（`create or replace function public.save_generation_draft(` から `$function$;` まで）をコピーし、次の 5 か所だけを変える。

1. 引数リストの末尾 `p_novelty_preference text` を `p_novelty_preference text, p_effort_preference text default null` にする。
2. novelty の値検査（`if p_novelty_preference is not null ... end if;`）の直後に追加する。

   ```sql
     if p_effort_preference is not null
        and p_effort_preference not in ('standard', 'easy') then
       raise exception using errcode = '22023', message = 'invalid_draft_save';
     end if;
   ```

3. insert の列リスト `novelty_preference, avoid_ingredients,` を `novelty_preference, effort_preference, avoid_ingredients,` にし、values の `p_ingredient_preference, p_novelty_preference,` を `p_ingredient_preference, p_novelty_preference, p_effort_preference,` にする。
4. 2 つの update 文の `novelty_preference = p_novelty_preference,` の直後に、それぞれ `effort_preference = p_effort_preference,` を足す。
5. 他は変えない。

最後に権限を 15 型で書く。

```sql
revoke all on function public.save_generation_draft(
  bigint, text, text[], text, text, uuid[], smallint, smallint,
  text, text, text[], text, jsonb, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.save_generation_draft(
  bigint, text, text[], text, text, uuid[], smallint, smallint,
  text, text, text[], text, jsonb, text, text
) to authenticated;
```

**(3) `reserve_ai_generation`**

```sql
-- reserve: submission snapshot へ effort_preference を写す。
-- 正本は 20260920120000_reserve_ai_generation_null_member_filter.sql。
-- 署名・security definer・search_path・権限は維持する（create or replace は既存の grant を保持する）。
-- DROP しないこと。DROP すると service_role の EXECUTE が消える。
```

続けて、`20260920120000_reserve_ai_generation_null_member_filter.sql` の `create or replace function public.reserve_ai_generation(` から関数末尾の `$function$;`（または同ファイルでの終端記号）までをコピーし、`insert into private.generation_draft_submission_versions(` の 1 か所だけを変える。

```sql
    insert into private.generation_draft_submission_versions(
      draft_id, user_id, draft_revision, meal_type, main_ingredients, cuisine_genre,
      target_mode, target_member_ids, servings, time_limit_minutes, budget_preference,
      ingredient_preference, novelty_preference, effort_preference, avoid_ingredients, memo,
      pantry_selections, captured_at
    ) values (
      v_draft.id, v_draft.user_id, v_draft.revision, v_draft.meal_type,
      v_draft.main_ingredients, v_draft.cuisine_genre,
      v_draft.target_mode, v_draft.target_member_ids, v_draft.servings,
      v_draft.time_limit_minutes, v_draft.budget_preference, v_draft.ingredient_preference,
      v_draft.novelty_preference, v_draft.effort_preference, v_draft.avoid_ingredients, v_draft.memo,
      v_draft.pantry_selections, p_now
    ) on conflict (draft_id, user_id, draft_revision) do nothing;
```

revoke / grant は書かない。コピーした範囲に revoke / grant が含まれていれば削除する。

**(4) `get_ai_generation_submission_snapshot`**

```sql
-- submission snapshot 戻り値に effort_preference を追加（戻り値の型が変わるため DROP → CREATE）
drop function if exists public.get_ai_generation_submission_snapshot(uuid, uuid);
```

続けて、`20260831120000_novelty_preference.sql` の 620〜668 行目（`create or replace function public.get_ai_generation_submission_snapshot(` から `$$;` まで）をコピーし、`returns table` の `novelty_preference text,` の直後に `effort_preference text,` を、select 句の `snapshot.novelty_preference,` の直後に `snapshot.effort_preference,` を足す。

直後に、必ず次の 2 文を書く。

```sql
-- security definer で p_user_id を信用するため、PUBLIC の既定 EXECUTE を必ず剥がす
revoke all on function public.get_ai_generation_submission_snapshot(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_ai_generation_submission_snapshot(uuid, uuid)
  to service_role;
```

- [ ] **Step 6: pgTAP を先に直して失敗を確認する**

`supabase/tests/database/03_pantry_and_planner_drafts.test.sql`:

- 20〜21 行目の直後に追加する。

  ```sql
  select has_column('public', 'generation_drafts', 'effort_preference',
    'generation drafts store the effort preference');
  select has_column('private', 'generation_draft_submission_versions', 'effort_preference',
    'submission snapshot stores effort preference');
  ```

- 「ひねり軸」のブロック（198〜207 行目）の直後、overload 数を数える assert の前に追加する。

  ```sql
  -- 手間軸: 15 引数保存で永続化され、未知値は 22023 で拒否され、14 引数呼び出しは null で解決される
  select public.save_generation_draft(5,'dinner',array['豚肉'],'japanese','idea',
    array[]::uuid[],2::smallint,30::smallint,'standard',null,array[]::text[],'','[]'::jsonb,'twist','easy');
  select is((select effort_preference from public.generation_drafts), 'easy',
    'save persists effort preference');

  select throws_ok(
    $$select public.save_generation_draft(6,'dinner',array['豚肉'],'japanese','idea',
      array[]::uuid[],2::smallint,30::smallint,'standard',null,array[]::text[],'','[]'::jsonb,'twist','wild')$$,
    '22023', 'invalid_draft_save', 'save rejects an unknown effort value');

  select public.save_generation_draft(6,'dinner',array['豚肉'],'japanese','idea',
    array[]::uuid[],2::smallint,30::smallint,'standard',null,array[]::text[],'','[]'::jsonb,'twist');
  select is((select effort_preference from public.generation_drafts), null,
    'a 14-argument save resolves to the default null effort preference');
  ```

  revision は、直前のひねり軸ブロックの成功保存（revision 4 → 5）に続く値である（5 で保存 → 6、6 で拒否、6 で保存 → 7）。

- 冒頭の `select plan(48);` を、追加した assert の数（has_column 2 + is 2 + throws_ok 1 = 5）だけ増やして `select plan(53);` にする。

`supabase/tests/database/03a_pantry_and_planner_drafts_hardening.test.sql` の 86〜88 行目の `to_regprocedure('public.save_generation_draft(bigint,text,text[],text,text,uuid[],smallint,smallint,text,text,text[],text,jsonb,text)')` を、3 か所とも末尾に `,text` を足した 15 型にする。

`supabase/tests/database/rls_inventory.test.sql` の 288 行目の関数シグネチャの末尾 `p_novelty_preference text)` を `p_novelty_preference text, p_effort_preference text)` にする。

`supabase/tests/database/ai_control_and_quota.test.sql` の `$novelty_snapshot$` ブロック（3529〜3574 行目）の直後に追加する。

```sql
-- 手間軸: reserve が submission snapshot へ effort_preference を写すことの往復
do $effort_snapshot$
declare
  -- live 未使用の専用 UUID 帯（f5〜f9 は使用済み）
  v_owner constant uuid := '10000000-0000-4000-8000-0000000000fa';
  v_idempotency constant uuid := '30000000-0000-4000-8000-0000000000fa';
  v_draft public.generation_drafts;
begin
  insert into auth.users(
    id,instance_id,aud,role,email,encrypted_password,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  ) values(
    v_owner,'00000000-0000-0000-0000-000000000000','authenticated',
    'authenticated','effort-snapshot@example.invalid','','{}','{}',now(),now()
  );
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  v_draft := public.save_generation_draft(
    0::bigint,'dinner',array['豚肉'],'japanese',
    'idea',array[]::uuid[],2::smallint,30::smallint,'standard',null,
    array[]::text[],'','[]'::jsonb,null,'easy'
  );
  perform public.reserve_ai_generation(
    v_owner,v_idempotency,
    'new_menu',v_draft.id,v_draft.revision,null,null,null,
    'generation-command.v3',repeat('f',64),
    jsonb_build_object(
      'kind','new_menu',
      'target_mode','idea',
      'servings',2,
      'target_member_ids','[]'::jsonb,
      'source_menu_version',null
    ),
    tests.quota_identity_key(v_owner), 1, 6, 4, 20, false, false, 180,'2026-07-11 03:00:00+00'
  );
end
$effort_snapshot$;

select is(
  (select snapshot.effort_preference
     from private.ai_generation_requests request
     cross join lateral public.get_ai_generation_submission_snapshot(
       request.id, request.user_id) snapshot
    where request.idempotency_key = '30000000-0000-4000-8000-0000000000fa'),
  'easy',
  'reserve copies effort preference into the submission snapshot');
```

`'0000000000fa'` が同ファイル内で既に使われていないことを `grep -n "0000000000fa" supabase/tests/database/ai_control_and_quota.test.sql` で確かめる。使われていれば、未使用の値に変える。

このファイルは `no_plan()` なので plan 数の更新は不要である。

Run（スタック起動済みで）: `docker compose up -d --wait && docker compose --profile test run --rm db-test > /tmp/claude-db-test.log 2>&1; grep -nE "not ok|Failed|FAIL" /tmp/claude-db-test.log | head -40`
`db-test` サービスは `migrate` に依存し、実行のたびに migration を当てる。RED を見るため、この実行の間だけ Step 5 の migration を退避する（リポジトリ外の一時ディレクトリへ `mv` し、実行後に戻す）。

Expected: 手間軸の assert と 03a の `to_regprocedure`、rls_inventory の署名が FAIL する。出力が大きいときは、この Step と Step 8 の実行を人間に頼み、要約を貼ってもらう（CLAUDE.md の方針）。

- [ ] **Step 7: migration を当て、型を再生成する**

```bash
docker compose run --rm migrate
docker compose run --rm app npm run db:types
git diff --stat src/shared/types/database.generated.ts
```

Expected: `database.generated.ts` の `save_generation_draft` の Args に `p_effort_preference?: string`、`generation_drafts` の Row に `effort_preference: string | null`、snapshot の Returns に `effort_preference: string | null` が増える。

- [ ] **Step 8: pgTAP が通ることを確認する**

Run: `docker compose --profile test run --rm db-test > /tmp/claude-db-test.log 2>&1; grep -nE "not ok|Failed|FAIL" /tmp/claude-db-test.log | head -40 || tail -n 20 /tmp/claude-db-test.log`
Expected: 失敗なし。`get_ai_generation_submission_snapshot` の既存の権限・definer の assert（`ai_control_and_quota.test.sql` 1571〜1586 行目付近）も通る。

- [ ] **Step 9: 型 overlay を直す**

`src/shared/types/database.ts` の `NullableDraftArgs` に `| "p_effort_preference"` を足し、`SaveDraftArgs` の `p_novelty_preference: ...` の直後に次を足す。

```ts
  p_effort_preference: GeneratedSaveDraftArgs["p_effort_preference"] | null;
```

`src/shared/types/database.test.ts` の `p_novelty_preference: null,` の 2 か所（130、161 行目）の直後に `p_effort_preference: null,` を足し、180 行目付近の `NullableDraftArg` union に `| "p_effort_preference"` を足す。

- [ ] **Step 10: 下書きの往復と autosave の失敗テストを書く**

`src/features/planner/use-draft-autosave.test.tsx` の `base` に `effortPreference: null,` を足し、「ひねりだけを選んだ下書きも空扱いにせず保存する」の直後に追加する。

```ts
it("手間だけを選んだ下書きも空扱いにせず保存する", async () => {
  vi.useFakeTimers();
  const save = vi.fn((value: PlannerDraftInput, revision: number) =>
    Promise.resolve(saved(value, revision + 1)),
  );
  const { rerender } = renderHook(
    ({ value }) =>
      useDraftAutosave({ value, enabled: true, baselineRevision: 1, resetToken: 0, save }),
    { initialProps: { value: base } },
  );

  rerender({ value: { ...base, effortPreference: "easy" as const } });
  await act(async () => vi.advanceTimersByTimeAsync(600));

  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0]?.[0]).toMatchObject({ effortPreference: "easy" });
});
```

`src/features/planner/model/draft-from-menu.test.ts` の `ideaSubmission` と `householdSubmission` の `noveltyPreference: null,` の直後に `effortPreference: null,` を足し、55 行目付近の期待値にも `effortPreference: null,` を足す。`it("carries a missing novelty preference over as null", ...)` の直後に追加する。

```ts
  it("carries the effort preference over from a past menu", () => {
    expect(
      createPlannerDraftFromMenu({ ...ideaSubmission, effortPreference: "easy" }),
    ).toMatchObject({ effortPreference: "easy" });
  });
```

`src/features/planner/planner-api.test.ts`:

- 49 行目付近の行 fixture（`novelty_preference: null,`）の直後に `effort_preference: null,` を足す。
- `it("returns the novelty preference from a fetched draft row", ...)` の直後に追加する。

```ts
  it("selects the effort preference column from generation_drafts", async () => {
    const { client, select } = clientWithDraftRow(incompleteTargetDraft);
    await getPlannerDraft(client, incompleteTargetDraft.user_id);
    expect(select).toHaveBeenCalledWith(expect.stringContaining("effort_preference"));
  });

  it("returns the effort preference from a fetched draft row", async () => {
    const { client } = clientWithDraftRow({
      ...incompleteTargetDraft,
      effort_preference: "easy",
    });
    await expect(getPlannerDraft(client, incompleteTargetDraft.user_id)).resolves.toMatchObject({
      effortPreference: "easy",
    });
  });
```

- `it("P2: document unload 用保存は keepalive fetch で同一 RPC 引数を送る", ...)` の入力の `noveltyPreference: null,` の直後に `effortPreference: "easy",` を足し、期待値の `p_novelty_preference: null,` の直後に `p_effort_preference: "easy",` を足す（保存引数への写しを固定する）。

`netlify/functions/_shared/generation-context.test.ts` の `snapshot` 定数に `effort_preference: null,` を足し、期待値の `noveltyPreference: null,` の直後に `effortPreference: null,` を足す。Task 1 で足したテストの直後に追加する。

```ts
  it("maps every effort preference value from the snapshot row", async () => {
    for (const value of ["standard", "easy", null] as const) {
      arrangeLoader({ snapshotData: [{ ...snapshot, effort_preference: value }] });
      const context = await loadGenerationContext(
        { userId, accessToken: "access-token" },
        requestId,
        request,
        now,
      );
      expect(context.submission.effortPreference).toBe(value);
    }
  });

  it("maps a missing effort_preference to null", async () => {
    const { effort_preference: _omitted, ...withoutKey } = snapshot;
    void _omitted;
    arrangeLoader({ snapshotData: [withoutKey] });
    const context = await loadGenerationContext(
      { userId, accessToken: "access-token" },
      requestId,
      request,
      now,
    );
    expect(context.submission.effortPreference).toBeNull();
  });
```

- [ ] **Step 11: 失敗を確認する**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/planner/use-draft-autosave.test.tsx src/features/planner/model/draft-from-menu.test.ts src/features/planner/planner-api.test.ts netlify/functions/_shared/generation-context.test.ts`
Expected: 追加したテストが FAIL

- [ ] **Step 12: 実装する**

`netlify/functions/_shared/generation-context.ts` の `mapSnapshot` の `noveltyPreference: row.novelty_preference,` の直後に追加する。

```ts
    // Task 1 で任意キー化（配備ずれ対策）。欠損は未指定として読む
    effortPreference: row.effort_preference ?? null,
```

`src/features/planner/planner-api.ts`:

- `mapPlannerDraft` の `noveltyPreference: row.novelty_preference,` の直後に `effortPreference: row.effort_preference,` を足す。
- `getPlannerDraft` の select 文字列の `novelty_preference,` の直後に `effort_preference,` を足す。
- `buildSaveGenerationDraftArgs` の `p_novelty_preference: input.noveltyPreference,` の直後に `p_effort_preference: input.effortPreference,` を足す。

`src/features/planner/use-draft-autosave.ts`:

- `toDraftInputFields` の `noveltyPreference: value.noveltyPreference,` の直後に `effortPreference: value.effortPreference,` を足す。
- `isEmptyPersistableInput` の `fields.noveltyPreference === null &&` の直後に `fields.effortPreference === null &&` を足す。

`src/features/planner/model/draft-from-menu.ts` の `noveltyPreference: submission.noveltyPreference,` の直後に `effortPreference: submission.effortPreference,` を足す。

`src/features/planner/components/planner-wizard.tsx` の `skipRestOfOptionalSteps` を次にする（コメントの「4フィールド」も直す）。

```ts
  /** 5ページ目の「以降は指定なしでスキップ」。任意5フィールドだけを null にして確認へ直行する。 */
  const skipRestOfOptionalSteps = (): void => {
    onDraftChange({
      ...draft,
      timeLimitMinutes: null,
      effortPreference: null,
      budgetPreference: null,
      ingredientPreference: null,
      noveltyPreference: null,
    });
    goToStep("review");
  };
```

`src/features/planner/model/planner-labels.ts` の `noveltyPreferenceLabels` の直後に追加し、import に `EffortPreference` を足す。

```ts
/**
 * 調理の手間 → 利用者向け日本語。確認画面の任意条件で共有する。
 * easy は手間のかかる料理を避けるソフト目安。揚げ物等が出ないことの保証ではない。
 */
export const effortPreferenceLabels: Readonly<Record<EffortPreference, string>> = {
  standard: "指定なし",
  easy: "手間のかかる料理は避ける",
} as const;
```

`noveltyPreferenceLabel` の直後に追加する。

```ts
export function effortPreferenceLabel(value: EffortPreference | null): string {
  if (value === null) return "指定なし";
  return effortPreferenceLabels[value];
}
```

型が要求する残りの箇所に `effortPreference: null` を足す。次のコマンドで候補を出し、`noveltyPreference: null` や `noveltyPreference: <式>` の直後に同じ形で足す（下書きや submission を別の値から写している箇所は `effortPreference: <元>.effortPreference`）。

```bash
grep -rn "noveltyPreference" src shared netlify --include=*.ts --include=*.tsx | grep -v "\.test\."
```

対象は少なくとも次のとおりである。`planner-route.tsx`（127、154、2045 行目付近）、`audience-step.tsx`（169 行目）、`planner-wizard.tsx`（338 行目付近の初期値。`skipRestOfOptionalSteps` は上で済み）、`revalidation-adapter.ts`（136、754 行目）、`shared/emergency/filter-emergency-menus.ts`（146 行目）、`generation-quality-review-entry.ts`、`paid-openrouter-benchmark-harness.ts`、`shared/testing/factories.ts`。週献立（`weekly-plan-*`、`weekly-plan-draft-handoff.ts`）は Task 4 で扱うが、`weekly-plan-draft-handoff.ts` は `PlannerDraftInput` を返すため型エラーになる。ここでは `effortPreference: null,` を足して型を通し、Task 4 で `plan.effortPreference` へ置き換える。

- [ ] **Step 13: 型が要求するテスト fixture を直す**

Run: `docker compose run --rm --no-deps app npm run typecheck > /tmp/claude-tc.log 2>&1; grep -nE "error TS" /tmp/claude-tc.log | head -60`

出たエラーのうち、テストの fixture（`noveltyPreference: null,` を持つオブジェクト）が `effortPreference` 不足で落ちているものに、`noveltyPreference` の行の直後へ `effortPreference: null,` を足す。対象になりうるファイルは `grep -rln noveltyPreference src shared netlify --include=*.test.ts --include=*.test.tsx` で一覧できる。週献立の fixture は Task 4 で契約を変えるまでは型エラーにならないので、ここでは触らない。エラーが 0 になるまで繰り返す。

- [ ] **Step 14: 通ることを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run shared/contracts/planner.test.ts src/shared/types/database.test.ts src/features/planner netlify/functions/_shared/generation-context.test.ts netlify/functions/_shared/regeneration-adapter.test.ts > /tmp/claude-vt.log 2>&1; grep -nE "FAIL|✗|Error" /tmp/claude-vt.log | head -40 || tail -n 15 /tmp/claude-vt.log`
Expected: PASS

Run: `docker compose run --rm --no-deps app npm run typecheck`、`... npm run lint`、`... npm run format:check`
Expected: いずれもエラーなし

- [ ] **Step 15: コミット**

```bash
git add shared/contracts/planner.ts shared/contracts/planner.test.ts supabase/migrations/20260927120000_effort_preference.sql supabase/tests/database src/shared/types netlify/functions/_shared src/features/planner shared/emergency shared/testing
git status --short   # 意図しないファイルが入っていないか確かめる
git commit -m "feat(planner): 手間軸 effortPreference を契約・下書き・snapshot 経路へ通す" -m "save_generation_draft を 15 引数（p_effort_preference default null）にし、reserve は create or replace で写しを足す。snapshot 取得関数は DROP→CREATE 後に revoke/grant を戻す。手間だけを選んだ下書きも保存する。" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014unHywzrdUis3WSG9mHdbv"
```

---

### Task 3: 生成・再生成のプロンプトへ【手間】段落を載せる

**Files:**
- Create: `netlify/functions/_shared/effort-hints.ts`
- Modify: `netlify/functions/_shared/generation-prompt.ts`（`PromptPreferences`、`buildSystemPrompt`、`buildNewMenuSystemPrompt`、`buildBaseGenerationMessages`、`buildGenerationMessages`）
- Modify: `netlify/functions/_shared/taste-hints.ts:36`、`netlify/functions/_shared/diversity-hints.ts:22`
- Test: `netlify/functions/_shared/generation-prompt.test.ts`
- Create (Test): `netlify/functions/_shared/generation-prompt-effort-off.test.ts`

**Interfaces:**
- Consumes: Task 2 の `PlannerSubmission.effortPreference`
- Produces（Task 4 が使う）:
  - `effort-hints.ts`: `EFFORT_HINTS_ENABLED`、`EFFORT_SYSTEM_MARKER = "【手間】"`、`EFFORT_PARAGRAPH: string`、`WEEKLY_EFFORT_SENTENCE: string`、`shouldIncludeEffortHints(flag: boolean, effortPreference: EffortPreference | null): boolean`（`flag` には呼び出し側で import した `EFFORT_HINTS_ENABLED` を渡す）

**payload の扱い（spec §4.3）:** ひねりの `noveltyExcludedDishes` と同じく、**段落を載せるときだけ** `preferences.effortPreference: "easy"` を載せる。kill-switch を切ると値も消える。既存の payload を検査するテストは変わらない。

**再生成のテスト:** `regenerate_dish` は `regenerate_menu` と同じ `buildBaseGenerationMessages` を通る。`regenerate_dish` の組み立てには実データの promptDto（`dishRegenerationPromptSchema` で parse される）が要るため、テストは `regenerate_menu` で代表させる。

- [ ] **Step 1: 失敗するテストを書く**

`netlify/functions/_shared/generation-prompt.test.ts` の import に `import { EFFORT_PARAGRAPH, EFFORT_SYSTEM_MARKER } from "./effort-hints.js";` を足す。`describe("novelty hints", ...)` の直後に追加する。`regenerateMenuExecution` は novelty の describe 内のローカル関数なので、ここに同じ形の関数を置く。

```ts
describe("effort hints", () => {
  function contextWith(
    effortPreference: GenerationContext["submission"]["effortPreference"],
    noveltyPreference: GenerationContext["submission"]["noveltyPreference"] = null,
  ): GenerationContext {
    const base = makeGenerationContext();
    return {
      ...base,
      submission: { ...base.submission, effortPreference, noveltyPreference, mainIngredients: ["豚肉"] },
    };
  }

  function regenerateMenuExecutionFor(
    context: GenerationContext,
  ): Extract<GenerationExecutionContext, { kind: "regenerate_menu" }> {
    const sourceMenu = makeValidatedMenu();
    return {
      kind: "regenerate_menu",
      command: {
        commandVersion: "generation-command.v3",
        kind: "regenerate_menu",
        qualityMode: false,
        request: {
          idempotencyKey: "56000000-0000-4000-8000-000000000001",
          sourceMenuId: sourceMenu.menuId,
          changeReason: "simpler",
          changeReasonCustom: null,
          privacyNoticeVersion: "2026-07-29.v1",
          expiredPantryConfirmations: [],
        },
      },
      requestId: "81000000-0000-4000-8000-000000000001",
      generationContext: context,
      expectedSafetyFingerprint: createCurrentSafetyFingerprint(context.safety),
      startedAtMonotonicMs: 0,
      deadlineAtMonotonicMs: 50_000,
      regeneration: {
        sourceMenuId: sourceMenu.menuId,
        sourceMenu,
        derivationGroupId: "a1000000-0000-4000-8000-000000000001",
        replaceDishId: null,
        retainedDishIds: sourceMenu.dishes.map((dish) => dish.id),
        excludedDishIds: [],
        sourceSafetyFingerprint: "source-fp",
        sourcePreferenceSnapshot: {},
        existingDerivationMenus: [],
        artifacts: {
          retainedDishes: [],
          sourceDishToReplace: null,
          promptDto: null,
          retainedRefMap: new Map(),
        },
      },
    };
  }

  function preferencesOf(
    messages: ReturnType<typeof buildGenerationMessages>,
  ): Record<string, unknown> {
    return userPayload(messages).preferences as Record<string, unknown>;
  }

  it("adds the effort paragraph and payload value when easy is selected (new_menu household)", () => {
    const messages = buildGenerationMessages(asNewMenuExecution(contextWith("easy")));
    expect(systemText(messages)).toContain(EFFORT_PARAGRAPH);
    expect(preferencesOf(messages).effortPreference).toBe("easy");
  });

  it("adds the effort paragraph for idea mode too", () => {
    const base = makeIdeaGenerationContext();
    const messages = buildGenerationMessages(
      asNewMenuExecution({ ...base, submission: { ...base.submission, effortPreference: "easy" } }),
    );
    expect(systemText(messages)).toContain(EFFORT_PARAGRAPH);
    expect(preferencesOf(messages).effortPreference).toBe("easy");
  });

  it("omits the paragraph and the key when the axis is standard or unset", () => {
    for (const effortPreference of ["standard", null] as const) {
      const messages = buildGenerationMessages(asNewMenuExecution(contextWith(effortPreference)));
      expect(systemText(messages)).not.toContain(EFFORT_SYSTEM_MARKER);
      expect(Object.prototype.hasOwnProperty.call(preferencesOf(messages), "effortPreference")).toBe(
        false,
      );
    }
  });

  it("keeps the paragraph and value on regenerate_menu (shared base builder)", () => {
    const messages = buildGenerationMessages(regenerateMenuExecutionFor(contextWith("easy")));
    expect(systemText(messages)).toContain(EFFORT_PARAGRAPH);
    expect(preferencesOf(messages).effortPreference).toBe("easy");
  });

  it("places the effort paragraph right before the season block, after novelty", () => {
    const messages = buildGenerationMessages(asNewMenuExecution(contextWith("easy", "twist")));
    const system = systemText(messages);
    const noveltyIndex = system.indexOf(NOVELTY_SYSTEM_MARKER);
    const effortIndex = system.indexOf(EFFORT_SYSTEM_MARKER);
    const seasonIndex = system.indexOf(GENERATION_SYSTEM_PROMPT_SEASON);
    expect(noveltyIndex).toBeGreaterThanOrEqual(0);
    expect(effortIndex).toBeGreaterThan(noveltyIndex);
    expect(seasonIndex).toBe(effortIndex + EFFORT_PARAGRAPH.length);
  });

  it("places the effort paragraph right before the season block on regeneration", () => {
    const messages = buildGenerationMessages(regenerateMenuExecutionFor(contextWith("easy")));
    const system = systemText(messages);
    const effortIndex = system.indexOf(EFFORT_SYSTEM_MARKER);
    expect(effortIndex).toBeGreaterThanOrEqual(0);
    expect(system.indexOf(GENERATION_SYSTEM_PROMPT_SEASON)).toBe(
      effortIndex + EFFORT_PARAGRAPH.length,
    );
  });

  it("states that effort overrides the kitchen paragraph and novelty's cooking-method twist", () => {
    expect(EFFORT_PARAGRAPH).toContain("【家庭キッチン】より優先");
    expect(EFFORT_PARAGRAPH).toContain("蒸し物そのものを選ばない");
    expect(EFFORT_PARAGRAPH).toContain("【ひねり】");
    for (const example of ["揚げ物", "蒸し物", "生地", "包む"]) {
      expect(EFFORT_PARAGRAPH).toContain(example);
    }
  });

  it("names effort in the priority sentence (diversity and taste variants)", () => {
    expect(DIVERSITY_PARAGRAPH).toContain("（メイン食材・避けたい・手間等）");
    expect(TASTE_PARAGRAPH).toContain("（メイン食材・避けたい・手間等）");
  });
});
```

`userPayload` は最初の user message（base の payload）を読むので、再生成でも base の preferences を検査できる。`systemText` / `asNewMenuExecution` / `makeIdeaGenerationContext` / `makeValidatedMenu` / `DIVERSITY_PARAGRAPH` / `TASTE_PARAGRAPH` / `NOVELTY_SYSTEM_MARKER` / `GENERATION_SYSTEM_PROMPT_SEASON` は同ファイルで既に import 済み。

`netlify/functions/_shared/generation-prompt-effort-off.test.ts` を作る。

```ts
/**
 * 手間 kill-switch off 時の prompt 合成。
 * EFFORT_HINTS_ENABLED を mock するため専用ファイルにする（novelty-off と同型）。
 */
import { describe, expect, it, vi } from "vitest";
import { makeGenerationContext } from "../../../shared/testing/factories.js";
import { createCurrentSafetyFingerprint } from "../../../shared/safety/fingerprint.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";

const effortState = vi.hoisted(() => ({ enabled: false }));

vi.mock("./effort-hints.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./effort-hints.js")>();
  return {
    ...actual,
    get EFFORT_HINTS_ENABLED() {
      return effortState.enabled;
    },
  };
});

import { EFFORT_SYSTEM_MARKER } from "./effort-hints.js";
import { buildGenerationMessages } from "./generation-prompt.js";
import type { GenerationExecutionContext } from "./generation-service.js";

function asNewMenuExecution(
  context: GenerationContext,
): Extract<GenerationExecutionContext, { kind: "new_menu" }> {
  return {
    kind: "new_menu",
    command: {
      commandVersion: "generation-command.v3",
      kind: "new_menu",
      qualityMode: false,
      request: {
        idempotencyKey: "56000000-0000-4000-8000-000000000001",
        draftId: "84000000-0000-4000-8000-000000000001",
        draftRevision: 1,
        privacyNoticeVersion: "2026-07-29.v1",
        expiredPantryConfirmations: [],
      },
    },
    requestId: "81000000-0000-4000-8000-000000000001",
    generationContext: context,
    expectedSafetyFingerprint:
      context.targetMode === "idea" ? "idea" : createCurrentSafetyFingerprint(context.safety),
    startedAtMonotonicMs: 0,
    deadlineAtMonotonicMs: 50_000,
    regeneration: null,
    recentDishHints: [],
    tasteHints: null,
  };
}

describe("buildGenerationMessages effort off", () => {
  it("drops both the paragraph and the payload value even when easy is selected", () => {
    const base = makeGenerationContext();
    const context: GenerationContext = {
      ...base,
      submission: { ...base.submission, effortPreference: "easy" },
    };
    const messages = buildGenerationMessages(asNewMenuExecution(context));
    const systemMessage = messages.find((message) => message.role === "system");
    const system = typeof systemMessage?.content === "string" ? systemMessage.content : "";
    expect(system).not.toContain(EFFORT_SYSTEM_MARKER);
    const userMessage = messages.find((message) => message.role === "user");
    const userContent = typeof userMessage?.content === "string" ? userMessage.content : "";
    expect(userContent).not.toContain("effortPreference");
  });
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/generation-prompt.test.ts netlify/functions/_shared/generation-prompt-effort-off.test.ts`
Expected: FAIL（`./effort-hints.js` が無い）

- [ ] **Step 3: `effort-hints.ts` を作る**

```ts
/**
 * 手間軸（effortPreference=easy）の prompt 専用ヒント。
 * fail-open・prompt 専用。fingerprint / quota / 検証には載せない。
 * novelty-hints.ts と同型。日次（生成・再生成）と週献立で共用する。
 */
import type { EffortPreference } from "../../../shared/contracts/planner.js";

export const EFFORT_HINTS_ENABLED = true as const;
export const EFFORT_SYSTEM_MARKER = "【手間】" as const;

/** 避ける料理の列挙。日次の段落と週献立の 1 文で共用し、両者の範囲を揃える */
const EFFORT_AVOID_EXAMPLES =
  "揚げ物（揚げ焼きを含む）、蒸し物、長時間の煮込み、オーブン料理、" +
  "生地や衣から作る料理、包む・巻く・詰めるなどの成形工程が多い料理";

/** system 文の手間段落。先頭マーカーでテスト・運用識別する */
export const EFFORT_PARAGRAPH =
  EFFORT_SYSTEM_MARKER +
  "preferences.effortPreferenceがeasyのため、主菜・副菜・汁物・主食のすべてで手間のかかる料理を避けてください。" +
  `避ける例: ${EFFORT_AVOID_EXAMPLES}。` +
  "料理の選択では本段落が【家庭キッチン】より優先します。" +
  "蒸し物は、ふた付きフライパンや電子レンジで蒸す手順に置き換えるのではなく、蒸し物そのものを選ばないでください。" +
  "【ひねり】で別の加熱法や組み合わせを選ぶ場合も、避ける例の調理法は選ばないでください。" +
  "焼く・炒める・短時間で煮る・和える・電子レンジで済む料理に寄せてください。" +
  "安全条件・アレルギーが常に優先です。" +
  "寄せきれなくてもoutcome=successで構いません。手間の方針だけではconstraint_conflictにしないでください。";

/** 週献立の system 文へ足す 1 文。週献立の出力は主菜だけなので主菜に限る */
export const WEEKLY_EFFORT_SENTENCE =
  "preferences.effortPreferenceがeasyのため、7日分の主菜で手間のかかる料理を避けてください。" +
  `避ける例: ${EFFORT_AVOID_EXAMPLES}。` +
  "寄せきれなくても7日分の出力を続けてください。";

/**
 * easy かつ kill-switch on のときだけ段落と payload 値を載せる。
 * flag は呼び出し側が import した EFFORT_HINTS_ENABLED を渡す（taste-hints の isTasteHintsEnabled と同型）。
 * このモジュール内で定数を直接読むと、*-off テストの vi.mock が効かない。
 * `true as const` を条件へ直接置くと lint が死枝扱いするため boolean 引数で広げる意味もある。
 */
export function shouldIncludeEffortHints(
  flag: boolean,
  effortPreference: EffortPreference | null,
): boolean {
  return flag && effortPreference === "easy";
}
```

- [ ] **Step 4: `generation-prompt.ts` を直す**

import に追加する。

```ts
import { EFFORT_HINTS_ENABLED, EFFORT_PARAGRAPH, shouldIncludeEffortHints } from "./effort-hints.js";
```

`PromptPreferences` に追加する（`memo: string;` の直後）。

```ts
  /** easy かつ kill-switch on のときだけ載せる。standard / 未指定 / off ではキーごと出さない */
  effortPreference?: "easy";
```

`buildSystemPrompt` を次にする。

```ts
function buildSystemPrompt(
  targetMode: GenerationContext["targetMode"],
  effortEnabled: boolean,
): string {
  // 実行時に kill-switch を読む（静的 CORE スナップショットだけでは flag off が再生成に効かない）
  const coreBody = buildGenerationSystemPromptCoreBody(readHouseholdKitchenPromptEnabledFlag());
  // 手間段落は再生成でも載せる（spec §4.3）。位置は SEASON の直前
  const effort = effortEnabled ? EFFORT_PARAGRAPH : "";
  const core = `${coreBody}${effort}${GENERATION_SYSTEM_PROMPT_SEASON}`;
  if (targetMode === "idea") {
    return `${core}${GENERATION_SYSTEM_PROMPT_IDEA_EXTRA}`;
  }
  return `${core}${GENERATION_SYSTEM_PROMPT_HOUSEHOLD_EXTRA}`;
}
```

`buildNewMenuSystemPrompt` に引数 `effortEnabled: boolean` を `tasteEnabled` の後に足し、戻り値を次にする（関数の JSDoc の並びも「ひねり? + 手間? + SEASON」に直す）。

```ts
  const effort = effortEnabled ? EFFORT_PARAGRAPH : "";
  return `${coreBody}${diversity}${taste}${novelty}${effort}${GENERATION_SYSTEM_PROMPT_SEASON}${modeExtra}`;
```

`buildBaseGenerationMessages` の冒頭（`const seasonContext = ...` の直後）に追加する。

```ts
  const effortEnabled = shouldIncludeEffortHints(
    EFFORT_HINTS_ENABLED,
    context.submission.effortPreference,
  );
  const effortPreferenceEntry = effortEnabled ? { effortPreference: "easy" as const } : {};
```

idea 分岐と household 分岐の `preferences` オブジェクトの `memo: context.submission.memo,` の直後に、それぞれ `...effortPreferenceEntry,` を足す。idea 分岐の `buildSystemPrompt("idea")` を `buildSystemPrompt("idea", effortEnabled)` に、household 分岐の `buildSystemPrompt(context.targetMode)` を `buildSystemPrompt(context.targetMode, effortEnabled)` にする。

`buildGenerationMessages` の new_menu 分岐で、`buildNewMenuSystemPrompt(...)` の呼び出しを次にする。

```ts
    const systemContent = buildNewMenuSystemPrompt(
      context.generationContext.targetMode,
      diversityEnabled,
      noveltyEnabled,
      tasteEnabled,
      shouldIncludeEffortHints(
        EFFORT_HINTS_ENABLED,
        context.generationContext.submission.effortPreference,
      ),
    );
```

同関数の JSDoc の「new_menu: CORE_BODY + 多様性?(...) + 学習? + ひねり? + SEASON + idea?」を「... + ひねり? + 手間? + SEASON + idea?」に、「再生成: base + regeneration_constraints。」の後に「手間段落は base 側で載る。」を足す。

- [ ] **Step 5: 優先順位の文を直す**

`netlify/functions/_shared/taste-hints.ts:36` の `"2)当日のpreferences（メイン食材・避けたい等）、" +` を `"2)当日のpreferences（メイン食材・避けたい・手間等）、" +` にする。

`netlify/functions/_shared/diversity-hints.ts:22` の `"2)利用者のpreferences（メイン食材・避けたい等）、" +` を `"2)利用者のpreferences（メイン食材・避けたい・手間等）、" +` にする。

この 2 文字列は hints ファイルの外では検査されていない（`grep -rn "避けたい等" netlify shared src` のヒットは 2 つの hints ファイルだけ）。

- [ ] **Step 6: 通ることを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/generation-prompt.test.ts netlify/functions/_shared/generation-prompt-effort-off.test.ts netlify/functions/_shared/generation-prompt-novelty-off.test.ts netlify/functions/_shared/generation-prompt-kitchen-off.test.ts netlify/functions/_shared/generation-prompt-diversity-off.test.ts netlify/functions/_shared/generation-prompt-taste-off.test.ts netlify/functions/_shared/taste-hints.test.ts netlify/functions/_shared/regeneration-prompt.test.ts`
Expected: PASS

Run: `docker compose run --rm --no-deps app npm run typecheck`、`... npm run lint`、`... npm run format:check`
Expected: いずれもエラーなし

- [ ] **Step 7: コミット**

```bash
git add netlify/functions/_shared/effort-hints.ts netlify/functions/_shared/generation-prompt.ts netlify/functions/_shared/generation-prompt.test.ts netlify/functions/_shared/generation-prompt-effort-off.test.ts netlify/functions/_shared/taste-hints.ts netlify/functions/_shared/diversity-hints.ts
git commit -m "feat(generation): 手間段落を新規生成と再生成の system へ載せる" -m "easy かつ kill-switch on のときだけ【手間】段落と preferences.effortPreference を載せる。家庭キッチンとひねりより料理の選択を優先し、優先順位の文に手間を加える。" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014unHywzrdUis3WSG9mHdbv"
```

---

### Task 4: 週献立に手間の切り替えを通す

**Files:**
- Modify: `shared/contracts/weekly-plan.ts:43,90`（リクエストとレスポンス）
- Modify: `netlify/functions/_shared/weekly-plan-service.ts`（`weeklyPlanRowSchema`、`intentRowSchema`、`WeeklyPlanSnapshot`、`snapshotFromRequest`、`buildResultFromRow`、`insertWeeklyPlanRow`、replay 2 か所、成功レスポンス）
- Modify: `netlify/functions/_shared/weekly-plan-prompt.ts`
- Modify: `src/features/weekly-plan/pages/weekly-plan-form-page.tsx`、`src/features/weekly-plan/weekly-plan-draft-handoff.ts`
- Test: `shared/contracts/weekly-plan.test.ts`、`netlify/functions/_shared/weekly-plan-service.pipeline.test.ts`、`netlify/functions/_shared/weekly-plan-prompt.test.ts`、`src/features/weekly-plan/weekly-plan-draft-handoff.test.ts`、`src/features/weekly-plan/pages/weekly-plan-form-page.test.tsx`

**Interfaces:**
- Consumes: Task 2 の `effortPreferences` / `EffortPreference`、`effortPreferenceLabels`。Task 3 の `WEEKLY_EFFORT_SENTENCE`、`shouldIncludeEffortHints`
- Produces: `WeeklyPlanRequest.effortPreference: EffortPreference | null`、`WeeklyPlanResult.effortPreference: EffortPreference | null`

- [ ] **Step 1: 契約の失敗テストを書く**

`shared/contracts/weekly-plan.test.ts` に 2 つ追加する。

```ts
  it("defaults a missing effortPreference to null and rejects unknown values on the request", () => {
    // base は effortPreference を持たない（導入前に保持された試行メタデータを模擬）
    expect(weeklyPlanRequestSchema.parse(base).effortPreference).toBeNull();
    expect(
      weeklyPlanRequestSchema.parse({ ...base, effortPreference: "easy" }).effortPreference,
    ).toBe("easy");
    expect(
      weeklyPlanRequestSchema.safeParse({ ...base, effortPreference: "wild" }).success,
    ).toBe(false);
  });

  it("carries effortPreference through on the result and defaults it to null when absent", () => {
    const withValue = weeklyPlanResultSchema.parse({ ...baseResult, effortPreference: "easy" });
    expect(withValue.effortPreference).toBe("easy");
    expect(weeklyPlanResultSchema.parse(baseResult).effortPreference).toBeNull();
  });
```

リクエストの test は `describe("weeklyPlanRequestSchema", ...)` の中（`base` がある場所）に、結果の test は `it("carries budgetPreference/noveltyPreference through when non-null", ...)` の直後（`baseResult` がある場所）に置く。`base` と `baseResult` には `effortPreference` を足さない。

- [ ] **Step 2: サービスの失敗テストを書く**

`netlify/functions/_shared/weekly-plan-service.pipeline.test.ts`:

- `sampleRequest()` に `effortPreference: null,` を足す。
- `it("persists priorityIngredients into the intent snapshot and echoes them in the result", ...)` の直後に追加する。モックの組み立ては同テストと同一で、入力と検査だけが違う（共有ヘルパーへの抽出はしない）。

```ts
  it("persists effortPreference into the intent snapshot and the inserted row, and echoes it", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lookup_flyer_weekly")
        return Promise.resolve({ data: { kind: "miss" }, error: null });
      if (name === "reserve_flyer_weekly") {
        return Promise.resolve({
          data: {
            request_id: "33333333-3333-4333-8333-333333333333",
            idempotency_key: "k1",
            status: "processing",
            replayed: false,
            week_start: "2026-09-07",
          },
          error: null,
        });
      }
      if (name === "put_weekly_plan_intent") return Promise.resolve({ data: null, error: null });
      if (name === "mark_flyer_weekly_sent")
        return Promise.resolve({ data: { sent: true }, error: null });
      if (name === "finalize_flyer_weekly_success")
        return Promise.resolve({ data: {}, error: null });
      if (name === "delete_weekly_plan_intent") return Promise.resolve({ data: null, error: null });
      throw new Error(`unexpected rpc: ${name}`);
    });
    let capturedInsertPayload: Record<string, unknown> | undefined;
    fromMock.mockImplementation((table: string) => {
      if (table === "household_members") {
        return thenableQuery({ data: [{ id: sampleMemberId }], error: null });
      }
      if (table === "weekly_plans") {
        const query = thenableQuery({
          data: { id: "44444444-4444-4444-8444-444444444444" },
          error: null,
        });
        query.insert = vi.fn((payload: Record<string, unknown>) => {
          capturedInsertPayload = payload;
          return query;
        });
        return query;
      }
      throw new Error(`unexpected table: ${table}`);
    });
    const sender = vi.fn().mockResolvedValue({
      mode: "flyer_weekly",
      output: sampleAiMenu(),
      modelId: "m1",
    });

    const result = await runWeeklyPlan(baseDeps({ openRouterSender: sender }), {
      ...sampleRequest(),
      effortPreference: "easy",
    });

    expect(sender).toHaveBeenCalledTimes(1);
    expect(rpcArgsFor("put_weekly_plan_intent")).toMatchObject({
      p_snapshot: { effortPreference: "easy" },
    });
    // insertWeeklyPlanRow はフィールドごとのリテラルで組み立てるため、足し忘れを型で検出できない
    expect(capturedInsertPayload).toMatchObject({
      preference_snapshot: { effortPreference: "easy" },
    });
    expect(result.effortPreference).toBe("easy");
  });
```

- `describe("getWeeklyPlan", ...)` の `it("degrades out-of-bounds priorityIngredients ...")` の直後に追加する。行の組み立ては同テストと同一で、`preference_snapshot` だけを引数で変える。

```ts
  function adminReturningWeeklyPlanSnapshot(
    preferenceSnapshot: Record<string, unknown>,
  ): AdminSupabaseClient {
    return {
      from: vi.fn((table: string) => {
        if (table === "weekly_plans") {
          return thenableQuery({
            data: {
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              week_start: "2026-09-07",
              preference_snapshot: preferenceSnapshot,
              safety_fingerprint: "a".repeat(64),
              days: sampleAiMenu().days,
            },
            error: null,
          });
        }
        if (table === "household_members") {
          return thenableQuery({ data: [], error: null });
        }
        throw new Error(`unexpected table: ${table}`);
      }),
    } as unknown as AdminSupabaseClient;
  }

  const preFeatureSnapshot = {
    targetMemberIds: [sampleMemberId],
    cuisineGenre: "japanese",
    budgetPreference: null,
    noveltyPreference: null,
    priorityIngredients: [],
  };

  it("reads a saved effortPreference back on GET", async () => {
    const admin = adminReturningWeeklyPlanSnapshot({ ...preFeatureSnapshot, effortPreference: "easy" });
    const result = await getWeeklyPlan(admin, "u1", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(result.effortPreference).toBe("easy");
  });

  it("reads a pre-feature snapshot without effortPreference as null", async () => {
    const admin = adminReturningWeeklyPlanSnapshot(preFeatureSnapshot);
    const result = await getWeeklyPlan(admin, "u1", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(result.effortPreference).toBeNull();
  });

  it("degrades an out-of-range effortPreference in the snapshot to null instead of failing", async () => {
    const admin = adminReturningWeeklyPlanSnapshot({ ...preFeatureSnapshot, effortPreference: "wild" });
    const result = await getWeeklyPlan(admin, "u1", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(result.effortPreference).toBeNull();
  });
```

POST で insert した値と GET で返す値は、上の insert の検査と「reads a saved effortPreference back on GET」の 2 つで両端を固定する（POST→GET を 1 本でつなぐテストは stash 経路の組み立てが大きいため足さない）。

- [ ] **Step 3: プロンプトの失敗テストを書く**

`netlify/functions/_shared/weekly-plan-prompt.test.ts` の `sampleRequest` に `effortPreference: null,` を足し、import に `WEEKLY_EFFORT_SENTENCE` を `./effort-hints.js` から足す。`it("serializes priorityIngredients into the preferences payload", ...)` の直後に追加する。

```ts
  it("adds the weekly effort sentence and payload value only when easy is selected", () => {
    const easy = buildWeeklyPlanMessages({ ...sampleRequest, effortPreference: "easy" }, sampleSafety());
    const easySystem = typeof easy[0]?.content === "string" ? easy[0].content : "";
    expect(easySystem).toContain(WEEKLY_EFFORT_SENTENCE);
    expect(WEEKLY_EFFORT_SENTENCE).toContain("生地");
    expect(WEEKLY_EFFORT_SENTENCE).toContain("包む");
    const easyUser = typeof easy[1]?.content === "string" ? easy[1].content : "";
    const easyPayload = JSON.parse(easyUser.replace(/<\/?kondate_weekly_plan_input>/gu, "")) as {
      preferences: Record<string, unknown>;
    };
    expect(easyPayload.preferences.effortPreference).toBe("easy");

    for (const effortPreference of ["standard", null] as const) {
      const messages = buildWeeklyPlanMessages({ ...sampleRequest, effortPreference }, sampleSafety());
      const system = typeof messages[0]?.content === "string" ? messages[0].content : "";
      expect(system).not.toContain(WEEKLY_EFFORT_SENTENCE);
      const user = typeof messages[1]?.content === "string" ? messages[1].content : "";
      expect(user).not.toContain("effortPreference");
    }
  });

  it("places the weekly effort sentence right after the priorityIngredients sentence", () => {
    const messages = buildWeeklyPlanMessages({ ...sampleRequest, effortPreference: "easy" }, sampleSafety());
    const system = typeof messages[0]?.content === "string" ? messages[0].content : "";
    const priorityEnd = system.indexOf("7日の献立に優先的に取り入れてください。") +
      "7日の献立に優先的に取り入れてください。".length;
    expect(system.indexOf(WEEKLY_EFFORT_SENTENCE)).toBe(priorityEnd);
  });
```

- [ ] **Step 4: 引き継ぎとフォームの失敗テストを書く**

`src/features/weekly-plan/weekly-plan-draft-handoff.test.ts` の `it("carries budgetPreference/noveltyPreference through when non-null", ...)` の直後に追加する（`plan` fixture は同テストと同じものを使う）。

```ts
  it("carries effortPreference through to the planner draft", () => {
    const outcome = buildPlannerDraftInputFromWeeklyPlanDay(
      day,
      { ...plan, effortPreference: "easy" as const },
      [memberId],
    );
    if (!("input" in outcome)) throw new Error("expected input");
    expect(outcome.input.effortPreference).toBe("easy");
  });
```

`src/features/weekly-plan/pages/weekly-plan-form-page.test.tsx`:

- `it("submits all complete members with sticky defaults ...")` の `toMatchObject` の `noveltyPreference: null,` の直後に `effortPreference: null,` を足す（既定は未指定で送ることを固定する）。
- `it("presents one standard choice for each nullable preference", ...)` の `toHaveLength(2)` を `toHaveLength(3)` にする（予算・目新しさ・手間の 3 つ）。
- `it("restores a successful result and rotates the key only on explicit new request", ...)` の sessionStorage の `request` には `effortPreference` を**足さない**。導入前に保持されたメタデータの読み込みを固定するテストとして残す。
- `it("presents one standard choice ...")` の直後に追加する。

```ts
  it("submits effortPreference easy when 手間のかかる料理は避ける is picked", async () => {
    postWeeklyPlanMock.mockResolvedValue({
      weeklyPlanId: "33333333-3333-4333-8333-333333333333",
    });
    const user = userEvent.setup();
    renderPage();
    const effortGroup = screen.getByRole("group", { name: "調理の手間" });
    await user.click(within(effortGroup).getByRole("radio", { name: "手間のかかる料理は避ける" }));
    await user.click(screen.getByRole("button", { name: "今週の献立をつくる" }));
    await waitFor(() => {
      expect(postWeeklyPlanMock).toHaveBeenCalledTimes(1);
    });
    const [, body] = postWeeklyPlanMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).toMatchObject({ effortPreference: "easy", noveltyPreference: null });
  });
```

`within` が未 import なら `@testing-library/react` の import に足す。

- [ ] **Step 5: 失敗を確認する**

Run: `docker compose run --rm --no-deps app npx vitest run shared/contracts/weekly-plan.test.ts netlify/functions/_shared/weekly-plan-service.pipeline.test.ts netlify/functions/_shared/weekly-plan-prompt.test.ts src/features/weekly-plan`
Expected: 追加したテストが FAIL

- [ ] **Step 6: 契約を実装する**

`shared/contracts/weekly-plan.ts`: import に `effortPreferences` を足す。`weeklyPlanRequestSchema` の `noveltyPreference: ...,` の直後に追加する。

```ts
    // default(null): 導入前に保持された試行メタデータ（sessionStorage 再送）が
    // このキーを持たなくても、欠損を「未指定」として読み再送を失敗させない。範囲外は拒否する。
    effortPreference: z.enum(effortPreferences).nullable().default(null),
```

レスポンス schema（90 行目付近）の `noveltyPreference: ...,` の直後に追加する。

```ts
    // default(null): additive field。デプロイ/rollback またぎでこのキーを返さない
    // 旧 Function のレスポンスを新クライアントが strict parse で落とさないようにする。
    effortPreference: z.enum(effortPreferences).nullable().default(null),
```

- [ ] **Step 7: サービスを実装する**

`netlify/functions/_shared/weekly-plan-service.ts`:

- import に `effortPreferences, type EffortPreference` を `../../../shared/contracts/planner.js` から足す。
- `weeklyPlanRowSchema` と `intentRowSchema` の `preference_snapshot` の `noveltyPreference: z.string().nullable(),` の直後に、それぞれ追加する。

  ```ts
      // catch(null): 導入前の行/intent はこのキーを持たない。範囲外の値でも GET を恒久的な 500 にしない
      effortPreference: z.enum(effortPreferences).nullable().catch(null),
  ```

- `WeeklyPlanSnapshot` に `effortPreference: EffortPreference | null;` を足す。
- 次の各箇所で、`noveltyPreference: <X>.noveltyPreference,` の直後に `effortPreference: <X>.effortPreference,` を足す（`<X>` は同じ行の式）。
  - `snapshotFromRequest`（`request`）
  - `buildResultFromRow`（`snapshot`）
  - `insertWeeklyPlanRow` の `preference_snapshot` リテラル（`snapshot`）
  - `replaySucceededWeeklyPlan` と `replayStashedWeeklyPlan` の結果組み立て（`intent.data.preference_snapshot`、2 か所）
  - 成功レスポンスの組み立て（`snapshot`、1184 行目付近）

  足した後に `grep -n "noveltyPreference" netlify/functions/_shared/weekly-plan-service.ts` と `grep -n "effortPreference" netlify/functions/_shared/weekly-plan-service.ts` を並べ、行が 1 対 1 で対応することを確かめる（schema 2、型 1、写し 6 の計 9 行ずつ）。

- [ ] **Step 8: プロンプトを実装する**

`netlify/functions/_shared/weekly-plan-prompt.ts`:

```ts
import {
  EFFORT_HINTS_ENABLED,
  WEEKLY_EFFORT_SENTENCE,
  shouldIncludeEffortHints,
} from "./effort-hints.js";
```

`serializeWeeklyPlanPayload` の `preferences` の `noveltyPreference: request.noveltyPreference,` の直後に追加する。

```ts
      // easy かつ kill-switch on のときだけ載せる（日次と同じ規約）
      ...(shouldIncludeEffortHints(EFFORT_HINTS_ENABLED, request.effortPreference)
        ? { effortPreference: "easy" as const }
        : {}),
```

`buildWeeklyPlanMessages` の system content の `"7日の献立に優先的に取り入れてください。" +` の直後に追加する。

```ts
        (shouldIncludeEffortHints(EFFORT_HINTS_ENABLED, request.effortPreference)
          ? WEEKLY_EFFORT_SENTENCE
          : "") +
```

- [ ] **Step 9: フォームと引き継ぎを実装する**

`src/features/weekly-plan/weekly-plan-draft-handoff.ts`: `Pick<WeeklyPlanResult, ...>` に `| "effortPreference"` を足し、Task 2 で仮に置いた `effortPreference: null,` を `effortPreference: plan.effortPreference,` にする。

`src/features/weekly-plan/pages/weekly-plan-form-page.tsx`:

- import に `effortPreferences` を `@shared/contracts/planner` から、`effortPreferenceLabels` を `noveltyPreferenceLabels` と同じ import 元から足す。
- `noveltyPreference` の state の直後に追加する。

  ```tsx
  const [effortPreference, setEffortPreference] = useState<
    (typeof effortPreferences)[number] | null
  >(null);
  ```

- 送信の `request` の `noveltyPreference,` の直後に `effortPreference,` を足す。
- 「目新しさ」の `</fieldset>` の直後に追加する。

  ```tsx
      <fieldset className="stack">
        <legend>調理の手間</legend>
        {([null, "easy"] as const).map((preference) => (
          <label key={preference ?? "default"} className="wizard-option min-h-11">
            <input
              type="radio"
              name="weekly-effort"
              checked={
                preference === null ? effortPreference !== "easy" : effortPreference === "easy"
              }
              disabled={requestActive}
              onChange={() => {
                setEffortPreference(preference);
              }}
            />
            {preference === null ? "標準" : effortPreferenceLabels.easy}
          </label>
        ))}
      </fieldset>
  ```

- [ ] **Step 10: 型が要求する fixture を直す**

Run: `docker compose run --rm --no-deps app npm run typecheck > /tmp/claude-tc.log 2>&1; grep -nE "error TS" /tmp/claude-tc.log | head -60`

週献立の fixture（`weekly-plan-api.test.ts`、`weekly-plan-result-page.test.tsx`、`use-weekly-plan.test.ts`、`netlify/functions/_tests/weekly-plan-idempotency.test.ts`、`weekly-plan-service.pipeline.test.ts` の各 `preference_snapshot` など）で出たエラーに、`noveltyPreference` の行の直後へ `effortPreference: null,` を足す。エラーが 0 になるまで繰り返す。

- [ ] **Step 11: 通ることを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run shared/contracts/weekly-plan.test.ts netlify/functions/_shared/weekly-plan-service.pipeline.test.ts netlify/functions/_shared/weekly-plan-service.test.ts netlify/functions/_shared/weekly-plan-prompt.test.ts netlify/functions/_tests/weekly-plan-idempotency.test.ts src/features/weekly-plan > /tmp/claude-vt.log 2>&1; grep -nE "FAIL|✗" /tmp/claude-vt.log | head -40 || tail -n 15 /tmp/claude-vt.log`
Expected: PASS

Run: `docker compose run --rm --no-deps app npm run typecheck`、`... npm run lint`、`... npm run format:check`
Expected: いずれもエラーなし

- [ ] **Step 12: コミット**

```bash
git add shared/contracts/weekly-plan.ts shared/contracts/weekly-plan.test.ts netlify/functions/_shared/weekly-plan-service.ts netlify/functions/_shared/weekly-plan-service.pipeline.test.ts netlify/functions/_shared/weekly-plan-prompt.ts netlify/functions/_shared/weekly-plan-prompt.test.ts netlify/functions/_tests src/features/weekly-plan
git status --short
git commit -m "feat(weekly-plan): 週献立に手間の切り替えを通す" -m "リクエスト・snapshot・insert・replay・応答の全経路に effortPreference を写し、easy のときだけ週献立の system へ 1 文を足す。導入前と範囲外の snapshot は null に落とす。" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014unHywzrdUis3WSG9mHdbv"
```

---

### Task 5: ウィザードに「6. 調理の手間」を足し、確認画面に行を足す

**Files:**
- Modify: `src/features/planner/model/planner-wizard.ts:4-18`
- Modify: `src/features/planner/components/planner-wizard.tsx`（`optionalPlannerSteps`、コメント、`timeLimit` / `budget` の遷移、新しい `effort` 分岐、見出し番号）
- Modify: `src/features/planner/components/review-step.tsx`（見出し「10. 確認」、手間の行）
- Test（新規の固定）: `src/features/planner/components/planner-wizard.test.tsx`、`src/features/planner/model/planner-wizard.test.ts`
- Test（追随）: 下の Step 6 の一覧
- E2E: `e2e/specs/full-journey.spec.ts`、`e2e/specs/mobile-accessibility.spec.ts`、`e2e/specs/generation-recovery-results.spec.ts`、ほか「9. 確認」を持つ e2e

**Interfaces:**
- Consumes: Task 2 の `effortPreferenceLabel`、`effortPreferenceLabels`、`PlannerDraftInput.effortPreference`
- Produces: `PlannerStep` に `"effort"` が加わる

- [ ] **Step 1: 失敗するテストを書く**

`src/features/planner/model/planner-wizard.test.ts` の `plannerSteps` の完全一致の期待値を、次の配列にする。

```ts
[
  "meal",
  "ingredients",
  "cuisine",
  "audience",
  "timeLimit",
  "effort",
  "budget",
  "ingredientPreference",
  "novelty",
  "review",
]
```

`src/features/planner/components/planner-wizard.test.tsx` の `it("walks the four optional steps into the review step and keeps the picks", ...)` を「five optional steps」に改名し、「15分以内」を選んで次へ進んだ直後に手間の段を挟む。

```ts
    expect(screen.getByRole("heading", { name: "6. 調理の手間" })).toBeInTheDocument();
    await user.click(optionLabel("手間のかかる料理は避ける"));
    await passActivationGuard();
    await user.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.getByRole("heading", { name: "7. 予算" })).toBeInTheDocument();
```

以降の見出しを「8. 材料の使い方」「9. 献立の雰囲気」に直し、最後の draft の検査に `effortPreference: "easy"` を足す。

既存の `it("skips the rest of the optional steps with all four fields null", ...)` を次に置き換える（手間を選んだ draft から始め、スキップで null になることまで固定する）。

```ts
  it("skips the rest of the optional steps with all five fields null", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { latestDraft } = renderAtTimeLimit({ effortPreference: "easy" });
    await passActivationGuard();
    await user.click(screen.getByRole("button", { name: "以降は指定なしでスキップ" }));
    expect(screen.getByRole("heading", { name: "10. 確認" })).toBeInTheDocument();
    expect(latestDraft()).toMatchObject({
      timeLimitMinutes: null,
      effortPreference: null,
      budgetPreference: null,
      ingredientPreference: null,
      noveltyPreference: null,
    });
  });
```

`test("returns to review from an optional step opened from 変更", ...)` の直後に 2 つ追加する。

```ts
  test("goes back from effort to timeLimit and forward to budget", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness initialStep="effort" initialDraft={reviewDraft} />);
    expect(screen.getByRole("heading", { name: "6. 調理の手間" })).toBeInTheDocument();
    await passActivationGuard();
    await user.click(screen.getByRole("button", { name: "戻る" }));
    expect(screen.getByRole("heading", { name: "5. 調理時間" })).toBeInTheDocument();
    await passActivationGuard();
    await user.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.getByRole("heading", { name: "6. 調理の手間" })).toBeInTheDocument();
    await passActivationGuard();
    await user.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.getByRole("heading", { name: "7. 予算" })).toBeInTheDocument();
  });

  test("returns to review after editing effort from 変更, and review's 戻る still goes to novelty", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness initialStep="review" initialDraft={reviewDraft} />);
    await user.click(screen.getByRole("button", { name: "調理の手間を変更" }));
    expect(screen.getByRole("heading", { name: "6. 調理の手間" })).toBeInTheDocument();
    await user.click(optionLabel("手間のかかる料理は避ける"));
    await passActivationGuard();
    await user.click(screen.getByRole("button", { name: "確認に戻る" }));
    expect(screen.getByRole("heading", { name: "10. 確認" })).toBeInTheDocument();
    expect(screen.getByText("手間のかかる料理は避ける")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "戻る" }));
    expect(screen.getByRole("heading", { name: "9. 献立の雰囲気" })).toBeInTheDocument();
  });
```

Step 3 で段を足すまでは、見出し「6. 調理の手間」やボタン「調理の手間を変更」が見つからずに落ちる（それが RED）。

`test("shows the optional condition answers as review summary rows", ...)` の入力に `effortPreference: "easy"` を足し、検査に次の 2 行を足す。

```ts
    expect(screen.getByText("調理の手間")).toBeInTheDocument();
    expect(screen.getByText("手間のかかる料理は避ける")).toBeInTheDocument();
```

`test("shows 指定なし for unanswered optional conditions", ...)` の入力に `effortPreference: null` を足し、`toHaveLength(4)` を `toHaveLength(5)` にする。

- [ ] **Step 2: 失敗を確認する**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/planner/model/planner-wizard.test.ts src/features/planner/components/planner-wizard.test.tsx`
Expected: FAIL

- [ ] **Step 3: 段を足す**

`src/features/planner/model/planner-wizard.ts` の `plannerSteps` で `"timeLimit",` の直後に `"effort",` を足す。冒頭コメントを「任意の追加条件5問（timeLimit→effort→budget→ingredientPreference→novelty）」にする。

`src/features/planner/components/planner-wizard.tsx`:

- import に `effortPreferenceLabel, effortPreferenceLabels` を `noveltyPreferenceLabel` と同じ import 元から足す。
- `optionalPlannerSteps` に `"effort",` を `"timeLimit",` の直後に足し、直上のコメントを「5問（timeLimit〜novelty）」にする。進み具合のコメントの「n / 9」を「n / 10」にする。
- `timeLimit` 分岐の `advanceFromEditOr("budget");` を `advanceFromEditOr("effort");` にする。
- `budget` 分岐の `backFromEditOr("timeLimit");` を `backFromEditOr("effort");` にし、タイトルを `"7. 予算"` にする。
- `ingredientPreference` 分岐のタイトルを `"8. 材料の使い方"` に、`novelty` 分岐のタイトルを `"9. 献立の雰囲気"` にする。
- `timeLimit` 分岐の直後（`if (step === "budget")` の前）に追加する。

```tsx
  if (step === "effort") {
    return (
      <main ref={containerRef} className="page-frame stack guided-planner-theme">
        {conflictChrome}
        {autosaveChrome}
        <PlannerProgress step={step} />
        <OptionalChoiceStep
          key={step}
          id="planner-effort-preference"
          title="6. 調理の手間"
          value={draft.effortPreference === "easy" ? "easy" : ""}
          options={[
            { value: "", label: effortPreferenceLabel(null) },
            { value: "easy", label: effortPreferenceLabels.easy },
          ]}
          onSelect={(selected) => {
            onDraftChange({
              ...draft,
              effortPreference: selected === "easy" ? "easy" : null,
            });
          }}
          onNext={() => {
            advanceFromEditOr("budget");
          }}
          onBack={() => {
            backFromEditOr("timeLimit");
          }}
          disabled={isSaving}
          {...editReturnActionLabels}
        />
        {error !== null && <p role="alert">{error}</p>}
        {resetChrome}
        {footer}
      </main>
    );
  }
```

確認画面の「戻る」（`goToStep("novelty")`）は変えない。

`src/features/planner/components/review-step.tsx`:

- import に `effortPreferenceLabel` を足す。
- 見出しの `9. 確認` を `10. 確認` にする。
- 「調理時間」の `wizard-review-item` の `</div>` の直後に追加する。

```tsx
              <div className="wizard-review-item">
                <dt>調理の手間</dt>
                <dd className="review-answer-cell">
                  <span>{effortPreferenceLabel(value.effortPreference)}</span>
                  {onEditStep !== undefined && (
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      aria-label="調理の手間を変更"
                      onClick={() => {
                        onEditStep("effort");
                      }}
                    >
                      変更
                    </Button>
                  )}
                </dd>
              </div>
```

`onEditStep` の引数型が `PlannerStep` 由来なら、`"effort"` はそのまま通る。独自の union なら `"effort"` を足す。

- [ ] **Step 4: 新しいテストが通ることを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/planner/model/planner-wizard.test.ts src/features/planner/components/planner-wizard.test.tsx`
Expected: 追加・変更したテストは PASS。見出しや分母を固定している他のテストはまだ FAIL してよい（Step 5 で直す）。

- [ ] **Step 5: 既存の固定値を追随させる**

次のコマンドで対象を一覧する。

```bash
grep -rnE "/ 9|[0-9]+\. (調理時間|予算|材料の使い方|献立の雰囲気|確認)" src e2e
```

各ヒットを次の規則で直す。

- 見出しの番号: 「6. 予算」→「7. 予算」、「7. 材料の使い方」→「8. 材料の使い方」、「8. 献立の雰囲気」→「9. 献立の雰囲気」、「9. 確認」→「10. 確認」。「5. 調理時間」は変えない。
- 進み具合: 「n / 9」→「n / 10」。調理時間より後の段は位置が 1 つずつ後ろへずれる（予算は 7 / 10、材料の使い方は 8 / 10、献立の雰囲気は 9 / 10）。確認画面を示す「9 / 9」は「10 / 10」にする。`home-generate-card.test.tsx` と `planner-route.test.tsx` の「8 / 9」を否定する assert は「9 / 10」にする。
- **段を順にたどるテスト**では、見出しの書き換えに加えて「5. 調理時間」の直後に「6. 調理の手間」を挿入する。
  - 配列で回しているもの（`for (const title of ["6. 予算", ...])`）は、配列の先頭に `"6. 調理の手間"` を足し、残りを振り直す。対象: `e2e/specs/mobile-accessibility.spec.ts:154`、`e2e/specs/generation-recovery-results.spec.ts:1295,1418`、`src/features/planner/components/planner-wizard.test.tsx:361`。
  - `it.each` の表（`src/app/accessibility.test.tsx:565-572`）は、`timeLimit` の行の直後に `{ step: "effort" as const, heading: "6. 調理の手間", primary: "戻る" },` を足す。`primary` は budget / ingredientPreference / novelty の行と同じ「戻る」。後続の行の見出しは Step 5 の規則で振り直す。
  - `e2e/specs/full-journey.spec.ts` は Step 6 で扱う。
- 「任意4ページ」「追加条件4ページ」などのコメントは「任意5ページ」に直す。

直したら次を実行する。

Run: `docker compose run --rm --no-deps app npx vitest run src/features/planner src/app/accessibility.test.tsx src/features/history > /tmp/claude-vt.log 2>&1; grep -nE "FAIL|✗" /tmp/claude-vt.log | head -40 || tail -n 15 /tmp/claude-vt.log`
Expected: PASS

- [ ] **Step 6: e2e を直す**

`e2e/specs/full-journey.spec.ts` の「5. 調理時間」ブロックの直後（「6. 予算」の前）に挿入し、手間の保存を待つ。

```ts
    await expect(page.getByRole("heading", { name: "6. 調理の手間" })).toBeVisible();
    // 手間 easy の保存応答は「手間のかかる料理は避ける」click の直前に待ち始める（ひねりと同型）
    const effortSaved = page.waitForResponse((response) => {
      if (!new URL(response.url()).pathname.endsWith("/rest/v1/rpc/save_generation_draft")) {
        return false;
      }
      const postData = response.request().postData();
      return postData !== null && postData.includes('"p_effort_preference":"easy"');
    });
    await page.locator("label.wizard-option").filter({ hasText: "手間のかかる料理は避ける" }).click();
    await effortSaved;
    await page.waitForTimeout(350);
    await clickWizardNext(page);
```

以降の見出しは Step 5 の規則で振り直す。コメント「任意4ページ」も「任意5ページ」にする。

`grep -rn "9\. 確認" e2e` で残りがあれば「10. 確認」に直す（`e2e/fixtures/history.ts`、`e2e/specs/menu-domain-pantry.spec.ts` など）。

e2e は出力が大きいので、人間に次を実行してもらい、要約を貼ってもらう（CLAUDE.md の方針）。

```bash
./scripts/run-e2e.sh e2e/specs/full-journey.spec.ts e2e/specs/mobile-accessibility.spec.ts e2e/specs/generation-recovery-results.spec.ts e2e/specs/menu-domain-pantry.spec.ts
```

Expected: PASS

- [ ] **Step 7: 全体の静的検査**

Run: `docker compose run --rm --no-deps app npm run typecheck`、`... npm run lint`、`... npm run format:check`
Expected: いずれもエラーなし

- [ ] **Step 8: コミット**

```bash
git add src/features/planner src/app e2e src/features/history
git status --short
git commit -m "feat(planner): ウィザードに調理の手間の段を足し、確認画面に行を足す" -m "調理時間の直後に 6. 調理の手間を挿入し、後続の段と確認画面を 7〜10 に振り直す。スキップは手間も null にし、確認画面の戻るは献立の雰囲気のまま。" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014unHywzrdUis3WSG9mHdbv"
```

---

### Task 6: 配備手順の注記と最終確認

**Files:**
- Modify: `docs/deployment/README.md`（§5.2 の `cancel_at` の注記の直後）

- [ ] **Step 1: 配備の注記を書く**

`docs/deployment/README.md` の「#### 解約予定日 cancel_at ...」の節の直後に追加する。

```markdown
#### 調理の手間 effort_preference（`20260927120000_effort_preference.sql`）

この migration は 2 回に分けて出す。

1. **リリース 1（Functions だけ）**: snapshot の読みに `effort_preference` を任意キーで足したコミット（`feat(generation): snapshot の effort_preference を有無どちらでも読めるようにする`）までを Netlify へ出す。migration は当てない。
2. **リリース 2（§5.2 の通常の順）**: migration を当て、続けて Netlify を出す。

- 以前の Functions は snapshot RPC の戻り値を strict に解析する。リリース 1 を飛ばして migration を当てると、Netlify を出すまでの間、全員の新規献立生成が `invalid_request` になる。
- 旧ブラウザは `p_effort_preference` を送らないが、引数が `default null` なので下書き保存は通る。
- 週献立の snapshot は jsonb で、行の読みは strict ではないので影響しない。
- ロールバック: リリース 2 の Functions を戻すのは**リリース 1 の配備まで**に限る。それより前へ戻すと、new_menu が失敗する。また、リリース 1 まで戻した場合でも、リリース 2 の間に作られた献立（保存済みの条件に `effortPreference` を含む）は、作り直し（再生成）が 422 になる。DB は破壊的に戻さない。
- **前提: 本番に、この migration より前の未適用 migration が残っていないこと。** 残っていれば、先にそれらを通常の順で別のリリースとして出す。
```

- [ ] **Step 2: 最終確認**

次を実行する。`db:test` と e2e は出力が大きいので、人間に実行してもらい、要約を貼ってもらう。

```bash
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm test -- --run > /tmp/claude-all.log 2>&1; grep -nE "FAIL|Test Files|Tests " /tmp/claude-all.log | tail -20
docker compose --profile test run --rm db-test      # 人間に依頼
./scripts/run-e2e.sh                                  # 人間に依頼
docker compose run --rm app npm run db:types && git diff --exit-code src/shared/types/database.generated.ts
```

Expected: すべて PASS。`database.generated.ts` の差分なし。

- [ ] **Step 3: コミット**

```bash
git add docs/deployment/README.md
git commit -m "docs(deploy): 手間軸の migration を 2 回に分けて出す手順を書く" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014unHywzrdUis3WSG9mHdbv"
```
