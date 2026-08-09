# Phase 1: ウィザード（献立条件入力）

> **前提:** `README.md` の Global Constraints をすべて読んでいること。
> **Phase 0 が完了・承認されていること。** プリミティブと ESLint ルールが無い状態で
> 着手してはならない。

**このフェーズのゴール:** 献立条件を入力するウィザードを「フォームの列挙」から
「1 画面 1 問の問いかけ」に変える。

**重要な前提の訂正:** 当初この計画は「`src/shared/ui/wizard/` に部品分割が済んでおり
移行コストが最小」としていたが、**これは事実誤認だった**。実測の結果:

```
WizardFrame:       0 参照
ChoiceCard:        0 参照
ProgressIndicator: 0 参照
ReviewRow:         0 参照
InlineNotice:      household-onboarding-page.tsx / idea-menu-safety-notice.tsx
```

`src` 配下で `WizardFrame` / `ChoiceCard` / `ProgressIndicator` / `ReviewRow` は
**参照ゼロの死コード**である。実際のウィザードは各 step が自前でマークアップを持つ
（例: `meal-step.tsx:118-137` が `.wizard-actions` と `.secondary-button` を直書き）。

**したがって改修対象は step ファイル群であり、`src/shared/ui/wizard/` ではない。**

---

## File Structure

| ファイル | 責務 |
| --- | --- |
| `src/features/planner/components/audience-step.tsx`（変更） | 誰に作るか |
| `src/features/planner/components/meal-step.tsx`（変更） | 食事の種類 |
| `src/features/planner/components/cuisine-step.tsx`（変更） | 料理の系統 |
| `src/features/planner/components/ingredient-step.tsx`（変更） | 使いたい食材 |
| `src/features/planner/components/review-step.tsx`（変更） | 確認 |
| `src/features/planner/current-safety-summary.tsx`（変更） | 安全サマリ（ESLint 対象に入る） |
| `src/styles.css`（変更） | 新規 `.ui-*` セレクタのみ追加 |
| `eslint.config.js`（変更） | `src/features/planner/**` を例外リストから外す |

**`src/shared/ui/wizard/` は対象外。** 扱いは Task 1.0 で人間に確認する。

**注意**: `src/features/planner/**` を ESLint 例外から外すと、Phase 4 の対象である
`planner-route.tsx`（1,313 行）も lint 対象になる。Phase 1 でそのファイルの生
ユーティリティを潰し、Phase 4 で構造を作り直すという二度手間が発生する。
Task 1.1 Step 6 で「生ユーティリティの置き換えだけに留め、構造の再設計は
Phase 4 まで先取りしない」方針を取る。

---

## 不変契約（変更したら差し戻し）

### 1. `.choice-card` の `box-shadow`

`src/styles.contrast.test.ts:1712` が `"0 4px 16px rgb(66 58 50 / 8%)"` で**完全一致固定**し、
`:1244` が `.choice-card { … box-shadow: … }` の存在を正規表現で要求している。
`hasExactDeclarations` は宣言の増減も落とすため、**この 1 宣言は触らない**。

「影はほぼ使わない」という方向性と衝突するが、**契約が優先**。

### 2. モーション — 既存セレクタは不可、新規 `.ui-*` は可

**既存のウィザードセレクタ**（`.wizard-*` / `.choice-card` / `.progress-*` /
`.inline-notice*` / `.review-row*` / `.primary-button`）と素の要素セレクタ、および
`*` にはモーションを**追加できない**。これらは代表 DOM に一致するため
`unexpectedMotionRules` が拾う。

**新規クラス名**（`.ui-*`）には `@media (prefers-reduced-motion: reduce)` のペアを
添えれば追加してよい（実測で確認済み。README「モーション」参照）。

`.wizard-transition` の既存 2 パターンは維持する。

### 3. ウィザード CSS は宣言単位で凍結されている（最重要）

