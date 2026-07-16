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
    getEmergencyMenus({ mealType: "dinner", targetMemberIds, pantryItemIds: [] }),
  ).rejects.toThrow();

  expect(requireAccessTokenMock).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("keys candidates by every ordered request dimension and the household safety revision", () => {
  expect(
    emergencyMenuKeys.candidates({
      userId: "user-1",
      mealType: "dinner",
      targetMemberIds: ["member-b", "member-a"],
      pantryItemIds: ["pantry-2", "pantry-1"],
      householdSafetyRevision: "safety-3",
    }),
  ).toEqual([
    "emergency-menus",
    "user-1",
    "dinner",
    ["member-b", "member-a"],
    ["pantry-2", "pantry-1"],
    "safety-3",
  ]);
});

it("accepts only complete server-provided human display labels", () => {
  const menu = makeValidatedMenu();
  const complete = {
    ok: true,
    data: {
      fixtureVersion: "2026-07-11.v1",
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
        fixtureVersion: "2026-07-11.v1",
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
      },
    }),
  ).toThrow();
});
