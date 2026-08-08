# こんだて日和 UI/UX モダン化 設計書

- 起案日: 2026-08-08
- 状態: 承認済み（実装未着手）
- 実装担当: 外部エージェント（Grok build）
- 実装計画: `docs/superpowers/plans/2026-08-08-ui-modernization/`

---

## 1. 目的と非目的

### 目的

現在の機能を一切変えずに、UI と UX を「モダンかつオシャレ」に引き上げる。現状の
UI は破綻していないが機能最低限で、「使いやすい」「使いたい」に届いていない。

### 非目的（このプロジェクトで扱わない）

明示的に対象外とする。実装エージェントはこれらに手を出してはならない。

- **機能の追加・削除・変更**。画面が何をできるかは現状のまま。
- **ダークモード**。`prefers-color-scheme` は現在 `src/` / `src/styles.css` に 0 件で、
  `src/styles.contrast.test.ts` は単一パレット前提（`:root` の全トークンを hex 固定）。
  導入は同テストの全面改修を伴うため別プロジェクトとする。
- **i18n**。文言の大半が TSX 直書きであり、抽出は導線再設計と無関係にコストが大きい。
- **フォントウェイトの追加**。§5.4 参照。
- **サーバ・DB・Netlify Functions・contracts の変更**。本プロジェクトは
  `src/` と `src/styles.css` に閉じる。

---

## 2. 診断：なぜ「機能最低限」に見えるのか

原因は配色でも書体でもない。**表現の単位（共有コンポーネント）が存在しない**ことである。

- 配色トークンは `:root`（`--primary` = テラコッタ `#b85033`、`--question-font` = 明朝、
  radius / space スケール）と Tailwind `@theme`（`--color-terracotta-*`、`--color-ink` 等）
  の双方に整備済み。資産としては足りている。
- しかし `src/shared/ui/` は `app-toast.tsx` と `wizard/`（`choice-card` /
  `inline-notice` / `progress-indicator` / `review-row` / `wizard-frame`）のみ。
- 結果、ウィザード以外の 60 枚超の TSX が `page-frame` / `card` / `stack` などの
  セマンティッククラスと生 Tailwind ユーティリティを直接組み合わせ、素の箱を並べている。

したがって**プリミティブ層を作らずにリスキンすると、差分が 60 ファイルに散り、外部
エージェントの成果物が検証不能になる**。プリミティブ層の新設が全フェーズの前提となる。

### 有利な事実

生 Tailwind ユーティリティ記法は 23 ファイルに偏在し、`history` / `billing` /
`menu-detail` / `generation` に**機能単位でクラスタしている**。移行はファイル横断では
なく機能単位で切れる。フェーズ分割（§6）はこの事実に沿っている。

### 誤診として棄却した仮説

「セマンティック CSS と Tailwind の二重系統は `.guided-planner-theme` に起因する」は誤り。
`src/styles.css:127-131` が明記する通り、`.guided-planner-theme` 自体はトークンを
持たない。配色は `:root` が唯一の正本で、`.guided-planner-theme .…` は**コンポーネント
規則のスコープ境界**である。トークンの二系統併存は 2026-07-21 に解消済み
（`src/styles.css:56-70` の経緯コメント）。**`.guided-planner-theme` の解体は行わない。**

---

## 3. ビジュアルの方向性：温かいエディトリアル

料理雑誌の紙面を基準にする。

- 大きな余白を情報の区切りとして使う。罫線と箱で区切らない。
- 見出しは既存資産の Zen Old Mincho（明朝）を主役に据え、意図的に大きく取る。
- 線は細く、彩度は低く。**影はほぼ使わない**（§5.3）。
- 色は「地はニュートラルで明るく、色はテラコッタ」という現行の役割分担を維持する。
  寒色（Tailwind の `stone` / `slate` 等）は 2026-07-21 に意図的に排除された経緯があり、
  再導入しない（`src/styles.css:42-46`）。

「オシャレさ」は自動検証できない。唯一のゲートは人間の目であり、§7.2 のスクリーン
ショット提出をもって代える。

---

## 4. 現状の固定契約（実装エージェントが壊してはならないもの）

本設計の受け入れ基準はすべてこの節に接地している。

### 4.1 変更禁止テスト

以下 4 本は**変更禁止**。既存アサーションの書き換え・削除は差し戻し事由。
新規アサーションの**追加のみ**認める。

