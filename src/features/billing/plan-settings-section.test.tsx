import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { EntitlementData } from "@shared/contracts/billing";
import {
  INCOMPLETE_COPY,
  PAST_DUE_COPY,
  PORTAL_BUTTON_LABEL,
  PlanSettingsSection,
  STRIPE_REDIRECT_NOTICE,
  TRIAL_END_WARNING,
  YEARLY_CONFIRM_COPY,
} from "./plan-settings-section";
import {
  PLUS_LP_COMING_SOON_BADGE,
  PLUS_LP_COMING_SOON_BODY,
  PLUS_LP_UPGRADE_COMING_SOON,
} from "./plus-upgrade-gate";

// 注入 props で描画するため API は呼ばないが、hook が Query を立てるので失敗させない
vi.mock("./billing-api", () => ({
  getEntitlement: vi.fn(() =>
    Promise.resolve({
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
    }),
  ),
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
}));

const freeEntitlement: EntitlementData = {
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

const trialingEntitlement: EntitlementData = {
  ...freeEntitlement,
  plan: "plus",
  status: "trialing",
  plusEntitled: true,
  trialEnd: "2026-08-05T15:00:00.000Z",
  dbPlusEntitled: true,
  quotaPlan: "plus",
};

const pastDueEntitlement: EntitlementData = {
  ...freeEntitlement,
  plan: "plus",
  status: "past_due",
  plusEntitled: true,
  pastDueGrace: true,
  currentPeriodEnd: "2026-08-20T15:00:00.000Z",
  dbPlusEntitled: true,
  quotaPlan: "plus",
};

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

// useEntitlement は QueryClient 必須。注入 props で API を踏まず描画する。
function renderPlan(props: Partial<ComponentProps<typeof PlanSettingsSection>> = {}) {
  return renderWithClient(
    <PlanSettingsSection
      userId="user-1"
      entitlement={freeEntitlement}
      entitlementLoading={false}
      entitlementError={false}
      {...props}
    />,
  );
}

describe("PlanSettingsSection", () => {
  it("shows Free plan copy and aligns checkout gate with Plus LP coming-soon", () => {
    renderPlan();
    expect(screen.getByText(/こんだて日和 Plus なら/)).toBeVisible();
    // BILL-1: COMING_SOON 中は Settings も Checkout を出さない（LP と矛盾させない）
    if (PLUS_LP_UPGRADE_COMING_SOON) {
      expect(screen.getByText(PLUS_LP_COMING_SOON_BADGE)).toBeVisible();
      expect(screen.getByText(PLUS_LP_COMING_SOON_BODY)).toBeVisible();
      expect(screen.queryByRole("button", { name: "Plus をはじめる" })).not.toBeInTheDocument();
    } else {
      expect(screen.getAllByText(/月額 580 円/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/年額 5,800 円/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole("button", { name: "Plus をはじめる" })).toBeVisible();
      expect(screen.getByText(STRIPE_REDIRECT_NOTICE)).toBeVisible();
    }
  });

  it("shows trial end warning copy while trialing", () => {
    renderPlan({ entitlement: trialingEntitlement });
    expect(screen.getByText(TRIAL_END_WARNING)).toBeVisible();
    expect(screen.getByText(/無料期間が終わると/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Plus をはじめる" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: PORTAL_BUTTON_LABEL })).toBeVisible();
  });

  it("shows past_due payment update path to portal", async () => {
    const onPortal = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    renderPlan({ entitlement: pastDueEntitlement, onPortal });
    expect(screen.getByText(PAST_DUE_COPY)).toBeVisible();
    const portal = screen.getByRole("button", { name: PORTAL_BUTTON_LABEL });
    expect(portal).toBeVisible();
    await user.click(portal);
    await waitFor(() => {
      expect(onPortal).toHaveBeenCalledTimes(1);
    });
  });

  // B1: incomplete は Checkout 409 が Portal 完了を指示する。Settings も LP 同様 Portal CTA を出す
  it("shows incomplete portal CTA and does not offer checkout (B1)", async () => {
    const onPortal = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    const incompleteEntitlement: EntitlementData = {
      ...freeEntitlement,
      status: "incomplete",
      plusEntitled: false,
      dbPlusEntitled: false,
      productSurfacesOpen: true,
    };
    renderPlan({ entitlement: incompleteEntitlement, onPortal });
    expect(screen.getByText(INCOMPLETE_COPY)).toBeVisible();
    const portal = screen.getByRole("button", { name: PORTAL_BUTTON_LABEL });
    expect(portal).toBeVisible();
    // COMING_SOON や Checkout フォームに落とさない
    expect(screen.queryByText(PLUS_LP_COMING_SOON_BADGE)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Plus をはじめる" })).not.toBeInTheDocument();
    await user.click(portal);
    await waitFor(() => {
      expect(onPortal).toHaveBeenCalledTimes(1);
    });
  });

  it("requires yearly confirmation before checkout and shows fixed copy", async () => {
    if (PLUS_LP_UPGRADE_COMING_SOON) return;
    const onCheckout = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    renderPlan({ onCheckout });
    await user.click(screen.getByLabelText(/年額 5,800 円/));
    expect(screen.getByText(YEARLY_CONFIRM_COPY)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Plus をはじめる" }));
    expect(onCheckout).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText(YEARLY_CONFIRM_COPY));
    await user.click(screen.getByRole("button", { name: "Plus をはじめる" }));
    await waitFor(() => {
      expect(onCheckout).toHaveBeenCalledWith("year");
    });
  });

  it("starts monthly checkout without year confirm", async () => {
    if (PLUS_LP_UPGRADE_COMING_SOON) return;
    const onCheckout = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    renderPlan({ onCheckout });
    await user.click(screen.getByRole("button", { name: "Plus をはじめる" }));
    await waitFor(() => {
      expect(onCheckout).toHaveBeenCalledWith("month");
    });
  });

  // B9: Checkout が Stripe live を use_portal で返したとき Free 枝でも Portal CTA を出す
  it("shows portal CTA on free branch after checkout use_portal block (B9)", async () => {
    if (PLUS_LP_UPGRADE_COMING_SOON) return;
    const onCheckout = vi.fn(() => Promise.reject(new Error("billing_checkout_use_portal")));
    const onPortal = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    renderPlan({ onCheckout, onPortal });
    await user.click(screen.getByRole("button", { name: "Plus をはじめる" }));
    await waitFor(() => {
      expect(
        screen.getByText(/お支払い管理から手続きしてください。新規のお申し込みはできません/),
      ).toBeVisible();
    });
    const portal = screen.getByRole("button", { name: PORTAL_BUTTON_LABEL });
    expect(portal).toBeVisible();
    await user.click(portal);
    await waitFor(() => {
      expect(onPortal).toHaveBeenCalledTimes(1);
    });
  });

  // B9: Checkout 成功後の poll 中は Free でも Portal 導線を残す
  it("shows portal CTA while polling after checkout success while still free (B9)", async () => {
    const onPortal = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    renderPlan({ pollAfterCheckoutSuccess: true, onPortal });
    expect(screen.getByText(/お支払いの反映を確認しています/)).toBeVisible();
    const portal = screen.getByRole("button", { name: PORTAL_BUTTON_LABEL });
    expect(portal).toBeVisible();
    await user.click(portal);
    await waitFor(() => {
      expect(onPortal).toHaveBeenCalledTimes(1);
    });
  });

  // B17: COMING_SOON 中でも Free 枝に Portal CTA（cold free+live の管理導線）
  it("shows portal CTA on free branch under COMING_SOON (B17)", async () => {
    if (!PLUS_LP_UPGRADE_COMING_SOON) return;
    const onPortal = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    renderPlan({ onPortal });
    expect(screen.getByText(PLUS_LP_COMING_SOON_BADGE)).toBeVisible();
    const portal = screen.getByRole("button", { name: PORTAL_BUTTON_LABEL });
    expect(portal).toBeVisible();
    await user.click(portal);
    await waitFor(() => {
      expect(onPortal).toHaveBeenCalledTimes(1);
    });
  });

  it("does not offer checkout beside portal after past_due grace expires (B10)", () => {
    renderPlan({
      entitlement: {
        ...pastDueEntitlement,
        plusEntitled: false,
        pastDueGrace: false,
        dbPlusEntitled: false,
        quotaPlan: "free",
      },
    });
    expect(screen.getByText(PAST_DUE_COPY)).toBeVisible();
    expect(screen.getByRole("button", { name: PORTAL_BUTTON_LABEL })).toBeVisible();
    expect(screen.queryByText(/こんだて日和 Plus なら/)).not.toBeInTheDocument();
    expect(screen.queryByText(PLUS_LP_COMING_SOON_BADGE)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Plus をはじめる" })).not.toBeInTheDocument();
  });

  it("does not show stale trial or past_due blocks when entitlement fetch errors (B11)", () => {
    renderPlan({ entitlement: trialingEntitlement, entitlementError: true });
    expect(screen.getByText(/いまのプラン:/).textContent).toContain("無料プラン");
    expect(screen.queryByText(TRIAL_END_WARNING)).not.toBeInTheDocument();
    expect(screen.queryByText(PAST_DUE_COPY)).not.toBeInTheDocument();
  });

  // B25: plan=plus でも plusEntitled=false なら無料ラベル（表示 DiD）
  it("labels free when plan is plus but plusEntitled is false (B25)", () => {
    renderPlan({
      entitlement: {
        ...freeEntitlement,
        plan: "plus",
        status: "none",
        plusEntitled: false,
        dbPlusEntitled: false,
        quotaPlan: "free",
      },
    });
    expect(screen.getByText(/いまのプラン:/).textContent).toContain("無料プラン");
    expect(screen.getByText(/いまのプラン:/).textContent).not.toContain("こんだて日和 Plus");
  });
});
