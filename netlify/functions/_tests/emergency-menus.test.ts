import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shareQuota } from "../../../shared/contracts/share-quota.js";
import type { EmergencyMenusData } from "../../../shared/emergency/contracts.js";
import {
  emergencyFixtureMetadataV1,
  emergencyMenuFixturesV1,
} from "../../../shared/emergency/fixtures.v1.js";
import * as emergencyFilter from "../../../shared/emergency/filter-emergency-menus.js";
import { makeCurrentSafetyContext } from "../../../shared/testing/factories.js";
import {
  createEmergencyMenusHandler,
  mapSharedRowsToCommunityCandidates,
  pantryNamesForEmergencyScoring,
  pantryNamesFromSelectResult,
  type EmergencyHandlerDeps,
  type ListActiveSharedEmergencyRecipesInput,
  type SharedEmergencyListRow,
} from "../emergency-menus.js";
import { appendDraftMemberAllergiesForInspection } from "../_shared/current-safety.js";
import { HttpError } from "../_shared/http.js";
import * as logger from "../_shared/logger.js";
import type { SafeLogEvent } from "../_shared/logger.js";

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

/** S2 list 行フィクスチャ（DB 列メタ + 新規 menuId の community 候補） */
function communityListRowForMeal(
  mealType: "breakfast" | "lunch" | "dinner",
  options?: { menuId?: string; rowId?: string },
): SharedEmergencyListRow {
  const source = emergencyMenuFixturesV1.find((menu) => menu.mealType === mealType);
  if (source === undefined) {
    throw new Error(`no fixture for ${mealType}`);
  }
  const metadata = emergencyFixtureMetadataV1[source.menuId];
  if (metadata === undefined) {
    throw new Error(`no metadata for ${source.menuId}`);
  }
  const menuId = options?.menuId ?? "86000000-0000-4000-8000-000000000099";
  return {
    id: options?.rowId ?? "87000000-0000-4000-8000-000000000001",
    menu_payload: { ...source, menuId },
    meal_type: mealType,
    total_elapsed_minutes: source.totalElapsedMinutes,
    standard_allergen_ids: [...metadata.standardAllergenIds],
    eligible_age_bands: [...metadata.eligibleAgeBands],
    created_at: "2026-08-01T00:00:00.000Z",
  };
}

function householdDeps(overrides: Partial<EmergencyHandlerDeps> = {}): EmergencyHandlerDeps {
  return {
    authenticate: () => Promise.resolve({ userId }),
    loadContext: () =>
      Promise.resolve({
        context: makeCurrentSafetyContext(),
        memberLabels: Object.freeze({ member_1: "家族1" }),
      }),
    loadPantryNames: () => Promise.resolve([]),
    listActiveSharedRecipes: () => Promise.resolve([]),
    ...overrides,
  };
}

