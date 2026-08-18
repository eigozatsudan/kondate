import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { makeValidatedMenu } from "@shared/testing/factories";
import type { ValidatedMenu } from "@shared/contracts/generation";
import type { EmergencyMenusData } from "@shared/emergency/contracts";
import type { PantryItem } from "@shared/contracts/pantry";

function renderWithRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function postedEmergencyRequest(call: readonly unknown[] | undefined): {
  url: string;
  method: unknown;
  body: unknown;
} {
  const url = call?.[0];
  const init = call?.[1];
  if (typeof url !== "string" || !isRecord(init) || typeof init.body !== "string") {
    throw new Error("緊急献立の POST を確認できませんでした");
  }
  return {
    url,
    method: init.method,
    body: JSON.parse(init.body) as unknown,
  };
}

const useQueryMock = vi.hoisted(() => vi.fn());
const getEmergencyMenusMock = vi.hoisted(() => vi.fn());
const requireAccessTokenMock = vi.hoisted(() => vi.fn());
const originalGetEmergencyMenus = vi.hoisted(() => ({
  current: undefined as undefined | typeof import("./emergency-menu-api").getEmergencyMenus,
}));
const channelMock = vi.hoisted(() => vi.fn());
const listPantryItemsMock = vi.hoisted(() => vi.fn());
const subscribeCallbacks = vi.hoisted(() => [] as ((status: string) => void)[]);

function emergencyMenusQueryCallEnabled(enabled: boolean): boolean {
  return useQueryMock.mock.calls.some((call) => {
    const options = call[0] as { queryKey?: readonly unknown[]; enabled?: boolean } | undefined;
    return options?.queryKey?.[0] === "emergency-menus" && options.enabled === enabled;
  });
}

function deferredPromise<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

type EmergencyMenusQueryCall = {
  queryKey: readonly unknown[];
  enabled: boolean | undefined;
};

function emergencyMenusQueryCallsAfter(callIndex: number): EmergencyMenusQueryCall[] {
  return useQueryMock.mock.calls.slice(callIndex).flatMap((call) => {
    const options = call[0] as { queryKey?: readonly unknown[]; enabled?: boolean } | undefined;
    if (options?.queryKey?.[0] !== "emergency-menus") return [];
    return [{ queryKey: options.queryKey, enabled: options.enabled }];
  });
}

/** PE1: 未選択で適格親だけ GET するとサーバが返し得る卵候補。fail-closed では出さない。 */
function eggHouseholdEmergencyResponse(): EmergencyMenusData {
  const base = makeValidatedMenu();
  const eggMenu: ValidatedMenu = {
    ...base,
    dishes: [{ ...base.dishes[0]!, name: "卵焼き" }, base.dishes[1]!],
  };
  return {
    fixtureVersion: "2026-07-28.v1",
    candidates: [{ menu: eggMenu, memberLabels: {}, allergenLabels: {}, labelWarnings: [] }],
    message: "AIを使わない15分緊急献立です",
    consumesAiQuota: false,
    path: "household",
    matchMode: "none",
    emptyReason: null,
  };
}

vi.mock("@tanstack/react-query", () => ({
  useQuery: useQueryMock,
  // PE9: 下書き invalidate 用。page テストは queryClient を持たないので no-op。
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({ session: { user: { id: "72000000-0000-4000-8000-000000000001" } } }),
}));
vi.mock("@/features/auth/session", () => ({ requireAccessToken: requireAccessTokenMock }));
vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => {
    const channel = {
      on: () => channel,
      subscribe: (cb?: (status: string) => void) => {
        if (cb !== undefined) subscribeCallbacks.push(cb);
        return channel;
      },
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
vi.mock("@/features/pantry/pantry-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/pantry/pantry-api")>();
  return { ...original, listPantryItems: listPantryItemsMock };
});
vi.mock("./emergency-menu-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./emergency-menu-api")>();
  originalGetEmergencyMenus.current = original.getEmergencyMenus;
  return { ...original, getEmergencyMenus: getEmergencyMenusMock };
});

