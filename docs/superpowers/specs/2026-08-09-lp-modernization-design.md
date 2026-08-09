# LP（未ログイン向け無料訴求ページ）モダン化 設計

- 日付: 2026-08-09
- 対象: `src/features/landing/free-landing-page.tsx` / `free-landing-page.css`
- ブランチ: `ui/lp-modernization`（`ui/modernization-phase-0` の `90cb8c1` から分岐）
- 前提設計: `docs/superpowers/specs/2026-08-08-ui-modernization-design.md`

## 1. 目的

未ログインの `/` に出る LP の見た目と構成を「温かいエディトリアル」方向へ引き上げる。
アプリ本体の UI モダン化（Phase 0〜4）と同じ語彙・同じ温度に揃え、初回訪問者が最初に
見る面だけが古いまま残る状態を解消する。

## 2. 非目的

- 訴求内容の変更。**文言（`FREE_LP_*` 定数の中身）は 1 文字も変えない。**
- URL、CTA の遷移先（`/login` のみ）、セクションの数と順序の変更。
- 新しい写真素材の追加・差し替え。現行の `assets/*.webp` 4 枚をそのまま使う。
- `root-gate-page.tsx` の変更（§7 に理由）。
- Plus・課金・API・entitlement への言及の追加。既存の禁止語テストが縛っている。

## 3. 対話で確定した決定

| 論点 | 決定 | 理由 |
| --- | --- | --- |
| 変更範囲 | 見た目 ＋ 構成。文言は据え置き | 訴求の再設計はマーケ判断が要るため今回は切り離す |
| デザインシステム | **トークンのみ共有。** `Surface` / `Stack` / `Inset` は使わない | LP は「アプリの画面」ではなく「誌面」。全幅画像・大きなヒーロー・非対称の組版はレイアウトプリミティブの縦一列制約では組めない |
| ESLint 例外 | `src/features/landing/**` は `ignores` に残す | 上記の帰結。ただし生 Tailwind ユーティリティは自主的に使わない（§6） |
| ページ骨格 | **B: 見出し先行型** | 最初の一画面を明朝の大見出しと余白で持たせ、画像を後ろに回す。現行素材の質に依存せず、初期表示も速い |
| 「無料でできること」 | **文字主体・画像は小さく丸く** | B の「読み物の入り」と一貫する。現行の正方形素材（実ファイル 640×640）をそのまま使え、切り直しが不要。表示は 52px の丸 |

### 3.1 採用しなかった案

- **雑誌の表紙型（全幅ヒーローを最初に置く）** — 印象が写真の出来に直結する。現行素材の
  差し替えができない以上、賭けになる。
- **画像に文字を重ねる** — 最も今日的に見えるが、前景文字と写真のコントラストは
  静的検査ができない。画像を差し替えた瞬間に AA を割りうる。食品安全表示を扱う
  アプリで「検査できない可読性」を抱えるのは割に合わない。
- **縦積み・大きい画像** — 1 項目を独立した記事に見せられるが、正方形素材を横長に
  切り直す必要があり、被写体次第で破綻する。

## 4. ページ構成（B: 見出し先行型）

順序は現行のまま。各セクションの組み方だけが変わる。

1. **ヒーロー**（画像なし）
   ブランド名 → `<h1>`（明朝 700・`--text-hero`・字間 0.02em）→ リード → 補足 →
   CTA 2 本。

   **「1 画面に収める」は受け入れ条件にしない（D-I1）。** リード約 75 字と補足約 55 字は
   文言据え置きで固定であり、CTA 2 本は各 44px 下限、そこにエディトリアルの余白を足すと
   320×568 の実機では物理的に収まらない。収めようとすれば余白を削るしかなく、目的と
   矛盾する。**受け入れ条件は「初回ビューポートで見出しと CTA に到達できること」と
   「320px で横スクロールしないこと」の 2 つだけ**とし、収まりの良し悪しは人間の
   スクリーンショット判定に委ねる。