| ファイル | 何を守っているか |
| --- | --- |
| `src/styles.contrast.test.ts` | トークン値の hex 固定、コントラスト比、保護セレクタ allowlist、モーション規則、生 hex 混入検出 |
| `src/styles.theme.test.ts` | Tailwind `@theme` とユーティリティの整合（白背景に白文字の再発防止） |
| `src/app/accessibility.test.tsx` | 10 画面超に対する axe 実行 |
| `e2e/specs/mobile-accessibility.spec.ts` | 320px 横スクロールなし、主要操作 44×44 CSS px、ボタン名ごとの件数固定 |

`src/styles.contrast.test.ts` は過去の実障害（`bg-terracotta-700` 未定義により
白背景に白文字となり操作不能）を受けて作られたガードである
（`src/styles.css:26-34`、`src/styles.theme.test.ts:5-10`）。無力化は許されない。

#### `mobile-accessibility.spec.ts` の唯一の例外（Phase 4 のみ）

Phase 4 は `/planner` の初期表示をウィザード step1 からホームに変える。同 spec は
ナビゲーションヘルパを**ファイル内に持つ**（`:54-124`）ため、これを一切変えられないと
Phase 4 は実行不能になる。

そこで **Phase 4 に限り**、次の 2 種類の変更のみを人間のレビュー付きで認める。

1. **アサーションを含まない `goto` 行の差し替え**（`:64` の `page.goto("/planner")`）
2. **既存アサーションの直前へのナビゲーション行の挿入**（`:110` の
   `expect(heading "1. 食事")` の前にホーム経由のホップを 1 行足す）

**認めないもの**: 既存 `expect` の書き換え・削除、`assertMajorActionHeights` の期待件数の
変更、44px / 320px アサーション本体への一切の変更。

構造上この切り分けが可能であることは検証済み（`:64` はアサーションを含まない純粋な
`goto`、`:110` は 1 行挿入で既存アサーションが 1 文字も変わらない）。

### 4.2 CSP：inline style 禁止

`scripts/csp-headers.mjs:12` の `CSP_STATIC_DIRECTIVES` は `style-src 'self'` であり、
`unsafe-inline` を含まない。

**帰結**: prop を値に変換するプリミティブ（`Surface(elevation)` / `Stack(gap)` 等）を
`style={{ … }}` や CSS-in-JS の runtime injection で実装してはならない。可変プロパティは
**列挙済みの固定クラスへのマップ**でのみ実装する。

この違反は Vite dev / Vitest jsdom / Playwright（`baseURL: http://127.0.0.1:5173`、
`_headers` は `dist` 配信時のみ有効）では**すべて緑になり**、本番デプロイで初めて
表面化する。既存コードで `style={{}}` を使うのは 3 箇所のみ
（`src/features/flyer/flyer-weekly-panel.tsx`、`src/app/root-error-boundary.tsx`、
`src/app/route-error-element.tsx`）であり、新規に増やさない。

### 4.3 保護セレクタの命名規則

`src/styles.contrast.test.ts` の `protectedSelectorFragments` は**部分文字列一致**で
判定する。現在の断片:

```
.guided-planner-theme  .wizard-  .choice-card  .progress-  .inline-notice
.review-row  .primary-button  .secondary-button  .text-button  .field
.app-section  :root
```

加えて `body|button|a|input|select|textarea` を要素トークンとして含むセレクタも
保護対象になる。

**帰結**: 新規 CSS クラス名にこれらの文字列を含めてはならない。含む場合は
`allowedProtectedSelectors` へ追記し、追記理由を日本語コメントで残す。
このリポジトリは同じ罠に過去 2 回落ちている（`src/styles.contrast.test.ts:280-282`、
`:286`）。

### 4.4 色は必ず `var(--…)`

`findUnscopedDesignColorLeaks` が、ブランド色 hex を直書きしたルールのうち allowlist
外のセレクタを失格にする。新規プリミティブの CSS は必ずカスタムプロパティ参照で書く。

### 4.5 モーション

制約の所在は「ウィザード配下かどうか」という**場所**ではなく、**セレクタの同一性**である。

