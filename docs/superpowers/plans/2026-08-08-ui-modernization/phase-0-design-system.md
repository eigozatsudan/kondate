# Phase 0: デザインシステム ＋ 冷蔵庫画面の垂直スライス

> **前提:** `README.md` の Global Constraints をすべて読んでいること。あの制約は
> 本ファイルの全タスクに適用される。

**このフェーズのゴール:** `src/shared/ui/` に共有プリミティブ層を作り、ESLint で
プリミティブ経由を強制し、**実際に 1 画面（冷蔵庫）をそれで作り直して動くことを証明する。**

**なぜ垂直スライスまで含むのか:** プリミティブを作るだけでページに適用しないと、それは
どのルートからも到達不能な未使用コードになる。e2e（`getByTestId` 0 件・`getByRole` 依存）も
`src/app/accessibility.test.tsx` の axe も未使用コンポーネントを通らないため、
「既存テストが緑」はトートロジーになる。44px 違反・320px 横スクロール・axe 違反・CSP 違反は
すべて Phase 1 にまとめて先送りされる。**それを防ぐために冷蔵庫画面まで含める。**

冷蔵庫画面（`src/features/pantry/pantry-page.tsx`、388 行）を選ぶ理由は、feature 配下で
最小かつ、一覧・空状態・フォーム・状態色という代表的な要素を一通り持つため。

---

## File Structure

| ファイル | 責務 |
| --- | --- |
| `src/styles.css`（変更） | トークン追加、プリミティブのクラス定義、冷蔵庫の期限色クラス |
| `src/styles.contrast.test.ts`（**追加のみ**） | 新トークンのコントラスト検証を追記 |
| `src/shared/ui/button.tsx`（新規） | `Button`。44×44 下限を型と CSS で保証 |
| `src/shared/ui/button.test.tsx`（新規） | 上記のテスト |
| `src/shared/ui/surface.tsx`（新規） | `Surface`。面と `tone` |
| `src/shared/ui/surface.test.tsx`（新規） | 上記のテスト |
| `src/shared/ui/stack.tsx`（新規） | `Stack` / `Inset`。間隔の唯一の供給源 |
| `src/shared/ui/stack.test.tsx`（新規） | 上記のテスト |
| `src/shared/ui/page-header.tsx`（新規） | `PageHeader`。明朝ヒーロー見出し |
| `src/shared/ui/page-header.test.tsx`（新規） | 上記のテスト |
| `src/shared/ui/feedback.tsx`（新規） | `Skeleton` / `EmptyState` / `Badge`。3 つとも小さく、同時に変わる |
| `src/shared/ui/feedback.test.tsx`（新規） | 上記のテスト |
| `eslint.config.js`（変更） | プリミティブ経由を強制するルールと例外リスト |
| `src/features/pantry/pantry-page.tsx`（変更） | プリミティブへ移行 |
| `src/features/pantry/pantry-form.tsx`（変更） | プリミティブへ移行 |

**ファイルを分ける方針:** 1 コンポーネント 1 ファイル。ただし `Skeleton` / `EmptyState` /
`Badge` は各 20 行程度で常に同時に変更されるため `feedback.tsx` にまとめる。
`Stack` と `Inset` も間隔という単一責務なので同居させる。

---

## Task 0.1: トークンを追加する

**Files:**
- Modify: `src/styles.css`（`:root` ブロック、および `@theme` ブロック）
- Test: `src/styles.contrast.test.ts`（**追加のみ**）

**Interfaces:**
- Produces: CSS カスタムプロパティ `--text-hero` / `--motion-fast` / `--motion-base` /
  `--motion-ease` / `--surface-sunken` / `--warning`、および Tailwind ユーティリティ
  `bg-canvas-sunken` / `text-warning`

**重要:** 既存トークンは**削除も改名もしない**。`src/styles.contrast.test.ts` の
`expectEffectiveDeclarations(":root", { … })` は**部分集合検査**なので、追加だけなら通る。

`--warning` が必要な理由: 現在 `src/features/pantry/pantry-page.tsx:44-48` が
`text-red-800` / `text-amber-800` という Tailwind 組込みパレットを直書きしている。
Task 0.6 の ESLint ルールがこれを禁止するため、トークン化が必要。赤は既存の
`--danger`（`#b3261e`、白地 6.54:1）を使えるが、琥珀に相当するトークンが無い。

- [ ] **Step 1: 失敗するテストを書く**

`src/styles.contrast.test.ts` の末尾に近い `describe` の中へ以下を**追記**する
（既存アサーションは一切触らない）。`contrastRatio` と `expectEffectiveDeclarations`
はこのファイル内に既にあるヘルパを使う。

```ts
it("adds editorial tokens without touching existing ones", () => {
  expectEffectiveDeclarations(":root", {
    "--surface-sunken": "#f2efec",
    "--warning": "#8a4b00",
    "--motion-fast": "120ms",
    "--motion-base": "200ms",
    "--motion-ease": "cubic-bezier(0.2, 0, 0, 1)",
  });
});

it("keeps warning readable on both surfaces", () => {
  // 期限「まもなく」表示に使う。白地と沈んだ面の双方で本文 AA（4.5:1）を満たす。
  expect(contrastRatio("#8a4b00", "#ffffff")).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio("#8a4b00", "#f2efec")).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio("#b3261e", "#f2efec")).toBeGreaterThanOrEqual(4.5);
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/styles.contrast.test.ts
```

期待: FAIL。`--surface-sunken` などが未定義のため。

- [ ] **Step 3: トークンを追加する**

`src/styles.css` の `:root` ブロック（`--space-7: 48px;` の直後）に追記する。

