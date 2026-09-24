import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EntitlementData } from "@shared/contracts/billing";
import { planQuota } from "@shared/contracts/plan-quota";
import { PAST_DUE_COPY, PORTAL_BUTTON_LABEL, SURFACES_CLOSED_COPY } from "./billing-ui-copy";
import {
  PLUS_LP_ACTIVE,
  PLUS_LP_CANCEL,
  PLUS_LP_FLYER_BODY,
  PLUS_LP_QUALITY_BODY,
  PLUS_LP_QUOTA_BODY,
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

// 今週の献立 UI フラグを試験ごとに切り替える（getter で import 側から毎回読ませる）
const weeklyFlag = vi.hoisted(() => ({ enabled: true }));
vi.mock("@shared/contracts/weekly-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shared/contracts/weekly-plan")>();
  return {
    ...actual,
    get WEEKLY_PLAN_UI_ENABLED() {
      return weeklyFlag.enabled;
    },
  };
});

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

const plusActive: EntitlementData = {
  ...freeOpen,
  plan: "plus",
  status: "active",
  plusEntitled: true,
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
  it.each([false, true])("shows developer Plus without payment prompts (billing=%s)", (enabled) => {
    renderLp({
      entitlement: {
        ...freeOpen,
        developerPlus: true,
        plusEntitled: true,
        quotaPlan: "plus",
        productSurfacesOpen: enabled,
      },
    });
    expect(
      screen.getByRole("heading", { name: "こんだて日和 Plus（開発者・無料）" }),
    ).toBeVisible();
    if (enabled) {
      expect(
        screen.getByRole("button", { name: PORTAL_BUTTON_LABEL, hidden: true }),
      ).not.toBeVisible();
    } else {
      expect(screen.queryByRole("button", { name: PORTAL_BUTTON_LABEL })).not.toBeInTheDocument();
    }
    expect(screen.queryByText("一部機能は現在ご利用いただけません")).not.toBeInTheDocument();
  });

  it("keeps payment management for developers with an existing subscription", () => {
    renderLp({
      entitlement: {
        ...freeOpen,
        status: "active",
        developerPlus: true,
        plusEntitled: true,
        quotaPlan: "plus",
      },
    });
    expect(screen.getByRole("button", { name: PORTAL_BUTTON_LABEL })).toBeVisible();
    expect(screen.getByText(/既存の有料契約は自動では解約されません/)).toBeVisible();
  });

  it.each([false, true])(
    "keeps optional past-contract management for developers (billing=%s)",
    async (enabled) => {
      const onPortal = vi.fn(() => Promise.resolve());
      const user = userEvent.setup();
      renderLp({
        entitlement: {
          ...freeOpen,
          developerPlus: true,
          plusEntitled: true,
          quotaPlan: "plus",
          productSurfacesOpen: enabled,
        },
        onPortal,
      });
      const summary = screen.getByText("以前に有料プランを契約した方");
      const details = summary.closest("details");
      expect(details?.open).toBe(false);
      if (enabled) {
        expect(
          screen.getByRole("button", { name: PORTAL_BUTTON_LABEL, hidden: true }),
        ).not.toBeVisible();
      } else {
        expect(screen.queryByRole("button", { name: PORTAL_BUTTON_LABEL })).not.toBeInTheDocument();
      }
      expect(screen.queryByRole("button", { name: "Plus をはじめる" })).not.toBeInTheDocument();
      await user.click(summary);
      expect(details?.open).toBe(true);
      expect(screen.getByText(/有料契約が残っている場合/)).toBeVisible();
      if (enabled) {
        expect(screen.getByRole("button", { name: PORTAL_BUTTON_LABEL })).toBeVisible();
        await user.click(screen.getByRole("button", { name: PORTAL_BUTTON_LABEL }));
        expect(onPortal).toHaveBeenCalledOnce();
      } else {
        expect(screen.queryByRole("button", { name: PORTAL_BUTTON_LABEL })).not.toBeInTheDocument();
        expect(screen.getByText(/お支払い管理は現在停止しています/)).toBeVisible();
        expect(onPortal).not.toHaveBeenCalled();
      }
    },
  );

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

  // B2: cache がある再 fetch（focus / 30s stale）で加入中 Portal を捨てない。
  // Settings は loading && data === null だけスピナー。LP も同じ入力にする。
  it("keeps entitled portal while refetching cached entitlement (B2)", () => {
    renderLp({
      entitlement: {
        ...freeOpen,
        plan: "plus",
        status: "active",
        plusEntitled: true,
        dbPlusEntitled: true,
        quotaPlan: "plus",
      },
      entitlementLoading: true,
    });
    expect(screen.getByText(PLUS_LP_ACTIVE)).toBeVisible();
    expect(screen.getByRole("button", { name: PORTAL_BUTTON_LABEL })).toBeVisible();
    expect(screen.getByRole("link", { name: PLUS_LP_SETTINGS_LINK })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(screen.queryByText("プラン情報を確認しています…")).not.toBeInTheDocument();
  });

  it("shows loading short form only when entitlement cache is empty (B2)", () => {
    renderLp({ entitlement: null, entitlementLoading: true });
    expect(screen.getByText("プラン情報を確認しています…")).toBeVisible();
    expect(screen.queryByText(PLUS_LP_ACTIVE)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: PORTAL_BUTTON_LABEL })).not.toBeInTheDocument();
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

  it("no longer mentions チラシ anywhere in the LEAD, card, or comparison table", () => {
    renderLp({ entitlement: freeOpen });
    expect(screen.queryByText(/チラシ/)).not.toBeInTheDocument();
  });

  it("describes 今週の献立 in the third benefit card", () => {
    renderLp({ entitlement: freeOpen });
    expect(screen.getByRole("heading", { level: 3, name: PLUS_LP_FLYER_TITLE })).toBeVisible();
    expect(
      screen.getByText("家族の条件から1週間分の献立の骨組みをつくれます（Plus だけの機能です）。"),
    ).toBeInTheDocument();
  });

  it("shows '今週の献立' as the comparison table row heading", () => {
    renderLp({ entitlement: freeOpen });
    expect(screen.getByRole("rowheader", { name: "今週の献立" })).toBeInTheDocument();
  });
});