`unexpectedMotionRules`（`src/styles.contrast.test.ts:915-953`）は、`animation` /
`transition` を持つルールのうち
`selector.includes("wizard-transition") || selectorMatchesRepresentative(selector)` に
該当するものだけを検査する。`representativeElements()`（`:955-975`）が構築する代表 DOM は
`.guided-planner-theme` を root とし、`.wizard-*` / `.choice-card` / `.progress-*` /
`.inline-notice*` / `.review-row*` / `.primary-button` と素の要素セレクタ
（`button` / `h1` / `p` / `div` / `header` / `footer` / `section` / `main` 等）のみを含む。

**帰結（実測で確認済み）:**

- **書けないもの**: `*, *::before, *::after` のようなグローバルセレクタ、素の要素セレクタ、
  および上記の既存クラスに対するモーション。`*` の reduced-motion 一括リセットを追加すると
  `unexpectedMotionRules` と `unexpectedRepresentativeOverrides` の 2 つが落ちる。
- **書けるもの**: `.ui-*` / `.gen-*` のような**新規クラス名**に対するモーション。
  `.ui-btn { transition }` / `.ui-skeleton__line { animation }` / `.gen-progress-step
  { transition }` と `@keyframes ui-shimmer`、およびそれぞれの
  `@media (prefers-reduced-motion: reduce)` ペアを追加した状態で全テストが緑になることを
  実測で確認している。`unexpectedKeyframesRules` は `wizard-enter` 以外の keyframes を見ない。

**したがって**: グローバル一括リセットが書けない以上、**新規プリミティブには
コンポーネント単位の `prefers-reduced-motion` ペアを必ずセットで書く**。既存の 3 箇所
（`src/styles.css:359` / `:794` / `:2056`）がそのパターンである。

### 4.6 `taskRuleDeclarations` — ウィザード CSS は宣言単位で凍結されている

`src/styles.contrast.test.ts:370-814` の `taskRuleDeclarations` は **66 セレクタ**を
キーに持ち、うち **65 件がウィザード／デザインシステム系**
（`.guided-planner-theme *` / `.wizard-*` / `.choice-card*` / `.progress-*` /
`.inline-notice*` / `.review-row*` / `.primary-button` / `.field*`）、残り 1 件が
`.app-section` である。

`hasExactDeclarations`（`:816-833`）は `declarations.size === canonicalExpected.size` を
要求するため、**宣言の追加も削除も落ちる**。

**重要**: `allowedProtectedSelectors` への追記では回復しない。`unexpectedProtectedSelectors`
は `:864` で `taskRuleDeclarations[selector]` を先に引き、存在すれば `hasExactDeclarations` を
要求する。実測では、既に allowlist に載っている `.wizard-title`（`:324`）に
`letter-spacing` を 1 行追加しただけで 3 テストが落ちた。回復には
`taskRuleDeclarations` 本体の書き換えが必要で、それは**変更禁止テストファイルの編集**にあたる。

**帰結**: これら 66 セレクタの見た目は**変えない**。見た目を変えたい場合は、
既存セレクタを触らず**新規 `.ui-*` セレクタ側で表現する**。これを既定方針とする。

### 4.7 テストのロケート方式

- e2e は `getByRole` / `getByText` に依存し、`getByTestId` は **0 件**。見出し文言・
  ボタン名の変更は直ちに e2e を割る。
- `src/**/*.test.tsx` は 67 ファイル、`getByRole|getByText|findByRole|findByText` が
  約 1,900 箇所。ブラスト半径の主体は e2e ではなくコンポーネントテストである。
- `e2e/specs/mobile-accessibility.spec.ts` の `assertMajorActionHeights` は**ボタン名
  ごとに期待件数を `toHaveCount` で固定**する。ボタンの追加・削除・改名が直撃する。
- 視覚回帰の仕組みは存在しない（`toHaveScreenshot` / `toMatchSnapshot` が 0 件）。

### 4.8 待ち時間の段階表

`src/features/generation/model/progress-stages.ts` の
`GENERATION_PROGRESS_STAGES` は 5 段（`afterMs` = 0 / 3,000 / 8,000 / 30,000 / 45,000）。
段階数・`afterMs`・`data-progress-stage` 属性は変更不可。

文言には安全上の制約がある（同ファイル `:13-15`）。経過時間のみに基づく体感段階で
あってサーバ工程と一致しないため、**8 秒帯で「AI に聞いている」と断定してはならない**。
断定するとユーザーが誤認して pending を破棄する既知の不具合を誘発する。

