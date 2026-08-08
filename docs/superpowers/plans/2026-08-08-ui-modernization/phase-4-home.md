# Phase 4: ホーム（献立タブ）の役割

> **前提:** `README.md` の Global Constraints をすべて読んでいること。
> **Phase 0・1・2・3 がすべて完了・承認されていること。例外なし。**

**このフェーズのゴール:** `/planner` を「ウィザードの入口」から「今日何を作るかに即答する
ホーム」に変える。

**このフェーズだけが特別な理由:** 本プロジェクトで**唯一導線を変えるフェーズ**であり、
**唯一 e2e の改訂を認めるフェーズ**である。だからこそ最後に隔離してある。問題が起きた
場合の切り戻し先は Phase 3 完了時点になる。

---

## File Structure

`planner-route.tsx` は 1,313 行ある。ホーム化にあたり分割する。

| ファイル | 責務 |
| --- | --- |
| `src/features/planner/planner-route.tsx`（変更・縮小） | ルート。セッション・下書き・遷移の判断に専念 |
| `src/features/planner/home/planner-home.tsx`（新規） | ホーム表示の組み立て |
| `src/features/planner/home/home-generate-card.tsx`（新規） | 生成導線 |
| `src/features/planner/home/home-recent-menus.tsx`（新規） | 直近の献立 |
| `src/features/planner/home/home-expiring-pantry.tsx`（新規） | 期限が近い食材 |
| 上記各ファイルの `.test.tsx`（新規） | 各パーツのテスト |
| `src/app/layouts/app-shell.tsx`（変更） | 見た目のみ。**ナビ構成は変えない** |
| `src/styles.css`（変更） | 見た目 |

**新規パーツは表示専用**にする。データ取得は `planner-route.tsx` 側に残す。

---

## 不変契約（変更したら差し戻し）

### 1. ルーティング

- **URL を 1 つも変えない。** `/planner` `/generation` `/menus/:menuId` `/pantry`
  `/history` `/shopping` `/settings` `/emergency-menus` `/plus` `/welcome`
  `/onboarding` `/privacy` `/login` `/auth/callback` `/`
- `src/app/router.tsx` の階層（`RequireSession` の下に `AppShell`）を変えない。
- lazy chunk の `withTimeout(…, COLD_START_SESSION_DEADLINE_MS)` を外さない。
- `errorElement` の配置を変えない。

### 2. 下タブ

`src/app/layouts/app-shell.tsx` の `items` 配列が**ラベル文字列の正本**である
（同ファイル `:29` の注記「e2e のナビラベル文字列は items 側を正とする」）。

- **タブの本数（5 本）を変えない。**
- **ラベル文字列を変えない**: `献立` / `冷蔵庫` / `履歴` / `買い物` / `設定`
- 各タブの遷移先を変えない。
- アイコンはラベルと併用する装飾（同ファイルの注記「仕様が禁じるのはアイコン単独の
  主要操作」）。**アイコンだけのタブにしない。**

### 3. 保護境界

- `RequireSession` の適用範囲を変えない。
- オンボーディング未完了時の `/onboarding` への誘導、プライバシー未同意時の
  `/privacy` ゲートを変えない。
- `sectionForPath` のパス → section 対応を変えない（配色切替が壊れる）。

### 4. 下書きと pending

- `save_generation_draft` RPC の autosave タイミングを変えない。
- `pending-generation` / `pending-generation-meta` の読み書きと復帰処理を変えない。
  生成中にホームへ戻ったときの復帰導線が壊れる。
- `useUsageToday`（本日の残り回数）の取得と表示条件を変えない。

### 5. 44×44 とボタン件数

`e2e/specs/mobile-accessibility.spec.ts` の `assertMajorActionHeights` は
**ボタン名ごとに期待件数を `toHaveCount` で固定**している。ホームにボタンを増やすと、
そのボタン名が既存の期待に含まれていなくても**同名のボタンが増えれば件数が変わって
落ちる**。

同 spec は**変更禁止テスト**なので、**アサーションの追加のみ**認める。既存の期待件数を
書き換えてはならない。ホームに置くボタンの名前は、既存の期待に載っている名前と
**衝突しないもの**を選ぶこと。

---

## 意図（ここが実装者の裁量）

「今日何を作るか」に即答する入口にする。

- 開いた瞬間に主動線（献立を作る）が明確であること。
- 直近に作った献立に 1 タップで戻れること。
- 冷蔵庫に期限が近い食材があれば気づけること（Phase 0 の `Badge` を使う）。
- 生成が中断されている場合は、それが最優先で目に入ること。
- 情報を詰め込みすぎない。エディトリアルの余白を保つ。

