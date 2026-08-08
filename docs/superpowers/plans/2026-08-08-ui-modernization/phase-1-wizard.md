# Phase 1: ウィザード（献立条件入力）

> **前提:** `README.md` の Global Constraints をすべて読んでいること。
> **Phase 0 が完了・承認されていること。** プリミティブと ESLint ルールが無い状態で
> 着手してはならない。

**このフェーズのゴール:** 献立条件を入力するウィザードを「フォームの列挙」から
「1 画面 1 問の問いかけ」に変える。

**なぜここから始めるのか:** `src/shared/ui/wizard/` に `wizard-frame` / `choice-card` /
`progress-indicator` / `review-row` / `inline-notice` という部品分割が既に済んでおり、
プリミティブが最も少ない差分で効く。移行コストが 4 領域で最も低い。

---

## File Structure

| ファイル | 責務 | 行数の目安 |
| --- | --- | --- |
| `src/shared/ui/wizard/wizard-frame.tsx`（変更） | 段組みの骨格。`Button` を使うよう置換 | 現状 79 行 |
| `src/shared/ui/wizard/choice-card.tsx`（変更） | 選択肢カード | — |
| `src/shared/ui/wizard/progress-indicator.tsx`（変更） | 進捗表示 | — |
| `src/shared/ui/wizard/review-row.tsx`（変更） | 確認画面の行 | — |
| `src/shared/ui/wizard/inline-notice.tsx`（変更） | 注意書き | — |
| `src/features/planner/components/audience-step.tsx`（変更） | 誰に作るか | — |
| `src/features/planner/components/meal-step.tsx`（変更） | 食事の種類 | — |
| `src/features/planner/components/cuisine-step.tsx`（変更） | 料理の系統 | — |
| `src/features/planner/components/ingredient-step.tsx`（変更） | 使いたい食材 | — |
| `src/features/planner/components/review-step.tsx`（変更） | 確認 | — |
| `src/styles.css`（変更） | 上記の見た目 | — |
| `eslint.config.js`（変更） | `src/features/planner/**` を例外リストから外す | — |

---

## 不変契約（変更したら差し戻し）

### 1. `.choice-card` の `box-shadow`

`src/styles.contrast.test.ts:1712` が `"0 4px 16px rgb(66 58 50 / 8%)"` で**完全一致固定**し、
`:1244` が `.choice-card { … box-shadow: … }` の存在を正規表現で要求している。
`hasExactDeclarations` は宣言の増減も落とすため、**この 1 宣言は触らない**。

「影はほぼ使わない」という方向性と衝突するが、**契約が優先**。

### 2. モーションは 2 パターンのみ

`unexpectedMotionRules` が許すのは以下だけ。

```css
.wizard-transition { animation: wizard-enter 180ms ease-out; }
@media (prefers-reduced-motion: reduce) { .wizard-transition { animation: none; } }
```

**新しい `animation` / `transition` をウィザード配下に追加してはならない。**
`.wizard-` は保護セレクタ断片でもある。

### 3. 完全一致で固定されている宣言

`src/styles.contrast.test.ts` の `expectExactRuleDeclarations` / `expectFinalDeclarations`
が以下を宣言単位で固定している。**宣言を 1 つ足すだけでも落ちる。**

- `.guided-planner-theme .ingredient-entry-row`（`:1248`）
- `.guided-planner-theme .wizard-option-list` / `.wizard-option` / `.wizard-chip-row` /
  `.wizard-review-list`（`:1272` 付近）

これらを変えたい場合は**実装を止めて人間に相談する**こと。勝手に allowlist を
書き換えない。

### 4. アクセシブル名と構造

- `WizardFrame` の `h1` に `tabIndex={-1}` を付けてステップ切替時にフォーカスする挙動を維持。
- 「戻る」「処理中…」というボタン文言を維持。primary の label は呼び出し側から来るので
  各 step の文言を変えない。
- `ProgressIndicator` の `currentStep` / `totalSteps` の意味と表示を変えない。
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

- 設問（`.wizard-title`）を明朝で大きく取り、選択肢との間に十分な余白を置く。
- 選択肢は塗りではなく細い線のカードにする（`box-shadow` は既存値のまま）。
- 進捗表示は控えめに。ページ上部に細い線で。
- 「戻る」は目立たせない。前進が主動線であることを見た目で示す。

---

## Task 1.1: WizardFrame のボタンを Button プリミティブに置き換える

**Files:**
- Modify: `src/shared/ui/wizard/wizard-frame.tsx`
- Test: `src/shared/ui/wizard/wizard-ui.test.tsx`（既存。**アクセシブル名を変えなければ変更不要**）

**Interfaces:**
- Consumes: `Button` from `@/shared/ui/button`