### 4.9 所有境界（CLAUDE.md より）

- `src/features` はブラウザ専用。`netlify/functions` はサーバ専用。
- ブラウザから `@shared/safety/*` を import してはならない。`@shared/safety-pure/*` のみ。
- 生成ファイル（`package-lock.json`、`infra/supabase/**`、
  `src/shared/types/database.generated.ts`）の手編集禁止。

---

## 5. デザインシステム（Phase 0 の設計）

### 5.1 トークン

**既存トークンは削除も改名もしない。** `src/styles.contrast.test.ts:1300-1345` が
`:root` の全トークン値を hex 単位で固定しているため、改名は即座に落ちる。
`expectEffectiveDeclarations` は部分集合検査なので、**追加のみなら通る**。

追加するもの:

| トークン | 用途 | 定義先 |
| --- | --- | --- |
| `--text-hero` | 明朝ヒーロー見出しのサイズ（`clamp()`） | `:root` |
| `--motion-fast` / `--motion-base` | 遷移時間 | `:root` |
| `--motion-ease` | イージング | `:root` |
| `--surface-sunken` | 沈んだ面の地色 | `:root` および `@theme` |

配置規則: **色は `:root` と `@theme` の両方**（`@theme` のみが Tailwind ユーティリティを
生成するため）、**寸法・時間は `:root` のみ**。両方に置く場合は値を手で一致させる
（`src/styles.css:30-31` の既存規約に従う）。

### 5.2 プリミティブ

`src/shared/ui/` 直下に 1 コンポーネント 1 ファイルで新設する。

| コンポーネント | 責務 |
| --- | --- |
| `Surface` | 面。`tone`（`plain` / `sunken` / `notice`）を prop で持つ。`card` の後継 |
| `Stack` | 縦方向の間隔。`gap` を prop で持つ |
| `Inset` | 内側余白 |
| `PageHeader` | 明朝ヒーロー見出し＋補足文 |
| `Button` | `variant`（`primary` / `secondary` / `ghost`）× `size`。44×44 px 下限を CSS で保証 |
| `Skeleton` | 読み込み中のプレースホルダ |
| `EmptyState` | 空状態 |
| `Badge` | ラベル |

制約:

- 可変 prop は**列挙済み固定クラスへのマップのみ**（§4.2）。
- 新規クラス名は §4.3 の断片を含まない。
- 色は `var(--…)` 参照のみ（§4.4）。パレット色を literal hex で書くと
  `findUnscopedDesignColorLeaks` が落ちる（実測で確認済み）。
- モーションはコンポーネント単位で `prefers-reduced-motion` ペアとセットで宣言（§4.5）。

#### 既存 DOM 契約を表現できる API にすること（必須）

プリミティブ API が既存画面の必須属性を落とすと、**型エラーにならないまま a11y が
静かに退行する**。次を必ず満たすこと。

- **`Button` は `ref` を受け取れること。** `ButtonHTMLAttributes` に `ref` は含まれず、
  `Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">` では `ref` を渡すと
  TS2322 になる（実測）。`Omit<ComponentPropsWithRef<"button">, "className">` を使う。
  React 19 では `forwardRef` は不要で、`ref` を rest に含めて spread すればよい。
  これが無いと `src/features/pantry/pantry-page.tsx:192-195` / `:231` のフォーカス復帰
  契約が実装不能になる。
- **`Stack` / `Inset` は `id` / `role` / `aria-label` / `aria-labelledby` を受け取り、
  rest を spread すること。** TypeScript はハイフンを含む JSX 属性名を余剰プロパティ
  検査から除外するため、`<Stack aria-label="…">` は**コンパイルを通り、実行時に黙って
  消える**。`pantry-page.tsx:294` の `<ul aria-label="冷蔵庫の食材">` がこれに該当する。
  本設計で最も検出しにくい退行経路であり、Phase 0 のテストで必ず固定する。
- **`EmptyState` は見出しの `id` を出せること**（`titleId`）。
  `pantry-page.tsx:286-287` の `<section aria-labelledby="pantry-empty-title">` を再現する。
- **`Surface` の `as` に `"form"` を含めること。** `pantry-form.tsx:127` の
  `<form className="card stack">` を表現するため。

