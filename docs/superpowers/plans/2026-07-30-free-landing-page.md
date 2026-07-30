# 無料訴求ランディングページ（ログイン前 LP） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 未ログインで `/` を開いた新規ユーザーに、無料で使える家族・献立・冷蔵庫の価値をカード型 LP で伝え、「無料ではじめる」から `/login` へ導く。ログイン済みの `/` は従来どおり `RootEntryPage`。

**Architecture:** 公開ルート `/` に `RootGatePage` を置き、`useAuth` の State matrix だけで FreeLanding / RootEntry を fail-closed 分岐する。マーケ UI は `src/features/landing/` に閉じ、billing・entitlement・保護 API に触れない。Plus LP と同系の terracotta カード UI + 同一オリジン webp 4 枚。

**Tech Stack:** React 19 / React Router 8 / TypeScript strict / Vitest / RTL / Vite 静的アセット / Tailwind 既存 utility + 専用 CSS

**仕様書:** `docs/superpowers/specs/2026-07-30-free-landing-page-design.md`（Review-ready / R1 反映済み）  
**対比:** `docs/superpowers/specs/2026-07-30-plus-landing-page-design.md`（混同禁止）

## Global Constraints

- Node.js `>=24 <25`。Node/npm は `docker compose run --rm --no-deps app ...`。**コマンドを `&&` / `;` で連結しない**（1 コマンド = 1 ツール呼び出し）。
- 各 Task は RED → GREEN → 対象検証 → レビュー → **日本語 Conventional Commit**。1 Task = 1 作業単位。
- UI 文言・コメント・コミットは日本語。識別子・テスト名は英語。`any` / 未検査 cast 禁止。
- 320 CSS px・44×44（`min-h-11`）・横スクロールなし。**新カラー体系禁止**（既存 terracotta / cream / surface）。
- 設計 L1–L17 を再導出せず実装する（特に L6 Plus 非表示、L8/L7 禁止語、L13 Gate 単一配置、L14 fail-closed、L15 sticky なし、L16 logout 着地維持）。
- `FreeLandingPage` / `RootGate` は **billing・entitlement・household/pantry/generate API を import しない**。
- `git push` / PR / 本番デプロイ / `--no-verify` 禁止。
- **E2E（Task 5）は Task 1–4 完了後、かつ人間が明示したときだけ。** 既定では defer。
- E2E `authenticatedPage` のログイン後 `goto("/")` → `/welcome` は **壊さない**（ログイン済み RootEntry 経路）。

## Locked interfaces produced by this plan

| 名前 | 場所 | 契約 |
|------|------|------|
| コピー定数 | `src/features/landing/free-landing-page.tsx` | 下表 `FREE_LP_*` を named export。テスト exact |
| `FreeLandingPage` | 同上 | named export。props なし。API 非呼び出し |
| `RootGatePage` | `src/features/landing/root-gate-page.tsx` | named export。State matrix のみ。**auth/ に二重実装しない** |
| 画像 4 枚 | `src/features/landing/assets/free-*.webp` | パス固定（設計 L10） |
| ルート `/` | `src/app/router.tsx` | **public**。祖先に `RequireSession` なし |

### コピー定数（一字固定）

```ts
// free-landing-page.tsx から export（テスト exact 用）
export const FREE_LP_BRAND = "こんだて日和" as const;
export const FREE_LP_H1 = "今日の献立、家族に合わせて。" as const;
export const FREE_LP_LEAD =
  "無料で、家族の好みや食材に寄り添った献立づくり。" as const;
export const FREE_LP_CTA = "無料ではじめる" as const;
export const FREE_LP_LOGIN = "ログイン" as const;
export const FREE_LP_FAMILY_TITLE = "家族の好みを登録できる" as const;
export const FREE_LP_FAMILY_BODY =
  "年齢・苦手なもの・アレルギーを登録して、献立の条件に使えます" as const;
export const FREE_LP_MENU_TITLE = "予算と時間に合わせて作成" as const;
export const FREE_LP_MENU_BODY =
  "今日の予算や調理時間を指定して、一食の献立を作れます" as const;
export const FREE_LP_PANTRY_TITLE = "冷蔵庫の食材から考える" as const;
export const FREE_LP_PANTRY_BODY =
  "食材リストを登録して、使い切りやすい献立につなげます" as const;
export const FREE_LP_CLOSING = "まずは無料ではじめられます" as const;
export const FREE_LP_EXISTING = "すでにアカウントがある方は" as const;
```

