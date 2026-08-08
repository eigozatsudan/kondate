# Grok build 引き渡しプロンプト

> 以下の `---` で囲まれた本文をそのまま Grok build に渡す。

---

あなたは「こんだて日和」（React 19 / Vite 8 / Tailwind CSS 4 / TypeScript strict のモバイルファースト SPA）の UI/UX モダン化を実装するエージェントです。

## まず読むもの

1. `docs/superpowers/plans/2026-08-08-ui-modernization/README.md` — 実装計画の入口。全 Phase 共通の制約・コマンド・検証フロー・提出物。
2. `docs/superpowers/specs/2026-08-08-ui-modernization-design.md` — **契約の正本**。
3. `AGENTS.md` §8（検証フロー）/ §9（レビュー）/ §10（コミット規約）、`CLAUDE.md`。

計画と設計書が食い違ったら**設計書が正**。食い違いを見つけたら実装を止めて報告してください。

## ゴール

**機能を一切変えずに**、見た目と体験を「温かいエディトリアル」（料理雑誌の誌面。大きな余白、明朝の見出しをあえて大きく、細い罫線、影はほぼ使わない）方向へ引き上げる。

機能の追加・削除・変更、ダークモード対応、i18n、フォントウェイト追加は**非目的**です。やらないでください。

**ただし Phase 4 だけは例外です。** Phase 4 は `/planner` の役割を「ウィザードの入口」から「今日何を作るかに即答するホーム」へ変える、**本プロジェクトで唯一導線を変えるフェーズ**です（`phase-4-home.md` を参照）。「機能を一切変えない」は Phase 0〜3 に掛かる制約であり、Phase 4 の導線変更を禁じるものではありません。**Phase 4 で「これは機能変更にあたるので実施しない」と判断しないでください。** 逆に、Phase 4 で既存機能を削除・追加することは依然として禁止です。変えてよいのは導線（どの画面から何に到達するか）だけです。

## 実行順序

`phase-0` → `phase-1` → `phase-2` → `phase-3` → `phase-4` の順。**前の Phase が人間に承認されるまで次に着手しないこと。** 各 Phase ファイルのチェックボックスで進捗を管理してください。

Phase 0 が提供する共有プリミティブ（`src/shared/ui/`）と ESLint ルールが無い状態で Phase 1 以降に着手すると、差分が 60 ファイルに散って検証不能になります。

**人間の承認を待つブロッキングなゲートが 2 つあります。どちらも自分で判断して先に進まないでください。**

1. **Task 0.8** — 参照ビジュアルの人間承認。ここで承認を得てから Phase 1 に進みます。
2. **Task 1.0** — `src/shared/ui/wizard/` の参照ゼロ 4 ファイルを**削除するか残すか**を人間に確認します。`phase-1-wizard.md` に「判断が得られるまで Task 1.1 に着手しない」と明記されています。実態調査だけして自分で決めてよいタスクではありません。

## 各 Phase の進め方

Phase ファイル内の Task 単位で、TDD で進めます。

1. Task 本文を読む
2. RED: 失敗するテストを書く（各 Task に期待する PASS / FAIL が明記されています）
3. GREEN: 最小限の実装
4. **その Task が触ったファイルに絞って**検証（下記の 9 ステップは Phase 完了時のもの。Task 単位では次を回す）

   ```bash
   docker compose run --rm --no-deps app npm run format:check
   docker compose run --rm --no-deps app npx eslint <触ったファイル>
   docker compose run --rm --no-deps app npm run typecheck
   docker compose run --rm --no-deps app npx vitest run <その Task のテストファイル>
   ```

   e2e と db:test は Task 単位では回しません（Phase 完了時のみ）。**Phase の全 Task を積んでから初めて検証すると、どのコミットが壊したか特定できなくなります。**

5. 日本語 Conventional Commits でコミット

## 設計上の自由と、その代償

**レイアウト・余白・階層・タイポグラフィの具体は、あなたの裁量です。** デザイントークンと受け入れ基準だけが固定されています。「無難にまとめる」ことを求めていません。現状の UI は「機能最低限で、使いたいと思えない」というのが出発点の問題認識です。

