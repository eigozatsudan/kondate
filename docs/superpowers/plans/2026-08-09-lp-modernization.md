# LP モダン化 実装計画

> **実装エージェントへ:** 本計画は `superpowers:subagent-driven-development` または
> `superpowers:executing-plans` でタスク単位に実行すること。手順は `- [ ]` で追跡する。

**Goal:** 未ログインの `/` に出る LP を、文言・URL・CTA 先を 1 文字も変えずに
「温かいエディトリアル」方向へ組み直す。

**Architecture:** `src/features/landing/free-landing-page.tsx` の JSX を再構成し、
`free-landing-page.css` を全面的に書き直す。共有プリミティブ（`Surface` / `Stack` /
`Inset`）は使わず、`src/styles.css` のトークンだけを共有する。先にガード
（axe・コントラスト・inline style）を張ってから見た目に触る。

**Tech Stack:** React 19.2.7 / Vite 8 / TypeScript strict / Vitest + Testing Library /
axe-core / Docker Compose

**設計書（契約の正本）:**
`docs/superpowers/specs/2026-08-09-lp-modernization-design.md`
本計画と設計書が食い違う場合は**設計書が正**。食い違いを見つけたら実装を止めて報告する。

**作業ブランチ:** `ui/lp-modernization`（worktree `.worktrees/lp-modernization`）

---

## Global Constraints

設計書 §5 / §6 の固定契約。**全タスクに暗黙に適用される。** 違反は差し戻し事由。

### 文言・属性

- `FREE_LP_*` 定数の**値**を変更しない。参照箇所の増減もしない。
- `<h1>` は 1 つだけ。見出しレベルは h1 → h2 → h3 の順を保つ。
- `<img>` は 4 枚、すべて `alt=""`。`width` / `height` は実ファイル寸法に揃える
  （hero `1280`×`720`、benefit 3 枚は `640`×`640`）。
- CTA / ログインのリンク先はすべて `/login`。`returnTo` を付けない。
- 禁止語（`Plus` / `plus` / `安全` / `絶対` / `保証` / `無制限` / `何回でも`）を
  DOM のテキストに出さない。**クラス名・属性値は対象外**。
- タッチ対象は 44×44 CSS px 以上。`min-h-11` は使ってよい。
- `main` ランドマークを維持する。
- ユーザー向け文言は日本語。コメントとコミットメッセージも日本語。識別子とテスト名は英語。

### CSS

- **inline style を新規に書かない。** `style={{ … }}`、`element.style`、CSS-in-JS の
  runtime injection はすべて禁止。CSP `style-src 'self'` に `unsafe-inline` が無く、
  この違反は dev / jsdom / Playwright では**すべて緑になり本番でだけ出る**。
- 色・余白・字送り・角丸・時間はすべて `var(--…)` 参照。**hex 直書きをしない。**
  現行 CSS の `color-mix(in srgb, … #e8ddd4)` のようなフォールバック hex も撤去する。
- 寒色（Tailwind の `stone` / `slate` 等）を再導入しない。
- モーションを足す場合は `@media (prefers-reduced-motion: reduce)` のペアを
  **コンポーネント単位で必ず**書く。グローバルな `*` 一括リセットは書かない。
- クラス接頭辞は `free-landing__` を維持する。
- `src/styles.css` を編集しない。**LP の変更を `src/styles.css` に持ち込まない。**

### 既存クラスの残置範囲（設計書 §6.2）

| クラス | 扱い |
| --- | --- |
| `page-frame` | 維持 |
| `stack` / `gap-*` | **全削除** |
| `card` | **削除** |
| `type-small` | **削除** |
| `primary-button` / `secondary-button` | 維持（CTA は `<Link>` で `Button` に置換不能） |
| `min-h-11` | 維持 |

### 触らないもの

- `src/features/landing/root-gate-page.tsx` とそのテスト。
- `src/styles.css` / `src/styles.contrast.test.ts` / `src/styles.theme.test.ts`。
- `eslint.config.js`（`src/features/landing/**` は `ignores` に残す）。
- `src/app/accessibility.test.tsx` の**既存 16 ケース**。追加のみ認める。

### 禁止事項

- `git push`、PR 作成、デプロイ。
- 破壊的 git 操作を人間の即時承認なしに行うこと。
- `--no-verify`。
- 機能の追加・削除・変更。

