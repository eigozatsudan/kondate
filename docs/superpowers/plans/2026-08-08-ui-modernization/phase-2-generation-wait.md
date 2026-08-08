# Phase 2: 待ち時間体験

> **前提:** `README.md` の Global Constraints をすべて読んでいること。
> **Phase 0・1 が完了・承認されていること。**

**このフェーズのゴール:** 献立生成中の 45 秒以上に及ぶ待ち時間を、退屈と不安の時間から
「作られている」ことが伝わる時間に変える。

**なぜ重要か:** AI アプリで最も印象に残る瞬間であり、ここで離脱されると生成が
完了しても価値が届かない。

---

## File Structure

| ファイル | 責務 |
| --- | --- |
| `src/features/generation/components/generation-status-panel.tsx`（変更） | 各 phase の表示 |
| `src/features/generation/pages/generation-page.tsx`（変更） | 生成中ページの枠 |
| `src/features/generation/pages/menu-result-page.tsx`（変更） | 読み込み中表示を `Skeleton` に |
| `src/styles.css`（変更） | `.gen-status-panel` 系の見た目 |
| `eslint.config.js`（変更） | `src/features/generation/**` を例外リストから外す |

---

## 不変契約（変更したら差し戻し）

### 1. 段階表そのもの

`src/features/generation/model/progress-stages.ts` の `GENERATION_PROGRESS_STAGES` は
5 段。`afterMs` は **0 / 3,000 / 8,000 / 30,000 / 45,000**。

**段階数・`afterMs`・`stageMessageAt` / `selectGenerationProgressStageIndex` /
`selectGenerationProgressMessage` / `resolveProcessingAnchorMs` のシグネチャを変えない。**

### 2. 文言はサーバ工程を断定しない（安全制約）

`src/features/generation/model/progress-stages.ts:13-15` の注記:

> G9: 経過時間のみの体感段階。サーバ工程（preflight/load/ensure/markSent/OpenRouter）と
> 一致しないため、8s 帯で「AI に聞いている」と断定しない（誤認 → pending 破棄誘発を抑える）。

**現行の 5 文言を変更しないことを既定とする。**

- `条件を確認しています`
- `献立の指示を組み立てています`
- `献立案を用意しています`
- `組み合わせと段取りを整えています`
- `仕上げの確認をしています`

どうしても変えたい場合は、**「AI」「送信」「通信」「モデル」「サーバ」といった具体的な
サーバ工程を示す語を含めない**こと。含めると、実際にはまだ送信していない段階で
ユーザーが「送られた」と誤認し、pending を破棄する既知の不具合を誘発する。

### 3. `data-progress-stage` 属性

`src/features/generation/components/generation-status-panel.tsx:302` と `:313` の
`data-progress-stage={String(progressStageIndex)}` を**維持する**。

`src/features/generation/components/generation-status-panel.test.tsx` の
`:576` / `:583` / `:608` / `:621` / `:636` がこの属性で段階遷移を検証している。

### 4. `data-phase` 属性

`.gen-status-panel` の `data-phase` は以下 8 種すべてを維持する。

`checking` / `submitting` / `processing` / `offline` / `constraint_conflict` /
`failed` / `request_conflict` / `succeeded`

### 5. ライブリージョン

各 phase の `<p role="status" aria-live="polite">` と、エラー系の `role="alert"` を維持する。
`.gen-status-indicator` の `aria-hidden="true"` も維持する。

### 6. 利用状況セクション

`<section aria-label="今日あと何回作れるか">`（`:56`）のアクセシブル名を変えない。

### 7. モーション

`.gen-status-indicator` に既存のアニメーションがある（`src/styles.css:2010` 付近と
`:2056` の reduced-motion）。**この 2 つはセットで維持する。**
新しい `animation` / `transition` を追加する場合は、`unexpectedMotionRules` に
引っかからないことを Step で必ず確認する。**グローバルな reduced-motion 単一ルールは
書けない**（Global Constraints 参照）。

---

## 意図（ここが実装者の裁量）

不安を埋める。「止まっているのか進んでいるのか分からない」を無くす。

- 5 段階の進行が**視覚的に**分かるようにする（現在は文言が差し替わるだけ）。
- 完成形の輪郭を `Skeleton` で先に見せ、「何が出てくるか」を予告する。
- 45 秒帯まで来たときに「もうすぐ」であることが伝わるようにする。
- 失敗系（`failed` / `offline` / `request_conflict`）は、不安を煽らず次の行動を示す。

---

## Task 2.1: 読み込み中表示を Skeleton に置き換える

