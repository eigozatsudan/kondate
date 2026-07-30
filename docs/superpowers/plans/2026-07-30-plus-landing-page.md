# Plus ランディングページ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Free ユーザーが「Plus を見る」から `/plus` カード型 LP でメリット・価格を理解し、共有 Checkout UI から Stripe に進める。kill 中も LP は開き Checkout のみ無効。

**Architecture:** 認証済み AppShell に `/plus` を追加。entitlement の State matrix（pure 関数）で管理短形 / フル LP を分岐。Checkout フォームは設定と単一コンポーネント共有。CTA 着地と `cancel_url` を `/plus` に寄せ、success poll は設定のまま。

**Tech Stack:** React 19 / React Router 8 / TanStack Query 5 / TypeScript strict / Vitest / RTL / Playwright / Netlify Functions / Vite 静的アセット

**仕様書:** `docs/superpowers/specs/2026-07-30-plus-landing-page-design.md`  
**関連:** `docs/superpowers/specs/2026-07-29-paid-plan-stripe-design.md`（L3 価格・L10・A3）

## Global Constraints

- Node.js `>=24 <25`。Node/npm は `docker compose run --rm --no-deps app ...`。コマンドを `&&` / `;` で連結しない。
- 各 Task は RED → GREEN → 対象検証 → レビュー → 日本語 Conventional Commit。1 Task = 1 作業単位。
- UI 文言・コメント・コミットは日本語。識別子・テスト名は英語。`any` / 未検査 cast 禁止。
- 320 CSS px・44×44・横スクロールなし。新カラー体系禁止（既存 terracotta / surface）。
- `VITE_STRIPE_*` / Price ID / `sk_` をブラウザに出さない。Checkout は `createCheckoutSession({ interval })` のみ。
- 価格は **月額 580 円（税込）/ 年額 5,800 円**。年額確認・Stripe 注記・「Plus をはじめる」は単一ソース。
- `success_url` は `/settings?billing=success` のまま。`cancel_url` のみ `/plus?billing=cancel`。
- `git push` / PR / 本番デプロイ / `--no-verify` 禁止。
- 設計の State matrix・`CHECKOUT_BLOCKED_STATUSES`・L12 比較表を再導出せず実装する。
- **E2E（Task 7）は Task 1–6 完了かつ既知バグ解消後のみ。** バグ調査中・修正中は E2E を開始しない。
- 戻る判定は `location.key !== "default"` **または** 同一 origin `document.referrer`（生 a フルロード対応）。`history.length` 禁止。

## Locked interfaces produced by this plan

| 名前 | 場所 | 契約 |
|------|------|------|
| 課金 UI コピー | `src/features/billing/billing-ui-copy.ts` | `YEARLY_CONFIRM_COPY` / `STRIPE_REDIRECT_NOTICE` / `PAST_DUE_COPY` / `PORTAL_BUTTON_LABEL` / `TRIAL_END_WARNING` / **`SURFACES_CLOSED_COPY`** の正本。`plan-settings-section` は re-export のみ |
| `CheckoutIntervalForm` | `src/features/billing/checkout-interval-form.tsx` | props: `disabled?: boolean`, `pending?: boolean`, `onSubmit: (interval: "month" \| "year") => void \| Promise<void>`。年額未確認時は `onSubmit` 非呼び出し + form 内 alert。**定数は `billing-ui-copy` のみ import（plan-settings を import しない）** |
| `CHECKOUT_BLOCKED_STATUSES` | `src/features/billing/plus-landing-view.ts` | `as const`: `trialing`, `active`, `past_due`, `incomplete` |
| `resolvePlusLandingView` | 同上 | 下記シグネチャ。LP の唯一の分岐入口。`full.checkoutEnabled = productSurfacesOpen && !blocked(status)` |
| `PlusLandingPage` | `src/features/billing/plus-landing-page.tsx` | named export。router lazy から import |
| Plus CTA href | `plus-cta` / flyer / quality | すべて `/plus`。ラベル `"Plus を見る"` |

```ts
// plus-landing-view.ts（Locked）
import type { EntitlementData } from "@shared/contracts/billing";

export const CHECKOUT_BLOCKED_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "incomplete",
] as const;

export type PlusLandingView =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "past_due"; surfacesOpen: boolean }
  | {
      kind: "entitled";
      surfacesOpen: boolean;
      trialing: boolean;
      trialEnd: string | null;
    }
  | { kind: "incomplete"; surfacesOpen: boolean }
  | { kind: "full"; checkoutEnabled: boolean };

export function resolvePlusLandingView(input: {
  loading: boolean;
  error: boolean;
  data: EntitlementData | null;
}): PlusLandingView;
```

分岐順序（設計 State matrix）:

1. `loading && data == null` → `loading`
2. `error && data == null` → `error`
3. `status === "past_due" || pastDueGrace` → `past_due`
4. `plusEntitled` → `entitled`
5. `status === "incomplete"` → `incomplete`
6. else → `full`（`checkoutEnabled = productSurfacesOpen && status ∉ CHECKOUT_BLOCKED_STATUSES`）

## File Structure

