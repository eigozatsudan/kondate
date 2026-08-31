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
| `netlify/functions/_shared/generation-context.ts` | `snapshotRowSchema` と `mapSnapshot` |
| `supabase/tests/database/03_pantry_and_planner_drafts.test.sql` | `has_function` 型配列と全 positional 呼び出しへ 14 番目の引数 |
| `supabase/tests/database/03a_pantry_and_planner_drafts_hardening.test.sql` | 同上 |
| `supabase/tests/database/ai_control_and_quota.test.sql` | 同上 + snapshot 往復アサート |
| `src/shared/types/database.ts` | overlay `NullableDraftArgs` と `SaveDraftArgs` |
| `src/features/planner/planner-api.ts` | select 列、`mapPlannerDraft`、`buildSaveGenerationDraftArgs` |
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
) from public, anon, service_role;
grant execute on function public.save_generation_draft(
  bigint, text, text[], text, text, uuid[], smallint, smallint,
  text, text, text[], text, jsonb, text
) to authenticated;
```

revoke 対象ロールと grant 先は元ファイルの `save_generation_draft` の記述をそのまま踏襲すること（上は形の例であり、ロール一覧は元ファイルを正とする）。`reserve_ai_generation` と `get_ai_generation_submission_snapshot` は引数が変わらないので、元ファイルの revoke/grant をそのまま写す。

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

**(a) `03_pantry_and_planner_drafts.test.sql`** — 162 行目の idea 保存が成功して revision は 4 になっている。したがって新しい保存は `p_expected_revision = 4` から始める。`plan(43)` を `plan(46)` へ増やし、194 行目の `select * from finish();` の直前へ:

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

**(b) `private.generation_draft_submission_versions` の列**は `03_pantry` の `plan(46)` に含めた 3 件とは別に、同ファイルの既存の `has_column` 群の並びへ 1 件足す（その場合 `plan(47)` にする）:

```sql
select has_column('private','generation_draft_submission_versions','novelty_preference',
  'submission snapshot stores novelty preference');
```

**(c) `ai_control_and_quota.test.sql`** — このファイルは `no_plan()`（3 行目）なので **`plan()` の数を触らない**。

既存の snapshot 往復シナリオへ assert を足してはならない。そこの下書きは `selected_only` を保存した別の文脈で作られており、`novelty_preference` は `null` のままなので、twist を期待する assert は必ず落ちる。新しい下書き保存から予約までを 1 本足す。

```sql
-- 既存の予約シナリオの後ろへ、独立した往復を 1 本足す
select public.save_generation_draft(<現在の revision>,'dinner',array['豚肉'],'japanese','idea',
  array[]::uuid[],2::smallint,30::smallint,'standard',null,array[]::text[],'', '[]'::jsonb,'twist');
-- 同ファイルの既存パターンで reserve_ai_generation を呼び、その request_id を使う
select is(
  (select novelty_preference
     from public.get_ai_generation_submission_snapshot(<request_id>, <user_id>)),
  'twist',
  'reserve copies novelty preference into the submission snapshot');
