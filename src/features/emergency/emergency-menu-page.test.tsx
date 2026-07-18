import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { makeValidatedMenu } from "@shared/testing/factories";
import type { ValidatedMenu } from "@shared/contracts/generation";

const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", () => ({ useQuery: useQueryMock }));
vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({ session: { user: { id: "72000000-0000-4000-8000-000000000001" } } }),
}));
vi.mock("@/shared/lib/supabase", () => ({ getBrowserSupabaseClient: () => ({}) }));

import { EmergencyMenuContent, EmergencyMenuPage } from "./emergency-menu-page";

beforeEach(() => {
  vi.clearAllMocks();
});

it("下書きがない直接アクセスでは候補を取得せず献立画面への導線を表示する", () => {
  useQueryMock
    .mockReturnValueOnce({
      data: null,
      isSuccess: true,
      isFetching: false,
      isError: false,
    })
    .mockReturnValueOnce({
      data: undefined,
      isSuccess: false,
      isFetching: false,
      isError: false,
    });

  render(<EmergencyMenuPage />);

  expect(screen.getByRole("alert")).toHaveTextContent("献立条件の下書きがありません");
  expect(screen.getByRole("link", { name: "献立画面へ戻る" })).toHaveAttribute("href", "/planner");
  expect(useQueryMock.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ enabled: false }));
});

it("states that no candidate exists without suggesting weaker safety conditions", () => {
  render(
    <EmergencyMenuContent
      loading={false}
      error={null}
      response={{
        fixtureVersion: "2026-07-11.v1",
        candidates: [],
        message: "条件に合う緊急献立がありません",
        consumesAiQuota: false,
      }}
    />,
  );
  expect(screen.getByText("条件に合う緊急献立がありません")).toBeInTheDocument();
  expect(screen.getByText("条件を緩めず、候補を表示していません。")).toBeInTheDocument();
  expect(screen.queryByText(/安全確認済み/u)).not.toBeInTheDocument();
});

it.each([
  [true, null],
  [false, "緊急献立を読み込めませんでした"],
] as const)("hides a prior candidate while refetching or after an error", (loading, error) => {
  const menu = makeValidatedMenu();
  render(
    <EmergencyMenuContent
      loading={loading}
      error={error}
      response={{
        fixtureVersion: "2026-07-11.v1",
        candidates: [{ menu, memberLabels: {}, allergenLabels: {}, labelWarnings: [] }],
        message: "古い候補",
        consumesAiQuota: false,
      }}
    />,
  );

  expect(screen.queryByText(menu.dishes[0]!.name, { exact: false })).not.toBeInTheDocument();
});

it("renders complete human-labelled cooking instructions without raw identifiers", () => {
  const base = makeValidatedMenu();
  const dish = base.dishes[0]!;
  const ingredient = dish.ingredients[0]!;
  const step = dish.steps[0]!;
  const selectionId = "58000000-0000-4000-8000-000000000001";
  const menu: ValidatedMenu = {
    ...base,
    dishes: [
      {
        ...dish,
        ingredients: [{ ...ingredient, pantrySelectionId: selectionId }],
      },
      base.dishes[1]!,
    ],
    adaptations: [
      {
        id: "59000000-0000-4000-8000-000000000001",
        dishId: dish.id,
        anonymousMemberRef: "member_1",
        portionText: "子ども用に少なめ",
        branchBeforeRecipeStepId: step.id,
        additionalCutting: "一口大に切る",
        additionalHeating: "中心まで加熱する",
        additionalSeasoning: null,
        servingCheck: "温度を確認する",
        safetyTags: ["heat_thoroughly"],
        safetyActions: [
          {
            kind: "heat_thoroughly",
            dishId: dish.id,
            ingredientId: ingredient.id,
            anonymousMemberRef: "member_1",
            beforeRecipeStepId: step.id,
            instruction: "中心まで十分に加熱する",
          },
        ],
      },
    ],
    pantryUsage: [
      {
        selectionId,
        pantryItemId: "5a000000-0000-4000-8000-000000000001",
        pantryItemName: "カレールー",
        priority: "prefer_use",
        usageStatus: "used",
        plannedQuantity: 100,
        inventoryQuantity: 80,
        shortageQuantity: 20,
        unit: "g",
        dishIds: [dish.id],
        unusedReason: null,
      },
    ],
    labelConfirmations: [
      {
        sourceType: "ingredient",
        sourceId: ingredient.id,
        sourcePath: "dishes.0.ingredients.0.name",
        sourceText: ingredient.name,
        allergenId: "wheat",
        anonymousMemberRef: "member_1",
        dictionaryVersion: "jp-caa-2026-04.v1",
        confirmationStatus: "pending",
        confirmedAt: null,
        confirmedBy: null,
      },
    ],
  };
  const { container } = render(
    <EmergencyMenuContent
      loading={false}
      error={null}
      response={{
        fixtureVersion: "2026-07-11.v1",
        candidates: [
          {
            menu,
            memberLabels: { member_1: "子ども" },
            allergenLabels: { wheat: "小麦" },
            labelWarnings: [
              {
                sourceType: "ingredient",
                sourceId: ingredient.id,
                sourcePath: "dishes.0.ingredients.0.name",
                sourceDisplayName: "カレールー",
                allergenId: "wheat",
                allergenDisplayName: "小麦",
                anonymousMemberRef: "member_1",
                memberDisplayName: "子ども",
                dictionaryVersion: "jp-caa-2026-04.v1",
                confirmationStatus: "pending",
              },
            ],
          },
        ],
        message: "AIを使わない15分緊急献立です",
        consumesAiQuota: false,
      }}
    />,
  );

  expect(screen.getByText("食卓まで全体 15分・2人分")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "全体の段取り" })).toBeInTheDocument();
  expect(screen.getByText("子ども用に少なめ", { exact: false })).toBeInTheDocument();
  expect(screen.getByText("中心まで十分に加熱する")).toBeInTheDocument();
  expect(screen.getByText("使用予定 100g／不足 20g")).toBeInTheDocument();
  expect(screen.getByText("カレールー・小麦・子ども")).toBeInTheDocument();
  expect(screen.getByText(/安全を保証する表示ではありません/u)).toBeInTheDocument();
  expect(container.textContent).not.toContain("member_1");
  expect(container.textContent).not.toContain("dishes.0.ingredients.0.name");
  expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27,}/u);
});
