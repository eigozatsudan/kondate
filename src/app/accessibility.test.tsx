import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, MemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { makeMenuResultViewModel } from "@shared/testing/factories";
import type { PlannerDraftInput } from "@shared/contracts/planner";
import type { AuthGateway } from "@/features/auth/auth-gateway";
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context";
import { LoginPage } from "@/features/auth/login-page";
import { WelcomePage } from "@/features/welcome/welcome-page";
import { GenerationStatusPanel } from "@/features/generation/components/generation-status-panel";
import { MenuResult } from "@/features/generation/components/menu-result";
import { HistoryPageContent } from "@/features/history/pages/history-page";
import { PantryPageContent } from "@/features/pantry/pantry-page";
import { PlannerWizard } from "@/features/planner/components/planner-wizard";
import { createPlannerAttempt } from "@/features/planner/expired-pantry-checks";
import type { PlannerSafetyMember } from "@/features/planner/planner-safety-member";
import type { PlannerStep } from "@/features/planner/model/planner-wizard";
import { runAxe } from "@/test/axe";
import { AppShell } from "./layouts/app-shell";

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({}),
}));

const emptyDraft: PlannerDraftInput = {
  mealType: null,
  mainIngredients: [],
  cuisineGenre: null,
  targetMode: null,
  targetMemberIds: [],
  servings: null,
  timeLimitMinutes: null,
  budgetPreference: null,
  avoidIngredients: [],
  memo: "",
  pantrySelections: [],
};

const eligibleMember: PlannerSafetyMember = {
  id: "70000000-0000-4000-8000-000000000001",
  displayName: "家族1",
  ageBandLabel: "大人",
  allergyLabel: "アレルギーなし",
  safetyLabels: [],
  blockedReason: null,
};

const authenticated: AuthContextValue = {
  status: "authenticated",
  session: {
    user: { id: "10000000-0000-4000-8000-000000000001" },
  } as AuthContextValue["session"],
  refreshSession: vi.fn(),
};

function Providers({
  children,
  auth = authenticated,
}: {
  children: ReactNode;
  auth?: AuthContextValue;
}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
    </QueryClientProvider>
  );
}

async function expectAccessible(container: HTMLElement): Promise<void> {
  await expect(runAxe(container)).resolves.toMatchObject({ violations: [] });
  expect(screen.getByRole("main")).toBeVisible();
}

function renderWizard(
  step: PlannerStep,
  draft: PlannerDraftInput = emptyDraft,
  eligibleMembers: readonly PlannerSafetyMember[] = [eligibleMember],
): ReturnType<typeof render> {
  return render(
    <Providers>
      <PlannerWizard
        draft={draft}
        step={step}
        eligibleMembers={eligibleMembers}
        isSaving={false}
        error={null}
        fieldErrors={{}}
        onDraftChange={vi.fn()}
        onStepChange={vi.fn()}
        onSubmit={vi.fn(() => Promise.resolve())}
        pantryItems={[]}
        pantryItemsStatus="loaded"
        attempt={createPlannerAttempt()}
        onAttemptChange={vi.fn()}
        hasAcceptedOrDeclinedPrivacy={true}
        onOpenPrivacyNotice={vi.fn()}
      />
    </Providers>,
  );
}

function renderShellRoute(path: string, page: ReactElement): ReturnType<typeof render> {
  const router = createMemoryRouter(
    [
      {
        element: <AppShell />,
        children: [{ path, element: page }],
      },
    ],
    { initialEntries: [path] },
  );
  return render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
}