import { EmergencyMenuContent, EmergencyMenuPage } from "./emergency-menu-page";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  getEmergencyMenusMock.mockReset();
  requireAccessTokenMock.mockReset();
  sessionStorage.clear();
  subscribeCallbacks.length = 0;
  listPantryItemsMock.mockReset();
  listPantryItemsMock.mockResolvedValue([]);
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

it("PE4: queryFn posts allergy-implying mains in JSON body, not on the request URL", async () => {
  // page は getEmergencyMenus 経由。製品クライアントが GET query に自由文を載せないことを固定する。
  const original = originalGetEmergencyMenus.current;
  if (original === undefined) {
    throw new Error("getEmergencyMenus の実装を testdouble から復元できませんでした");
  }
  getEmergencyMenusMock.mockImplementation((input: Parameters<typeof original>[0]) =>
    original(input),
  );
  requireAccessTokenMock.mockResolvedValue("token");
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        ok: true,
        data: {
          fixtureVersion: "2026-07-28.v1",
          candidates: [],
          message: "条件に合う緊急献立がありません",
          consumesAiQuota: false,
          path: "idea",
          matchMode: null,
          emptyReason: "no_matching_fixture",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  useQueryMock
    .mockReturnValueOnce({
      data: {
        id: "draft-pe4",
        userId: "72000000-0000-4000-8000-000000000001",
        mealType: "dinner",
        mainIngredients: ["卵アレルギー疑い"],
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
  const candidateQuery = useQueryMock.mock.calls[2]?.[0] as {
    enabled: boolean;
    queryFn: () => Promise<unknown>;
  };
  expect(candidateQuery.enabled).toBe(true);
  await candidateQuery.queryFn();

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const posted = postedEmergencyRequest(fetchMock.mock.calls[0]);
  const url = new URL(posted.url, "http://localhost");
  expect(url.pathname).toBe("/api/emergency-menus");
  expect(url.searchParams.has("mainIngredients")).toBe(false);
  expect(url.search).toBe("");
  expect(posted.method).toBe("POST");
  expect(posted.body).toEqual(
    expect.objectContaining({
      mealType: "dinner",
      mainIngredients: ["卵アレルギー疑い"],
      targetMode: "idea",
      targetMemberIds: [],
    }),
  );
  expect(screen.queryByText("安全です")).not.toBeInTheDocument();
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

it("PE6: idea draft still subscribes to generation_drafts safety channel", () => {
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
  expect(channelMock).toHaveBeenCalledWith("emergency-safety:72000000-0000-4000-8000-000000000001");
});

it("PE1: 未選択で適格親と未確認の子がいるときは部分集合 GET せず卵候補も出さない", () => {
  const eligibleId = "72000000-0000-4000-8000-000000000010";
  const unconfirmedId = "72000000-0000-4000-8000-000000000012";
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
          display_name: "太郎",
          status: "complete",
          allergy_status: "none",
          unsupported_diet_status: "none",
          hasConfirmedCustomAllergy: false,
        },
        {
          id: "72000000-0000-4000-8000-000000000011",
          display_name: "下書き",
          status: "draft",
          allergy_status: "none",
          unsupported_diet_status: "none",
          hasConfirmedCustomAllergy: false,
        },
        {
          id: unconfirmedId,
          display_name: "花子",
          status: "complete",
          allergy_status: "unconfirmed",
          unsupported_diet_status: "none",
          hasConfirmedCustomAllergy: false,
        },
      ],
      isSuccess: true,
      isFetching: false,
      isError: false,
    })
    .mockReturnValueOnce({
      data: eggHouseholdEmergencyResponse(),
      isSuccess: true,
      isFetching: false,
      isError: false,
    });

  renderWithRouter(<EmergencyMenuPage />);

  const candidateQuery = useQueryMock.mock.calls[2]?.[0] as {
    enabled: boolean;
    queryKey: readonly unknown[];
    queryFn: () => Promise<unknown>;
  };
  expect(candidateQuery.enabled).toBe(false);
  expect(candidateQuery.queryKey[5]).toEqual([]);
  expect(getEmergencyMenusMock).not.toHaveBeenCalled();
  expect(screen.queryByText("卵焼き", { exact: false })).not.toBeInTheDocument();
  // PE-R1: 未選択 fail-closed は部分集合 GET をしていない。PE4 告知は出さない。
  expect(screen.queryByTestId("emergency-ineligible-selected-notice")).not.toBeInTheDocument();
  expect(screen.queryByText(/選んだ家族のうち/u)).not.toBeInTheDocument();
  expect(screen.queryByText(/対象にできた家族の条件だけを見ています/u)).not.toBeInTheDocument();
  expect(
    screen.getByText(
      "アレルギー確認未了・自由登録アレルギー、または対応できない食事条件のため、候補を表示していません。条件は緩めていません",
    ),
  ).toBeVisible();
  expect(screen.queryByText(/安全です/u)).not.toBeInTheDocument();
});

it("PE1: 未選択で対象外食の子がいるときは registered 親だけの部分集合 GET をしない", () => {
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
          display_name: "親",
          status: "complete",
          allergy_status: "registered",
          unsupported_diet_status: "none",
          hasConfirmedCustomAllergy: false,
        },
        {
          id: "72000000-0000-4000-8000-000000000021",
          display_name: "次郎",
          status: "complete",
          allergy_status: "none",
          unsupported_diet_status: "present",
          hasConfirmedCustomAllergy: false,
        },
        {
          id: "72000000-0000-4000-8000-000000000022",
          display_name: "三郎",
          status: "complete",
          allergy_status: "none",
          unsupported_diet_status: "unconfirmed",
          hasConfirmedCustomAllergy: false,
        },
      ],
      isSuccess: true,
      isFetching: false,
      isError: false,
    })
    .mockReturnValueOnce({
      data: eggHouseholdEmergencyResponse(),
      isSuccess: true,
      isFetching: false,
      isError: false,
    });

  renderWithRouter(<EmergencyMenuPage />);
  const candidateQuery = useQueryMock.mock.calls[2]?.[0] as {
    enabled: boolean;
    queryFn: () => Promise<unknown>;
  };
  expect(candidateQuery.enabled).toBe(false);
  expect(getEmergencyMenusMock).not.toHaveBeenCalled();
  expect(screen.queryByText("卵焼き", { exact: false })).not.toBeInTheDocument();
  // PE-R1: 対象外食でも未選択 fail-closed は PE4 部分集合告知を出さない。
  expect(screen.queryByTestId("emergency-ineligible-selected-notice")).not.toBeInTheDocument();
  expect(screen.queryByText(/選んだ家族のうち/u)).not.toBeInTheDocument();
  expect(screen.queryByText(/対象にできた家族の条件だけを見ています/u)).not.toBeInTheDocument();
  expect(
    screen.getByText(
      "アレルギー確認未了・自由登録アレルギー、または対応できない食事条件のため、候補を表示していません。条件は緩めていません",
    ),
  ).toBeVisible();
});

