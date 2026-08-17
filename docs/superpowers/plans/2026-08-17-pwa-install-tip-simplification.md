# ホーム画面案内の簡易化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 出荷済みのホーム画面案内を、短い見出し＋記号の手順行にし、Android は取れたら「インストールする」、無いときだけ同じ型の 2 行にする。

**Architecture:** copy 配列だけ短くする。出す条件・BIP・dismiss は触らない。カードと設定は `resolveHomeScreenInstallPresentation` の戻りだけを描き、手順 DOM は `HomeScreenInstallSteps` に集約する。

**Tech Stack:** React 19、Vitest / Testing Library、Playwright、Docker `app`。

**Spec:** `docs/superpowers/specs/2026-08-17-pwa-install-tip-simplification-design.md`（敵対 MF 反映済み）
**Reviews:** `docs/superpowers/reviews/2026-08-17-pwa-install-tip-simplification-adversarial.md`
**親:** `docs/superpowers/specs/2026-08-16-pwa-installable-app-shell-design.md` §8.1–8.3 / §8.5 / §8.7

## Global Constraints

- Node.js `>=24 <25`、ESM、`strict: true`、境界で `any` 禁止
- ユーザー向け文言は日本語。コードコメント・コミットメッセージは日本語（Conventional Commits）
- Docker: `docker compose run --rm --no-deps app <cmd>`。エージェントは `&&` / `;` でコマンド連結しない
- Auth ロック（`AuthFlow` / `ContinuationApi` / `AuthProvider` / `BrowserSupabaseClient`）を再定義しない
- eligibility / BIP / dismiss キー / SW / CSP / manifest を編集しない
- ユーザー向けに `PWA` / `Service Worker` / `キャッシュ` と書かない
- 部分一致で `追加` / `インストール` / `ホーム画面に追加` を取らない
- `git push` / 本番 deploy / 破壊的 git は人間の明示指示なしで行わない

## File map

| ファイル | 責務 |
| --- | --- |
| `src/features/pwa/install-tip-copy.ts` | 短い手順配列。他定数は据え置き |
| `src/features/pwa/home-screen-install-presentation.ts` | `resolveHomeScreenInstallPresentation` |
| `src/features/pwa/install-step-icons.tsx` | 5 種 SVG |
| `src/features/pwa/home-screen-install-steps.tsx` | `kind` → `ol` または `null` |
| `src/features/pwa/home-screen-install-card.tsx` | helper の戻りだけ描く |
| `src/features/pwa/home-screen-install-section.tsx` | 同上（設定） |
| `e2e/specs/pwa-install-tip.spec.ts` | exact listitem + viewport 320 |

触らない: `install-surface.ts`、`install-tip-eligibility.ts`、`install-tip-storage.ts`、`android-install-prompt.ts`、`src/pwa/**`、`scripts/generate-service-worker.mjs`

---

### Task 1: 手順 copy を短くする

**Files:**
- Modify: `src/features/pwa/install-tip-copy.ts`
- Modify: `src/features/pwa/install-tip-copy.test.ts`

**Interfaces:**
- Consumes: 既存の見出し / リード / わかりました / インストールする / other 一文
- Produces:
  - `INSTALL_TIP_IOS_STEPS = ["共有", "ホーム画面に追加", "追加"] as const`
  - `INSTALL_TIP_ANDROID_STEPS = ["メニュー", "ホーム画面に追加"] as const`

- [ ] **Step 1: 失敗するテストに差し替える**

`install-tip-copy.test.ts` の手順 2 本と、部分文字列の 1 本を次にする。見出し・dismiss・other・PWA 禁止の既存テストは残す。

```ts
  it("keeps the iOS three-step list exact", () => {
    expect(INSTALL_TIP_IOS_STEPS).toEqual(["共有", "ホーム画面に追加", "追加"]);
  });

  it("keeps the Android two-step list exact", () => {
    expect(INSTALL_TIP_ANDROID_STEPS).toEqual(["メニュー", "ホーム画面に追加"]);
  });

  it("does not put インストール as an Android step substring of the button", () => {
    expect(INSTALL_TIP_ANDROID_INSTALL_LABEL.includes(INSTALL_TIP_ANDROID_STEPS[1])).toBe(false);
    expect(INSTALL_TIP_ANDROID_STEPS[1]).not.toBe("インストール");
  });
```