`src/styles.contrast.test.ts:370-687` の `taskRuleDeclarations` は **66 セレクタ**を
キーに持ち、**全件がウィザード／guided-planner／デザインシステム系**である。
（`:689-814` は別定数 `globalRuleDeclarations` で、こちらは部分集合検査のため宣言の追加が
通る。混同しないこと。詳細は README の「凍結ガードは 2 つある」節。）当初この計画は
「`.ingredient-entry-row` など 6 セレクタ」と書いていたが、実際には**ウィザード CSS の
ほぼ全ルール**が対象で、以下がすべて含まれる。

`.wizard-frame` / `.wizard-header` / `.wizard-content` / `.wizard-actions` /
`.wizard-title` / `.wizard-description` / `.wizard-action` / `.choice-card` /
`.progress-indicator` / `.inline-notice` / `.review-row` /
`.guided-planner-theme .wizard-option*` / `.guided-planner-theme .ingredient-*` ほか

`hasExactDeclarations`（`:816-833`）は宣言数の一致を要求するため、**宣言を 1 つ足すだけ、
1 つ消すだけで落ちる。**

**`allowedProtectedSelectors` への追記では回復しない。** `unexpectedProtectedSelectors`
は `:864` で `taskRuleDeclarations[selector]` を先に引き、存在すれば
`hasExactDeclarations` を要求する。実測では、**既に allowlist に載っている**
`.wizard-title`（`:324`）に `letter-spacing` を 1 行足しただけで 3 テストが落ちた。
回復には `taskRuleDeclarations` 本体の書き換えが必要で、それは**変更禁止テストの編集**にあたる。

**したがって Phase 1 の既定方針は「これら 66 セレクタを一切触らない」である。**
見た目は新規 `.ui-*` セレクタ側で表現する。既存セレクタを変える必要が生じたら、
実装を止めて人間に相談する。

### 4. アクセシブル名と構造

- **step 見出しの文言と番号書式を変えない。** `1. 食事` / `5. 確認` は
  `e2e/specs/mobile-accessibility.spec.ts:108` / `:97`、`full-journey.spec.ts:39-40`、
  `menu-domain-pantry.spec.ts:75, 130, 610, 629`、`e2e/fixtures/history.ts:167, 366`、
  `e2e/fixtures/shopping.ts:72` が `getByRole("heading", { name: … })` で引いている。
- **ステップ切替時に見出しへフォーカスする挙動を維持する**（`tabIndex={-1}` を持つ
  見出しに `focus()`）。live の step ファイル側の実装を読んでから触ること。
- 「戻る」「処理中…」というボタン文言を維持。
- 進捗表示の `currentStep` / `totalSteps` の意味と表示を変えない。
- **step 数と分岐条件を変えない。**

### 5. 下書き autosave

`save_generation_draft` RPC の呼び出しタイミング（`useDraftAutosave`）を一切変えない。
`e2e/specs/mobile-accessibility.spec.ts` の `waitDraftSave` がこの POST を待っている。

### 6. 全 step で 320px 横スクロールなしと 44×44

`e2e/specs/mobile-accessibility.spec.ts` の `assertStepFits` が全 step で実測する。
`assertMajorActionHeights` は**ボタン名ごとに件数を `toHaveCount` で固定**しているため、
ボタンを増やすとその spec が落ちる。**ボタンの増減をしない。**

---

## 意図（ここが実装者の裁量）

余白で問いを立てる。1 画面に 1 問だけがあるように見せる。

- 設問を明朝で大きく取り、選択肢との間に十分な余白を置く。
- 選択肢は塗りではなく細い線のカードにする。
- 進捗表示は控えめに。ページ上部に細い線で。
- 「戻る」は目立たせない。前進が主動線であることを見た目で示す。
- hover / focus のトランジションは**新規 `.ui-*` セレクタ側でなら使ってよい**
  （reduced-motion ペア必須）。

**Phase 0 Task 0.8 で人間が承認した数値目安（見出し／本文比、罫線本数上限、
面の入れ子深さ、最小余白）に従うこと。**

**ただし §3 の凍結により、既存の `.wizard-*` セレクタは触れない。**
見た目の変更は、step ファイル側のマークアップを新規 `.ui-*` クラスと
Phase 0 のプリミティブで組み直すことによって行う。

---

## Task 1.0: `src/shared/ui/wizard/` の扱いを人間に確認する

