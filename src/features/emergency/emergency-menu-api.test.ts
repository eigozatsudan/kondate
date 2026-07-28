import { beforeEach, expect, it, vi } from "vitest";
import { makeValidatedMenu } from "@shared/testing/factories";
import {
  emergencyMenuKeys,
  getEmergencyMenus,
  parseEmergencyMenusResponse,
} from "./emergency-menu-api";

const requireAccessTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth/session", () => ({ requireAccessToken: requireAccessTokenMock }));
vi.mock("@/shared/lib/supabase", () => ({ getBrowserSupabaseClient: () => ({}) }));

/** 空候補の最小 household wire（schema 不変条件: emptyReason 必須・matchMode=null） */
function emptyHouseholdData(message = "条件に合う緊急献立がありません") {
  return {
    fixtureVersion: "2026-07-28.v1",
    candidates: [] as const,
    message,
    consumesAiQuota: false as const,
    path: "household" as const,
    matchMode: null,
    emptyReason: "no_matching_fixture" as const,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAccessTokenMock.mockResolvedValue("token");
  vi.stubGlobal("fetch", vi.fn());
});

it.each([
  ["空", []],
  ["重複", ["70000000-0000-4000-8000-000000000001", "70000000-0000-4000-8000-000000000001"]],
  [
    "21件",
    Array.from(
      { length: 21 },
      (_, index) => `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    ),
  ],
])("対象家族IDが%sなら認証や通信の前に拒否する", async (_, targetMemberIds) => {
  await expect(
    getEmergencyMenus({
      mealType: "dinner",
      mainIngredients: [],
      targetMode: "household",
      targetMemberIds,
      pantryItemIds: [],
    }),
  ).rejects.toThrow();

  expect(requireAccessTokenMock).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  ["重複", ["74000000-0000-4000-8000-000000000001", "74000000-0000-4000-8000-000000000001"]],
  [
    "51件",
    Array.from(
      { length: 51 },
      (_, index) => `74000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    ),
  ],
])("冷蔵庫食材IDが%sなら認証や通信の前に拒否する", async (_, pantryItemIds) => {
  await expect(
    getEmergencyMenus({
      mealType: "dinner",
      mainIngredients: [],
      targetMode: "household",
      targetMemberIds: ["70000000-0000-4000-8000-000000000001"],
      pantryItemIds,
    }),
  ).rejects.toThrow();

  expect(requireAccessTokenMock).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("冷蔵庫食材IDは上限50件まで通信に使える", async () => {
  const pantryItemIds = Array.from(
    { length: 50 },
    (_, index) => `74000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  );
  vi.mocked(fetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        ok: true,
        data: emptyHouseholdData(),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );

  await getEmergencyMenus({
    mealType: "dinner",
    mainIngredients: [],
    targetMode: "household",
    targetMemberIds: ["70000000-0000-4000-8000-000000000001"],
    pantryItemIds,
  });

  expect(requireAccessTokenMock).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("冷蔵庫食材が空なら空のクエリ値を送らずサーバーの省略時契約に合わせる", async () => {
  vi.mocked(fetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        ok: true,
        data: emptyHouseholdData(),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );

  await getEmergencyMenus({
    mealType: "dinner",
    mainIngredients: [],
    targetMode: "household",
    targetMemberIds: ["70000000-0000-4000-8000-000000000001"],
    pantryItemIds: [],
  });

  const requestedUrl = vi.mocked(fetch).mock.calls[0]?.[0];
  if (typeof requestedUrl !== "string")
    throw new Error("緊急献立のリクエストURLを確認できませんでした");
  expect(new URL(requestedUrl, "http://localhost").searchParams.has("pantryItemIds")).toBe(false);
});

it("always sends targetMode=household on the query string", async () => {
  vi.mocked(fetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        ok: true,
        data: emptyHouseholdData(),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );

  await getEmergencyMenus({
    mealType: "dinner",
    mainIngredients: [],
    targetMode: "household",
    targetMemberIds: ["70000000-0000-4000-8000-000000000001"],
    pantryItemIds: [],
  });

  const requestedUrl = vi.mocked(fetch).mock.calls[0]?.[0];
  if (typeof requestedUrl !== "string")
    throw new Error("緊急献立のリクエストURLを確認できませんでした");
  expect(new URL(requestedUrl, "http://localhost").searchParams.get("targetMode")).toBe(
    "household",
  );
});

/** 空候補の最小 idea wire（schema: emptyReason=no_matching_fixture・matchMode=null） */
function emptyIdeaData(message = "条件に合う緊急献立がありません") {
  return {
    fixtureVersion: "2026-07-28.v1",
    candidates: [] as const,
    message,
    consumesAiQuota: false as const,
    path: "idea" as const,
    matchMode: null,
    emptyReason: "no_matching_fixture" as const,
  };
}

it("sends targetMode=idea and omits targetMemberIds on the query string", async () => {
  vi.mocked(fetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        ok: true,
        data: emptyIdeaData(),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );

  await getEmergencyMenus({
    mealType: "dinner",
    mainIngredients: [],
    targetMode: "idea",
    targetMemberIds: [],
    pantryItemIds: [],
  });

  const requestedUrl = vi.mocked(fetch).mock.calls[0]?.[0];
  if (typeof requestedUrl !== "string")
    throw new Error("緊急献立のリクエストURLを確認できませんでした");
  const params = new URL(requestedUrl, "http://localhost").searchParams;
  expect(params.get("targetMode")).toBe("idea");
  // idea では targetMemberIds キー自体を載せない（サーバ: キー未送出のみ許可）
  expect(params.has("targetMemberIds")).toBe(false);
});

it("rejects when response path does not match request targetMode", async () => {
  // idea 要求に household path が返ると家族絞り込み chrome の誤表示になるため fail-closed
  vi.mocked(fetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        ok: true,
        data: emptyHouseholdData(),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );

  await expect(
    getEmergencyMenus({
      mealType: "dinner",
      mainIngredients: [],
      targetMode: "idea",
      targetMemberIds: [],
      pantryItemIds: [],
    }),
  ).rejects.toThrow(/応答経路/u);
});

it("rejects idea requests with non-empty targetMemberIds at the client schema", async () => {
  await expect(
    getEmergencyMenus({
      mealType: "dinner",
      mainIngredients: [],
      targetMode: "idea",
      targetMemberIds: ["70000000-0000-4000-8000-000000000001"],
      pantryItemIds: [],
    }),
  ).rejects.toThrow();

  expect(requireAccessTokenMock).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("keys candidates by every ordered request dimension and the household safety revision", () => {
  expect(
    emergencyMenuKeys.candidates({
      userId: "user-1",
      mealType: "dinner",
      targetMode: "household",
      mainIngredients: ["鶏肉"],
      targetMemberIds: ["member-b", "member-a"],
      pantryItemIds: ["pantry-2", "pantry-1"],
      householdSafetyRevision: "safety-3",
    }),
  ).toEqual([
    "emergency-menus",
    "user-1",
    "dinner",
    "household",
    ["鶏肉"],
    ["member-b", "member-a"],
    ["pantry-2", "pantry-1"],
    "safety-3",
  ]);
});

it("main ingredients are normalized, sent as repeated query values, and included in the cache key", async () => {
  vi.mocked(fetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        ok: true,
        data: emptyHouseholdData("条件に合う緊急献立がありません"),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );

  await getEmergencyMenus({
    mealType: "dinner",
    mainIngredients: ["　鶏肉　", "ｷｬﾍﾞﾂ"],
    targetMode: "household",
    targetMemberIds: ["70000000-0000-4000-8000-000000000001"],
    pantryItemIds: [],
  });

  const requestedUrl = vi.mocked(fetch).mock.calls[0]?.[0];
  if (typeof requestedUrl !== "string")
    throw new Error("緊急献立のリクエストURLを確認できませんでした");
  expect(new URL(requestedUrl, "http://localhost").searchParams.getAll("mainIngredients")).toEqual([
    "鶏肉",
    "キャベツ",
  ]);
});

it.each([
  [["鶏肉", "　鶏肉　"]],
  [Array.from({ length: 9 }, (_, index) => `食材${String(index)}`)],
  [["あ".repeat(81)]],
] as const)(
  "main ingredients reject %s before authentication or network",
  async (mainIngredients) => {
    await expect(
      getEmergencyMenus({
        mealType: "dinner",
        mainIngredients,
        targetMode: "household",
        targetMemberIds: ["70000000-0000-4000-8000-000000000001"],
        pantryItemIds: [],
      }),
    ).rejects.toThrow();

    expect(requireAccessTokenMock).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("accepts only complete server-provided human display labels", () => {
  const menu = makeValidatedMenu();
  const complete = {
    ok: true,
    data: {
      fixtureVersion: "2026-07-28.v1",
      candidates: [
        {
          menu,
          memberLabels: {},
          allergenLabels: {},
          labelWarnings: [],
        },
      ],
      message: "AIを使わない15分緊急献立です",
      consumesAiQuota: false,
      path: "household" as const,
      matchMode: "none" as const,
      emptyReason: null,
    },
  };
  expect(parseEmergencyMenusResponse(complete).candidates).toHaveLength(1);

  expect(() =>
    parseEmergencyMenusResponse({
      ...complete,
      data: {
        ...complete.data,
        candidates: [
          {
            menu: {
              ...menu,
              labelConfirmations: [
                {
                  sourceType: "ingredient",
                  sourceId: menu.dishes[0]!.ingredients[0]!.id,
                  sourcePath: "dishes.0.ingredients.0.name",
                  sourceText: menu.dishes[0]!.ingredients[0]!.name,
                  allergenId: "wheat",
                  anonymousMemberRef: "member_1",
                  dictionaryVersion: "jp-caa-2026-04.v1",
                  confirmationStatus: "pending",
                  confirmedAt: null,
                  confirmedBy: null,
                },
              ],
            },
            memberLabels: { member_1: "子ども" },
            allergenLabels: { wheat: "小麦" },
            labelWarnings: [
              {
                sourceType: "ingredient",
                sourceId: menu.dishes[0]!.ingredients[0]!.id,
                sourcePath: "dishes.0.ingredients.0.name",
                allergenId: "wheat",
                anonymousMemberRef: "member_1",
                dictionaryVersion: "jp-caa-2026-04.v1",
                confirmationStatus: "pending",
              },
            ],
          },
        ],
      },
    }),
  ).toThrow();
});

it("rejects warnings whose canonical source/member correspondence is swapped", () => {
  const menu = makeValidatedMenu();
  const ingredient = menu.dishes[0]!.ingredients[0]!;
  const confirmations = [
    {
      sourceType: "ingredient" as const,
      sourceId: ingredient.id,
      sourcePath: "dishes.0.ingredients.0.name",
      sourceText: ingredient.name,
      allergenId: "wheat",
      anonymousMemberRef: "member_1",
      dictionaryVersion: "jp-caa-2026-04.v1",
      confirmationStatus: "pending" as const,
      confirmedAt: null,
      confirmedBy: null,
    },
    {
      sourceType: "ingredient" as const,
      sourceId: ingredient.id,
      sourcePath: "dishes.0.ingredients.0.name",
      sourceText: ingredient.name,
      allergenId: "milk",
      anonymousMemberRef: "member_2",
      dictionaryVersion: "jp-caa-2026-04.v1",
      confirmationStatus: "pending" as const,
      confirmedAt: null,
      confirmedBy: null,
    },
  ];
  const warningFor = (confirmation: (typeof confirmations)[number]) => ({
    sourceType: confirmation.sourceType,
    sourceId: confirmation.sourceId,
    sourcePath: confirmation.sourcePath,
    sourceDisplayName: confirmation.sourceText,
    allergenId: confirmation.allergenId,
    allergenDisplayName: confirmation.allergenId === "wheat" ? "小麦" : "乳",
    anonymousMemberRef: confirmation.anonymousMemberRef,
    memberDisplayName: confirmation.anonymousMemberRef === "member_1" ? "子ども" : "大人",
    dictionaryVersion: confirmation.dictionaryVersion,
    confirmationStatus: "pending" as const,
  });
  const warnings = confirmations.map(warningFor).reverse();

  expect(() =>
    parseEmergencyMenusResponse({
      ok: true,
      data: {
        fixtureVersion: "2026-07-28.v1",
        candidates: [
          {
            menu: { ...menu, labelConfirmations: confirmations },
            memberLabels: { member_1: "子ども", member_2: "大人" },
            allergenLabels: { wheat: "小麦", milk: "乳" },
            labelWarnings: warnings,
          },
        ],
        message: "確認してください",
        consumesAiQuota: false,
        path: "household",
        matchMode: "none",
        emptyReason: null,
      },
    }),
  ).toThrow();
});
