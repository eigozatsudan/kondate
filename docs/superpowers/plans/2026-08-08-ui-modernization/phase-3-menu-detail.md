# Phase 3: 結果・詳細の見せ方

> **前提:** `README.md` の Global Constraints をすべて読んでいること。
> **Phase 0・1・2 が完了・承認されていること。**

**このフェーズのゴール:** 生成された献立を「データの表示」から「読みたくなる 1 ページ」に
変える。本プロジェクトで「使いたい」への寄与が最も大きい。

**構造上の利点:** `/menus/:menuId`（生成直後）と `/history/:menuId`（履歴）の**双方**が
`src/features/menu-detail/household-menu-detail-body.tsx` と
`idea-menu-detail-body.tsx` に委譲し、`surface` prop で差分を吸収している。
**1 箇所の改修で両方に効く。**

---

## File Structure

`household-menu-detail-body.tsx` は 1,062 行ある。プリミティブ移行と同時に責務分割する。

| ファイル | 責務 |
| --- | --- |
| `src/features/menu-detail/household-menu-detail-body.tsx`（変更・縮小） | 状態管理と各パーツの組み立てに専念 |
| `src/features/menu-detail/menu-hero.tsx`（新規） | 献立名・種別・作成日時の見出し部 |
| `src/features/menu-detail/menu-dishes.tsx`（新規） | 品目一覧 |
| `src/features/menu-detail/menu-steps.tsx`（新規） | 段取り・手順 |
| `src/features/menu-detail/menu-safety-notice.tsx`（新規） | アレルギー・安全表示 |
| `src/features/menu-detail/menu-actions.tsx`（新規） | 採用・再生成・買い物リスト等の操作列 |
| 上記各ファイルの `.test.tsx`（新規） | 各パーツのテスト |
| `src/features/menu-detail/idea-menu-detail-body.tsx`（変更） | 同じパーツを使うよう整理 |
| `src/styles.css`（変更） | 見た目 |
| `eslint.config.js`（変更） | `src/features/menu-detail/**` と `src/features/history/**` を例外リストから外す |

**分割の原則:** 状態管理（`useQuery` / `useMutation` / ダイアログ開閉）は
`household-menu-detail-body.tsx` に残す。新規パーツは**表示専用（props を受け取って
描画するだけ）**にする。こうすると各パーツが独立してテストでき、状態のあるファイルが
1 つに保たれる。

---

## 不変契約（変更したら差し戻し）

### 1. 安全表示（最重要）

- **アレルギー・食品安全に関する表示は「安全」を保証する文言を作らない。**
  現行の文言を一字一句変更しない。
- 安全表示の**提示順を変えない**（他の情報より後ろに追いやらない）。
- 安全再検証の fail-closed 挙動（`household-menu-detail-body.tsx:202` / `:257` の注記）を
  一切変えない。シート・ダイアログの閉じ方も含む。

**この節に関わる変更が必要になったら、実装を止めて人間に相談すること。**

### 2. `role="status"` / `role="alert"` の使い分け

現在 `household-menu-detail-body.tsx` に `role="alert"` が 8 箇所、`role="status"` が
6 箇所ある（`:575` / `:593` / `:607` / `:623` / `:641` / `:694` / `:699` / `:710` /
`:886` / `:892` / `:898` / `:903` / `:909` / `:915`）。

**それぞれの role を変えない。** `alert` は割り込み、`status` は控えめな通知であり、
入れ替えると支援技術での体験が変わる。分割の際も各パーツに正しく引き継ぐこと。

### 3. `surface` prop による分岐

`generationMenuDetailSurface`（生成直後）と履歴側の surface で挙動が分かれる。
`preferenceGaps` は生成直後のみ表示される（`menu-result-page.tsx:33-35` の注記:
`/history` と 30 秒キャッシュを共有しないため query key 末尾に surface を付けている）。
**この分岐を変えない。**

### 4. 操作の導線

- 買い物リスト作成の intent（`useShoppingCreateIntent`）の呼び出しと解除を変えない。
- 採用・再生成の操作とその確認ダイアログを変えない。
- ボタンのアクセシブル名を変えない（`e2e/specs/history-regeneration.spec.ts` /
  `history-safety-change.spec.ts` / `shopping-list.spec.ts` が依存）。

### 5. axe

`src/app/accessibility.test.tsx` が `MenuResultPage` と `HistoryPageContent` に axe を
実行している。分割後も違反ゼロを保つ。

---

## 意図（ここが実装者の裁量）

料理雑誌の 1 ページ。

- 献立名を `PageHeader` の明朝ヒーローで大きく取る。
- 品目は箱の羅列ではなく、細い区切り線のリストとして組む。
- 段取りは「読み物」として、行間を広く取り番号を控えめに。
- 安全表示は目立たせるが、不安を煽らない（`Surface tone="notice"`）。
- 操作列は下部にまとめ、主操作を 1 つに絞る。

---

## Task 3.1: 表示専用パーツを切り出す

**Files:**
- Create: `src/features/menu-detail/menu-hero.tsx` ほか 4 ファイルとそのテスト
- Modify: `src/features/menu-detail/household-menu-detail-body.tsx`