describe("route accessibility", () => {
  it("login exposes named Google control, labeled email, error live region, and no bottom nav", async () => {
    const gateway: AuthGateway = {
      signInWithGoogle: vi.fn(),
      sendMagicLink: vi.fn(),
      completeCallback: vi.fn(),
      resumeFlow: vi.fn(),
    };
    const { container } = render(
      <MemoryRouter
        initialEntries={[{ pathname: "/login", state: { authError: "oauth_cancelled" } }]}
      >
        <LoginPage gateway={gateway} />
      </MemoryRouter>,
    );

    await expectAccessible(container);
    expect(screen.queryByRole("navigation", { name: "メインメニュー" })).toBeNull();
    expect(screen.getByRole("button", { name: "Googleで続ける" })).toBeVisible();
    expect(screen.getByLabelText("メールアドレス")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(/Googleログインがキャンセル/);
  });

  it("welcome shows primary idea and secondary family setup without bottom nav or competing primaries", async () => {
    const { container } = render(
      <MemoryRouter>
        <WelcomePage
          onboardingStatus="not_started"
          onStartIdea={vi.fn(() => Promise.resolve())}
          onStartHousehold={vi.fn(() => Promise.resolve())}
        />
      </MemoryRouter>,
    );

    await expectAccessible(container);
    expect(screen.queryByRole("navigation", { name: "メインメニュー" })).toBeNull();
    expect(screen.getByRole("button", { name: "献立アイデアを考える" })).toBeVisible();
    expect(screen.getByRole("button", { name: "家族情報を登録する" })).toBeVisible();
    // 同一 weight の primary が並ばないこと（primary-button は1つだけ）
    expect(container.querySelectorAll(".primary-button")).toHaveLength(1);
    expect(container.querySelectorAll(".secondary-button")).toHaveLength(1);
  });

  it("shell pantry empty has main menu navigation and page h1", async () => {
    const { container } = renderShellRoute(
      "/pantry",
      <PantryPageContent
        items={[]}
        loading={false}
        saving={false}
        error={null}
        onCreate={vi.fn(() => Promise.resolve())}
        onUpdate={vi.fn(() => Promise.resolve())}
        onDelete={vi.fn()}
      />,
    );

    await expectAccessible(container);
    expect(screen.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "食材リスト" })).toBeVisible();
  });

  it("shell history empty has main menu navigation and page h1", async () => {
    const { container } = renderShellRoute("/history", <HistoryPageContent groups={[]} />);

    await expectAccessible(container);
    expect(screen.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "作った献立" })).toBeVisible();
  });

  it("shell shopping empty has main menu navigation and page h1", async () => {
    const { container } = renderShellRoute(
      "/shopping",
      <main className="page-frame stack">
        <h1>買い物リスト</h1>
        <p>買い物リストは空です</p>
        <a className="primary-button min-h-11" href="/history">
          献立から作る
        </a>
      </main>,
    );

    await expectAccessible(container);
    expect(screen.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "買い物リスト" })).toBeVisible();
  });

  it("shell settings empty has main menu navigation and page h1", async () => {
    const { container } = renderShellRoute(
      "/settings",
      <main className="page-frame stack">
        <h1>家族設定</h1>
        <p>家族を追加してください</p>
        <button className="primary-button" type="button">
          家族を追加
        </button>
      </main>,
    );

    await expectAccessible(container);
    expect(screen.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "家族設定" })).toBeVisible();
  });

  it("shell planner empty meal step has main menu navigation and focusable step heading", async () => {
    const { container } = renderShellRoute(
      "/planner",
      <PlannerWizard
        draft={emptyDraft}
        step="meal"
        eligibleMembers={[eligibleMember]}
        isSaving={false}
        error={null}
        fieldErrors={{}}
        onDraftChange={vi.fn()}
        onStepChange={vi.fn()}
        onSubmit={vi.fn(() => Promise.resolve())}
        pantryItems={[]}
        pantryItemsStatus="loaded"
        attempt={createPlannerAttempt()}
        onAttemptChange={vi.fn()}
        hasAcceptedOrDeclinedPrivacy={true}
        onOpenPrivacyNotice={vi.fn()}
      />,
    );

    await expectAccessible(container);
    expect(screen.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();
    const heading = screen.getByRole("heading", { name: "1. 食事" });
    expect(heading).toBeVisible();
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("button", { name: "次へ" })).toBeVisible();
  });
});

