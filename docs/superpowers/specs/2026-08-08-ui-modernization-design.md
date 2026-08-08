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

`unexpectedMotionRules` は、`animation` / `transition` を持つルールのうち代表 DOM に
`element.matches()` するものを、`.wizard-transition` の以下 2 パターン**以外すべて不正**とする。

- `.wizard-transition { animation: wizard-enter 180ms ease-out }`
- `@media (prefers-reduced-motion: reduce) { .wizard-transition { animation: none } }`

**帰結**: `*, *::before, *::after { animation: none !important }` のような**グローバルな
reduced-motion 単一ルールは書けない**（`*` は代表 DOM に一致し、保護セレクタ上の
`!important` も別途不正）。既存の 3 箇所（`src/styles.css:359` / `:794` / `:2056`）が
示す通り、**コンポーネント単位で `animation: none` を宣言し、必要なら allowlist に
追記する**パターンを踏襲する。

### 4.6 テストのロケート方式

- e2e は `getByRole` / `getByText` に依存し、`getByTestId` は **0 件**。見出し文言・
  ボタン名の変更は直ちに e2e を割る。
- `src/**/*.test.tsx` は 67 ファイル、`getByRole|getByText|findByRole|findByText` が
  約 1,900 箇所。ブラスト半径の主体は e2e ではなくコンポーネントテストである。
- `e2e/specs/mobile-accessibility.spec.ts` の `assertMajorActionHeights` は**ボタン名
  ごとに期待件数を `toHaveCount` で固定**する。ボタンの追加・削除・改名が直撃する。
- 視覚回帰の仕組みは存在しない（`toHaveScreenshot` / `toMatchSnapshot` が 0 件）。

### 4.7 待ち時間の段階表

`src/features/generation/model/progress-stages.ts` の
`GENERATION_PROGRESS_STAGES` は 5 段（`afterMs` = 0 / 3,000 / 8,000 / 30,000 / 45,000）。
段階数・`afterMs`・`data-progress-stage` 属性は変更不可。

文言には安全上の制約がある（同ファイル `:13-15`）。経過時間のみに基づく体感段階で
あってサーバ工程と一致しないため、**8 秒帯で「AI に聞いている」と断定してはならない**。
断定するとユーザーが誤認して pending を破棄する既知の不具合を誘発する。

### 4.8 所有境界（CLAUDE.md より）

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
| `Button` | `variant`（`primary` / `secondary` / `ghost`）× `size`。44×44 px 下限を型と CSS の双方で保証 |
| `Skeleton` | 読み込み中のプレースホルダ |
| `EmptyState` | 空状態 |
| `Badge` | ラベル |

制約:

- 可変 prop は**列挙済み固定クラスへのマップのみ**（§4.2）。
- 新規クラス名は §4.3 の断片を含まない。
- 色は `var(--…)` 参照のみ（§4.4）。
- モーションはコンポーネント単位で宣言（§4.5）。

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

禁止対象は**配色・余白・レイアウト**のユーティリティに限定する:

- 配色: `bg-*` / `text-<color>-*` / `border-<color>-*`
- 余白: `p*-*` / `m*-*` / `gap-*` / `space-*`
- レイアウト: `flex` / `grid` / `items-*` / `justify-*` / `grid-cols-*`

禁止しないもの（プリミティブでは表現しきれず、既存契約が依存するため）:

- 寸法下限: `min-h-11` / `min-w-11`（44px 契約の実装であり、`Button` 内部でも使う）
- タイポグラフィ: `font-bold` / `type-small` 等のセマンティッククラス
- `src/app/**` と `src/shared/ui/**`（プリミティブ自身の実装箇所）

既存 23 ファイルはフェーズ移行が済むまで例外リストに載せ、各フェーズ完了時に
**そのフェーズの対象ファイルを例外リストから外す**。例外リストが空になることが本
プロジェクトの完了条件のひとつ。

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

対象: `src/features/planner/components/*`、`src/shared/ui/wizard/*`

既に `wizard-frame` / `choice-card` / `progress-indicator` という部品分割が済んでおり、
プリミティブが最初に効く場所。移行コストが最も低い。

意図: 1 画面 1 問。余白で問いを立てる。明朝の設問を大きく、選択肢は線のみのカードに。

### Phase 2: 待ち時間体験

対象: `src/features/generation/components/generation-status-panel.tsx`

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

768 px を含めるのは、`src/styles.css` の `@media (min-width: 720px)` 配下
（`:336` / `:429` / `:1465` / `:1524` / `:2099`）が現在どのテストからも検証されて
いないため。`e2e/specs/mobile-accessibility.spec.ts` の実測幅は `[320, 375, 430]` に留まる。

### 7.3 テスト変更の規律

`src/**/*.test.tsx` は 67 ファイル・約 1,900 クエリあり、導線再設計はその一部を必然的に
割る。外部エージェントにとって**テストを実装に合わせて書き換えるのが最も安い経路**である
ため、次を課す。

- テストの変更は**実装コミットとは別のコミット**に分離する。
- 別コミットの diff を人間がレビューして初めて採用とする。
- §4.1 の 4 本は対象外（そもそも変更禁止）。

### 7.4 レビュー体制

`SubAgents.md` の implementer / reviewer / verifier 三役分離を外部エージェント運用に
適用する。Grok build の成果物は、**本リポジトリの reviewer サブエージェントによる一次
レビューと、別サブエージェントによる二次検証を通してから採用**する（`AGENTS.md` §9）。

### 7.5 完了条件

- Phase 0〜4 がすべて §7.1 を満たす。
- §5.5 の ESLint 例外リストが空になる。
- 全フェーズのスクリーンショットについて人間の承認が得られている。

---

## 8. ロールバック

フェーズ単位で revert 可能にする。各フェーズは以下のコミット粒度を守る。

1. 実装コミット（日本語 Conventional Commits）
2. テスト追随コミット（あれば。§7.3）

フェーズをまたぐ変更を 1 コミットに混ぜない。Phase 4 のみ導線を変えるため、問題が
起きた場合の切り戻し先は Phase 3 完了時点となる。

---

## 9. 実装計画へのリンク

`docs/superpowers/plans/2026-08-08-ui-modernization/README.md` を実装エージェントの
入口とする。各 Phase ファイルは「対象ファイル／意図／不変契約／受け入れ基準／提出物」の
固定フォーマットで書かれる。