- [ ] **Step 2: テストを回して失敗を確認する**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/pwa/install-tip-copy.test.ts`

Expected: FAIL。iOS / Android 配列が旧長文のまま。

- [ ] **Step 3: 配列だけ替える**

`install-tip-copy.ts`:

```ts
export const INSTALL_TIP_IOS_STEPS = ["共有", "ホーム画面に追加", "追加"] as const;

export const INSTALL_TIP_ANDROID_STEPS = ["メニュー", "ホーム画面に追加"] as const;
```

他の export は 1 文字も変えない。コメント先頭は「Spec 簡易化 §4 の固定文言」に更新してよい。

- [ ] **Step 4: テストを回して通す**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/pwa/install-tip-copy.test.ts`

Expected: PASS

この Task のあと、カード / 設定の既存テストは旧長文を探して落ちる。Task 4 まで直さない。コミット対象は copy とそのテストだけ。

- [ ] **Step 5: コミット**

```bash
git add src/features/pwa/install-tip-copy.ts src/features/pwa/install-tip-copy.test.ts
git commit -m "feat(pwa): ホーム画面手順の文言を短い見出しにする"
```

---

### Task 2: presentation helper

**Files:**
- Create: `src/features/pwa/home-screen-install-presentation.ts`
- Create: `src/features/pwa/home-screen-install-presentation.test.ts`

**Interfaces:**
- Consumes: `InstallSurface`（`./install-surface`）
- Produces:

```ts
export type HomeScreenInstallPresentation =
  | { steps: "ios"; body: "none" }
  | { steps: "android"; body: "none" }
  | { steps: "none"; body: "prompt" }
  | { steps: "none"; body: "generic" };

export function resolveHomeScreenInstallPresentation(input: {
  surface: InstallSurface;
  safariStepsOk: boolean;
  androidChromeStepsOk: boolean;
  hasAndroidPrompt: boolean;
}): HomeScreenInstallPresentation
```

- [ ] **Step 1: 失敗するテストを書く**

`home-screen-install-presentation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveHomeScreenInstallPresentation } from "./home-screen-install-presentation";

describe("resolveHomeScreenInstallPresentation", () => {
  it("returns ios steps for Safari-capable iOS", () => {
    expect(
      resolveHomeScreenInstallPresentation({
        surface: "ios",
        safariStepsOk: true,
        androidChromeStepsOk: true,
        hasAndroidPrompt: false,
      }),
    ).toEqual({ steps: "ios", body: "none" });
  });

  it("returns generic for iOS in-app", () => {
    expect(
      resolveHomeScreenInstallPresentation({
        surface: "ios",
        safariStepsOk: false,
        androidChromeStepsOk: true,
        hasAndroidPrompt: false,
      }),
    ).toEqual({ steps: "none", body: "generic" });
  });

  it("returns prompt for Android when BIP is held", () => {
    expect(
      resolveHomeScreenInstallPresentation({
        surface: "android",
        safariStepsOk: true,
        androidChromeStepsOk: true,
        hasAndroidPrompt: true,
      }),
    ).toEqual({ steps: "none", body: "prompt" });
  });

  it("returns android steps when Chrome steps are allowed and no BIP", () => {
    expect(
      resolveHomeScreenInstallPresentation({
        surface: "android",
        safariStepsOk: true,
        androidChromeStepsOk: true,
        hasAndroidPrompt: false,
      }),
    ).toEqual({ steps: "android", body: "none" });
  });

  it("returns generic for Android WebView or Firefox without BIP", () => {
    expect(
      resolveHomeScreenInstallPresentation({
        surface: "android",
        safariStepsOk: true,
        androidChromeStepsOk: false,
        hasAndroidPrompt: false,
      }),
    ).toEqual({ steps: "none", body: "generic" });
  });

  it("returns generic for other surfaces", () => {
    expect(
      resolveHomeScreenInstallPresentation({
        surface: "other",
        safariStepsOk: true,
        androidChromeStepsOk: true,
        hasAndroidPrompt: false,
      }),
    ).toEqual({ steps: "none", body: "generic" });
  });
});
```

- [ ] **Step 2: テストを回して失敗を確認する**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/pwa/home-screen-install-presentation.test.ts`

Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 純関数を書く**

`home-screen-install-presentation.ts`:

```ts
import type { InstallSurface } from "./install-surface";

export type HomeScreenInstallPresentation =
  | { steps: "ios"; body: "none" }
  | { steps: "android"; body: "none" }
  | { steps: "none"; body: "prompt" }
  | { steps: "none"; body: "generic" };

