import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeCurrentSafetyContext,
  makeGeneratedMenu,
  makeValidatedMenu,
} from "../../../shared/testing/factories.js";
import { loadCurrentSafetyContext } from "./current-safety.js";
import {
  createRevalidationDeps,
  reconcileCurrentMenuLabelWarnings,
  validateStoredMenuCurrentSafety,
} from "./revalidation-adapter.js";
import type { StoredMenuAggregate } from "./stored-menu-loader.js";
import { getSupabaseAdmin } from "./supabase-admin.js";
import { createUserScopedSupabase } from "./supabase-user.js";

vi.mock("./supabase-admin.js", () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("./supabase-user.js", () => ({ createUserScopedSupabase: vi.fn() }));
vi.mock("./current-safety.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./current-safety.js")>();
  return {
    ...actual,
    loadCurrentSafetyContext: vi.fn(),
  };
});

const USER_ID = "85000000-0000-4000-8000-000000000001";
const MENU_ID = "52000000-0000-4000-8000-000000000001";
const LIVE_MEMBER_ID = "55000000-0000-4000-8000-000000000002";
const DELETED_MEMBER_ID = "55000000-0000-4000-8000-000000000099";
const PANTRY_ITEM_ID = "29000000-0000-4000-8000-000000000001";
const SELECTION_ID = "26000000-0000-4000-8000-000000000001";
const CONFIRMATION_ID = "a1000000-0000-4000-8000-000000000001";
const INGREDIENT_ID = "53000000-0000-4000-8000-000000000001";

const user = {
  userId: USER_ID,
  accessToken: "access-token",
};

type TableResult = { data: unknown; error: unknown };

function ownerClientWith(results: Record<string, TableResult>) {
  const from = vi.fn((table: string) => {
    const result = results[table] ?? { data: [], error: null };
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      in: vi.fn(() => builder),
      then: (resolve: (value: TableResult) => unknown) => Promise.resolve(result).then(resolve),
    };
    return builder;
  });
  return { from };
}

function makeStored(overrides: Partial<StoredMenuAggregate> = {}): StoredMenuAggregate {
  const dishId = "50000000-0000-4000-8000-000000000001";
  const menu = makeValidatedMenu({
    menuId: MENU_ID,
    pantryUsage: [
      {
        selectionId: SELECTION_ID,
        pantryItemId: PANTRY_ITEM_ID,
        pantryItemName: "ごはん",
        priority: "must_use",
        usageStatus: "used",
        plannedQuantity: 300,
        inventoryQuantity: 200,
        shortageQuantity: 100,
        unit: "g",
        dishIds: [dishId],
        unusedReason: null,
      },
    ],
    labelConfirmations: [
      {
        sourceType: "ingredient",
        sourceId: INGREDIENT_ID,
        sourcePath: "dishes.0.ingredients.0.name",
        sourceText: "ごはん",
        allergenId: "wheat",
        anonymousMemberRef: "member_1",
        dictionaryVersion: "jp-caa-2026-04.v1",
        confirmationStatus: "confirmed",
        confirmedAt: "2026-07-11T01:00:00.000Z",
        confirmedBy: USER_ID,
      },
    ],
  });

  return {
    menu,
    userId: USER_ID,
    safetyFingerprint: "a".repeat(64),
    derivationGroupId: "c1000000-0000-4000-8000-000000000001",
    version: 1,
    preferenceSnapshot: {
      memberPreferences: [
        {
          householdMemberId: LIVE_MEMBER_ID,
          anonymousMemberRef: "member_2",
          portionSize: "regular",
          spiceLevel: "regular",
          easePreferences: [],
          dislikes: [],
        },
      ],
    },
    // 削除済みリンクは targetMemberIds に入れない（loader 契約）
    targetMemberIds: [LIVE_MEMBER_ID],
    targetMembers: [
      {
        householdMemberId: null,
        anonymousMemberRef: "member_1",
        displayNameSnapshot: "削除済みの家族",
        displayName: "削除済みの家族",
      },
      {
        householdMemberId: LIVE_MEMBER_ID,
        anonymousMemberRef: "member_2",
        displayNameSnapshot: "きろく2",
        displayName: "子ども",
      },
    ],
    ...overrides,
  };
}