### 5.3 影を導入しない

ビジュアル方向性が「影はほぼ使わない」であることに加え、
`src/styles.contrast.test.ts:1712` が `.choice-card` の `box-shadow` を
`"0 4px 16px rgb(66 58 50 / 8%)"` で**完全一致固定**し、`:1244` がその存在を正規表現で
要求している。エレベーショントークンを導入して適用すれば落ち、適用しなければ未使用に
なる。**`--shadow-*` は追加しない。** 階層は線と余白で表現する。

### 5.4 明朝は 700 のみ

`src/styles.css:22` は `@fontsource/zen-old-mincho/700.css` のみを読み込む。同 `:15-18`
が理由を明記する通り、`:root` は `font-synthesis: none` であり、実体のある重みを読む
必要がある。400 を指定すると合成もされず端末依存で Hiragino Mincho / Yu Mincho /
generic serif へフォールバックする（過去に実際に起きた障害）。

**帰結**: 明朝は 700 のみ。「線は細く」という印象は**字間・行間・サイズ・色（`--muted`）**
で作る。ウェイト追加はバンドル増（`vite.config.ts` の `assetsInlineLimit: 0` かつ
CSP `font-src 'self'` のため data: 不可）を伴うため、人間の承認なしに行わない。

### 5.5 プリミティブ経由を強制する ESLint ルール

**「レイアウトは裁量」を安全にする唯一の機構**である。Phase 0 の必須成果物とする。

`eslint.config.js` に、`src/features/**` の TSX における `className` 属性内の生 Tailwind
ユーティリティ直書きを禁止するルールを追加する。

**セレクタは子孫指定にすること。** `JSXAttribute[name.name='className'] > Literal` という
**直下**指定では、次がすべて素通りする（実測）。

| 記述 | 直下指定での検出 |
| --- | --- |
| `className="text-red-800"` | 検出する |
| `className={"bg-terracotta-700"}` | **素通り** |
| `` className={`stack ${on ? "bg-terracotta-700" : "p-4"}`} `` | **素通り** |
| `className={on ? "text-amber-800" : "gap-4"}` | **素通り** |

中括弧 1 組でルールを無効化できるということであり、これでは「裁量を安全にする唯一の
機構」として機能しない。`src/features` には既に非リテラル `className={` が 11 箇所ある。

したがって次の 2 本立てにする。

- `JSXAttribute[name.name='className'] Literal[value=/…/]`（子孫）
- `JSXAttribute[name.name='className'] TemplateElement[value.raw=/…/]`

禁止対象は**配色・余白・レイアウト**のユーティリティに限定する:

- 配色: `bg-*` / `text-<color>-*` / `border-<color>-*`、および本リポジトリ独自の
  `text-ink` / `text-ink-muted` / `text-white` / `text-canvas` / `text-line`
  （それぞれ 14 / 7 / 6 箇所実在し、`-<数値>` を持たないため素朴な正規表現から漏れる）
- 余白: `p*-*` / `m*-*` / `gap-*` / `space-*`
- レイアウト: `flex` / `flex-*` / `grid` / `grid-cols-*` / `items-*` / `justify-*` /
  `w-*` / `rounded-*` / `absolute` / `fixed` / `sticky`
  （`flex$` のような行末アンカーにすると `flex-col` / `flex-1` が漏れる）

禁止しないもの（プリミティブでは表現しきれず、既存契約が依存するため）:

- 寸法下限: `min-h-11` / `min-w-11`（44px 契約の実装であり、`Button` 内部でも使う）
- タイポグラフィ: `font-bold` / `type-small` 等のセマンティッククラス
- `src/app/**` と `src/shared/ui/**`（プリミティブ自身の実装箇所）

**ルール自体のテストを Phase 0 の成果物に含めること。** 上の表（検出する／素通りする
記述の一覧）を fixture として固定し、CI で回す。ルールが壊れたことを検出できないなら、
ルールがあることの保証にならない。

既存 23 ファイルはフェーズ移行が済むまで例外リストに載せ、各フェーズ完了時に
**そのフェーズの対象ファイルを例外リストから外す**。

**注意**: `src/features/pantry/` は現時点で違反ゼロである（`text-red-800` /
`text-amber-800` は `className` 属性ではなく `expiryNotice` の戻り値文字列にあり、
`className={notice.className}` 経由で適用される）。Phase 0 でこのルールが効くことを
確認する際に「pantry でエラーが出ること」を期待してはならない。