ただしその自由は、以下の固定契約を一切破らないことと引き換えです。**契約に触れる必要が生じたら、回避策を発明せず、実装を止めて人間に相談してください。**

## 常に効いている基本制約（見落としやすい）

- **モバイルファースト。320 CSS px で横スクロールを発生させない。**
- **タッチ対象は 44×44 CSS px 以上。** `mobile-accessibility.spec.ts` がボタン名ごとに件数を固定して検査します。
- **すべてのユーザー向け文言は日本語。** コメントとコミットメッセージも日本語。識別子とテスト名は英語。
- **完了条件**: Phase 0 で導入する ESLint ルールの例外リストから、フェーズ移行対象ディレクトリ（`pantry` / `planner` / `generation` / `menu-detail` / `history`）が 1 つも残っていないこと（Task 4.4）。`billing` / `household` / `shopping` はフェーズ対象外なので恒久除外として残します。

## 絶対に踏んではいけない地雷（すべてこのリポジトリで実測済み）

### 1. inline style は本番でだけ壊れる

`scripts/csp-headers.mjs:12` の CSP が `style-src 'self'`（`unsafe-inline` なし）。

`style={{ … }}`、`element.style.cssText`、CSS-in-JS の runtime injection を**新規に書いてはいけません**。可変プロパティ（`Surface` の `tone`、`Stack` の `gap` 等）は**列挙済み固定クラスへのマップ**でのみ実装します。

この違反は Vite dev / Vitest jsdom / Playwright では**すべて緑になり、本番デプロイで初めて表面化します**。テストが緑でも安心しないでください。

### 2. 新規クラス名に含めてはいけない 12 個の文字列

`src/styles.contrast.test.ts` の `protectedSelectorFragments` は**部分文字列一致**です。

```
.guided-planner-theme  .wizard-  .choice-card  .progress-  .inline-notice
.review-row  .primary-button  .secondary-button  .text-button  .field
.app-section  :root
```

新規クラスは `.ui-*` / `.gen-*` 等の接頭辞で命名してください。

**加えて、要素トークンを含むセレクタも保護対象です。これは「素の要素セレクタ」だけの話ではありません。新規 `.ui-*` クラス配下の子孫要素セレクタも同じく落ちます。**

```js
/(?:^|[\s>+~,(])(?:body|button|a|input|select|textarea)(?=$|[\s>+~,.#:[\]()])/u
```

実測:

| セレクタ | 保護対象か |
| --- | --- |
| `.ui-prose a` | **はい（そのままでは書けない）** |
| `.ui-card button` | **はい** |
| `.ui-list > a` | **はい** |
| `.ui-card a:hover` | **はい** |
| `.ui-btn` / `.ui-badge` | いいえ |

本文中のリンクや操作要素を組むとき `.ui-prose a { … }` は最も自然な書き方ですが、ここで必ず落ちます。原因をクラス名断片だと誤診しやすい箇所です。回避策は (a) リンク側にもクラスを振る（`.ui-prose-link`）か、(b) `allowedProtectedSelectors` に理由コメント付きで追記するかのいずれかです。

### 3. 凍結ガードは 2 つある。混同しないでください

`src/styles.contrast.test.ts` には**性質の異なる凍結ガードが 2 つ**あります。これを 1 つと誤認すると、Phase 0 の最初のタスク（`:root` へのトークン追加）が禁止事項に見えて着手できなくなります。

| 定数 | 行 | キー数 | 検査 | 宣言の追加 |
| --- | --- | --- | --- | --- |
| `taskRuleDeclarations` | `:370-687` | **66** | `hasExactDeclarations` | **落ちる** |
| `globalRuleDeclarations` | `:689-814` | **17** | `hasRequiredDeclarations` | **通る（部分集合）** |

**`taskRuleDeclarations` の 66 セレクタは触らない。** 全件がウィザード／guided-planner 系です。宣言数の完全一致を要求するため、**宣言を 1 行足すだけで落ちます**。見た目を変えたい場合は新規 `.ui-*` セレクタ側で表現してください。

