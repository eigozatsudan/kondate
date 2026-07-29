import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { EntitlementData } from "@shared/contracts/billing";
import {
  PAST_DUE_COPY,
  PORTAL_BUTTON_LABEL,
  PlanSettingsSection,
  STRIPE_REDIRECT_NOTICE,
  TRIAL_END_WARNING,
  YEARLY_CONFIRM_COPY,
} from "./plan-settings-section";

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
  it("shows Free plan price and Plus をはじめる CTA when not entitled", () => {
    renderPlan();
    // 価格は一覧とラジオに出るので all で存在を確認
    expect(screen.getAllByText(/月額 580 円/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/年額 5,800 円/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Plus をはじめる" })).toBeVisible();
    expect(screen.getByText(STRIPE_REDIRECT_NOTICE)).toBeVisible();
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

  it("requires yearly confirmation before checkout and shows fixed copy", async () => {
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
    const onCheckout = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    renderPlan({ onCheckout });
    await user.click(screen.getByRole("button", { name: "Plus をはじめる" }));
    await waitFor(() => {
      expect(onCheckout).toHaveBeenCalledWith("month");
    });
  });
});