function cleanSafety() {
  return makeCurrentSafetyContext({
    members: [
      {
        householdMemberId: LIVE_MEMBER_ID,
        anonymousRef: "member_1",
        ageBand: "adult",
        allergyStatus: "none",
        allergenIds: [],
        hasUnmappedCustomAllergy: false,
        requiredSafetyConstraints: [],
        unsupportedDietStatus: "none",
        unsupportedDietKinds: [],
      },
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadCurrentSafetyContext).mockResolvedValue(cleanSafety());
  vi.mocked(createUserScopedSupabase).mockReturnValue(
    ownerClientWith({
      pantry_items: { data: [{ id: PANTRY_ITEM_ID, quantity: 200 }], error: null },
      household_members: {
        data: [
          {
            id: LIVE_MEMBER_ID,
            portion_size: "regular",
            spice_level: "regular",
            ease_preferences: [],
          },
        ],
        error: null,
      },
    }) as never,
  );
  vi.mocked(getSupabaseAdmin).mockReturnValue({
    from: vi.fn(),
    rpc: vi.fn(),
  } as never);
});

describe("validateStoredMenuCurrentSafety", () => {
  it("never passes deleted member IDs to loadCurrentSafetyContext", async () => {
    const stored = makeStored();
    const ownerClient = ownerClientWith({
      pantry_items: { data: [{ id: PANTRY_ITEM_ID, quantity: 200 }], error: null },
      household_members: {
        data: [
          {
            id: LIVE_MEMBER_ID,
            portion_size: "regular",
            spice_level: "regular",
            ease_preferences: [],
          },
        ],
        error: null,
      },
    });

    await validateStoredMenuCurrentSafety({
      ownerClient: ownerClient as never,
      admin: {} as never,
      stored,
      userId: USER_ID,
    });

    expect(loadCurrentSafetyContext).toHaveBeenCalledTimes(1);
    expect(loadCurrentSafetyContext).toHaveBeenCalledWith(expect.anything(), USER_ID, [
      LIVE_MEMBER_ID,
    ]);
    const thirdArg = vi.mocked(loadCurrentSafetyContext).mock.calls[0]?.[2] as readonly string[];
    expect(thirdArg).not.toContain(DELETED_MEMBER_ID);
    expect(thirdArg.every((id) => id !== null)).toBe(true);
    // 削除済みは targetMembers に残るが、現行安全ロードには載せない
    expect(stored.targetMembers.some((member) => member.householdMemberId === null)).toBe(true);
  });

  it("reports pantry quantity and portion preference drift as changedDetails, not invalid issues", async () => {
    const stored = makeStored();
    const ownerClient = ownerClientWith({
      pantry_items: { data: [{ id: PANTRY_ITEM_ID, quantity: 50 }], error: null },
      household_members: {
        data: [
          {
            id: LIVE_MEMBER_ID,
            portion_size: "large",
            spice_level: "regular",
            ease_preferences: [],
          },
        ],
        error: null,
      },
    });

    const result = await validateStoredMenuCurrentSafety({
      ownerClient: ownerClient as never,
      admin: {} as never,
      stored,
      userId: USER_ID,
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.changedDetails).toEqual(
      expect.arrayContaining(["pantry_quantity_changed", "preference_changed"]),
    );
    expect(result.issues.some((issue) => /allergen|allergy/i.test(issue.code))).toBe(false);
  });

  it("keeps historical confirmed provenance on the stored aggregate and does not use it as current provider evidence", async () => {
    const stored = makeStored();
    const historical = structuredClone(stored.menu.labelConfirmations);
    const ownerClient = ownerClientWith({
      pantry_items: { data: [{ id: PANTRY_ITEM_ID, quantity: 200 }], error: null },
      household_members: {
        data: [
          {
            id: LIVE_MEMBER_ID,
            portion_size: "regular",
            spice_level: "regular",
            ease_preferences: [],
          },
        ],
        error: null,
      },
    });

    const result = await validateStoredMenuCurrentSafety({
      ownerClient: ownerClient as never,
      admin: {} as never,
      stored,
      userId: USER_ID,
    });

    // 保存 aggregate の confirmed 証跡は不変
    expect(stored.menu.labelConfirmations).toEqual(historical);
    expect(stored.menu.labelConfirmations[0]).toMatchObject({
      confirmationStatus: "confirmed",
      confirmedAt: "2026-07-11T01:00:00.000Z",
      confirmedBy: USER_ID,
    });
    // 現行 candidate は pending 派生のみ。歴史 confirmed を provider 証拠にしない
    // GeneratedMenu の confirmationStatus は "pending" 固定で confirmed フィールドを持たない
    expect(
      result.candidate.labelConfirmations.every((item) => item.confirmationStatus === "pending"),
    ).toBe(true);
    expect(
      result.candidate.labelConfirmations.some(
        (item) => "confirmedAt" in item || "confirmedBy" in item,
      ),
    ).toBe(false);
  });
});

describe("createRevalidationDeps history validator wiring", () => {
  it("uses validateStoredMenuCurrentSafety as the sole history validator path", async () => {
    const stored = makeStored();
    const ownerClient = ownerClientWith({
      pantry_items: { data: [{ id: PANTRY_ITEM_ID, quantity: 200 }], error: null },
      household_members: {
        data: [
          {
            id: LIVE_MEMBER_ID,
            portion_size: "regular",
            spice_level: "regular",
            ease_preferences: [],
          },
        ],
        error: null,
      },
    });
    vi.mocked(createUserScopedSupabase).mockReturnValue(ownerClient as never);

    const deps = createRevalidationDeps(user);
    const viaDeps = await deps.validateStoredCurrentSafety({ stored, userId: USER_ID });
    const viaDirect = await validateStoredMenuCurrentSafety({
      ownerClient: ownerClient as never,
      admin: getSupabaseAdmin(),
      stored,
      userId: USER_ID,
    });

    // createRevalidationDeps は履歴専用 validator を直接配線する（生成 mutation 経路ではない）
    expect(viaDeps).toEqual(viaDirect);
    expect(loadCurrentSafetyContext).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      stored.targetMemberIds,
    );
    expect(loadCurrentSafetyContext).not.toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.arrayContaining([DELETED_MEMBER_ID]),
    );
  });
});