**ウィザードそのものは Phase 1 で完成している。** ホームからウィザードへ入る導線を
設計するのであって、ウィザードを作り直すのではない。

---

## Task 4.1: ホームのパーツを作る

**Files:**
- Create: `src/features/planner/home/*.tsx` と各テスト

- [ ] **Step 1: 現状の緑を記録する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/planner > /tmp/before-p4.log 2>&1
tail -n 20 /tmp/before-p4.log
./scripts/run-e2e.sh > /tmp/e2e-before.log 2>&1
grep -nE 'passed|failed' /tmp/e2e-before.log | tail -n 5
```

テスト件数を控える。

- [ ] **Step 2: 表示専用パーツを作る**

`home-generate-card.tsx` / `home-recent-menus.tsx` / `home-expiring-pantry.tsx` を
props のみで動く表示コンポーネントとして作る。各ファイルにテストを添える。

各テストは最低限、そのパーツが描画するアクセシブル名と `role` を固定すること。例:

```tsx
it("renders the primary generation entry point", () => {
  render(<HomeGenerateCard remainingToday={2} onStart={vi.fn()} />);
  expect(screen.getByRole("button", { name: "献立を作る" })).toBeInTheDocument();
});

it("shows the remaining count for today", () => {
  render(<HomeGenerateCard remainingToday={2} onStart={vi.fn()} />);
  expect(screen.getByText(/あと2回/u)).toBeInTheDocument();
});
```

**ボタン名は既存 e2e の期待と衝突しないものを選ぶこと。** 選ぶ前に確認する:

```bash
grep -rhoE 'name: "[^"]+"' e2e/specs | sort -u
```

- [ ] **Step 3: パーツ単体のテストを実行する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/planner/home
```

期待: PASS。

- [ ] **Step 4: コミット**

```bash
git add src/features/planner/home
git commit -m "feat: 献立ホームの表示パーツを追加"
```

---

## Task 4.2: ホームを組み立てて導線を切り替える

**Files:**
- Modify: `src/features/planner/planner-route.tsx`
- Create: `src/features/planner/home/planner-home.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: ホームを組み立てる**

`planner-route.tsx` の表示部を `planner-home.tsx` に委譲する。データ取得・下書き復帰・
pending 復帰・プライバシーゲートの判断は `planner-route.tsx` に残す。

**不変契約 4 を必ず守ること。** 下書きと pending の扱いを変えると、生成中の離脱からの
復帰が壊れる。この壊れ方はテストで検出しにくく、実機でしか気づけない。

- [ ] **Step 2: 単体テストを実行する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/planner
```

期待: PASS。落ちたテストがある場合、**まず実装が契約を破っていないかを疑う。**
テストの期待が本当に古くなったと判断できる場合のみ、Step 5 でテストを直す。

- [ ] **Step 3: 型チェックと lint**

```bash
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint > /tmp/lint.log 2>&1
grep -nE 'error|problem' /tmp/lint.log || tail -n 30 /tmp/lint.log
```

期待: 両方エラーなし。`src/features/planner/**` は Phase 1 で既に例外リストから
外れているため、生ユーティリティを書けばここで落ちる。

- [ ] **Step 4: 実装をコミットする**

```bash
git add src/features/planner src/styles.css
git commit -m "feat: 献立タブを今日の献立ホームにする"
```

- [ ] **Step 5: 割れたテストを別コミットで直す**

**これが本プロジェクトで唯一テストの改訂を認める箇所である。**

```bash
docker compose run --rm --no-deps app npx vitest run > /tmp/all.log 2>&1
grep -nE 'FAIL|✘' /tmp/all.log | head -n 40
```

落ちたテストを直す。ただし:

- `src/styles.contrast.test.ts` / `src/styles.theme.test.ts` /
  `src/app/accessibility.test.tsx` は**変更禁止**。これらが落ちたら実装を直す。
- 直したテストは**実装とは別のコミット**にする。
- **1 つ 1 つのテスト変更について、なぜその期待が古くなったのかをコミットメッセージ
  本文に書く。** 「実装に合わせた」は理由ではない。

```bash
git add <直したテストファイル>
git commit -m "$(cat <<'EOF'
test: 献立ホーム化に伴う期待を更新

/planner の初期表示がウィザード第1ステップからホームに変わったため、
ウィザード表示を前提にしていた期待をホーム表示に合わせた。
ウィザードの各ステップ自体の期待は変更していない。
EOF
)"
```

---

## Task 4.3: e2e を通す

**Files:**
- Modify: `e2e/specs/*.spec.ts`（`mobile-accessibility.spec.ts` を**除く**）
- Modify: `e2e/fixtures/*`