### RootGate State matrix（唯一の分岐）

```ts
// 擬似コード。実装は root-gate-page.tsx 内
// 1. status === "loading" → <main className="page-frame">ログイン状態を確認しています…</main>
// 2. status === "unauthenticated" || session === null → <FreeLandingPage />
// 3. else (authenticated && session) → <RootEntryPage />
```

loading 文言は `RequireSession` と **一字同一**: `ログイン状態を確認しています…`

### 禁止語（unit が textContent で検出）

`Plus`, `plus`（可視テキスト。className の `free-landing` は可）, `安全`, `絶対`, `保証`, `無制限`, `何回でも`

## File Structure

| ファイル | 責務 |
|----------|------|
| `src/features/landing/free-landing-page.tsx` | マーケ LP UI + コピー定数 export |
| `src/features/landing/free-landing-page.css` | `.free-landing*` レイアウト |
| `src/features/landing/free-landing-page.test.tsx` | 構成・CTA・禁止語・h1 単一 |
| `src/features/landing/root-gate-page.tsx` | auth 分岐 |
| `src/features/landing/root-gate-page.test.tsx` | matrix 3 分岐 |
| `src/features/landing/assets/free-hero.webp` | ヒーロー |
| `src/features/landing/assets/free-benefit-family.webp` | 家族カード |
| `src/features/landing/assets/free-benefit-menu.webp` | 献立カード |
| `src/features/landing/assets/free-benefit-pantry.webp` | 冷蔵庫カード |
| `src/app/router.tsx` | `/` を public + RootGate。RequireSession 子から `/` を除去 |
| `src/app/router.test.tsx` | `/` が RequireSession 外 |

**触らない（意図的）:** `login-page.tsx` の returnTo 既定 `/welcome`、`account-settings-section` の logout URL、`plus-landing-*`、`billing-*`、E2E fixtures のログイン後期待（Task 5 以外）。

---

### Task 1: FreeLandingPage（コピー・3 カード・CTA・禁止語テスト）

**Files:**
- Create: `src/features/landing/free-landing-page.tsx`
- Create: `src/features/landing/free-landing-page.css`
- Create: `src/features/landing/free-landing-page.test.tsx`
- Create: `src/features/landing/assets/free-hero.webp`
- Create: `src/features/landing/assets/free-benefit-family.webp`
- Create: `src/features/landing/assets/free-benefit-menu.webp`
- Create: `src/features/landing/assets/free-benefit-pantry.webp`
- Test: `src/features/landing/free-landing-page.test.tsx`

**Interfaces:**
- Consumes: なし（`react-router` の `Link` のみ）
- Produces: `FreeLandingPage`、全 `FREE_LP_*` 定数、4 webp パス

- [ ] **Step 1: 最小 webp プレースホルダを 4 枚置く**

ホストで（アセットはバイナリ。後続 Task 3 で差し替え可）:

```bash
mkdir -p src/features/landing/assets
# 1x1 近似の最小 WebP（同一バイトを 4 ファイルに）
python3 - <<'PY'
import base64, pathlib
b = base64.b64decode("UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=")
root = pathlib.Path("src/features/landing/assets")
for name in (
    "free-hero.webp",
    "free-benefit-family.webp",
    "free-benefit-menu.webp",
    "free-benefit-pantry.webp",
):
    (root / name).write_bytes(b)
print("ok", len(b))
PY
```

Expected: 4 ファイル存在。

- [ ] **Step 2: 失敗テストを書く**

`src/features/landing/free-landing-page.test.tsx`（このファイル全文）:

```tsx
import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it } from "vitest";
import {
  FREE_LP_BRAND,
  FREE_LP_CLOSING,
  FREE_LP_CTA,
  FREE_LP_EXISTING,
  FREE_LP_FAMILY_BODY,
  FREE_LP_FAMILY_TITLE,
  FREE_LP_H1,
  FREE_LP_LEAD,
  FREE_LP_LOGIN,
  FREE_LP_MENU_BODY,
  FREE_LP_MENU_TITLE,
  FREE_LP_PANTRY_BODY,
  FREE_LP_PANTRY_TITLE,
  FreeLandingPage,
} from "./free-landing-page";

function renderLp() {
  const router = createMemoryRouter(
    [
      { path: "/", element: <FreeLandingPage /> },
      { path: "/login", element: <h1>ログイン画面</h1> },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const FORBIDDEN = ["Plus", "plus", "安全", "絶対", "保証", "無制限", "何回でも"] as const;

describe("FreeLandingPage", () => {
  it("renders single h1, brand not as heading, three cards in order, and CTAs to /login", () => {
    renderLp();
    expect(screen.getByRole("heading", { level: 1, name: FREE_LP_H1 })).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText(FREE_LP_BRAND)).toBeVisible();
    expect(screen.queryByRole("heading", { name: FREE_LP_BRAND })).not.toBeInTheDocument();
    expect(screen.getByText(FREE_LP_LEAD)).toBeVisible();

    const cards = screen.getByRole("list", { name: "できること" });
    const items = within(cards).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(
      within(items[0]!).getByRole("heading", { level: 2, name: FREE_LP_FAMILY_TITLE }),
    ).toBeVisible();
    expect(within(items[0]!).getByText(FREE_LP_FAMILY_BODY)).toBeVisible();
    expect(
      within(items[1]!).getByRole("heading", { level: 2, name: FREE_LP_MENU_TITLE }),
    ).toBeVisible();
    expect(within(items[1]!).getByText(FREE_LP_MENU_BODY)).toBeVisible();
    expect(
      within(items[2]!).getByRole("heading", { level: 2, name: FREE_LP_PANTRY_TITLE }),
    ).toBeVisible();
    expect(within(items[2]!).getByText(FREE_LP_PANTRY_BODY)).toBeVisible();

    expect(screen.getByText(FREE_LP_CLOSING)).toBeVisible();
    expect(screen.getByText(FREE_LP_EXISTING)).toBeVisible();

    const startLinks = screen.getAllByRole("link", { name: FREE_LP_CTA });
    expect(startLinks.length).toBeGreaterThanOrEqual(2);
    for (const link of startLinks) {
      expect(link).toHaveAttribute("href", "/login");
    }
    const loginLinks = screen.getAllByRole("link", { name: FREE_LP_LOGIN });
    expect(loginLinks.length).toBeGreaterThanOrEqual(1);
    for (const link of loginLinks) {
      expect(link).toHaveAttribute("href", "/login");
    }
  });

  it("does not include forbidden marketing or safety guarantee words", () => {
    renderLp();
    const text = document.body.textContent ?? "";
    for (const word of FORBIDDEN) {
      expect(text).not.toContain(word);
    }
  });

  it("uses empty alt on decorative images", () => {
    renderLp();
    const imgs = document.querySelectorAll("main img");
    expect(imgs.length).toBe(4);
    for (const img of imgs) {
      expect(img.getAttribute("alt")).toBe("");
    }
  });
});
```

- [ ] **Step 3: RED を確認**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/landing/free-landing-page.test.tsx
```

Expected: FAIL（module not found または export なし）

- [ ] **Step 4: `free-landing-page.css` を追加**

```css
/* 無料 LP。新色トークンは増やさず既存 surface / card を使う。sticky CTA なし */

.free-landing {
  padding-bottom: 2.5rem;
}

.free-landing__brand {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.free-landing__lead {
  font-size: 1.125rem;
}

.free-landing__hero-img {
  display: block;
  width: 100%;
  max-width: 100%;
  height: auto;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--section-tint, #f6f6f4) 70%, #e8e4df);
}

.free-landing__card-img {
  display: block;
  width: 100%;
  max-width: 100%;
  height: auto;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--section-tint, #f6f6f4) 70%, #e8e4df);
}

.free-landing__cards {
  list-style: none;
  margin: 0;
  padding: 0;
}

.free-landing__cta-row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.75rem;
}

