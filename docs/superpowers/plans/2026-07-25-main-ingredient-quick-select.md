# メイン食材クイック選択 Implementation Plan

> **For agentic workers:** `AGENTS.md` と `SubAgents.md` を正とし、Taskを1つずつ順番に実行する。各Taskで新しいImplementer、Verifier、一次Reviewer、二次Reviewerのスレッドを使用し、チェックボックス（`- [ ]`）で進捗を管理する。

**Goal:** 献立作成ウィザードの「メイン食材」で自由入力を維持しながら、よく使う食材をワンタップで選択・解除できるようにし、入力が面倒な利用者の負担を減らす。

**Plan ID:** 9

**Architecture:** `mainIngredients: string[]` を唯一の状態・保存・送信契約として維持する。静的候補、自由入力、冷蔵庫候補はすべて同じ正規化・重複判定・解除・上限判定を通して `IngredientStep` の `onChange` に渡す。候補専用のID、API、DB、永続モデルは追加しない。

**Tech Stack:** React 19 / TypeScript / Vite 8 / Vitest / React Testing Library / Playwright

**Authority:**

- 上位制約（質問順、契約、安全・autosave・生成経路）: 下記 Authoritative specs と `shared/contracts/planner.ts`。
- **本 increment の UI 配置・候補リスト・accessible name 方針・a11y・Task 境界の正本は本 Plan とする。** エージェントは候補の増減やラベル方針を勝手に変更しない。

**Authoritative specs:**

- `docs/superpowers/specs/2026-07-11-kondate-mvp-design.md`
- `docs/superpowers/specs/2026-07-22-guided-planner-optional-household-design.md`
- `shared/contracts/planner.ts`

---

## 0. 実装開始前のGate

- [ ] `git status --short` でworktreeを確認する。
- [ ] **Plan 9 対象ファイル**（`ingredient-step.tsx` / `planner-wizard.test.tsx`）に未コミット変更がある場合、次のどちらかを人間が明示するまで Task 1 を開始しない。
  - **A. clean 起点:** 当該差分を stash または別ブランチへ退避し、clean HEAD から開始する。
  - **B. baseline 取り込み:** 当該差分を Plan 9 の baseline として承認する。承認した場合は Task 1 で helper 抽出と既存 WIP テスト（canonical 重複・冷蔵庫 8/80 上限など）を同一コミットへ吸収する。
- [ ] emergency / household / pantry など **Plan 9 外の未コミット変更**は stage・commit に混ぜない。混在している場合は blocker として報告する。
- [ ] 別の Codex 親が同じ worktree を操作中の場合は Task 1 を開始せず blocker として報告する。
- [ ] 次の初期候補と表示順をプロダクト判断として承認する。エージェントはリストを独自に増やさない。

```ts
export const commonMainIngredients = [
  "鶏肉",
  "豚肉",
  "牛肉",
  "ひき肉",
  "鮭",
  "さば",
  "卵",
  "豆腐",
] as const;
```

候補の正本となる既存カタログはない。アレルゲン一覧や食品安全カタログは目的が異なるため流用しない。候補内容を変更する場合も、候補数を最初から増やしすぎず8〜12件に収める。

- [ ] **自由入力の accessible name 方針（固定）:** 入力の accessible name は既存どおり **`メイン食材`** を維持する。見出し「一覧にない食材を入力」はセクション見出し（`h3` 等）とし、input の `<label>` / accessible name は変更しない。これにより E2E・fixtures（`full-journey` / `history` / `shopping` / `menu-domain-pantry` / `generation-recovery-results` / `mobile-accessibility` 等）と旧 `planner-page` の `"メイン食材"` 参照を壊さない。placeholder だけで用途を説明しない（見出しと label の両方で用途が分かるようにする）。

---

## Global Constraints