2. **ヒーロー画像**
   `free-hero.webp` を CTA の下へ移動する。

   **`width` / `height` 属性は実ファイルに合わせて `1280` / `720` に直す（D-I3）。**
   現行の `height={480}` は実体（1280×720）と食い違っており、「属性を維持すれば
   レイアウトシフトが出ない」という前提自体が成立していない。属性を実寸に揃えたうえで、
   CSS 側でも `aspect-ratio: 1280 / 720` と `object-fit: cover` で予約ボックスを固定する。
   これは文言変更でも機能変更でもなく、既存テストは `<img>` の枚数と `alt=""` しか
   見ていないため衝突しない。

   **読み込み属性は現行のまま `decoding="async"` だけを維持する（D-M3）。**
   `loading` と `fetchpriority` は付けない。画像が CTA より下へ下がることで LCP 要素は
   見出しテキストへ移る見込みであり、`loading="lazy"` を足すと折り返し位置次第で
   かえって遅延して見える。ここは推測で属性を増やさない。
3. **はじめての使い方**
   番号を明朝・**`--primary-strong`**・本文より大きく置き、罫線区切りの縦組みにする。
   **`--primary` を使ってはならない**（理由と実測は §8.2）。
4. **無料でできること**
   `role="list"` / `aria-label="できること"` と 3 つの `<li>` を維持。各項目は
   「丸い小画像（52px）＋ `<h3>`」を横並びにし、その下に本文と箇条書きを置く。
   項目間は 1px の罫線のみ。**箱（`.card`）は使わない。**
5. **クロージング**
   本文 → CTA → 「すでにアカウントがある方は」→ ログイン。現行どおり。

### 4.1 レスポンシブと「全幅」の定義

- 320px で横スクロールを出さない。丸画像は 52px 固定、テキストは折り返す。
- **「全幅」は `.page-frame` のコンテンツ幅いっぱいを指す（D-I5）。** viewport 端まで
  はみ出す bleed は**しない**。`100vw` も負マージンも使わない。`.page-frame` は
  `width: min(100% - 32px, 680px)` なので左右 16px は常に残る。bleed はスクロールバー幅と
  合わさって 320px の横スクロールを再発させる典型経路であり、素材を差し替えられない
  本設計では得るものが小さい。
- 768px 以上の本文幅は `.page-frame` の既存上限 **680px をそのまま使う**（D-M2）。
  LP 側で新しい `max-width` を導入しない。2 カラムグリッドにはしない
  （3 項目が割り切れず、最後の 1 つが浮く）。

### 4.2 `.page-frame` の下余白を LP で打ち消す

`.page-frame` は `padding-block: 32px calc(56px + 8px + env(safe-area-inset-bottom, 0px))`
を持つ。この下余白は**固定ナビの高さ分**だが、`/` は `router.tsx` で `AppShell` の外に
あり（`RootGatePage` 直結）、LP に下ナビは無い。現状は存在しないナビのための死に余白に
なっており、そこへ現行 CSS がさらに `padding-bottom: 3rem` を重ねている。

`.free-landing` 側で下余白を上書きし、LP 単独の値に揃える。`.page-frame` 自体は
触らない（他画面に波及するため）。

## 5. 不変契約（破ったら差し戻し）

- `FREE_LP_*` 定数の**値**を変更しない。参照箇所の増減もしない。
- `<h1>` は 1 つだけ。見出しレベルは h1 → h2 → h3 の順を保つ。
- `<img>` は 4 枚、すべて `alt=""`（装飾）。**枚数と `alt` は不変。`width` / `height` は
  実ファイル寸法へ揃える（§4 の 2、D-I3）。**
- CTA / ログインのリンク先はすべて `/login`。`returnTo` を付けない。
- 禁止語（`Plus` / `plus` / `安全` / `絶対` / `保証` / `無制限` / `何回でも`）を
  DOM のテキストに出さない。既存テストの検査対象は `document.body.textContent` であり、
  **クラス名や属性値は対象外（D-M4）**。BEM の英語クラス名まで部分一致で縛ると
  `safe-area` のような無関係な語で誤爆するため、この規律は**テキストにのみ**適用する。
- タッチ対象は 44×44 CSS px 以上（`min-h-11` は許可されたユーティリティ）。
- `main` ランドマークを維持する。

## 6. CSS 方針

- `free-landing-page.css` を全面的に書き直す。クラス接頭辞 `free-landing__` は維持する。
  この文字列は `styles.contrast.test.ts` の `protectedSelectorFragments` 12 個の
  どれにも一致しない。
