# こんだて日和 UI/UX モダン化 実装計画

> **実装エージェントへ:** このファイルを最初に読むこと。Phase は `phase-0` から順に実行し、
> **前の Phase が完了・承認されるまで次の Phase に着手しない**。各 Phase ファイルの
> チェックボックス（`- [ ]`）を進捗管理に使う。

**Goal:** 機能を一切変えずに、こんだて日和の UI/UX を「温かいエディトリアル」方向へ
引き上げる。

**Architecture:** `src/shared/ui/` に共有プリミティブ層を新設し、以降の全画面改修は
そのプリミティブ経由でのみ行う。プリミティブ経由を ESLint ルールで機械的に強制する
ことで、「レイアウトは実装者の裁量」という自由度を安全に与える。画面は移行コストと
契約破壊リスクの低い順に 5 フェーズで移行し、導線を変える Phase 4 を最後に隔離して
フェーズ単位で revert 可能にする。

**Tech Stack:** React 19.2.7 / Vite 8 / Tailwind CSS 4（`@theme`）/ React Router 8
Data Mode / TanStack Query 5 / TypeScript strict / Vitest + Testing Library /
Playwright / Docker Compose

**設計書（契約の正本）:** `docs/superpowers/specs/2026-08-08-ui-modernization-design.md`
本計画と設計書が食い違う場合は**設計書が正**。食い違いを見つけたら実装を止めて報告すること。

---

## Global Constraints

設計書 §4 の固定契約。**全 Phase の全タスクに暗黙に適用される。** 違反は差し戻し事由。

### 環境・言語

- Node.js `>=24 <25` のみ。ESM。TypeScript `strict: true`。`any` および境界での
  未検査キャスト禁止。
- **すべてのユーザー向け文言は日本語。** コメントとコミットメッセージも日本語。
  識別子とテスト名は英語。
- モバイルファースト。**320 CSS px で横スクロールを発生させない。** タッチ対象は
  **44×44 CSS px 以上**。

### 変更禁止テスト（既存アサーションの書き換え・削除は差し戻し）

新規アサーションの**追加のみ**認める。

1. `src/styles.contrast.test.ts`
2. `src/styles.theme.test.ts`
3. `src/app/accessibility.test.tsx`
4. `e2e/specs/mobile-accessibility.spec.ts`

`src/styles.contrast.test.ts` は、過去に `bg-terracotta-700` が未定義で「白背景に白文字」
となり 11 箇所が操作不能になった実障害を受けて作られたガードである
（`src/styles.css:26-34`）。無力化してはならない。

### CSP: inline style 禁止

`scripts/csp-headers.mjs:12` の `style-src 'self'` に `unsafe-inline` は含まれない。

- **`style={{ … }}` 属性、`element.style.cssText`、CSS-in-JS の runtime injection を
  新規に書いてはならない。**
- 可変プロパティ（`Surface` の `tone`、`Stack` の `gap` 等）は**列挙済み固定クラスへの
  マップ**でのみ実装する。
- この違反は Vite dev / Vitest jsdom / Playwright では**すべて緑になり、本番デプロイで
  初めて表面化する**。テストが緑でも安心してはならない。
- このリポジトリは既に同じ判断を下している（`src/styles.css:721` の
  「inline style 禁止のため CSS へ移設」）。

### 新規 CSS クラスの命名

`src/styles.contrast.test.ts` の `protectedSelectorFragments` は**部分文字列一致**である。
以下 12 個の文字列を新規クラス名に**含めてはならない**。

```
.guided-planner-theme  .wizard-  .choice-card  .progress-  .inline-notice
.review-row  .primary-button  .secondary-button  .text-button  .field
.app-section  :root
```

`body|button|a|input|select|textarea` を要素トークンとして含むセレクタも保護対象になる。
やむを得ず含める場合は `allowedProtectedSelectors` に追記し、**追記理由を日本語コメントで
残す**。このリポジトリは同じ罠に過去 2 回落ちている
（`src/styles.contrast.test.ts:280-282`、`:286`）。

### 色は必ず `var(--…)`

`findUnscopedDesignColorLeaks` が、ブランド色の hex 直書きを allowlist 外セレクタで
検出して失格にする。新規 CSS はすべてカスタムプロパティ参照で書く。

寒色（Tailwind の `stone` / `slate` 等）は 2026-07-21 に意図的に排除された
（`src/styles.css:42-46`）。**再導入しない。**

### モーション

`unexpectedMotionRules` は `.wizard-transition` の以下 2 パターン**以外の**
`animation` / `transition` ルールをすべて不正とする（代表 DOM に `matches()` するもの）。

- `.wizard-transition { animation: wizard-enter 180ms ease-out }`
- `@media (prefers-reduced-motion: reduce) { .wizard-transition { animation: none } }`

したがって `*, *::before, *::after { animation: none !important }` のような
**グローバルな reduced-motion 単一ルールは書けない**。コンポーネント単位で
`animation: none` を宣言し、必要なら allowlist に追記する（既存例:
`src/styles.css:359` / `:794` / `:2056`）。

### 所有境界

- `src/features` はブラウザ専用。`netlify/functions` はサーバ専用。
- ブラウザから `@shared/safety/*` を import 禁止。`@shared/safety-pure/*` のみ可
  （`eslint.config.js` の `no-restricted-imports` が強制）。
- 生成ファイルの手編集禁止: `package-lock.json`、`infra/supabase/**`、
  `src/shared/types/database.generated.ts`。

### 禁止事項

- `git push`、PR 作成、本番／ステージングへのデプロイ。
- 破壊的 git 操作（`reset --hard`、`push --force`、`clean -f`、ブランチ削除）を
  人間の即時承認なしに行うこと。