| ファイル | 責務 |
|----------|------|
| `src/features/billing/billing-ui-copy.ts` | 年額確認・Stripe 注記・past_due 等の固定コピー正本 |
| `src/features/billing/checkout-interval-form.tsx` | 月/年・年額確認・注記・Plus をはじめる（設定・LP 共有） |
| `src/features/billing/checkout-interval-form.test.tsx` | 年額ガード・月額 submit |
| `src/features/billing/plan-settings-section.tsx` | 共有 form 利用 + copy re-export（既存 import 互換） |
| `src/features/billing/plus-landing-view.ts` | State matrix pure 関数 |
| `src/features/billing/plus-landing-view.test.ts` | matrix 全分岐 |
| `src/features/billing/plus-landing-page.tsx` | LP UI |
| `src/features/billing/plus-landing-page.css` | LP レイアウト（既存 token） |
| `src/features/billing/plus-landing-page.test.tsx` | Free open/closed、短形、cancel query |
| `src/features/billing/assets/plus-hero.webp` 他 3 | イラスト |
| `src/features/billing/plus-cta.tsx` | href `/plus` |
| `src/features/billing/flyer-upsell-banner.tsx` | href `/plus` |
| `src/features/flyer/flyer-weekly-panel.tsx` | to `/plus` |
| `src/features/planner/components/review-step.tsx` | 品質ゲート Plus リンク |
| `src/app/router.tsx` | `/plus` ルート |
| `src/app/layouts/app-shell.tsx` | section `plus` |
| `src/styles.css` | `[data-section="plus"]` tint（settings と同値 `#f6f6f4`） |
| `netlify/functions/_shared/billing-checkout.ts` | `cancel_url` |
| `e2e/specs/billing-plus.spec.ts` | `/plus` 到達 |

---

### Task 1: billing-ui-copy + 共有 CheckoutIntervalForm + 設定リファクタ

**Files:**
- Create: `src/features/billing/billing-ui-copy.ts`
- Create: `src/features/billing/checkout-interval-form.tsx`
- Create: `src/features/billing/checkout-interval-form.test.tsx`
- Modify: `src/features/billing/plan-settings-section.tsx`
- Test: 上記 + 既存 `plan-settings-section.test.tsx`（壊さない）

**Interfaces:**
- Consumes: なし（copy 正本を新設）
- Produces: `billing-ui-copy` 定数、`CheckoutIntervalForm`（Locked）

- [ ] **Step 1: 共有 form の失敗テストを書く**

`src/features/billing/checkout-interval-form.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { YEARLY_CONFIRM_COPY, STRIPE_REDIRECT_NOTICE } from "./billing-ui-copy";
import { CheckoutIntervalForm } from "./checkout-interval-form";

describe("CheckoutIntervalForm", () => {
  it("starts monthly checkout without year confirm", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    render(<CheckoutIntervalForm onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Plus をはじめる" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("month");
    });
  });

  it("requires yearly confirmation before submit", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    render(<CheckoutIntervalForm onSubmit={onSubmit} />);
    await user.click(screen.getByLabelText(/年額 5,800 円/));
    expect(screen.getByText(YEARLY_CONFIRM_COPY)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Plus をはじめる" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.getByText("年額のお支払いについて確認にチェックを入れてください"),
    ).toBeVisible();
    await user.click(screen.getByLabelText(YEARLY_CONFIRM_COPY));
    await user.click(screen.getByRole("button", { name: "Plus をはじめる" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("year");
    });
  });

  it("disables primary button when disabled", () => {
    render(<CheckoutIntervalForm onSubmit={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: "Plus をはじめる" })).toBeDisabled();
  });

  it("shows Stripe redirect notice", () => {
    render(<CheckoutIntervalForm onSubmit={vi.fn()} />);
    expect(screen.getByText(STRIPE_REDIRECT_NOTICE)).toBeVisible();
  });
});
```

- [ ] **Step 2: テストを RED で確認**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/billing/checkout-interval-form.test.tsx
```

Expected: FAIL（module not found）

- [ ] **Step 3a: `billing-ui-copy.ts` を切り出す（R-B1）**

`plan-settings-section.tsx` から次の定数を移動（文字列は **1 字も変えない**）:

```ts
// billing-ui-copy.ts
export const TRIAL_END_WARNING =
  "無料期間が終わると、登録したお支払い方法に料金がかかります" as const;
export const YEARLY_CONFIRM_COPY =
  "1 年分まとめてのお支払いです。途中解約しても残り期間の返金はありません（法令に従う場合を除く）" as const;
export const PORTAL_BUTTON_LABEL = "お支払い・解約の管理" as const;
export const STRIPE_REDIRECT_NOTICE = "カード入力画面に移ります" as const;
export const PAST_DUE_COPY = "お支払いの更新が必要です" as const;
export const SURFACES_CLOSED_COPY =
  "お支払い管理は現在ご利用いただけません。" as const;
```

`plan-settings-section.tsx` で re-export（既存テストの import パスを壊さない）:

```ts
export {
  TRIAL_END_WARNING,
  YEARLY_CONFIRM_COPY,
  PORTAL_BUTTON_LABEL,
  STRIPE_REDIRECT_NOTICE,
  PAST_DUE_COPY,
  SURFACES_CLOSED_COPY,
} from "./billing-ui-copy";
```

設定内の surfaces 閉直書きを `SURFACES_CLOSED_COPY` に置換（文言 exact 維持）。

- [ ] **Step 3b: `CheckoutIntervalForm` を実装**

`checkout-interval-form.tsx` の要点（**`plan-settings-section` を import しない**）:

```tsx
import { useState } from "react";
import { STRIPE_REDIRECT_NOTICE, YEARLY_CONFIRM_COPY } from "./billing-ui-copy";