完了条件は「例外リストが空」ではなく、**フェーズ移行対象のディレクトリが 1 つも
例外リストに残っていないこと**である（§6 の Phase 0〜4 が対象とする `pantry` /
`planner` / `generation` / `menu-detail` / `history`）。`billing` / `household` /
`shopping` などフェーズ対象外のディレクトリは、将来の再発防止のため例外に残したまま
恒久除外とする。

### 5.6 旧セマンティッククラスの扱い

`page-frame` は `src/styles.css` に 5 ルール、TSX 28 ファイルで使用中。`card` / `stack` も
同様に広く使われている。

方針: **旧クラスは削除しない。** プリミティブが内部でこれらのクラスを出力する形で
包み込み、呼び出し側からの直接使用のみを段階的に無くす。理由は 2 つ。

1. `page-frame` / `card` / `stack` は §4.3 の保護セレクタ断片に該当しないため
   `styles.contrast.test.ts` の直接の対象ではないが、`.field` などと組み合わさる
   ルールが存在し、削除の影響範囲を静的に確定できない。
2. 削除を伴わなければ各フェーズが独立に revert 可能なままになる（§8）。

全フェーズ完了後に未参照となった CSS ルールの削除を検討するが、それは本プロジェクトの
スコープ外とする。

---

## 6. フェーズ構成

順序の根拠は「移行コストの低い順 × 契約破壊リスクの低い順」。**導線変更を最後に隔離**し、
フェーズ単位で revert 可能にする。

### Phase 0: デザインシステム ＋ 垂直スライス

プリミティブを作るだけで終えてはならない。ページに適用しないプリミティブはどのルートからも
到達不能な未使用コードであり、e2e も axe も contrast テストも通らない。「既存テストが緑」は
その場合トートロジーになり、リスクを Phase 1 に先送りするだけになる。

したがって Phase 0 は **`src/features/pantry/pantry-page.tsx`（388 行、最小）を
プリミティブへ完全移行し、その画面の e2e・axe・contrast を通す**ところまでを含む。

成果物: トークン追加、プリミティブ 8 種＋テスト、ESLint ルール、pantry 画面の移行。

### Phase 1: ウィザード（献立条件入力）

対象: `src/features/planner/components/{audience,meal,cuisine,ingredient,review}-step.tsx`

**`src/shared/ui/wizard/` は対象に含めない。** `WizardFrame` / `ChoiceCard` /
`ProgressIndicator` / `ReviewRow` は `src` 配下で**参照ゼロの死コード**である（実測。
`InlineNotice` のみ `household-onboarding-page.tsx` と
`idea-menu-safety-notice.tsx` の 2 箇所で使われている）。実際のウィザードは各 step が
自前でマークアップを持つ（例: `meal-step.tsx:118-137` が `.wizard-actions` と
`.secondary-button` を直書き）。

当初この「部品分割が済んでいる」ことを Phase 1 を先頭に置く根拠としていたが、事実誤認
だった。それでも Phase 1 を先頭に置くのは、step ファイル群が独立性が高く、Phase 4 の
ホーム化より波及が小さいためである。

**ただし §4.6 の制約により、ウィザードの既存 CSS セレクタ（`.wizard-*` /
`.choice-card` 等 65 件）は宣言単位で凍結されている。** 見た目の変更は既存セレクタでは
行えず、新規 `.ui-*` セレクタ側で表現する。Phase 1 の裁量はその範囲に限られる。

意図: 1 画面 1 問。余白で問いを立てる。明朝の設問を大きく、選択肢は線のみのカードに。

参照ゼロの `src/shared/ui/wizard/` 5 ファイルをどうするか（削除するか残すか）は、
Phase 1 の冒頭で人間に確認する。

### Phase 2: 待ち時間体験

対象: `src/features/generation/` 配下全体。ESLint 例外を外す以上、次も含まれる。

- `generation-status-panel.tsx`（本命）
- `pages/generation-page.tsx` / `pages/menu-result-page.tsx`
- **`components/menu-result.tsx`（833 行）**
- **`components/idea-menu-safety-notice.tsx`（135 行）**