describe("wizard step accessibility", () => {
  it.each([
    { step: "meal" as const, heading: "1. 食事", primary: "次へ" },
    { step: "ingredients" as const, heading: "2. メイン食材", primary: "次へ" },
    { step: "cuisine" as const, heading: "3. ジャンル", primary: "次へ" },
    { step: "audience" as const, heading: "4. 作る相手", primary: "次へ" },
    {
      step: "review" as const,
      heading: "5. 確認",
      primary: "献立を作る",
      draft: {
        ...emptyDraft,
        mealType: "breakfast" as const,
        mainIngredients: ["鶏肉"],
        cuisineGenre: "japanese" as const,
        targetMode: "household" as const,
        targetMemberIds: [eligibleMember.id],
      },
    },
  ])(
    "$step exposes focusable heading and named primary control",
    async ({ step, heading, primary, draft }) => {
      const { container } = renderWizard(step, draft ?? emptyDraft);
      await expectAccessible(container);
      const stepHeading = screen.getByRole("heading", { name: heading });
      expect(stepHeading).toHaveAttribute("tabindex", "-1");
      expect(screen.getByRole("button", { name: primary })).toBeVisible();
      if (step !== "meal") {
        expect(screen.getByRole("button", { name: "戻る" })).toBeVisible();
      }
    },
  );

  it("audience with zero members disables family mode, keeps idea selectable, and links to registration", async () => {
    const { container } = renderWizard("audience", emptyDraft, []);
    await expectAccessible(container);

    const family = screen.getByRole("radio", { name: "家族に合わせて作る" });
    const idea = screen.getByRole("radio", { name: "人数だけ指定してアイデアを見る" });
    expect(family).toBeDisabled();
    expect(idea).not.toBeDisabled();
    expect(screen.getByRole("link", { name: "家族を追加する" })).toBeVisible();
  });

  it("idea review shows the family-skip notice and generate control", async () => {
    const { container } = renderWizard("review", {
      ...emptyDraft,
      mealType: "breakfast",
      mainIngredients: ["鶏肉"],
      cuisineGenre: "japanese",
      targetMode: "idea",
      servings: 2,
    });
    await expectAccessible(container);
    expect(screen.getByText(/家族の年齢・アレルギーは確認されません/u)).toBeVisible();
    expect(screen.getByRole("button", { name: "献立を作る" })).toBeVisible();
  });

  it("household review shows generate control named 献立を作る", async () => {
    const { container } = renderWizard("review", {
      ...emptyDraft,
      mealType: "breakfast",
      mainIngredients: ["鶏肉"],
      cuisineGenre: "japanese",
      targetMode: "household",
      targetMemberIds: [eligibleMember.id],
    });
    await expectAccessible(container);
    expect(screen.getByRole("button", { name: "献立を作る" })).toBeVisible();
  });
});

describe("generation and result accessibility", () => {
  it("generation processing exposes 献立を作っています heading or status", async () => {
    const { container } = render(
      <main className="page-frame stack">
        <GenerationStatusPanel
          state={{
            phase: "processing",
            effect: "poll",
            data: {
              status: "processing",
              idempotencyKey: "key-1",
              requestId: "req-1",
              startedAt: "2026-07-11T00:00:00.000Z",
              quota: {
                consumed: false,
                remaining: 5,
                userDailyLimit: 5,
                limitKind: "user",
                retryAt: null,
              },
            },
          }}
        />
      </main>,
    );
    await expectAccessible(container);
    expect(screen.getByRole("heading", { name: "献立を作っています" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "料理の組み合わせと全体の段取りを確認しています",
    );
  });

  it("household result may expose shopping/safety-oriented regions", async () => {
    const { container } = render(
      <main className="page-frame">
        <MenuResult result={makeMenuResultViewModel()} mode="household" />
      </main>,
    );
    await expectAccessible(container);
    expect(screen.getByRole("heading", { name: "献立ができました" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "家族向けの取り分け" })).toBeVisible();
    expect(screen.getByRole("region", { name: "原材料表示の確認" })).toBeVisible();
  });

  it("idea result shows idea notice text and omits shopping, adaptation, and label regions", async () => {
    // idea では adaptations / labelConfirmations を空にして「領域が無い」ことを検証する。
    // factory 既定は household 向けの安全領域を含むため、idea 表示境界では明示的に空にする。
    const result = makeMenuResultViewModel({ targetMode: "idea" });
    result.menu = {
      ...result.menu,
      adaptations: [],
      labelConfirmations: [],
    };
    result.labelConfirmations = [];

    const { container } = render(
      <main className="guided-planner-theme page-frame stack">
        <p role="note">家族条件を使用していません</p>
        <MenuResult result={result} mode="idea" />
      </main>,
    );
    await expectAccessible(container);
    expect(screen.getByText("家族条件を使用していません")).toBeVisible();
    expect(screen.queryByRole("button", { name: "買い物リストを作る" })).toBeNull();
    expect(screen.queryByRole("button", { name: "買い物リストとの差分を確認" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "家族向けの取り分け" })).toBeNull();
    expect(screen.queryByRole("region", { name: "原材料表示の確認" })).toBeNull();
    // idea ではラベル確認見出しそのものもツリーに出さない
    expect(screen.queryByText("加工品は原材料表示を確認してください")).toBeNull();
  });
});
