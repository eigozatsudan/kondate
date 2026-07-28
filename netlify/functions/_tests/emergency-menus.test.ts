import { describe, expect, it, vi } from "vitest";
import type { EmergencyMenusData } from "../../../shared/emergency/contracts.js";
import { emergencyFixtureMetadataV1 } from "../../../shared/emergency/fixtures.v1.js";
import { makeCurrentSafetyContext } from "../../../shared/testing/factories.js";
import { createEmergencyMenusHandler } from "../emergency-menus.js";

type SuccessEnvelope = { ok: true; data: EmergencyMenusData };

const userId = "80000000-0000-4000-8000-000000000001";
const memberId = "81000000-0000-4000-8000-000000000001";

/** 当該 fixture version の metadata 全 standardAllergenIds 和集合（Stage S 全滅用） */
function allFixtureAllergenUnion(): string[] {
  return [
    ...new Set(
      Object.values(emergencyFixtureMetadataV1).flatMap((meta) => meta.standardAllergenIds),
    ),
  ];
}

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
        path: "household",
        matchMode: null,
        emptyReason: "current_safety_unavailable",
        candidates: [],
        message: "条件に合う緊急献立がありません",
        consumesAiQuota: false,
      },
    });
  });

  it.each([{ unsupportedDietStatus: "present" as const }, { hasUnmappedCustomAllergy: true }])(
    "returns generic empty for early safety exclusion even when mains are set",
    async (memberPatch) => {
      const context = makeCurrentSafetyContext();
      const handler = createEmergencyMenusHandler({
        authenticate: () => Promise.resolve({ userId }),
        loadContext: () =>
          Promise.resolve({
            context: makeCurrentSafetyContext({
              members: [{ ...context.members[0]!, ...memberPatch }],
            }),
            memberLabels: Object.freeze({ member_1: "家族1" }),
          }),
        loadPantryNames: () => Promise.resolve([]),
      });
      const query = new URLSearchParams({
        meal: "dinner",
        targetMemberIds: memberId,
        mainIngredients: "鶏肉",
      });

      const response = await handler(
        new Request(`http://localhost/api/emergency-menus?${query.toString()}`),
      );

      // 早期 safety 除外は current_safety_unavailable → 汎用空メッセージ
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        data: {
          path: "household",
          matchMode: null,
          emptyReason: "current_safety_unavailable",
          candidates: [],
          message: "条件に合う緊急献立がありません",
        },
      });
    },
  );

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

  it("filters by normalized repeated main ingredients without relaxing unrelated requests", async () => {
    const handler = createEmergencyMenusHandler({
      authenticate: () => Promise.resolve({ userId }),
      loadContext: () =>
        Promise.resolve({
          context: makeCurrentSafetyContext(),
          memberLabels: Object.freeze({ member_1: "家族1" }),
        }),
      loadPantryNames: () => Promise.resolve([]),
    });

    const response = await handler(
      new Request(
        `http://localhost/api/emergency-menus?meal=dinner&targetMemberIds=${memberId}&mainIngredients=%E3%80%80%E9%B6%8F%E8%82%89%E3%80%80&mainIngredients=%EF%BD%B7%EF%BD%AC%EF%BE%8D%EF%BE%9E%EF%BE%82`,
      ),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        path: "household",
        matchMode: "main_ingredient",
        emptyReason: null,
        candidates: [expect.any(Object)],
        message: "AIを使わない15分緊急献立です",
        consumesAiQuota: false,
      },
    });

    // 豚肉は Stage M 不一致 → safety_only で非空候補 + サーバ用 safety_only 文言
    const unrelated = await handler(
      new Request(
        `http://localhost/api/emergency-menus?meal=dinner&targetMemberIds=${memberId}&mainIngredients=%E8%B1%9A%E8%82%89`,
      ),
    );
    expect(unrelated.status).toBe(200);
    const unrelatedBody = (await unrelated.json()) as SuccessEnvelope;
    expect(unrelatedBody).toMatchObject({
      ok: true,
      data: {
        path: "household",
        matchMode: "safety_only",
        emptyReason: null,
        message: "メイン食材は一致しませんでした。安全条件に合う固定候補を表示しています",
        consumesAiQuota: false,
      },
    });
    expect(unrelatedBody.data.candidates.length).toBeGreaterThan(0);
    expect(unrelatedBody.data.message).not.toContain(
      "選択したメイン食材に合う固定候補がありません",
    );
  });

  it("rejects normalized duplicate main ingredients before authentication or database reads", async () => {
    const authenticate = vi.fn();
    const loadContext = vi.fn();
    const handler = createEmergencyMenusHandler({
      authenticate,
      loadContext,
      loadPantryNames: vi.fn(),
    });

    const response = await handler(
      new Request(
        `http://localhost/api/emergency-menus?meal=dinner&targetMemberIds=${memberId}&mainIngredients=%E9%B6%8F%E8%82%89&mainIngredients=%E3%80%80%E9%B6%8F%E8%82%89%E3%80%80`,
      ),
    );

    expect(response.status).toBe(400);
    expect(authenticate).not.toHaveBeenCalled();
    expect(loadContext).not.toHaveBeenCalled();
  });

  it.each(["鶏 肉", "鶏。肉", "\u200B"])(
    "does not over-match the adversarial main ingredient %s",
    async (mainIngredient) => {
      const handler = createEmergencyMenusHandler({
        authenticate: () => Promise.resolve({ userId }),
        loadContext: () =>
          Promise.resolve({
            context: makeCurrentSafetyContext(),
            memberLabels: Object.freeze({ member_1: "家族1" }),
          }),
        loadPantryNames: () => Promise.resolve([]),
      });
      const query = new URLSearchParams({
        meal: "dinner",
        targetMemberIds: memberId,
        mainIngredients: mainIngredient,
      });

      const response = await handler(
        new Request(`http://localhost/api/emergency-menus?${query.toString()}`),
      );

      // forward 一致しない敵対的トークン → safety_only フォールバック（空にしない）
      expect(response.status).toBe(200);
      const body = (await response.json()) as SuccessEnvelope;
      expect(body).toMatchObject({
        ok: true,
        data: {
          path: "household",
          matchMode: "safety_only",
          emptyReason: null,
          message: "メイン食材は一致しませんでした。安全条件に合う固定候補を表示しています",
        },
      });
      expect(body.data.candidates.length).toBeGreaterThan(0);
    },
  );

  it("uses the generic empty message when the full allergen union excludes every fixture", async () => {
    // chicken 単独では複数 fixture が残るため、metadata 全 allergen 和集合で Stage S を空にする
    const context = makeCurrentSafetyContext();
    const union = allFixtureAllergenUnion();
    expect(union.length).toBeGreaterThan(0);
    const handler = createEmergencyMenusHandler({
      authenticate: () => Promise.resolve({ userId }),
      loadContext: () =>
        Promise.resolve({
          context: makeCurrentSafetyContext({
            members: [
              {
                ...context.members[0]!,
                allergyStatus: "registered",
                allergenIds: union,
              },
            ],
          }),
          memberLabels: Object.freeze({ member_1: "家族1" }),
        }),
      loadPantryNames: () => Promise.resolve([]),
    });

    const response = await handler(
      new Request(
        `http://localhost/api/emergency-menus?meal=dinner&targetMemberIds=${memberId}&mainIngredients=%E9%B6%8F%E8%82%89`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        path: "household",
        matchMode: null,
        emptyReason: "no_matching_fixture",
        candidates: [],
        message: "条件に合う緊急献立がありません",
      },
    });
  });

  it("returns matchMode safety_only and new message when mains miss", async () => {
    const handler = createEmergencyMenusHandler({
      authenticate: () => Promise.resolve({ userId }),
      loadContext: () =>
        Promise.resolve({
          context: makeCurrentSafetyContext(),
          memberLabels: Object.freeze({ member_1: "家族1" }),
        }),
      loadPantryNames: () => Promise.resolve([]),
    });
    const query = new URLSearchParams({
      meal: "dinner",
      targetMemberIds: memberId,
      mainIngredients: "存在しないメイン食材XYZ",
    });
    const res = await handler(
      new Request(`http://localhost/api/emergency-menus?${query.toString()}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as SuccessEnvelope;
    expect(body).toMatchObject({
      ok: true,
      data: {
        path: "household",
        matchMode: "safety_only",
        emptyReason: null,
        consumesAiQuota: false,
        message: "メイン食材は一致しませんでした。安全条件に合う固定候補を表示しています",
      },
    });
    expect(body.data.candidates.length).toBeGreaterThan(0);
    expect(body.data.message).not.toContain("選択したメイン食材に合う固定候補がありません");
  });

  it("rejects targetMode=idea until idea path ships", async () => {
    const loadContext = vi.fn();
    const handler = createEmergencyMenusHandler({
      authenticate: () => Promise.resolve({ userId }),
      loadContext,
      loadPantryNames: () => Promise.resolve([]),
    });
    const res = await handler(
      new Request(
        `http://localhost/api/emergency-menus?meal=dinner&targetMemberIds=${memberId}&targetMode=idea`,
      ),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "invalid_request",
        message: "検索条件を確認してください",
      },
    });
    expect(loadContext).not.toHaveBeenCalled();
  });
});
