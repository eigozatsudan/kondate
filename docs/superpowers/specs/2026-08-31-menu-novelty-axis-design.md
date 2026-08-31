# 献立の「ひねり」軸（noveltyPreference）設計

- 日付: 2026-08-31
- 状態: **人間レビュー待ち**
- 対象: planner draft / submission 契約、`generation_drafts` と submission snapshot、確認画面 UI、
  new_menu の system プロンプト合成
- 種別: 任意入力軸の追加。**安全評価・quota・fingerprint・検証には一切触れない**

---

## 1. 結論

献立生成に任意軸 `noveltyPreference`（`standard` / `twist` / 未指定）を 1 本追加する。`twist` の
ときだけ、new_menu の system プロンプトへ「ひねり段落」と、メイン食材から引いた**定番料理名の名指し
除外リスト**を載せる。ひねりは `role=main` の料理にだけかかり、`side` / `soup` / `staple` には
かからない。ジャンルも献立の型（主菜＋副菜＋汁物）も変えない。

段落は既存の `DIVERSITY_PARAGRAPH` と同じ **prompt 専用・fail-open** の規約に従う。ひねりが他の制約と
両立しないときはモデルは通常どおり `outcome=success` で定番を返してよく、ひねりだけを理由に
`constraint_conflict` にしてはならない。

## 2. 目的と対象外

### 2.1 目的

「豚肉」と入力して「豚の生姜焼き」が返ることは、献立に悩んでいる利用者にとって実用性がない。利用者が
既に知っている答えを返しているためである。目的は、利用者が**自力では思いつかないが家庭で作れる**主菜を
選べるようにすることである。

既存の `diversity-hints.ts` は「自分の直近 10 献立と被らないこと」しか指示しておらず、「ありふれた
定番であること」自体は問題にしていない。本設計はその欠けている軸を埋める。

### 2.2 対象外

- `temperature` の送信。`netlify/functions/_shared/openrouter.ts` の該当コメントが記録するとおり、
  `supported_parameters` に `temperature` を持たないモデルでは `provider.require_parameters: true`
  との併用が 404 になる。出力のばらつきは本軸で作り、送信 body は変更しない。
- アレルギー評価、food-rules、`validate-generated-menu`、生成ハードゲート。
- fingerprint、quota、provider attempt 予算。ひねり軸はこれらの入力にならない。
- ジャンル（`cuisineGenre`）の自動変更、献立構成（品数・役割）の変更。
- 献立結果画面での「ひねり」表示。今回は入力側のみ。
- 再生成経路（`regenerate_menu` / `regenerate_dish`）。既存の `changeReason` が別軸を持つため、
  本設計では触らない。

## 3. 契約とデータ

### 3.1 `shared/contracts/planner.ts`

```ts
export const noveltyPreferences = ["standard", "twist"] as const;
export type NoveltyPreference = (typeof noveltyPreferences)[number];
```

`draftShape` と `submissionCommonShape` の両方へ次を追加する。

```ts
noveltyPreference: z.enum(noveltyPreferences).nullable().default(null),
```

`.default(null)` は必須である。導入前の下書き JSON と `preference_snapshot` にはこのキーが存在せず、
これが無いと履歴からの条件引き継ぎと再生成が 422 になる。理由は既存の `ingredientPreference` に
付いているコメントと同一で、同じ扱いにする。

`null` と `"standard"` は挙動が同一（どちらもプロンプト段落なし）である。`null` を残すのは過去
snapshot の互換読み込みのためだけであり、新しい意味を与えない。

### 3.2 migration

**`20260730120000_ingredient_preference.sql` を機械的にコピーしてはならない。** 同ファイル以降に
`reserve_ai_generation` と `save_generation_draft` が更新されており、当時の DROP 文と当時の関数本体は
どちらも現行正本ではない。

migration 1 本で次をすべて行う。

1. `public.generation_drafts` に `novelty_preference text`、check は
   `null または in ('standard','twist')`。
2. `private.generation_draft_submission_versions` に同じ列と check。
3. `public.save_generation_draft` を DROP → CREATE。
   **DROP するのは現行の 13 引数シグネチャ**である。

   ```
   (bigint, text, text[], text, text, uuid[], smallint, smallint,
    text, text, text[], text, jsonb)
   ```

   `20260730120000` の DROP 文は 12 引数（`p_ingredient_preference` 以前）を落とすものであり、これを
   コピーすると存在しない関数を落としたうえで 14 引数版を作り、**13 引数版が残って overload 曖昧に
   なり下書き保存が全面的に失敗する**。CREATE 本体は現行定義（`20260730120000` の CREATE）を正本と
   して 14 引数へ拡張し、`p_ingredient_preference` と同型の値検証句（不正値は errcode `22023` の
   `invalid_draft_save`）を足す。
