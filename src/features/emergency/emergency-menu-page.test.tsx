import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { makeValidatedMenu } from "@shared/testing/factories";
import type { ValidatedMenu } from "@shared/contracts/generation";
import type { EmergencyMenusData } from "@shared/emergency/contracts";

function renderWithRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

const useQueryMock = vi.hoisted(() => vi.fn());
const getEmergencyMenusMock = vi.hoisted(() => vi.fn());
const channelMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", () => ({ useQuery: useQueryMock }));
vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({ session: { user: { id: "72000000-0000-4000-8000-000000000001" } } }),
}));
vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => {
    const channel = {
      on: () => channel,
      subscribe: () => channel,
    };
    return {
      channel: (...args: unknown[]) => {
        channelMock(...args);
        return channel;
      },
      removeChannel: vi.fn(),
    };
  },
}));
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

  renderWithRouter(<EmergencyMenuPage />);

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

  renderWithRouter(<EmergencyMenuPage />);

  // 2回目の useQuery 呼び出し（緊急献立候補クエリ）が enabled: false のまま、
  // 対象家族0人であることを理由に一切APIを呼ばないことを固定する。
  expect(useQueryMock).toHaveBeenCalledTimes(3);
  expect(useQueryMock.mock.calls[2]?.[0]).toEqual(expect.objectContaining({ enabled: false }));
  expect(screen.getByRole("link", { name: "献立画面へ戻る" })).toBeInTheDocument();
});

