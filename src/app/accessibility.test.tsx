import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, MemoryRouter, NavLink } from "react-router";
import { RouterProvider } from "react-router/dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { makeMenuResultViewModel } from "@shared/testing/factories";
import type { PlannerDraftInput } from "@shared/contracts/planner";
import type { AuthGateway } from "@/features/auth/auth-gateway";
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context";
import { LoginPage } from "@/features/auth/login-page";
import { WelcomePage } from "@/features/welcome/welcome-page";
import { GenerationStatusPanel } from "@/features/generation/components/generation-status-panel";
import { MenuResultPage } from "@/features/generation/pages/menu-result-page";
import {
  HouseholdSettingsForm,
  type HouseholdSettingsApi,
} from "@/features/household/household-settings-page";
import { HistoryPageContent } from "@/features/history/pages/history-page";
import { PantryPageContent } from "@/features/pantry/pantry-page";
import { PlannerWizard } from "@/features/planner/components/planner-wizard";
import { createPlannerAttempt } from "@/features/planner/expired-pantry-checks";
import type { PlannerSafetyMember } from "@/features/planner/planner-safety-member";
import type { PlannerStep } from "@/features/planner/model/planner-wizard";
import { ShoppingListPage } from "@/features/shopping/pages/shopping-list-page";
import { runAxe } from "@/test/axe";
import { AppShell } from "./layouts/app-shell";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const MENU_ID = "30000000-0000-4000-8000-000000000001";

const getMenuResultMock = vi.hoisted(() => vi.fn());
const getUsageTodayMock = vi.hoisted(() => vi.fn());
const revalidateMenuMock = vi.hoisted(() => vi.fn());
const shoppingApiMocks = vi.hoisted(() => ({
  fetchActiveShoppingList: vi.fn(),
  revalidateActiveShoppingList: vi.fn(),
  mutateShoppingItem: vi.fn(),
  createShoppingList: vi.fn(),
  reconcileShoppingListRequest: vi.fn(),
  previewShoppingDiff: vi.fn(),
  fetchReconcilableMenuSource: vi.fn(),
}));

vi.mock("@/features/generation/api/menu-result-api", () => ({
  getMenuResult: getMenuResultMock,
}));

vi.mock("@/features/generation/api/usage-today-api", () => ({
  getUsageToday: getUsageTodayMock,
}));

vi.mock("@/features/history/api/revalidation-api", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/features/history/api/revalidation-api")>();
  return { ...original, revalidateMenu: revalidateMenuMock };
});

vi.mock("@/features/shopping/api/shopping-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/shopping/api/shopping-api")>();
  return { ...original, ...shoppingApiMocks };
});

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: USER_ID } }, error: null }),
      getSession: () =>
        Promise.resolve({
          data: { session: { access_token: "test-token", user: { id: USER_ID } } },
          error: null,
        }),
    },
    channel: () => {
      const api = {
        on: () => api,
        subscribe: () => api,
        unsubscribe: vi.fn(),
      };
      return api;
    },
    removeChannel: vi.fn(),
  }),
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
    user: { id: USER_ID },
  } as AuthContextValue["session"],
  refreshSession: vi.fn(),
};

beforeEach(() => {
  getMenuResultMock.mockReset();
  getUsageTodayMock.mockReset();
  revalidateMenuMock.mockReset();
  shoppingApiMocks.fetchActiveShoppingList.mockReset();
  shoppingApiMocks.revalidateActiveShoppingList.mockReset();
  shoppingApiMocks.fetchActiveShoppingList.mockResolvedValue(null);
  shoppingApiMocks.revalidateActiveShoppingList.mockResolvedValue({
    status: "valid",
    safetyFingerprint: "f".repeat(64),
    checkedSourceMenuIds: [],
    currentLabelWarnings: [],
    issues: [],
  });
  shoppingApiMocks.fetchReconcilableMenuSource.mockResolvedValue(null);
  getUsageTodayMock.mockResolvedValue({
    success: { consumed: 1, limit: 5, remaining: 4 },
    attempts: { sent: 0, limit: 12, remaining: 12 },
    shortWindow: { sent: 0, limit: 4, remaining: 4, retryAt: null },
    globalAvailable: true,
    retryAt: null,
  });
  revalidateMenuMock.mockResolvedValue({
    status: "valid",
    safetyFingerprint: "current",
    allergenCatalogVersion: "allergens-v3",
    foodRuleVersion: "food-v2",
    issues: [],
    changedDetails: [],
    currentLabelWarnings: [],
  });
});

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

  it("shell shopping empty uses real ShoppingListPage structure", async () => {
    const { container } = renderShellRoute("/shopping", <ShoppingListPage />);

    expect(await screen.findByRole("heading", { level: 1, name: "買い物リスト" })).toBeVisible();
    await expectAccessible(container);
    expect(screen.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();
    expect(screen.getByText("買い物リストは空です")).toBeVisible();
    expect(screen.getByRole("link", { name: "献立から作る" })).toBeVisible();
  });

  it("shell settings empty uses real HouseholdSettingsForm structure", async () => {
    const api: HouseholdSettingsApi = {
      listMembers: vi.fn().mockResolvedValue([]),
      createDraft: vi.fn(),
      updateDraft: vi.fn(),
      updateMember: vi.fn(),
      completeMember: vi.fn(),
      deleteMember: vi.fn(),
      listCatalog: vi.fn().mockResolvedValue([]),
      listAliases: vi.fn().mockResolvedValue([]),
      listAllergies: vi.fn().mockResolvedValue([]),
      addStandardAllergy: vi.fn(),
      addCustomAllergy: vi.fn(),
      removeAllergy: vi.fn(),
      listDislikes: vi.fn().mockResolvedValue([]),
      addDislike: vi.fn(),
      removeDislike: vi.fn(),
      invalidateSafety: vi.fn().mockResolvedValue(undefined),
    };
    const { container } = renderShellRoute(
      "/settings",
      <HouseholdSettingsForm api={api} userId={USER_ID} />,
    );

    expect(await screen.findByRole("heading", { level: 1, name: "家族設定" })).toBeVisible();
    await expectAccessible(container);
    expect(screen.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();
    expect(screen.getByText("家族を追加してください")).toBeVisible();
    expect(screen.getByRole("button", { name: "家族を追加" })).toBeVisible();
  });

  it("moves programmatic focus to the page h1 when the shell route changes", async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          element: <AppShell />,
          children: [
            {
              path: "/pantry",
              element: (
                <main className="page-frame">
                  <h1>食材リスト</h1>
                  <NavLink to="/history">履歴へ</NavLink>
                </main>
              ),
            },
            {
              path: "/history",
              element: (
                <main className="page-frame">
                  <h1>作った献立</h1>
                </main>
              ),
            },
          ],
        },
      ],
      { initialEntries: ["/pantry"] },
    );
    render(
      <Providers>
        <RouterProvider router={router} />
      </Providers>,
    );

    const pantryHeading = await screen.findByRole("heading", { name: "食材リスト" });
    await waitFor(() => {
      expect(document.activeElement).toBe(pantryHeading);
    });
    expect(pantryHeading).toHaveAttribute("tabindex", "-1");

    await user.click(screen.getByRole("link", { name: "履歴へ" }));
    const historyHeading = await screen.findByRole("heading", { name: "作った献立" });
    await waitFor(() => {
      expect(document.activeElement).toBe(historyHeading);
    });
    expect(historyHeading).toHaveAttribute("tabindex", "-1");
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

