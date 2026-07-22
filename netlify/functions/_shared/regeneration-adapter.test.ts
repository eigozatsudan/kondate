import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeCurrentSafetyContext, makeValidatedMenu } from "../../../shared/testing/factories.js";
import { HttpError } from "./http.js";
import { createRegenerationLoaderDeps } from "./regeneration-adapter.js";
import { buildStoredGenerationContext } from "./revalidation-adapter.js";
import { loadStoredMenu, type StoredMenuAggregate } from "./stored-menu-loader.js";
import { getSupabaseAdmin } from "./supabase-admin.js";
import { createUserScopedSupabase } from "./supabase-user.js";

vi.mock("./supabase-admin.js", () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("./supabase-user.js", () => ({ createUserScopedSupabase: vi.fn() }));
vi.mock("./stored-menu-loader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stored-menu-loader.js")>();
  return { ...actual, loadStoredMenu: vi.fn() };
});
vi.mock("./revalidation-adapter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./revalidation-adapter.js")>();
  return { ...actual, buildStoredGenerationContext: vi.fn() };
});

const user = {
  userId: "85000000-0000-4000-8000-000000000001",
  accessToken: "access-token",
};

const memberId = "55000000-0000-4000-8000-000000000001";

function makeStored(): StoredMenuAggregate {
  return {
    menu: makeValidatedMenu(),
    userId: user.userId,
    safetyFingerprint: "source-fp",
    derivationGroupId: "a1000000-0000-4000-8000-000000000001",
    version: 1,
    preferenceSnapshot: {
      submission: {
        mealType: "breakfast",
        mainIngredients: ["ごはん"],
        cuisineGenre: "japanese",
        targetMode: "household",
        targetMemberIds: [memberId],
        servings: null,
        timeLimitMinutes: 15,
        budgetPreference: "standard",
        avoidIngredients: [],
        memo: "",
        pantrySelections: [],
      },
      memberPreferences: [],
    },
    targetMemberIds: [memberId],
    targetMembers: [
      {
        householdMemberId: memberId,
        anonymousMemberRef: "member_1",
        displayNameSnapshot: "家族1",
        displayName: "家族1",
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createUserScopedSupabase).mockReturnValue({ from: vi.fn() } as never);
  vi.mocked(getSupabaseAdmin).mockReturnValue({ from: vi.fn() } as never);
});

describe("createRegenerationLoaderDeps", () => {
  it("maps foreign source to source_menu_not_found before any admin call", async () => {
    vi.mocked(loadStoredMenu).mockRejectedValue(
      new HttpError(404, "menu_not_found", "献立が見つかりません"),
    );
    const deps = createRegenerationLoaderDeps(user, { requestStartedAtMonotonicMs: 100 });

    await expect(
      deps.loadSource(user, "88000000-0000-4000-8000-000000000099"),
    ).rejects.toMatchObject({
      code: "source_menu_not_found",
      status: 404,
    });
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
    expect(buildStoredGenerationContext).not.toHaveBeenCalled();
  });

  it("stores current safety on safetySnapshot and fails closed on broken preferences", async () => {
    const stored = makeStored();
    const currentSafety = makeCurrentSafetyContext();
    vi.mocked(buildStoredGenerationContext).mockResolvedValue({
      submission: {
        mealType: "breakfast",
        mainIngredients: [],
        cuisineGenre: "japanese",
        targetMode: "household",
        targetMemberIds: [memberId],
        servings: null,
        timeLimitMinutes: null,
        budgetPreference: null,
        avoidIngredients: [],
        memo: "",
        pantrySelections: [],
      },
      safety: currentSafety,
      pantryItems: [],
      memberPreferences: [
        {
          householdMemberId: memberId,
          anonymousMemberRef: "member_1",
          portionSize: "regular",
          spiceLevel: "regular",
          easePreferences: [],
          dislikes: [],
        },
      ],
      targetMembers: [
        {
          householdMemberId: memberId,
          anonymousRef: "member_1",
          displayNameSnapshot: "家族1",
        },
      ],
      expiredPantryChecks: [],
      idempotencyKey: "82000000-0000-4000-8000-000000000001",
      preferenceSnapshot: {},
      safetySnapshot: {},
    });

    const deps = createRegenerationLoaderDeps(user, { requestStartedAtMonotonicMs: 100 });
    const context = await deps.buildCurrentContext({
      user,
      stored,
      idempotencyKey: "82000000-0000-4000-8000-000000000001",
      expiredPantryConfirmations: [],
      now: new Date("2026-07-11T00:00:00.000Z"),
    });

    // succeed に渡す snapshot は現行 safety（空でも履歴でもない）
    expect(context.safetySnapshot).toBe(currentSafety);
    expect(context.safety).toBe(currentSafety);
    expect(getSupabaseAdmin).toHaveBeenCalled();

    await expect(
      deps.buildCurrentContext({
        user,
        stored: { ...stored, preferenceSnapshot: { broken: true } },
        idempotencyKey: "82000000-0000-4000-8000-000000000002",
        expiredPantryConfirmations: [],
        now: new Date("2026-07-11T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "invalid_request", status: 422 });
  });

  it("fails closed when pantry re-query errors instead of reusing base pantryItems", async () => {
    const pantryItemId = "66000000-0000-4000-8000-000000000001";
    const stored = makeStored();
    stored.preferenceSnapshot = {
      submission: {
        mealType: "breakfast",
        mainIngredients: ["ごはん"],
        cuisineGenre: "japanese",
        targetMode: "household",
        targetMemberIds: [memberId],
        servings: null,
        timeLimitMinutes: 15,
        budgetPreference: "standard",
        avoidIngredients: [],
        memo: "",
        pantrySelections: [{ pantryItemId, priority: "prefer_use" as const }],
      },
      memberPreferences: [],
    };
    const currentSafety = makeCurrentSafetyContext();
    vi.mocked(buildStoredGenerationContext).mockResolvedValue({
      submission: {
        mealType: "breakfast",
        mainIngredients: ["ごはん"],
        cuisineGenre: "japanese",
        targetMode: "household",
        targetMemberIds: [memberId],
        servings: null,
        timeLimitMinutes: 15,
        budgetPreference: "standard",
        avoidIngredients: [],
        memo: "",
        pantrySelections: [{ pantryItemId, priority: "prefer_use" }],
      },
      safety: currentSafety,
      pantryItems: [
        {
          id: pantryItemId,
          userId: user.userId,
          name: "古い在庫",
          quantity: 1,
          unit: "個",
          expiresOn: "2020-01-01",
          expirationType: "best_before",
          openedState: "unopened",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      memberPreferences: [],
      targetMembers: [
        {
          householdMemberId: memberId,
          anonymousRef: "member_1",
          displayNameSnapshot: "家族1",
        },
      ],
      expiredPantryChecks: [],
      idempotencyKey: "82000000-0000-4000-8000-000000000003",
      preferenceSnapshot: {},
      safetySnapshot: {},
    });

    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
        }),
      }),
    });
    vi.mocked(createUserScopedSupabase).mockReturnValue({ from } as never);

    const deps = createRegenerationLoaderDeps(user, { requestStartedAtMonotonicMs: 100 });
    await expect(
      deps.buildCurrentContext({
        user,
        stored,
        idempotencyKey: "82000000-0000-4000-8000-000000000003",
        expiredPantryConfirmations: [],
        now: new Date("2026-07-11T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "internal_error", status: 503 });
  });
});
