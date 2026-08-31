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

`supabase/migrations/20260730120000_ingredient_preference.sql` をなぞる 1 本を追加する。

- `public.generation_drafts` に `novelty_preference text`、
  check は `null または in ('standard','twist')`。
- `private.generation_draft_submission_versions` に同じ列と check。
- `public.save_generation_draft` を DROP → CREATE し、`p_novelty_preference text` を引数へ追加。
  既存の `p_ingredient_preference` と同型の値検証句（不正値は errcode `22023` の
  `invalid_draft_save`）を関数先頭へ足し、submission snapshot へ写す。

`src/shared/types/database.generated.ts` は再生成のみ。手編集しない。

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

`generation-prompt.ts` の `buildNewMenuSystemPrompt` で、`noveltyPreference === "twist"` かつ
kill-switch が on のときだけ `DIVERSITY_PARAGRAPH` の直後へ挿入する。`buildSystemPrompt`（再生成
経路）は変更しない。`PromptPreferences` に `noveltyPreference` を追加し、user payload にも載せる。

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

- 照合は `shared/safety-pure/normalize-food-text.ts` の `normalizeFoodText` を通し、表記ゆれ
  （豚肉／ぶた肉／ブタ）を吸収する。新しい正規化関数は作らない。
- 初版は主要食材 20〜30 語（豚肉、鶏肉、牛肉、ひき肉、鮭、鯖、卵、豆腐、なす、キャベツ 等）。
- 1 リクエストあたりの料理名は上限定数で切り、プロンプト肥大を防ぐ。
- 未収録の食材はヒット 0 件。このとき段落だけが残り、名指しなしの弱い版へ自動的に縮退する
  （fail-open）。辞書の欠落は生成失敗にしない。

## 7. テスト

- 契約: `shared/contracts/planner.test.ts` に新軸の parse と、キー欠損が `null` になること。
- 辞書: 正規化を通した照合、未収録食材で 0 件、件数上限。
- プロンプト: `twist` on / off のスナップショット 2 本と、kill-switch off で段落が消える 1 本
  （`generation-prompt-diversity-off.test.ts` と同型）。
- DB: pgTAP で 2 テーブルの列 check と `save_generation_draft` の引数・不正値拒否。
- E2E: 確認画面で「ひねりたい」を選び、生成が `success` で返る 1 本。

検証コマンドは `CLAUDE.md` の Docker 経路に従う。`db:test` と `e2e` はホストで直接
`docker compose --profile test run --rm db-test` / `./scripts/run-e2e.sh` を実行する。

## 8. 実装順序

1. migration（2 テーブル + RPC）と型再生成
2. 契約（`planner.ts` と契約テスト）
3. 定番辞書と辞書テスト
4. プロンプト（`novelty-hints.ts`、`generation-prompt.ts`、プロンプトテスト）
5. UI（`review-step.tsx`、`planner-labels.ts`、`draft-from-menu.ts`）
6. E2E

各段は RED → GREEN → 焦点検証 → 日本語 Conventional Commit で閉じる。

## 9. リスク

- **効きが弱い**: 「定番を避けろ」は抽象指示であり、モデルが「生姜焼きは定番ではない」と自己判定し
  得る。名指し除外リスト（§6）がこれへの主たる対策であり、辞書の網羅度が実効性を決める。初版で
  効きが確認できない場合は、辞書の拡充で対処し、2 パス生成へは進まない。
- **2 パス生成の誘惑**: 料理名候補を先に出させてから本生成する案は効きが最も強いが、1 リクエストで
  OpenRouter attempt 予算を 2 回消費し、`shared/contracts/function-budget.ts` と Netlify の同期
  60 秒の壁の前提を壊す。**本設計では採らない。**
- **破綻レシピ**: ひねりを優先しすぎて家庭で作れない案が出る懸念。§5.2 の 4 と 5 が抑制する。