- 色・余白・字送り・角丸・モーションはすべて `var(--…)` 参照にする。hex 直書きをしない。
- Phase 0 で追加されたトークンを使う: `--text-hero` / `--leading-hero` /
  `--surface-sunken` / `--motion-fast` / `--motion-base` / `--motion-ease`。
  **これらは `ui/modernization-phase-0` にしか存在しない。** 分岐元を `main` に
  変えるとこの設計は成立しない。
- **inline style を書かない。** `style={{ … }}`、`element.style`、CSS-in-JS の
  runtime injection はいずれも禁止。CSP `style-src 'self'` に `unsafe-inline` が
  無く、この違反は dev / jsdom / Playwright ではすべて緑になり本番でだけ出る。
- hover / focus のトランジションを入れる場合、`@media (prefers-reduced-motion: reduce)`
  のペアを必ずコンポーネント単位で書く。グローバルな `*` 一括リセットは書かない。
- 寒色（Tailwind の `stone` / `slate` 等）を再導入しない。
- 生 Tailwind ユーティリティ（`flex` / `gap-*` / `p-*` / `bg-*` / `text-*` 等）を
  新規に書かない。ESLint の強制対象外だが、二重スタイル系統を増やさないため自主規制する。
  例外は 44px 契約の実装である `min-h-11` / `min-w-11`。

### 6.1 h1 のカスケードを固定する（D-I2）

**`<h1>` に `.free-landing__title` クラスを付け、`.page-frame .free-landing__title`
（詳細度 0,2,0）で書く。** 素の `.free-landing h1` は詳細度 (0,1,1) で
`src/styles.css:989` の `.page-frame h1 { font-size: var(--text-h1); }` と**同点**になり、
読み込み順で勝敗が決まる。Phase 0 は `.ui-page-header__title` でまったく同じ罠を踏み、
`src/styles.css:2948` に「単独では (0,1,0) で負け、`--text-hero` が死ぬ」という実測の
注記を残している。同じ轍を踏まない。

宣言は次の 5 つをセットで書く。**`font-family` と `font-weight: 700` を省かない。**
Zen Old Mincho は 700 のみ self-host されており `:root` は `font-synthesis: none` なので、
省くと明朝が出ずに端末依存のフォールバックに落ちる。

```css
.page-frame .free-landing__title {
  font-family: var(--question-font);
  font-size: var(--text-hero);
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: var(--leading-hero);
}
```

### 6.2 既存クラスの残置範囲（D-I6）

`src/features/landing/**` は ESLint の対象外なので、生ユーティリティが残っても CI は
黙る。「二重スタイル系統を増やさない」を実効化するため、扱いを表で固定する。

| クラス | 扱い |
| --- | --- |
| `page-frame` | **維持**（`main` に付けたまま。幅と左右余白の供給元） |
| `stack` / `gap-*` | **全削除。** 縦間隔は `.free-landing__*` の `gap` ＋ `var(--space-*)` に閉じる |
| `card` | **削除**（§4 の「箱を使わない」の帰結） |
| `type-small` | **削除。** `.free-landing__*` ＋ `var(--text-small)` / `var(--muted)` に置き換える |
| `primary-button` / `secondary-button` | **維持。** CTA は `<Link>` であって `<button>` ではなく、`Button` プリミティブに置き換えられない |
| `min-h-11` | **維持**（44px 契約の実装） |

`primary-button` / `secondary-button` を維持する結果、**CTA の配色は `src/styles.css` 側の
定義に委ねられる**。これらは既に `styles.contrast.test.ts` の検査対象なので、LP 側では
検査しない（§8.2 の表に明記）。

### 6.3 クラス名の変更

「箱をやめる」以上、`.free-landing__card` / `.free-landing__card-img` という名前は
実体と食い違う。`.free-landing__feature` / `.free-landing__feature-img` に改名する。
LP の CSS は凍結ガードの対象外であり、旧クラスを残す理由がない（`2026-08-08` 設計 §5.6 の
「旧クラスは削除しない」は `src/styles.css` の凍結セレクタについての規定である）。
改名に伴う `free-landing-page.test.tsx` の改訂は §7 の規律に従う。

## 7. `root-gate-page.tsx` を触らない理由

`/` の実体は `RootGatePage` で、`showLoading` / `loadingTimedOut` /
`FreeLandingChunkGate` の 3 分岐を持つ。ここには
`COLD_START_SESSION_DEADLINE_MS` による打ち切り、`useLayoutEffect` で paint 前に
タイマーを解除する L3 の race 対策、`queueMicrotask` による再確認といった
タイミング契約が積み上がっている。表示されるのはいずれも短いテキスト 1〜2 行であり、
見た目の利得に対して壊した場合の損失（未ログイン時に `/` が永久ローディングになる）が
釣り合わない。**本設計の対象外とする。**