export type CheckoutIntervalFormProps = {
  disabled?: boolean;
  pending?: boolean;
  onSubmit: (interval: "month" | "year") => void | Promise<void>;
};

export function CheckoutIntervalForm({
  disabled = false,
  pending = false,
  onSubmit,
}: CheckoutIntervalFormProps) {
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [yearConfirmed, setYearConfirmed] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleClick(): Promise<void> {
    if (disabled || pending) return;
    if (interval === "year" && !yearConfirmed) {
      setLocalError("年額のお支払いについて確認にチェックを入れてください");
      return;
    }
    setLocalError(null);
    await onSubmit(interval);
  }

  return (
    <div className="stack gap-3">
      <ul className="stack gap-1">
        <li>月額 580 円（税込）</li>
        <li>年額 5,800 円（税込・2か月分お得）</li>
      </ul>
      <fieldset className="stack gap-2" disabled={disabled || pending}>
        <legend className="font-semibold">お支払いの種類</legend>
        {/* 月額 / 年額 radio — name="billing-interval"、設定と同じ label 文 */}
        {/* 年額時 YEARLY_CONFIRM_COPY チェック */}
      </fieldset>
      <p className="type-small">{STRIPE_REDIRECT_NOTICE}</p>
      <button
        type="button"
        className="primary-button min-h-11"
        disabled={disabled || pending}
        onClick={() => {
          void handleClick();
        }}
      >
        Plus をはじめる
      </button>
      {localError !== null ? (
        <p role="alert" className="error-message">
          {localError}
        </p>
      ) : null}
    </div>
  );
}
```

（radio の JSX は設定から切り出したものをそのまま。コメントは日本語で意図を書く。）

- [ ] **Step 4: `PlanSettingsSection` を共有 form 利用に置換**

`!entitled && surfacesOpen` ブロック内の fieldset〜ボタンを:

```tsx
<p>こんだて日和 Plus なら、1 日最大 10 回まで献立を作れます。</p>
<CheckoutIntervalForm
  pending={pending}
  onSubmit={async (interval) => {
    // 既存 runCheckout 相当: pending 管理は親のままでも、form 内 pending と二重にしない
    // 推奨: form は onSubmit のみ。pending/disabled を親が渡す。
    // 年額確認は form 内完結のため、親の yearConfirmed 状態は削除する。
    setPending(true);
    setActionError(null);
    try {
      if (onCheckout !== undefined) {
        await onCheckout(interval);
      } else {
        const { url } = await createCheckoutSession({ interval });
        window.location.assign(url);
      }
    } catch {
      setActionError("お支払い画面を開けませんでした。時間をおいてもう一度お試しください");
    } finally {
      setPending(false);
    }
  }}
/>
```

親から `interval` / `yearConfirmed` state と旧 `runCheckout` 内の年額チェックを削除。コピー定数は `billing-ui-copy` 正本 + plan-settings re-export。form は re-export 経由ではなく `billing-ui-copy` を直接 import。

- [ ] **Step 5: 対象テスト GREEN**

Run（各コマンド独立）:

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/billing/checkout-interval-form.test.tsx
```

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/billing/plan-settings-section.test.tsx
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/features/billing/billing-ui-copy.ts src/features/billing/checkout-interval-form.tsx src/features/billing/checkout-interval-form.test.tsx src/features/billing/plan-settings-section.tsx
git commit -m "refactor: Checkout 間隔フォームを設定と共有可能にする"
```

---

### Task 2: 「Plus を見る」着地を `/plus` にし、品質ゲートにリンクを足す

**Files:**
- Modify: `src/features/billing/plus-cta.tsx`
- Modify: `src/features/billing/plus-cta.test.tsx`
- Modify: `src/features/billing/flyer-upsell-banner.tsx`
- Modify: `src/features/billing/flyer-upsell-banner.test.tsx`
- Modify: `src/features/flyer/flyer-weekly-panel.tsx`
- Modify: `src/features/flyer/flyer-weekly-panel.test.tsx`（href 期待を追加）
- Modify: `src/features/planner/components/review-step.tsx`
- Modify: `src/features/planner/components/planner-wizard.test.tsx`
- Modify: `src/features/generation/components/generation-status-panel.test.tsx`
- Modify: `src/features/history/components/regeneration-sheet.test.tsx`

**Interfaces:**
- Consumes: なし（本 Task はルート未追加でも href 文字列は `/plus`）
- Produces: 全 CTA の `href`/`to` = `/plus`

- [ ] **Step 1: 失敗する期待に更新（RED）**

`plus-cta.test.tsx`:

```tsx
expect(link).toHaveAttribute("href", "/plus");
```

同様に:

- `flyer-upsell-banner.test.tsx`: `href` `/plus`
- `flyer-weekly-panel.test.tsx`: `expect(plusLink).toHaveAttribute("href", "/plus");`
- `generation-status-panel.test.tsx` / `regeneration-sheet.test.tsx`: `/plus`
- `planner-wizard.test.tsx` **硬上限**（R-B2: Free では品質リンクも出るため同名が 2 本）:

```tsx
it("shows Plus hard-limit CTA when Free success remaining is 0", () => {
  // within は @testing-library/react から import
  // ...render Harness usageRemaining={0} plan="free"...
  expect(screen.getByText(/Plus なら 1 日最大 10 回まで作成できます/)).toBeVisible();
  const hard = screen.getByTestId("plus-hard-limit-cta");
  expect(within(hard).getByRole("link", { name: "Plus を見る" })).toHaveAttribute(
    "href",
    "/plus",
  );
  // 品質ゲート側も /plus（任意 assert）
  expect(
    screen.getAllByRole("link", { name: "Plus を見る" }).every((a) => a.getAttribute("href") === "/plus"),
  ).toBe(true);
});
```

- `planner-wizard.test.tsx` **L10-4**（硬上限と二重にしないよう **usageRemaining > 0**）:

```tsx
it("disables quality mode toggle on Free with Plus gate copy and link (L10-4)", () => {
  render(
    <Harness initialStep="review" initialDraft={reviewDraft} usageRemaining={3} plan="free" />,
  );
  const checkbox = screen.getByRole("checkbox", { name: /くわしく作る/u });
  expect(checkbox).toBeDisabled();
  expect(screen.getByText("くわしい AI での作成は Plus で使えます")).toBeVisible();
  // 硬上限 CTA が無いので Plus を見るは品質リンク 1 本
  expect(screen.getByRole("link", { name: "Plus を見る" })).toHaveAttribute("href", "/plus");
});
```

品質リンク実装は **生 `a href="/plus"`**（Harness が Router 外でも可）。

- [ ] **Step 2: RED 確認**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/billing/plus-cta.test.tsx src/features/billing/flyer-upsell-banner.test.tsx src/features/flyer/flyer-weekly-panel.test.tsx
```