4. `public.reserve_ai_generation` を再作成する。**正本は
   `20260808120000_quality_monthly_retry_and_usage_stale_cleanup.sql` の本体**であり、
   `20260730120000` の本体ではない。`private.generation_draft_submission_versions` への INSERT
   （`20260730120000` で `ingredient_preference` を足した箇所に相当）へ `novelty_preference` と
   `v_draft.novelty_preference` を加える。
   **submission snapshot へ写すのはこの INSERT であって `save_generation_draft` ではない。**
   `save_generation_draft` だけを直すと、下書きには値が入るのに生成が読む snapshot は常に `null` に
   なり、機能が一切効かない。
5. `public.get_ai_generation_submission_snapshot` を DROP → CREATE し、`RETURNS TABLE` と select 句へ
   `novelty_preference text` を追加する。
6. 再作成した各関数へ `revoke all` / `grant execute` を現行と同じ内容で貼り直す。

`src/shared/types/database.generated.ts` は再生成のみ。手編集しない。

### 3.3 サーバー読み取り面

`netlify/functions/_shared/generation-context.ts` の `snapshotRowSchema` は `.strict()` である。
§3.2 の 5 で RPC が新しい列を返すようになった時点で、この schema を更新しなければ `safeParse` が
落ち、**new_menu 経路全体が 422 になる**。次を同じ Task 内で行う。

- `snapshotRowSchema` に `novelty_preference: z.enum(["standard","twist"]).nullable()` を追加。
- `mapSnapshot` に `noveltyPreference: row.novelty_preference` を追加。

`mapSnapshot` は `plannerSubmissionSchema.parse({ ... })` にオブジェクトリテラルを直渡ししており、
同 schema は discriminated union の**両枝とも `.strict()`** である。したがって §3.1 の
`submissionCommonShape` への追加は、`mapSnapshot` にとって任意ではなく**先行必須**である。

契約が未更新のまま `mapSnapshot` に `noveltyPreference` を渡すと `unrecognized_keys` で parse が
throw し、**ひねりを選んでいない利用者を含む new_menu 経路全体が HTTP 422 になる**。
`plannerSubmissionSchema.parse` の引数は `unknown` なので、余剰キーは typecheck を素通りする。
型では守れないため、順序（§8）で守る。

`GenerationContext["submission"]` は `PlannerSubmission` そのものなので、契約さえ更新すれば型は
そのまま流れる。

### 3.4 クライアント永続面

generated 型の再生成だけでは足りない。generated は `p_*` 引数を非 nullable な `string` として出すため、
**未選択（`null`）を型として送れない**。既存の `ingredientPreference` は次の 4 箇所を手で通しており、
新軸も同じ 4 箇所を明示的に通す。

- `src/shared/types/database.ts` — 手書き overlay。`SaveDraftNullableArgKeys` に
  `"p_novelty_preference"` を足し、`p_novelty_preference: GeneratedSaveDraftArgs["p_novelty_preference"] | null`
  を宣言する。
- `src/features/planner/planner-api.ts` — `getPlannerDraft` の `select` 列文字列へ
  `novelty_preference` を追加（列名の明示列挙であり `*` ではない）、`mapPlannerDraft` の写し、
  `buildSaveGenerationDraftArgs` の `p_novelty_preference`。
- `src/features/planner/use-draft-autosave.ts` — 保存値の明示コピーと、「下書きが空か」を判定する
  条件式への追加（`ingredientPreference === null &&` と同型）。ここを落とすと、ひねりだけを選んだ
  下書きが空扱いで保存されない。
- `src/features/planner/planner-route.tsx` — 初期値 `null`、draft からの hydrate、送信時のコピー。

## 4. UI

確認画面 `src/features/planner/components/review-step.tsx` の「材料の使い方」の隣に、
**「いつもの」/「ひねりたい」** の 2 択を置く。既定は未選択（`null`）。日本語ラベルは
`src/features/planner/model/planner-labels.ts` に置き、コンポーネント内に直書きしない。
`src/features/planner/model/draft-from-menu.ts`（履歴からの条件引き継ぎ）も新キーを写す。

320 CSS px で横スクロールを出さず、タップ対象は 44×44 CSS px を満たす。文言はすべて日本語。

## 5. プロンプト

### 5.1 新モジュール `netlify/functions/_shared/novelty-hints.ts`

`diversity-hints.ts` と同型で作る。

- `NOVELTY_HINTS_ENABLED`（kill-switch）
- `NOVELTY_SYSTEM_MARKER = "【ひねり】"`（テスト・運用識別用の段落先頭マーカー）
- `NOVELTY_PARAGRAPH`（段落本体）
- 除外リストの 1 リクエストあたり件数上限定数