**`globalRuleDeclarations` の 17 セレクタ（`*` / `:root` / `html, body, #root` 等）は部分集合検査なので、宣言の追加は通ります。** Phase 0 の `:root` へのデザイントークン追加はこちらに該当し、禁止されていません。

**`allowedProtectedSelectors` は封じられていません。** 「追記では回復しない」のは `taskRuleDeclarations` にキーがあるセレクタの話です（実測: allowlist 済みの `.wizard-title` に `letter-spacing` を 1 行足して失敗）。**新規セレクタが下記 4 の保護断片や要素トークンに触れてしまった場合は、allowlist への追記が唯一かつ正規の回復手段**で、理由コメントを添えれば使ってかまいません。

### 4. モーションの制約は「場所」ではなく「セレクタの同一性」

**書けないもの:** `*, *::before, *::after` のグローバルセレクタ（`*` の reduced-motion 一括リセットは 2 テストを落とします）、素の要素セレクタ（`button { transition }`）、上記保護クラスへのモーション追加。

**書けるもの:** `.ui-*` / `.gen-*` などの新規クラスへのモーション。`.ui-btn { transition }` / `.ui-skeleton__line { animation }` / `.gen-progress-step { transition }` ＋ `@keyframes ui-shimmer` を投入した状態で全テスト緑を実測確認済みです。

**必須:** グローバル一括リセットが書けない以上、**新規プリミティブには `@media (prefers-reduced-motion: reduce)` のペアをコンポーネント単位で必ず書く**こと。

hover / focus のトランジション、Skeleton の shimmer、状態遷移の気配は**明確に許可されています**。「オシャレさ」への寄与が最も大きい要素なので、契約に触れない範囲で積極的に使ってください。

### 5. 色は必ず `var(--…)`

`findUnscopedDesignColorLeaks` がブランド色の hex 直書きを検出して失格にします。寒色（Tailwind の `stone` / `slate` 等）は 2026-07-21 に意図的に排除されました。**再導入しないこと。**

### 6. React 19 の型の罠（2 件、実測）

- `Button` の props は `ComponentPropsWithRef<"button">` ベースにすること。`ButtonHTMLAttributes` には `ref` が含まれず、`<Button ref={…}>` が **TS2322** になります（冷蔵庫画面のフォーカス復帰契約が実装不能になる）。
- **ハイフン付き JSX 属性（`aria-label` 等）は TypeScript の余剰プロパティ検査を素通りし、実行時に黙って消えます。** `Stack` / `Surface` 等のラッパーには明示的な `LandmarkProps` と rest spread を持たせ、テストで転送を検証してください。計画に型とテストの実体が書いてあります。

## 変更禁止テスト

新規アサーションの**追加のみ**認めます。書き換え・削除は差し戻し。

1. `src/styles.contrast.test.ts`
2. `src/styles.theme.test.ts`
3. `src/app/accessibility.test.tsx`
4. `e2e/specs/mobile-accessibility.spec.ts`（**Phase 4 に限り、計画に明記された 2 種の変更のみ**例外）

`src/styles.contrast.test.ts` は、過去に `bg-terracotta-700` が未定義で「白背景に白文字」となり 11 箇所が操作不能になった実障害を受けて作られたガードです。無力化しないでください。

## 割れることが分かっているテスト

`toHaveClass("primary-button")` のような**実装クラス名に依存するアサーションが多数実在**します（実測: `toHaveClass` 64、クラス指定の `querySelector` 22、`.className` 9、`classList` 1。重複行を排除して 97 行）。各 Phase の「期待: すべて PASS」はそのままでは偽になります。README には Phase ごとに割れる代表例の表がありますが、**全件の一覧ではありません**。

- **クラス名・CSS セレクタに依存するアサーションの改訂は認めます。** 別コミットにし、コミット本文に「なぜその期待が古くなったか」を書くこと。
- **ただし「改訂」であって「削除」ではありません。** 落ちたアサーションは、**同じ意図を新しい実装で表す等価なアサーションに置き換えて**ください。テストケースごと消す、`expect` を削るだけ、`it.skip` にする、といった**カバレッジを減らす変更は認めません**。置き換え後にアサーション件数が減る場合は、コミット本文に減った理由を書いてください。
- **`role` / アクセシブル名に依存するアサーションの改訂は認めません。** これが落ちたら実装が契約を破っています。テストではなく実装を直してください。