## 8. テストとガード

LP は現状ほぼガードの外にいる。`accessibility.test.tsx` の axe にも e2e にも登場せず、
`free-landing-page.css` は独立ファイルなので `styles.contrast.test.ts`
（`src/styles.css` しか読まない）の検査対象外である。本設計はここを 2 本だけ埋める。

### 8.1 axe を 1 ケース追加する

`src/app/accessibility.test.tsx` に `FreeLandingPage` のケースを追加する。同ファイルは
変更禁止テストだが、規律は「新規アサーションの**追加のみ**認める」であり、追加は正規手段。
既存 16 ケースには一切触れない。

**目的は構造の退行検出に限定する。** jsdom には描画がないため axe の色コントラスト
ルールは実効しない（incomplete になる）。捕まえたいのは次の 4 つ。

- ランドマーク欠落（`region` ルールは `src/test/axe.ts` で明示的に有効化されている）
- 見出し順の飛び（h1 → h3）
- リスト構造の破壊（`<ul>` 直下が `<li>` でない）
- 画像の alt 欠落、重複 id、無効な aria 属性、名前のないリンク

構成変更で実際に触るのが見出し階層とリスト構造なので、ここが効く。

### 8.2 LP 専用のコントラストテストを 1 本置く

`src/features/landing/free-landing-page.contrast.test.ts`（新規）。
`styles.contrast.test.ts` が持つのと同じ相対輝度計算で、下表の組み合わせを固定する。
**この表が合格の定義である（D-I4）。** 「新規に使う組み合わせ」という曖昧な書き方では、
弱いペアだけ固定して緑にする逃げ道が残る。

**実際のページ地は白 `#ffffff`。** `src/styles.css` は `html` / `body` / `#root` /
`.page-frame` のいずれにも `background` を宣言しておらず、`var(--canvas)` を参照する
規則も 0 件である（`--color-canvas: #faf9f8` は `@theme` のトークンで、`bg-canvas`
ユーティリティとして `shopping` の 1 箇所が使うのみ）。`index.html` の
`<meta name="theme-color" content="#faf9f8">` はブラウザ chrome の色であってページ地
ではない。

| 前景 | 背景 | 用途 | 基準 | 実測 |
| --- | --- | --- | --- | --- |
| `--text` `#26211e` | 白 `#ffffff` | 本文・見出し | ≥ 4.5 | 15.92 |
| `--muted` `#57504b` | 白 `#ffffff` | 補足文・箇条書き | ≥ 4.5 | 7.91 |
| **`--primary-strong` `#a13d24`** | 白 `#ffffff` | **フロー番号** | ≥ 4.5 | 6.55 |
| `--text` `#26211e` | `--canvas` `#faf9f8` | 防御用 | ≥ 4.5 | 15.14 |
| `--muted` `#57504b` | `--canvas` `#faf9f8` | 防御用 | ≥ 4.5 | 7.52 |
| `--primary-strong` `#a13d24` | `--canvas` `#faf9f8` | 防御用 | ≥ 4.5 | 6.22 |
| `--muted` `#57504b` | `--surface-sunken` `#f2efec` | 防御用 | ≥ 4.5 | 6.91 |
| `--primary-strong` `#a13d24` | `--surface-sunken` `#f2efec` | 防御用 | ≥ 4.5 | 5.71 |

**「防御用」と書いた 5 行は、本設計のレイアウトには地色付きセクションが無いため
現時点では出荷されない組み合わせである。** 将来ページ地が塗られたり沈んだ面を
足したときに黙って AA を割らないよう、先に固定しておく。

**フロー番号に `--primary` を使ってはならない（D-I4 / D-M1）。** 実測で
`--primary` `#b85033` は白地 **4.96**（AA ぎりぎり）、`--surface-sunken` 上 **4.33**、
`--notice` 上 **4.48** で、**地色が付いた時点で本文 AA を割る**。`--primary-strong` は
同条件で 6.55 / 5.71 を確保する。番号を large text 扱いにして 3:1 で逃げることもしない
（サイズが実装裁量である以上、基準を本文 AA に固定するほうが安全）。