Expected: FAIL（href still `/settings`）

- [ ] **Step 3: 実装**

`plus-cta.tsx`:

```tsx
/** Free 硬上限時の固定コピー（L10-1）。テスト exact 一致。 */
export const PLUS_HARD_LIMIT_COPY = "Plus なら 1 日最大 10 回まで作成できます" as const;
export const PLUS_HARD_LIMIT_BUTTON = "Plus を見る" as const;

/**
 * Free で成功残 0（または受付 0）のときの Plus 案内。
 * 着地は Plus LP（/plus）。Checkout は LP または設定。
 * react-router Link ではなく a を使い、Router 外 unit でも描画できるようにする。
 */
export function PlusHardLimitCta({ className }: { className?: string }) {
  return (
    <div className={className ?? "stack gap-2"} data-testid="plus-hard-limit-cta">
      <p>{PLUS_HARD_LIMIT_COPY}</p>
      <a
        href="/plus"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border-2 border-terracotta-700 px-4 font-semibold"
      >
        {PLUS_HARD_LIMIT_BUTTON}
      </a>
    </div>
  );
}
```

`flyer-upsell-banner.tsx`: `href="/plus"`

`flyer-weekly-panel.tsx`:

```tsx
<Link className="primary-button" to="/plus">
  Plus を見る
</Link>
```

`review-step.tsx` — 品質ロック時（R-C2）:

```tsx
{/* quality の </label> の直後。idea の role=note より前。note と wizard-actions の間に置かない */}
{qualityModeLocked ? (
  <p className="quality-mode-plus-link-wrap">
    <a href="/plus" className="inline-flex min-h-11 items-center font-semibold underline">
      Plus を見る
    </a>
  </p>
) : null}
```

- label **内に入れない**（checkbox の accessible name 汚染防止）
- idea 注意（`role="note"`）は引き続き `wizard-actions` の **直前 sibling**（既存 §5.3 契約）
- `aria-describedby` は hint のまま（リンクは別操作）

- [ ] **Step 4: GREEN**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/billing/plus-cta.test.tsx src/features/billing/flyer-upsell-banner.test.tsx src/features/flyer/flyer-weekly-panel.test.tsx src/features/planner/components/planner-wizard.test.tsx src/features/generation/components/generation-status-panel.test.tsx src/features/history/components/regeneration-sheet.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/billing/plus-cta.tsx src/features/billing/plus-cta.test.tsx src/features/billing/flyer-upsell-banner.tsx src/features/billing/flyer-upsell-banner.test.tsx src/features/flyer/flyer-weekly-panel.tsx src/features/flyer/flyer-weekly-panel.test.tsx src/features/planner/components/review-step.tsx src/features/planner/components/planner-wizard.test.tsx src/features/generation/components/generation-status-panel.test.tsx src/features/history/components/regeneration-sheet.test.tsx
git commit -m "feat: Plus を見るの着地を /plus にし品質ゲートに導線を足す"
```

---

### Task 3: Checkout `cancel_url` を `/plus` にする

**Files:**
- Modify: `netlify/functions/_shared/billing-checkout.ts`（`cancel_url` 行）
- Modify or Create: `netlify/functions/_tests/billing-checkout.test.ts` に cancel_url 断言を追加

**Interfaces:**
- Consumes: 既存 Checkout Session 作成
- Produces: `cancel_url = ${origin}/plus?billing=cancel`

- [ ] **Step 1: 失敗テストを追加（R-B6）**

既存 happy path `acquire → sessions.create → bind → returns url` の `createArgs` に **フィールドを足す**（架空 mock 名を作らない）:

```ts
const createArgs = sessionsCreate.mock.calls[0]![0] as {
  // ...既存 fields...
  success_url: string;
  cancel_url: string;
};
expect(createArgs.success_url).toBe("http://127.0.0.1:5173/settings?billing=success");
expect(createArgs.cancel_url).toBe("http://127.0.0.1:5173/plus?billing=cancel");
```

（`SERVER_SITE_ORIGIN` は test の `baseEnv` が `http://127.0.0.1:5173`。）

- [ ] **Step 2: RED**