- 自由入力を削除・折りたたみ・候補選択必須にしない。
- 質問順は「食事 → メイン食材 → ジャンル → 対象 → 確認」から変更しない。
- 変更対象は **guided wizard の `IngredientStep` のみ**。旧 `planner-page` フォームは触らない。
- `mainIngredients` は送信時1件以上、最大8件、各要素はNFKC正規化とtrim後に1〜80 Unicode code pointsとする既存契約を維持する。
- 候補、自由入力、冷蔵庫候補のいずれも同じ検証経路を使い、安全検査、autosave、生成contextを迂回しない。
- 追加・解除・重複判定は共通 helper を使い、経路ごとに `===` / `includes` を再実装しない。
- 冷蔵庫候補をメイン食材へ追加しても、確認画面の「必ず使う／使えれば使う」に対応する `pantrySelections` は変更しない。
- 冷蔵庫候補 UI の「選択済みなら disabled（トグル解除しない）」は現行どおり維持する。クイック選択チップだけが押下で選択／解除トグルする（意図的非対称）。
- 候補チップは`button`と`aria-pressed`で選択状態を表し、色だけに依存しない。
- 選択・解除はキーボードだけでも実行可能にし、タッチ領域は44×44 CSS px以上とする。
- 320 CSS pxで横スクロールを発生させない。
- コードコメントとコミットメッセージは日本語とし、コミットはConventional Commits形式にする。
- Node/npmコマンドはすべてDocker経由で、1コマンドずつ独立して実行する。
- 各Taskは1コミットとし、Critical/Important指摘が残った状態で次Taskへ進まない。

---

## File Structure

| ファイル | 変更内容 |
|---|---|
| `src/features/planner/model/main-ingredient-options.ts` | 新規。Task 1: 正規化・canonical 判定・除外 helper。Task 2: 静的候補定数 |
| `src/features/planner/model/main-ingredient-options.test.ts` | 新規。helper / 候補の単体テスト |
| `src/features/planner/components/ingredient-step.tsx` | helper 接続、候補 UI、選択件数、共通追加・解除 |
| `src/features/planner/components/planner-wizard.test.tsx` | 候補選択、解除、自由入力、上限、disabled、pantry 相互状態、DOM 順の component テスト |
| `src/styles.css` | クイック選択領域、件数表示、320px表示の最小限のスタイル |
| `e2e/specs/mobile-accessibility.spec.ts` | 実routeでのキーボード操作と狭幅表示の回帰。既存spec構造に適合する場合のみ変更 |
| `docs/testing/acceptance-matrix.md` | 新しい受け入れテストの対応付け |

**accessible name を `メイン食材` のまま維持するため、E2E fixtures の一括リネームは不要。** ラベルを将来変更する場合は、本 Plan を改訂し `e2e/specs/*` と `e2e/fixtures/*` の全参照を同一 Task で更新すること。

`e2e/specs/mobile-accessibility.spec.ts` に対象routeを安定して準備できる既存fixtureがない場合、新しいE2E基盤は作らず、componentテストと既存E2Eの静的レビューでTask 3の範囲を閉じる。その判断と未実施理由をreportへ記録する。E2E をスキップする場合でも Task 2/3 の component テストに **キーボード操作** と **DOM 表示順（320px 前提の折返し構造）** の証拠を必須とする。

---

### Task 1: canonical 比較 helper の共通化

**Files:**

- Create: `src/features/planner/model/main-ingredient-options.ts`
- Create: `src/features/planner/model/main-ingredient-options.test.ts`
- Modify: `src/features/planner/components/ingredient-step.tsx`
- Modify: `src/features/planner/components/planner-wizard.test.tsx`（Gate 0-B で baseline 承認した WIP テストがある場合、または抽出後の回帰固定が必要な場合）

**Interfaces:**

