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
| `src/features/generation/components/menu-result.tsx`（変更・833 行） | 結果本体。sticky タブ列を持つ |
| `src/features/generation/components/idea-menu-safety-notice.tsx`（変更・135 行） | **アレルギー非保証文言** |
| `src/styles.css`（変更） | `.gen-status-panel` 系と `.menu-result-*` の見た目 |
| `eslint.config.js`（変更） | `src/features/generation/**` を例外リストから外す |

**後 2 者は当初の一覧から漏れていた。** ESLint 例外を `src/features/generation/**` 単位で
外す以上、必ず対象に入る。とくに `idea-menu-safety-notice.tsx` を「一覧に無いから」と
無警告で書き換えると、下記 §0 の安全条項に違反する。

`menu-result.tsx:460` の sticky タブ列（`sticky top-0 z-10 flex … overflow-x-auto`）と
`:516` の `grid-cols-[minmax(0,1fr)_minmax(0,45%)]` は `Surface` / `Stack` / `Inset` では
表現できない。**専用セマンティッククラス（`.menu-result-*`）へ退避してよい。**
新規クラス名なので保護セレクタ断片に該当せず、モーションも追加できる。

---

## 不変契約（変更したら差し戻し）

### 0. 安全・アレルギー表示（最重要）

`src/features/generation/components/idea-menu-safety-notice.tsx:6-7` は次を明記している。

> 表示確認の記録完了＝食べて安全、と誤認しないよう…設計は保証表現（「安全です」
> 「対応済み」等）を禁じる。平易化で保証寄りにしないこと。

- **同ファイルの文言（`:10`, `:17`, `:82`, `:116` ほか）を一字一句変更しない。**
- 提示順を変えない。他の情報より後ろに追いやらない。
- **「読みやすくする」「平易にする」という名目でも書き換えない。** 保証寄りに倒れる。
- レイアウトのみプリミティブへ移行してよい。

**この節に関わる変更が必要になったら、実装を止めて人間に相談すること。**

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

新規クラス（`.gen-progress-*` / `.menu-result-*` / `.ui-*`）へのモーションは
**追加してよい**。これらは代表 DOM に一致しないため `unexpectedMotionRules` の対象外。
ただし `@media (prefers-reduced-motion: reduce)` のペアを必ずセットで書くこと
（グローバルな `*` の一括リセットは書けないため）。

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

- [ ] **Step 3: テストを実行し、割れる 2 件を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/generation
docker compose run --rm --no-deps app npx vitest run src/app/accessibility.test.tsx
```

**期待: `menu-result-page.test.tsx:293` と `:381` が FAIL する。** この 2 件は
`document.querySelector(".gen-status-indicator")).not.toBeNull()` を検証しており、
`Skeleton` への置換でその要素が消えるため必ず落ちる。**これは想定内である。**

それ以外が落ちた場合は実装を疑うこと。特に `role="status"` /
`aria-live="polite"` / `main` ランドマークが失われていないか確認する。

同種のアサーションは `generation-status-panel.test.tsx:166` と
`history-detail-page.test.tsx:453` にもある。こちらは `.gen-status-indicator` を
残す限り緑のままなので、**この Task では触らないこと**。

- [ ] **Step 4: 実装をコミットする**

```bash
git add src/features/generation/pages/menu-result-page.tsx
git commit -m "refactor: 献立読み込み中の表示を Skeleton に置き換える"
```

- [ ] **Step 5: 割れたテストを別コミットで直す**

```bash
git add src/features/generation/pages/menu-result-page.test.tsx
git commit -m "$(cat <<'EOF'
test: 読み込み中表示の Skeleton 化に追随

.gen-status-indicator を持つローディング表示を Skeleton に置き換えたため、
その要素の存在を検証していた 2 件を、role="status" と文言の検証に改めた。
アクセシブル名（献立を読み込んでいます）は変更していない。
EOF
)"
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

**`renderPanelInSubmittingState` というヘルパは存在しない。** 既存テストの作法は
`generation-status-panel.test.tsx:573-583` にある通り、次の形である。

```tsx
render(<GenerationStatusPanel state={{ phase: "submitting", effect: "submit" }} />);
act(() => {
  vi.setSystemTime(new Date(startedAt.getTime() + 8_000));
  vi.advanceTimersByTime(1_000);
});
```

**着手前に `:560-640` を読み、そこで使われている fixture・タイマー操作・
`state` の組み立て方をそのまま踏襲すること。** 自前のヘルパを新設しない。

`GENERATION_PROGRESS_STAGES` は `@/features/generation/model/progress-stages` から import する。
`selectGenerationProgressStageIndex(8000)` は **2** を返すので `aria-valuenow` は **3** になる。

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

CSS（`src/styles.css` 末尾）。`.gen-*` は新規クラス名で代表 DOM に一致しないため、
**モーションを付けてよい**（実測で確認済み）。`prefers-reduced-motion` ペアは必須。

```css
/*
 * 生成の進み具合（2026-08-08 UI/UX モダン化）。
 * .gen-progress-* は代表 DOM に一致しないため unexpectedMotionRules の対象外。
 * グローバルな * の一括リセットは書けないので、reduced-motion はここで個別に書く。
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
  transition: background-color var(--motion-base) var(--motion-ease);
}

.gen-progress-step.is-done {
  background: var(--primary);
}

@media (prefers-reduced-motion: reduce) {
  .gen-progress-step {
    transition: none;
  }
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
- [ ] **`idea-menu-safety-notice.tsx` の文言を一字一句変更していない**（不変契約 0）
- [ ] `menu-result.tsx` の sticky タブ列とグリッドを `.menu-result-*` へ退避した
- [ ] 追加したモーションすべてに `prefers-reduced-motion` ペアを添えた
- [ ] `.gen-status-indicator` を消した箇所のテスト改訂を別コミットにした
- [ ] `eslint.config.js` の `ignores` から `src/features/generation/**` が消えた状態で lint が緑
- [ ] 生成中・成功・失敗・オフラインの各画面のスクリーンショットを 320 / 375 / 768 px で提出した

**次:** `phase-3-menu-detail.md`