### コマンドの実行方法

すべて Docker 経由。**この worktree は独自の Compose プロジェクト名を持つ**
（`scripts/compose-project-name.sh` がパスの SHA-256 から導出する）。

```bash
docker compose run --rm --no-deps app npx vitest run <ファイル>
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npx eslint <触ったファイル>
docker compose run --rm --no-deps app npm run format:check
```

初回のみ環境構築が要る（`AGENTS.md` §2/§3）。

```bash
./scripts/generate-local-secrets.sh
docker compose run --rm --no-deps app npm ci
```

**e2e / db:test は `npm run` 経由で `app` コンテナから実行できない**（Docker socket が
無い）。ホスト側で直接実行する。

---

## File Structure

| ファイル | 責務 |
| --- | --- |
| `src/features/landing/free-landing-page.tsx`（変更） | LP の JSX。`FREE_LP_*` 定数の定義もここ（現行どおり） |
| `src/features/landing/free-landing-page.css`（全面書き換え） | LP 専用のレイアウトと装飾 |
| `src/features/landing/free-landing-page.test.tsx`（改訂） | 構造・文言・禁止語・画像・inline style |
| `src/features/landing/free-landing-page.contrast.test.ts`（新規） | LP が使う前景／背景の AA 検査 |
| `src/app/accessibility.test.tsx`（**追加のみ**） | LP の axe ケース 1 件 |

---

## Task 1: ガードを張る

**なぜ最初か:** LP は現状ほぼガードの外にいる。`accessibility.test.tsx` にも e2e にも
登場せず、`free-landing-page.css` は `styles.contrast.test.ts`（`src/styles.css` しか
読まない）の対象外である。**見た目に触る前に退行検出の網を張る。** 逆順にすると、
壊れたかどうかを判定できないまま次のタスクへ進むことになる。

**Files:**
- Modify: `src/app/accessibility.test.tsx`（末尾に describe を追加）
- Create: `src/features/landing/free-landing-page.contrast.test.ts`
- Modify: `src/features/landing/free-landing-page.test.tsx`（末尾に it を追加）

**Interfaces:**
- Consumes: `FreeLandingPage`（`src/features/landing/free-landing-page`）、
  `runAxe`（`@/test/axe`）
- Produces: なし（テストのみ）

- [ ] **Step 1: axe ケースを追加する**

`src/app/accessibility.test.tsx` の**末尾**（`describe("generation and result accessibility", …)`
の閉じ括弧のあと、ファイル最終行）に追記する。既存 16 ケースには一切触らない。

`MemoryRouter` は既に `:4` で import 済み。`FreeLandingPage` の import を
既存の import 群の末尾（`@/features/...` の並び）に足す。

```tsx
import { FreeLandingPage } from "@/features/landing/free-landing-page";
```

```tsx
describe("landing accessibility", () => {
  // LP は e2e にも既存 axe にも登場しない。構成変更で触るのは見出し階層と
  // リスト構造なので、そこを axe で固定する。
  // jsdom には描画が無いため色コントラストは axe では見えない（incomplete になる）。
  // それは free-landing-page.contrast.test.ts が受け持つ。
  it("free landing keeps main landmark, single h1, and list semantics", async () => {
    const { container } = render(
      <MemoryRouter>
        <FreeLandingPage />
      </MemoryRouter>,
    );

    await expectAccessible(container);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("list", { name: "できること" })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "メインメニュー" })).toBeNull();
  });
});
```

- [ ] **Step 2: 実行して現状で通ることを確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/app/accessibility.test.tsx
```

期待: **全ケース PASS**。これは「失敗するテスト」ではなく**現状を固定するテスト**である。
ここで落ちたら、それは Task 2 以降で壊れたのではなく**現行 LP に既に a11y 違反がある**
ということなので、実装を止めて人間に報告する。

- [ ] **Step 3: コントラストテストを書く**

`src/features/landing/free-landing-page.contrast.test.ts`（新規）。設計書 §8.2 の
ペア表をそのまま固定する。`styles.contrast.test.ts` の `contrast` は export されて
いないため、同じ WCAG 2.x の式を自前で持つ。

```ts
import { describe, expect, it } from "vitest";