- `--no-verify` によるフック回避、署名の迂回。
- 機能の追加・削除・変更。ダークモード対応、i18n 対応、フォントウェイト追加
  （設計書 §1 の非目的）。

---

## コマンドの実行方法

**すべての Node コマンドは Docker 経由で実行する。** ホストの環境に依存させない。

```bash
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npx vitest run <ファイル>
```

`--no-deps` が安全なのは上記のようなホスト非依存コマンド（純粋な単体テスト、typecheck、
lint、format:check）のみ。

`db:test` / `db:push` / `e2e` は `npm run` スクリプト自身が `docker compose` を呼ぶため、
`app` コンテナ内から実行できない（`app` に Docker socket が無い）。ホスト側で直接実行する。

```bash
./scripts/reset-local-db.sh
docker compose --profile test run --rm db-test
./scripts/run-e2e.sh
```

Supabase / oauth-mock / openrouter-mock を叩く Vitest spec は、先に
`docker compose up -d --wait` でスタックを起動し、`--no-deps` を**付けずに**実行する。

### 提出前の検証フロー（各 Phase の最後に必須）

`AGENTS.md` §8 に従い、以下を**それぞれ独立したコマンドとして**この順に実行する。
`&&` 等で連結しない。すべてパスすることを確認する。

1. `docker compose run --rm --no-deps app npm run format:check`
2. `docker compose run --rm --no-deps app npm run lint`
3. `docker compose run --rm --no-deps app npm run typecheck`
4. `docker compose run --rm --no-deps app npx vitest run`
5. `./scripts/reset-local-db.sh`
6. `docker compose --profile test run --rm db-test`
7. `./scripts/run-e2e.sh`
8. `docker compose run --rm --no-deps app npm run build`
9. `git diff --check`

いずれかが失敗したら、原因を特定・修正してから失敗したステップ以降を再実行する。

出力が数百行に及ぶ場合はファイルへリダイレクトし、要約と失敗行だけを読むこと。

```bash
docker compose run --rm --no-deps app npm run lint > /tmp/lint.log 2>&1
grep -nE 'error|FAIL' /tmp/lint.log || tail -n 60 /tmp/lint.log
```

---

## コミット規約

- **日本語の Conventional Commits。** 例: `feat: 共有 Button プリミティブを追加` /
  `fix: 冷蔵庫カードの期限色をトークン化` / `refactor: 冷蔵庫画面をプリミティブへ移行`
- **テストの変更は実装コミットとは別のコミットに分離する。**
  `src/**/*.test.tsx` は 67 ファイル・約 1,900 個の `getByRole` / `getByText` クエリを
  持ち、画面改修はその一部を必然的に割る。テストを実装に合わせて書き換えるのが最も
  安い経路であるため、**その diff は人間が個別にレビューする**。
- フェーズをまたぐ変更を 1 コミットに混ぜない（revert 単位を保つため）。

---

## 各 Phase 完了時の提出物

1. **スクリーンショット**: 幅 **320 / 375 / 768 px** で対象画面を撮影して提出する。
   視覚回帰テストはこのリポジトリに存在しない（`toHaveScreenshot` / `toMatchSnapshot`
   が 0 件）ため、**人間の目が「オシャレさ」の唯一のゲート**である。
   768 px を含めるのは、`src/styles.css` の `@media (min-width: 720px)` 配下
   （`:336` / `:429` / `:1465` / `:1524` / `:2099`）がどのテストからも検証されて
   いないため（`mobile-accessibility.spec.ts` の実測幅は `[320, 375, 430]`）。
2. **変更ファイル一覧。**
3. **テスト変更を分離したコミットの hash**（あれば）。
4. **上記検証フロー 9 ステップの結果**（各コマンドの pass/fail）。

提出後、本リポジトリの reviewer サブエージェントによる一次レビューと、別サブエージェント
による二次検証を通してから採用となる（`AGENTS.md` §9、`SubAgents.md` の三役分離）。

---

## Phase 一覧

| Phase | 内容 | 対象 | 導線変更 | e2e 改訂 |
| --- | --- | --- | --- | --- |
| [0](./phase-0-design-system.md) | デザインシステム ＋ 冷蔵庫画面の垂直スライス | `src/styles.css`, `src/shared/ui/*`, `eslint.config.js`, `src/features/pantry/*` | なし | 不可 |
| [1](./phase-1-wizard.md) | ウィザード（献立条件入力） | `src/features/planner/components/*`, `src/shared/ui/wizard/*` | なし | 不可 |
| [2](./phase-2-generation-wait.md) | 待ち時間体験 | `src/features/generation/components/*` | なし | 不可 |
| [3](./phase-3-menu-detail.md) | 結果・詳細の見せ方 | `src/features/menu-detail/*` | なし | 不可 |
| [4](./phase-4-home.md) | ホーム（献立タブ）の役割 | `src/features/planner/planner-route.tsx`, `src/app/layouts/app-shell.tsx` | **あり** | **可**（別コミット） |

**Phase 0 は必ず最初に完了させること。** Phase 0 が提供するプリミティブと ESLint ルールが
無い状態で Phase 1 以降に着手すると、差分が 60 ファイルに散って検証不能になる。

## 完了条件

- Phase 0〜4 がすべて検証フロー 9 ステップを通過している。
- Phase 0 で導入する ESLint ルールの例外リストに、**フェーズ移行対象ディレクトリ**
  （`pantry` / `planner` / `generation` / `menu-detail` / `history`）が 1 つも
  残っていない。`billing` / `household` / `shopping` などフェーズ対象外の
  ディレクトリは恒久除外として残す。
- 全 Phase のスクリーンショットについて人間の承認が得られている。
