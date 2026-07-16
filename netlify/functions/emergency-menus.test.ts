import { describe, expect, it, vi } from "vitest";
import { makeCurrentSafetyContext } from "../../shared/testing/factories.js";
import { createEmergencyMenusHandler } from "./emergency-menus.js";

const userId = "80000000-0000-4000-8000-000000000001";
const memberId = "81000000-0000-4000-8000-000000000001";

describe("GET /api/emergency-menus", () => {
  it("returns an authenticated explicit no-candidate response without quota use", async () => {
    const context = makeCurrentSafetyContext();
    const handler = createEmergencyMenusHandler({
      authenticate: () => Promise.resolve({ userId }),
      loadContext: () =>
        Promise.resolve({
          context: makeCurrentSafetyContext({
            members: [
              {
                ...context.members[0]!,
                unsupportedDietStatus: "present",
                unsupportedDietKinds: ["therapeutic_diet"],
              },
            ],
          }),
          memberLabels: Object.freeze({ member_1: "家族1" }),
        }),
      loadPantryNames: () => Promise.resolve([]),
    });
    const response = await handler(
      new Request(`http://localhost/api/emergency-menus?meal=dinner&targetMemberIds=${memberId}`),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        candidates: [],
        message: "条件に合う緊急献立がありません",
        consumesAiQuota: false,
      },
    });
  });

  it.each([
    [
      Array.from(
        { length: 21 },
        (_, index) => `81000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      ),
    ],
    [[memberId, memberId]],
  ])("rejects invalid UUID lists before loading database state", async (ids) => {
    const loadContext = vi.fn();
    const handler = createEmergencyMenusHandler({
      authenticate: () => Promise.resolve({ userId }),
      loadContext,
      loadPantryNames: () => Promise.resolve([]),
    });
    const response = await handler(
      new Request(
        `http://localhost/api/emergency-menus?meal=dinner&targetMemberIds=${ids.join(",")}`,
      ),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(loadContext).not.toHaveBeenCalled();
  });

  it("冷蔵庫食材はPlannerの上限と同じ50件まで受け付ける", async () => {
    const pantryItemIds = Array.from(
      { length: 50 },
      (_, index) => `82000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    const loadPantryNames = vi.fn().mockResolvedValue([]);
    const handler = createEmergencyMenusHandler({
      authenticate: () => Promise.resolve({ userId }),
      loadContext: () =>
        Promise.resolve({
          context: makeCurrentSafetyContext(),
          memberLabels: Object.freeze({ member_1: "家族1" }),
        }),
      loadPantryNames,
    });

    const response = await handler(
      new Request(
        `http://localhost/api/emergency-menus?meal=dinner&targetMemberIds=${memberId}&pantryItemIds=${pantryItemIds.join(",")}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(loadPantryNames).toHaveBeenCalledWith(userId, pantryItemIds);
  });
});