**Files:** なし（確認のみ）

- [ ] **Step 1: 参照ゼロであることを自分で確認する**

```bash
for c in WizardFrame ChoiceCard ProgressIndicator ReviewRow InlineNotice; do
  echo -n "$c: "
  grep -rl "\b$c\b" src --include=*.tsx | grep -v 'shared/ui/wizard' | grep -v '\.test\.tsx' | tr '\n' ' '
  echo
done
```

期待される出力: `InlineNotice` 以外はすべて空。

- [ ] **Step 2: 人間に判断を仰ぐ**

`WizardFrame` / `ChoiceCard` / `ProgressIndicator` / `ReviewRow` の 4 ファイルと
そのテストを **(a) 削除する / (b) 残す** のどちらにするか確認する。

削除する場合、`src/styles.css` の対応する CSS ルール（`.wizard-frame` /
`.choice-card` / `.progress-indicator` / `.review-row`）は**削除しない**。
`taskRuleDeclarations` がそれらの存在を要求しており、消すと変更禁止テストが落ちる。
**DOM から消えても CSS は残る**という状態になることを人間に伝えたうえで判断させる。

**判断が得られるまで Task 1.1 に着手しない。**

---

## Task 1.1: step ファイルをプリミティブで組み直す

**Files:**
- Modify: `src/features/planner/components/{audience,meal,cuisine,ingredient,review}-step.tsx`
- Modify: `src/features/planner/current-safety-summary.tsx`
- Modify: `src/styles.css`（新規 `.ui-*` セレクタのみ追加）

**Interfaces:**
- Consumes: `Button` / `Surface` / `Stack` / `Inset` / `PageHeader` / `Badge`
  from `@/shared/ui/*`