```css
  /*
   * エディトリアル方向（2026-08-08 UI/UX モダン化）で追加したトークン。
   * 既存トークンは styles.contrast.test.ts が hex 単位で固定しているため触らない。
   * 影は追加しない。階層は線と余白で表現する（.choice-card の box-shadow は
   * contrast テストが完全一致で固定しており、共通トークン化できないため）。
   */
  --surface-sunken: #f2efec;
  --warning: #8a4b00; /* 期限「まもなく」。白地 6.80:1 */
  --text-hero: clamp(1.75rem, 8vw, 2.75rem);
  --leading-hero: 1.3;
  --motion-fast: 120ms;
  --motion-base: 200ms;
  --motion-ease: cubic-bezier(0.2, 0, 0, 1);
```

`@theme` ブロック（`--color-danger-700` の直後）にも**色のみ**追記する。`@theme` だけが
Tailwind ユーティリティを生成するため、色は両方に置き値を手で一致させる
（`src/styles.css:30-31` の既存規約）。寸法・時間は `:root` のみ。

```css
  --color-canvas-sunken: #f2efec; /* = --surface-sunken */
  --color-warning: #8a4b00; /* = --warning。白文字ではなく文字色として使う */
```

- [ ] **Step 4: テストを実行して成功を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/styles.contrast.test.ts
docker compose run --rm --no-deps app npx vitest run src/styles.theme.test.ts
```

期待: 両方 PASS。**既存のアサーションが 1 つも落ちていないことを確認すること。**

- [ ] **Step 5: コミット**

```bash
git add src/styles.css src/styles.contrast.test.ts
git commit -m "feat: エディトリアル方向のデザイントークンを追加"
```

---

## Task 0.2: Button プリミティブ

**Files:**
- Create: `src/shared/ui/button.tsx`
- Create: `src/shared/ui/button.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Produces:
  ```ts
  export type ButtonVariant = "primary" | "secondary" | "ghost";
  export type ButtonSize = "regular" | "large";
  export type ButtonProps = Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>, "className"
  > & { variant?: ButtonVariant; size?: ButtonSize; busy?: boolean };
  export function Button(props: ButtonProps): React.JSX.Element;
  ```
  `className` を `Omit` しているのは**意図的**。呼び出し側からの生ユーティリティ注入を
  型で塞ぐ（Task 0.6 の ESLint と二重の防御）。

**命名の注意:** クラス名に `.primary-button` / `.secondary-button` / `.text-button` /
`.field` を**含めない**（Global Constraints の保護セレクタ断片）。`ui-btn` を接頭辞に使う。

- [ ] **Step 1: 失敗するテストを書く**

`src/shared/ui/button.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { Button } from "./button";

describe("Button", () => {
  it("renders a native button with the label", () => {
    render(<Button>保存する</Button>);
    expect(screen.getByRole("button", { name: "保存する" })).toBeInTheDocument();
  });

  it("applies variant and size as enumerated classes, never inline style", () => {
    render(
      <Button variant="secondary" size="large">
        戻る
      </Button>,
    );
    const button = screen.getByRole("button", { name: "戻る" });
    expect(button.className).toContain("ui-btn");
    expect(button.className).toContain("ui-btn--secondary");
    expect(button.className).toContain("ui-btn--large");
    // CSP style-src 'self' 下では inline style が本番でのみ落ちる。ここで塞ぐ。
    expect(button.getAttribute("style")).toBeNull();
  });

  it("defaults to the primary variant", () => {
    render(<Button>作る</Button>);
    expect(screen.getByRole("button", { name: "作る" }).className).toContain("ui-btn--primary");
  });

  it("marks busy state with aria-busy and disables interaction", async () => {
    const onClick = vi.fn();
    render(
      <Button busy onClick={onClick}>
        送信
      </Button>,
    );
    const button = screen.getByRole("button", { name: "送信" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps disabled independent from busy", () => {
    render(<Button disabled>送信</Button>);
    const button = screen.getByRole("button", { name: "送信" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "false");
  });

  it("defaults type to button so it never submits a form implicitly", () => {
    render(<Button>実行</Button>);
    expect(screen.getByRole("button", { name: "実行" })).toHaveAttribute("type", "button");
  });

  it("honours an explicit submit type", () => {
    render(<Button type="submit">登録</Button>);
    expect(screen.getByRole("button", { name: "登録" })).toHaveAttribute("type", "submit");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/shared/ui/button.test.tsx
```

期待: FAIL。`./button` が存在しないため解決エラー。

- [ ] **Step 3: 最小実装を書く**

`src/shared/ui/button.tsx`:

```tsx
import type { ButtonHTMLAttributes, JSX } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "regular" | "large";

/**
 * 共有ボタン。className を受け取らないのは意図的で、呼び出し側からの
 * 生ユーティリティ注入を型で塞ぐ（CSP と二重系統の再発防止）。
 */
export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
};

/** CSP style-src 'self' のため、可変 prop は列挙済みクラスへのマップのみで表現する。 */
const variantClass: Record<ButtonVariant, string> = {
  primary: "ui-btn--primary",
  secondary: "ui-btn--secondary",
  ghost: "ui-btn--ghost",
};

const sizeClass: Record<ButtonSize, string> = {
  regular: "ui-btn--regular",
  large: "ui-btn--large",
};

export function Button({
  variant = "primary",
  size = "regular",
  busy = false,
  disabled = false,
  type = "button",
  children,
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      {...rest}
      type={type}
      className={`ui-btn ${variantClass[variant]} ${sizeClass[size]}`}
      disabled={disabled || busy}
      aria-busy={busy}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 4: CSS を書く**

`src/styles.css` の末尾に追記する。`min-height` / `min-width` の 44px は
`e2e/specs/mobile-accessibility.spec.ts` の実測契約そのものである。

```css
/*
 * 共有ボタン（2026-08-08 UI/UX モダン化）。
 * .primary-button 等の保護セレクタ断片を名前に含めないため ui-btn を接頭辞にする。
 * 44px は mobile-accessibility.spec.ts が実測する契約。
 */