- [ ] **Step 1: 既存テストを実行して現状の緑を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/shared/ui/wizard/wizard-ui.test.tsx
```

期待: PASS。**この時点の結果を控えておく**（置換後に同じ結果になることが目標）。

- [ ] **Step 2: `Button` を使うよう置き換える**

`src/shared/ui/wizard/wizard-frame.tsx` の footer を差し替える。

```tsx
      <footer className="wizard-actions">
        {onBack !== undefined && (
          <Button variant="ghost" onClick={onBack}>
            戻る
          </Button>
        )}
        <Button
          variant="primary"
          size="large"
          busy={primaryAction.busy === true}
          disabled={primaryAction.disabled === true}
          onClick={primaryAction.onClick}
        >
          {primaryAction.busy === true ? "処理中…" : primaryAction.label}
        </Button>
      </footer>
```

`import { Button } from "@/shared/ui/button";` を追加する。

**注意:** 元の実装は `disabled={primaryAction.disabled === true || primaryAction.busy === true}`
だった。`Button` は内部で `disabled || busy` を評価するため、`disabled` と `busy` を
別々に渡してよい。`aria-busy` も `Button` が付ける。

**注意:** 元の `className="primary-button wizard-action"` / `"text-button wizard-action"` が
消えることで `.wizard-actions` のレイアウト CSS が効かなくなる可能性がある。
Step 4 で見た目を確認すること。

- [ ] **Step 3: テストを実行して緑を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/shared/ui/wizard/wizard-ui.test.tsx
docker compose run --rm --no-deps app npx vitest run src/features/planner
docker compose run --rm --no-deps app npx vitest run src/styles.contrast.test.ts
```

期待: すべて PASS。

- [ ] **Step 4: コミット**

```bash
git add src/shared/ui/wizard/wizard-frame.tsx
git commit -m "refactor: ウィザードのボタンを共有 Button に置き換える"
```

---

## Task 1.2: ウィザードの見た目をエディトリアルに整える

**Files:**
- Modify: `src/styles.css`
- Modify: `src/shared/ui/wizard/*.tsx`（必要な範囲で）
- Modify: `src/features/planner/components/*.tsx`（必要な範囲で）

- [ ] **Step 1: 変更してはならない宣言を洗い出す**

```bash
grep -n 'wizard-option\|ingredient-entry-row\|choice-card\|wizard-chip-row\|wizard-review-list' src/styles.contrast.test.ts
```

出力された行のセレクタは**宣言単位で固定**されている。これらのルールを変更しない。
変更が必要になったら実装を止めて人間に相談する。

- [ ] **Step 2: 見た目を整える**

上記以外の `.wizard-title` / `.wizard-description` / `.wizard-header` / `.wizard-content` /
`.wizard-actions` などを、「意図」に沿って調整する。**具体は実装者の裁量。**

制約:
- 新しい `animation` / `transition` を追加しない
- 色は `var(--…)` 参照のみ
- 新規クラス名に保護セレクタ断片を含めない
- `style` 属性を書かない
- 明朝は 700 のみ（`--question-font` はそのまま使う）

- [ ] **Step 3: スタイル契約テストを実行する**

```bash
docker compose run --rm --no-deps app npx vitest run src/styles.contrast.test.ts src/styles.theme.test.ts
```

期待: PASS。落ちた場合、まず**自分が固定宣言を触っていないか**を確認する。
新規セレクタが保護断片に引っかかっただけなら `allowedProtectedSelectors` に理由コメント
付きで追記してよい。既存アサーションの変更は不可。

- [ ] **Step 4: a11y と e2e を実行する**

```bash
docker compose run --rm --no-deps app npx vitest run src/app/accessibility.test.tsx
./scripts/run-e2e.sh > /tmp/e2e.log 2>&1
grep -nE 'passed|failed|✘' /tmp/e2e.log | tail -n 30
```

期待: すべて PASS。特に `mobile-accessibility.spec.ts` が全 step で 320px と 44px を実測する。

落ちた場合は e2e を書き換えず、**実装を直す**。Phase 1 は e2e の改訂を認めない。

- [ ] **Step 5: ESLint の例外リストから planner を外す**

`eslint.config.js` の `ignores` から `"src/features/planner/**"` の行を削除する。

```bash
docker compose run --rm --no-deps app npm run lint > /tmp/lint.log 2>&1
grep -nE 'error|problem' /tmp/lint.log || tail -n 30 /tmp/lint.log
```

期待: エラーなし。エラーが出たら、残っている生ユーティリティをプリミティブに置き換える。

- [ ] **Step 6: コミット**

```bash
git add src/styles.css src/shared/ui/wizard src/features/planner/components eslint.config.js
git commit -m "refactor: ウィザードの見た目をエディトリアル方向に整える"
```

---

## Phase 1 完了チェック

- [ ] `README.md` の検証フロー 9 ステップをすべて実行し、すべてパスした
- [ ] 変更禁止テスト 4 本の既存アサーションを 1 つも変更していない
- [ ] `.choice-card` の `box-shadow` を変えていない
- [ ] ウィザード配下に新しい `animation` / `transition` を追加していない
- [ ] ボタンの増減・改名をしていない
- [ ] `eslint.config.js` の `ignores` から `src/features/planner/**` が消えた状態で lint が緑
- [ ] 全 step のスクリーンショットを 320 / 375 / 768 px で提出した

**次:** `phase-2-generation-wait.md`