**Files:**
- Modify: `src/features/generation/pages/menu-result-page.tsx:68-77`

**Interfaces:**
- Consumes: `Skeleton` from `@/shared/ui/feedback`

現在の実装（`menu-result-page.tsx`）:

```tsx
  if (query.isPending)
    return (
      <main className="page-frame">
        <div className="gen-status-panel" data-phase="loading">
          <div className="gen-status-indicator" aria-hidden="true" />
          <p role="status" aria-live="polite">
            献立を読み込んでいます
          </p>
        </div>
      </main>
    );
```

- [ ] **Step 1: 既存テストの現状を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/generation
```

期待: PASS。控えておく。

- [ ] **Step 2: `Skeleton` に置き換える**

```tsx
  // 読み込み中も main ランドマークを維持する（axe region / ルート a11y 契約）。
  if (query.isPending)
    return (
      <main className="page-frame">
        <Skeleton lines={3} label="献立を読み込んでいます" />
      </main>
    );
```

`import { Skeleton } from "@/shared/ui/feedback";` を追加する。

**維持すること:** `main` ランドマーク（axe region 契約）、`role="status"` /
`aria-live="polite"`（`Skeleton` が内部で持つ）、文言「献立を読み込んでいます」。

- [ ] **Step 3: テストを実行して緑を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/generation
docker compose run --rm --no-deps app npx vitest run src/app/accessibility.test.tsx
```

期待: PASS。

- [ ] **Step 4: コミット**

```bash
git add src/features/generation/pages/menu-result-page.tsx
git commit -m "refactor: 献立読み込み中の表示を Skeleton に置き換える"
```

---

## Task 2.2: 進行の視覚化を追加する

**Files:**
- Modify: `src/features/generation/components/generation-status-panel.tsx`
- Modify: `src/styles.css`
- Test: `src/features/generation/components/generation-status-panel.test.tsx`（**追加のみ**）

- [ ] **Step 1: 失敗するテストを書く**

`generation-status-panel.test.tsx` に**追記**する。既存テストは触らない。
既存テストの `data-progress-stage` の検証方法（`:576` 付近）を読んでから書くこと。

```tsx
it("exposes the total stage count so progress can be rendered", () => {
  // 段階の総数は GENERATION_PROGRESS_STAGES の length（5）と一致し続ける必要がある。
  // 表示側が独自の定数を持つと段階表の変更に追随できなくなる。
  expect(GENERATION_PROGRESS_STAGES).toHaveLength(5);
});

it("renders a progress meter reflecting the current stage while submitting", () => {
  // 実装に合わせて描画方法を選んでよいが、進行が視覚的に読めることを固定する。
  renderPanelInSubmittingState({ elapsedMs: 8_000 });
  const meter = screen.getByRole("progressbar", { name: "献立作成の進み具合" });
  expect(meter).toHaveAttribute("aria-valuenow", "3");
  expect(meter).toHaveAttribute("aria-valuemin", "1");
  expect(meter).toHaveAttribute("aria-valuemax", "5");
});
```

`renderPanelInSubmittingState` は既存テストのヘルパを流用するか、既存テストが
どう `submitting` 状態を作っているかを読んで同じ方法で書くこと。
`GENERATION_PROGRESS_STAGES` は `@/features/generation/model/progress-stages` から import する。

**`aria-valuenow` を 1 始まりにする理由:** `data-progress-stage` は 0 始まりの index で
既存テストが依存しているため、そちらは変えない。人間に見せる進捗は 1/5〜5/5 が自然なので
`progressStageIndex + 1` を使う。**両者を混同しないこと。**

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/generation/components/generation-status-panel.test.tsx
```

期待: 新しい 2 件のうち progressbar のテストが FAIL。既存テストはすべて PASS のまま。

- [ ] **Step 3: 実装する**

`submitting` と `processing` の両 phase に progressbar を追加する。
**`data-progress-stage` を持つ `<p>` は現状のまま残す。**

```tsx
        <div
          className="gen-progress-meter"
          role="progressbar"
          aria-label="献立作成の進み具合"
          aria-valuenow={progressStageIndex + 1}
          aria-valuemin={1}
          aria-valuemax={GENERATION_PROGRESS_STAGES.length}
        >
          {GENERATION_PROGRESS_STAGES.map((stage, index) => (
            <span
              key={stage.afterMs}
              className={
                index <= progressStageIndex ? "gen-progress-step is-done" : "gen-progress-step"
              }
            />
          ))}
        </div>