.free-landing__login-link {
  text-align: center;
}
```

- [ ] **Step 5: `FreeLandingPage` を実装**

`src/features/landing/free-landing-page.tsx`:

```tsx
import { Link } from "react-router";
import heroUrl from "./assets/free-hero.webp";
import familyUrl from "./assets/free-benefit-family.webp";
import menuUrl from "./assets/free-benefit-menu.webp";
import pantryUrl from "./assets/free-benefit-pantry.webp";
import "./free-landing-page.css";

export const FREE_LP_BRAND = "こんだて日和" as const;
export const FREE_LP_H1 = "今日の献立、家族に合わせて。" as const;
export const FREE_LP_LEAD =
  "無料で、家族の好みや食材に寄り添った献立づくり。" as const;
export const FREE_LP_CTA = "無料ではじめる" as const;
export const FREE_LP_LOGIN = "ログイン" as const;
export const FREE_LP_FAMILY_TITLE = "家族の好みを登録できる" as const;
export const FREE_LP_FAMILY_BODY =
  "年齢・苦手なもの・アレルギーを登録して、献立の条件に使えます" as const;
export const FREE_LP_MENU_TITLE = "予算と時間に合わせて作成" as const;
export const FREE_LP_MENU_BODY =
  "今日の予算や調理時間を指定して、一食の献立を作れます" as const;
export const FREE_LP_PANTRY_TITLE = "冷蔵庫の食材から考える" as const;
export const FREE_LP_PANTRY_BODY =
  "食材リストを登録して、使い切りやすい献立につなげます" as const;
export const FREE_LP_CLOSING = "まずは無料ではじめられます" as const;
export const FREE_LP_EXISTING = "すでにアカウントがある方は" as const;

/**
 * 未ログイン向け無料訴求 LP（設計 2026-07-30）。
 * API / entitlement / Plus に触れない。CTA は /login のみ（returnTo なし）。
 */
export function FreeLandingPage() {
  return (
    <main className="page-frame free-landing stack gap-4">
      <p className="free-landing__brand">{FREE_LP_BRAND}</p>

      <div className="free-landing__hero stack gap-2">
        <img
          src={heroUrl}
          alt=""
          width={1280}
          height={720}
          className="free-landing__hero-img"
          decoding="async"
        />
        <h1>{FREE_LP_H1}</h1>
        <p className="free-landing__lead">{FREE_LP_LEAD}</p>
        <div className="free-landing__cta-row">
          <Link className="primary-button min-h-11" to="/login">
            {FREE_LP_CTA}
          </Link>
          <Link className="secondary-button min-h-11 free-landing__login-link" to="/login">
            {FREE_LP_LOGIN}
          </Link>
        </div>
      </div>

      <ul className="free-landing__cards stack gap-3" aria-label="できること">
        <li className="free-landing__card card stack gap-2">
          <img
            src={familyUrl}
            alt=""
            width={640}
            height={640}
            className="free-landing__card-img"
            decoding="async"
          />
          <h2>{FREE_LP_FAMILY_TITLE}</h2>
          <p>{FREE_LP_FAMILY_BODY}</p>
        </li>
        <li className="free-landing__card card stack gap-2">
          <img
            src={menuUrl}
            alt=""
            width={640}
            height={640}
            className="free-landing__card-img"
            decoding="async"
          />
          <h2>{FREE_LP_MENU_TITLE}</h2>
          <p>{FREE_LP_MENU_BODY}</p>
        </li>
        <li className="free-landing__card card stack gap-2">
          <img
            src={pantryUrl}
            alt=""
            width={640}
            height={640}
            className="free-landing__card-img"
            decoding="async"
          />
          <h2>{FREE_LP_PANTRY_TITLE}</h2>
          <p>{FREE_LP_PANTRY_BODY}</p>
        </li>
      </ul>

      <section className="stack gap-2" aria-labelledby="free-lp-closing">
        <p id="free-lp-closing">{FREE_LP_CLOSING}</p>
        <Link className="primary-button min-h-11" to="/login">
          {FREE_LP_CTA}
        </Link>
        <p className="type-small">{FREE_LP_EXISTING}</p>
        <Link className="secondary-button min-h-11 free-landing__login-link" to="/login">
          {FREE_LP_LOGIN}
        </Link>
      </section>
    </main>
  );
}
```

- [ ] **Step 6: GREEN を確認**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/landing/free-landing-page.test.tsx
```