後 2 者は当初の対象一覧から漏れていた。とくに `idea-menu-safety-notice.tsx` は
**アレルギー非保証文言のコンポーネント**であり、同ファイル `:6-7` が
「表示確認の記録完了＝食べて安全、と誤認しないよう…設計は保証表現（『安全です』
『対応済み』等）を禁じる。平易化で保証寄りにしないこと」と明記している。
**§6 Phase 3 の安全条項が Phase 2 にも同等に適用される。**

また `menu-result.tsx:460` の sticky タブ列（`sticky top-0 z-10 flex … overflow-x-auto`）や
`:516` の `grid-cols-[minmax(0,1fr)_minmax(0,45%)]` は `Surface` / `Stack` / `Inset` では
表現できない。これらは**専用セマンティッククラス（`.menu-result-*`）へ退避してよい**。

意図: 不安を埋める。段階の進行を視覚化し、`Skeleton` で結果の形を先に見せる。

### Phase 3: 結果・詳細の見せ方

対象: `src/features/menu-detail/*`

`/menus/:menuId` と `/history/:menuId` の双方が `household-menu-detail-body.tsx`
（1,062 行）と `idea-menu-detail-body.tsx` に委譲し、`surface` prop で差分を吸収して
いる。**1 箇所の改修で両方に効く**。

1,062 行という規模のため、プリミティブ移行と同時に責務分割（献立ヘッダ／品目／段取り／
安全表示／操作列）を行う。

意図: 料理雑誌の 1 ページ。献立名を明朝ヒーローに、段取りを読み物として組む。

### Phase 4: ホーム（献立タブ）の役割

対象: `src/features/planner/planner-route.tsx`（1,313 行）、`src/app/layouts/app-shell.tsx`

**唯一の導線変更フェーズであり、唯一 e2e の改訂を許すフェーズ。** 他のフェーズを
すべて終えてから着手する。

意図: 「今日何を作るか」に即答する入口。生成導線・直近の献立・冷蔵庫の期限を 1 画面に。

---

## 7. 受け入れ基準

### 7.1 全フェーズ共通

1. `AGENTS.md` §8 の検証フローを、**それぞれ独立したコマンドとして**この順に実行し
   すべてパスする（`&&` 等で連結しない）。
2. §4.1 の変更禁止テスト 4 本が**無改変**で緑。
3. §5.5 の ESLint ルールが緑（対象フェーズのファイルが例外リストから外れた状態で）。
4. 機能の追加・削除・変更がないこと。

### 7.2 スクリーンショット提出（視覚回帰の代替）

視覚回帰の仕組みが存在しないため、**人間の目が唯一のゲート**である。各フェーズ完了時に
幅 **320 / 375 / 768 px** で対象画面のスクリーンショットを提出する。
`AGENTS.md` §10 の「UI 変更にはスクリーンショットを添付」と整合する。

**生成手順**: `./scripts/run-e2e.sh` はスクリーンショットを出力しない。実装エージェントは
`e2e/` 配下に**恒久的でない撮影用スクリプト**を作り（`e2e/specs/` には置かない）、
`page.setViewportSize({ width, height })` と `page.screenshot({ path })` で 3 幅を撮る。
撮影スクリプトはコミットせず、生成された画像のみを提出物とする。

#### Phase 0 で参照ビジュアルを先に承認する

全 5 Phase を走らせてから「なんとなく違う」となる手戻りを避けるため、**Phase 0 の
成果物に「参照ビジュアル 1 枚」を含める**。プリミティブだけで組んだ静的な見本ページ
（冷蔵庫画面でよい）を 320 / 375 / 768 px で撮り、人間の承認を得てから Phase 1 に進む。

#### 「エディトリアル」を測定可能にする

「温かいエディトリアル」という語だけでは外部エージェントに再現性がない。各 Phase の
「意図」に、次の形式で**数値の目安を 2〜3 個**添える。

- 見出しと本文のサイズ比（例: 1 画面の主見出しは本文の 2 倍以上）
- 1 画面あたりの罫線・枠線の本数上限
- 面（`Surface`）の入れ子の深さ上限
- セクション間の最小余白（`--space-*` のどの段以上か）

数値は実装エージェントが提案し、Phase 0 の参照ビジュアル承認時に人間が確定させる。