- Produces: `normalizeMainIngredient(value: string): string`
- Produces: `includesCanonicalMainIngredient(values: readonly string[], candidate: string): boolean`
- Produces: `excludeCanonicalMainIngredient(values: readonly string[], candidate: string): string[]`
- Does **not** produce: `commonMainIngredients`（Task 2 で追加。未使用定数の 1 コミットを避ける）
- Consumes: なし
- Contract:
  - 正規化は既存どおり `value.normalize("NFKC").trim()` とする。
  - 部分一致・表記ゆれ辞書・同義語変換は導入しない。
  - `includesCanonicalMainIngredient` は正規化後の完全一致のみ。
  - `excludeCanonicalMainIngredient` は正規化後に一致する要素をすべて除いた新しい配列を返す（元配列を mutate しない）。
  - 自由入力追加・冷蔵庫追加・選択済みチップ解除は、この module の helper だけを使う。`value.includes` / `===` による経路別判定を残さない。

- [ ] **Step 1: 失敗する単体テストを書く**

次を固定する。

- `"ｶﾚｰ"` と `"カレー"`、`" ㌔ "` と `"キロ"`、全角空白付きの値を canonical 同値として `includes` が true になる。
- `"鮭"` と `"さば"` のような別の食材は同値にしない。
- `excludeCanonicalMainIngredient([" 鶏肉 ", "豚肉"], "鶏肉")` が `["豚肉"]` 相当（正規化後一致分のみ除去）になる。
- `exclude` は元配列を変更しない。
- 空文字・空白のみは正規化後 `""` になり、80 code points 超の判定材料として UI 側で使う前提を壊さない（helper 自体は長さ制限を課さない）。

Gate 0-B の場合、既存 WIP の component テスト（canonical 重複追加防止、冷蔵庫 8/80 上限）を維持または同 Task に取り込み、helper 抽出後も PASS することを保証する。

- [ ] **Step 2: REDを確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/planner/model/main-ingredient-options.test.ts
```

期待: 新規moduleが存在しないためFAIL。

- [ ] **Step 3: helper を実装し `ingredient-step` へ接続する**

`ingredient-step.tsx` 内の同等 helper を挙動を変えずに新 module へ移動する。重複した正規化実装を残さない。自由入力・冷蔵庫の追加判定と、選択済みチップ（「を外す」）の解除を `includesCanonical` / `excludeCanonical` に統一する。

- [ ] **Step 4: GREENを確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/planner/model/main-ingredient-options.test.ts
```

```bash
docker compose run --rm --no-deps app npx vitest run src/features/planner/components/planner-wizard.test.tsx
```

期待: 両方 PASS。helper 抽出で wizard が壊れていないこと。

- [ ] **Step 5: Task内検証を行う**

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npm run lint
```

```bash
docker compose run --rm --no-deps app npm run format:check
```

```bash
git diff --check
```

- [ ] **Step 6: コミットする**

変更したファイルだけを明示して stage する（Plan 9 外のファイルを混ぜない）。

```bash
git add src/features/planner/model/main-ingredient-options.ts src/features/planner/model/main-ingredient-options.test.ts src/features/planner/components/ingredient-step.tsx
```

`planner-wizard.test.tsx` を変更した場合はそれも stage する。

```bash
git commit -m "refactor: メイン食材の正規化判定を共通化"
```

- [ ] **Step 7: Verifier、一次Reviewer、二次Reviewerを実行する**

既存正規化契約、80 文字上限ロジックが UI に残っていること、設計外の同義語変換がないこと、追加・解除が同一 canonical 規則であること、Plan 9 外ファイルがコミットに混入していないことを確認する。

---

### Task 2: クイック選択UIと自由入力の共存

**Files:**

- Modify: `src/features/planner/model/main-ingredient-options.ts`
- Modify: `src/features/planner/model/main-ingredient-options.test.ts`
- Modify: `src/features/planner/components/ingredient-step.tsx`
- Modify: `src/features/planner/components/planner-wizard.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**