```bash
docker compose run --rm --no-deps app npm test -- --run netlify/functions/_tests/billing-checkout.test.ts
```

Expected: FAIL on cancel_url

- [ ] **Step 3: GREEN 実装**

`billing-checkout.ts`:

```ts
success_url: `${origin}/settings?billing=success`,
cancel_url: `${origin}/plus?billing=cancel`,
```

- [ ] **Step 4: 再実行 PASS**

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/billing-checkout.ts netlify/functions/_tests/billing-checkout.test.ts
git commit -m "fix: Checkout キャンセル戻り先を /plus にする"
```

---

### Task 4: `resolvePlusLandingView`（State matrix）

**Files:**
- Create: `src/features/billing/plus-landing-view.ts`
- Create: `src/features/billing/plus-landing-view.test.ts`

**Interfaces:**
- Produces: Locked `resolvePlusLandingView` / `CHECKOUT_BLOCKED_STATUSES` / `PlusLandingView`

- [ ] **Step 1: 失敗テスト**

```ts
import { describe, expect, it } from "vitest";
import type { EntitlementData } from "@shared/contracts/billing";
import { resolvePlusLandingView } from "./plus-landing-view";

const freeOpen: EntitlementData = {
  plan: "free",
  status: "none",
  plusEntitled: false,
  pastDueGrace: false,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trialEnd: null,
  dbPlusEntitled: false,
  productSurfacesOpen: true,
  quotaPlan: "free",
};

describe("resolvePlusLandingView", () => {
  it("returns loading when loading without data", () => {
    expect(resolvePlusLandingView({ loading: true, error: false, data: null })).toEqual({
      kind: "loading",
    });
  });

  it("returns error when error without data", () => {
    expect(resolvePlusLandingView({ loading: false, error: true, data: null })).toEqual({
      kind: "error",
    });
  });

  it("returns past_due before entitled marketing", () => {
    const data: EntitlementData = {
      ...freeOpen,
      plan: "plus",
      status: "past_due",
      plusEntitled: true,
      pastDueGrace: true,
      dbPlusEntitled: true,
      quotaPlan: "plus",
    };
    expect(resolvePlusLandingView({ loading: false, error: false, data })).toEqual({
      kind: "past_due",
      surfacesOpen: true,
    });
  });

  it("returns entitled for active plus", () => {
    const data: EntitlementData = {
      ...freeOpen,
      plan: "plus",
      status: "active",
      plusEntitled: true,
      dbPlusEntitled: true,
      quotaPlan: "plus",
    };
    expect(resolvePlusLandingView({ loading: false, error: false, data })).toEqual({
      kind: "entitled",
      surfacesOpen: true,
      trialing: false,
      trialEnd: null,
    });
  });

  it("returns incomplete without checkout", () => {
    const data: EntitlementData = { ...freeOpen, status: "incomplete" };
    expect(resolvePlusLandingView({ loading: false, error: false, data })).toEqual({
      kind: "incomplete",
      surfacesOpen: true,
    });
  });

  it("returns full with checkoutEnabled when free and surfaces open", () => {
    expect(resolvePlusLandingView({ loading: false, error: false, data: freeOpen })).toEqual({
      kind: "full",
      checkoutEnabled: true,
    });
  });

  it("returns full with checkout disabled when surfaces closed", () => {
    const data = { ...freeOpen, productSurfacesOpen: false };
    expect(resolvePlusLandingView({ loading: false, error: false, data })).toEqual({
      kind: "full",
      checkoutEnabled: false,
    });
  });

  it("never enables checkout when status is blocked even if surfaces open (belt)", () => {
    // matrix 上 incomplete は短形だが、実装が full に落ちても checkoutEnabled false を保証するヘルパを
    // isCheckoutBlockedStatus として export して unit してもよい。
    // resolve の incomplete 分岐が先なので kind は incomplete。
    const data: EntitlementData = { ...freeOpen, status: "incomplete" };
    const view = resolvePlusLandingView({ loading: false, error: false, data });
    expect(view.kind).toBe("incomplete");
  });

  it("does not treat quotaPlan alone as entitled under kill", () => {
    // plusEntitled true + surfaces closed → entitled 短形（full ではない）
    const data: EntitlementData = {
      ...freeOpen,
      plan: "plus",
      status: "active",
      plusEntitled: true,
      dbPlusEntitled: true,
      productSurfacesOpen: false,
      quotaPlan: "free",
    };
    expect(resolvePlusLandingView({ loading: false, error: false, data }).kind).toBe("entitled");
  });
});
```

- [ ] **Step 2: RED → Step 3: 実装（Locked シグネチャどおり）→ Step 4: GREEN**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/billing/plus-landing-view.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/features/billing/plus-landing-view.ts src/features/billing/plus-landing-view.test.ts
git commit -m "feat: Plus LP の entitlement 表示分岐を追加する"
```

---

### Task 5: `/plus` ルート・AppShell section・PlusLandingPage

**Files:**
- Create: `src/features/billing/plus-landing-page.tsx`
- Create: `src/features/billing/plus-landing-page.css`
- Create: `src/features/billing/plus-landing-page.test.tsx`
- Modify: `src/app/router.tsx`
- Modify: `src/app/layouts/app-shell.tsx`
- Modify: `src/app/layouts/app-shell.test.tsx`
- Modify: `src/app/router.test.tsx`（`/plus` を RequireSession 一覧に **必須**追加）
- Modify: `src/styles.css`（`[data-section="plus"]`）