```

`<現在の revision>` / `<request_id>` / `<user_id>` は同ファイルの直前のシナリオが使っている実際の値・変数へ置き換える。`reserve_ai_generation` の引数は同ファイルの既存呼び出しをそのまま写すこと（引数が多く、quota 系の必須引数を落とすと別の失敗になる）。

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

- [ ] **Step 9b: 契約変更の型波及をリポジトリ全体で潰す**

**`.default(null)` は入力を任意にするだけで、`z.infer` が出す出力型ではキーは必須である。** つまり `PlannerDraftInput` / `PlannerSubmission` として型付けされたオブジェクトリテラルはすべて `noveltyPreference` を持たなければならず、parse 結果を `toEqual` で比較しているテストはすべて新しいキーの分だけ落ちる。これは Task 2 以降ではなく **この Task の範囲**である。ここで潰さないと Task 1 の commit で main が赤くなり、Task 2 の typecheck PASS も成立しない。

```bash
docker compose run --rm --no-deps app npm run typecheck > /tmp/tc.log 2>&1; grep -nE "error" /tmp/tc.log || tail -n 40 /tmp/tc.log
```

エラーが出た箇所すべてへ `noveltyPreference: null,` を足す。既知の起点は次のとおりだが、**この一覧を信用せず typecheck の出力を正とすること**（`grep -rln "ingredientPreference" src/ shared/ netlify/ e2e/` は 39 ファイルに当たる）。

- `shared/testing/factories.ts:246`, `:294` — 共有ファクトリ。ここを直すと下流の多くが同時に片付く
- `shared/contracts/planner.test.ts` — `toMatchObject` は影響しないが `toEqual` は落ちる
- `src/features/planner/**` の draft フィクスチャ
- `netlify/functions/_shared/**` の submission フィクスチャ

`toEqual` が落ちた箇所は、期待値へ `noveltyPreference: null` を足す。`toMatchObject` へ書き換えて逃げない（部分一致にすると余剰キーの検出力が落ちる）。

```bash
docker compose run --rm --no-deps app npm test -- --run > /tmp/vitest.log 2>&1; grep -nE "FAIL|✕" /tmp/vitest.log || tail -n 30 /tmp/vitest.log
```

期待: typecheck・全 vitest ともに PASS。出力が大きいので上のようにファイルへ落とし、失敗行だけを読むこと。

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

期待: すべて PASS。**typecheck が赤いまま次へ進まない。** Step 9b で全体を緑にしてあるので、ここで落ちるなら Step 12 の変更が原因である。`planner-api.ts` などクライアント側が落ちる場合も、`noveltyPreference: null` を足して緑にしてから commit する（値を実際に配線するのは Task 2 だが、型の穴を Task 間にまたがせない）。

- [ ] **Step 14: コミット（単一 commit）**

```bash
git add shared/contracts/planner.ts shared/contracts/planner.test.ts \
  supabase/migrations/20260831120000_novelty_preference.sql \
  supabase/tests/database/ \
  netlify/functions/_shared/generation-context.ts \
  netlify/functions/_shared/generation-context.test.ts \
  src/shared/types/database.generated.ts
git commit -m "feat(generation): 献立のひねり軸を契約と snapshot 経路へ通す

契約・列追加・3 関数の再作成・snapshot 読み取りは同時にしか正しくならない。
plannerSubmissionSchema は両枝 strict で mapSnapshot はリテラルを直渡しするため、
分割すると中間 commit で new_menu 全体が 422 になる。"
```

---

### Task 2: クライアント永続面

**Files:**
- Modify: `src/shared/types/database.ts:20-38`
- Modify: `src/shared/types/database.test.ts`
- Modify: `src/features/planner/planner-api.ts:25-45`（`mapPlannerDraft`）, `:56`（select 列）, `:63-83`（`buildSaveGenerationDraftArgs`）
- Modify: `src/features/planner/planner-api.test.ts`
- Modify: `src/features/planner/use-draft-autosave.ts:76`, `:141`
- Modify: `src/features/planner/use-draft-autosave.test.tsx`
- Modify: `src/features/planner/planner-route.tsx:104`, `:145`, `:1776`

**Interfaces:**
- Consumes: Task 1 の `PlannerDraftInput["noveltyPreference"]`、RPC 14 引数
- Produces: `savePlannerDraft` が `p_novelty_preference` を送る。`getPlannerDraft` が `noveltyPreference` を返す。

- [ ] **Step 1: 型 overlay の failing test を書く**

`src/shared/types/database.test.ts` の既存フィクスチャ（129 行目・159 行目付近の `p_ingredient_preference: null` があるオブジェクト）へ `p_novelty_preference: null,` を足し、177 行目付近の nullable キー union のテストへ `| "p_novelty_preference"` を足す。

**この overlay が要る理由**: Postgres Meta は nullable 引数を非 null な `string` として生成する。overlay が無いと「未選択」を型として送れない。

- [ ] **Step 2: テストが落ちることを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run src/shared/types/database.test.ts
docker compose run --rm --no-deps app npm run typecheck
```

期待: `p_novelty_preference: null` が `string` に代入できず typecheck が FAIL。これは Task 1 Step 9b で緑にした状態からの**新しい** FAIL である（Task 1 から持ち越した赤ではない）。持ち越しの赤が見えるなら Task 1 が未完了なので戻ること。

- [ ] **Step 3: overlay を実装**

`src/shared/types/database.ts`、`NullableDraftArgs` へ:

```ts
  | "p_novelty_preference";
```

`SaveDraftArgs` の交差型へ:

```ts
  p_novelty_preference: GeneratedSaveDraftArgs["p_novelty_preference"] | null;
```

- [ ] **Step 4: planner-api の failing test を書く**

`src/features/planner/planner-api.test.ts:154` 付近の期待引数へ `p_novelty_preference: null,` を足し、`twist` を保存したときに `p_novelty_preference: "twist"` が渡ることを見るケースを 1 件足す。

読み取り側は **`mapPlannerDraft` へ手組みの行を通すだけでは不十分**である。`mapPlannerDraft` は `getPlannerDraft` の select 列文字列とは独立しており、select へ `novelty_preference` を足し忘れても `mapPlannerDraft` の単体テストは通る。そのとき GET はキーを欠いた行を返し、`.default(null)` が保存済みの `twist` を静かに `null` へ潰す。F-02 と同じ壊れ方がテスト緑のまま再発する。

したがって **select 列そのものをロックする**テストを足す。

```ts
it("selects the novelty preference column from generation_drafts", async () => {
  const select = vi.fn().mockReturnValue({
    eq: () => ({ maybeSingle: async () => ({ data: draftRowFixture, error: null }) }),
  });
  const client = makeBrowserClientStub({ from: () => ({ select }) });
  await getPlannerDraft(client, userId);
  expect(select).toHaveBeenCalledWith(expect.stringContaining("novelty_preference"));
});

it("returns the novelty preference from a fetched draft row", async () => {
  const client = makeBrowserClientStub({
    row: { ...draftRowFixture, novelty_preference: "twist" },
  });
  await expect(getPlannerDraft(client, userId)).resolves.toMatchObject({
    noveltyPreference: "twist",
  });
});
```

`makeBrowserClientStub` / `draftRowFixture` / `userId` は同ファイルの既存ヘルパー名へ読み替える。1 本目のスタブ形は既存テストの `from().select().eq().maybeSingle()` チェーンに合わせること。

- [ ] **Step 5: テストが落ちることを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/planner-api.test.ts
```

期待: FAIL。

- [ ] **Step 6: planner-api を実装**

3 箇所すべてを通す。1 つでも落とすと値が消える。

`mapPlannerDraft`（`ingredientPreference` の直後）:

```ts
    noveltyPreference: row.novelty_preference,
```

`getPlannerDraft` の select 列文字列（`*` ではなく明示列挙）— `ingredient_preference,` の直後へ `novelty_preference,` を挿入:

```ts
      "id,user_id,meal_type,main_ingredients,cuisine_genre,target_mode,target_member_ids,servings,time_limit_minutes,budget_preference,ingredient_preference,novelty_preference,avoid_ingredients,memo,pantry_selections,revision,created_at,updated_at,deleted_at",
```

`buildSaveGenerationDraftArgs`（`p_ingredient_preference` の直後）:

```ts
    p_novelty_preference: input.noveltyPreference,
```

- [ ] **Step 7: autosave の failing test を書く**

`src/features/planner/use-draft-autosave.test.tsx` へ、**「ひねりだけを選んだ下書きが保存される」** ケースを足す。他の項目がすべて未入力で `noveltyPreference: "twist"` だけがあるとき、保存が走ることを確かめる。

```ts
it("saves a draft whose only filled field is the novelty preference", async () => {
  // 既存テストの render / act ヘルパーへ合わせて呼ぶ
  // 期待: save が 1 回呼ばれ、p_novelty_preference: "twist" が渡る
});
```

**このテストが要る理由**: `use-draft-autosave.ts:141` の「空下書き」判定に新軸を足し忘れると、ひねりだけを選んだ下書きが空扱いで保存されない。気付きにくい壊れ方をする。

- [ ] **Step 8: テストが落ちることを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/planner/use-draft-autosave.test.tsx
```

期待: FAIL（保存が走らない）。

- [ ] **Step 9: autosave と route を実装**

`use-draft-autosave.ts:76` 付近の保存値コピーへ:

```ts
    noveltyPreference: value.noveltyPreference,
```

`use-draft-autosave.ts:141` 付近の空判定の連鎖へ（`fields.ingredientPreference === null &&` の直後）:

```ts
    fields.noveltyPreference === null &&
```

`planner-route.tsx` の 3 箇所（104 行目の初期値 `null`、145 行目の draft からの hydrate、1776 行目の送信コピー）へ、それぞれ `ingredientPreference` と同型の 1 行を足す。

- [ ] **Step 10: テストが通ることを確認**

```bash
docker compose run --rm --no-deps app npm test -- --run src/shared/types/database.test.ts src/features/planner/planner-api.test.ts src/features/planner/use-draft-autosave.test.tsx src/features/planner/planner-route-conflict.test.tsx
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

期待: すべて PASS。Task 1 で記録した typecheck エラーもここで解消しているはず。

- [ ] **Step 11: コミット**

```bash
git add src/shared/types/database.ts src/shared/types/database.test.ts src/features/planner/
git commit -m "feat(planner): ひねり軸を下書きの永続面へ通す

generated 型は p_* を非 null に出すため overlay で null を復元する。
select 列・autosave の空判定・route の 3 箇所も明示的に写す。"
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