- Consumes: Task 1 の `normalizeMainIngredient`、`includesCanonicalMainIngredient`、`excludeCanonicalMainIngredient`
- Produces: `commonMainIngredients`（Gate 0 承認済みの順序・文字列）
- Produces: なし（UI props）。既存 `IngredientStepProps` と `PlannerDraftInput` は変更しない。
- Contract:
  - すべての操作は既存の `onChange(readonly string[])` だけを通る。
  - クイック選択の追加・解除、選択済みチップ解除、自由入力追加、冷蔵庫追加はすべて Task 1 helper 経由。
  - 入力の accessible name は **`メイン食材`** のまま。セクション見出し「一覧にない食材を入力」を `h3` 等で追加する。

表示順は次で固定する。

1. 「よく使う食材から選ぶ」（クイック選択チップ、`aria-pressed`）
2. 「選んだ食材（N/8）」と選択済みチップ（解除用。現行どおり「Xを外す」等の accessible name で操作可能にする）
3. 「一覧にない食材を入力」（見出し）+ label `メイン食材` の input + 追加 button
4. 「冷蔵庫から選ぶ」（現行どおり。選択済みは disabled、トグル解除しない）
5. 戻る／次へ

- [ ] **Step 1: 失敗するcomponentテストを書く**

次を固定する（タイトルは英語、説明コメントは日本語でよい）。

- 初期候補 8 件と見出し「よく使う食材から選ぶ」が表示される。
- `commonMainIngredients` の順番・文字列が承認済みリストと一致する（model テストでも可）。
- 全候補が空でなく NFKC+trim 済みで 80 code points 以内である（model テスト）。
- 未選択候補は `aria-pressed="false"`、選択済み候補は `aria-pressed="true"`。
- 候補を 1 回押すと追加、同じ候補をもう 1 回押すと解除される（解除は `excludeCanonical`）。
- 自由入力で追加した値と canonical 同値の候補は選択済みになる。
- 冷蔵庫候補と canonical 同値の候補を押しても `mainIngredients` が重複しない。
- クイック選択で「鶏肉」を選ぶと、冷蔵庫の「鶏肉を追加」が disabled になる。解除すると再び追加可能になる。
- 8 件選択済みで未選択候補を押すと「メイン食材は8件までです。」を表示し、配列を変更しない。未選択候補を disabled にして解除不能にしない。
- 8 件選択済みでも選択済み候補のトグル解除と「を外す」チップ解除ができる。
- disabled 時は候補、自由入力、解除のすべてを変更できない。
- 「選んだ食材（N/8）」が追加・解除に追随する。
- 自由入力欄（accessible name `メイン食材`）と「追加」button は引き続き表示され、入力から次 step へ進める。
- 候補選択は `pantrySelections` を変更しない。
- **DOM 順:** 見出し「よく使う食材から選ぶ」→「選んだ食材」→「一覧にない食材を入力」→「冷蔵庫から選ぶ」→「次へ」の document order を固定する（320px で折返し前提の構造証拠）。

- [ ] **Step 2: REDを確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/planner/components/planner-wizard.test.tsx
```

期待: 候補見出しまたは候補buttonが存在しないためFAIL。

- [ ] **Step 3: 候補操作を実装する**

追加、解除、重複判定、8件上限の処理を候補種別ごとに複製しない。クイック選択トグル解除と選択済みチップ解除の両方で `excludeCanonicalMainIngredient` を使う。上限到達時も選択済み候補は無効化せず、解除可能な状態を維持する。

自由入力はセクション見出し「一覧にない食材を入力」+ label `メイン食材`。accessible name を変更しないため、既存の `getByLabelText("メイン食材")` / E2E `textbox "メイン食材"` を壊さない。

- [ ] **Step 4: スタイルを追加する**

既存の `.wizard-chip-row`、`.wizard-chip`、`.wizard-chip[aria-pressed="true"]` を再利用する。追加CSSはセクション間隔、件数表示、必要な狭幅調整だけに限定する。`flex-wrap` により横スクロールを出さない。

- [ ] **Step 5: GREENを確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/planner/model/main-ingredient-options.test.ts
```

