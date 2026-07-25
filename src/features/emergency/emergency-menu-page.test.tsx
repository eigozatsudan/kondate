import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { makeValidatedMenu } from "@shared/testing/factories";
import type { ValidatedMenu } from "@shared/contracts/generation";
import type { EmergencyMenusData } from "@shared/emergency/contracts";

const useQueryMock = vi.hoisted(() => vi.fn());
const getEmergencyMenusMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", () => ({ useQuery: useQueryMock }));
vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({ session: { user: { id: "72000000-0000-4000-8000-000000000001" } } }),
}));
vi.mock("@/shared/lib/supabase", () => ({ getBrowserSupabaseClient: () => ({}) }));
vi.mock("./emergency-menu-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./emergency-menu-api")>();
  return { ...original, getEmergencyMenus: getEmergencyMenusMock };
});

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
  expect(useQueryMock.mock.calls[2]?.[0]).toEqual(expect.objectContaining({ enabled: false }));
});

// Step 10: 下書きなし・idea下書きのいずれでも対象家族が0人なら、緊急献立APIを呼ばず
// 家族不在を説明して家族設定への任意導線を示す。household safety の再検証も発生させない。
it("下書きなしで対象家族が0人の場合は緊急献立APIを呼ばず献立画面への導線を表示する", () => {
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
    })
    .mockReturnValueOnce({
      data: undefined,
      isSuccess: false,
      isFetching: false,
      isError: false,
    });

  render(<EmergencyMenuPage />);

  // 2回目の useQuery 呼び出し（緊急献立候補クエリ）が enabled: false のまま、
  // 対象家族0人であることを理由に一切APIを呼ばないことを固定する。
  expect(useQueryMock).toHaveBeenCalledTimes(3);
  expect(useQueryMock.mock.calls[2]?.[0]).toEqual(expect.objectContaining({ enabled: false }));
  expect(screen.getByRole("link", { name: "献立画面へ戻る" })).toBeInTheDocument();
});