## コマンドはすべて Docker 経由

ホスト環境に依存させないため、すべての Node コマンドを Docker で実行します。

```bash
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npx vitest run <ファイル>
```

`db:test` / `e2e` は `app` コンテナから実行できません（Docker socket 無し）。ホスト側で直接：

```bash
./scripts/reset-local-db.sh
docker compose --profile test run --rm db-test
./scripts/run-e2e.sh
```

出力が数百行になる場合はファイルへリダイレクトし、要約と失敗行だけを読んでください。

## 各 Phase 完了時の検証フロー（9 ステップ、`&&` で連結しない）

1. `format:check` / 2. `lint` / 3. `typecheck` / 4. `npx vitest run` / 5. `./scripts/reset-local-db.sh` / 6. `db-test` / 7. `./scripts/run-e2e.sh` / 8. `npm run build` / 9. `git diff --check`

いずれかが失敗したら、原因を特定・修正してから失敗ステップ以降を再実行します。

## 各 Phase 完了時の提出物

1. **スクリーンショット（幅 320 / 375 / 768 px）。** `./scripts/run-e2e.sh` は成功時に画像を出力しません（`playwright.config.ts` の `screenshot: "only-on-failure"`）。撮影用の一時 Playwright スクリプトを作り（`e2e/specs/` には置かない。置くと本番 spec として実行される）、`page.setViewportSize` と `page.screenshot` で 3 幅を撮ってください。**撮影スクリプトはコミットしない。** 提出物は画像のみ。
   視覚回帰テストはこのリポジトリに存在しません（`toHaveScreenshot` / `toMatchSnapshot` が 0 件）。**人間の目が「オシャレさ」の唯一のゲート**です。768 px を含めるのは、`@media (min-width: 720px)` 配下がどのテストからも検証されていないためです。
2. 変更ファイル一覧
3. テスト変更を分離したコミットの hash（あれば）
4. 検証フロー 9 ステップの pass/fail

## コミット規約

日本語の Conventional Commits。例: `feat: 共有 Button プリミティブを追加` / `refactor: 冷蔵庫画面をプリミティブへ移行`

- **テストの変更は実装コミットとは別コミットに分離すること。**
- フェーズをまたぐ変更を 1 コミットに混ぜないこと（revert 単位を保つため）。

## 禁止事項

- `git push`、PR 作成、本番／ステージングへのデプロイ
- 破壊的 git 操作（`reset --hard`、`push --force`、`clean -f`、ブランチ削除）を人間の即時承認なしに行うこと
- `--no-verify` によるフック回避
- **ガードの無力化。** Phase 0 で導入する ESLint ルールを `// eslint-disable*` コメントで黙らせること、`eslint.config.js` の当該ルールを緩めること・除外ディレクトリを増やすこと（Task 4.4 で定められた除外の**削減**は除く）。ルールに引っかかったら、ルールではなく実装を直してください
- ブラウザコードからの `@shared/safety/*` の import（`@shared/safety-pure/*` のみ可）
- 生成ファイルの手編集（`package-lock.json`、`infra/supabase/**`、`src/shared/types/database.generated.ts`）
- **アレルギー／食品安全に関する文言を「安全です」「対応済み」などの保証表現に寄せること**（Phase 2 の `idea-menu-safety-notice.tsx` に関わります。平易化はしてよいが、保証表現は禁止）

## 詰まったら

回避策を発明せず、**実装を止めて人間に報告してください。** 特に以下は必ず相談：

- 変更禁止テストを書き換えないと進めないと判断したとき
- `taskRuleDeclarations` の 66 セレクタに触る必要が生じたとき
- 保護セレクタ断片を新規クラス名に含めざるを得ないとき
- 計画と設計書が食い違っているとき
- 計画が前提としているコードの実態が違っていたとき（Phase 1 の Task 1.0 がその一例です）

まず `README.md` と `phase-0-design-system.md` を読み、Task 0.1 から始めてください。