```bash
docker compose run --rm --no-deps app npx vitest run src/features/planner/components/planner-wizard.test.tsx
```

期待: PASS。

- [ ] **Step 6: Plannerの関連回帰を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/planner
```

期待: PASS。accessible name `メイン食材` を参照する既存テストは **変更不要**（方針どおり維持していることの確認）。

- [ ] **Step 7: Task内検証を行う**

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npm run lint
```

```bash
docker compose run --rm --no-deps app npm run format:check
```

```bash
git diff --check
```

- [ ] **Step 8: コミットする**

```bash
git add src/features/planner/model/main-ingredient-options.ts src/features/planner/model/main-ingredient-options.test.ts src/features/planner/components/ingredient-step.tsx src/features/planner/components/planner-wizard.test.tsx src/styles.css
```

```bash
git commit -m "feat: メイン食材のクイック選択を追加"
```

- [ ] **Step 9: Verifier、一次Reviewer、二次Reviewerを実行する**

設計適合性に加え、上限到達後に解除不能にならないこと、candidate/free/pantry 間の canonical 重複、クイック選択と冷蔵庫の相互 UI、`pantrySelections` 非干渉、accessible name 維持、医療対象外入力検査の迂回がないことを敵対的に確認する。

---

### Task 3: アクセシビリティ、実route回帰、受け入れ証跡

**Files:**

- Modify: `e2e/specs/mobile-accessibility.spec.ts`（既存fixtureで安定実行できる場合）
- Modify: `docs/testing/acceptance-matrix.md`
- Modify: `src/features/planner/components/planner-wizard.test.tsx`（Task 2 で不足したキーボード／a11y 回帰がある場合）

**Interfaces:**

- Consumes: Task 2のクイック選択UI
- Produces: テストと受け入れ証跡のみ。本番契約は変更しない。

- [ ] **Step 1: 実routeで検証可能な範囲を確認する**

既存の認証fixtureとplanner遷移を再利用できるか確認する。新しい認証・DB・AI fixtureは作らない。accessible name は `メイン食材` のままなので、既存の wizard 入力ヘルパはそのまま使える。

- [ ] **Step 2: 失敗する回帰テストを追加する**

安定したE2Eが可能な場合、次を固定する。

- 320px幅で候補、自由入力、追加buttonに横スクロールや重なりがない。
- TabとEnterまたはSpaceだけで候補を選択・解除できる。
- 選択後もfocusが予期せずstep見出しや「次へ」へ飛ばない。
- 選択状態が文字または `aria-pressed` でも識別できる。
- 自由入力 textbox の accessible name が引き続き `メイン食材` である。

E2Eが不適切な場合は **component テストでキーボード操作を必須追加**し、その理由を report に記録する。E2E スキップ時の最低証拠:

1. 候補 button を keyboard（Enter または Space）で選択・解除できる。
2. Task 2 の DOM 順テストが残っている。
3. 既存 E2E の `textbox "メイン食材"` 参照が静的に壊れていないこと（grep 確認を report に記載）。

- [ ] **Step 3: REDを確認する**

E2Eを変更した場合:

```bash
./scripts/run-e2e.sh e2e/specs/mobile-accessibility.spec.ts
```

componentテストのみの場合:

```bash
docker compose run --rm --no-deps app npx vitest run src/features/planner/components/planner-wizard.test.tsx
```

- [ ] **Step 4: 必要最小限の修正でGREENにする**

本番コードの修正が必要になった場合はTask 2所有ファイルへ戻るため、Task 3のImplementer reportに理由を明記する。別の仕様や候補カテゴリを追加しない。accessible name を変更して E2E を通すことは禁止（方針変更は Plan 改訂が先）。

- [ ] **Step 5: acceptance matrixを更新する**

Guided planner 節（または Notes 隣接の追記行）に、次を exact test title で紐付ける。

- 「メイン食材は候補チップまたは自由入力で複数選択できる」
- 対応: `planner-wizard.test.tsx` の該当 it 名（および E2E を追加した場合はその title）