**Interfaces:**
- Consumes: `resolvePlusLandingView`, `CheckoutIntervalForm`, `useEntitlement`, `useAuth`, `billing-ui-copy`、`createCheckoutSession` / `createPortalSession`
- Produces: 画面 `/plus`

**固定コピー（export してテスト exact）:**

```ts
export const PLUS_LP_H1 = "こんだて日和 Plus" as const;
export const PLUS_LP_LEAD = "献立づくりに、余裕を。" as const;
export const PLUS_LP_TRIAL =
  "はじめての方は 7 日間お試し（カード登録あり）" as const;
export const PLUS_LP_NEUTRAL_SUB = "Plus でできること" as const;
export const PLUS_LP_ACTIVE = "こんだて日和 Plus をご利用中です" as const;
export const PLUS_LP_INCOMPLETE =
  "お支払いの手続きが完了していません。設定から続きをご確認ください。" as const;
export const PLUS_LP_CANCEL = "お支払いをキャンセルしました" as const;
export const PLUS_LP_CHECKOUT_IN_PROGRESS =
  "お支払い手続きが進行中です。しばらくしてからお試しください" as const;
export const PLUS_LP_SETTINGS_LINK = "設定へ" as const;
```

surfaces 閉鎖文は設定と同一:

```ts
// インラインで同一文字列、または共有定数化
"お支払い管理は現在ご利用いただけません。"
```

- [ ] **Step 1: AppShell section テスト（RED）**

`app-shell.test.tsx` に:

```tsx
{ path: "/plus", element: <h1>Plus LP</h1> },
// ...
it("marks plus section on /plus (not settings)", () => {
  renderAppShellAt("/plus");
  expect(document.querySelector("[data-section]")).toHaveAttribute("data-section", "plus");
  // desktop-section-bar は aria-hidden だが DOM に "Plus" を持つ
  expect(document.querySelector(".desktop-section-bar")?.textContent).toBe("Plus");
});
```

`app-shell.tsx`:

```ts
if (pathname === "/plus") return "plus";
// sectionTitles
plus: "Plus",
```

`styles.css`（R-B3 必須）:

```css
[data-section="plus"] {
  --section-tint: #f6f6f4; /* settings と同値。新色を増やさない */
}
```

`router.test.tsx` の RequireSession 一覧に `"/plus"` を追加:

```ts
it.each(["/planner", "/generation", "/pantry", "/history", "/shopping", "/settings", "/plus"])(
```

- [ ] **Step 2: LP の RTL テスト（画像は後 Task でも、先に `alt=""` の img または placeholder div で可）**

注入 props で entitlement を渡せる設計:

```tsx
export type PlusLandingPageProps = {
  userId?: string;
  entitlement?: EntitlementData | null;
  entitlementLoading?: boolean;
  entitlementError?: boolean;
  onCheckout?: (interval: "month" | "year") => Promise<void>;
  onPortal?: () => Promise<void>;
};
```

テスト例（MemoryRouter + QueryClient）:

```tsx
it("shows full LP benefits and checkout when free and open", () => {
  renderLp({ entitlement: freeOpen });
  expect(screen.getByRole("heading", { level: 1, name: PLUS_LP_H1 })).toBeVisible();
  expect(screen.getByText(PLUS_LP_LEAD)).toBeVisible();
  expect(screen.getByText(PLUS_LP_TRIAL)).toBeVisible();
  expect(screen.getByRole("button", { name: "Plus をはじめる" })).toBeEnabled();
  // 比較表だけを見る（カード見出しにも同数字が出るため getByText 単独禁止 R-C3）
  const table = screen.getByTestId("plus-compare");
  expect(within(table).getByText(String(planQuota.free.successPerDay))).toBeVisible();
  expect(within(table).getByText(String(planQuota.plus.successPerDay))).toBeVisible();
});

it("disables checkout and hides trial pitch when surfaces closed", () => {
  renderLp({ entitlement: { ...freeOpen, productSurfacesOpen: false } });
  expect(screen.getByText(SURFACES_CLOSED_COPY)).toBeVisible();
  expect(screen.getByRole("button", { name: "Plus をはじめる" })).toBeDisabled();
  expect(screen.queryByText(PLUS_LP_TRIAL)).not.toBeInTheDocument();
  expect(screen.getByText(PLUS_LP_NEUTRAL_SUB)).toBeVisible();
});

it("shows past_due short form without marketing checkout", () => {
  renderLp({ entitlement: pastDue });
  expect(screen.getByText(PAST_DUE_COPY)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Plus をはじめる" })).not.toBeInTheDocument();
});

it("shows incomplete short form", () => {
  renderLp({ entitlement: { ...freeOpen, status: "incomplete" } });
  expect(screen.getByText(PLUS_LP_INCOMPLETE)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Plus をはじめる" })).not.toBeInTheDocument();
});

it("shows cancel message when billing=cancel", () => {
  renderLp({ entitlement: freeOpen, initialEntry: "/plus?billing=cancel" });
  expect(screen.getByText(PLUS_LP_CANCEL)).toBeVisible();
});

it("shows entitled short form without checkout", () => {
  renderLp({
    entitlement: {
      ...freeOpen,
      plan: "plus",
      status: "active",
      plusEntitled: true,
      dbPlusEntitled: true,
      quotaPlan: "plus",
    },
  });
  expect(screen.getByText(PLUS_LP_ACTIVE)).toBeVisible();
  expect(screen.getByRole("link", { name: PLUS_LP_SETTINGS_LINK })).toHaveAttribute(
    "href",
    "/settings",
  );
  expect(screen.queryByRole("button", { name: "Plus をはじめる" })).not.toBeInTheDocument();
});
```

