import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmergencyMenusData } from "../../../shared/emergency/contracts.js";
import { emergencyFixtureMetadataV1 } from "../../../shared/emergency/fixtures.v1.js";
import * as emergencyFilter from "../../../shared/emergency/filter-emergency-menus.js";
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
        message: "アレルギー確認や食事条件のため、候補を表示できません",
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

      // PE6: 早期 safety 除外は current_safety_unavailable → 専用空メッセージ
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        data: {
          path: "household",
          matchMode: null,
          emptyReason: "current_safety_unavailable",
          candidates: [],
          message: "アレルギー確認や食事条件のため、候補を表示できません",
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

  it("rejects idea with targetMemberIds", async () => {
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
    const body = (await res.json()) as {
      ok: false;
      error: { code: string; details: { fields: Record<string, string[]> } };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.details.fields.targetMemberIds?.length).toBeGreaterThan(0);
    expect(loadContext).not.toHaveBeenCalled();
  });

  it("rejects idea with empty-string targetMemberIds", async () => {
    const loadContext = vi.fn();
    const handler = createEmergencyMenusHandler({
      authenticate: () => Promise.resolve({ userId }),
      loadContext,
      loadPantryNames: () => Promise.resolve([]),
    });
    // キーあり空文字は omit と区別して 400
    const emptyValue = await handler(
      new Request(
        `http://localhost/api/emergency-menus?meal=dinner&targetMode=idea&targetMemberIds=`,
      ),
    );
    expect(emptyValue.status).toBe(400);
    const emptyBody = (await emptyValue.json()) as {
      ok: false;
      error: { code: string; details: { fields: Record<string, string[]> } };
    };
    expect(emptyBody.error.code).toBe("invalid_request");
    expect(emptyBody.error.details.fields.targetMemberIds?.length).toBeGreaterThan(0);

    const commaOnly = await handler(
      new Request(
        `http://localhost/api/emergency-menus?meal=dinner&targetMode=idea&targetMemberIds=,`,
      ),
    );
    expect(commaOnly.status).toBe(400);
    const commaBody = (await commaOnly.json()) as {
      ok: false;
      error: { code: string; details: { fields: Record<string, string[]> } };
    };
    expect(commaBody.error.code).toBe("invalid_request");
    expect(commaBody.error.details.fields.targetMemberIds?.length).toBeGreaterThan(0);
    expect(loadContext).not.toHaveBeenCalled();
  });

  it("treats omitted targetMode + members as household", async () => {
    const loadContext = vi.fn().mockResolvedValue({
      context: makeCurrentSafetyContext(),
      memberLabels: Object.freeze({ member_1: "家族1" }),
    });
    const handler = createEmergencyMenusHandler({
      authenticate: () => Promise.resolve({ userId }),
      loadContext,
      loadPantryNames: () => Promise.resolve([]),
    });
    const res = await handler(
      new Request(`http://localhost/api/emergency-menus?meal=dinner&targetMemberIds=${memberId}`),
    );
    expect(res.status).toBe(200);
    expect(loadContext).toHaveBeenCalledOnce();
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      data: { path: "household" },
    });
  });

  it("rejects omitted targetMode without members", async () => {
    const loadContext = vi.fn();
    const handler = createEmergencyMenusHandler({
      authenticate: () => Promise.resolve({ userId }),
      loadContext,
      loadPantryNames: () => Promise.resolve([]),
    });
    const res = await handler(new Request(`http://localhost/api/emergency-menus?meal=dinner`));
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      ok: false;
      error: { code: string; details: { fields: Record<string, string[]> } };
    };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.details.fields.targetMemberIds?.length).toBeGreaterThan(0);
    expect(loadContext).not.toHaveBeenCalled();
  });

  it("rejects unknown targetMode", async () => {
    const loadContext = vi.fn();
    const handler = createEmergencyMenusHandler({
      authenticate: () => Promise.resolve({ userId }),
      loadContext,
      loadPantryNames: () => Promise.resolve([]),
    });
    const res = await handler(
      new Request(
        `http://localhost/api/emergency-menus?meal=dinner&targetMode=personal&targetMemberIds=${memberId}`,
      ),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      ok: false;
      error: { code: string; details: { fields: Record<string, string[]> } };
    };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.details.fields.targetMode?.length).toBeGreaterThan(0);
    expect(loadContext).not.toHaveBeenCalled();
  });

  it("idea path does not call loadContext", async () => {
    const loadContext = vi.fn();
    const handler = createEmergencyMenusHandler({
      authenticate: () => Promise.resolve({ userId }),
      loadContext,
      loadPantryNames: () => Promise.resolve([]),
    });
    const res = await handler(
      new Request(`http://localhost/api/emergency-menus?meal=dinner&targetMode=idea`),
    );
    expect(res.status).toBe(200);
    expect(loadContext).not.toHaveBeenCalled();
    const body = (await res.json()) as SuccessEnvelope;
    expect(body.data.path).toBe("idea");
    expect(body.data.candidates.length).toBeGreaterThan(0);
    expect(body.data.message).toContain("アレルギー条件は適用していません");
    expect(body.data.message).toBe(
      "AIを使わない15分緊急献立です。アレルギー条件は適用していません",
    );
    expect(body.data.consumesAiQuota).toBe(false);
    expect(body.data.matchMode).toBe("none");
    expect(body.data.emptyReason).toBeNull();
  });

  it("idea path returns safety_only wire message when mains miss", async () => {
    // design §4 idea・非空・safety_only（household 文言「安全条件に合う…」を使わない）
    const loadContext = vi.fn();
    const handler = createEmergencyMenusHandler({
      authenticate: () => Promise.resolve({ userId }),
      loadContext,
      loadPantryNames: () => Promise.resolve([]),
    });
    const query = new URLSearchParams({
      meal: "dinner",
      targetMode: "idea",
      mainIngredients: "存在しないメイン食材XYZ",
    });
    const res = await handler(
      new Request(`http://localhost/api/emergency-menus?${query.toString()}`),
    );
    expect(res.status).toBe(200);
    expect(loadContext).not.toHaveBeenCalled();
    const body = (await res.json()) as SuccessEnvelope;
    expect(body).toMatchObject({
      ok: true,
      data: {
        path: "idea",
        matchMode: "safety_only",
        emptyReason: null,
        consumesAiQuota: false,
        message: "メイン食材は一致しませんでした。アレルギー条件は適用していません",
      },
    });
    expect(body.data.candidates.length).toBeGreaterThan(0);
    expect(body.data.message).not.toContain("安全条件に合う");
  });

  it("idea path returns generic empty message when filter yields no_matching_fixture", async () => {
    // idea 成人・アレルギーなしの Stage S は現行 catalog では mealType ごと ≥1 が設計上保証されるため、
    // no_matching_fixture 空経路は spy で handler の §4 empty 行列だけを固定検証する。
    const spy = vi.spyOn(emergencyFilter, "filterEmergencyMenus").mockReturnValue({
      menus: [],
      emptyReason: "no_matching_fixture",
      matchMode: null,
    });
    try {
      const loadContext = vi.fn();
      const handler = createEmergencyMenusHandler({
        authenticate: () => Promise.resolve({ userId }),
        loadContext,
        loadPantryNames: () => Promise.resolve([]),
      });
      const res = await handler(
        new Request(`http://localhost/api/emergency-menus?meal=dinner&targetMode=idea`),
      );
      expect(res.status).toBe(200);
      expect(loadContext).not.toHaveBeenCalled();
      await expect(res.json()).resolves.toMatchObject({
        ok: true,
        data: {
          path: "idea",
          matchMode: null,
          emptyReason: "no_matching_fixture",
          candidates: [],
          message: "条件に合う緊急献立がありません",
          consumesAiQuota: false,
        },
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects targetMode=household without targetMemberIds", async () => {
    const loadContext = vi.fn();
    const handler = createEmergencyMenusHandler({
      authenticate: () => Promise.resolve({ userId }),
      loadContext,
      loadPantryNames: () => Promise.resolve([]),
    });
    const res = await handler(
      new Request(`http://localhost/api/emergency-menus?meal=dinner&targetMode=household`),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      ok: false;
      error: { code: string; details: { fields: Record<string, string[]> } };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.details.fields.targetMemberIds?.length).toBeGreaterThan(0);
    expect(loadContext).not.toHaveBeenCalled();
  });

  it("idea path loads pantry names without loadContext", async () => {
    const loadContext = vi.fn();
    const pantryItemIds = ["82000000-0000-4000-8000-000000000099"];
    const loadPantryNames = vi.fn().mockResolvedValue(["玉ねぎ"]);
    const handler = createEmergencyMenusHandler({
      authenticate: () => Promise.resolve({ userId }),
      loadContext,
      loadPantryNames,
    });
    const res = await handler(
      new Request(
        `http://localhost/api/emergency-menus?meal=dinner&targetMode=idea&pantryItemIds=${pantryItemIds.join(",")}`,
      ),
    );
    expect(res.status).toBe(200);
    expect(loadContext).not.toHaveBeenCalled();
    expect(loadPantryNames).toHaveBeenCalledWith(userId, pantryItemIds);
    const body = (await res.json()) as SuccessEnvelope;
    expect(body.data.path).toBe("idea");
    expect(body.data.candidates.length).toBeGreaterThan(0);
  });

  it("household path calls loadContext once", async () => {
    const loadContext = vi.fn().mockResolvedValue({
      context: makeCurrentSafetyContext(),
      memberLabels: Object.freeze({ member_1: "家族1" }),
    });
    const handler = createEmergencyMenusHandler({
      authenticate: () => Promise.resolve({ userId }),
      loadContext,
      loadPantryNames: () => Promise.resolve([]),
    });
    const res = await handler(
      new Request(
        `http://localhost/api/emergency-menus?meal=dinner&targetMode=household&targetMemberIds=${memberId}`,
      ),
    );
    expect(res.status).toBe(200);
    expect(loadContext).toHaveBeenCalledOnce();
    expect(loadContext).toHaveBeenCalledWith(userId, [memberId]);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      data: { path: "household" },
    });
  });

  it("returns 500 when idea filter yields current_safety_unavailable", async () => {
    const spy = vi.spyOn(emergencyFilter, "filterEmergencyMenus").mockReturnValue({
      menus: [],
      emptyReason: "current_safety_unavailable",
      matchMode: null,
    });
    try {
      const handler = createEmergencyMenusHandler({
        authenticate: () => Promise.resolve({ userId }),
        loadContext: vi.fn(),
        loadPantryNames: () => Promise.resolve([]),
      });
      const res = await handler(
        new Request(`http://localhost/api/emergency-menus?meal=dinner&targetMode=idea`),
      );
      expect(res.status).toBe(500);
      const body = (await res.json()) as { ok: false; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("request_failed");
      // idea では current_safety_unavailable を 200 empty で返さない
      expect(body).not.toMatchObject({
        data: { emptyReason: "current_safety_unavailable" },
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("returns matchMode none when mains are empty and candidates exist", async () => {
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
      new Request(`http://localhost/api/emergency-menus?meal=dinner&targetMemberIds=${memberId}`),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as SuccessEnvelope;
    expect(body).toMatchObject({
      ok: true,
      data: {
        path: "household",
        matchMode: "none",
        emptyReason: null,
        message: "AIを使わない15分緊急献立です",
        consumesAiQuota: false,
        fixtureVersion: "2026-07-28.v1",
      },
    });
    expect(body.data.candidates.length).toBeGreaterThan(0);
    expect(body.data.fixtureVersion).toBe("2026-07-28.v1");
  });
});