// 更新日の表示は現在時刻と比べるため、時計を固定する（2026-09-24 09:00 JST）
const FIXED_NOW = new Date("2026-09-24T00:00:00.000Z");

describe("PlusLandingPage entitled benefits and period", () => {
  afterEach(() => {
    weeklyFlag.enabled = true;
  });

  it("lists the three Plus benefits with links to weekly and planner", () => {
    renderLp({ entitlement: plusActive });
    const section = screen.getByRole("region", { name: PLUS_LP_NEUTRAL_SUB });
    expect(within(section).getByRole("heading", { name: PLUS_LP_QUOTA_TITLE })).toBeVisible();
    expect(within(section).getByText(PLUS_LP_QUOTA_BODY)).toBeVisible();
    expect(within(section).getByRole("heading", { name: PLUS_LP_QUALITY_TITLE })).toBeVisible();
    expect(within(section).getByText(PLUS_LP_QUALITY_BODY)).toBeVisible();
    expect(within(section).getByRole("heading", { name: PLUS_LP_FLYER_TITLE })).toBeVisible();
    expect(within(section).getByText(PLUS_LP_FLYER_BODY)).toBeVisible();
    expect(within(section).getByRole("link", { name: "今週の献立をつくる" })).toHaveAttribute(
      "href",
      "/weekly",
    );
    expect(within(section).getByRole("link", { name: "今日の献立をつくる" })).toHaveAttribute(
      "href",
      "/planner",
    );
    // 枠の余裕はリンクなし（リンクは 2 つだけ）
    expect(within(section).getAllByRole("link")).toHaveLength(2);
    // 既存の 2 ボタンは残す
    expect(screen.getByRole("button", { name: PORTAL_BUTTON_LABEL })).toBeVisible();
    expect(screen.getByRole("link", { name: PLUS_LP_SETTINGS_LINK })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  it("hides the weekly link when the weekly plan UI flag is off", () => {
    weeklyFlag.enabled = false;
    renderLp({ entitlement: plusActive });
    const section = screen.getByRole("region", { name: PLUS_LP_NEUTRAL_SUB });
    expect(within(section).queryByRole("link", { name: "今週の献立をつくる" })).toBeNull();
    expect(within(section).getByRole("link", { name: "今日の献立をつくる" })).toHaveAttribute(
      "href",
      "/planner",
    );
  });

  it("keeps the benefits as text only while some features are stopped", () => {
    renderLp({ entitlement: { ...plusActive, productSurfacesOpen: false } });
    expect(screen.getByText("一部機能は現在ご利用いただけません")).toBeVisible();
    const section = screen.getByRole("region", { name: PLUS_LP_NEUTRAL_SUB });
    expect(within(section).getByRole("heading", { name: PLUS_LP_FLYER_TITLE })).toBeVisible();
    expect(within(section).queryAllByRole("link")).toHaveLength(0);
  });

  it("shows the next renewal date in JST long style", () => {
    renderLp({
      entitlement: { ...plusActive, currentPeriodEnd: "2026-10-22T15:00:00.000Z" },
      now: FIXED_NOW,
    });
    expect(screen.getByText("次回の更新日: 2026年10月23日")).toBeVisible();
    expect(screen.queryByText(/Plus が終了します/u)).not.toBeInTheDocument();
  });

  it("shows the end date without renewal when cancel_at_period_end is set", () => {
    renderLp({
      entitlement: {
        ...plusActive,
        currentPeriodEnd: "2026-10-22T15:00:00.000Z",
        cancelAtPeriodEnd: true,
      },
      now: FIXED_NOW,
    });
    expect(screen.getByText("2026年10月23日に Plus が終了します（自動更新なし）")).toBeVisible();
    expect(screen.queryByText(/次回の更新日/u)).not.toBeInTheDocument();
  });

  it("shows the end date without renewal for a canceled subscription still in period", () => {
    renderLp({
      entitlement: {
        ...plusActive,
        status: "canceled",
        currentPeriodEnd: "2026-10-22T15:00:00.000Z",
      },
      now: FIXED_NOW,
    });
    expect(screen.getByText("2026年10月23日に Plus が終了します（自動更新なし）")).toBeVisible();
    expect(screen.queryByText(/次回の更新日/u)).not.toBeInTheDocument();
  });

  it.each([false, true])(
    "shows no period line when currentPeriodEnd is null (cancelAtPeriodEnd=%s)",
    (cancelAtPeriodEnd) => {
      renderLp({ entitlement: { ...plusActive, currentPeriodEnd: null, cancelAtPeriodEnd } });
      expect(screen.getByText(PLUS_LP_ACTIVE)).toBeVisible();
      expect(screen.queryByText(/次回の更新日/u)).not.toBeInTheDocument();
      expect(screen.queryByText(/Plus が終了します/u)).not.toBeInTheDocument();
    },
  );

  it.each([false, true])(
    "hides a period end that is already in the past (cancelAtPeriodEnd=%s)",
    (cancelAtPeriodEnd) => {
      // webhook が遅れて期間末が古いまま残っても、過去の日付を断言しない
      renderLp({
        entitlement: {
          ...plusActive,
          currentPeriodEnd: "2026-09-23T15:00:00.000Z",
          cancelAtPeriodEnd,
        },
        now: FIXED_NOW,
      });
      expect(screen.getByText(PLUS_LP_ACTIVE)).toBeVisible();
      expect(screen.queryByText(/次回の更新日/u)).not.toBeInTheDocument();
      expect(screen.queryByText(/Plus が終了します/u)).not.toBeInTheDocument();
    },
  );

  it("hides a period end equal to now", () => {
    renderLp({
      entitlement: { ...plusActive, currentPeriodEnd: FIXED_NOW.toISOString() },
      now: FIXED_NOW,
    });
    expect(screen.queryByText(/次回の更新日/u)).not.toBeInTheDocument();
  });

  it("places payment management above the benefit cards and settings below them", () => {
    renderLp({
      entitlement: { ...plusActive, currentPeriodEnd: "2026-10-22T15:00:00.000Z" },
      now: FIXED_NOW,
    });
    const heading = screen.getByRole("heading", { level: 1, name: PLUS_LP_ACTIVE });
    const period = screen.getByText("次回の更新日: 2026年10月23日");
    const portal = screen.getByRole("button", { name: PORTAL_BUTTON_LABEL });
    const benefits = screen.getByRole("region", { name: PLUS_LP_NEUTRAL_SUB });
    const settings = screen.getByRole("link", { name: PLUS_LP_SETTINGS_LINK });
    const ordered = [heading, period, portal, benefits, settings];
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const current = ordered[i];
      const next = ordered[i + 1];
      if (current === undefined || next === undefined) throw new Error("missing element");
      expect(current.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
  });

  it("prefers the trial end over the renewal date while trialing", () => {
    renderLp({
      entitlement: {
        ...plusActive,
        status: "trialing",
        trialEnd: "2026-09-30T15:00:00.000Z",
        currentPeriodEnd: "2026-09-30T15:00:00.000Z",
      },
    });
    expect(screen.getByText("無料期間の終了: 2026年10月1日")).toBeVisible();
    expect(screen.queryByText(/次回の更新日/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/Plus が終了します/u)).not.toBeInTheDocument();
  });
});