Checkout エラー分岐（推奨）:

```tsx
// onCheckout が throw new Error("billing_checkout_in_progress")
// → PLUS_LP_CHECKOUT_IN_PROGRESS
```

比較表の数字 assert は **必ず** `within(screen.getByTestId("plus-compare"))` で絞る（R-C3）。

- [ ] **Step 3: RED 後にページ実装**

構造:

```tsx
<main className="page-frame plus-landing">
  <button type="button" className="... min-h-11" onClick={onBack}>戻る</button>
  {/* view.kind 分岐 */}
</main>
```

戻る（R-C1）:

```ts
const location = useLocation();
const navigate = useNavigate();
function onBack() {
  let sameOriginReferrer = false;
  try {
    const ref = document.referrer;
    sameOriginReferrer =
      ref.length > 0 && new URL(ref).origin === window.location.origin;
  } catch {
    sameOriginReferrer = false;
  }
  // SPA 内遷移、または生 a フルロード後でも同一 origin から来た場合は履歴を戻る
  if (location.key !== "default" || sameOriginReferrer) {
    void navigate(-1);
    return;
  }
  void navigate("/planner", { replace: true });
}
```

`billing=cancel`: `useSearchParams` で読み、表示後 `replace` で除去。

フル LP カード文言:

- 枠: `Plus なら 1 日最大 ${planQuota.plus.successPerDay} 回まで作成`（テンプレ組み立て。裸の 10 禁止）
- 品質: 「くわしく作る」でより丁寧な献立（回数に限りあり）
- チラシ: チラシ写真から 1 週間の献立 + 小さく「写真は長期保存しません」

比較表: `<table data-testid="plus-compare">`（必須 testid）。列は設計 L12 のみ。

画像: Task 6 前は空の `div.plus-landing__media` でも GREEN 可。ただし Task 6 で webp を必ず載せる。

router:

```tsx
{
  path: "/plus",
  lazy: async () => {
    const { PlusLandingPage } = await import("@/features/billing/plus-landing-page");
    return { Component: PlusLandingPage };
  },
},
```

- [ ] **Step 4: 対象テスト GREEN + typecheck**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/billing/plus-landing-page.test.tsx src/features/billing/plus-landing-view.test.tsx src/app/layouts/app-shell.test.tsx
```

```bash
docker compose run --rm --no-deps app npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/features/billing/plus-landing-page.tsx src/features/billing/plus-landing-page.css src/features/billing/plus-landing-page.test.tsx src/app/router.tsx src/app/layouts/app-shell.tsx src/app/layouts/app-shell.test.tsx src/app/router.test.tsx src/styles.css
git commit -m "feat: Plus ランディングページ /plus を追加する"
```

---

### Task 6: 生成イラスト 4 枚と LP ビジュアル仕上げ

**Files:**
- Create: `src/features/billing/assets/plus-hero.webp`
- Create: `src/features/billing/assets/plus-benefit-quota.webp`
- Create: `src/features/billing/assets/plus-benefit-quality.webp`
- Create: `src/features/billing/assets/plus-benefit-flyer.webp`
- Modify: `plus-landing-page.tsx` / `.css`（img 配置、カード余白、hero）

**Interfaces:**
- Produces: 同一オリジン import 可能な 4 アセット

- [ ] **Step 1: イラストを用意**

方針（いずれか、優先順）:

1. エージェントが Imagine / 画像生成ツールで **温かい食卓・料理イラスト**（写実の個人特定なし）を 4 枚生成し、WebP 化して配置
2. ローカルで既存ツールが無ければ、**軽量 SVG を webp に変換**、または一時的に高品質 PNG を `cwebp` / sharp で webp 化

制約チェック:

```bash
# 各ファイル 150KB 以下を確認（host）
wc -c src/features/billing/assets/plus-*.webp
```

- [ ] **Step 2: LP から import**

```tsx
import heroUrl from "./assets/plus-hero.webp";
import quotaUrl from "./assets/plus-benefit-quota.webp";
import qualityUrl from "./assets/plus-benefit-quality.webp";
import flyerUrl from "./assets/plus-benefit-flyer.webp";
```

```tsx
<img src={heroUrl} alt="" width={640} height={360} className="plus-landing__hero-img" />
```

カードも同様。`/// <reference types="vite/client" />` が既にあれば `*.webp` は通常解決する。typecheck が module not found のときだけ `src/vite-env.d.ts` に `declare module "*.webp"` を足す（R-B8）。

- [ ] **Step 3: CSS**

- カード: `border-radius: 20px`、surface、gap、320px で折り返し
- 画像: `max-width: 100%`、固定 aspect、`object-fit: cover`
- sticky CTA は任意（無くすならスキップ）
- `prefers-reduced-motion: reduce` で装飾 animation を切る