- [ ] **Step 1: e2e を実行して落ちた spec を特定する**

```bash
./scripts/run-e2e.sh > /tmp/e2e.log 2>&1
grep -nE 'failed|✘' /tmp/e2e.log | head -n 40
```

- [ ] **Step 2: 落ちた原因を分類する**

各失敗について、次のどちらかを判定する。

- **(a) 導線が変わったことによる正当な失敗**: `/planner` を開いた直後の画面が
  ウィザードからホームに変わったため、fixture がウィザードに直行できなくなった等。
  → e2e / fixture を直してよい。
- **(b) 契約が壊れた失敗**: ボタンの 44px を割った、320px で横スクロールした、
  ラベルが変わった、遷移先が変わった、下書きが保存されなくなった等。
  → **実装を直す。e2e を書き換えてはならない。**

`e2e/specs/mobile-accessibility.spec.ts` が落ちた場合は**必ず (b)** である。
このファイルは変更禁止。

- [ ] **Step 3: (a) の失敗を直す**

fixture の入口を追加するのが望ましい。例えば `e2e/fixtures/history.ts` に
「ホームからウィザードを開く」ヘルパを足し、既存の spec がそれを呼ぶようにする。
**各 spec の本体アサーションは変えない。**

- [ ] **Step 4: e2e を再実行する**

```bash
./scripts/run-e2e.sh > /tmp/e2e.log 2>&1
grep -nE 'passed|failed|✘' /tmp/e2e.log | tail -n 30
```

期待: 全 spec PASS。

- [ ] **Step 5: e2e の変更を別コミットにする**

```bash
git add e2e
git commit -m "$(cat <<'EOF'
test: 献立ホーム化に伴う e2e の入口を更新

/planner の初期表示がホームになったため、ウィザードへ直行していた
fixture にホーム経由の導線を追加した。各 spec の本体アサーションと
mobile-accessibility.spec.ts は変更していない。
EOF
)"
```

- [ ] **Step 6: e2e の diff を提出する**

```bash
git show --stat HEAD
git diff HEAD~1 HEAD -- e2e
```

**この diff は人間が必ずレビューする。** 出力を提出物に含めること。

---

## Task 4.4: ESLint 例外リストを空にする

**Files:**
- Modify: `eslint.config.js`

- [ ] **Step 1: 残っている例外を確認する**

`eslint.config.js` の該当ブロックの `ignores` を見る。この時点で残っているべきは
「本プロジェクトのスコープ外」として恒久除外したディレクトリと `**/*.test.tsx` のみ。

- [ ] **Step 2: フェーズ移行済みディレクトリが 1 つも残っていないことを確認する**

以下が `ignores` に**含まれていないこと**を確認する。

- `src/features/pantry/**`（Phase 0 で移行）
- `src/features/planner/**`（Phase 1 で移行）
- `src/features/generation/**`（Phase 2 で移行）
- `src/features/menu-detail/**` / `src/features/history/**`（Phase 3 で移行）

- [ ] **Step 3: lint を実行する**

```bash
docker compose run --rm --no-deps app npm run lint > /tmp/lint.log 2>&1
grep -nE 'error|problem' /tmp/lint.log || tail -n 30 /tmp/lint.log
```

期待: エラーなし。

- [ ] **Step 4: コミット（変更があれば）**

```bash
git add eslint.config.js
git commit -m "chore: 移行済みディレクトリを ESLint 例外から外す"
```

---

## Phase 4 完了チェック

- [ ] `README.md` の検証フロー 9 ステップをすべて実行し、すべてパスした
- [ ] 変更禁止テスト 4 本の既存アサーションを 1 つも変更していない
- [ ] URL を 1 つも変えていない
- [ ] 下タブが 5 本、ラベルが `献立` / `冷蔵庫` / `履歴` / `買い物` / `設定` のまま
- [ ] `RequireSession` の保護範囲、オンボーディング・プライバシーゲートを変えていない
- [ ] 下書き autosave と pending 復帰の挙動を変えていない
- [ ] e2e の変更が実装とは別コミットになっており、その diff を提出した
- [ ] ESLint 例外リストにフェーズ移行済みディレクトリが 1 つも残っていない
- [ ] ホーム画面のスクリーンショットを 320 / 375 / 768 px で提出した
      （通常時・生成中断あり・期限切れ食材ありの 3 パターン）

---

## プロジェクト完了チェック

- [ ] Phase 0〜4 のすべてが完了チェックを満たしている
- [ ] `docker compose run --rm --no-deps app npm run lint` が緑（例外リストが最小）
- [ ] 全 Phase のスクリーンショットについて人間の承認が得られている
- [ ] 機能の追加・削除・変更が 1 件も無いことを確認した
