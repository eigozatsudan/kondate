# 無料 LP を最初の HTML で読ませる Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /` の最初の HTML に現行無料 LP 本文を載せ、JS 利用者には見せず、他パスは薄いシェルのまま返す。

**Architecture:** Vite 二文書（`index.html` = `/`、`app.html` = SPA フォールバック）。`FREE_LP_*` を copy モジュールに切り出し、純関数が静的 HTML を生成する。`lp-boot.js` + エントリ CSS で JS 利用者から隠す。Netlify は実在ファイル優先、`/*` を `/app.html` へ 200（`force` なし）。

**Tech Stack:** Vite 8、React 19、Netlify `_headers` / redirects、Vitest、node:test、Playwright、Docker `app`。

**Spec:** `docs/superpowers/specs/2026-08-16-public-landing-html-seo-design.md`

## Global Constraints

- Node.js `>=24 <25`、ESM、`strict: true`、境界で `any` 禁止
- ユーザー向け文言は日本語。`FREE_LP_*` の文字列は 1 文字も変えない
- コードコメント・コミットメッセージは日本語（Conventional Commits）
- Docker: `docker compose run --rm --no-deps app <cmd>`。エージェントは `&&` / `;` でコマンド連結しない
- `package.json` の `build` 文字列（`tsc -b && vite build`）は変えない
- CSP `script-src 'self'` / `style-src 'self'` に token を足さない。`unsafe-inline` 禁止
- Auth ロック（`AuthFlow` / `ContinuationApi` / `AuthProvider` / `BrowserSupabaseClient`）を再定義しない
- `RootGate` の振り分け・保護ルート・公開レシピ面は変えない
- `@shared/safety` をブラウザへ import しない
- `git push` / 本番 deploy / 破壊的 git は人間の明示指示なしで行わない
- 識別子は Spec どおり: `#kondate-public-lp`、クラス `kondate-js`、`/lp-boot.js`

## File map

| ファイル | 責務 |
| --- | --- |
| `src/features/landing/free-landing-copy.ts` | `FREE_LP_*` 文言の正本 |
| `src/features/landing/build-public-landing-html.ts` | 静的 LP HTML / head メタ / エスケープ |
| `src/features/landing/inject-public-landing-html.ts` | `index.html` 文字列へ LP とメタを挿入（失敗は throw） |
| `src/features/landing/free-landing-page.tsx` | React LP。copy を再 export |
| `public/lp-boot.js` | `html` に `kondate-js` を付ける |
| `src/styles.css` | `html.kondate-js #kondate-public-lp { display: none; }` |
| `index.html` | `/` 用。空マウント + boot + head 印 |
| `app.html` | 薄いシェル |
| `vite.config.ts` | 二入力 + 挿入プラグイン |
| `netlify.toml` | `/*` → `/app.html` 200、`force` なし |
| `public/robots.txt` | `Allow: /$` / `Disallow: /` |
| `scripts/csp-headers.mjs` | `/app.html` に `X-Robots-Tag: noindex` |
| `scripts/generate-service-worker.mjs` | Precache に `/lp-boot.js` |

---

### Task 1: copy 正本と静的 HTML 生成

**Files:**
- Create: `src/features/landing/free-landing-copy.ts`
- Create: `src/features/landing/build-public-landing-html.ts`
- Create: `src/features/landing/build-public-landing-html.test.ts`
- Modify: `src/features/landing/free-landing-page.tsx`（定数定義を copy からの再 export に置換。JSX は変えない）

**Interfaces:**
- Consumes: 現行 `free-landing-page.tsx` の `FREE_LP_*` 文字列（値はコピーして移す。変更しない）
- Produces:
  - `export const FREE_LP_BRAND` ほか現行と同名の `as const` 定数一式
  - `export type PublicLandingAssets = { heroSrc: string; familySrc: string; menuSrc: string; pantrySrc: string }`
  - `export const PUBLIC_LANDING_ASSET_PATHS: PublicLandingAssets`（Spec §6.1 の 4 path）
  - `export function escapeHtml(value: string): string`
  - `export function buildPublicLandingHtml(assets: PublicLandingAssets): string`（`#kondate-public-lp` の中身。外側の div は付けない）
  - `export function buildPublicLandingHeadHtml(): string`
  - `free-landing-page.tsx` は全 `FREE_LP_*` を `export { ... } from "./free-landing-copy"`

- [ ] **Step 1: 失敗するテストを書く**

`build-public-landing-html.test.ts`:

```ts
import { render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it } from "vitest";
import {
  FREE_LP_BRAND,
  FREE_LP_CLOSING,
  FREE_LP_CTA,
  FREE_LP_EXISTING,
  FREE_LP_FAMILY_BODY,
  FREE_LP_FAMILY_POINTS,
  FREE_LP_FAMILY_TITLE,
  FREE_LP_FEATURES_TITLE,
  FREE_LP_FLOW_STEPS,
  FREE_LP_FLOW_TITLE,
  FREE_LP_H1,
  FREE_LP_LEAD,
  FREE_LP_LEAD_SUB,
  FREE_LP_LOGIN,
  FREE_LP_MENU_BODY,
  FREE_LP_MENU_POINTS,
  FREE_LP_MENU_TITLE,
  FREE_LP_PANTRY_BODY,
  FREE_LP_PANTRY_POINTS,
  FREE_LP_PANTRY_TITLE,
} from "./free-landing-copy";
import {
  PUBLIC_LANDING_ASSET_PATHS,
  buildPublicLandingHeadHtml,
  buildPublicLandingHtml,
  escapeHtml,
} from "./build-public-landing-html";
import { FreeLandingPage } from "./free-landing-page";

const FORBIDDEN = ["Plus", "plus", "安全", "絶対", "保証", "無制限", "何回でも"] as const;

function flattenText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function stripTags(html: string): string {
  return flattenText(html.replace(/<[^>]+>/gu, " "));
}

describe("escapeHtml", () => {
  it("escapes ampersand first then markup characters", () => {
    expect(escapeHtml(`&<>"`)).toBe("&amp;&lt;&gt;&quot;");
  });
});