it("idea下書きで対象家族が0人の場合も緊急献立APIを呼ばず家族不在の説明を表示する", () => {
  useQueryMock
    .mockReturnValueOnce({
      data: {
        id: "draft-1",
        userId: "72000000-0000-4000-8000-000000000001",
        mealType: "dinner",
        mainIngredients: [],
        cuisineGenre: null,
        targetMode: "idea",
        targetMemberIds: [],
        servings: 3,
        timeLimitMinutes: null,
        budgetPreference: null,
        avoidIngredients: [],
        memo: "",
        pantrySelections: [],
        revision: 1,
        createdAt: "2026-07-11T00:00:00.000Z",
        updatedAt: "2026-07-11T00:00:00.000Z",
      },
      isSuccess: true,
      isFetching: false,
      isError: false,
    })
    .mockReturnValueOnce({
      data: undefined,
      isSuccess: false,
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

  expect(useQueryMock).toHaveBeenCalledTimes(3);
  expect(useQueryMock.mock.calls[2]?.[0]).toEqual(expect.objectContaining({ enabled: false }));
  expect(
    screen.getByText(
      "対象の家族が登録されていないため、緊急献立を表示できません。家族設定は任意です。",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "家族設定へ（任意）" })).toBeInTheDocument();
});

it("対象未選択の下書きでは後から登録した有効な家族だけを初期対象にする", async () => {
  const eligibleId = "72000000-0000-4000-8000-000000000010";
  useQueryMock
    .mockReturnValueOnce({
      data: {
        id: "draft-1",
        userId: "72000000-0000-4000-8000-000000000001",
        mealType: "dinner",
        mainIngredients: ["鶏肉"],
        cuisineGenre: "japanese",
        targetMode: null,
        targetMemberIds: [],
        servings: null,
        timeLimitMinutes: null,
        budgetPreference: null,
        avoidIngredients: [],
        memo: "",
        pantrySelections: [],
        revision: 1,
        createdAt: "2026-07-11T00:00:00.000Z",
        updatedAt: "2026-07-11T00:00:00.000Z",
      },
      isSuccess: true,
      isFetching: false,
      isError: false,
    })
    .mockReturnValueOnce({
      data: [
        {
          id: eligibleId,
          status: "complete",
          allergy_status: "none",
          unsupported_diet_status: "none",
        },
        {
          id: "72000000-0000-4000-8000-000000000011",
          status: "draft",
          allergy_status: "none",
          unsupported_diet_status: "none",
        },
        {
          id: "72000000-0000-4000-8000-000000000012",
          status: "complete",
          allergy_status: "unconfirmed",
          unsupported_diet_status: "none",
        },
      ],
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
  getEmergencyMenusMock.mockResolvedValue({ candidates: [] });

  render(<EmergencyMenuPage />);

  const candidateQuery = useQueryMock.mock.calls[2]?.[0] as {
    enabled: boolean;
    queryKey: readonly unknown[];
    queryFn: () => Promise<unknown>;
  };
  expect(candidateQuery.enabled).toBe(true);
  await candidateQuery.queryFn();
  expect(getEmergencyMenusMock).toHaveBeenCalledWith(
    expect.objectContaining({ mainIngredients: ["鶏肉"], targetMemberIds: [eligibleId] }),
  );
  expect(candidateQuery.queryKey).toEqual(expect.arrayContaining([["鶏肉"]]));
});

it("registeredは許可し、対象外食present/unconfirmedは未選択下書きの対象から除く", async () => {
  const registeredId = "72000000-0000-4000-8000-000000000020";
  useQueryMock
    .mockReturnValueOnce({
      data: {
        id: "draft-matrix",
        userId: "72000000-0000-4000-8000-000000000001",
        mealType: "dinner",
        targetMode: null,
        targetMemberIds: [],
        pantrySelections: [],
      },
      isSuccess: true,
      isFetching: false,
      isError: false,
    })
    .mockReturnValueOnce({
      data: [
        {
          id: registeredId,
          status: "complete",
          allergy_status: "registered",
          unsupported_diet_status: "none",
        },
        {
          id: "72000000-0000-4000-8000-000000000021",
          status: "complete",
          allergy_status: "none",
          unsupported_diet_status: "present",
        },
        {
          id: "72000000-0000-4000-8000-000000000022",
          status: "complete",
          allergy_status: "none",
          unsupported_diet_status: "unconfirmed",
        },
      ],
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
  const candidateQuery = useQueryMock.mock.calls[2]?.[0] as {
    queryFn: () => Promise<unknown>;
  };
  await candidateQuery.queryFn();

  expect(getEmergencyMenusMock).toHaveBeenCalledWith(
    expect.objectContaining({ targetMemberIds: [registeredId] }),
  );
});

it("未選択下書きの有効家族は並び順を保って20人までに制限する", async () => {
  const eligibleIds = Array.from(
    { length: 21 },
    (_, index) => `72000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  );
  useQueryMock
    .mockReturnValueOnce({
      data: {
        id: "draft-limit",
        userId: "72000000-0000-4000-8000-000000000001",
        mealType: "dinner",
        targetMode: null,
        targetMemberIds: [],
        pantrySelections: [],
      },
      isSuccess: true,
      isFetching: false,
      isError: false,
    })
    .mockReturnValueOnce({
      data: eligibleIds.map((id) => ({
        id,
        status: "complete",
        allergy_status: "none",
        unsupported_diet_status: "none",
      })),
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
  const candidateQuery = useQueryMock.mock.calls[2]?.[0] as {
    queryFn: () => Promise<unknown>;
  };
  await candidateQuery.queryFn();

  expect(getEmergencyMenusMock).toHaveBeenCalledWith(
    expect.objectContaining({ targetMemberIds: eligibleIds.slice(0, 20) }),
  );
});

it("household下書きは選択済みIDと現在有効な家族の積集合だけを使う", async () => {
  const validSelectedId = "72000000-0000-4000-8000-000000000030";
  const invalidSelectedId = "72000000-0000-4000-8000-000000000031";
  useQueryMock
    .mockReturnValueOnce({
      data: {
        id: "draft-household",
        userId: "72000000-0000-4000-8000-000000000001",
        mealType: "dinner",
        targetMode: "household",
        targetMemberIds: [invalidSelectedId, validSelectedId],
        pantrySelections: [],
      },
      isSuccess: true,
      isFetching: false,
      isError: false,
    })
    .mockReturnValueOnce({
      data: [
        {
          id: validSelectedId,
          status: "complete",
          allergy_status: "registered",
          unsupported_diet_status: "none",
        },
        {
          id: invalidSelectedId,
          status: "complete",
          allergy_status: "none",
          unsupported_diet_status: "present",
        },
        {
          id: "72000000-0000-4000-8000-000000000032",
          status: "complete",
          allergy_status: "none",
          unsupported_diet_status: "none",
        },
      ],
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
  const candidateQuery = useQueryMock.mock.calls[2]?.[0] as {
    queryFn: () => Promise<unknown>;
  };
  await candidateQuery.queryFn();

  expect(getEmergencyMenusMock).toHaveBeenCalledWith(
    expect.objectContaining({ targetMemberIds: [validSelectedId] }),
  );
});

it("household下書きの選択家族が無効になっても別の家族を補完しない", () => {
  useQueryMock
    .mockReturnValueOnce({
      data: {
        id: "draft-1",
        userId: "72000000-0000-4000-8000-000000000001",
        mealType: "dinner",
        targetMode: "household",
        targetMemberIds: ["72000000-0000-4000-8000-000000000099"],
        pantrySelections: [],
      },
      isSuccess: true,
      isFetching: false,
      isError: false,
    })
    .mockReturnValueOnce({
      data: [
        {
          id: "72000000-0000-4000-8000-000000000010",
          status: "complete",
          allergy_status: "none",
          unsupported_diet_status: "none",
        },
      ],
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

  expect(useQueryMock.mock.calls[2]?.[0]).toEqual(expect.objectContaining({ enabled: false }));
  expect(screen.getByRole("alert")).toHaveTextContent("対象の家族が登録されていない");
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

it.each<[boolean, string | null, EmergencyMenusData | null]>([
  [true, null, null],
  [false, "緊急献立を読み込めませんでした", null],
  [
    false,
    null,
    {
      fixtureVersion: "2026-07-11.v1",
      candidates: [],
      message: "選択したメイン食材に合う固定候補がありません",
      consumesAiQuota: false,
    },
  ],
])("always shows the planner return link", (loading, error, response) => {
  render(<EmergencyMenuContent loading={loading} error={error} response={response} />);

  expect(screen.getByRole("link", { name: "献立画面へ戻る" })).toHaveAttribute("href", "/planner");
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

  expect(screen.getByText("15分")).toBeInTheDocument();
  expect(screen.getByText("2人分")).toBeInTheDocument();
  expect(screen.queryByText("食卓まで全体 15分・2人分")).not.toBeInTheDocument();
  expect(screen.getByText("候補 1")).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "候補1の概要" })).toBeInTheDocument();
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