768 px を含めるのは、`src/styles.css` の `@media (min-width: 720px)` 配下
（`:336` / `:429` / `:1465` / `:1524` / `:2099`）が現在どのテストからも検証されて
いないため。`e2e/specs/mobile-accessibility.spec.ts` の実測幅は `[320, 375, 430]` に留まる。

### 7.3 テスト変更の規律

`src/**/*.test.tsx` は 67 ファイル・約 1,900 クエリあり、導線再設計はその一部を必然的に
割る。外部エージェントにとって**テストを実装に合わせて書き換えるのが最も安い経路**である
ため、次を課す。

- テストの変更は**実装コミットとは別のコミット**に分離する。
- 別コミットの diff を人間がレビューして初めて採用とする。
- §4.1 の 4 本は対象外（そもそも変更禁止。Phase 4 の例外は §4.1 に記載）。

#### クラス名アサーションは全 Phase で必ず割れる

`toHaveClass("primary-button")` や `document.querySelector(".gen-status-indicator")` の
ような**実装クラス名に依存するアサーションが 68 箇所実在する**。主なもの:

| ファイル:行 | アサーション | 割れる Phase |
| --- | --- | --- |
| `menu-result-page.test.tsx:293, 381` | `.gen-status-indicator` not null | Phase 2（Skeleton 置換で要素が消える） |
| `menu-result-page.test.tsx:753, 789, 815` | `toHaveClass("primary-button")` | Phase 2 / 3 |
| `planner-wizard.test.tsx:284, 287, 288, 344, 810` | `toHaveClass("wizard-action", "primary-button")` | Phase 1 |
| `current-safety-summary.test.tsx:40` | `toHaveClass("secondary-button", "min-h-11")` | Phase 1 |
| `pantry-page.test.tsx:183, 184, 204, 308` | `toHaveClass("pantry-card-text" / "pantry-form-title")` | Phase 0 |
| `history-detail-page.test.tsx:453, 654` / `history-page.test.tsx:164` / `history-card.test.tsx:160` | 同種 | Phase 3 |

**したがって各 Phase の「既存テストが緑」という受け入れ基準は、そのままでは偽である。**
全 Phase について次を規律とする。

- **クラス名・CSS セレクタに依存するアサーションの改訂は認める。** 別コミット・
  コミット本文に「なぜその期待が古くなったか」を記載。
- **`role` / アクセシブル名に依存するアサーションの改訂は認めない。** これが落ちたら
  実装が契約を破っている。

### 7.4 レビュー体制

`SubAgents.md` の implementer / reviewer / verifier 三役分離を外部エージェント運用に
適用する。Grok build の成果物は、**本リポジトリの reviewer サブエージェントによる一次
レビューと、別サブエージェントによる二次検証を通してから採用**する（`AGENTS.md` §9）。

### 7.5 完了条件

- Phase 0〜4 がすべて §7.1 を満たす。
- §5.5 の ESLint 例外リストに、フェーズ移行対象ディレクトリ（`pantry` / `planner` /
  `generation` / `menu-detail` / `history`）が 1 つも残っていない。
- 全フェーズのスクリーンショットについて人間の承認が得られている。

---

## 8. ロールバック

各フェーズは以下のコミット粒度を守る。

1. 実装コミット（日本語 Conventional Commits）
2. テスト追随コミット（あれば。§7.3）

フェーズをまたぐ変更を 1 コミットに混ぜない。

**ただし単一フェーズだけの revert は現実的に成立しない。** 理由は 2 つ。

- `src/styles.css` は全フェーズが末尾に追記するため、Phase 3 だけを revert しようと
  すると Phase 4 の追記と隣接ハンクで衝突する。
- Phase 4 は実装と e2e が別コミットのため、実装だけを revert すると e2e が壊れたまま残る。

**したがって実務上の切り戻し単位は「Phase N 以降をすべて戻す」である。**
問題が Phase 3 で見つかったなら Phase 2 完了時点まで戻す。コミット粒度を守るのは、
この「N 以降を全部戻す」を確実に実行できるようにするためであって、単一フェーズの
抜き取りを可能にするためではない。

---

## 9. 実装計画へのリンク

`docs/superpowers/plans/2026-08-08-ui-modernization/README.md` を実装エージェントの
入口とする。各 Phase ファイルは「対象ファイル／意図／不変契約／受け入れ基準／提出物」の
固定フォーマットで書かれる。