- [ ] **Step 1: 現状の緑と、割れる予定のテストを記録する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/planner > /tmp/before-p1.log 2>&1
tail -n 20 /tmp/before-p1.log
grep -n 'toHaveClass' src/features/planner/components/planner-wizard.test.tsx src/features/planner/current-safety-summary.test.tsx
```

`planner-wizard.test.tsx:284, 287, 288, 344, 810` と
`current-safety-summary.test.tsx:40` が `toHaveClass("wizard-action", "primary-button")` /
`toHaveClass("secondary-button", "min-h-11")` を検証している。
**これらは Phase 1 で必ず割れる。** README「クラス名アサーションは全 Phase で必ず割れる」の
規律に従い、改訂は認められるが**別コミット**にする。

- [ ] **Step 2: 各 step のボタンを `Button` に置き換える**

例えば `meal-step.tsx:118-137` は現在こうなっている。

```tsx
<div className="wizard-actions">
  {onBack !== undefined && (
    <button className="wizard-action secondary-button" ...>
```

`<button className="wizard-action secondary-button">` を `<Button variant="secondary">` に、
主操作を `<Button variant="primary" size="large">` に置き換える。

**注意 1**: 元の実装は `disabled={disabled || busy}` を自前で評価している箇所がある。
`Button` は内部で `disabled || busy` を評価し `aria-busy` も付けるため、
`disabled` と `busy` を別々に渡す。

**注意 2**: `.ui-btn--large { width: 100% }` を `.wizard-actions`
（`display: flex; justify-content: space-between`、`src/styles.css:637-642`）の中に置くと
「戻る」と主ボタンが必ず 2 行になる。`.wizard-actions` は凍結されていて変えられないので、
**`size="large"` を使わないか、step 側のラッパを新規 `.ui-*` クラスに差し替える**。
Step 5 の実機確認で必ず見ること。

**注意 3**: 「戻る」の見えが 3 系統ある（`wizard-frame` は `.text-button`、
live の meal-step は `.secondary-button`）。`Button` の `variant` をどれに寄せるかは
実装者が決めてよいが、**5 つの step で統一すること**。

- [ ] **Step 3: アクセシブル名と step 構造を変えていないことを確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/planner > /tmp/after-p1.log 2>&1
grep -nE 'FAIL|✘' /tmp/after-p1.log | head -n 30
```

落ちたテストを分類する。

- **`toHaveClass` / CSS セレクタ由来** → 改訂してよい（Step 7 で別コミット）
- **`getByRole` / `getByText` / アクセシブル名由来** → **実装が契約を破っている。実装を直す。**

- [ ] **Step 4: スタイル契約テストを実行する**

```bash
docker compose run --rm --no-deps app npx vitest run src/styles.contrast.test.ts src/styles.theme.test.ts
```

期待: PASS。落ちた場合、**まず自分が凍結セレクタ（§3 の 66 件）を触っていないかを
確認する。** 触っていたら元に戻し、新規 `.ui-*` セレクタ側で表現し直す。

新規セレクタが保護断片に引っかかっただけなら、まず**クラス名を変える**。
変えられない場合のみ `allowedProtectedSelectors` に理由コメント付きで追記する。

- [ ] **Step 5: a11y と e2e を実行する**

```bash
docker compose run --rm --no-deps app npx vitest run src/app/accessibility.test.tsx
./scripts/run-e2e.sh > /tmp/e2e.log 2>&1
grep -nE 'passed|failed|✘' /tmp/e2e.log | tail -n 30
```

期待: すべて PASS。特に `mobile-accessibility.spec.ts` が全 step で 320px と 44px を実測する。

落ちた場合は e2e を書き換えず、**実装を直す**。Phase 1 は e2e の改訂を認めない。

- [ ] **Step 6: ESLint の例外リストから planner を外す**

`eslint.config.js` の `ignores` から `"src/features/planner/**"` の行を削除する。

```bash
docker compose run --rm --no-deps app npm run lint > /tmp/lint.log 2>&1
grep -nE 'error|problem' /tmp/lint.log || tail -n 30 /tmp/lint.log
```

期待: エラーなし。

**`planner-route.tsx`（1,313 行）と `current-safety-summary.tsx` もここで lint 対象に
入る。** `planner-route.tsx` は Phase 4 で構造ごと作り直す対象なので、ここでの対応は
**生ユーティリティをプリミティブに置き換える最小限に留める**こと。構造の再設計を
先取りしない（Phase 4 で二度手間になる）。

- [ ] **Step 7: 実装とテストを別コミットに分けてコミットする**

```bash
git add src/styles.css src/features/planner eslint.config.js
git commit -m "refactor: 献立ウィザードの各ステップをプリミティブへ移行"
```

割れたクラス名アサーションを直した場合:

```bash
git add src/features/planner/components/planner-wizard.test.tsx src/features/planner/current-safety-summary.test.tsx
git commit -m "$(cat <<'"'"'EOF'"'"'
test: ウィザードのボタン実装クラスの変更に追随

wizard-action / secondary-button の直書きを共有 Button に置き換えたため、
実装クラス名を検証していた期待を更新した。role とアクセシブル名の期待は
変更していない。
EOF
)"
```

---

## Phase 1 完了チェック

- [ ] Task 1.0 で `src/shared/ui/wizard/` の扱いについて人間の判断を得た
- [ ] `README.md` の検証フロー 9 ステップをすべて実行し、すべてパスした
- [ ] 変更禁止テスト 4 本の既存アサーションを 1 つも変更していない
- [ ] **`taskRuleDeclarations` の 66 セレクタを 1 つも変更していない**
      （`.wizard-*` / `.choice-card` / `.progress-*` / `.inline-notice*` / `.review-row*`）
- [ ] `.choice-card` の `box-shadow` を変えていない
- [ ] 既存セレクタと `*` にモーションを追加していない
      （新規 `.ui-*` へのモーションは reduced-motion ペア付きで可）
- [ ] ボタンの増減・改名をしていない（`assertMajorActionHeights` の件数固定に直撃するため）
- [ ] `role` / アクセシブル名のアサーションを 1 つも書き換えていない
- [ ] テストの改訂は実装とは別コミットになっている
- [ ] `eslint.config.js` の `ignores` から `src/features/planner/**` が消えた状態で lint が緑
- [ ] 全 step のスクリーンショットを 320 / 375 / 768 px で提出した
- [ ] Phase 0 Task 0.8 で承認された数値目安に沿っていることを説明した

**次:** `phase-2-generation-wait.md`