Expected: PASS

- [ ] **Step 7: typecheck / lint / format:check（対象範囲で可。全体でも可）**

Run（各コマンド独立）:

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npm run lint
```

```bash
docker compose run --rm --no-deps app npm run format:check
```

Expected: いずれも成功。失敗したら Task 1 範囲で修正。

- [ ] **Step 8: Commit**

```bash
git add src/features/landing/free-landing-page.tsx \
  src/features/landing/free-landing-page.css \
  src/features/landing/free-landing-page.test.tsx \
  src/features/landing/assets/free-hero.webp \
  src/features/landing/assets/free-benefit-family.webp \
  src/features/landing/assets/free-benefit-menu.webp \
  src/features/landing/assets/free-benefit-pantry.webp
git commit -m "$(cat <<'EOF'
feat: 無料訴求 LP の UI とコピーを追加する

未ログイン向けヒーロー・3 カード・/login CTA と禁止語テストを載せる。
EOF
)"
```

---

### Task 2: RootGatePage + `/` を public 化

**Files:**
- Create: `src/features/landing/root-gate-page.tsx`
- Create: `src/features/landing/root-gate-page.test.tsx`
- Modify: `src/app/router.tsx`
- Modify: `src/app/router.test.tsx`
- Test: 上記 + Task 1 の LP テスト回帰

**Interfaces:**
- Consumes: `useAuth`、`RootEntryPage`、`FreeLandingPage`（Task 1）
- Produces: `RootGatePage`；router 上の `/` が public

- [ ] **Step 1: Gate の失敗テストを書く**

`src/features/landing/root-gate-page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useAuthMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth/use-auth", () => ({ useAuth: useAuthMock }));
vi.mock("@/features/auth/root-entry-page", () => ({
  RootEntryPage: () => <h1>RootEntry stub</h1>,
}));
vi.mock("./free-landing-page", async () => {
  const actual = await vi.importActual<typeof import("./free-landing-page")>("./free-landing-page");
  return {
    ...actual,
    FreeLandingPage: () => <h1>{actual.FREE_LP_H1}</h1>,
  };
});

import { FREE_LP_H1 } from "./free-landing-page";
import { RootGatePage } from "./root-gate-page";

function renderGate() {
  const router = createMemoryRouter([{ path: "/", element: <RootGatePage /> }], {
    initialEntries: ["/"],
  });
  render(<RouterProvider router={router} />);
}