.ui-btn {
  display: inline-flex;
  min-height: 44px;
  min-width: 44px;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  padding: 0 var(--space-5);
  font-family: inherit;
  font-size: var(--text-body);
  font-weight: 700;
  line-height: 1.2;
  cursor: pointer;
}

.ui-btn--large {
  min-height: 52px;
  width: 100%;
}

.ui-btn--primary {
  border-color: var(--primary);
  background: var(--primary);
  color: var(--primary-ink);
}

.ui-btn--primary:hover:not(:disabled) {
  border-color: var(--primary-hover);
  background: var(--primary-hover);
}

.ui-btn--primary:active:not(:disabled) {
  border-color: var(--primary-active);
  background: var(--primary-active);
}

.ui-btn--secondary {
  border-color: var(--border-strong);
  background: var(--surface);
  color: var(--text);
}

.ui-btn--ghost {
  border-color: transparent;
  background: none;
  color: var(--primary-strong);
}

.ui-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.ui-btn:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}
```

- [ ] **Step 5: テストを実行して成功を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/shared/ui/button.test.tsx
docker compose run --rm --no-deps app npx vitest run src/styles.contrast.test.ts
```

期待: 両方 PASS。

**`styles.contrast.test.ts` が落ちた場合**、`.ui-btn` が保護セレクタ判定に引っかかって
いる（`button` 要素トークンを含むセレクタは保護対象）。その場合は
`allowedProtectedSelectors` に `.ui-btn` 系セレクタを追記し、
「共有ボタンプリミティブ（2026-08-08）」という日本語コメントを添える。
**既存アサーションの変更ではなく allowlist への追記であることを守ること。**

- [ ] **Step 6: コミット**

```bash
git add src/shared/ui/button.tsx src/shared/ui/button.test.tsx src/styles.css src/styles.contrast.test.ts
git commit -m "feat: 共有 Button プリミティブを追加"
```

---

## Task 0.3: Surface / Stack / Inset プリミティブ

**Files:**
- Create: `src/shared/ui/surface.tsx`, `src/shared/ui/surface.test.tsx`
- Create: `src/shared/ui/stack.tsx`, `src/shared/ui/stack.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Task 0.1 の `--surface-sunken` / `--notice`
- Produces:
  ```ts
  export type SurfaceTone = "plain" | "sunken" | "notice";
  export type SurfaceProps = { tone?: SurfaceTone; as?: "div" | "section" | "article";
    children: React.ReactNode } & Pick<React.HTMLAttributes<HTMLElement>,
    "id" | "role" | "aria-labelledby" | "aria-label">;
  export function Surface(props: SurfaceProps): React.JSX.Element;

  export type SpaceStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;
  export function Stack(props: { gap?: SpaceStep;
    as?: "div" | "section" | "ul"; children: React.ReactNode }): React.JSX.Element;
  export function Inset(props: { pad?: SpaceStep;
    children: React.ReactNode }): React.JSX.Element;
  ```
  `SpaceStep` の 1〜7 は `src/styles.css` の既存 `--space-1`〜`--space-7`（4/8/12/16/24/32/48px）に
  1 対 1 対応する。**新しい間隔値を持ち込まない。**

- [ ] **Step 1: 失敗するテストを書く**

`src/shared/ui/surface.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Surface } from "./surface";

describe("Surface", () => {
  it("renders a div by default with the plain tone", () => {
    render(<Surface>本文</Surface>);
    const surface = screen.getByText("本文");
    expect(surface.tagName).toBe("DIV");
    expect(surface.className).toContain("ui-surface");
    expect(surface.className).toContain("ui-surface--plain");
  });

  it("maps tone to an enumerated class and never to inline style", () => {
    render(<Surface tone="sunken">沈んだ面</Surface>);
    const surface = screen.getByText("沈んだ面");
    expect(surface.className).toContain("ui-surface--sunken");
    expect(surface.getAttribute("style")).toBeNull();
  });

  it("renders as a labelled section when asked", () => {
    render(
      <Surface as="section" aria-label="登録済みの食材">
        中身
      </Surface>,
    );
    expect(screen.getByRole("region", { name: "登録済みの食材" })).toBeInTheDocument();
  });
});
```

`src/shared/ui/stack.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Inset, Stack } from "./stack";

describe("Stack", () => {
  it("defaults to gap step 4", () => {
    render(<Stack>中身</Stack>);
    const stack = screen.getByText("中身");
    expect(stack.className).toContain("ui-stack");
    expect(stack.className).toContain("ui-stack--gap-4");
    expect(stack.getAttribute("style")).toBeNull();
  });

  it("maps every gap step to its own class", () => {
    render(<Stack gap={6}>広い</Stack>);
    expect(screen.getByText("広い").className).toContain("ui-stack--gap-6");
  });

  it("renders as a list when asked so list semantics survive", () => {
    render(
      <Stack as="ul">
        <li>一件目</li>
      </Stack>,
    );
    expect(screen.getByRole("list")).toBeInTheDocument();
  });
});