`scripts/verify-acceptance-matrix.test.mjs` が file 実在と title 部分一致を検査するため、**実際のテスト名と一致**させる。

- [ ] **Step 6: focused検証を再実行する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/planner
```

E2Eを変更した場合:

```bash
./scripts/run-e2e.sh e2e/specs/mobile-accessibility.spec.ts
```

- [ ] **Step 7: Task内検証を行う**

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npm run lint
```

```bash
docker compose run --rm --no-deps app npm run format:check
```

```bash
git diff --check
```

- [ ] **Step 8: コミットする**

変更したファイルだけを明示してstageする。

```bash
git commit -m "test: メイン食材選択の操作性を検証"
```

- [ ] **Step 9: Verifier、一次Reviewer、二次Reviewerを実行する**

一次Reviewerは本 Plan（UI/a11y/候補）、上位設計、320px、敵対的入力、回帰、accessible name 維持を確認する。二次Reviewerは一次Reviewerとコンテキストを共有せず、指摘と証拠を独立して深掘りする。

---

## Plan Completion Gate

Task 1〜3のCritical/Importantがすべて解消した後、clean baselineを記録し、次のコマンドを1つずつこの順番で実行する。

- [ ] `docker compose run --rm --no-deps app npm run format:check`
- [ ] `docker compose run --rm --no-deps app npm run lint`
- [ ] `docker compose run --rm --no-deps app npm run typecheck`
- [ ] `docker compose run --rm --no-deps app npx vitest run`
- [ ] `./scripts/reset-local-db.sh`
- [ ] `docker compose --profile test run --rm db-test`
- [ ] `./scripts/run-e2e.sh`
- [ ] `docker compose run --rm --no-deps app npm run build`
- [ ] `git diff --check`

各Docker検証の実行前後でstaged diff、unstaged diff、untracked一覧を比較し、意図しないworktree変更がないことを確認する。

最終レビューでは次を確認する。

- [ ] 自由入力が常時利用でき、accessible name が `メイン食材` のままである。
- [ ] 候補だけでも「次へ」進める。
- [ ] 候補、自由入力、冷蔵庫候補が同じ配列契約と canonical helper を使う。
- [ ] 最大8件、各80文字、canonical重複防止・解除が全経路で一致する。
- [ ] 選択解除が上限到達後も可能である。
- [ ] クイック選択トグルと冷蔵庫 disabled の意図的非対称が維持されている。
- [ ] safety preflight、autosave、生成request、review表示に回帰がない。
- [ ] API、DB、Supabase migration、環境変数の変更がない。
- [ ] 320px構造とキーボード操作の証拠がある（E2E または必須 component テスト）。
- [ ] `docs/testing/acceptance-matrix.md` が実際のテスト名と一致する。
- [ ] Plan 9 外の worktree 変更がコミットに混入していない。

すべて完了した場合のみ `.superpowers/sdd/progress.md` にPlan 9完了を記録する。次TaskがあるTask完了時は、`AGENTS.md` のwrite-once handoff規則に従い、正本と安全性を確認した `.superpowers/sdd/handoff-plan-9-task-<completed>-to-task-<next>-<head7>.md` を一意に作成する。

---

## Out of Scope

- 利用履歴から「最近使った食材」を取得・保存する機能
- 季節、地域、家族、時間帯による候補のパーソナライズ
- 候補の検索、カテゴリ階層、「もっと見る」
- 候補カタログ用のDB/API/Supabase migration
- 表記ゆれ辞書、類義語統合、曖昧一致
- 冷蔵庫候補の並び順や `pantrySelections` の意味変更
- 冷蔵庫候補をクイック選択と同様のトグル解除にする変更（現行は選択済み disabled のまま）
- 自由入力 accessible name の変更、およびそれに伴う E2E/fixture 一括リネーム
- 旧 `planner-page` フォームの改修
- AI prompt、generation context、医療対象外入力検査の仕様変更