**Interfaces:**
- Produces: 各パーツは props のみを受け取る純粋な表示コンポーネント。
  状態・副作用・`useQuery` / `useMutation` を持たない。

- [ ] **Step 1: 現状の緑を記録する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/menu-detail src/features/generation src/features/history > /tmp/before.log 2>&1
tail -n 20 /tmp/before.log
```

テスト件数と結果を控える。**分割後に同じ件数が同じ結果になることが目標。**

- [ ] **Step 2: パーツを 1 つずつ切り出す**

1 コミットにつき 1 パーツ。順序は `menu-hero` → `menu-safety-notice` →
`menu-dishes` → `menu-steps` → `menu-actions`。

各パーツについて:

1. `household-menu-detail-body.tsx` から該当 JSX を新ファイルへ移す
2. 必要な値を props にする（**状態は移さない**）
3. `role` 属性・アクセシブル名・要素の入れ子関係をそのまま保つ
4. 新ファイルの `.test.tsx` を書く。最低限、そのパーツが描画する
   アクセシブル名と `role` を固定するテストを入れる
5. `docker compose run --rm --no-deps app npx vitest run src/features/menu-detail` を実行
6. 緑ならコミット（例: `refactor: 献立詳細から見出し部を切り出す`）

**この段階では見た目を変えない。** 純粋な移動に留める。見た目は Task 3.2 で変える。
移動と見た目変更を混ぜると、テストが落ちたときに原因を切り分けられなくなる。

- [ ] **Step 3: 分割後の緑を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/menu-detail src/features/generation src/features/history > /tmp/after.log 2>&1
tail -n 20 /tmp/after.log
diff <(grep -oE '[0-9]+ (passed|failed)' /tmp/before.log) <(grep -oE '[0-9]+ (passed|failed)' /tmp/after.log)
```

期待: 差分なし（新規テストの分だけ passed が増えるのは可）。**failed が 1 件でも
増えていたら先に進まない。**

- [ ] **Step 4: axe と e2e を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/app/accessibility.test.tsx
./scripts/run-e2e.sh > /tmp/e2e.log 2>&1
grep -nE 'passed|failed|✘' /tmp/e2e.log | tail -n 30
```

期待: すべて PASS。

---

## Task 3.2: パーツをプリミティブで組み直す

**Files:**
- Modify: Task 3.1 で作った 5 パーツ
- Modify: `src/features/menu-detail/idea-menu-detail-body.tsx`
- Modify: `src/styles.css`
- Modify: `eslint.config.js`

- [ ] **Step 1: 各パーツをプリミティブで組み直す**

`PageHeader` / `Surface` / `Stack` / `Inset` / `Button` / `Badge` / `EmptyState` を使う。
**具体は実装者の裁量。** 不変契約（上記 1〜5）をすべて守ること。

`household-menu-detail-body.tsx` は Tailwind ユーティリティ直書きが多い
（`mt-4` / `mb-2` / `stack gap-2` 等）。これらを `Stack` / `Inset` に置き換える。

- [ ] **Step 2: ESLint の例外リストから menu-detail と history を外す**

`eslint.config.js` の `ignores` から `"src/features/menu-detail/**"` と
`"src/features/history/**"` を削除する。

```bash
docker compose run --rm --no-deps app npm run lint > /tmp/lint.log 2>&1
grep -nE 'error|problem' /tmp/lint.log || tail -n 30 /tmp/lint.log
```

期待: エラーなし。`src/features/history/**` にも生ユーティリティが残っていれば、
そちらもプリミティブに置き換える（履歴カードは menu-detail と同じ語彙で組む）。

- [ ] **Step 3: 検証**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/menu-detail src/features/generation src/features/history
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

期待: 全 spec PASS。特に `history-regeneration.spec.ts` / `history-safety-change.spec.ts` /
`shopping-list.spec.ts` / `full-journey.spec.ts`。

落ちたら e2e ではなく実装を直す。Phase 3 は e2e の改訂を認めない。

- [ ] **Step 5: コミット**

```bash
git add src/features/menu-detail src/features/history src/styles.css eslint.config.js
git commit -m "refactor: 献立詳細をエディトリアル方向に組み直す"
```

テストを変更した場合は別コミットに分ける。

---

## Phase 3 完了チェック

- [ ] `README.md` の検証フロー 9 ステップをすべて実行し、すべてパスした
- [ ] 変更禁止テスト 4 本の既存アサーションを 1 つも変更していない
- [ ] **安全・アレルギー表示の文言と提示順を変えていない**
- [ ] `role="alert"` / `role="status"` の使い分けを 1 箇所も入れ替えていない
- [ ] `surface` prop による生成直後／履歴の分岐を変えていない
- [ ] `household-menu-detail-body.tsx` が 1,062 行から有意に縮んでいる
- [ ] `eslint.config.js` の `ignores` から `menu-detail` と `history` が消えた状態で lint が緑
- [ ] 献立詳細（家庭向け／アイデア）と履歴詳細のスクリーンショットを 320 / 375 / 768 px で提出した

**次:** `phase-4-home.md`