/** WCAG 2.x の相対輝度。styles.contrast.test.ts:1131 と同じ式を LP 用に持つ。 */
function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => {
    const raw = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return raw <= 0.04045 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = channels as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** src/styles.css の :root と同じ値。ここが動いたら LP 側も追随が要る。 */
const TEXT = "#26211e";
const MUTED = "#57504b";
const PRIMARY = "#b85033";
const PRIMARY_STRONG = "#a13d24";
const WHITE = "#ffffff";
const SUNKEN = "#f2efec";
const CANVAS = "#faf9f8";

describe("free landing contrast", () => {
  it("keeps body text readable on both page grounds", () => {
    expect(contrast(TEXT, WHITE)).toBeGreaterThanOrEqual(4.5); // 実測 15.92
    expect(contrast(MUTED, WHITE)).toBeGreaterThanOrEqual(4.5); // 実測 7.91
    expect(contrast(MUTED, SUNKEN)).toBeGreaterThanOrEqual(4.5); // 実測 6.91
  });

  it("uses primary-strong for the flow number so tinted grounds still pass AA", () => {
    expect(contrast(PRIMARY_STRONG, WHITE)).toBeGreaterThanOrEqual(4.5); // 実測 6.55
    expect(contrast(PRIMARY_STRONG, SUNKEN)).toBeGreaterThanOrEqual(4.5); // 実測 5.71
  });

  it("documents why --primary itself is not allowed as a text colour here", () => {
    // 白地では辛うじて通るが、地色が付いた瞬間に本文 AA を割る。
    // フロー番号に --primary を使ってはならない理由をここで固定する。
    expect(contrast(PRIMARY, WHITE)).toBeGreaterThanOrEqual(4.5); // 実測 4.96
    expect(contrast(PRIMARY, SUNKEN)).toBeLessThan(4.5); // 実測 4.33
  });

  it("holds for the canvas ground too, in case the page ground is ever painted", () => {
    // 現在ページ地を塗る規則は無い（styles.css に html/body/#root/.page-frame の
    // background 宣言が無く var(--canvas) 参照も 0 件）。将来塗られたときに
    // 黙って割れないよう先に固定する。
    expect(contrast(TEXT, CANVAS)).toBeGreaterThanOrEqual(4.5); // 実測 15.14
    expect(contrast(MUTED, CANVAS)).toBeGreaterThanOrEqual(4.5); // 実測 7.52
    expect(contrast(PRIMARY_STRONG, CANVAS)).toBeGreaterThanOrEqual(4.5); // 実測 6.22
  });
});
```

- [ ] **Step 4: 実行して通ることを確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/landing/free-landing-page.contrast.test.ts
```

期待: 4 ケースすべて PASS。

- [ ] **Step 5: inline style ゼロのテストを追加する**

`src/features/landing/free-landing-page.test.tsx` の `describe("FreeLandingPage", …)`
の**末尾**に `it` を追記する。既存の 3 ケースには触らない。

```tsx
  it("never emits inline style so CSP style-src self holds in production", () => {
    renderLp();
    const main = document.querySelector("main");
    expect(main).not.toBeNull();
    for (const element of main!.querySelectorAll("*")) {
      expect(element.getAttribute("style")).toBeNull();
    }
    expect(main!.getAttribute("style")).toBeNull();
  });
```

- [ ] **Step 6: 実行して通ることを確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/landing/free-landing-page.test.tsx
```

期待: 4 ケースすべて PASS（現行 LP に inline style は無い）。

- [ ] **Step 7: 型・lint・整形**

```bash
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npx eslint src/app/accessibility.test.tsx src/features/landing/
docker compose run --rm --no-deps app npm run format:check
```

期待: すべてエラーなし。**`src/features/landing/**` は `eslint.config.js` の
プリミティブ強制ルールの `ignores` に入っているため、そのルールに関しては no-op である。**
ここで効くのは `strictTypeChecked` など全体に掛かる規則のほう。「landing で何も出ない＝
ルールが壊れている」と誤診しないこと。

- [ ] **Step 8: コミット**

```bash
git add src/app/accessibility.test.tsx src/features/landing/free-landing-page.contrast.test.ts src/features/landing/free-landing-page.test.tsx
git commit -m "test: LP をガード下に置く（axe・コントラスト・inline style）"
```

---

## Task 2: ヒーローと CTA を組み直す

**Files:**
- Modify: `src/features/landing/free-landing-page.tsx`
- Modify: `src/features/landing/free-landing-page.css`
- Test: `src/features/landing/free-landing-page.test.tsx`（Task 1 で追加済みのケースが効く）

**Interfaces:**
- Consumes: Task 1 のテスト群
- Produces: クラス `free-landing__title` / `free-landing__hero-img`（改名なし）/
  `free-landing__cta-row`。Task 3・4 が同じ接頭辞で続く。

### このタスクの受け入れ条件

- `<h1>` が明朝 700・`--text-hero` で描画される（設計書 §6.1 のセレクタで書くこと）
- ヒーロー画像が CTA の**下**にあり、`width={1280} height={720}`
- 320px で横スクロールしない
- **「1 画面に収める」は条件にしない**（設計書 §4 の 1）

- [ ] **Step 1: 見出しのクラスとカスケードを固定するテストを書く**

`free-landing-page.test.tsx` の末尾に追記する。

```tsx
  it("gives the h1 its own class so the page-frame h1 rule cannot win", () => {
    // .free-landing h1 は .page-frame h1（styles.css:989）と詳細度が同点(0,1,1)になり、
    // 読み込み順で --text-hero が死ぬ。Phase 0 が .ui-page-header__title で
    // 実際に踏んだ罠（styles.css:2948 の注記）。クラスを付けて (0,2,0) にする。
    renderLp();
    const heading = screen.getByRole("heading", { level: 1, name: FREE_LP_H1 });
    expect(heading).toHaveClass("free-landing__title");
  });

  it("places the hero image after the call to action with its real dimensions", () => {
    renderLp();
    const hero = document.querySelector(".free-landing__hero-img");
    expect(hero).not.toBeNull();
    // 実ファイルは 1280x720。属性が 480 のままだと予約ボックスと実体がずれて CLS が出る。
    expect(hero).toHaveAttribute("width", "1280");
    expect(hero).toHaveAttribute("height", "720");
    const cta = screen.getAllByRole("link", { name: FREE_LP_CTA })[0]!;
    // DOCUMENT_POSITION_FOLLOWING === 4: hero が CTA より後ろにある
    expect(cta.compareDocumentPosition(hero!) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(4);
  });
```

- [ ] **Step 2: 実行して失敗を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/landing/free-landing-page.test.tsx
```

期待: 2 ケース FAIL。`free-landing__title` が無く、`height` が `480`、hero が CTA の前。

- [ ] **Step 3: JSX を組み替える**

`free-landing-page.tsx` の `FreeLandingPage` 冒頭を差し替える。**`FREE_LP_*` の値は
触らない。** `stack gap-5` / `gap-3` を落とし、`free-landing__hero` の gap は CSS で持つ。

```tsx
export function FreeLandingPage() {
  return (
    <main className="page-frame free-landing">
      <div className="free-landing__hero">
        <p className="free-landing__brand">{FREE_LP_BRAND}</p>
        <h1 className="free-landing__title">{FREE_LP_H1}</h1>
        <p className="free-landing__lead">{FREE_LP_LEAD}</p>
        <p className="free-landing__lead-sub">{FREE_LP_LEAD_SUB}</p>
        <div className="free-landing__cta-row">
          <Link className="primary-button min-h-11" to="/login">
            {FREE_LP_CTA}
          </Link>
          <Link className="secondary-button min-h-11 free-landing__login-link" to="/login">
            {FREE_LP_LOGIN}
          </Link>
        </div>
      </div>

      <img
        src={heroUrl}
        alt=""
        width={1280}
        height={720}
        className="free-landing__hero-img"
        decoding="async"
      />

      {/* 以降のセクションは Task 3 で組み替える。ここでは触らない。 */}