describe("RootGatePage", () => {
  beforeEach(() => {
    useAuthMock.mockReset();
  });

  it("shows session check copy while loading and neither landing nor entry", () => {
    useAuthMock.mockReturnValue({
      status: "loading",
      session: null,
      refreshSession: vi.fn(),
    });
    renderGate();
    expect(screen.getByText("ログイン状態を確認しています…")).toBeVisible();
    expect(screen.queryByRole("heading", { name: FREE_LP_H1 })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "RootEntry stub" })).not.toBeInTheDocument();
  });

  it("shows free landing when unauthenticated", () => {
    useAuthMock.mockReturnValue({
      status: "unauthenticated",
      session: null,
      refreshSession: vi.fn(),
    });
    renderGate();
    expect(screen.getByRole("heading", { name: FREE_LP_H1 })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "RootEntry stub" })).not.toBeInTheDocument();
  });

  it("shows free landing when session is null even if status is not unauthenticated", () => {
    // fail-closed: session null → LP（設計 L14）
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: null,
      refreshSession: vi.fn(),
    });
    renderGate();
    expect(screen.getByRole("heading", { name: FREE_LP_H1 })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "RootEntry stub" })).not.toBeInTheDocument();
  });

  it("shows RootEntry when authenticated with session", () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      session: { user: { id: "72000000-0000-4000-8000-000000000001" } },
      refreshSession: vi.fn(),
    });
    renderGate();
    expect(screen.getByRole("heading", { name: "RootEntry stub" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: FREE_LP_H1 })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: router テストを更新する（失敗確認）**

`src/app/router.test.tsx` の次のケースを **置き換え**:

旧:

```ts
  it("/ は RootEntryPage を経由してprofile statusに応じて振り分ける（route自体はRequireSession配下）", () => {
    const router = createAppRouter();
    const ancestors = findAncestorElementTypes(router.routes, "/");
    expect(ancestors).toContain(RequireSession);
    router.dispose();
  });
```

新:

```ts
  it("/ は public の RootGatePage で、RequireSession 配下にない", () => {
    const router = createAppRouter();
    const ancestors = findAncestorElementTypes(router.routes, "/");
    expect(ancestors).toBeDefined();
    expect(ancestors).not.toContain(RequireSession);
    const route = findRoute(router.routes, "/");
    expect(route?.element).toBeDefined();
    // RootGatePage を element に載せた型一致
    const { RootGatePage } = require("@/features/landing/root-gate-page") as typeof import("@/features/landing/root-gate-page");
    expect((route?.element as ReactElement).type).toBe(RootGatePage);
    router.dispose();
  });
```

**ESM プロジェクトでは `require` 禁止。** 次を正とする:

```ts
import type { ReactElement } from "react";
import { RootGatePage } from "@/features/landing/root-gate-page";
// ファイル先頭の既存 import 群に RootGatePage を追加

  it("/ は public の RootGatePage で、RequireSession 配下にない", () => {
    const router = createAppRouter();
    const ancestors = findAncestorElementTypes(router.routes, "/");
    expect(ancestors).toBeDefined();
    expect(ancestors).not.toContain(RequireSession);
    const route = findRoute(router.routes, "/");
    expect(route?.element).toBeDefined();
    expect((route?.element as ReactElement).type).toBe(RootGatePage);
    router.dispose();
  });
```

- [ ] **Step 3: RED を確認**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/landing/root-gate-page.test.tsx src/app/router.test.tsx
```

Expected: Gate は module not found、router は assertion 失敗。

- [ ] **Step 4: `RootGatePage` を実装**

`src/features/landing/root-gate-page.tsx`:

```tsx
import { RootEntryPage } from "@/features/auth/root-entry-page";
import { useAuth } from "@/features/auth/use-auth";
import { FreeLandingPage } from "./free-landing-page";

const SESSION_CHECK_COPY = "ログイン状態を確認しています…" as const;

/**
 * 公開 `/` のゲート（設計 2026-07-30 L13–L14）。
 * loading → 確認文のみ。session なし → FreeLanding。authenticated+session → RootEntry。
 */
export function RootGatePage() {
  const auth = useAuth();

  if (auth.status === "loading") {
    return <main className="page-frame">{SESSION_CHECK_COPY}</main>;
  }

  if (auth.status === "unauthenticated" || auth.session === null) {
    return <FreeLandingPage />;
  }

  return <RootEntryPage />;
}
```

- [ ] **Step 5: `router.tsx` を更新**

`createAppRouter` 内:

1. 先頭の public ルート群に `/` を追加:

```tsx
import { RootGatePage } from "@/features/landing/root-gate-page";
```

```tsx
return createBrowserRouter([
  {
    path: "/login",
    lazy: async () => {
      const { LoginPage } = await import("@/features/auth/login-page");
      return { Component: LoginPage };
    },
  },
  {
    path: "/auth/callback",
    lazy: async () => {
      const { AuthCallbackPage } = await import("@/features/auth/auth-callback-page");
      return { Component: AuthCallbackPage };
    },
  },
  {
    path: "/",
    element: <RootGatePage />,
  },
  {
    element: <RequireSession />,
    children: [
      // { path: "/", element: <RootEntryPage /> },  ← 削除
      {
        path: "/welcome",
        // ... 以下既存のまま
```

2. **削除:** `import { RootEntryPage } from "@/features/auth/root-entry-page";`（router から未使用なら）。RootEntry は Gate 経由のみ。

- [ ] **Step 6: GREEN**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/landing/root-gate-page.test.tsx src/app/router.test.tsx src/features/landing/free-landing-page.test.tsx
```

Expected: PASS

- [ ] **Step 7: typecheck / lint / format:check**

各コマンド独立で実行。Expected: 成功。

- [ ] **Step 8: Commit**

```bash
git add src/features/landing/root-gate-page.tsx \
  src/features/landing/root-gate-page.test.tsx \
  src/app/router.tsx \
  src/app/router.test.tsx
git commit -m "$(cat <<'EOF'
feat: 未ログインの / を無料 LP にゲートする

RootGate で auth を fail-closed 分岐し、/ を RequireSession 外の public にする。
EOF
)"
```

---

### Task 3: イラスト差し替えとビジュアル仕上げ

**Files:**
- Modify: `src/features/landing/assets/free-*.webp`（4 枚を本番トーンのイラストへ）
- Modify: `src/features/landing/free-landing-page.css`（必要なら余白・階層のみ。新色禁止）
- Test: Task 1–2 の unit 回帰（コピー・構造は変えない）

**Interfaces:**
- Consumes: Task 1 のパス・ファイル名
- Produces: 各 ≤150KB 目安の webp。見た目のみ

- [ ] **Step 1: イラスト 4 枚を生成または用意する**

制約（設計 L10 / L9）:

- 温かいキッチン／食卓。terracotta・cream と衝突しない
- 実在人物の特定描写なし。アレルギー表示の断定・個人情報なし
- 同一オリジンのみ。外部 CDN 禁止
- 目安各 ≤ 150KB WebP
- ファイル名は **変更しない**（パスロック）

生成手段: 実装エージェントが Imagine / 既存 Plus LP トーンに合わせた画像生成を使い、上記パスへ上書き保存。生成不可ならプレースホルダのまま Task を `DONE_WITH_CONCERNS` とし、人間差し替えを報告（パスと import は維持）。

- [ ] **Step 2: CSS を仕上げる（任意の微調整のみ）**

許可:

- `gap` / `padding` / `border-radius` の調整
- h1 の `font-size`（モバイル折り返し可の範囲）

禁止:

- 新 CSS 変数の色体系
- sticky CTA（L15）
- Plus へのリンクやバッジ

- [ ] **Step 3: 回帰テスト**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/landing/
```

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npm run format:check
```

Expected: PASS

- [ ] **Step 4: ファイルサイズ確認**

```bash
python3 - <<'PY'
from pathlib import Path
root = Path("src/features/landing/assets")
for p in sorted(root.glob("free-*.webp")):
    kb = p.stat().st_size / 1024
    print(f"{p.name}: {kb:.1f} KB")
    if kb > 150:
        raise SystemExit(f"too large: {p}")
print("ok")
PY
```

Expected: `ok`（目安超過時は再圧縮。やむを得ず 150 超なら Concerns で報告）

- [ ] **Step 5: Commit**

```bash
git add src/features/landing/assets/ src/features/landing/free-landing-page.css
git commit -m "$(cat <<'EOF'
feat: 無料 LP にイラストとビジュアルを載せる

ヒーローと 3 カードの webp を差し替え、余白を整える。
EOF
)"
```

---

### Task 4: 横断検証（回帰・静的解析）

**Files:**
- 変更なし（失敗時のみ Task 1–3 範囲で修正コミット）

**Interfaces:**
- Consumes: Task 1–3 成果物
- Produces: 検証グリーンの証跡

- [ ] **Step 1: landing + router + root-entry + protected-routes + login の unit**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/landing/ src/app/router.test.tsx src/features/auth/root-entry-page.test.tsx src/features/auth/protected-routes.test.tsx src/features/auth/login-page.test.tsx
```

Expected: PASS  
注: `root-entry-page.test` は直接 `RootEntryPage` をマウントしており **Gate 非経由**のため従来どおり通る想定。

- [ ] **Step 2: typecheck**

```bash
docker compose run --rm --no-deps app npm run typecheck
```

- [ ] **Step 3: lint**

```bash
docker compose run --rm --no-deps app npm run lint
```

- [ ] **Step 4: format:check**

```bash
docker compose run --rm --no-deps app npm run format:check
```

- [ ] **Step 5: 変更があれば fix コミット、なければコミット不要**

```bash
git status --short
```

修正時のみ:

```bash
git add <files>
git commit -m "fix: 無料 LP 横断検証の指摘を直す"
```

- [ ] **Step 6: 設計チェックリスト（手動・レビュー用）**

| 設計項目 | 確認 |
|----------|------|
| L1 `/` 未ログイン LP | Gate unauth テスト |
| L2 ログイン済み RootEntry | Gate auth テスト + root-entry 既存 |
| L3/L4 CTA `/login` クエリなし | free-landing テスト href |
| L5 カード 3・順 | free-landing テスト |
| L6 Plus なし | 禁止語テスト |
| L7/L8 禁止語 | 禁止語テスト |
| L11 AppShell なし | router で `/` が shell 外 |
| L12 保護ルート | protected-routes 既存 |
| L13–L14 Gate | root-gate テスト |
| L15 sticky なし | CSS に sticky 無し |
| L16 logout | コード変更なし |
| L17 brand ≠ h1 | free-landing テスト |

---

### Task 5: E2E 1 本（**ゲート — 人間明示時のみ**）

**前提:** Task 1–4 完了。人間が「E2E を実行して」と明示。既知の全スイート赤がある場合は開始しない。

**Files:**
- Create: `e2e/specs/free-landing.spec.ts`（任意）
- Modify: `e2e/fixtures/auth.ts` のコメントのみ（任意・明確化）

**Interfaces:**
- Consumes: 公開 `/` → LP → `/login`
- Produces: 未ログイン導線の E2E 1 本

- [ ] **Step 1: 仕様テストを書く**

`e2e/specs/free-landing.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test.describe("free landing (unauthenticated)", () => {
  test("shows free LP on / and navigates to login", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "今日の献立、家族に合わせて。" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "無料ではじめる" }).first().click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading").first()).toBeVisible();
  });
});
```

- [ ] **Step 2: （任意）fixtures コメント更新**

`e2e/fixtures/auth.ts` の `goto("/")` 付近に 1 行:

```ts
// 未ログインの / は無料 LP。この fixture はログイン済みのため RootEntry → /welcome のまま。
```

- [ ] **Step 3: E2E 実行は人間または `./scripts/run-e2e.sh` 経由**

エージェントは全スイートを勝手に回さない。人間指示時:

```bash
./scripts/run-e2e.sh
```

またはプロジェクト慣例に従い free-landing のみに絞れるならそのオプション。

- [ ] **Step 4: Commit（E2E を追加した場合）**

```bash
git add e2e/specs/free-landing.spec.ts e2e/fixtures/auth.ts
git commit -m "$(cat <<'EOF'
test: 未ログイン無料 LP の E2E を追加する

/ からログインへ進む導線を 1 本固定する。
EOF
)"
```

---

## Plan Self-Review

### Spec coverage

| 設計 | Task |
|------|------|
| FreeLanding UI・コピー・禁止語 | Task 1 |
| 画像パス 4 枚 | Task 1 プレースホルダ → Task 3 本番 |
| RootGate matrix | Task 2 |
| `/` public・router test | Task 2 |
| CSS・イラスト | Task 1 骨格 + Task 3 |
| 横断検証 | Task 4 |
| E2E | Task 5（ゲート） |
| L16 logout 非変更 | 全 Task で触らない |
| Plus 非混同 | landing 配下、禁止語 |

### Placeholder scan

- TBD / 「similar to Task N」なし
- router テストは ESM `import { RootGatePage }`（`require` 禁止）

### Type consistency

- `FreeLandingPage` / `RootGatePage` / `FREE_LP_*` 名は全 Task で一致
- loading 文言は RequireSession と同一文字列

### 意図的非スコープ

- login UI リデザイン、SSR/OGP、Plus 導線、枠数字表示、履歴/買い物/緊急カード

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-30-free-landing-page.md`.

**Two execution options:**

1. **Subagent-Driven（推奨）** — Task ごとに新しい subagent、間にレビュー（`superpowers:subagent-driven-development`）
2. **Inline Execution** — このセッションで `executing-plans` により順実行

**Which approach?**