describe("reconcileCurrentMenuLabelWarnings", () => {
  it("uses saved source_text_snapshot for display even when candidate text differs", async () => {
    const stored = makeStored();
    const candidate = makeGeneratedMenu({
      menuId: MENU_ID,
      labelConfirmations: [
        {
          sourceType: "ingredient",
          sourceId: INGREDIENT_ID,
          sourcePath: "dishes.0.ingredients.0.name",
          // candidate 側は RPC へ送る現行 canonical。表示は RPC 返却 snapshot を使う
          sourceText: "候補の別テキスト",
          allergenId: "wheat",
          anonymousMemberRef: "member_2",
          dictionaryVersion: "jp-caa-2026-04.v1",
          confirmationStatus: "pending",
        },
      ],
    });

    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          id: CONFIRMATION_ID,
          source_type: "ingredient",
          source_id: INGREDIENT_ID,
          source_path: "dishes.0.ingredients.0.name",
          source_text_snapshot: "保存済みスナップショット",
          allergen_id: "wheat",
          anonymous_member_ref: "member_2",
          dictionary_version: "jp-caa-2026-04.v1",
          confirmation_status: "confirmed",
          requirement_safety_fingerprint: "b".repeat(64),
        },
      ],
      error: null,
    });
    const catalogSelect = vi.fn().mockResolvedValue({
      data: [{ id: "wheat", display_name: "小麦" }],
      error: null,
    });
    const admin = {
      rpc,
      from: vi.fn((table: string) => {
        if (table === "allergen_catalog") {
          return { select: catalogSelect };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    };

    const warnings = await reconcileCurrentMenuLabelWarnings(admin as never, user, {
      stored,
      candidate,
      safetyFingerprint: "b".repeat(64),
    });

    expect(rpc).toHaveBeenCalledWith(
      "reconcile_menu_label_confirmations",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_menu_id: MENU_ID,
        p_requirements: [
          expect.objectContaining({
            sourceTextSnapshot: "候補の別テキスト",
          }),
        ],
      }),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      confirmationId: CONFIRMATION_ID,
      // 表示は RPC が保存した immutable snapshot。candidate 再解決ではない
      sourceText: "保存済みスナップショット",
      confirmationStatus: "confirmed",
      allergenName: "小麦",
      memberLabel: "子ども",
    });
    expect(warnings[0]?.sourceText).not.toBe("候補の別テキスト");
  });
});

describe("createRevalidationDeps save abuse boundary", () => {
  it("upserts the same owner-menu row on every revalidation save (no insert-append path)", async () => {
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
    const insert = vi.fn();
    const from = vi.fn((table: string) => {
      if (table === "menu_revalidations") {
        return { upsert, insert };
      }
      throw new Error(`unexpected table ${table}`);
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue({ from, rpc: vi.fn() } as never);

    const deps = createRevalidationDeps(user);
    const payload = {
      userId: USER_ID,
      menuId: MENU_ID,
      status: "valid" as const,
      safetyFingerprint: "c".repeat(64),
      allergenCatalogVersion: "jp-caa-2026-04.v1",
      foodRuleVersion: "jp-caa-child-shape-2026-07.v1",
      issues: [] as const,
      changedDetails: [] as const,
      currentLabelWarnings: [] as const,
    };

    for (let i = 0; i < 10; i += 1) {
      await deps.save(payload);
    }

    expect(upsert).toHaveBeenCalledTimes(10);
    expect(insert).not.toHaveBeenCalled();
    for (const call of upsert.mock.calls) {
      expect(call[0]).toEqual(
        expect.objectContaining({
          user_id: USER_ID,
          menu_id: MENU_ID,
          status: "valid",
          safety_fingerprint: "c".repeat(64),
        }),
      );
      expect(call[1]).toEqual({ onConflict: "menu_id,user_id" });
    }
    // from は menu_revalidations への upsert 専用。append insert 経路は存在しない
    expect(from).toHaveBeenCalledTimes(10);
    expect(from.mock.calls.every(([table]) => table === "menu_revalidations")).toBe(true);
  });
});