describe("buildPublicLandingHtml", () => {
  it("includes copy, login hrefs, four images, and no forbidden words", () => {
    const html = buildPublicLandingHtml(PUBLIC_LANDING_ASSET_PATHS);
    expect(html).toContain(FREE_LP_H1);
    expect(html).toContain(FREE_LP_LEAD);
    expect(html).toContain(FREE_LP_LEAD_SUB);
    expect(html).toContain(FREE_LP_FLOW_TITLE);
    for (const step of FREE_LP_FLOW_STEPS) expect(html).toContain(step);
    expect(html).toContain(FREE_LP_FEATURES_TITLE);
    expect(html).toContain(FREE_LP_FAMILY_TITLE);
    expect(html).toContain(FREE_LP_FAMILY_BODY);
    expect(html).toContain(FREE_LP_MENU_TITLE);
    expect(html).toContain(FREE_LP_PANTRY_TITLE);
    expect(html).toContain(FREE_LP_CLOSING);
    expect(html).toContain(FREE_LP_EXISTING);
    expect(html).toContain('href="/login"');
    expect(html).not.toMatch(/\bhidden\b/u);
    expect(html).not.toContain("aria-hidden");
    expect(html).not.toContain("style=");
    expect(html).not.toContain("display:none");
    for (const word of FORBIDDEN) expect(html).not.toContain(word);

    const imgs = [...html.matchAll(/<img\b([^>]*)>/gu)].map((match) => match[1] ?? "");
    expect(imgs).toHaveLength(4);
    expect(imgs[0]).toContain(`src="${PUBLIC_LANDING_ASSET_PATHS.heroSrc}"`);
    expect(imgs[0]).toContain('alt=""');
    expect(imgs[0]).toContain('width="1280"');
    expect(imgs[0]).toContain('height="720"');
    for (const attrs of imgs.slice(1)) {
      expect(attrs).toContain('alt=""');
      expect(attrs).toContain('width="640"');
      expect(attrs).toContain('height="640"');
    }
  });

  it("matches FreeLandingPage visible text", () => {
    const router = createMemoryRouter(
      [
        { path: "/", element: <FreeLandingPage /> },
        { path: "/login", element: <h1>ログイン画面</h1> },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByRole("heading", { level: 1, name: FREE_LP_H1 })).toBeVisible();
    const reactText = flattenText(document.body.textContent ?? "");
    const staticText = stripTags(buildPublicLandingHtml(PUBLIC_LANDING_ASSET_PATHS));
    expect(staticText).toBe(reactText);
  });
});

describe("buildPublicLandingHeadHtml", () => {
  it("uses escaped lead and relative canonical", () => {
    const head = buildPublicLandingHeadHtml();
    expect(head).toContain(`content="${escapeHtml(FREE_LP_LEAD)}"`);
    expect(head).toContain(`content="${escapeHtml(FREE_LP_BRAND)}"`);
    expect(head).toContain('property="og:locale" content="ja_JP"');
    expect(head).toContain('name="twitter:card" content="summary"');
    expect(head).toContain('rel="canonical" href="/"');
    expect(head).not.toContain("og:url");
    expect(head).not.toContain("og:image");
  });
});
```

既存 `free-landing-page.test.tsx` の import パスは変えない（再 export で通す）。

- [ ] **Step 2: テストが失敗することを確認**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/landing/build-public-landing-html.test.ts`

Expected: FAIL（モジュール未定義）

- [ ] **Step 3: 最小実装**

`free-landing-copy.ts`: 現行 `free-landing-page.tsx` L8–55 の定数を **値そのまま** 移す。コメントは「React LP と静的 HTML の唯一の文言正本」。

`build-public-landing-html.ts`:

```ts
import {
  FREE_LP_BRAND,
  FREE_LP_CLOSING,
  FREE_LP_CTA,
  FREE_LP_EXISTING,
  FREE_LP_FAMILY_BODY,
  FREE_LP_FAMILY_POINTS,
  FREE_LP_FAMILY_TITLE,
  FREE_LP_FEATURES_TITLE,
  FREE_LP_FLOW_STEPS,
  FREE_LP_FLOW_TITLE,
  FREE_LP_H1,
  FREE_LP_LEAD,
  FREE_LP_LEAD_SUB,
  FREE_LP_LOGIN,
  FREE_LP_MENU_BODY,
  FREE_LP_MENU_POINTS,
  FREE_LP_MENU_TITLE,
  FREE_LP_PANTRY_BODY,
  FREE_LP_PANTRY_POINTS,
  FREE_LP_PANTRY_TITLE,
} from "./free-landing-copy";

export type PublicLandingAssets = {
  heroSrc: string;
  familySrc: string;
  menuSrc: string;
  pantrySrc: string;
};

export const PUBLIC_LANDING_ASSET_PATHS: PublicLandingAssets = {
  heroSrc: "/src/features/landing/assets/free-hero.webp",
  familySrc: "/src/features/landing/assets/free-benefit-family.webp",
  menuSrc: "/src/features/landing/assets/free-benefit-menu.webp",
  pantrySrc: "/src/features/landing/assets/free-benefit-pantry.webp",
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function featureBlock(input: {
  src: string;
  title: string;
  body: string;
  points: readonly string[];
}): string {
  const points = input.points
    .map((point) => `<li>${escapeHtml(point)}</li>`)
    .join("");
  return `<li class="free-landing__feature"><div class="free-landing__feature-head"><img src="${escapeHtml(input.src)}" alt="" width="640" height="640" class="free-landing__feature-img" decoding="async" /><h3 class="free-landing__feature-title">${escapeHtml(input.title)}</h3></div><p class="free-landing__feature-body">${escapeHtml(input.body)}</p><ul class="free-landing__points">${points}</ul></li>`;
}

export function buildPublicLandingHtml(assets: PublicLandingAssets): string {
  const steps = FREE_LP_FLOW_STEPS.map(
    (step, index) =>
      `<li class="free-landing__flow-item"><span class="free-landing__flow-num">${escapeHtml(String(index + 1))}</span><span>${escapeHtml(step)}</span></li>`,
  ).join("");
  return `<main class="page-frame free-landing"><div class="free-landing__hero"><p class="free-landing__brand">${escapeHtml(FREE_LP_BRAND)}</p><h1 class="free-landing__title">${escapeHtml(FREE_LP_H1)}</h1><p class="free-landing__lead">${escapeHtml(FREE_LP_LEAD)}</p><p class="free-landing__lead-sub">${escapeHtml(FREE_LP_LEAD_SUB)}</p><div class="free-landing__cta-row"><a class="primary-button min-h-11" href="/login">${escapeHtml(FREE_LP_CTA)}</a><a class="secondary-button min-h-11 free-landing__login-link" href="/login">${escapeHtml(FREE_LP_LOGIN)}</a></div></div><img src="${escapeHtml(assets.heroSrc)}" alt="" width="1280" height="720" class="free-landing__hero-img" decoding="async" /><section class="free-landing__flow" aria-labelledby="free-lp-flow-title"><h2 id="free-lp-flow-title" class="free-landing__section-title">${escapeHtml(FREE_LP_FLOW_TITLE)}</h2><ol class="free-landing__flow-list">${steps}</ol></section><section class="free-landing__features" aria-labelledby="free-lp-features-title"><h2 id="free-lp-features-title" class="free-landing__section-title">${escapeHtml(FREE_LP_FEATURES_TITLE)}</h2><ul class="free-landing__feature-list" aria-label="できること">${featureBlock({ src: assets.familySrc, title: FREE_LP_FAMILY_TITLE, body: FREE_LP_FAMILY_BODY, points: FREE_LP_FAMILY_POINTS })}${featureBlock({ src: assets.menuSrc, title: FREE_LP_MENU_TITLE, body: FREE_LP_MENU_BODY, points: FREE_LP_MENU_POINTS })}${featureBlock({ src: assets.pantrySrc, title: FREE_LP_PANTRY_TITLE, body: FREE_LP_PANTRY_BODY, points: FREE_LP_PANTRY_POINTS })}</ul></section><section class="free-landing__closing" aria-labelledby="free-lp-closing"><p id="free-lp-closing" class="free-landing__closing-body">${escapeHtml(FREE_LP_CLOSING)}</p><a class="primary-button min-h-11" href="/login">${escapeHtml(FREE_LP_CTA)}</a><p class="free-landing__closing-note">${escapeHtml(FREE_LP_EXISTING)}</p><a class="secondary-button min-h-11 free-landing__login-link" href="/login">${escapeHtml(FREE_LP_LOGIN)}</a></section></main>`;
}

export function buildPublicLandingHeadHtml(): string {
  const lead = escapeHtml(FREE_LP_LEAD);
  const brand = escapeHtml(FREE_LP_BRAND);
  return `<meta name="description" content="${lead}" />
    <meta property="og:title" content="${brand}" />
    <meta property="og:description" content="${lead}" />
    <meta property="og:locale" content="ja_JP" />
    <meta name="twitter:card" content="summary" />
    <link rel="canonical" href="/" />`;
}
```

静的側の手順番号に `aria-hidden` を付けない（Spec §6.1）。React 側の `aria-hidden` は残す。可視テキスト照合は番号文字列が両方に残るので成立する。

`free-landing-page.tsx`: 定数ブロックを削除し、次を置く。JSX と画像 import は触らない。

```ts
export {
  FREE_LP_BRAND,
  FREE_LP_CLOSING,
  FREE_LP_CTA,
  FREE_LP_EXISTING,
  FREE_LP_FAMILY_BODY,
  FREE_LP_FAMILY_POINTS,
  FREE_LP_FAMILY_TITLE,
  FREE_LP_FEATURES_TITLE,
  FREE_LP_FLOW_STEPS,
  FREE_LP_FLOW_TITLE,
  FREE_LP_H1,
  FREE_LP_LEAD,
  FREE_LP_LEAD_SUB,
  FREE_LP_LOGIN,
  FREE_LP_MENU_BODY,
  FREE_LP_MENU_POINTS,
  FREE_LP_MENU_TITLE,
  FREE_LP_PANTRY_BODY,
  FREE_LP_PANTRY_POINTS,
  FREE_LP_PANTRY_TITLE,
} from "./free-landing-copy";
```

- [ ] **Step 4: テストが通ることを確認**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/landing/build-public-landing-html.test.ts src/features/landing/free-landing-page.test.ts src/features/landing/root-gate-page.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/landing/free-landing-copy.ts src/features/landing/build-public-landing-html.ts src/features/landing/build-public-landing-html.test.ts src/features/landing/free-landing-page.tsx
git commit -m "feat(seo): 無料LP文言を正本化し静的HTMLを生成する"
```

---

### Task 2: JS 利用者からの隠匿

**Files:**
- Create: `public/lp-boot.js`
- Create: `src/features/landing/lp-boot.test.ts`
- Modify: `src/styles.css`（末尾付近、`.page-frame` の後でも可）

**Interfaces:**
- Consumes: なし
- Produces:
  - `/lp-boot.js` が `document.documentElement.classList.add("kondate-js")` だけを行う
  - `src/styles.css` に `html.kondate-js #kondate-public-lp { display: none; }`

- [ ] **Step 1: 失敗するテストを書く**

`lp-boot.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("lp-boot", () => {
  it("adds kondate-js on the document element", () => {
    document.documentElement.className = "";
    const source = readFileSync(resolve("public/lp-boot.js"), "utf8");
    new Function(source)();
    expect(document.documentElement.classList.contains("kondate-js")).toBe(true);
  });

  it("hides the public landing node from the entry stylesheet", () => {
    const css = readFileSync(resolve("src/styles.css"), "utf8");
    expect(css).toMatch(/html\.kondate-js\s+#kondate-public-lp\s*\{[^}]*display:\s*none/u);
    const landingCss = readFileSync(resolve("src/features/landing/free-landing-page.css"), "utf8");
    expect(landingCss).not.toMatch(/#kondate-public-lp/u);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/landing/lp-boot.test.ts`

Expected: FAIL（`public/lp-boot.js` 欠落または CSS 規則なし）

- [ ] **Step 3: 最小実装**

`public/lp-boot.js`:

```js
document.documentElement.classList.add("kondate-js");
```

`src/styles.css` に追加（`free-landing-page.css` には書かない）:

```css
/*
 * 公開 LP の静的コピーは JS 利用者に見せない。
 * エントリ CSS に置く（LP CSS は遅延 chunk）。
 * HTML 側には hidden を書かない（クローラが本文を読むため）。
 */
html.kondate-js #kondate-public-lp {
  display: none;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/landing/lp-boot.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/lp-boot.js src/features/landing/lp-boot.test.ts src/styles.css
git commit -m "feat(seo): JS利用者から静的LPを隠す"
```

---

### Task 3: 二文書と `index.html` への挿入

**Files:**
- Create: `src/features/landing/inject-public-landing-html.ts`
- Create: `src/features/landing/inject-public-landing-html.test.ts`
- Create: `app.html`
- Modify: `index.html`
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes: `buildPublicLandingHtml` / `buildPublicLandingHeadHtml` / `PUBLIC_LANDING_ASSET_PATHS` / `FREE_LP_H1`
- Produces:
  - `export const PUBLIC_LANDING_HEAD_MARK = "<!-- kondate-public-lp-head -->"`
  - `export const PUBLIC_LANDING_MOUNT = '<div id="kondate-public-lp"></div>'`
  - `export function isPublicLandingIndexFilename(filename: string): boolean`（`/` 区切りで `index.html` で終わる。`app.html` は false）
  - `export function injectPublicLandingHtml(html: string): string`
    - 既に `#kondate-public-lp` 内に `FREE_LP_H1` があればそのまま返す（transform 二重呼び出し）
    - `id="kondate-public-lp"` が無ければ `throw new Error("public_lp_mount_missing")`
    - 空マウント `PUBLIC_LANDING_MOUNT` が無ければ `throw new Error("public_lp_mount_not_empty")`
    - `PUBLIC_LANDING_HEAD_MARK` が無ければ `throw new Error("public_lp_head_mark_missing")`
    - 置換後に `FREE_LP_H1` が無ければ `throw new Error("public_lp_insert_failed")`
    - 置換後に `name="description"` が無ければ `throw new Error("public_lp_meta_missing")`
  - Vite プラグイン名 `"kondate-public-landing-html"`。`transformIndexHtml.order` は `"pre"`。`isPublicLandingIndexFilename(ctx.filename)` が false なら html をそのまま返す

- [ ] **Step 1: 失敗するテストを書く**

`inject-public-landing-html.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FREE_LP_H1, FREE_LP_LEAD } from "./free-landing-copy";
import {
  PUBLIC_LANDING_HEAD_MARK,
  PUBLIC_LANDING_MOUNT,
  injectPublicLandingHtml,
  isPublicLandingIndexFilename,
} from "./inject-public-landing-html";

const shell = `<!doctype html><html lang="ja"><head>${PUBLIC_LANDING_HEAD_MARK}<title>こんだて日和</title></head><body>${PUBLIC_LANDING_MOUNT}<div id="root"></div></body></html>`;

describe("isPublicLandingIndexFilename", () => {
  it("accepts only index.html", () => {
    expect(isPublicLandingIndexFilename("/workspace/index.html")).toBe(true);
    expect(isPublicLandingIndexFilename("/workspace/app.html")).toBe(false);
    expect(isPublicLandingIndexFilename("/workspace/login.html")).toBe(false);
  });
});

describe("injectPublicLandingHtml", () => {
  it("fills mount and head, and is idempotent", () => {
    const once = injectPublicLandingHtml(shell);
    expect(once).toContain(FREE_LP_H1);
    expect(once).toContain(FREE_LP_LEAD);
    expect(once).toContain('id="kondate-public-lp"');
    expect(once).toContain('name="description"');
    expect(once).toContain('rel="canonical" href="/"');
    expect(once).not.toContain(PUBLIC_LANDING_HEAD_MARK);
    expect(injectPublicLandingHtml(once)).toBe(once);
  });

  it("fails closed on a missing or prefilled mount", () => {
    expect(() => injectPublicLandingHtml("<html></html>")).toThrow(/public_lp_mount_missing/u);
    expect(() =>
      injectPublicLandingHtml(shell.replace(PUBLIC_LANDING_MOUNT, '<div id="kondate-public-lp">x</div>')),
    ).toThrow(/public_lp_mount_not_empty/u);
    expect(() => injectPublicLandingHtml(shell.replace(PUBLIC_LANDING_HEAD_MARK, ""))).toThrow(
      /public_lp_head_mark_missing/u,
    );
  });
});

describe("html sources", () => {
  it("keeps LP mount only on index.html", () => {
    const indexHtml = readFileSync(resolve("index.html"), "utf8");
    const appHtml = readFileSync(resolve("app.html"), "utf8");
    expect(indexHtml).toContain(PUBLIC_LANDING_MOUNT);
    expect(indexHtml).toContain(PUBLIC_LANDING_HEAD_MARK);
    expect(indexHtml).toContain('src="/lp-boot.js"');
    expect(indexHtml).not.toContain("type=\"module\" src=\"/lp-boot.js\"");
    expect(appHtml).not.toContain("kondate-public-lp");
    expect(appHtml).not.toContain("lp-boot.js");
    expect(appHtml).not.toContain('name="description"');
    expect(appHtml).toContain('id="root"');
    expect(appHtml).toContain('src="/src/main.tsx"');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/landing/inject-public-landing-html.test.ts`

Expected: FAIL（モジュールまたは `app.html` 欠落）

- [ ] **Step 3: 最小実装**

`inject-public-landing-html.ts`:

```ts
import { FREE_LP_H1 } from "./free-landing-copy";
import {
  PUBLIC_LANDING_ASSET_PATHS,
  buildPublicLandingHeadHtml,
  buildPublicLandingHtml,
} from "./build-public-landing-html";

export const PUBLIC_LANDING_HEAD_MARK = "<!-- kondate-public-lp-head -->";
export const PUBLIC_LANDING_MOUNT = '<div id="kondate-public-lp"></div>';

export function isPublicLandingIndexFilename(filename: string): boolean {
  return filename.replaceAll("\\", "/").endsWith("/index.html") || filename === "index.html";
}

export function injectPublicLandingHtml(html: string): string {
  if (html.includes('id="kondate-public-lp"') && html.includes(FREE_LP_H1)) {
    return html;
  }
  if (!html.includes('id="kondate-public-lp"')) {
    throw new Error("public_lp_mount_missing");
  }
  if (!html.includes(PUBLIC_LANDING_MOUNT)) {
    throw new Error("public_lp_mount_not_empty");
  }
  if (!html.includes(PUBLIC_LANDING_HEAD_MARK)) {
    throw new Error("public_lp_head_mark_missing");
  }
  const filled = html
    .replace(PUBLIC_LANDING_HEAD_MARK, buildPublicLandingHeadHtml())
    .replace(
      PUBLIC_LANDING_MOUNT,
      `<div id="kondate-public-lp">${buildPublicLandingHtml(PUBLIC_LANDING_ASSET_PATHS)}</div>`,
    );
  if (!filled.includes(FREE_LP_H1)) {
    throw new Error("public_lp_insert_failed");
  }
  if (!filled.includes('name="description"')) {
    throw new Error("public_lp_meta_missing");
  }
  return filled;
}
```

`index.html` の `<head>` 末尾（`</title>` の前でも後でも可、title は残す）に `<!-- kondate-public-lp-head -->` を置く。`<head>` 内の既存メタの後に同期スクリプトを足す:

```html
    <script src="/lp-boot.js"></script>
```

`<body>` は次の順:

```html
    <div id="kondate-public-lp"></div>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
```

`app.html` は現行 `index.html`（変更前）と同じ薄いシェル。LP マウント・boot・description・head 印は置かない。`lang="ja"`、既存 PWA メタ、`#root`、`/src/main.tsx` は同じ。

`vite.config.ts`:

1. `import type { Plugin } from "vite"` は既存。追加:

```ts
import { injectPublicLandingHtml, isPublicLandingIndexFilename } from "./src/features/landing/inject-public-landing-html";
```

2. プラグイン:

```ts
function kondatePublicLandingHtml(): Plugin {
  return {
    name: "kondate-public-landing-html",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (!isPublicLandingIndexFilename(ctx.filename)) {
          return html;
        }
        return injectPublicLandingHtml(html);
      },
    },
  };
}
```

`plugins` 配列の `react()` の直後に置く。

3. 既存 `build: { assetsInlineLimit: 0 }` を次に広げる（`assetsInlineLimit` は残す）:

```ts
  build: {
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        app: fileURLToPath(new URL("./app.html", import.meta.url)),
      },
    },
  },
```

- [ ] **Step 4: テストが通ることを確認**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/landing/inject-public-landing-html.test.ts src/features/landing/build-public-landing-html.test.ts src/features/landing/lp-boot.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/landing/inject-public-landing-html.ts src/features/landing/inject-public-landing-html.test.ts index.html app.html vite.config.ts
git commit -m "feat(seo): / だけLP入りHTMLを出し他は薄いシェルにする"
```

---

### Task 4: robots・Netlify・noindex

**Files:**
- Create: `public/robots.txt`
- Create: `scripts/public-landing-seo.test.mjs`
- Modify: `netlify.toml`（`/*` の `to` だけ）
- Modify: `scripts/csp-headers.mjs`
- Modify: `scripts/csp-headers.test.mjs`
- Modify: `scripts/ci.sh`（`scripts/public-landing-seo.test.mjs` を `csp-headers.test.mjs` の直後に追加）
- Modify: `.github/workflows/ci.yml`（同じ位置に同じファイルを追加）
- Modify: `tests/tooling/project-config.test.mjs`（当該 `.mjs` が ci.sh と workflow の両方に出る assert を、既存 `csp-headers.test.mjs` assert の隣に追加）

**Interfaces:**
- Consumes: なし
- Produces:
  - `public/robots.txt` 全文（末尾改行 1 個は可）:
    ```
    User-agent: *
    Allow: /$
    Disallow: /
    ```
  - `netlify.toml` の `from = "/*"` が `to = "/app.html"`、`status = 200`、同じテーブルに `force` キーなし
  - `buildHeadersFileContent` が `/manifest.webmanifest` ブロックのあと、`/*` の前に
    ```
    /app.html
      X-Robots-Tag: noindex
    ```
  - `/*` には noindex を付けない

- [ ] **Step 1: 失敗するテストを書く**

`scripts/public-landing-seo.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildDeployHeadersFile } from "./csp-headers.mjs";

test("robots.txt allows only the homepage", async () => {
  const body = (await readFile("public/robots.txt", "utf8")).replace(/\n$/u, "");
  assert.equal(body, "User-agent: *\nAllow: /$\nDisallow: /");
});

test("SPA fallback is app.html without force", async () => {
  const toml = await readFile("netlify.toml", "utf8");
  assert.match(toml, /from = "\/\*"\n {2}to = "\/app.html"\n {2}status = 200\n/u);
  assert.doesNotMatch(toml, /to = "\/index.html"/u);
  const fallback = /from = "\/\*"\n(?<block>(?: {2}.*\n)+)/u.exec(toml);
  assert.ok(fallback?.groups?.block);
  assert.doesNotMatch(fallback.groups.block, /force/u);
});

test("app.html is noindexed and the document root is not", () => {
  const headers = buildDeployHeadersFile({ context: "deploy-preview" });
  assert.match(headers, /\/app\.html\n {2}X-Robots-Tag: noindex\n/u);
  assert.doesNotMatch(headers, /\/\*\n {2}X-Robots-Tag/u);
});
```

`scripts/csp-headers.test.mjs` の「production CSP header has no wildcard」の先頭マッチを、`/app.html` ブロックを含む形に更新する:

```js
  assert.match(
    headers,
    /^\/sw\.js\n {2}Cache-Control: no-cache\n {2}Content-Type: text\/javascript; charset=utf-8\n\n\/manifest\.webmanifest\n {2}Content-Type: application\/manifest\+json\n\n\/app\.html\n {2}X-Robots-Tag: noindex\n\n\/\*\n {2}Content-Security-Policy: /u,
  );
```

`tests/tooling/project-config.test.mjs` の `csp-headers.test.mjs` assert の直後:

```js
  assert.match(script, /public-landing-seo\.test\.mjs/u);
  assert.match(workflow, /public-landing-seo\.test\.mjs/u);
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `docker compose run --rm --no-deps app node --test scripts/public-landing-seo.test.mjs`

Expected: FAIL（robots 欠落または `/*` がまだ `/index.html`）

- [ ] **Step 3: 最小実装**

`public/robots.txt` は Step 1 の 3 行。

`netlify.toml` の

```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

を `to = "/app.html"` に変える。`force` は書かない。`/api/emergency-menus` ルールは触らない。

`scripts/csp-headers.mjs` の `buildHeadersFileContent`:

```js
export function buildHeadersFileContent(csp) {
  return `/sw.js
  Cache-Control: no-cache
  Content-Type: text/javascript; charset=utf-8

/manifest.webmanifest
  Content-Type: application/manifest+json

/app.html
  X-Robots-Tag: noindex

/*
  Content-Security-Policy: ${csp}
`;
}
```

`scripts/ci.sh` と `.github/workflows/ci.yml` の `node --test` 列挙に `scripts/public-landing-seo.test.mjs` を `scripts/csp-headers.test.mjs` の次へ入れる。

- [ ] **Step 4: テストが通ることを確認**

Run: `docker compose run --rm --no-deps app node --test scripts/public-landing-seo.test.mjs`

（次の呼び出し、連結しない）

Run: `docker compose run --rm --no-deps app node --test scripts/csp-headers.test.mjs`

（次の呼び出し）

Run: `docker compose run --rm --no-deps app node --test tests/tooling/project-config.test.mjs`

Expected: いずれも PASS

- [ ] **Step 5: Commit**

```bash
git add public/robots.txt netlify.toml scripts/csp-headers.mjs scripts/csp-headers.test.mjs scripts/public-landing-seo.test.mjs scripts/ci.sh .github/workflows/ci.yml tests/tooling/project-config.test.mjs
git commit -m "feat(seo): / 以外を索引しない配信とrobotsを追加"
```

---

### Task 5: Service Worker に `/lp-boot.js`

**Files:**
- Modify: `scripts/generate-service-worker.mjs`（`FIXED_PRECACHE_URLS` のみ）
- Modify: `scripts/generate-service-worker.test.mjs`
- Modify: `scripts/ci.sh`（`scripts/generate-service-worker.test.mjs` を `node --test` 列挙へ追加。まだ無ければ `public-landing-seo.test.mjs` の次）
- Modify: `.github/workflows/ci.yml`（同じ）
- Modify: `tests/tooling/project-config.test.mjs`（両方に `generate-service-worker.test.mjs` が出る assert）

**Interfaces:**
- Consumes: Task 2 の `public/lp-boot.js`（ビルド時に `dist/lp-boot.js` へコピーされる）
- Produces: `FIXED_PRECACHE_URLS` に `"/lp-boot.js"` を含む。`"/"` は残す。`"/index.html"` と `"/app.html"` は入れない

- [ ] **Step 1: 失敗するテストを書く**

`scripts/generate-service-worker.test.mjs`:

1. `expectedPrecacheUrls` に `"/lp-boot.js"` を localeCompare 順で入れる（`/icons/icon-512.png` の次、`/manifest.webmanifest` の前）。
2. `writeFixtureDist` が `dist/lp-boot.js` に `document.documentElement.classList.add("kondate-js");` を書く。
3. `assert.ok(!urls.includes("/app.html"));` を既存の `/index.html` 否定の隣に足す。
4. digest テストの `contentByUrl` に `"/lp-boot.js": "document.documentElement.classList.add(\"kondate-js\");"` を足す。
5. 新規テスト: fixture から `lp-boot.js` を書かない場合 `generateServiceWorker` が `/sw_precache_file_missing/` で reject する。
6. 新規テスト: `lp-boot.js` のバイトを変えると `CACHE_NAME` が変わる。

- [ ] **Step 2: テストが失敗することを確認**

Run: `docker compose run --rm --no-deps app node --test scripts/generate-service-worker.test.mjs`

Expected: FAIL（`expectedPrecacheUrls` に `/lp-boot.js` が無い、または digest の `contentByUrl` 欠落）

- [ ] **Step 3: 最小実装**

`FIXED_PRECACHE_URLS`:

```js
export const FIXED_PRECACHE_URLS = Object.freeze([
  "/",
  "/manifest.webmanifest",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
  "/lp-boot.js",
]);
```

`/` の中身は今どおり `dist/index.html` のバイト。`readNonHashedBytes` の分岐は変えない。`/lp-boot.js` は既存のファイル読み経路で足りる。

- [ ] **Step 4: テストが通ることを確認**

Run: `docker compose run --rm --no-deps app node --test scripts/generate-service-worker.test.mjs`

（次の呼び出し）

Run: `docker compose run --rm --no-deps app node --test tests/tooling/project-config.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-service-worker.mjs scripts/generate-service-worker.test.mjs scripts/ci.sh .github/workflows/ci.yml tests/tooling/project-config.test.mjs
git commit -m "fix(pwa): 静的LP起動スクリプトをシェルprecacheに含める"
```

---

### Task 6: 回帰と焦点 E2E

**Files:**
- Create: `e2e/specs/public-landing.spec.ts`
- Verify only（変更不要なら触らない）: `src/features/landing/root-gate-page.test.tsx`、`src/features/landing/free-landing-page.test.tsx`、`src/features/auth/login-page.test.tsx`

**Interfaces:**
- Consumes: Task 2–3 の `#kondate-public-lp` と React `FREE_LP_H1`
- Produces: 未ログイン `/` の E2E。`@smoke` は付けない（smoke 必須セットを広げない）

- [ ] **Step 1: 失敗するテストを書く**

`e2e/specs/public-landing.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("unauthenticated home shows the free landing and hides static SEO copy", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "今日の献立、家族に合わせて。" }),
  ).toBeVisible();
  const staticLp = page.locator("#kondate-public-lp");
  await expect(staticLp).toHaveCount(1);
  await expect(staticLp).not.toBeVisible();
  await page.getByRole("link", { name: "無料ではじめる" }).first().click();
  await expect(page).toHaveURL(/\/login(\?|$)/u);
});
```

ローカル Vite は `/` に `index.html` を出すので、マウントは 1 つある。JS ありでは見えない。見出しは React 側（`display:none` の静的 h1 は getByRole に出ない）。

- [ ] **Step 2: ユニット回帰を先に通す**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/landing/free-landing-page.test.ts src/features/landing/root-gate-page.test.tsx src/features/landing/build-public-landing-html.test.ts src/features/landing/inject-public-landing-html.test.ts src/features/landing/lp-boot.test.ts src/pwa/service-worker-routing.test.ts`

Expected: PASS

- [ ] **Step 3: format / lint / typecheck**

それぞれ独立した呼び出し:

Run: `docker compose run --rm --no-deps app npm run format:check`

Run: `docker compose run --rm --no-deps app npm run lint`

Run: `docker compose run --rm --no-deps app npm run typecheck`

Expected: いずれも PASS。format だけ落ちたら `format:check` が指すファイルだけ直し、`format` 全体は回さない。

- [ ] **Step 4: 焦点 E2E**

フルスイートは回さない。ホストで:

```bash
./scripts/run-e2e.sh e2e/specs/public-landing.spec.ts
```

Expected: 当該 spec が mobile/desktop で PASS。エージェントが Compose e2e を回せない／ログが大きすぎる場合は、人間に同じコマンドを依頼して要約だけ受け取る。

- [ ] **Step 5: Commit**

```bash
git add e2e/specs/public-landing.spec.ts
git commit -m "test(seo): 未ログインLPで静的コピーが見えないことを固定する"
```

---

## Self-review

| Spec | Task |
| --- | --- |
| `/` の最初の HTML に LP 本文 | 1 + 3 |
| JS ありでは見せない | 2 + 6 |
| 他パスは薄いシェル | 3 + 4 |
| `FREE_LP_*` 単一正本・文言変更なし | 1 |
| エスケープ | 1 `escapeHtml` |
| description / OGP 最小 / 相対 canonical | 1 head + 3 inject |
| sitemap / og:url / og:image なし | 1 head テスト |
| robots `Allow: /$` | 4 |
| `/app.html` noindex、`/*` に noindex なし | 4 |
| `/*` → `/app.html`、`force` なし | 4 |
| SW `/` + `/lp-boot.js`、`/index.html` `/app.html` なし | 5 |
| 挿入失敗でビルド失敗 | 3 throw |
| `app.html` 欠落でビルド失敗 | Vite `input.app` |
| RootGate / Auth 非変更 | 1 再 export のみ、6 回帰 |
| CSP 非緩和 | 4 既存 tooling、インラインなし |
| 焦点 E2E | 6 |
| 実 Googlebot / 全スイート | やらない |