export function resolveHomeScreenInstallPresentation(input: {
  surface: InstallSurface;
  safariStepsOk: boolean;
  androidChromeStepsOk: boolean;
  hasAndroidPrompt: boolean;
}): HomeScreenInstallPresentation {
  if (input.surface === "ios") {
    return input.safariStepsOk
      ? { steps: "ios", body: "none" }
      : { steps: "none", body: "generic" };
  }
  if (input.surface === "android") {
    if (input.hasAndroidPrompt) {
      return { steps: "none", body: "prompt" };
    }
    return input.androidChromeStepsOk
      ? { steps: "android", body: "none" }
      : { steps: "none", body: "generic" };
  }
  return { steps: "none", body: "generic" };
}
```

- [ ] **Step 4: テストを回して通す**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/pwa/home-screen-install-presentation.test.ts`

Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/features/pwa/home-screen-install-presentation.ts src/features/pwa/home-screen-install-presentation.test.ts
git commit -m "feat(pwa): 案内の手順と本文を presentation helper に集約する"
```

---

### Task 3: SVG と手順リスト

**Files:**
- Create: `src/features/pwa/install-step-icons.tsx`
- Create: `src/features/pwa/home-screen-install-steps.tsx`
- Create: `src/features/pwa/home-screen-install-steps.test.tsx`

**Interfaces:**
- Consumes: `INSTALL_TIP_IOS_STEPS` / `INSTALL_TIP_ANDROID_STEPS`
- Produces:

```ts
export function HomeScreenInstallSteps(props: {
  kind: "ios" | "android" | "none";
}): JSX.Element | null
```

- [ ] **Step 1: 失敗するテストを書く**

`home-screen-install-steps.test.tsx`:

```ts
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomeScreenInstallSteps } from "./home-screen-install-steps";