```

以降（`<section className="free-landing__flow …">` から末尾まで）は現状のまま残す。

- [ ] **Step 4: CSS のヒーロー部を書き直す**

`free-landing-page.css` の先頭から `.free-landing__hero-img` の定義までを差し替える。
**hex 直書きと `color-mix` のフォールバック hex を撤去する。**

```css
/*
 * 無料 LP（2026-08-09 モダン化）。文章を主・画像は補助。
 * 色・余白・字送りはすべて styles.css のトークン参照にする。
 * Surface / Stack は使わない（設計書 §3）。
 */

.free-landing {
  /*
   * .page-frame の下余白は固定ナビ（56px）前提だが、/ は AppShell の外にあり
   * LP に下ナビは無い。死に余白になるので LP 側で上書きする（設計書 §4.2）。
   */
  padding-bottom: var(--space-7);
  display: flex;
  flex-direction: column;
  gap: var(--space-7);
}

.free-landing__hero {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.free-landing__brand {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-small);
  font-weight: 700;
  letter-spacing: 0.14em;
}

/*
 * 詳細度 (0,2,0)。素の .free-landing h1 は (0,1,1) で
 * styles.css:989 の .page-frame h1 と同点になり、読み込み順で --text-hero が死ぬ。
 * 明朝は 700 のみ self-host（font-synthesis: none）なので font-weight を省かない。
 */