```

CSS（`src/styles.css` 末尾）。**`animation` / `transition` を書かない**（`unexpectedMotionRules`）。

```css
/*
 * 生成の進み具合（2026-08-08 UI/UX モダン化）。
 * animation / transition は書かない。unexpectedMotionRules が
 * .wizard-transition 以外の動きを不正とするため。
 */
.gen-progress-meter {
  display: flex;
  min-width: 0;
  gap: var(--space-2);
}

.gen-progress-step {
  height: 3px;
  flex: 1 1 0;
  border-radius: var(--radius-pill);
  background: var(--border);
}

.gen-progress-step.is-done {
  background: var(--primary);
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/generation/components/generation-status-panel.test.tsx
docker compose run --rm --no-deps app npx vitest run src/styles.contrast.test.ts
```

期待: 両方 PASS。**既存の `data-progress-stage` テスト 5 件が緑のままであることを
必ず確認すること。**

`styles.contrast.test.ts` が落ちた場合、`.gen-progress-*` が保護断片に引っかかっている
可能性がある（`.progress-` は保護断片だが `.gen-progress-` は部分文字列として
`.progress-` を**含まない**ので通るはず）。落ちたら理由を読んで allowlist に追記する。

- [ ] **Step 5: コミット**

実装とテストを分ける。

```bash
git add src/features/generation/components/generation-status-panel.tsx src/styles.css
git commit -m "feat: 献立生成の進み具合を視覚化する"
git add src/features/generation/components/generation-status-panel.test.tsx
git commit -m "test: 生成進捗メーターの契約を追加"
```

---

## Task 2.3: 待ち時間画面全体をエディトリアルに整える

**Files:**
- Modify: `src/features/generation/pages/generation-page.tsx`
- Modify: `src/features/generation/components/generation-status-panel.tsx`
- Modify: `src/styles.css`
- Modify: `eslint.config.js`

- [ ] **Step 1: 見た目を整える**

`PageHeader` / `Surface` / `Stack` / `Button` / `Skeleton` を使って組み直す。
**具体は実装者の裁量。** 不変契約（上記 1〜7）をすべて守ること。

失敗系（`failed` / `offline` / `request_conflict` / `constraint_conflict`）は
`Surface tone="notice"` を使い、次の行動のボタンを明確にする。

- [ ] **Step 2: ESLint の例外リストから generation を外す**

`eslint.config.js` の `ignores` から `"src/features/generation/**"` を削除する。

```bash
docker compose run --rm --no-deps app npm run lint > /tmp/lint.log 2>&1
grep -nE 'error|problem' /tmp/lint.log || tail -n 30 /tmp/lint.log
```

期待: エラーなし。

- [ ] **Step 3: 検証**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/generation
docker compose run --rm --no-deps app npx vitest run src/app/accessibility.test.tsx
docker compose run --rm --no-deps app npx vitest run src/styles.contrast.test.ts src/styles.theme.test.ts
docker compose run --rm --no-deps app npm run typecheck
```

期待: すべて PASS。

- [ ] **Step 4: e2e を実行する**

```bash
./scripts/run-e2e.sh > /tmp/e2e.log 2>&1
grep -nE 'passed|failed|✘' /tmp/e2e.log | tail -n 30
```

期待: 全 spec PASS。特に `generation-recovery-results.spec.ts` と `full-journey.spec.ts`。
落ちたら e2e ではなく実装を直す。Phase 2 は e2e の改訂を認めない。

- [ ] **Step 5: コミット**

```bash
git add src/features/generation src/styles.css eslint.config.js
git commit -m "refactor: 生成待ち画面をエディトリアル方向に整える"
```

---

## Phase 2 完了チェック

- [ ] `README.md` の検証フロー 9 ステップをすべて実行し、すべてパスした
- [ ] 変更禁止テスト 4 本の既存アサーションを 1 つも変更していない
- [ ] `GENERATION_PROGRESS_STAGES` の段階数・`afterMs`・5 文言を変えていない
- [ ] `data-progress-stage` と `data-phase` 8 種をすべて維持している
- [ ] 進捗文言に「AI」「送信」「通信」「モデル」「サーバ」を含めていない
- [ ] 新しい `animation` / `transition` を追加していない（または追加して contrast テストが緑）
- [ ] `eslint.config.js` の `ignores` から `src/features/generation/**` が消えた状態で lint が緑
- [ ] 生成中・成功・失敗・オフラインの各画面のスクリーンショットを 320 / 375 / 768 px で提出した

**次:** `phase-3-menu-detail.md`