describe("Inset", () => {
  it("maps pad to an enumerated class", () => {
    render(<Inset pad={5}>余白つき</Inset>);
    const inset = screen.getByText("余白つき");
    expect(inset.className).toContain("ui-inset--pad-5");
    expect(inset.getAttribute("style")).toBeNull();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/shared/ui/surface.test.tsx src/shared/ui/stack.test.tsx
```

期待: FAIL。モジュールが存在しない。

- [ ] **Step 3: 実装を書く**

`src/shared/ui/surface.tsx`:

```tsx
import type { HTMLAttributes, JSX, ReactNode } from "react";

export type SurfaceTone = "plain" | "sunken" | "notice";

export type SurfaceProps = Pick<
  HTMLAttributes<HTMLElement>,
  "id" | "role" | "aria-labelledby" | "aria-label"
> & {
  tone?: SurfaceTone;
  as?: "div" | "section" | "article";
  children: ReactNode;
};

const toneClass: Record<SurfaceTone, string> = {
  plain: "ui-surface--plain",
  sunken: "ui-surface--sunken",
  notice: "ui-surface--notice",
};

export function Surface({
  tone = "plain",
  as: Tag = "div",
  children,
  ...rest
}: SurfaceProps): JSX.Element {
  return (
    <Tag {...rest} className={`ui-surface ${toneClass[tone]}`}>
      {children}
    </Tag>
  );
}
```

`src/shared/ui/stack.tsx`:

```tsx
import type { JSX, ReactNode } from "react";

/** 既存の --space-1〜--space-7（4/8/12/16/24/32/48px）に 1 対 1 対応する。 */
export type SpaceStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type StackProps = {
  gap?: SpaceStep;
  as?: "div" | "section" | "ul";
  children: ReactNode;
};

export function Stack({ gap = 4, as: Tag = "div", children }: StackProps): JSX.Element {
  return <Tag className={`ui-stack ui-stack--gap-${String(gap)}`}>{children}</Tag>;
}

export type InsetProps = { pad?: SpaceStep; children: ReactNode };

export function Inset({ pad = 4, children }: InsetProps): JSX.Element {
  return <div className={`ui-inset ui-inset--pad-${String(pad)}`}>{children}</div>;
}
```

- [ ] **Step 4: CSS を書く**

`src/styles.css` の末尾に追記する。gap / pad は 7 段すべてを明示的に列挙する
（テンプレート文字列でクラス名を組むため、Tailwind の JIT に頼らない静的定義が必要）。

```css
/*
 * 面と間隔のプリミティブ（2026-08-08 UI/UX モダン化）。
 * 間隔は既存の --space-* のみを参照し、新しい値を持ち込まない。
 * 影は使わない。面の区別は地色と細い線で行う。
 */
.ui-surface {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
}

.ui-surface--plain {
  background: var(--surface);
}

.ui-surface--sunken {
  border-color: transparent;
  background: var(--surface-sunken);
}

.ui-surface--notice {
  border-color: var(--selection);
  background: var(--notice);
}

.ui-stack {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.ui-stack--gap-1 { gap: var(--space-1); }
.ui-stack--gap-2 { gap: var(--space-2); }
.ui-stack--gap-3 { gap: var(--space-3); }
.ui-stack--gap-4 { gap: var(--space-4); }
.ui-stack--gap-5 { gap: var(--space-5); }
.ui-stack--gap-6 { gap: var(--space-6); }
.ui-stack--gap-7 { gap: var(--space-7); }

.ui-inset { min-width: 0; }

.ui-inset--pad-1 { padding: var(--space-1); }
.ui-inset--pad-2 { padding: var(--space-2); }
.ui-inset--pad-3 { padding: var(--space-3); }
.ui-inset--pad-4 { padding: var(--space-4); }
.ui-inset--pad-5 { padding: var(--space-5); }
.ui-inset--pad-6 { padding: var(--space-6); }
.ui-inset--pad-7 { padding: var(--space-7); }

/* ul で使ったときにブラウザ既定のマーカーと余白を消す */
ul.ui-stack {
  margin: 0;
  padding: 0;
  list-style: none;
}
```

- [ ] **Step 5: テストを実行して成功を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/shared/ui/surface.test.tsx src/shared/ui/stack.test.tsx
docker compose run --rm --no-deps app npx vitest run src/styles.contrast.test.ts
```

期待: 両方 PASS。`ul.ui-stack` は要素トークン `ul` を含むが保護対象断片ではない。
万一 `styles.contrast.test.ts` が落ちたら Task 0.2 Step 5 と同じ要領で allowlist に
理由コメント付きで追記する。

- [ ] **Step 6: コミット**

```bash
git add src/shared/ui/surface.tsx src/shared/ui/surface.test.tsx src/shared/ui/stack.tsx src/shared/ui/stack.test.tsx src/styles.css
git commit -m "feat: Surface と Stack/Inset プリミティブを追加"
```

---

## Task 0.4: PageHeader プリミティブ

**Files:**
- Create: `src/shared/ui/page-header.tsx`, `src/shared/ui/page-header.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Task 0.1 の `--text-hero` / `--leading-hero`、既存の `--question-font`
- Produces:
  ```ts
  export type PageHeaderProps = {
    title: string; lead?: string; note?: string; id?: string;
  };
  export function PageHeader(props: PageHeaderProps): React.JSX.Element;
  ```

**明朝は 700 のみ。** `src/styles.css:22` が `@fontsource/zen-old-mincho/700.css` だけを
読み込んでおり、`:root` は `font-synthesis: none`。400 を指定すると合成もされず端末依存の
フォールバックになる（過去に実際に起きた障害。`src/styles.css:15-18`）。
「線を細く」という印象は字間・行間・サイズ・`--muted` で作ること。

- [ ] **Step 1: 失敗するテストを書く**

`src/shared/ui/page-header.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("renders the title as the level-1 heading", () => {
    render(<PageHeader title="食材リスト" />);
    expect(screen.getByRole("heading", { level: 1, name: "食材リスト" })).toBeInTheDocument();
  });

  it("renders lead and note when given", () => {
    render(<PageHeader title="食材リスト" lead="登録する場所です" note="判断はしません" />);
    expect(screen.getByText("登録する場所です")).toBeInTheDocument();
    expect(screen.getByText("判断はしません")).toBeInTheDocument();
  });

  it("omits lead and note when not given", () => {
    const { container } = render(<PageHeader title="食材リスト" />);
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("forwards id to the heading so aria-labelledby can target it", () => {
    render(<PageHeader title="食材リスト" id="pantry-title" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("id", "pantry-title");
  });

  it("never emits inline style", () => {
    const { container } = render(<PageHeader title="食材リスト" lead="説明" />);
    for (const element of container.querySelectorAll("*")) {
      expect(element.getAttribute("style")).toBeNull();
    }
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/shared/ui/page-header.test.tsx
```

期待: FAIL。モジュールが存在しない。

- [ ] **Step 3: 実装を書く**

`src/shared/ui/page-header.tsx`:

```tsx
import type { JSX } from "react";

export type PageHeaderProps = {
  title: string;
  /** 見出し直下の導入文。 */
  lead?: string;
  /** 補足・注意書き。--muted で小さく出す。 */
  note?: string;
  /** aria-labelledby の参照先にする場合の見出し id。 */
  id?: string;
};

export function PageHeader({ title, lead, note, id }: PageHeaderProps): JSX.Element {
  return (
    <header className="ui-page-header">
      <h1 className="ui-page-header__title" {...(id !== undefined ? { id } : {})}>
        {title}
      </h1>
      {lead !== undefined && <p className="ui-page-header__lead">{lead}</p>}
      {note !== undefined && <p className="ui-page-header__note">{note}</p>}
    </header>
  );
}
```

- [ ] **Step 4: CSS を書く**

```css
/*
 * ページ見出し（2026-08-08 UI/UX モダン化）。
 * 明朝は 700 のみ読み込んでいる（styles.css 冒頭の @font-face 注記参照）。
 * font-synthesis: none のため 400 を指定すると端末依存のフォールバックになる。
 * 「細さ」は字間・行間・サイズと --muted で作る。
 */
.ui-page-header {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-3);
}

.ui-page-header__title {
  margin: 0;
  font-family: var(--question-font);
  font-size: var(--text-hero);
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: var(--leading-hero);
}

.ui-page-header__lead {
  margin: 0;
  font-size: var(--text-body);
  line-height: var(--leading-body);
}

.ui-page-header__note {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-small);
  line-height: var(--leading-body);
}
```

- [ ] **Step 5: テストを実行して成功を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/shared/ui/page-header.test.tsx
docker compose run --rm --no-deps app npx vitest run src/styles.contrast.test.ts
```

期待: 両方 PASS。

- [ ] **Step 6: コミット**

```bash
git add src/shared/ui/page-header.tsx src/shared/ui/page-header.test.tsx src/styles.css
git commit -m "feat: PageHeader プリミティブを追加"
```

---

## Task 0.5: Skeleton / EmptyState / Badge

**Files:**
- Create: `src/shared/ui/feedback.tsx`, `src/shared/ui/feedback.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Task 0.2 の `Button`、Task 0.1 の `--surface-sunken` / `--motion-base`
- Produces:
  ```ts
  export function Skeleton(props: { lines?: 1 | 2 | 3; label: string }): React.JSX.Element;
  export function EmptyState(props: {
    title: string; body: string; action?: React.ReactNode;
  }): React.JSX.Element;
  export type BadgeTone = "neutral" | "warning" | "danger";
  export function Badge(props: { tone?: BadgeTone; children: React.ReactNode }): React.JSX.Element;
  ```

**モーションの注意:** `Skeleton` にアニメーションを付ける場合、`unexpectedMotionRules` が
`.wizard-transition` 以外の `animation` / `transition` を不正とする。`.ui-skeleton` が
代表 DOM に `matches()` しなければ検出対象外だが、**確認せずに書かないこと**。
Step 5 で `styles.contrast.test.ts` を実行して判定する。落ちた場合は
`allowedProtectedSelectors` ではなくモーション側の扱いになるため、**アニメーションを
諦めて静的なプレースホルダにする**（グローバル reduced-motion 単一ルールは書けない）。

- [ ] **Step 1: 失敗するテストを書く**

`src/shared/ui/feedback.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge, EmptyState, Skeleton } from "./feedback";
import { Button } from "./button";

describe("Skeleton", () => {
  it("announces its label politely so screen readers are not left silent", () => {
    render(<Skeleton label="食材リストを読み込んでいます" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("食材リストを読み込んでいます");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("renders the requested number of placeholder lines", () => {
    const { container } = render(<Skeleton lines={3} label="読み込み中" />);
    expect(container.querySelectorAll(".ui-skeleton__line")).toHaveLength(3);
  });

  it("defaults to two lines", () => {
    const { container } = render(<Skeleton label="読み込み中" />);
    expect(container.querySelectorAll(".ui-skeleton__line")).toHaveLength(2);
  });
});

describe("EmptyState", () => {
  it("renders title, body and action", () => {
    render(
      <EmptyState
        title="まだ食材がありません"
        body="「食材を追加」から登録できます"
        action={<Button>食材を追加</Button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "まだ食材がありません" })).toBeInTheDocument();
    expect(screen.getByText("「食材を追加」から登録できます")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "食材を追加" })).toBeInTheDocument();
  });

  it("omits the action slot when not given", () => {
    render(<EmptyState title="ありません" body="説明" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("Badge", () => {
  it("maps tone to an enumerated class and never to inline style", () => {
    render(<Badge tone="warning">まもなく</Badge>);
    const badge = screen.getByText("まもなく");
    expect(badge.className).toContain("ui-badge--warning");
    expect(badge.getAttribute("style")).toBeNull();
  });

  it("defaults to the neutral tone", () => {
    render(<Badge>未開封</Badge>);
    expect(screen.getByText("未開封").className).toContain("ui-badge--neutral");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/shared/ui/feedback.test.tsx
```

期待: FAIL。モジュールが存在しない。

- [ ] **Step 3: 実装を書く**

`src/shared/ui/feedback.tsx`:

```tsx
import type { JSX, ReactNode } from "react";

export type SkeletonProps = { lines?: 1 | 2 | 3; label: string };

/**
 * 読み込み中のプレースホルダ。label は必須。
 * 視覚的な箱だけを出して読み上げを黙らせない（axe region 契約と同じ考え方）。
 */
export function Skeleton({ lines = 2, label }: SkeletonProps): JSX.Element {
  return (
    <div className="ui-skeleton" role="status" aria-live="polite">
      <span className="ui-skeleton__label">{label}</span>
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className="ui-skeleton__line" aria-hidden="true" />
      ))}
    </div>
  );
}

export type EmptyStateProps = { title: string; body: string; action?: ReactNode };

export function EmptyState({ title, body, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="ui-empty">
      <h3 className="ui-empty__title">{title}</h3>
      <p className="ui-empty__body">{body}</p>
      {action !== undefined && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}

export type BadgeTone = "neutral" | "warning" | "danger";

const badgeToneClass: Record<BadgeTone, string> = {
  neutral: "ui-badge--neutral",
  warning: "ui-badge--warning",
  danger: "ui-badge--danger",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}): JSX.Element {
  return <span className={`ui-badge ${badgeToneClass[tone]}`}>{children}</span>;
}
```

- [ ] **Step 4: CSS を書く**

アニメーションは付けない（`unexpectedMotionRules` との衝突を避けるため。上の注意参照）。

```css
/*
 * 読み込み・空状態・ラベル（2026-08-08 UI/UX モダン化）。
 * Skeleton にアニメーションは付けない。unexpectedMotionRules が
 * .wizard-transition 以外の animation を不正とするため。
 */
.ui-skeleton {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-3);
}

.ui-skeleton__label {
  color: var(--muted);
  font-size: var(--text-small);
}

.ui-skeleton__line {
  display: block;
  height: 14px;
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
}

.ui-skeleton__line:nth-child(3) {
  width: 60%;
}

.ui-empty {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-6) var(--space-4);
}

.ui-empty__title {
  margin: 0;
  font-family: var(--question-font);
  font-size: var(--text-h2);
  font-weight: 700;
  line-height: var(--leading-h2);
}

.ui-empty__body {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-body);
  line-height: var(--leading-body);
}

.ui-badge {
  display: inline-flex;
  align-items: center;
  border-radius: var(--radius-pill);
  padding: 2px var(--space-3);
  font-size: var(--text-small);
  font-weight: 700;
}

.ui-badge--neutral {
  background: var(--surface-sunken);
  color: var(--muted);
}

.ui-badge--warning {
  background: var(--notice);
  color: var(--warning);
}

.ui-badge--danger {
  background: var(--notice);
  color: var(--danger);
}
```

- [ ] **Step 5: テストを実行して成功を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/shared/ui/feedback.test.tsx
docker compose run --rm --no-deps app npx vitest run src/styles.contrast.test.ts
```

期待: 両方 PASS。

- [ ] **Step 6: コミット**

```bash
git add src/shared/ui/feedback.tsx src/shared/ui/feedback.test.tsx src/styles.css
git commit -m "feat: Skeleton・EmptyState・Badge プリミティブを追加"
```

---

## Task 0.6: プリミティブ経由を強制する ESLint ルール

**Files:**
- Modify: `eslint.config.js`

**Interfaces:**
- Consumes: Task 0.2〜0.5 のプリミティブ
- Produces: `src/features/**/*.tsx` に対する生ユーティリティ禁止ルールと、
  フェーズ移行前のファイルを載せる例外リスト

**これが「レイアウトは実装者の裁量」を安全にする唯一の機構である。** これが無いと、
実装エージェントにとって最も速い経路は生 Tailwind 直書きであり、二重スタイル系統が
今より悪化する。

**禁止するのは配色・余白・レイアウトのユーティリティのみ。** 以下は禁止しない。

- `min-h-11` / `min-w-11`（44px 契約の実装そのもの。`Button` 内部でも使う）
- `font-bold` などのタイポグラフィ、`type-small` などの既存セマンティッククラス
- `src/app/**` と `src/shared/ui/**`（プリミティブ自身の実装箇所）

- [ ] **Step 1: 現在の違反ファイルを洗い出す**

```bash
grep -rlE 'className="[^"]*(\bbg-|\btext-(red|amber|green|blue|stone|slate|gray|zinc|neutral)-|\bflex\b|\bgrid\b|\bitems-|\bjustify-|\bgap-|\bp[xytblr]?-[0-9]|\bm[xytblr]?-[0-9])' src/features --include='*.tsx' | grep -v '\.test\.tsx$' | sort
```

出力されたファイル一覧を控える。これが Step 3 の例外リストの初期値になる。

- [ ] **Step 2: ルールを追加する**

`eslint.config.js` の最後のブロック（`no-restricted-imports` のブロック）の**後ろ**に
追記する。

```js
  {
    /*
     * プリミティブ経由を強制する（2026-08-08 UI/UX モダン化）。
     * 配色・余白・レイアウトは src/shared/ui のプリミティブが唯一の供給源。
     * 生ユーティリティ直書きを許すと二重スタイル系統が再拡大するため塞ぐ。
     * min-h-11 / min-w-11 は 44px 契約の実装なので禁止しない。
     * 例外リストはフェーズ移行が済んだファイルから順に削り、最終的に空にする。
     */
    files: ["src/features/**/*.tsx"],
    ignores: [
      // Phase 1 で移行: ウィザード
      "src/features/planner/**",
      // Phase 2 で移行: 待ち時間
      "src/features/generation/**",
      // Phase 3 で移行: 結果・詳細
      "src/features/menu-detail/**",
      "src/features/history/**",
      // 本プロジェクトのスコープ外（設計書 §1）。移行しないため恒久的に除外する。
      "src/features/billing/**",
      "src/features/landing/**",
      "src/features/welcome/**",
      "src/features/auth/**",
      "src/features/household/**",
      "src/features/privacy/**",
      "src/features/account/**",
      "src/features/emergency/**",
      "src/features/flyer/**",
      "src/features/shopping/**",
      "**/*.test.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXAttribute[name.name='className'] > Literal[value=/(^|\\s)(bg-|text-(red|amber|green|blue|stone|slate|gray|zinc|neutral)-|flex$|grid$|items-|justify-|grid-cols-|gap-|space-[xy]-|p[xytblr]?-[0-9]|m[xytblr]?-[0-9])/]",
          message:
            "配色・余白・レイアウトは src/shared/ui のプリミティブ（Surface / Stack / Inset / Button / PageHeader）を使うこと。生 Tailwind ユーティリティの直書きは禁止（min-h-11 / min-w-11 は可）。",
        },
      ],
    },
  },
```

**Step 1 の出力に、上の `ignores` に載っていないファイルがあった場合は追記すること。**
逆に、`ignores` に載っているが Step 1 の出力に無いディレクトリはそのままでよい
（将来の再発も防ぐため）。

- [ ] **Step 3: lint を実行して緑を確認する**

```bash
docker compose run --rm --no-deps app npm run lint > /tmp/lint.log 2>&1
grep -nE 'error|problem' /tmp/lint.log || tail -n 30 /tmp/lint.log
```

期待: エラーなし。この時点では `src/features/pantry/**` が `ignores` に**入っていない**
ため、`pantry-page.tsx:44-48` の `text-red-800` / `text-amber-800` が**エラーになる**。

- [ ] **Step 4: ルールが実際に効いていることを確認する**

Step 3 で pantry のエラーが出たなら、ルールは機能している。エラーが 1 件も出なかった
場合は selector が誤っているので、`text-red-800` を含む行を実際に検出できるまで
selector を修正すること。**「エラーが出ないから緑」で先に進んではならない。**

pantry は次の Task 0.7 で移行するため、ここでは `ignores` に**追加しない**。

- [ ] **Step 5: コミット**

```bash
git add eslint.config.js
git commit -m "feat: プリミティブ経由を強制する ESLint ルールを追加"
```

このコミット時点で `npm run lint` は pantry のエラーで赤い。Task 0.7 で緑に戻す。
**この 1 コミットだけは赤のまま進めてよい**（ルールの追加と移行を同一コミットに
混ぜると、ルールが本当に効いているかが diff から読めなくなるため）。

---

## Task 0.7: 冷蔵庫画面をプリミティブへ移行する（垂直スライス）

**Files:**
- Modify: `src/features/pantry/pantry-page.tsx`
- Modify: `src/features/pantry/pantry-form.tsx`
- Modify: `src/styles.css`
- Modify: `eslint.config.js`
- Test: `src/features/pantry/pantry-page.test.tsx`（既存。**アクセシブル名を変えなければ
  変更不要**）

**Interfaces:**
- Consumes: `Button` / `Surface` / `Stack` / `Inset` / `PageHeader` / `Skeleton` /
  `EmptyState` / `Badge`

### 不変契約（変更禁止）

- **見出し・ボタン・ラベルのアクセシブル名をすべて維持する。** e2e は `getByTestId` が
  0 件で `getByRole` / `getByText` に全依存している。具体的には最低限:
  - `heading` level 1: `食材リスト`
  - `heading` level 2: `登録済みの食材（…）`（件数の書式も維持）
  - `button`: `食材を追加` / `変更を保存` / `キャンセル` / `削除`
  - `heading`: `まだ食材がありません`
  - `role="status"`: `食材リストを読み込んでいます…`
- `aria-expanded` / `aria-controls="pantry-editor"` / `id="pantry-editor"` の関係を維持する。
- エディタ開閉時のフォーカス移動（`h2` へフォーカス、閉じたらトリガーへ戻す）を維持する。
- 楽観ロック（`expectedUpdatedAt`）と `PantryVersionConflictError` の扱いを一切変えない。
- 期限表示の意味を変えない: 期限切れ＝赤＋「（期限切れ）」、7 日以内＝琥珀＋「（まもなく）」。
- `main` ランドマークを維持する（axe region 契約）。

### 意図（ここが実装者の裁量）

一覧を「箱の羅列」から「読み物」に変える。`PageHeader` で明朝の見出しを大きく取り、
食材カードは線のみで区切る。期限の状態は `Badge` で視認性を上げる。空状態は
`EmptyState` に置き換える。**320px で横スクロールを出さないこと。**

- [ ] **Step 1: 期限色のトークン化テストを書く**

現在 `src/features/pantry/pantry-page.tsx:44-48` の `expiryNotice` が
`text-red-800` / `text-amber-800` を返している。これを Badge の tone に変える。

`src/features/pantry/pantry-page.test.tsx` に**追記**する（既存テストは触らない）。
`expiryNotice` を export していない場合は export に変更してよい。

```tsx
import { expiryNotice } from "./pantry-page";

describe("expiryNotice", () => {
  const now = new Date("2026-08-08T03:00:00Z"); // JST 2026-08-08 12:00

  it("marks a past date as expired with the danger tone", () => {
    expect(expiryNotice("2026-08-07", now)).toEqual({ tone: "danger", suffix: "（期限切れ）" });
  });

  it("marks a date within seven days as soon with the warning tone", () => {
    expect(expiryNotice("2026-08-14", now)).toEqual({ tone: "warning", suffix: "（まもなく）" });
  });

  it("leaves a far future date unmarked", () => {
    expect(expiryNotice("2026-09-30", now)).toEqual({ tone: null, suffix: "" });
  });

  it("treats today as not yet expired", () => {
    expect(expiryNotice("2026-08-08", now)).toEqual({ tone: "warning", suffix: "（まもなく）" });
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/pantry/pantry-page.test.tsx
```

期待: FAIL。`expiryNotice` が `{ className, suffix }` を返しているため。

- [ ] **Step 3: `expiryNotice` の戻り値をトークン化する**

`src/features/pantry/pantry-page.tsx` の該当箇所を差し替える。

```tsx
import type { BadgeTone } from "@/shared/ui/feedback";

export type ExpiryNotice = { tone: BadgeTone | null; suffix: string };

/** D-I6: 期限切れは danger・7日以内は warning（注意表示）。色は Badge のトーンで表す。 */
export function expiryNotice(expiresOn: string, now: Date = new Date()): ExpiryNotice {
  const todayKey = jstDateKey(now);
  if (expiresOn < todayKey) {
    return { tone: "danger", suffix: "（期限切れ）" };
  }
  const soonKey = jstDateKey(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
  if (expiresOn <= soonKey) {
    return { tone: "warning", suffix: "（まもなく）" };
  }
  return { tone: null, suffix: "" };
}
```

呼び出し側は `className` を渡していた箇所を `<Badge tone={notice.tone}>` に置き換える
（`tone` が `null` のときは `Badge` を描画しない）。

- [ ] **Step 4: テストを実行して成功を確認する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/pantry/pantry-page.test.tsx
```

期待: PASS。

- [ ] **Step 5: 画面をプリミティブで組み直す**

`PantryPageContent` の JSX を、上の「不変契約」を守ったまま
`PageHeader` / `Surface` / `Stack` / `Inset` / `Button` / `EmptyState` / `Skeleton` /
`Badge` で組み直す。`pantry-form.tsx` のボタンも `Button` に置き換える。

`main` 要素と `page-frame` クラスは残してよい（設計書 §5.6: 旧クラスは削除しない）。
`className="primary-button min-h-11"` のような直書きは `<Button>` に置き換える。

**レイアウトの具体は実装者の裁量。** ただし:
- 320px で横スクロールを出さない
- すべての操作が 44×44 px 以上
- `style` 属性を新規に書かない
- 新規 CSS クラスが必要なら `.pantry-` 接頭辞を使い、保護セレクタ断片を含めない

- [ ] **Step 6: pantry を ESLint の例外リストから外れたまま緑にする**

`eslint.config.js` の `ignores` に `src/features/pantry/**` を**追加しない**。
生ユーティリティが残っていればエラーになる。

```bash
docker compose run --rm --no-deps app npm run lint > /tmp/lint.log 2>&1
grep -nE 'error|problem' /tmp/lint.log || tail -n 30 /tmp/lint.log
```

期待: エラーなし。

- [ ] **Step 7: 単体テストと a11y テストを実行する**

```bash
docker compose run --rm --no-deps app npx vitest run src/features/pantry
docker compose run --rm --no-deps app npx vitest run src/app/accessibility.test.tsx
docker compose run --rm --no-deps app npx vitest run src/styles.contrast.test.ts src/styles.theme.test.ts
```

期待: すべて PASS。`accessibility.test.tsx` は `PantryPageContent` に axe を実行して
いるため、ここで初めてプリミティブが実画面で検証される。**これが Phase 0 を垂直スライスに
した目的である。**

- [ ] **Step 8: 型チェックと整形**

```bash
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run format:check
```

期待: 両方 PASS。`format:check` が落ちたら
`docker compose run --rm --no-deps app npm run format` で整形してから再実行する。

- [ ] **Step 9: e2e を実行する**

```bash
./scripts/run-e2e.sh > /tmp/e2e.log 2>&1
grep -nE 'passed|failed|✘' /tmp/e2e.log | tail -n 30
```

期待: 全 spec PASS。**アクセシブル名を維持できていれば e2e の変更は不要。**
落ちた場合は e2e を書き換えるのではなく、**アクセシブル名を元に戻す**こと。
Phase 0 は e2e の改訂を認めない。

- [ ] **Step 10: コミット**

```bash
git add src/features/pantry src/styles.css
git commit -m "refactor: 冷蔵庫画面を共有プリミティブへ移行"
```

`src/features/pantry/pantry-page.test.tsx` を変更した場合は**別コミットに分ける**。

```bash
git add src/features/pantry/pantry-page.test.tsx
git commit -m "test: expiryNotice のトーン化に追随"
```

---

## Phase 0 完了チェック

- [ ] `README.md` の検証フロー 9 ステップをすべて実行し、すべてパスした
- [ ] `src/styles.contrast.test.ts` / `src/styles.theme.test.ts` /
      `src/app/accessibility.test.tsx` / `e2e/specs/mobile-accessibility.spec.ts` の
      **既存アサーションを 1 つも変更していない**
- [ ] 新規に `style={{ … }}` を 1 箇所も書いていない
      （確認: `grep -rn 'style={{' src/shared/ui src/features/pantry`）
- [ ] `src/features/pantry/**` が ESLint の例外リストに**入っていない**状態で lint が緑
- [ ] 冷蔵庫画面のスクリーンショットを 320 / 375 / 768 px で提出した
- [ ] 変更ファイル一覧と、テスト変更を分離したコミット hash を提出した

**次:** `phase-1-wizard.md`