**`PromptPreferences` にフィールドを追加してはならない。** `buildBaseGenerationMessages` は new_menu と
再生成の両方が呼ぶため、`PromptPreferences` を広げると再生成の user JSON が黙って変わる。これは §2.2 の
「再生成経路は対象外」と両立しない。

正しい前例は `recentDishHints` である。`buildGenerationMessages` の `kind === "new_menu"` 分岐が
base の user payload を parse し直し、new_menu 専用キーを足して再 serialize している。ひねりも同じ
場所で注入する。

- system: `noveltyPreference === "twist"` かつ kill-switch on のときだけ、
  `buildNewMenuSystemPrompt` が `DIVERSITY_PARAGRAPH` の直後へ段落を挿入する。
- user: 同じ条件のときだけ、除外リストを payload のトップレベルキーとして足す。
- **kill-switch off のときは段落とキーの両方を落とす。** `recentDishHints` は off でも常に `[]` を
  載せる契約だが、ひねりは新規キーであり後方互換の制約が無いため、キーごと消す方を採る。
- `buildSystemPrompt`（再生成経路）と再生成の user payload は一切変更しない。

### 5.2 段落の内容

1. `role=main` の料理では、`preferences.mainIngredients` の最も一般的な調理法と定番の相方を避ける。
2. `side` / `soup` / `staple` には適用しない。
3. 除外リストに挙がる料理名（およびその言い換え）を `role=main` の `name` に使わない。
4. 家庭のキッチンで作れること、`timeLimitMinutes`、買い足しの現実性を優先する。
5. **ひねりと他の制約が両立しないときは、通常どおり `outcome=success` で定番を返してよい。ひねり
   だけを理由に `constraint_conflict` にしない。**

5 は交渉不可である。既存の多様性段落と同じ fail-open 規約であり、これを外すと失敗率が上がる。

優先順位の体系は既存段落（1 安全・必須制約、2 preferences、3 直近履歴、4 季節）を変えない。ひねりは
**2 の内側**、すなわち利用者の preferences の一部として書く。3 の履歴ヒントより上位に置かない。

### 5.3 載せない場所

ひねり軸は fingerprint、quota、`validate-generated-menu`、生成ハードゲートの入力にしない。
`diversity-hints.ts` の冒頭コメントが定める「prompt 専用」と同じ線引きである。

## 6. 定番辞書

`netlify/functions/_shared/staple-dish-catalog.ts` に純データとして置く。ブラウザからは参照しない
ため、`shared/` を経由せず Functions 側に閉じる（所有境界に触れない）。

```ts
readonly { readonly ingredientAliases: readonly string[]; readonly stapleDishes: readonly string[] }[]
```

- 照合は `shared/safety-pure/normalize-food-text.ts` の `normalizeFoodText` を通した**正規化後の
  完全一致**とする。新しい正規化関数は作らない。
- `normalizeFoodText` が畳むのは NFKC、カタカナ → ひらがな、小文字化、区切り文字の除去だけである。
  **漢字とかなは畳まない。** 実測で `ブタ` と `ぶた` は一致するが、`豚肉` と `ぶた肉` は一致しない。
  したがって漢字・かな・カタカナの揺れは `ingredientAliases` に列挙して吸収する。正規化に期待しない。
- 初版は主要食材 20〜30 語（豚肉、鶏肉、牛肉、ひき肉、鮭、鯖、卵、豆腐、なす、キャベツ 等）。
- 1 リクエストあたりの料理名は上限定数で切り、プロンプト肥大を防ぐ。
- 未収録の食材はヒット 0 件。このとき段落だけが残り、名指しなしの弱い版へ自動的に縮退する
  （fail-open）。辞書の欠落は生成失敗にしない。

## 7. テスト

- 契約: `shared/contracts/planner.test.ts` に新軸の parse と、キー欠損が `null` になること。
- 型 overlay: `src/shared/types/database.test.ts` に `p_novelty_preference: null` が型として通ること。
- 辞書: 正規化後の完全一致、alias 列挙による漢字・かな・カタカナの吸収、未収録食材で 0 件、件数上限。
- プロンプト:
  - `twist` on / off のスナップショット 2 本
  - kill-switch off で段落とキーの両方が消える 1 本
    （`generation-prompt-diversity-off.test.ts` と同型）
  - **再生成の user payload が本変更の前後で不変であることの回帰テスト 1 本**（F-04 の再発防止）
- DB:
  - pgTAP で 2 テーブルの列 check
  - `save_generation_draft` が 14 引数の 1 つだけであること（13 引数版が残っていないこと）と、
    不正値の拒否
  - `reserve_ai_generation` が snapshot へ値を写すこと（下書きに `twist` を入れて予約し、
    `get_ai_generation_submission_snapshot` が `twist` を返す）