function postEmergencyMenus(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/emergency-menus", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/emergency-menus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("PE4: GET query mainIngredients is rejected before authentication", async () => {
    // Observability が URL を保持しても、製品契約は query 自由文を受理しない。
    const authenticate = vi.fn();
    const loadContext = vi.fn();
    const handler = createEmergencyMenusHandler({
      authenticate,
      loadContext,
      loadPantryNames: vi.fn(),
    });
    const query = new URLSearchParams({
      meal: "dinner",
      targetMemberIds: memberId,
      mainIngredients: "卵アレルギー疑い",
    });

    const response = await handler(
      new Request(`http://localhost/api/emergency-menus?${query.toString()}`),
    );

    expect(response.status).toBe(400);
    expect(authenticate).not.toHaveBeenCalled();
    expect(loadContext).not.toHaveBeenCalled();
    const body = (await response.json()) as {
      ok: false;
      error: { code: string; details?: { fields?: Record<string, string[]> } };
    };
    expect(body).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(body.error.details?.fields?.mainIngredients?.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain("卵");
    expect(JSON.stringify(body)).not.toContain("アレルギー");
  });

  it("PE4: POST body mains are used and safeLog keeps count only", async () => {
    const logSpy = vi.spyOn(logger, "safeLog");
    const handler = createEmergencyMenusHandler(householdDeps());
    const response = await handler(
      postEmergencyMenus({
        mealType: "dinner",
        mainIngredients: ["卵アレルギー疑い"],
        targetMode: "household",
        targetMemberIds: [memberId],
        pantryItemIds: [],
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as SuccessEnvelope;
    expect(body.ok).toBe(true);
    expect(body.data.path).toBe("household");
    const emergencyLog: SafeLogEvent | undefined = logSpy.mock.calls
      .map((call) => call[0])
      .find((event) => event.code === "emergency_menus");
    expect(emergencyLog?.mainIngredientCount).toBe(1);
    expect(JSON.stringify(emergencyLog)).not.toContain("卵");
    expect(JSON.stringify(emergencyLog)).not.toContain("アレルギー");
    expect(JSON.stringify(emergencyLog)).not.toContain("卵アレルギー疑い");
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

  it("PE8: registered with no confirmed allergens is allergen_missing, not no_matching_fixture", async () => {
    const context = makeCurrentSafetyContext();
    const handler = createEmergencyMenusHandler({
      authenticate: () => Promise.resolve({ userId }),
      loadContext: () =>
        Promise.resolve({
          context: makeCurrentSafetyContext({
            members: [
              {
                ...context.members[0]!,
                allergyStatus: "registered",
                allergenIds: [],
                customAllergies: [],
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
        emptyReason: "allergen_missing",
        candidates: [],
        message: "アレルギー情報の登録が必要です。家族の設定を確認してください。",
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
      const response = await handler(
        postEmergencyMenus({
          mealType: "dinner",
          mainIngredients: ["鶏肉"],
          targetMode: "household",
          targetMemberIds: [memberId],
          pantryItemIds: [],
        }),
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
      postEmergencyMenus({
        mealType: "dinner",
        mainIngredients: ["　鶏肉　", "ｷｬﾍﾞﾂ"],
        targetMode: "household",
        targetMemberIds: [memberId],
        pantryItemIds: [],
      }),
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
      postEmergencyMenus({
        mealType: "dinner",
        mainIngredients: ["豚肉"],
        targetMode: "household",
        targetMemberIds: [memberId],
        pantryItemIds: [],
      }),
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
      postEmergencyMenus({
        mealType: "dinner",
        mainIngredients: ["鶏肉", "　鶏肉　"],
        targetMode: "household",
        targetMemberIds: [memberId],
        pantryItemIds: [],
      }),
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
      const response = await handler(
        postEmergencyMenus({
          mealType: "dinner",
          mainIngredients: [mainIngredient],
          targetMode: "household",
          targetMemberIds: [memberId],
          pantryItemIds: [],
        }),
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
      postEmergencyMenus({
        mealType: "dinner",
        mainIngredients: ["鶏肉"],
        targetMode: "household",
        targetMemberIds: [memberId],
        pantryItemIds: [],
      }),
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
    const res = await handler(
      postEmergencyMenus({
        mealType: "dinner",
        mainIngredients: ["存在しないメイン食材XYZ"],
        targetMode: "household",
        targetMemberIds: [memberId],
        pantryItemIds: [],
      }),
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
    const res = await handler(
      postEmergencyMenus({
        mealType: "dinner",
        mainIngredients: ["存在しないメイン食材XYZ"],
        targetMode: "idea",
        targetMemberIds: [],
        pantryItemIds: [],
      }),
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
    const spy = vi.spyOn(emergencyFilter, "filterEmergencyMenuCandidates").mockReturnValue({
      menus: [],
      emptyReason: "no_matching_fixture",
      matchMode: null,
      sourceCounts: { fixture: 0, community: 0 },
    });
    try {
      const loadContext = vi.fn();
      const handler = createEmergencyMenusHandler({
        authenticate: () => Promise.resolve({ userId }),
        loadContext,
        loadPantryNames: () => Promise.resolve([]),
        listActiveSharedRecipes: () => Promise.resolve([]),
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
    const spy = vi.spyOn(emergencyFilter, "filterEmergencyMenuCandidates").mockReturnValue({
      menus: [],
      emptyReason: "current_safety_unavailable",
      matchMode: null,
      sourceCounts: { fixture: 0, community: 0 },
    });
    try {
      const listActiveSharedRecipes = vi.fn().mockResolvedValue([]);
      const handler = createEmergencyMenusHandler({
        authenticate: () => Promise.resolve({ userId }),
        loadContext: vi.fn(),
        loadPantryNames: () => Promise.resolve([]),
        listActiveSharedRecipes,
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
      // 文脈ゲート失敗時は S2 を呼ばない
      expect(listActiveSharedRecipes).not.toHaveBeenCalled();
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

  it("PE9: pantry select error is 500 and does not return empty ranking", async () => {
    const handler = createEmergencyMenusHandler({
      authenticate: () => Promise.resolve({ userId }),
      loadContext: () =>
        Promise.resolve({
          context: makeCurrentSafetyContext(),
          memberLabels: Object.freeze({ member_1: "家族1" }),
        }),
      loadPantryNames: () => Promise.reject(new Error("pantry_items_select_failed")),
    });
    const pantryItemIds = ["82000000-0000-4000-8000-000000000001"];
    const response = await handler(
      new Request(
        `http://localhost/api/emergency-menus?meal=dinner&targetMemberIds=${memberId}&pantryItemIds=${pantryItemIds.join(",")}`,
      ),
    );
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "request_failed" },
    });
  });

  it("PE9: pantryNamesFromSelectResult throws on select error and keeps missing IDs dropped", () => {
    try {
      pantryNamesFromSelectResult(
        { data: null, error: { message: "select failed" } },
        "2026-08-07",
      );
      expect.unreachable("select error must not become empty names");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect(error).toMatchObject({ status: 500, code: "internal_error" });
    }

    const names = pantryNamesFromSelectResult(
      {
        data: [
          { name: "鮭", expires_on: "2026-07-01" },
          { name: "キャベツ", expires_on: null },
        ],
        error: null,
      },
      "2026-08-07",
    );
    expect(names).toEqual(["キャベツ"]);
  });

  it("PE4: pantryNamesForEmergencyScoring drops past-entered expiry but keeps null", () => {
    const names = pantryNamesForEmergencyScoring(
      [
        { name: "鮭", expires_on: "2026-07-01" },
        { name: "キャベツ", expires_on: null },
        { name: "豆腐", expires_on: "2026-08-07" },
      ],
      "2026-08-07",
    );
    expect(names).toEqual(["キャベツ", "豆腐"]);
  });

  it("PE16: mapSharedRowsToCommunityCandidates drops meal_type mismatch before Stage S", () => {
    const dinnerRow = communityListRowForMeal("dinner");
    // 列が要求帯と不一致 → 0 件（fetch 枠食い residual を閉じる）
    const columnMismatch: SharedEmergencyListRow = {
      ...dinnerRow,
      meal_type: "lunch",
    };
    expect(mapSharedRowsToCommunityCandidates([columnMismatch], "dinner")).toEqual([]);

    // payload.mealType 不一致（列は一致）も落とす
    const payload = dinnerRow.menu_payload as { mealType: string };
    const payloadMismatch: SharedEmergencyListRow = {
      ...dinnerRow,
      meal_type: "dinner",
      menu_payload: { ...payload, mealType: "lunch" },
    };
    expect(mapSharedRowsToCommunityCandidates([payloadMismatch], "dinner")).toEqual([]);

    // 一致行は載る
    const ok = mapSharedRowsToCommunityCandidates([dinnerRow], "dinner");
    expect(ok).toHaveLength(1);
    expect(ok[0]?.source).toBe("community");
  });

  describe("S2 shared pool (Task 9)", () => {
    it("passes LIMIT === shareQuota.sharePoolFetchLimit to list RPC", async () => {
      const listActiveSharedRecipes = vi
        .fn<
          (
            input: ListActiveSharedEmergencyRecipesInput,
          ) => Promise<readonly SharedEmergencyListRow[]>
        >()
        .mockResolvedValue([]);
      const handler = createEmergencyMenusHandler(householdDeps({ listActiveSharedRecipes }));
      const response = await handler(
        new Request(`http://localhost/api/emergency-menus?meal=dinner&targetMemberIds=${memberId}`),
      );
      expect(response.status).toBe(200);
      // dinner fixture は max(5) 未満のため S2 を bound fetch する
      expect(listActiveSharedRecipes).toHaveBeenCalledOnce();
      const callArg = listActiveSharedRecipes.mock.calls[0]![0];
      expect(callArg.mealType).toBe("dinner");
      expect(callArg.limit).toBe(shareQuota.sharePoolFetchLimit);
      expect(shareQuota.sharePoolFetchLimit).toBe(20);
      expect(typeof callArg.salt).toBe("string");
      expect(callArg.salt.length).toBeGreaterThanOrEqual(1);
      expect(callArg.salt.length).toBeLessThanOrEqual(128);
    });

    it("does not call list RPC when S1 already filled maxCandidates", async () => {
      const listActiveSharedRecipes = vi
        .fn()
        .mockResolvedValue([communityListRowForMeal("dinner")]);
      const realFilter = emergencyFilter.filterEmergencyMenuCandidates;
      const spy = vi
        .spyOn(emergencyFilter, "filterEmergencyMenuCandidates")
        .mockImplementation((input) => {
          const result = realFilter(input);
          // S1 が emergencyMaxCandidates を埋めたように見せる
          const seed = result.menus[0];
          if (seed === undefined) return result;
          const menus = Array.from({ length: shareQuota.emergencyMaxCandidates }, () => seed);
          return {
            ...result,
            menus,
            emptyReason: null,
            matchMode: result.matchMode ?? "none",
            sourceCounts: {
              fixture: shareQuota.emergencyMaxCandidates,
              community: 0,
            },
          };
        });
      try {
        const handler = createEmergencyMenusHandler(householdDeps({ listActiveSharedRecipes }));
        const response = await handler(
          new Request(
            `http://localhost/api/emergency-menus?meal=dinner&targetMemberIds=${memberId}`,
          ),
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as SuccessEnvelope;
        expect(body.data.candidates.length).toBe(shareQuota.emergencyMaxCandidates);
        expect(listActiveSharedRecipes).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it("response candidates length <= emergencyMaxCandidates", async () => {
      // S1 3 件 + community 多数でも返却は cap
      const communityRows = Array.from({ length: shareQuota.sharePoolFetchLimit }, (_, index) =>
        communityListRowForMeal("dinner", {
          menuId: `86000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          rowId: `87000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        }),
      );
      const listActiveSharedRecipes = vi.fn().mockResolvedValue(communityRows);
      const handler = createEmergencyMenusHandler(householdDeps({ listActiveSharedRecipes }));
      const response = await handler(
        new Request(`http://localhost/api/emergency-menus?meal=dinner&targetMemberIds=${memberId}`),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as SuccessEnvelope;
      expect(body.data.candidates.length).toBeLessThanOrEqual(shareQuota.emergencyMaxCandidates);
      expect(body.data.candidates.length).toBe(shareQuota.emergencyMaxCandidates);
      const listCall = listActiveSharedRecipes.mock.calls[0]?.[0] as
        ListActiveSharedEmergencyRecipesInput | undefined;
      expect(listCall?.limit).toBe(shareQuota.sharePoolFetchLimit);
    });

    it("returns 200 with fixtures only when list RPC throws", async () => {
      const listActiveSharedRecipes = vi.fn().mockRejectedValue(new Error("pool_unavailable"));
      const logSpy = vi.spyOn(logger, "safeLog");
      const handler = createEmergencyMenusHandler(householdDeps({ listActiveSharedRecipes }));
      const response = await handler(
        new Request(`http://localhost/api/emergency-menus?meal=dinner&targetMemberIds=${memberId}`),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as SuccessEnvelope;
      expect(body.data.candidates.length).toBeGreaterThan(0);
      expect(body.data.path).toBe("household");
      expect(listActiveSharedRecipes).toHaveBeenCalledOnce();
      // sourceCounts は fixture のみ（community 0）。contributor キーは出さない
      const emergencyLog: SafeLogEvent | undefined = logSpy.mock.calls
        .map((call) => call[0])
        .find((event) => event.code === "emergency_menus");
      expect(emergencyLog).toBeDefined();
      expect(emergencyLog?.sourceCounts?.community).toBe(0);
      expect(emergencyLog?.sourceCounts?.fixture).toBeGreaterThan(0);
      expect(emergencyLog).not.toHaveProperty("contributor");
      expect(JSON.stringify(emergencyLog)).not.toMatch(/contributor/i);
    });

    it("applies S2 on both household and idea paths", async () => {
      const communityMenuId = "86000000-0000-4000-8000-000000000777";
      const listActiveSharedRecipes = vi
        .fn()
        .mockResolvedValue([communityListRowForMeal("dinner", { menuId: communityMenuId })]);

      const householdHandler = createEmergencyMenusHandler(
        householdDeps({ listActiveSharedRecipes }),
      );
      const householdRes = await householdHandler(
        new Request(`http://localhost/api/emergency-menus?meal=dinner&targetMemberIds=${memberId}`),
      );
      expect(householdRes.status).toBe(200);
      const householdBody = (await householdRes.json()) as SuccessEnvelope;
      expect(householdBody.data.path).toBe("household");
      expect(householdBody.data.candidates.some((c) => c.menu.menuId === communityMenuId)).toBe(
        true,
      );

      listActiveSharedRecipes.mockClear();
      listActiveSharedRecipes.mockResolvedValue([
        communityListRowForMeal("dinner", { menuId: communityMenuId }),
      ]);

      const ideaHandler = createEmergencyMenusHandler({
        authenticate: () => Promise.resolve({ userId }),
        loadContext: vi.fn(),
        loadPantryNames: () => Promise.resolve([]),
        listActiveSharedRecipes,
      });
      const ideaRes = await ideaHandler(
        new Request(`http://localhost/api/emergency-menus?meal=dinner&targetMode=idea`),
      );
      expect(ideaRes.status).toBe(200);
      const ideaBody = (await ideaRes.json()) as SuccessEnvelope;
      expect(ideaBody.data.path).toBe("idea");
      expect(ideaBody.data.candidates.some((c) => c.menu.menuId === communityMenuId)).toBe(true);
      expect(listActiveSharedRecipes).toHaveBeenCalledOnce();
      expect(listActiveSharedRecipes).toHaveBeenCalledWith(
        expect.objectContaining({
          mealType: "dinner",
          limit: shareQuota.sharePoolFetchLimit,
        }),
      );
    });
  });
});

const breakfastSalmonMenuId = "82000000-0000-4000-8000-000000000002";
const breakfastEggMenuId = "82000000-0000-4000-8000-000000000010";
const draftChildId = "81000000-0000-4000-8000-000000000099";

describe("PE2 household draft allergen inspection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("PE2: production household loadContext uses inspection union, not snapshot-only", () => {
    // snapshot SQL は complete のまま。draft 針は loadEmergencyInspectionSafety で union する。
    const source = readFileSync("netlify/functions/emergency-menus.ts", "utf8");
    expect(source).toMatch(/loadEmergencyInspectionSafety/);
    expect(source).not.toMatch(
      /loadContext:\s*\(userId,\s*ids\)\s*=>\s*loadEmergencyCurrentSafety/u,
    );
  });

  it("PE2: complete-only context still returns breakfast egg fixture", async () => {
    const handler = createEmergencyMenusHandler(householdDeps());
    const response = await handler(
      new Request(
        `http://localhost/api/emergency-menus?meal=breakfast&targetMode=household&targetMemberIds=${memberId}`,
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as SuccessEnvelope;
    const ids = body.data.candidates.map((candidate) => candidate.menu.menuId);
    expect(ids).toContain(breakfastEggMenuId);
    expect(ids).toContain(breakfastSalmonMenuId);
  });

  it("PE2: household Stage S drops egg fixtures when draft child has confirmed egg needle", async () => {
    const completeOnly = makeCurrentSafetyContext();
    const inspection = appendDraftMemberAllergiesForInspection(completeOnly, [
      {
        member_id: draftChildId,
        allergen_id: "egg",
        custom_name: null,
        custom_aliases: null,
        custom_confirmed: false,
      },
    ]);
    const handler = createEmergencyMenusHandler(
      householdDeps({
        loadContext: () =>
          Promise.resolve({
            context: inspection,
            memberLabels: Object.freeze({
              member_1: "家族1",
              member_2: "家族2",
              member_3: "家族3",
            }),
          }),
      }),
    );

    const response = await handler(
      new Request(
        `http://localhost/api/emergency-menus?meal=breakfast&targetMode=household&targetMemberIds=${memberId}`,
      ),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as SuccessEnvelope;
    const ids = body.data.candidates.map((candidate) => candidate.menu.menuId);
    expect(ids).not.toContain(breakfastEggMenuId);
    expect(ids).toContain(breakfastSalmonMenuId);
    expect(body.data.message).not.toContain("安全です");
    expect(JSON.stringify(body)).not.toContain("安全です");
  });
});