it("enables idea candidate query without household members", async () => {
  // 設計 §5: idea は家族 0 でも candidate query を起動し、targetMode idea で API を呼ぶ。
  useQueryMock
    .mockReturnValueOnce({
      data: {
        id: "draft-1",
        userId: "72000000-0000-4000-8000-000000000001",
        mealType: "dinner",
        mainIngredients: ["豚肉"],
        cuisineGenre: null,
        targetMode: "idea",
        targetMemberIds: [],
        servings: 3,
        timeLimitMinutes: null,
        budgetPreference: null,
        ingredientPreference: null,
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

  renderWithRouter(<EmergencyMenuPage />);

  expect(useQueryMock).toHaveBeenCalledTimes(3);
  // household query は idea では disabled
  expect(useQueryMock.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ enabled: false }));
  const candidateQuery = useQueryMock.mock.calls[2]?.[0] as {
    enabled: boolean;
    queryFn: () => Promise<unknown>;
  };
  expect(candidateQuery.enabled).toBe(true);
  await candidateQuery.queryFn();
  expect(getEmergencyMenusMock).toHaveBeenCalledWith(
    expect.objectContaining({
      targetMode: "idea",
      targetMemberIds: [],
      mainIngredients: ["豚肉"],
    }),
  );
  // 旧 idea ブロック文言は出さない
  expect(screen.queryByText(/アイデアモードでは緊急献立を表示できません/u)).not.toBeInTheDocument();
  expect(screen.queryByText(/家族が登録されていない/u)).not.toBeInTheDocument();
});

it("does not request idea path when draft is household", async () => {
  const eligibleId = "72000000-0000-4000-8000-000000000010";
  useQueryMock
    .mockReturnValueOnce({
      data: {
        id: "draft-household",
        userId: "72000000-0000-4000-8000-000000000001",
        mealType: "dinner",
        mainIngredients: ["鶏肉"],
        cuisineGenre: "japanese",
        targetMode: "household",
        targetMemberIds: [eligibleId],
        servings: null,
        timeLimitMinutes: null,
        budgetPreference: null,
        ingredientPreference: null,
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

  renderWithRouter(<EmergencyMenuPage />);
  const candidateQuery = useQueryMock.mock.calls[2]?.[0] as {
    queryFn: () => Promise<unknown>;
  };
  await candidateQuery.queryFn();
  expect(getEmergencyMenusMock).toHaveBeenCalledWith(
    expect.objectContaining({
      targetMode: "household",
      targetMemberIds: [eligibleId],
    }),
  );
  expect(getEmergencyMenusMock).not.toHaveBeenCalledWith(
    expect.objectContaining({ targetMode: "idea" }),
  );
});

it("does not fallback to idea when eligible members empty", () => {
  // household 下書きで適格 0 のとき pre-API empty のまま。idea に黙って降格しない。
  useQueryMock
    .mockReturnValueOnce({
      data: {
        id: "draft-1",
        userId: "72000000-0000-4000-8000-000000000001",
        mealType: "dinner",
        mainIngredients: [],
        cuisineGenre: null,
        targetMode: "household",
        targetMemberIds: ["72000000-0000-4000-8000-000000000099"],
        servings: null,
        timeLimitMinutes: null,
        budgetPreference: null,
        ingredientPreference: null,
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
      data: [],
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

  renderWithRouter(<EmergencyMenuPage />);

  expect(useQueryMock.mock.calls[2]?.[0]).toEqual(expect.objectContaining({ enabled: false }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "対象の家族が登録されていないため、緊急献立を表示できません",
  );
  expect(screen.queryByText(/個人向けの固定候補です/u)).not.toBeInTheDocument();
});

it("does not subscribe household Realtime or safety poll when draft is idea", () => {
  useQueryMock
    .mockReturnValueOnce({
      data: {
        id: "draft-idea",
        userId: "72000000-0000-4000-8000-000000000001",
        mealType: "dinner",
        mainIngredients: [],
        cuisineGenre: null,
        targetMode: "idea",
        targetMemberIds: [],
        servings: 2,
        timeLimitMinutes: null,
        budgetPreference: null,
        ingredientPreference: null,
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

  renderWithRouter(<EmergencyMenuPage />);
  expect(channelMock).not.toHaveBeenCalled();
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
        ingredientPreference: null,
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

  renderWithRouter(<EmergencyMenuPage />);

  const candidateQuery = useQueryMock.mock.calls[2]?.[0] as {
    enabled: boolean;
    queryKey: readonly unknown[];
    queryFn: () => Promise<unknown>;
  };
  expect(candidateQuery.enabled).toBe(true);
  await candidateQuery.queryFn();
  expect(getEmergencyMenusMock).toHaveBeenCalledWith(
    expect.objectContaining({
      mainIngredients: ["鶏肉"],
      targetMode: "household",
      targetMemberIds: [eligibleId],
    }),
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

  renderWithRouter(<EmergencyMenuPage />);
  const candidateQuery = useQueryMock.mock.calls[2]?.[0] as {
    queryFn: () => Promise<unknown>;
  };
  await candidateQuery.queryFn();

  expect(getEmergencyMenusMock).toHaveBeenCalledWith(
    expect.objectContaining({ targetMode: "household", targetMemberIds: [registeredId] }),
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

  renderWithRouter(<EmergencyMenuPage />);
  const candidateQuery = useQueryMock.mock.calls[2]?.[0] as {
    queryFn: () => Promise<unknown>;
  };
  await candidateQuery.queryFn();

  expect(getEmergencyMenusMock).toHaveBeenCalledWith(
    expect.objectContaining({
      targetMode: "household",
      targetMemberIds: eligibleIds.slice(0, 20),
    }),
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

  renderWithRouter(<EmergencyMenuPage />);
  const candidateQuery = useQueryMock.mock.calls[2]?.[0] as {
    queryFn: () => Promise<unknown>;
  };
  await candidateQuery.queryFn();

  expect(getEmergencyMenusMock).toHaveBeenCalledWith(
    expect.objectContaining({ targetMode: "household", targetMemberIds: [validSelectedId] }),
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

  renderWithRouter(<EmergencyMenuPage />);

  expect(useQueryMock.mock.calls[2]?.[0]).toEqual(expect.objectContaining({ enabled: false }));
  // C-I6: 名簿上は適格メンバーがいるが選択が全滅 → 未登録文言は出さない
  expect(screen.getByRole("alert")).toHaveTextContent(
    "選んだ家族が対象にできないため、緊急献立を表示できません",
  );
  expect(screen.queryByText(/家族が登録されていない/u)).not.toBeInTheDocument();
});

it("shows household safety_only banner only when matchMode is safety_only", () => {
  const menu = makeValidatedMenu();
  renderWithRouter(
    <EmergencyMenuContent
      loading={false}
      error={null}
      expectedPath="household"
      response={{
        fixtureVersion: "2026-07-28.v1",
        candidates: [{ menu, memberLabels: {}, allergenLabels: {}, labelWarnings: [] }],
        // §4 server message は「固定」付き。UI バナーは §5 を matchMode から選び message をパースしない
        message: "メイン食材は一致しませんでした。安全条件に合う固定候補を表示しています",
        consumesAiQuota: false,
        path: "household",
        matchMode: "safety_only",
        emptyReason: null,
      }}
    />,
  );
  // banner は role=note（idea intro の role=status と二重 status にしない）
  const banner = screen.getByRole("note");
  expect(
    screen.getByText("メイン食材は一致しませんでした。安全条件に合う候補を表示しています。"),
  ).toBeVisible();
  expect(banner).toBeVisible();
  expect(banner).toHaveTextContent(
    "メイン食材は一致しませんでした。安全条件に合う候補を表示しています。",
  );
  // §4 server message をそのまま chrome に出さない（「固定」付きの message は DOM 非表示）
  expect(
    screen.queryByText("メイン食材は一致しませんでした。安全条件に合う固定候補を表示しています"),
  ).toBeNull();
});

it("shows idea safety_only banner without family-safety wording", () => {
  const menu = makeValidatedMenu();
  renderWithRouter(
    <EmergencyMenuContent
      loading={false}
      error={null}
      expectedPath="idea"
      response={{
        fixtureVersion: "2026-07-28.v1",
        candidates: [{ menu, memberLabels: {}, allergenLabels: {}, labelWarnings: [] }],
        message: "メイン食材は一致しませんでした。アレルギー条件は適用していません",
        consumesAiQuota: false,
        path: "idea",
        matchMode: "safety_only",
        emptyReason: null,
      }}
    />,
  );
  expect(
    screen.getByText("メイン食材は一致しませんでした。アレルギー条件は適用していません。"),
  ).toBeVisible();
  expect(screen.queryByText(/安全条件に合う/u)).toBeNull();
});

it("does not show household safety_only banner text on idea path", () => {
  const menu = makeValidatedMenu();
  renderWithRouter(
    <EmergencyMenuContent
      loading={false}
      error={null}
      expectedPath="idea"
      response={{
        fixtureVersion: "2026-07-28.v1",
        candidates: [{ menu, memberLabels: {}, allergenLabels: {}, labelWarnings: [] }],
        message: "メイン食材は一致しませんでした。アレルギー条件は適用していません",
        consumesAiQuota: false,
        path: "idea",
        matchMode: "safety_only",
        emptyReason: null,
      }}
    />,
  );
  expect(
    screen.queryByText("メイン食材は一致しませんでした。安全条件に合う候補を表示しています。"),
  ).toBeNull();
});

it("shows idea intro and hides household intro", () => {
  const menu = makeValidatedMenu();
  renderWithRouter(
    <EmergencyMenuContent
      loading={false}
      error={null}
      expectedPath="idea"
      response={{
        fixtureVersion: "2026-07-28.v1",
        candidates: [{ menu, memberLabels: {}, allergenLabels: {}, labelWarnings: [] }],
        message: "AIを使わない15分緊急献立です",
        consumesAiQuota: false,
        path: "idea",
        matchMode: "none",
        emptyReason: null,
      }}
    />,
  );
  const ideaIntro =
    "個人向けの固定候補です。家族のアレルギー・年齢条件は適用していません。AI利用回数は消費しません。調理前に原材料表示と家庭内の混入を確認してください。";
  expect(screen.getByRole("status")).toHaveTextContent(ideaIntro);
  expect(
    screen.queryByText(
      "現在の家族・アレルギー・年齢・必須条件で固定候補を絞り込みます。AI利用回数は消費しません。",
    ),
  ).toBeNull();
});

it("does not show household adaptation heading on idea path", () => {
  // idea 候補カードは「家族向けの取り分け」を出さず中立見出しにする
  const base = makeValidatedMenu();
  const dish = base.dishes[0]!;
  const step = dish.steps[0]!;
  const menu: ValidatedMenu = {
    ...base,
    adaptations: [
      {
        id: "59000000-0000-4000-8000-000000000099",
        dishId: dish.id,
        anonymousMemberRef: "member_1",
        portionText: "適量",
        branchBeforeRecipeStepId: step.id,
        additionalCutting: "一口大",
        additionalHeating: null,
        additionalSeasoning: null,
        servingCheck: "配膳前に確認",
        safetyTags: [],
        safetyActions: [],
      },
    ],
  };
  renderWithRouter(
    <EmergencyMenuContent
      loading={false}
      error={null}
      expectedPath="idea"
      response={{
        fixtureVersion: "2026-07-28.v1",
        candidates: [
          {
            menu,
            memberLabels: { member_1: "あなた" },
            allergenLabels: {},
            labelWarnings: [],
          },
        ],
        message: "AIを使わない15分緊急献立です",
        consumesAiQuota: false,
        path: "idea",
        matchMode: "none",
        emptyReason: null,
      }}
    />,
  );
  expect(screen.queryByText("家族向けの取り分け")).toBeNull();
  expect(screen.getByText("取り分け・切り方の目安")).toBeVisible();
});

it("does not show household intro while draft fetch is still pending", () => {
  // draftReady 前は expectedPath=null。世帯 intro を一瞬でも出さない。
  useQueryMock
    .mockReturnValueOnce({
      data: undefined,
      isSuccess: false,
      isPending: true,
      isFetching: true,
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

  renderWithRouter(<EmergencyMenuPage />);

  expect(
    screen.queryByText(
      "現在の家族・アレルギー・年齢・必須条件で固定候補を絞り込みます。AI利用回数は消費しません。",
    ),
  ).toBeNull();
  expect(screen.queryByText(/個人向けの固定候補です/u)).toBeNull();
  expect(screen.getByText("候補を確認中…")).toBeVisible();
});

it("keeps idea chrome while draft is background-refetching with cached data", () => {
  // isFetching でもキャッシュ draft があれば chrome を消さない（window-focus 空白防止）
  useQueryMock
    .mockReturnValueOnce({
      data: {
        mealType: "dinner",
        mainIngredients: [],
        targetMode: "idea",
        targetMemberIds: [],
        pantrySelections: [],
      },
      isSuccess: true,
      isPending: false,
      isFetching: true,
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
      isPending: true,
      isFetching: true,
      isError: false,
    });

  renderWithRouter(<EmergencyMenuPage />);

  expect(screen.getByText(/個人向けの固定候補です/u)).toBeVisible();
  expect(
    screen.queryByText(
      "現在の家族・アレルギー・年齢・必須条件で固定候補を絞り込みます。AI利用回数は消費しません。",
    ),
  ).toBeNull();
});

it("fails closed when response path disagrees with expectedPath", () => {
  const menu = makeValidatedMenu();
  renderWithRouter(
    <EmergencyMenuContent
      loading={false}
      error={null}
      expectedPath="idea"
      response={{
        fixtureVersion: "2026-07-28.v1",
        candidates: [{ menu, memberLabels: {}, allergenLabels: {}, labelWarnings: [] }],
        message: "AIを使わない15分緊急献立です",
        consumesAiQuota: false,
        path: "household",
        matchMode: "none",
        emptyReason: null,
      }}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("緊急献立を読み込めませんでした");
  expect(
    screen.queryByText(
      "現在の家族・アレルギー・年齢・必須条件で固定候補を絞り込みます。AI利用回数は消費しません。",
    ),
  ).toBeNull();
  expect(screen.queryByText(menu.dishes.map((dish) => dish.name).join("・"))).toBeNull();
});

it("shows idea intro during loading before response arrives", () => {
  renderWithRouter(
    <EmergencyMenuContent loading={true} error={null} expectedPath="idea" response={null} />,
  );
  const ideaIntro =
    "個人向けの固定候補です。家族のアレルギー・年齢条件は適用していません。AI利用回数は消費しません。調理前に原材料表示と家庭内の混入を確認してください。";
  expect(screen.getByRole("status")).toHaveTextContent(ideaIntro);
  expect(
    screen.queryByText(
      "現在の家族・アレルギー・年齢・必須条件で固定候補を絞り込みます。AI利用回数は消費しません。",
    ),
  ).toBeNull();
  expect(screen.queryByText(/候補 \d/u)).not.toBeInTheDocument();
  expect(screen.getByText("候補を確認中…")).toBeVisible();
});

it("clears idea candidates and chrome when draft switches to household before refetch completes", () => {
  // 設計 §5 cache fail-closed: loading 中は旧 idea candidates 非表示。expectedPath が
  // household に切り替わったら household intro、idea intro 不在。
  const menu = makeValidatedMenu();
  const ideaResponse: EmergencyMenusData = {
    fixtureVersion: "2026-07-28.v1",
    candidates: [{ menu, memberLabels: {}, allergenLabels: {}, labelWarnings: [] }],
    message: "AIを使わない15分緊急献立です",
    consumesAiQuota: false,
    path: "idea",
    matchMode: "none",
    emptyReason: null,
  };
  const { rerender } = renderWithRouter(
    <EmergencyMenuContent
      loading={false}
      error={null}
      expectedPath="idea"
      response={ideaResponse}
    />,
  );
  expect(screen.getByText("候補 1")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(/個人向けの固定候補です/u);

  rerender(
    <MemoryRouter>
      <EmergencyMenuContent
        loading={true}
        error={null}
        expectedPath="household"
        response={ideaResponse}
      />
    </MemoryRouter>,
  );
  expect(screen.queryByText("候補 1")).not.toBeInTheDocument();
  expect(screen.queryByText(menu.dishes[0]!.name, { exact: false })).not.toBeInTheDocument();
  expect(
    screen.getByText(
      "現在の家族・アレルギー・年齢・必須条件で固定候補を絞り込みます。AI利用回数は消費しません。",
    ),
  ).toBeVisible();
  expect(screen.queryByText(/個人向けの固定候補です/u)).not.toBeInTheDocument();
  expect(screen.getByText("候補を確認中…")).toBeVisible();
});

it("does not show safety_only banner when matchMode is none", () => {
  const menu = makeValidatedMenu();
  renderWithRouter(
    <EmergencyMenuContent
      loading={false}
      error={null}
      expectedPath="household"
      response={{
        fixtureVersion: "2026-07-28.v1",
        candidates: [{ menu, memberLabels: {}, allergenLabels: {}, labelWarnings: [] }],
        message: "AIを使わない15分緊急献立です",
        consumesAiQuota: false,
        path: "household",
        matchMode: "none",
        emptyReason: null,
      }}
    />,
  );
  expect(
    screen.queryByText("メイン食材は一致しませんでした。安全条件に合う候補を表示しています。"),
  ).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});

it("does not show safety_only banner when matchMode is main_ingredient", () => {
  const menu = makeValidatedMenu();
  renderWithRouter(
    <EmergencyMenuContent
      loading={false}
      error={null}
      expectedPath="household"
      response={{
        fixtureVersion: "2026-07-28.v1",
        candidates: [{ menu, memberLabels: {}, allergenLabels: {}, labelWarnings: [] }],
        message: "AIを使わない15分緊急献立です",
        consumesAiQuota: false,
        path: "household",
        matchMode: "main_ingredient",
        emptyReason: null,
      }}
    />,
  );
  // メイン食材一致の成功応答では §5 safety_only バナーを出さない
  expect(
    screen.queryByText("メイン食材は一致しませんでした。安全条件に合う候補を表示しています。"),
  ).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});

it("shows differentiated post-API empty copy for current_safety_unavailable", () => {
  renderWithRouter(
    <EmergencyMenuContent
      loading={false}
      error={null}
      expectedPath="household"
      response={{
        fixtureVersion: "2026-07-28.v1",
        candidates: [],
        message: "条件に合う緊急献立がありません",
        consumesAiQuota: false,
        path: "household",
        matchMode: null,
        emptyReason: "current_safety_unavailable",
      }}
    />,
  );
  expect(
    screen.getByText(
      "アレルギー確認未了・自由登録アレルギー、または対応できない食事条件のため、候補を表示していません。条件は緩めていません",
    ),
  ).toBeVisible();
  expect(screen.queryByText("条件を緩めず、候補を表示していません。")).toBeNull();
});

it("shows differentiated post-API empty copy for household no_matching_fixture", () => {
  renderWithRouter(
    <EmergencyMenuContent
      loading={false}
      error={null}
      expectedPath="household"
      response={{
        fixtureVersion: "2026-07-28.v1",
        candidates: [],
        message: "条件に合う緊急献立がありません",
        consumesAiQuota: false,
        path: "household",
        matchMode: null,
        emptyReason: "no_matching_fixture",
      }}
    />,
  );
  expect(
    screen.getByText("いまのアレルギー・年齢に合う15分固定候補がありません。条件は緩めていません"),
  ).toBeVisible();
  expect(screen.queryByText("条件を緩めず、候補を表示していません。")).toBeNull();
});

it("shows idea post-API empty copy for no_matching_fixture", () => {
  renderWithRouter(
    <EmergencyMenuContent
      loading={false}
      error={null}
      expectedPath="idea"
      response={{
        fixtureVersion: "2026-07-28.v1",
        candidates: [],
        message: "条件に合う緊急献立がありません",
        consumesAiQuota: false,
        path: "idea",
        matchMode: null,
        emptyReason: "no_matching_fixture",
      }}
    />,
  );
  // 設計 §5 idea 行（exact plain JP）
  expect(screen.getByText("固定候補を表示できませんでした")).toBeVisible();
  expect(
    screen.queryByText(
      "いまのアレルギー・年齢に合う15分固定候補がありません。条件は緩めていません",
    ),
  ).toBeNull();
  expect(screen.queryByText("条件を緩めず、候補を表示していません。")).toBeNull();
});

it("states that no candidate exists without suggesting weaker safety conditions", () => {
  renderWithRouter(
    <EmergencyMenuContent
      loading={false}
      error={null}
      expectedPath="household"
      response={{
        fixtureVersion: "2026-07-28.v1",
        candidates: [],
        message: "条件に合う緊急献立がありません",
        consumesAiQuota: false,
        path: "household",
        matchMode: null,
        emptyReason: "no_matching_fixture",
      }}
    />,
  );
  expect(screen.getByText("条件に合う緊急献立がありません")).toBeInTheDocument();
  expect(
    screen.getByText("いまのアレルギー・年齢に合う15分固定候補がありません。条件は緩めていません"),
  ).toBeInTheDocument();
  expect(screen.queryByText(/安全確認済み/u)).not.toBeInTheDocument();
});

it.each<[boolean, string | null, EmergencyMenusData | null]>([
  [true, null, null],
  [false, "緊急献立を読み込めませんでした", null],
  [
    false,
    null,
    {
      fixtureVersion: "2026-07-28.v1",
      candidates: [],
      message: "条件に合う緊急献立がありません",
      consumesAiQuota: false,
      path: "household",
      matchMode: null,
      emptyReason: "no_matching_fixture",
    },
  ],
])("always shows the planner return link", (loading, error, response) => {
  renderWithRouter(
    <EmergencyMenuContent
      loading={loading}
      error={error}
      expectedPath="household"
      response={response}
    />,
  );

  expect(screen.getByRole("link", { name: "献立画面へ戻る" })).toHaveAttribute("href", "/planner");
});

it.each([
  [true, null],
  [false, "緊急献立を読み込めませんでした"],
] as const)("hides a prior candidate while refetching or after an error", (loading, error) => {
  const menu = makeValidatedMenu();
  renderWithRouter(
    <EmergencyMenuContent
      loading={loading}
      error={error}
      expectedPath="household"
      response={{
        fixtureVersion: "2026-07-28.v1",
        candidates: [{ menu, memberLabels: {}, allergenLabels: {}, labelWarnings: [] }],
        message: "古い候補",
        consumesAiQuota: false,
        path: "household",
        matchMode: "none",
        emptyReason: null,
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
  const { container } = renderWithRouter(
    <EmergencyMenuContent
      loading={false}
      error={null}
      expectedPath="household"
      response={{
        fixtureVersion: "2026-07-28.v1",
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
        path: "household",
        matchMode: "none",
        emptyReason: null,
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