.page-frame .free-landing__title {
  margin: 0;
  font-family: var(--question-font);
  font-size: var(--text-hero);
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: var(--leading-hero);
}

.free-landing__lead {
  margin: 0;
  font-size: var(--text-body);
  line-height: var(--leading-body);
}

.free-landing__lead-sub {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-small);
  line-height: var(--leading-body);
}

.free-landing__cta-row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-3);
  margin-top: var(--space-2);
}

.free-landing__login-link {
  text-align: center;
}

/*
 * 全幅 = page-frame のコンテンツ幅いっぱい（設計書 §4.1）。
 * viewport bleed はしない。100vw も負マージンも使わない。
 * aspect-ratio は実ファイル（1280x720）に合わせる。属性と一致させないと
 * 予約ボックスとデコード後がずれて CLS が出る。
 */
.free-landing__hero-img {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 1280 / 720;
  object-fit: cover;
  border-radius: var(--radius-lg);
  background: var(--surface-sunken);
}
```

- [ ] **Step 5: 実行して通ることを確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/landing/
docker compose run --rm --no-deps app npx vitest run src/app/accessibility.test.tsx
```

期待: すべて PASS。**Task 1 で追加した axe ケースと inline style ケースが緑のままである
ことを確認すること。** ここが落ちたら見出し階層かランドマークを壊している。

- [ ] **Step 6: 型・lint・整形**

```bash
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npx eslint src/features/landing/
docker compose run --rm --no-deps app npm run format:check
```

期待: すべてエラーなし。

- [ ] **Step 7: コミット**

```bash
git add src/features/landing/free-landing-page.tsx src/features/landing/free-landing-page.css
git commit -m "refactor: LP のヒーローを見出し先行に組み直す"
```

テストを変更した場合は別コミットにする。

```bash
git add src/features/landing/free-landing-page.test.tsx
git commit -m "test: LP 見出しクラスとヒーロー位置の契約を追加する"
```

---

## Task 3: フローと「無料でできること」を組み直す

**Files:**
- Modify: `src/features/landing/free-landing-page.tsx`
- Modify: `src/features/landing/free-landing-page.css`
- Modify: `src/features/landing/free-landing-page.test.tsx`

**Interfaces:**
- Consumes: Task 2 の `.free-landing__*` 接頭辞
- Produces: `free-landing__feature` / `free-landing__feature-img`（`__card` からの改名）

### このタスクの受け入れ条件

- 「無料でできること」は `role="list"` / `aria-label="できること"` と 3 つの `<li>` を維持
- 各項目は「丸い小画像（52px）＋ `<h3>`」を横並びにし、下に本文と箇条書き
- 箱（`.card`）を使わず、項目間は 1px の罫線のみ
- フロー番号は `--primary-strong`（`--primary` は使わない）

- [ ] **Step 1: クラス改名に追随するテストを書く**

`free-landing-page.test.tsx` の**既存 1 ケース目**（`renders single h1, richer copy, …`）の
`topCards` を絞り込んでいる行と、**既存 3 ケース目**（`uses empty alt on decorative images …`）の
クラス名アサーションを差し替える。**枚数・`alt`・文言のアサーションは 1 文字も変えない。**

1 ケース目の該当行だけを次に置き換える。

```tsx
    const topCards = items.filter((el) => el.classList.contains("free-landing__feature"));
```