it("対象未選択で未完了 draft だけが混ざるときは eligible だけを初期対象にする", async () => {
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
  expect(screen.queryByTestId("emergency-ineligible-selected-notice")).not.toBeInTheDocument();
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
          display_name: "太郎",
          status: "complete",
          allergy_status: "registered",
          unsupported_diet_status: "none",
          hasConfirmedCustomAllergy: false,
        },
        {
          id: invalidSelectedId,
          display_name: "花子",
          status: "complete",
          allergy_status: "none",
          unsupported_diet_status: "present",
          hasConfirmedCustomAllergy: false,
        },
        {
          id: "72000000-0000-4000-8000-000000000032",
          display_name: "次郎",
          status: "complete",
          allergy_status: "none",
          unsupported_diet_status: "none",
          hasConfirmedCustomAllergy: false,
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
  // PE4: 適格外を silent drop せず、対象から外したことを開示する
  expect(screen.getByTestId("emergency-ineligible-selected-notice")).toHaveTextContent("花子");
  expect(screen.getByTestId("emergency-ineligible-selected-notice")).toHaveTextContent(
    "対象にできた家族の条件だけを見ています",
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
    screen.getByText(
      "メイン食材は一致しませんでした。いまの家族条件で絞った候補を表示しています。",
    ),
  ).toBeVisible();
  expect(banner).toBeVisible();
  expect(banner).toHaveTextContent(
    "メイン食材は一致しませんでした。いまの家族条件で絞った候補を表示しています。",
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
    screen.queryByText(
      "メイン食材は一致しませんでした。いまの家族条件で絞った候補を表示しています。",
    ),
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
  expect(screen.getByTestId("idea-allergy-not-applied-note")).toHaveTextContent(
    "この一覧はご家庭のアレルギー登録を見ていません。家族の制限がある場合は献立画面で「家族向け」に切り替えてください。",
  );
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

it("PE9: keeps candidates while candidate query is background-refetching with cache", () => {
  // 旧: isFetching だけで loading → response null → 候補フラッシュ。
  // 新: キャッシュがある背景 refetch では intro/候補/開示を維持する。
  const menu = makeValidatedMenu();
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
      isFetching: false,
      isError: false,
    })
    .mockReturnValueOnce({
      data: undefined,
      isSuccess: false,
      isPending: false,
      isFetching: false,
      isError: false,
    })
    .mockReturnValueOnce({
      data: {
        fixtureVersion: "2026-07-28.v1",
        candidates: [{ menu, memberLabels: {}, allergenLabels: {}, labelWarnings: [] }],
        message: "AIを使わない15分緊急献立です",
        consumesAiQuota: false,
        path: "idea",
        matchMode: "none",
        emptyReason: null,
      } satisfies EmergencyMenusData,
      isSuccess: true,
      isPending: false,
      isFetching: true,
      isError: false,
    });

  renderWithRouter(<EmergencyMenuPage />);

  expect(screen.getByText(/個人向けの固定候補です/u)).toBeVisible();
  // 見出しと材料に同名が並ぶため getAll
  expect(screen.getAllByText(menu.dishes[0]!.name, { exact: false }).length).toBeGreaterThan(0);
  expect(screen.queryByText("候補を確認中…")).toBeNull();
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
    screen.queryByText(
      "メイン食材は一致しませんでした。いまの家族条件で絞った候補を表示しています。",
    ),
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
    screen.queryByText(
      "メイン食材は一致しませんでした。いまの家族条件で絞った候補を表示しています。",
    ),
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

it("shows differentiated post-API empty copy for household allergen_missing", () => {
  renderWithRouter(
    <EmergencyMenuContent
      loading={false}
      error={null}
      expectedPath="household"
      response={{
        fixtureVersion: "2026-07-28.v1",
        candidates: [],
        message: "アレルギー情報の登録が必要です。家族の設定を確認してください。",
        consumesAiQuota: false,
        path: "household",
        matchMode: null,
        emptyReason: "allergen_missing",
      }}
    />,
  );
  expect(
    screen.getByText("アレルギー情報の登録が必要です。家族の設定を確認してください。"),
  ).toBeVisible();
  expect(
    screen.getByText("アレルギー情報が足りないため、候補を表示していません。条件は緩めていません"),
  ).toBeVisible();
  expect(
    screen.queryByText(
      "いまのアレルギー・年齢に合う15分固定候補がありません。条件は緩めていません",
    ),
  ).toBeNull();
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

it("PE4: empty pantryUsage with matching selected pantry does not claim none were selected", () => {
  const menu = makeValidatedMenu();
  renderWithRouter(
    <EmergencyMenuContent
      loading={false}
      error={null}
      expectedPath="household"
      selectedPantryNames={["ごはん"]}
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
  expect(screen.queryByText("今回選んだ冷蔵庫食材はありません。")).not.toBeInTheDocument();
  const pantrySection = screen
    .getByRole("heading", { name: "冷蔵庫食材の使い方" })
    .closest("section");
  if (pantrySection === null) throw new Error("pantry section missing");
  expect(within(pantrySection).getByText("ごはん")).toBeVisible();
  expect(
    within(pantrySection).getByText("献立の材料や手順に名前が出ています。分量は記録していません。"),
  ).toBeVisible();
});

it("PE4: empty pantryUsage with unmatched selected pantry does not claim none were selected", () => {
  const menu = makeValidatedMenu();
  renderWithRouter(
    <EmergencyMenuContent
      loading={false}
      error={null}
      expectedPath="household"
      selectedPantryNames={["とうふ"]}
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
  expect(screen.queryByText("今回選んだ冷蔵庫食材はありません。")).not.toBeInTheDocument();
  expect(screen.getByText("選んだ冷蔵庫食材は、この候補では使っていません。")).toBeVisible();
});

it("PE4: empty pantryUsage without selected pantry keeps the no-selection copy", () => {
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
  expect(screen.getByText("今回選んだ冷蔵庫食材はありません。")).toBeVisible();
});

it("PE8: pantry-selected draft does not start candidate query before pantry load", () => {
  // idle のあいだ候補を起動すると、読込完了後の再 enabled で二重 GET になる。
  listPantryItemsMock.mockReturnValue(new Promise(() => undefined));
  useQueryMock.mockImplementation((opts: { queryKey: readonly unknown[]; enabled?: boolean }) => {
    const root = opts.queryKey[0];
    if (root === "planner") {
      return {
        data: {
          id: "draft-pantry-idle",
          userId: "72000000-0000-4000-8000-000000000001",
          mealType: "dinner",
          mainIngredients: ["卵"],
          cuisineGenre: null,
          targetMode: "idea",
          targetMemberIds: [],
          servings: 2,
          timeLimitMinutes: null,
          budgetPreference: null,
          ingredientPreference: null,
          avoidIngredients: [],
          memo: "",
          pantrySelections: [
            {
              pantryItemId: "60000000-0000-4000-8000-000000000099",
              priority: "prefer_use",
            },
          ],
          revision: 1,
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
        },
        isSuccess: true,
        isPending: false,
        isFetching: false,
        isError: false,
      };
    }
    return {
      data: undefined,
      isSuccess: false,
      isPending: false,
      isFetching: false,
      isError: false,
    };
  });

  renderWithRouter(<EmergencyMenuPage />);

  expect(emergencyMenusQueryCallEnabled(true)).toBe(false);
  expect(emergencyMenusQueryCallEnabled(false)).toBe(true);
  expect(getEmergencyMenusMock).not.toHaveBeenCalled();
});

it("PE8: direct /emergency-menus blocks candidate query for unconfirmed past-dated pantry", async () => {
  // planner CTA を経由せず URL 直打ちしたとき、未確認の期限切れ選択があるうちは候補 API を起動しない。
  const expiredId = "60000000-0000-4000-8000-000000000001";
  const expiredItem: PantryItem = {
    id: expiredId,
    userId: "72000000-0000-4000-8000-000000000001",
    name: "牛乳",
    quantity: 1,
    unit: "本",
    expiresOn: "2020-01-01",
    expirationType: "use_by",
    openedState: "opened",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
  listPantryItemsMock.mockResolvedValue([expiredItem]);
  // pantry 読込後の再レンダーでも mock が切れないよう queryKey 分岐
  useQueryMock.mockImplementation((opts: { queryKey: readonly unknown[]; enabled?: boolean }) => {
    const root = opts.queryKey[0];
    if (root === "planner") {
      return {
        data: {
          id: "draft-expired",
          userId: "72000000-0000-4000-8000-000000000001",
          mealType: "dinner",
          mainIngredients: ["卵"],
          cuisineGenre: null,
          targetMode: "idea",
          targetMemberIds: [],
          servings: 2,
          timeLimitMinutes: null,
          budgetPreference: null,
          ingredientPreference: null,
          avoidIngredients: [],
          memo: "",
          pantrySelections: [{ pantryItemId: expiredId, priority: "prefer_use" }],
          revision: 1,
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
        },
        isSuccess: true,
        isPending: false,
        isFetching: false,
        isError: false,
      };
    }
    return {
      data: undefined,
      isSuccess: false,
      isPending: false,
      isFetching: false,
      isError: false,
    };
  });

  renderWithRouter(<EmergencyMenuPage />);

  await waitFor(() => {
    expect(screen.getByTestId("emergency-expired-pantry-gate")).toBeVisible();
  });
  expect(screen.getByRole("alertdialog", { name: "期限を過ぎた食材の確認" })).toBeVisible();
  // 候補 query は expired ゲート中 enabled:false
  expect(emergencyMenusQueryCallEnabled(false)).toBe(true);
  expect(getEmergencyMenusMock).not.toHaveBeenCalled();
});

it("PE8: confirming expired pantry on emergency page enables candidate query", async () => {
  const expiredId = "60000000-0000-4000-8000-000000000002";
  const expiredItem: PantryItem = {
    id: expiredId,
    userId: "72000000-0000-4000-8000-000000000001",
    name: "豆腐",
    quantity: 1,
    unit: "丁",
    expiresOn: "2020-01-01",
    expirationType: "best_before",
    openedState: "unopened",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
  listPantryItemsMock.mockResolvedValue([expiredItem]);

  // 確認後に再レンダーされるため queryKey で draft / household / candidate を分岐する
  useQueryMock.mockImplementation((opts: { queryKey: readonly unknown[]; enabled?: boolean }) => {
    const root = opts.queryKey[0];
    if (root === "planner") {
      return {
        data: {
          id: "draft-expired-2",
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
          pantrySelections: [{ pantryItemId: expiredId, priority: "prefer_use" }],
          revision: 1,
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
        },
        isSuccess: true,
        isPending: false,
        isFetching: false,
        isError: false,
      };
    }
    if (root === "emergency-menus" && opts.enabled === true) {
      return {
        data: undefined,
        isSuccess: false,
        isPending: true,
        isFetching: true,
        isError: false,
      };
    }
    return {
      data: undefined,
      isSuccess: false,
      isPending: false,
      isFetching: false,
      isError: false,
    };
  });

  const user = userEvent.setup();
  renderWithRouter(<EmergencyMenuPage />);

  await waitFor(() => {
    expect(screen.getByTestId("emergency-expired-pantry-gate")).toBeVisible();
  });
  await user.click(screen.getByRole("button", { name: "実物を確認して進む" }));

  await waitFor(() => {
    expect(screen.queryByTestId("emergency-expired-pantry-gate")).toBeNull();
  });
  // ゲート解除後に emergency-menus が enabled:true で起動する
  expect(emergencyMenusQueryCallEnabled(true)).toBe(true);
});

it("PE1: confirmed expired pantry IDs are dropped from scoring pantryItemIds", async () => {
  const expiredId = "60000000-0000-4000-8000-000000000003";
  const freshId = "60000000-0000-4000-8000-000000000004";
  const expiredItem: PantryItem = {
    id: expiredId,
    userId: "72000000-0000-4000-8000-000000000001",
    name: "豆腐",
    quantity: 1,
    unit: "丁",
    expiresOn: "2020-01-01",
    expirationType: "best_before",
    openedState: "unopened",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
  const freshItem: PantryItem = {
    ...expiredItem,
    id: freshId,
    name: "キャベツ",
    expiresOn: "2099-01-01",
  };
  listPantryItemsMock.mockResolvedValue([expiredItem, freshItem]);

  useQueryMock.mockImplementation((opts: { queryKey: readonly unknown[]; enabled?: boolean }) => {
    const root = opts.queryKey[0];
    if (root === "planner") {
      return {
        data: {
          id: "draft-pe1",
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
          pantrySelections: [
            { pantryItemId: expiredId, priority: "prefer_use" },
            { pantryItemId: freshId, priority: "prefer_use" },
          ],
          revision: 1,
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
        },
        isSuccess: true,
        isPending: false,
        isFetching: false,
        isError: false,
      };
    }
    if (root === "emergency-menus" && opts.enabled === true) {
      return {
        data: undefined,
        isSuccess: false,
        isPending: true,
        isFetching: true,
        isError: false,
      };
    }
    return {
      data: undefined,
      isSuccess: false,
      isPending: false,
      isFetching: false,
      isError: false,
    };
  });

  const user = userEvent.setup();
  renderWithRouter(<EmergencyMenuPage />);

  await waitFor(() => {
    expect(screen.getByTestId("emergency-expired-pantry-gate")).toBeVisible();
  });
  expect(
    screen.getByText("確認は候補を見るための解錠です。期限切れの食材は候補に使いません。"),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "実物を確認して進む" }));

  await waitFor(() => {
    expect(screen.queryByTestId("emergency-expired-pantry-gate")).toBeNull();
  });
  const enabledCandidates = useQueryMock.mock.calls.filter((call) => {
    const options = call[0] as { queryKey?: readonly unknown[]; enabled?: boolean } | undefined;
    return options?.queryKey?.[0] === "emergency-menus" && options.enabled === true;
  });
  expect(enabledCandidates.length).toBeGreaterThan(0);
  const queryKey = (enabledCandidates.at(-1)?.[0] as { queryKey: readonly unknown[] }).queryKey;
  // 確認済み期限切れはスコア対象から外し、未期限切れだけ残す
  expect(queryKey[6]).toEqual([freshId]);
});

it("PE2: pantry gate reloads on focus after another tab changes expiry", async () => {
  const milkId = "60000000-0000-4000-8000-000000000005";
  const freshMilk: PantryItem = {
    id: milkId,
    userId: "72000000-0000-4000-8000-000000000001",
    name: "牛乳",
    quantity: 1,
    unit: "本",
    expiresOn: "2099-01-01",
    expirationType: "use_by",
    openedState: "unopened",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
  const expiredMilk: PantryItem = { ...freshMilk, expiresOn: "2020-01-01" };
  listPantryItemsMock.mockResolvedValue([freshMilk]);

  useQueryMock.mockImplementation((opts: { queryKey: readonly unknown[]; enabled?: boolean }) => {
    const root = opts.queryKey[0];
    if (root === "planner") {
      return {
        data: {
          id: "draft-pe2",
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
          pantrySelections: [{ pantryItemId: milkId, priority: "prefer_use" }],
          revision: 1,
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
        },
        isSuccess: true,
        isPending: false,
        isFetching: false,
        isError: false,
      };
    }
    if (root === "emergency-menus" && opts.enabled === true) {
      return {
        data: undefined,
        isSuccess: false,
        isPending: true,
        isFetching: true,
        isError: false,
      };
    }
    return {
      data: undefined,
      isSuccess: false,
      isPending: false,
      isFetching: false,
      isError: false,
    };
  });

  renderWithRouter(<EmergencyMenuPage />);

  await waitFor(() => {
    expect(listPantryItemsMock).toHaveBeenCalled();
  });
  expect(screen.queryByTestId("emergency-expired-pantry-gate")).toBeNull();
  expect(emergencyMenusQueryCallEnabled(true)).toBe(true);

  listPantryItemsMock.mockResolvedValue([expiredMilk]);
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });

  await waitFor(() => {
    expect(screen.getByTestId("emergency-expired-pantry-gate")).toBeVisible();
  });
});

it.each(["CHANNEL_ERROR", "TIMED_OUT"] as const)(
  "PE7: pantry Realtime %s fail-closes the expiry gate",
  async (status) => {
    const milkId = "60000000-0000-4000-8000-000000000006";
    const freshMilk: PantryItem = {
      id: milkId,
      userId: "72000000-0000-4000-8000-000000000001",
      name: "牛乳",
      quantity: 1,
      unit: "本",
      expiresOn: "2099-01-01",
      expirationType: "use_by",
      openedState: "unopened",
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    const expiredMilk: PantryItem = { ...freshMilk, expiresOn: "2020-01-01" };
    listPantryItemsMock.mockResolvedValue([freshMilk]);

    useQueryMock.mockImplementation((opts: { queryKey: readonly unknown[]; enabled?: boolean }) => {
      const root = opts.queryKey[0];
      if (root === "planner") {
        return {
          data: {
            id: "draft-pe7",
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
            pantrySelections: [{ pantryItemId: milkId, priority: "prefer_use" }],
            revision: 1,
            createdAt: "2026-07-11T00:00:00.000Z",
            updatedAt: "2026-07-11T00:00:00.000Z",
          },
          isSuccess: true,
          isPending: false,
          isFetching: false,
          isError: false,
        };
      }
      if (root === "emergency-menus" && opts.enabled === true) {
        return {
          data: undefined,
          isSuccess: false,
          isPending: true,
          isFetching: true,
          isError: false,
        };
      }
      return {
        data: undefined,
        isSuccess: false,
        isPending: false,
        isFetching: false,
        isError: false,
      };
    });

    renderWithRouter(<EmergencyMenuPage />);

    await waitFor(() => {
      expect(listPantryItemsMock).toHaveBeenCalled();
      expect(subscribeCallbacks.length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId("emergency-expired-pantry-gate")).toBeNull();

    listPantryItemsMock.mockResolvedValue([expiredMilk]);
    act(() => {
      for (const callback of subscribeCallbacks) {
        callback(status);
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId("emergency-expired-pantry-gate")).toBeVisible();
    });
  },
);

it("PE3: unknown expired pantry ID added while ready does not enable candidate GET before confirmation", async () => {
  // pantry ready のまま draft に旧 rows に無い期限切れ ID が着くと、
  // item === undefined → 確認済み扱いで GET が先に走る窓があった。
  const knownId = "60000000-0000-4000-8000-000000000010";
  const unknownExpiredId = "60000000-0000-4000-8000-000000000011";
  const userId = "72000000-0000-4000-8000-000000000001";
  const knownItem: PantryItem = {
    id: knownId,
    userId,
    name: "キャベツ",
    quantity: 1,
    unit: "個",
    expiresOn: "2099-01-01",
    expirationType: "best_before",
    openedState: "unopened",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
  let pantrySelections: { pantryItemId: string; priority: "prefer_use" }[] = [
    { pantryItemId: knownId, priority: "prefer_use" },
  ];
  listPantryItemsMock.mockResolvedValue([knownItem]);

  useQueryMock.mockImplementation((opts: { queryKey: readonly unknown[]; enabled?: boolean }) => {
    const root = opts.queryKey[0];
    if (root === "planner") {
      return {
        data: {
          id: "draft-pe3",
          userId,
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
          pantrySelections,
          revision: 1,
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
        },
        isSuccess: true,
        isPending: false,
        isFetching: false,
        isError: false,
      };
    }
    if (root === "emergency-menus" && opts.enabled === true) {
      return {
        data: undefined,
        isSuccess: false,
        isPending: true,
        isFetching: true,
        isError: false,
      };
    }
    return {
      data: undefined,
      isSuccess: false,
      isPending: false,
      isFetching: false,
      isError: false,
    };
  });

  renderWithRouter(<EmergencyMenuPage />);

  await waitFor(() => {
    expect(listPantryItemsMock).toHaveBeenCalled();
    expect(emergencyMenusQueryCallEnabled(true)).toBe(true);
  });
  expect(screen.queryByTestId("emergency-expired-pantry-gate")).toBeNull();

  const nextPantry = deferredPromise<readonly PantryItem[]>();
  listPantryItemsMock.mockReturnValue(nextPantry.promise);
  pantrySelections = [
    { pantryItemId: knownId, priority: "prefer_use" },
    { pantryItemId: unknownExpiredId, priority: "prefer_use" },
  ];
  const callsBeforeDraftUpdate = useQueryMock.mock.calls.length;

  act(() => {
    window.dispatchEvent(new Event("focus"));
  });

  const afterDraftUpdate = emergencyMenusQueryCallsAfter(callsBeforeDraftUpdate);
  expect(afterDraftUpdate.length).toBeGreaterThan(0);
  expect(
    afterDraftUpdate.some((call) => {
      const pantryIds = call.queryKey[6];
      return (
        call.enabled === true && Array.isArray(pantryIds) && pantryIds.includes(unknownExpiredId)
      );
    }),
  ).toBe(false);
  // 再読込完了前はゲートを閉じ、確認前 GET を起動しない
  expect(afterDraftUpdate.every((call) => call.enabled === false)).toBe(true);
  expect(getEmergencyMenusMock).not.toHaveBeenCalled();

  const expiredUnknown: PantryItem = {
    ...knownItem,
    id: unknownExpiredId,
    name: "牛乳",
    expiresOn: "2020-01-01",
    expirationType: "use_by",
  };
  await act(async () => {
    nextPantry.resolve([knownItem, expiredUnknown]);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(screen.getByTestId("emergency-expired-pantry-gate")).toBeVisible();
  });
  expect(
    emergencyMenusQueryCallsAfter(callsBeforeDraftUpdate).every((call) => call.enabled === false),
  ).toBe(true);
  expect(getEmergencyMenusMock).not.toHaveBeenCalled();
});