function renderMenuResultRoute(menuId: string = MENU_ID): ReturnType<typeof render> {
  // 本番ページをルーター配下で描画する。revalidation は valid 注入でゲートを開いた状態にする。
  const router = createMemoryRouter(
    [
      {
        path: "/menus/:menuId",
        element: (
          <MenuResultPage
            revalidation={{
              // household 結果本文は phase=checked かつ valid/changed で描画される。
              // MenuResult は currentLabelWarnings が渡ると結果の labelConfirmations より優先する。
              phase: "checked",
              result: {
                status: "valid",
                safetyFingerprint: "current",
                allergenCatalogVersion: "allergens-v3",
                foodRuleVersion: "food-v2",
                issues: [],
                changedDetails: [],
                currentLabelWarnings: [
                  {
                    confirmationId: "79000000-0000-4000-8000-000000000001",
                    sourceType: "ingredient",
                    sourceId: "53000000-0000-4000-8000-000000000001",
                    sourcePath: "dishes.0.ingredients.0.name",
                    sourceText: "しょうゆ",
                    allergenId: "wheat",
                    allergenName: "小麦",
                    anonymousMemberRef: "member_2",
                    memberLabel: "大人",
                    dictionaryVersion: "jp-caa-2026-04.v1",
                    confirmationStatus: "pending",
                  },
                ],
              },
            }}
          />
        ),
      },
      { path: "/planner", element: <h1>プランナー</h1> },
      { path: "/history", element: <h1>履歴</h1> },
    ],
    { initialEntries: [`/menus/${menuId}`] },
  );
  return render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
}

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

  it("menu result pending keeps a main landmark and status under the real page", async () => {
    getMenuResultMock.mockReturnValue(new Promise(() => undefined));
    const { container } = renderMenuResultRoute();

    expect(await screen.findByRole("status")).toHaveTextContent("献立を読み込んでいます");
    await expectAccessible(container);
    expect(screen.getByRole("main")).toBeVisible();
  });

  it("menu result error keeps main, h1, and history recovery under the real page", async () => {
    getMenuResultMock.mockRejectedValue(new Error("not found"));
    const { container } = renderMenuResultRoute();

    expect(await screen.findByRole("heading", { name: "献立を表示できません" })).toBeVisible();
    await expectAccessible(container);
    expect(screen.getByRole("link", { name: "履歴を見る" })).toBeVisible();
  });

  it("household result page exposes shopping/safety-oriented regions via MenuResultPage", async () => {
    getMenuResultMock.mockResolvedValue(makeMenuResultViewModel({ targetMode: "household" }));
    const { container } = renderMenuResultRoute();

    expect(await screen.findByRole("heading", { name: "献立ができました" })).toBeVisible();
    await expectAccessible(container);
    expect(screen.getByRole("heading", { name: "家族向けの取り分け" })).toBeVisible();
    expect(screen.getByRole("region", { name: "原材料表示の確認" })).toBeVisible();
  });

  it("idea result page shows idea notice and omits shopping, adaptation, and label regions", async () => {
    // idea では factory 既定の household 安全領域を空にして禁止 UI 不在を証明する。
    const result = makeMenuResultViewModel({ targetMode: "idea" });
    result.menu = {
      ...result.menu,
      adaptations: [],
      labelConfirmations: [],
    };
    result.labelConfirmations = [];
    getMenuResultMock.mockResolvedValue(result);
    const { container } = renderMenuResultRoute();

    expect(await screen.findByText("家族条件を使用していません")).toBeVisible();
    await expectAccessible(container);
    expect(screen.queryByRole("button", { name: "買い物リストを作る" })).toBeNull();
    expect(screen.queryByRole("button", { name: "買い物リストとの差分を確認" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "家族向けの取り分け" })).toBeNull();
    expect(screen.queryByRole("region", { name: "原材料表示の確認" })).toBeNull();
    expect(screen.queryByText("加工品は原材料表示を確認してください")).toBeNull();
  });
});