3 ケース目の該当行だけを次に置き換える。`<img>` が 4 枚であることと `alt=""` の
ループはそのまま残す。

```tsx
    expect(document.querySelectorAll(".free-landing__feature-img")).toHaveLength(3);
```

- [ ] **Step 2: 実行して失敗を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/landing/free-landing-page.test.tsx
```

期待: 2 ケース FAIL。`free-landing__feature` がまだ存在しない。

- [ ] **Step 3: JSX を組み替える**

Task 2 で残した `<section className="free-landing__flow …">` 以降を差し替える。
`stack gap-2` / `gap-3` と `card` と `type-small` を落とす。**`FREE_LP_*` の値は触らない。**

```tsx
      <section className="free-landing__flow" aria-labelledby="free-lp-flow-title">
        <h2 id="free-lp-flow-title" className="free-landing__section-title">
          {FREE_LP_FLOW_TITLE}
        </h2>
        <ol className="free-landing__flow-list">
          {FREE_LP_FLOW_STEPS.map((step, index) => (
            <li key={step} className="free-landing__flow-item">
              <span className="free-landing__flow-num" aria-hidden="true">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="free-landing__features" aria-labelledby="free-lp-features-title">
        <h2 id="free-lp-features-title" className="free-landing__section-title">
          {FREE_LP_FEATURES_TITLE}
        </h2>
        <ul className="free-landing__feature-list" aria-label="できること">
          <li className="free-landing__feature">
            <div className="free-landing__feature-head">
              <img
                src={familyUrl}
                alt=""
                width={640}
                height={640}
                className="free-landing__feature-img"
                decoding="async"
              />
              <h3 className="free-landing__feature-title">{FREE_LP_FAMILY_TITLE}</h3>
            </div>
            <p className="free-landing__feature-body">{FREE_LP_FAMILY_BODY}</p>
            <ul className="free-landing__points">
              {FREE_LP_FAMILY_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </li>
          <li className="free-landing__feature">
            <div className="free-landing__feature-head">
              <img
                src={menuUrl}
                alt=""
                width={640}
                height={640}
                className="free-landing__feature-img"
                decoding="async"
              />
              <h3 className="free-landing__feature-title">{FREE_LP_MENU_TITLE}</h3>
            </div>
            <p className="free-landing__feature-body">{FREE_LP_MENU_BODY}</p>
            <ul className="free-landing__points">
              {FREE_LP_MENU_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </li>
          <li className="free-landing__feature">
            <div className="free-landing__feature-head">
              <img
                src={pantryUrl}
                alt=""
                width={640}
                height={640}
                className="free-landing__feature-img"
                decoding="async"
              />
              <h3 className="free-landing__feature-title">{FREE_LP_PANTRY_TITLE}</h3>
            </div>
            <p className="free-landing__feature-body">{FREE_LP_PANTRY_BODY}</p>
            <ul className="free-landing__points">
              {FREE_LP_PANTRY_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </li>
        </ul>
      </section>

      <section className="free-landing__closing" aria-labelledby="free-lp-closing">
        <p id="free-lp-closing" className="free-landing__closing-body">
          {FREE_LP_CLOSING}
        </p>
        <Link className="primary-button min-h-11" to="/login">
          {FREE_LP_CTA}
        </Link>
        <p className="free-landing__closing-note">{FREE_LP_EXISTING}</p>
        <Link className="secondary-button min-h-11 free-landing__login-link" to="/login">
          {FREE_LP_LOGIN}
        </Link>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: CSS の残りを書き直す**

`free-landing-page.css` の `.free-landing__section-title` 以降を差し替える。

```css
.free-landing__section-title {
  margin: 0 0 var(--space-5);
  font-family: var(--question-font);
  font-size: var(--text-h2);
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: var(--leading-h2);
}

.free-landing__flow-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}

.free-landing__flow-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  font-size: var(--text-body);
  line-height: var(--leading-body);
}

.free-landing__flow-item + .free-landing__flow-item {
  border-top: 1px solid var(--border);
  padding-top: var(--space-4);
}

/*
 * 番号は --primary-strong。--primary（#b85033）は地色が付くと
 * 本文 AA を割る（sunken 上 4.33。free-landing-page.contrast.test.ts で固定）。
 */
.free-landing__flow-num {
  flex: 0 0 auto;
  min-width: 1.5em;
  color: var(--primary-strong);
  font-family: var(--question-font);
  font-size: var(--text-h2);
  font-weight: 700;
  line-height: 1.1;
}

.free-landing__feature-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* 箱を使わない。項目の区切りは罫線だけ。 */
.free-landing__feature + .free-landing__feature {
  border-top: 1px solid var(--border);
  padding-top: var(--space-5);
}

.free-landing__feature-head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-bottom: var(--space-3);
}

.free-landing__feature-img {
  display: block;
  flex: 0 0 52px;
  width: 52px;
  height: 52px;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  border-radius: var(--radius-pill);
  background: var(--surface-sunken);
}

.free-landing__feature-title {
  margin: 0;
  font-size: var(--text-body);
  font-weight: 700;
  line-height: var(--leading-body);
}

.free-landing__feature-body {
  margin: 0 0 var(--space-3);
  font-size: var(--text-body);
  line-height: var(--leading-body);
}

.free-landing__points {
  margin: 0;
  padding-left: var(--space-5);
  color: var(--muted);
  font-size: var(--text-small);
  line-height: var(--leading-body);
}

.free-landing__points li + li {
  margin-top: var(--space-1);
}

.free-landing__closing {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.free-landing__closing-body {
  margin: 0;
  font-size: var(--text-body);
  line-height: var(--leading-body);
}

.free-landing__closing-note {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-small);
}
```

- [ ] **Step 5: CSS の配線を固定するテストを追加する**

**コントラストテストは hex の算術しか見ていない。** `.free-landing__flow-num` の色を
`var(--primary)` に戻しても全ケース緑のままで、退行を検出できない。CSS の実配線を
1 本だけ assert する。

`src/features/landing/free-landing-page.contrast.test.ts` の末尾に追記する。

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("free landing css wiring", () => {
  it("wires the flow number to --primary-strong, not --primary", () => {
    // 算術だけでは「表は緑・実装は --primary」を通してしまう。実 CSS を読む。
    const css = readFileSync(
      resolve(process.cwd(), "src/features/landing/free-landing-page.css"),
      "utf8",
    );
    const rule = /\.free-landing__flow-num\s*\{([^}]*)\}/u.exec(css)?.[1];
    expect(rule).toBeDefined();
    expect(rule).toContain("color: var(--primary-strong)");
    expect(rule).not.toContain("color: var(--primary)");
  });
});
```

`import` はファイル先頭に置くこと（`describe` の直前ではない）。

- [ ] **Step 6: 実行して通ることを確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/landing/
docker compose run --rm --no-deps app npx vitest run src/app/accessibility.test.tsx
```

期待: すべて PASS。**禁止語テストが落ちていないことを必ず確認する。**

- [ ] **Step 7: 型・lint・整形**

```bash
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npx eslint src/features/landing/
docker compose run --rm --no-deps app npm run format:check
```

- [ ] **Step 8: コミット（実装とテストを分ける）**

```bash
git add src/features/landing/free-landing-page.tsx src/features/landing/free-landing-page.css
git commit -m "refactor: LP のフローと機能紹介を罫線区切りの読み物にする"
git add src/features/landing/free-landing-page.test.tsx
git commit -m "$(cat <<'EOF'
test: LP のカード改名にクラス名アサーションを追随させる

箱をやめたため .free-landing__card は実体と食い違う。__feature へ改名した。
枚数・alt・文言のアサーションは変更していない。
EOF
)"
```

---

## Task 4: 旧クラスの残骸を消して提出する

**Files:**
- Modify: `src/features/landing/free-landing-page.tsx`（残っていれば）
- Modify: `src/features/landing/free-landing-page.css`（残っていれば）

**Interfaces:**
- Consumes: Task 2・3 の成果
- Produces: 提出物（スクリーンショット・検証結果）

- [ ] **Step 1: 旧クラスが残っていないことを機械的に確認する**

```bash
grep -nE 'className="[^"]*\b(stack|gap-[0-9]|card|type-small)\b' src/features/landing/free-landing-page.tsx || echo "残骸なし"
grep -nE '#[0-9a-fA-F]{3,6}' src/features/landing/free-landing-page.css || echo "hex 直書きなし"
grep -n 'style={{' src/features/landing/free-landing-page.tsx || echo "inline style なし"
```

期待: 3 つとも「なし」。残っていれば設計書 §6.2 の表に従って落とす。
**`primary-button` / `secondary-button` / `min-h-11` / `page-frame` は残ってよい。**

- [ ] **Step 2: 全テストを実行する**

```bash
docker compose run --rm --no-deps app npx vitest run
```

期待: 全 PASS。**LP 以外のテストが落ちていないことを確認する**
（`src/styles.css` を触っていなければ落ちないはず。落ちたら触っている）。

- [ ] **Step 3: 検証フロー 9 ステップを実行する**

`AGENTS.md` §8 に従い、**それぞれ独立したコマンドとして**この順に実行する。
`&&` で連結しない。

```bash
docker compose run --rm --no-deps app npm run format:check
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npx vitest run
./scripts/reset-local-db.sh
docker compose --profile test run --rm db-test
./scripts/run-e2e.sh
docker compose run --rm --no-deps app npm run build
git diff --check
```

**`./scripts/run-e2e.sh` を実行する前に、他のセッションが e2e を走らせていないことを
確認する。** `.run-e2e.lock/pid` の PID が生きていれば待つ。走行中にソースを触ると
Vite dev がテスト対象のブラウザへ変更を配信し、結果が無効になる。

出力が大きいものはファイルへリダイレクトし、要約と失敗行だけを読む。

- [ ] **Step 4: 320 / 375 / 768 px で撮影する**

`e2e/specs/` には置かない撮影用スクリプトを使う。LP は未ログインで到達できるため
認証は不要で、`page.goto("/")` だけでよい。

```ts
// e2e/shots/lp.spec.ts（コミットしない）
import { expect, test } from "@playwright/test";

test("landing", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
  for (const width of [320, 375, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `docs/superpowers/plans/lp-shots/lp-${String(width)}.png`, fullPage: true });
  }
});
```

```bash
./scripts/run-e2e.sh --config=e2e/playwright.shots.config.ts --project=shots
```

**撮影スクリプトはコミットしない。提出物は生成された画像のみ。**

- [ ] **Step 5: 320px で横スクロールが無いことを確認する**

撮影した 320px の画像を目視し、右端で内容が切れていないことを確認する。
`.free-landing__hero-img` に `width: 100%` を使い bleed していなければ出ないはずだが、
`.free-landing__points` の `padding-left` と長い箇条書きの組み合わせで出ることがある。

あわせて、**320px の画像で最初の 1 画面ぶん（上から 568px 相当）に `<h1>` と
「無料ではじめる」が両方入っているか**を目視する。設計書 §4 のとおりこれは
受け入れ条件ではなく努力目標だが、入っていない場合は人間の判断を仰ぐこと。
自動テストは存在しない。

- [ ] **Step 6: 提出**

次を揃えて人間に出す。

1. スクリーンショット 3 枚（320 / 375 / 768）
2. 変更ファイル一覧
3. テスト変更を分離したコミットの hash
4. 検証フロー 9 ステップの結果（各コマンドの pass / fail）

**人間の目が「オシャレさ」の唯一のゲートである。** 視覚回帰テストはこのリポジトリに
存在しない。承認を得るまで完了としない。

- [ ] **Step 7: 残っていれば掃除をコミット**

```bash
git add src/features/landing
git commit -m "chore: LP から旧レイアウトクラスの残骸を落とす"
```

---

## 完了条件

- [ ] Task 1〜4 のすべての手順が完了している
- [ ] `FREE_LP_*` 定数の値が 1 文字も変わっていない
- [ ] `src/styles.css` / `styles.contrast.test.ts` / `styles.theme.test.ts` /
      `root-gate-page.tsx` を変更していない
- [ ] `src/app/accessibility.test.tsx` の既存 16 ケースを変更していない（追加のみ）
- [ ] `free-landing-page.test.tsx` の禁止語・`alt=""`・`<img>` 4 枚・文言アサーションを
      変更していない
- [ ] `free-landing-page.css` に hex 直書きが 1 つも無い
- [ ] LP に `style={{ … }}` が 1 つも無い
- [ ] 検証フロー 9 ステップがすべてパスしている
- [ ] スクリーンショット 3 幅について人間の承認が得られている