- [ ] **Step 4: unit が壊れないこと + format/lint 対象**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/billing/plus-landing-page.test.tsx
```

```bash
docker compose run --rm --no-deps app npm run format:check
```

```bash
docker compose run --rm --no-deps app npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/features/billing/assets src/features/billing/plus-landing-page.tsx src/features/billing/plus-landing-page.css src/vite-env.d.ts
git commit -m "feat: Plus LP にイラストとビジュアルを載せる"
```

---

### Task 7: E2E と横断検証

> **着手ゲート（必須）:** Task 1–6 の実装・unit・typecheck・lint・format:check がすべて GREEN で、既知バグが未解決のあいだは **本 Task を開始しない**。E2E は最後の受け入れであり、未修正バグの上では回さない。

**Files:**
- Modify: `e2e/specs/billing-plus.spec.ts`

- [ ] **Step 0: 着手可否チェック**

- Task 1–6 がすべて完了し、対応 unit が PASS
- 合同レビュー R-B1〜 と実装中に見つかったバグがクローズ済み
- 未解決 blocker がある場合は **ここで停止**し、E2E スクリプトを実行しない

- [ ] **Step 1: E2E を `/plus` 到達に更新**

既存「Plus を見る」可視テストのあとに:

```ts
test("Plus を見る opens /plus landing", async ({ page }) => {
  await mockEntitlement(page, freeOpenEntitlement);
  await page.goto("/planner");
  // flyer locked または hard limit が出る経路。既存 planner flyer テストと同様に
  await page.getByRole("link", { name: "Plus を見る" }).first().click();
  await expect(page).toHaveURL(/\/plus/u);
  await expect(page.getByRole("heading", { level: 1, name: "こんだて日和 Plus" })).toBeVisible();
});
```

（`freeOpenEntitlement` は既存 fixture 名に合わせる。surfaces open が必要。）

- [ ] **Step 2: E2E 実行は人間端末または専用スクリプト**

フル E2E は重い場合:

```bash
./scripts/run-e2e.sh e2e/specs/billing-plus.spec.ts
```

（プロジェクトの e2e 絞り込み引数に合わせる。ダメなら `./scripts/run-e2e.sh` 全体。）

エージェントが Docker socket 制約で失敗する場合は、コマンドを報告し人間実行結果を待つ。

- [ ] **Step 3: 横断 unit + typecheck + lint + format:check**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/billing/
```

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npm run lint
```

```bash
docker compose run --rm --no-deps app npm run format:check
```

```bash
git diff --check
```

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/billing-plus.spec.ts
git commit -m "test: Plus LP への E2E 導線を追加する"
```

- [ ] **Step 5: 設計受け入れ表の手動チェックリスト**

| シナリオ | 確認 |
|----------|------|
| Free open → Plus を見る → `/plus` | |
| Free closed → 価格見える・はじめる disabled | |
| past_due / incomplete / entitled 短形 | |
| Checkout cancel → cancel 文 | |
| Checkout success → settings poll（既存） | |
| chrome が「設定」にならない | |

---

## Spec coverage（self-review）

| 設計要件 | Task |
|----------|------|
| `/plus` カード型 LP | 5, 6 |
| CTA → `/plus` | 2 |
| 品質ゲートリンク | 2 |
| kill 中 LP + Checkout 不可 | 4, 5 |
| State matrix / incomplete | 4, 5 |
| 共有 Checkout form | 1 |
| cancel_url | 3 |
| success poll 維持 | 3（非変更）+ 5 |
| 画像 4 枚 | 6 |
| L12 比較表 planQuota | 5 |
| shell section plus + CSS tint | 5 |
| 戻る key===default | 5 |
| E2E | 7 |
| Portal 短形 | 5 |
| billing-ui-copy 循環依存回避 | 1 |
| 二重 Plus リンク unit | 2 |

## Placeholder scan

TBD / 「後で実装」なし。画像生成手段は Task 6 で 2 手段を明示。

## Type consistency

- `CheckoutIntervalForm.onSubmit(interval)` と LP / 設定の handler は `"month" | "year"`
- `resolvePlusLandingView` の `kind` を LP が網羅 switch
- `CHECKOUT_BLOCKED_STATUSES` は view モジュール（サーバ 409 集合とコメント同期）
- form は `billing-ui-copy` のみ。plan-settings ↔ form の相互 import 禁止

## 合同レビュー反映（R-B）

| ID | 修正箇所 |
|----|----------|
| R-B1 | Task 1: `billing-ui-copy.ts` |
| R-B2 | Task 2: within hard-limit / L10-4 は usageRemaining>0 |
| R-B3 | Task 5: `[data-section="plus"]` CSS |
| R-B4 | Locked view: `checkoutEnabled` に blocked AND |
| R-B5 | props 名 `onSubmit` 統一 |
| R-B6 | Task 3: `sessionsCreate` 引数に断言 |
| R-B7 | Task 5: router.test に `/plus` 必須 |
| R-B8 | Task 6: webp declare は必要時のみ |
| R-C1 | Task 5: 戻る = key + same-origin referrer |
| R-C2 | Task 2: 品質リンクは label 直後・note 前 |
| R-C3 | Task 5: plus-compare within |
| R-C4 | Task 1: SURFACES_CLOSED_COPY |
| R-C5 | design Testing onSubmit（文書側） |

---

## Execution Handoff

Plan: `docs/superpowers/plans/2026-07-30-plus-landing-page.md`  
Spec: `docs/superpowers/specs/2026-07-30-plus-landing-page-design.md`  

合同レビュー R-B / **R-C** 反映済み。実装時は Task 1→6 のあと **Task 7（E2E）は着手ゲート通過後のみ**。

**Two execution options:**

1. **Subagent-Driven（推奨）** — Task ごとに fresh subagent + レビュー
2. **Inline Execution** — このセッションで executing-plans に従い連続実装
