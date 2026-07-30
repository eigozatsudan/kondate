import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it, vi } from "vitest";
import type { EntitlementData } from "@shared/contracts/billing";
import { planQuota } from "@shared/contracts/plan-quota";
import { PAST_DUE_COPY, SURFACES_CLOSED_COPY } from "./billing-ui-copy";
import {
  PLUS_LP_ACTIVE,
  PLUS_LP_CANCEL,
  PLUS_LP_CHECKOUT_IN_PROGRESS,
  PLUS_LP_H1,
  PLUS_LP_INCOMPLETE,
  PLUS_LP_LEAD,
  PLUS_LP_NEUTRAL_SUB,
  PLUS_LP_SETTINGS_LINK,
  PLUS_LP_TRIAL,
  PlusLandingPage,
} from "./plus-landing-page";

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

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({ session: { user: { id: "user-1" } } }),
}));

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

const pastDue: EntitlementData = {
  ...freeOpen,
  plan: "plus",
  status: "past_due",
  plusEntitled: true,
  pastDueGrace: true,
  currentPeriodEnd: "2026-08-20T15:00:00.000Z",
  dbPlusEntitled: true,
  quotaPlan: "plus",
};

function renderLp(
  props: Partial<ComponentProps<typeof PlusLandingPage>> & { initialEntry?: string } = {},
) {
  const { initialEntry = "/plus", ...pageProps } = props;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        path: "/plus",
        element: (
          <PlusLandingPage
            userId="user-1"
            entitlement={freeOpen}
            entitlementLoading={false}
            entitlementError={false}
            {...pageProps}
          />
        ),
      },
      { path: "/settings", element: <h1>設定</h1> },
      { path: "/planner", element: <h1>献立</h1> },
    ],
    { initialEntries: [initialEntry] },
  );
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("PlusLandingPage", () => {
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

  it("shows in-progress message when checkout returns billing_checkout_in_progress", async () => {
    const onCheckout = vi.fn(() => Promise.reject(new Error("billing_checkout_in_progress")));
    const user = userEvent.setup();
    renderLp({ entitlement: freeOpen, onCheckout });
    await user.click(screen.getByRole("button", { name: "Plus をはじめる" }));
    await waitFor(() => {
      expect(screen.getByText(PLUS_LP_CHECKOUT_IN_PROGRESS)).toBeVisible();
    });
  });
});
