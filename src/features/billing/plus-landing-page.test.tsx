import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it, vi } from "vitest";
import type { EntitlementData } from "@shared/contracts/billing";
import { planQuota } from "@shared/contracts/plan-quota";
import { PAST_DUE_COPY, PORTAL_BUTTON_LABEL, SURFACES_CLOSED_COPY } from "./billing-ui-copy";
import {
  PLUS_LP_ACTIVE,
  PLUS_LP_CANCEL,
  PLUS_LP_COMING_SOON_BADGE,
  PLUS_LP_COMING_SOON_BODY,
  PLUS_LP_FEATURES_TITLE,
  PLUS_LP_FLYER_TITLE,
  PLUS_LP_H1,
  PLUS_LP_INCOMPLETE,
  PLUS_LP_LEAD,
  PLUS_LP_LEAD_BODY,
  PLUS_LP_NEUTRAL_SUB,
  PLUS_LP_QUALITY_TITLE,
  PLUS_LP_QUOTA_TITLE,
  PLUS_LP_SETTINGS_LINK,
  PLUS_LP_UPGRADE_COMING_SOON,
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
    expect(screen.getByText(PLUS_LP_LEAD_BODY)).toBeVisible();
    // 開発中クローズ中はトライアル訴求を隠し、ニュートラル副題を出す
    expect(screen.getByText(PLUS_LP_NEUTRAL_SUB)).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: PLUS_LP_FEATURES_TITLE })).toBeVisible();
    expect(screen.getByRole("heading", { level: 3, name: PLUS_LP_QUOTA_TITLE })).toBeVisible();
    expect(screen.getByRole("heading", { level: 3, name: PLUS_LP_QUALITY_TITLE })).toBeVisible();
    expect(screen.getByRole("heading", { level: 3, name: PLUS_LP_FLYER_TITLE })).toBeVisible();
    // 一時クローズ: 申込ボタンは無効 + 開発中バナー
    expect(PLUS_LP_UPGRADE_COMING_SOON).toBe(true);
    expect(screen.getByRole("button", { name: "Plus をはじめる" })).toBeDisabled();
    expect(screen.getByTestId("plus-coming-soon")).toBeVisible();
    expect(screen.getByText(PLUS_LP_COMING_SOON_BODY)).toBeVisible();
    expect(screen.getByText(new RegExp(PLUS_LP_COMING_SOON_BADGE, "u"))).toBeVisible();
    // 比較表だけを見る（カードにも同数字が出るため getByText 単独禁止 R-C3）
    const table = screen.getByTestId("plus-compare");
    expect(within(table).getByText(String(planQuota.free.successPerDay))).toBeVisible();
    expect(within(table).getByText(String(planQuota.plus.successPerDay))).toBeVisible();
    const imgs = document.querySelectorAll("main img");
    expect(imgs.length).toBe(4);
    expect(document.querySelector(".plus-landing__hero-img")).not.toBeNull();
    expect(document.querySelectorAll(".plus-landing__card-img")).toHaveLength(3);
  });

  it("disables checkout and hides trial pitch when surfaces closed", () => {
    renderLp({ entitlement: { ...freeOpen, productSurfacesOpen: false } });
    // 開発中バナーが surfaces クローズ文言より優先（二重表示しない）
    if (PLUS_LP_UPGRADE_COMING_SOON) {
      expect(screen.getByText(PLUS_LP_COMING_SOON_BODY)).toBeVisible();
      expect(screen.queryByText(SURFACES_CLOSED_COPY)).not.toBeInTheDocument();
    } else {
      expect(screen.getByText(SURFACES_CLOSED_COPY)).toBeVisible();
    }
    expect(screen.getByRole("button", { name: "Plus をはじめる" })).toBeDisabled();
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

  it("keeps Plus start button non-interactive while upgrade is under development", async () => {
    const onCheckout = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    renderLp({ entitlement: freeOpen, onCheckout });
    const button = screen.getByRole("button", { name: "Plus をはじめる" });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onCheckout).not.toHaveBeenCalled();
  });

  // B18: Settings と同型。use_portal で Portal CTA を出し generic で閉じない
  it("maps checkout use_portal to portal CTA like Settings (B18)", async () => {
    if (PLUS_LP_UPGRADE_COMING_SOON) return;
    const onCheckout = vi.fn(() => Promise.reject(new Error("billing_checkout_use_portal")));
    const onPortal = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    renderLp({ entitlement: freeOpen, onCheckout, onPortal });
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
});