- サーバー:
  - `snapshotRowSchema` が新しい列を含む行を parse できること。
  - **`mapSnapshot` → `PlannerSubmission` の round-trip 1 本。** 新しい列を含む snapshot 行を
    `mapSnapshot` に通し、throw せず `noveltyPreference` が保持されることを確かめる。
    `snapshotRowSchema` の単体テストはこれを検知しない（落ちるのは後段の
    `plannerSubmissionSchema.parse` である）。`standard` / `twist` / `null` の 3 値を通す。
- E2E: 確認画面で「ひねりたい」を選び、生成が `success` で返る 1 本。

検証コマンドは `CLAUDE.md` の Docker 経路に従う。`db:test` と `e2e` はホストで直接
`docker compose --profile test run --rm db-test` / `./scripts/run-e2e.sh` を実行する。

## 8. 実装順序

**Task 1 は契約・migration・サーバー読み取り面を 1 つの commit で閉じる。分割してはならない。**

`mapSnapshot` の `plannerSubmissionSchema.parse` は両枝 `.strict()` であり（§3.3）、契約より先に
`mapSnapshot` を更新した中間 commit は new_menu 全体を 422 にする。逆に migration より先に
`mapSnapshot` を更新すれば、RPC が返さない列を読むことになる。この 3 つは同時にしか正しくならない。

1. **Task 1（単一 commit）**
   - 契約: `shared/contracts/planner.ts` の `draftShape` と `submissionCommonShape`
   - migration: 2 テーブル + `save_generation_draft` + `reserve_ai_generation` +
     `get_ai_generation_submission_snapshot` + grant、および型再生成
   - サーバー読み取り面: `snapshotRowSchema` と `mapSnapshot`
   - テスト: 契約テスト、pgTAP、`mapSnapshot` round-trip
2. クライアント永続面（overlay、`planner-api.ts`、`use-draft-autosave.ts`、`planner-route.tsx`）
3. 定番辞書と辞書テスト
4. プロンプト（`novelty-hints.ts`、`buildGenerationMessages` の new_menu 分岐、プロンプトテスト、
   再生成不変の回帰テスト）
5. UI（`review-step.tsx`、`planner-labels.ts`、`draft-from-menu.ts`）
6. E2E

Task 1 以外の各段は RED → GREEN → 焦点検証 → 日本語 Conventional Commit で閉じる。Task 1 も同じ
流れだが、上記 4 要素を分けて commit しない。

## 9. リスク

- **効きが弱い**: 「定番を避けろ」は抽象指示であり、モデルが「生姜焼きは定番ではない」と自己判定し
  得る。名指し除外リスト（§6）がこれへの主たる対策であり、辞書の網羅度が実効性を決める。初版で
  効きが確認できない場合は、辞書の拡充で対処し、2 パス生成へは進まない。
- **2 パス生成の誘惑**: 料理名候補を先に出させてから本生成する案は効きが最も強いが、1 リクエストで
  OpenRouter attempt 予算を 2 回消費し、`shared/contracts/function-budget.ts` と Netlify の同期
  60 秒の壁の前提を壊す。**本設計では採らない。**
- **破綻レシピ**: ひねりを優先しすぎて家庭で作れない案が出る懸念。§5.2 の 4 と 5 が抑制する。
- **migration の再作成漏れ**: 本設計は 3 つの関数を再作成する（§3.2）。いずれも「直近の
  `ingredient_preference` migration をコピーする」やり方では正本を取り違える。実装時は各関数の
  最新定義を `grep -rn "create or replace function.*<name>" supabase/migrations/` で確定してから
  写すこと。

## 10. レビュー反映

2026-08-31 の技術レビューで初版の 5 点を修正した。いずれも初版が誤っていた。

- F-01 生成到達経路: snapshot へ写すのは `reserve_ai_generation` であり `save_generation_draft`
  ではない。`snapshotRowSchema` は `.strict()`。→ §3.2 の 4・5、§3.3
- F-02 クライアント永続面: generated 型は `p_*` を非 nullable に出す。overlay・select 列・autosave・
  route の明示コピーが要る。→ §3.4
- F-03 DROP シグネチャ: 現行は 13 引数。12 引数の DROP をコピーすると overload が並ぶ。→ §3.2 の 3
- F-04 PromptPreferences 共有: base builder は再生成と共用。`recentDishHints` と同じ new_menu 分岐で
  注入する。→ §5.1
- F-05 辞書照合: `normalizeFoodText` は漢字とかなを畳まない。alias 列挙で吸収する。→ §6
- R-01 契約の Task 分割: `mapSnapshot` は両枝 `.strict()` の `plannerSubmissionSchema.parse` に
  リテラルを直渡しする。契約を別 Task に切り出すと中間 commit で new_menu が 422 になる。
  → §3.3、§7、§8（Task 1 を単一 commit に固定）
