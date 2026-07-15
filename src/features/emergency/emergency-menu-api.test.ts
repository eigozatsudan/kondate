import { expect, it } from "vitest";
import { makeValidatedMenu } from "@shared/testing/factories";
import { parseEmergencyMenusResponse } from "./emergency-menu-api";

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
            labelWarnings: [
              {
                sourceType: "ingredient",
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