**CTA（`.primary-button` / `.secondary-button`）は本テストの対象外。** §6.2 のとおり
維持するため配色は `src/styles.css` 側にあり、`styles.contrast.test.ts` が既に検査している。
二重に固定しない。

**`styles.contrast.test.ts` は拡張しない。** あれは `src/styles.css` を単一の
入力として組まれており、`taskRuleDeclarations` の 66 セレクタに対する宣言数の
完全一致検査を含む。別ファイルを読ませると干渉する。

### 8.3 inline style ゼロを固定する

`free-landing-page.test.tsx` に「`main` 配下のすべての要素で `style` 属性が null」
というアサーションを追加する。CSP 違反は本番でしか表面化しないため、ここで塞ぐ。

### 8.4 既存テストの扱い

`free-landing-page.test.tsx` のうち、

- **触らない**: 禁止語テスト、h1 が 1 つであること、CTA の `href="/login"`、
  各定数のテキストが可視であること、`<img>` が 4 枚でありすべて `alt=""` であること
- **改訂する**: 改名するクラスに依存する 2 箇所のみ。
  `.free-landing__card` でトップレベル項目を絞り込んでいる箇所と、
  `.free-landing__card-img` を 3 枚数えている箇所。
  **`.free-landing__hero-img` は改名しないので、その存在確認は触らない。**

3 つ目の `it`（`uses empty alt on decorative images and keeps images compact classes`）は
1 ブロックの中に「枚数と `alt`」と「クラス名」の両方を持つ。**前者は 1 文字も変えず、
後者だけを新しいクラス名に差し替える。** ブロックごと消さない。

改訂は**削除ではなく等価置換**とする。「3 項目が存在し、各項目に見出し・本文・
箇条書きがある」という意図は新しいクラス名で同じだけ表現する。アサーション件数を
減らす場合はコミット本文に理由を書く。テストの変更は実装とは**別コミット**にする。

## 9. 検証

`AGENTS.md` §8 の 9 ステップをそのまま適用する。すべて Docker 経由で実行する。

1. `docker compose run --rm --no-deps app npm run format:check`
2. `docker compose run --rm --no-deps app npm run lint`
3. `docker compose run --rm --no-deps app npm run typecheck`
4. `docker compose run --rm --no-deps app npx vitest run`
5. `./scripts/reset-local-db.sh`
6. `docker compose --profile test run --rm db-test`
7. `./scripts/run-e2e.sh`
8. `docker compose run --rm --no-deps app npm run build`
9. `git diff --check`

5〜7 は LP に DB も e2e も無いため差分は出ない見込みだが、省略はしない。

**提出物**: 幅 320 / 375 / 768 px のスクリーンショット。LP は状態の出し分けが無い
1 ルート（ローディングも空状態も分岐も持たない）なので、状態の
出し分けは不要。撮影スクリプトはコミットしない。

**この worktree は独自の Compose プロジェクト名を持つ**（`scripts/compose-project-name.sh`
がパスの SHA-256 から導出する）。メインのチェックアウトでスタックが動いていても衝突しない。
ただし DB ボリュームも別になるため、初回は `./scripts/generate-local-secrets.sh` と
`docker compose up -d --wait` からの環境構築が要る。

## 10. リスクと未解決

- **分岐元が検証途中である。** `ui/modernization-phase-0` は本設計を書いた時点で
  フル e2e の結果が確定していない。LP の変更が緑でも、土台が赤なら統合時に巻き込まれる。
  マージ順は「UI モダン化の検証完了 → LP」とする。
- **写真素材を変えられない。** 現行 4 枚の質が最終的な見え方の上限を決める。素材を
  差し替える場合は本設計の範囲外として別途扱う。
- **axe はコントラストを見ない。** §8.2 で CSS 側から埋めるが、これは「CSS に書いた
  組み合わせ」の検査であって「実際に画面上で重なった色」の検査ではない。画像の上に
  文字を置く構成を将来採る場合、この検査では守れない（§3.1 で当面採らないと決めた）。
- **LP の CSS は凍結ガードの外に残る。** 本設計では `styles.contrast.test.ts` を
  拡張しない判断をしたため、`free-landing-page.css` の退行を検出するのは §8.2 の
  専用テストだけになる。将来 LP の CSS が育つなら、ガードの統合を再検討する。