describe("HomeScreenInstallSteps", () => {
  it("renders three iOS listitems with exact accessible names and no digits", () => {
    render(<HomeScreenInstallSteps kind="ios" />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveAccessibleName("共有");
    expect(items[1]).toHaveAccessibleName("ホーム画面に追加");
    expect(items[2]).toHaveAccessibleName("追加");
    for (const item of items) {
      expect(item).not.toHaveAccessibleName(/[0-9]/u);
    }
    expect(screen.getByRole("list")).toHaveAttribute("role", "list");
    expect(screen.getByRole("list").className).toContain("min-w-0");
    expect(screen.getByRole("list").className).not.toContain("whitespace-nowrap");
    expect(screen.getByRole("list").tagName).toBe("OL");
    expect(items[0]?.querySelector("span:not([aria-hidden])")?.tagName).toBe("SPAN");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    const icons = screen.getByRole("list").querySelectorAll("svg[aria-hidden='true']");
    expect(icons).toHaveLength(3);
    expect(icons[0]).toHaveAttribute("data-icon", "ios-share");
    expect(icons[1]).toHaveAttribute("data-icon", "ios-add-home");
    expect(icons[2]).toHaveAttribute("data-icon", "ios-confirm-bar");
    const confirm = icons[2];
    expect(confirm?.querySelector("path,line,polyline")).toBeNull();
    expect(confirm?.querySelector("rect")).not.toBeNull();
    for (const svg of icons) {
      for (const node of svg.querySelectorAll("[fill],[stroke]")) {
        const fill = node.getAttribute("fill");
        const stroke = node.getAttribute("stroke");
        if (fill !== null) expect(["currentColor", "none"]).toContain(fill);
        if (stroke !== null) expect(["currentColor", "none"]).toContain(stroke);
      }
    }
  });

  it("renders two Android listitems with exact names", () => {
    render(<HomeScreenInstallSteps kind="android" />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAccessibleName("メニュー");
    expect(items[1]).toHaveAccessibleName("ホーム画面に追加");
    const icons = screen.getByRole("list").querySelectorAll("svg[aria-hidden='true']");
    expect(icons[0]).toHaveAttribute("data-icon", "android-menu");
    expect(icons[1]).toHaveAttribute("data-icon", "android-add-home");
  });

  it("renders nothing for none", () => {
    const { container } = render(<HomeScreenInstallSteps kind="none" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
```

`listItemNames` は使わなくてよい。accessible name だけ見る。実装時に未使用なら関数を書かない。

- [ ] **Step 2: テストを回して失敗を確認する**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/pwa/home-screen-install-steps.test.tsx`

Expected: FAIL（モジュールが無い）

- [ ] **Step 3: アイコンとリストを書く**

`install-step-icons.tsx`:

```tsx
import type { JSX } from "react";

const svgClass = "h-6 w-6 shrink-0";

export function IosShareIcon(): JSX.Element {
  return (
    <svg
      className={svgClass}
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-icon="ios-share"
      fill="none"
      stroke="currentColor"
    >
      <path d="M8 10H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1" />
      <path d="M12 3v11" />
      <path d="M8 7l4-4 4 4" />
    </svg>
  );
}

export function IosAddHomeIcon(): JSX.Element {
  return (
    <svg
      className={svgClass}
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-icon="ios-add-home"
      fill="none"
      stroke="currentColor"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M12 8v8" />
      <path d="M8 12h8" />
    </svg>
  );
}

export function IosConfirmBarIcon(): JSX.Element {
  return (
    <svg
      className={svgClass}
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-icon="ios-confirm-bar"
      fill="currentColor"
    >
      <rect x="4" y="10" width="16" height="4" rx="2" />
    </svg>
  );
}

export function AndroidMenuIcon(): JSX.Element {
  return (
    <svg
      className={svgClass}
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-icon="android-menu"
      fill="currentColor"
    >
      <circle cx="12" cy="6" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="18" r="1.5" />
    </svg>
  );
}

export function AndroidAddHomeIcon(): JSX.Element {
  return (
    <svg
      className={svgClass}
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-icon="android-add-home"
      fill="none"
      stroke="currentColor"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M12 8v8" />
      <path d="M8 12h8" />
    </svg>
  );
}
```

`home-screen-install-steps.tsx`:

```tsx
import type { JSX } from "react";
import { INSTALL_TIP_ANDROID_STEPS, INSTALL_TIP_IOS_STEPS } from "./install-tip-copy";
import {
  AndroidAddHomeIcon,
  AndroidMenuIcon,
  IosAddHomeIcon,
  IosConfirmBarIcon,
  IosShareIcon,
} from "./install-step-icons";

const IOS_ICONS = [IosShareIcon, IosAddHomeIcon, IosConfirmBarIcon] as const;
const ANDROID_ICONS = [AndroidMenuIcon, AndroidAddHomeIcon] as const;

export function HomeScreenInstallSteps(props: {
  kind: "ios" | "android" | "none";
}): JSX.Element | null {
  if (props.kind === "none") return null;
  const steps = props.kind === "ios" ? INSTALL_TIP_IOS_STEPS : INSTALL_TIP_ANDROID_STEPS;
  const icons = props.kind === "ios" ? IOS_ICONS : ANDROID_ICONS;
  return (
    <ol
      role="list"
      className="m-0 flex list-none min-w-0 flex-col gap-2 p-0 [overflow-wrap:anywhere]"
    >
      {steps.map((label, index) => {
        const Icon = icons[index];
        if (Icon === undefined) return null;
        return (
          <li key={label} className="flex min-w-0 items-start gap-2">
            <span aria-hidden="true">{String(index + 1)}</span>
            <Icon />
            <span className="min-w-0">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 4: テストを回して通す**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/pwa/home-screen-install-steps.test.tsx`

Expected: PASS。accessible name に番号が混ざる、または `kind="none"` が空要素を残す場合は、視覚番号の `aria-hidden` と early `null` を直す。

- [ ] **Step 5: コミット**

```bash
git add src/features/pwa/install-step-icons.tsx src/features/pwa/home-screen-install-steps.tsx src/features/pwa/home-screen-install-steps.test.tsx
git commit -m "feat(pwa): 短い手順行と記号 SVG を追加する"
```

---

### Task 4: カードと設定を helper へ替える

**Files:**
- Modify: `src/features/pwa/home-screen-install-card.tsx`
- Modify: `src/features/pwa/home-screen-install-section.tsx`
- Modify: `src/features/pwa/home-screen-install-card.test.tsx`
- Modify: `src/features/pwa/home-screen-install-section.test.tsx`

**Interfaces:**
- Consumes: `resolveHomeScreenInstallPresentation`、`HomeScreenInstallSteps`
- Produces: カード / 設定の描画が Spec §5.1 の表どおり

- [ ] **Step 1: 既存テストの旧長文クエリを exact listitem / list 不在へ替える**

カードテストで次を置換する。

- `getByText("右上のメニューを開きます")` → `getByRole("listitem", { name: "メニュー", exact: true })`
- `queryByText("右上のメニューを開きます")` → `queryByRole("list")`（BIP 後・消費後）または残すなら `queryByRole("listitem", { name: "メニュー", exact: true })`
- in-app の `queryByText("画面の下（または上）の共有ボタンをタップします")` → `queryByRole("list")` と `queryByRole("listitem", { name: "共有", exact: true })`
- iOS カードに 3 listitem exact を 1 本足す:

```ts
  it("shows three exact iOS step names", () => {
    renderCard();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveAccessibleName("共有");
    expect(items[1]).toHaveAccessibleName("ホーム画面に追加");
    expect(items[2]).toHaveAccessibleName("追加");
  });
```

設定テスト:

- `shows iOS steps on iOS` を 3 listitem exact にする（`getByText` 長文を捨てる）
- Android 手順は `メニュー` / `ホーム画面に追加` の listitem exact
- BIP 後は `queryByRole("list")`
- in-app / WebView は `queryByRole("list")` + other 全文（全文は部分一致でも衝突しない）
- 見出しは `getByRole("heading", { name: "ホーム画面に追加", exact: true })`
- 手順ラベルが heading でない: iOS 設定で `getAllByRole("heading")` が 1 件だけ

`queryByText("インストール")` は足さない。

- [ ] **Step 2: テストを回して失敗を確認する**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/pwa/home-screen-install-card.test.tsx src/features/pwa/home-screen-install-section.test.tsx`

Expected: FAIL（まだ素の `ol` + 短い文字列だけで、listitem の構造 / helper 未配線、または旧クエリ残）

- [ ] **Step 3: カードと設定を helper だけにする**

`home-screen-install-card.tsx` の分岐を次に置き換える。`INSTALL_TIP_IOS_STEPS` / `INSTALL_TIP_ANDROID_STEPS` の import は消す。

```tsx
  const presentation = resolveHomeScreenInstallPresentation({
    surface,
    safariStepsOk: canUseIosSafariInstallSteps(navigator.userAgent),
    androidChromeStepsOk: canUseAndroidChromeInstallSteps(navigator.userAgent),
    hasAndroidPrompt: androidPrompt !== null,
  });

  if (!visible) return null;
```

描画:

```tsx
      <HomeScreenInstallSteps kind={presentation.steps} />
      {presentation.body === "generic" ? <p>{INSTALL_TIP_OTHER_BODY}</p> : null}
      {presentation.body === "prompt" ? (
        <button
          type="button"
          className="primary-button min-h-11"
          disabled={installInFlight}
          onClick={requestInstall}
        >
          {INSTALL_TIP_ANDROID_INSTALL_LABEL}
        </button>
      ) : null}
```

`showIosSteps` など 4 布尔は削除する。`visible` 判定は helper より前のままでよい（早期 return してから helper を呼んでもよい。呼ぶなら `visible` が false のとき描画しない）。

`home-screen-install-section.tsx` も同じ helper。設定は `visible` が無いので常に描く。

```tsx
  const presentation = resolveHomeScreenInstallPresentation({
    surface,
    safariStepsOk: canUseIosSafariInstallSteps(navigator.userAgent),
    androidChromeStepsOk: canUseAndroidChromeInstallSteps(navigator.userAgent),
    hasAndroidPrompt: androidPrompt !== null,
  });
```

`INSTALL_TIP_IOS_STEPS` / `INSTALL_TIP_ANDROID_STEPS` の import と素の `ol` は消す。

- [ ] **Step 4: テストを回して通す**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/pwa/home-screen-install-card.test.tsx src/features/pwa/home-screen-install-section.test.tsx src/features/pwa/home-screen-install-steps.test.tsx src/features/pwa/home-screen-install-presentation.test.ts src/features/pwa/install-tip-copy.test.ts`

Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/features/pwa/home-screen-install-card.tsx src/features/pwa/home-screen-install-section.tsx src/features/pwa/home-screen-install-card.test.tsx src/features/pwa/home-screen-install-section.test.tsx
git commit -m "feat(pwa): カードと設定の手順を共有部品へ移す"
```

---

### Task 5: E2E

**Files:**
- Modify: `e2e/specs/pwa-install-tip.spec.ts`

**Interfaces:**
- Consumes: Task 4 のカード / 設定
- Produces: Spec §8.2 の 2 本

- [ ] **Step 1: E2E を書き換える**

`e2e/specs/pwa-install-tip.spec.ts` を次の全文にする。`test.use` の iPhone SE + chromium 上書きは残す。

```ts
import { devices } from "@playwright/test";
import { expect, loginAsNewUser, test } from "../fixtures/auth";

test.use({ ...devices["iPhone SE"], browserName: "chromium" });

test(
  "shows the iPhone install card, dismisses it, and keeps the settings section",
  { tag: ["@mobile-only"] },
  async ({ page, authEmail }) => {
    await loginAsNewUser(page, authEmail, { seedPwaInstallTipDismissed: false });
    await page.setViewportSize({ width: 320, height: 640 });
    await expect(page.getByRole("heading", { name: "ホーム画面に置く" })).toBeVisible();
    await expect(page.getByRole("listitem", { name: "共有", exact: true })).toBeVisible();
    await expect(
      page.getByRole("listitem", { name: "ホーム画面に追加", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("listitem", { name: "追加", exact: true })).toBeVisible();
    await expect(page.locator("svg[aria-hidden='true'][data-icon]")).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await page.getByRole("button", { name: "わかりました" }).click();
    await expect(page.getByRole("heading", { name: "ホーム画面に置く" })).toHaveCount(0);

    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: "ホーム画面に追加", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("listitem", { name: "共有", exact: true })).toBeVisible();
  },
);

test(
  "shows Android install steps under an Android UA",
  { tag: ["@mobile-only"] },
  async ({ browser, authEmail }) => {
    const context = await browser.newContext({
      ...devices["Pixel 5"],
    });
    const page = await context.newPage();
    await loginAsNewUser(page, authEmail, { seedPwaInstallTipDismissed: false });
    await expect(page.getByRole("heading", { name: "ホーム画面に置く" })).toBeVisible();
    await expect(page.getByRole("listitem", { name: "メニュー", exact: true })).toBeVisible();
    await expect(
      page.getByRole("listitem", { name: "ホーム画面に追加", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("右上のメニューを開きます")).toHaveCount(0);
    await context.close();
  },
);
```

`getByText("ホーム画面に追加")` と `getByText("インストール")` は使わない。BIP あり経路は書かない。

- [ ] **Step 2: ユニットを再確認する**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/pwa/install-tip-copy.test.ts src/features/pwa/home-screen-install-presentation.test.ts src/features/pwa/home-screen-install-steps.test.tsx src/features/pwa/home-screen-install-card.test.tsx src/features/pwa/home-screen-install-section.test.tsx`

Expected: PASS

- [ ] **Step 3: E2E をホストで回す**

`app` コンテナから `npm run e2e` しない。ホストで:

Run: `./scripts/run-e2e.sh -- e2e/specs/pwa-install-tip.spec.ts --project=mobile-chromium`

Expected: 2 passed。320 で `scrollWidth` が 320 を超えたら Task 3 の `ol` / `li` の `min-w-0` と折り返しを直して再実行。

エージェントが E2E を回せないときは、人間に同じコマンドを頼み、失敗ログだけをもらう。

- [ ] **Step 4: フォーマットと型**

Run: `docker compose run --rm --no-deps app npx prettier --check src/features/pwa/install-tip-copy.ts src/features/pwa/install-tip-copy.test.ts src/features/pwa/home-screen-install-presentation.ts src/features/pwa/home-screen-install-presentation.test.ts src/features/pwa/install-step-icons.tsx src/features/pwa/home-screen-install-steps.tsx src/features/pwa/home-screen-install-steps.test.tsx src/features/pwa/home-screen-install-card.tsx src/features/pwa/home-screen-install-section.tsx src/features/pwa/home-screen-install-card.test.tsx src/features/pwa/home-screen-install-section.test.tsx e2e/specs/pwa-install-tip.spec.ts`

Run: `docker compose run --rm --no-deps app npm run typecheck`

Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add e2e/specs/pwa-install-tip.spec.ts
git commit -m "test(pwa): 案内 E2E を短い手順と 320px に合わせる"
```

---

## Self-review

| Spec | Task |
| --- | --- |
| §4 短い配列 / Android に単独 `インストール` を置かない | Task 1 |
| §5.1 helper 6 行 | Task 2 |
| §5.2–5.3 SVG / ol / aria-hidden 番号 / heading 禁止 / currentColor / 320 クラス | Task 3 |
| カード / 設定が helper だけ描く。BIP / dismiss はそのまま | Task 4 |
| §8.1 カード 4 系統・設定 heading exact・in-app list 無し | Task 4 |
| §8.2 E2E exact listitem + viewport 320。BIP は E2E に書かない | Task 5 |
| eligibility / BIP / SW / 見出し定数 | 非対象。Task に Files 無し |

プレースホルダ無し。`HomeScreenInstallPresentation` / `resolveHomeScreenInstallPresentation` / `HomeScreenInstallSteps` の型は Task 間で一致。
