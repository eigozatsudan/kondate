import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generationConflictSchema,
  type NewMenuGenerationRequest,
} from "../../../shared/contracts/generation.js";
import type { CurrentSafetyContext } from "../../../shared/safety/context.js";
import { makeGenerationContext } from "../../../shared/testing/factories.js";
import { getSupabaseAdmin } from "./supabase-admin.js";
import { createUserScopedSupabase } from "./supabase-user.js";
import { hasExactCurrentSafetyManifest, loadCurrentSafetyContext } from "./current-safety.js";
import {
  generationPreflightIssuePriority,
  loadGenerationContext,
  validateGenerationPreflight,
  validateTransientChecks,
} from "./generation-context.js";

vi.mock("./supabase-admin.js", () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("./supabase-user.js", () => ({ createUserScopedSupabase: vi.fn() }));
vi.mock("./current-safety.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./current-safety.js")>();
  return {
    ...actual,
    hasExactCurrentSafetyManifest: vi.fn(actual.hasExactCurrentSafetyManifest),
    loadCurrentSafetyContext: vi.fn(),
  };
});

const userId = "70000000-0000-4000-8000-000000000001";
const draftId = "71000000-0000-4000-8000-000000000001";
const requestId = "72000000-0000-4000-8000-000000000001";
const memberId = "73000000-0000-4000-8000-000000000001";
const pantryId = "74000000-0000-4000-8000-000000000001";
const secondMemberId = "73000000-0000-4000-8000-000000000002";
const now = new Date("2026-07-11T03:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hasExactCurrentSafetyManifest).mockReturnValue(true);
});

const request: NewMenuGenerationRequest = {
  idempotencyKey: "75000000-0000-4000-8000-000000000001",
  draftId,
  draftRevision: 2,
  privacyNoticeVersion: "2026-07-11.v1",
  expiredPantryConfirmations: [],
};

const snapshot = {
  draft_id: draftId,
  draft_revision: 2,
  meal_type: "dinner",
  main_ingredients: ["鶏肉"],
  cuisine_genre: "japanese",
  target_mode: "household",
  target_member_ids: [memberId],
  servings: null,
  time_limit_minutes: null,
  budget_preference: null,
  avoid_ingredients: [],
  memo: "",
  pantry_selections: [],
  captured_at: "2026-07-11T02:59:00.000Z",
};

const completeMember = {
  id: memberId,
  user_id: userId,
  status: "complete",
  display_name: "子ども",
  age_band: "adult",
  portion_size: "regular",
  spice_level: "regular",
  ease_preferences: [],
  allergy_status: "none",
  unsupported_diet_status: "none",
  unsupported_diet_kinds: [],
};

function pantryRow(ownerId: string = userId) {
  return {
    id: pantryId,
    user_id: ownerId,
    name: "牛乳",
    quantity: 1,
    unit: "本",
    expires_on: null,
    expiration_type: null,
    opened_state: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
}

function makeTwoMemberGenerationContext(): ReturnType<typeof makeGenerationContext> {
  const base = makeGenerationContext();
  const firstTarget = base.targetMembers.at(0);
  const firstSafety = base.safety.members.at(0);
  const firstPreference = base.memberPreferences.at(0);
  if (firstTarget === undefined || firstSafety === undefined || firstPreference === undefined) {
    throw new Error("member fixture is empty");
  }
  return {
    ...base,
    submission: {
      ...base.submission,
      targetMemberIds: [firstTarget.householdMemberId, secondMemberId],
    },
    targetMembers: [
      firstTarget,
      { ...firstTarget, householdMemberId: secondMemberId, anonymousRef: "member_2" },
    ],
    safety: {
      ...base.safety,
      members: [
        firstSafety,
        { ...firstSafety, householdMemberId: secondMemberId, anonymousRef: "member_2" },
      ],
    },
    memberPreferences: [
      firstPreference,
      {
        ...firstPreference,
        householdMemberId: secondMemberId,
        anonymousMemberRef: "member_2",
      },
    ],
  };
}

function duplicateFirst<T>(values: readonly T[]): readonly T[] {
  const first = values.at(0);
  if (first === undefined) throw new Error("member fixture is empty");
  return [first, first];
}

type TableResult = { data: unknown; error: unknown };

function userClientWith(results: Record<string, TableResult>) {
  const from = vi.fn((table: string) => {
    const result = results[table] ?? { data: [], error: null };
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      in: vi.fn(() => builder),
      order: vi.fn(() => builder),
      maybeSingle: vi.fn(() => Promise.resolve(result)),
      then: (resolve: (value: TableResult) => unknown) => Promise.resolve(result).then(resolve),
    };
    return builder;
  });
  return { from };
}

function arrangeLoader(
  overrides: {
    snapshotData?: unknown;
    snapshotError?: unknown;
    members?: unknown[];
    consent?: unknown;
    dislikes?: unknown[];
    pantry?: unknown[];
    safety?: CurrentSafetyContext;
  } = {},
) {
  const rpc = vi.fn().mockResolvedValue({
    data: overrides.snapshotData ?? [snapshot],
    error: overrides.snapshotError ?? null,
  });
  vi.mocked(getSupabaseAdmin).mockReturnValue({ rpc } as never);
  const userClient = userClientWith({
    privacy_consents: {
      data:
        overrides.consent === undefined
          ? { user_id: userId, notice_version: "2026-07-11.v1", accepted_at: now.toISOString() }
          : overrides.consent,
      error: null,
    },
    household_members: { data: overrides.members ?? [completeMember], error: null },
    member_dislikes: { data: overrides.dislikes ?? [], error: null },
    pantry_items: { data: overrides.pantry ?? [], error: null },
  });
  vi.mocked(createUserScopedSupabase).mockReturnValue(userClient as never);
  const safety = overrides.safety ?? makeGenerationContext().safety;
  vi.mocked(loadCurrentSafetyContext).mockResolvedValue({
    ...safety,
    members: safety.members.map((member) => ({ ...member, householdMemberId: memberId })),
  });
  return { rpc, from: userClient.from };
}

describe("loadGenerationContext", () => {
  it("loads the immutable owner/request snapshot and never reads the mutable draft", async () => {
    const { rpc, from } = arrangeLoader();

    const context = await loadGenerationContext(
      { userId, accessToken: "access-token" },
      requestId,
      request,
      now,
    );

    expect(rpc).toHaveBeenCalledWith("get_ai_generation_submission_snapshot", {
      p_request_id: requestId,
      p_user_id: userId,
    });
    expect(from).not.toHaveBeenCalledWith("generation_drafts");
    expect(context.submission).toEqual({
      mealType: "dinner",
      mainIngredients: ["鶏肉"],
      cuisineGenre: "japanese",
      targetMode: "household",
      targetMemberIds: [memberId],
      servings: null,
      timeLimitMinutes: null,
      budgetPreference: null,
      avoidIngredients: [],
      memo: "",
      pantrySelections: [],
    });
    expect(context.targetMembers).toEqual([
      { householdMemberId: memberId, anonymousRef: "member_1", displayNameSnapshot: "子ども" },
    ]);
    expect(context.memberPreferences[0]).toMatchObject({
      householdMemberId: memberId,
      anonymousMemberRef: "member_1",
    });
  });

  it.each([
    ["extra RPC key", [{ ...snapshot, raw_request: "secret" }]],
    ["unknown meal", [{ ...snapshot, meal_type: "snack" }]],
    ["unknown cuisine", [{ ...snapshot, cuisine_genre: "mediterranean" }]],
    ["unknown budget", [{ ...snapshot, budget_preference: "premium" }]],
    ["malformed pantry", [{ ...snapshot, pantry_selections: { invalid: true } }]],
  ])("fails closed for %s", async (_case, snapshotData) => {
    const { from } = arrangeLoader({ snapshotData });

    await expect(
      loadGenerationContext({ userId, accessToken: "access-token" }, requestId, request, now),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(from).not.toHaveBeenCalledWith("generation_drafts");
  });

  it.each([
    ["draft ID", { ...snapshot, draft_id: "71000000-0000-4000-8000-000000000002" }],
    ["draft revision", { ...snapshot, draft_revision: 3 }],
  ])("rejects a snapshot whose %s differs from the HMAC-bound request", async (_case, row) => {
    arrangeLoader({ snapshotData: [row] });

    await expect(
      loadGenerationContext({ userId, accessToken: "access-token" }, requestId, request, now),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("requires the exact current privacy notice before constructing safety context", async () => {
    arrangeLoader({ consent: null });

    await expect(
      loadGenerationContext({ userId, accessToken: "access-token" }, requestId, request, now),
    ).rejects.toMatchObject({ code: "consent_required" });
    expect(loadCurrentSafetyContext).not.toHaveBeenCalled();
  });

  it("rejects a current-version consent row owned by another user", async () => {
    arrangeLoader({
      consent: {
        user_id: "70000000-0000-4000-8000-000000000002",
        notice_version: "2026-07-11.v1",
        accepted_at: now.toISOString(),
      },
    });

    await expect(
      loadGenerationContext({ userId, accessToken: "access-token" }, requestId, request, now),
    ).rejects.toMatchObject({ code: "consent_required" });
    expect(loadCurrentSafetyContext).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", [] as unknown[], "invalid_request"],
    ["draft", [{ ...completeMember, status: "draft" }], "invalid_request"],
    [
      "foreign owner",
      [{ ...completeMember, user_id: "70000000-0000-4000-8000-000000000002" }],
      "invalid_request",
    ],
    [
      "allergy unconfirmed",
      [{ ...completeMember, allergy_status: "unconfirmed" }],
      "allergy_unconfirmed",
    ],
    [
      "unsupported diet unconfirmed",
      [{ ...completeMember, unsupported_diet_status: "unconfirmed" }],
      "unsupported_diet_unconfirmed",
    ],
    [
      "unsupported diet present",
      [
        {
          ...completeMember,
          unsupported_diet_status: "present",
          unsupported_diet_kinds: ["therapeutic_diet"],
        },
      ],
      "unsupported_diet",
    ],
  ])("keeps the closed member failure for %s", async (_case, members, code) => {
    arrangeLoader({ members });

    await expect(
      loadGenerationContext({ userId, accessToken: "access-token" }, requestId, request, now),
    ).rejects.toMatchObject({ code });
  });

  it("rejects a selected pantry item that is missing from the owner-scoped rows", async () => {
    arrangeLoader({
      snapshotData: [
        {
          ...snapshot,
          pantry_selections: [{ pantryItemId: pantryId, priority: "must_use" }],
        },
      ],
      pantry: [],
    });

    await expect(
      loadGenerationContext({ userId, accessToken: "access-token" }, requestId, request, now),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("rejects a selected pantry item owned by another user", async () => {
    arrangeLoader({
      snapshotData: [
        {
          ...snapshot,
          pantry_selections: [{ pantryItemId: pantryId, priority: "must_use" }],
        },
      ],
      pantry: [pantryRow("70000000-0000-4000-8000-000000000002")],
    });

    await expect(
      loadGenerationContext({ userId, accessToken: "access-token" }, requestId, request, now),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it.each([
    [
      "registered allergy without a mapped allergen",
      { allergyStatus: "registered" as const, allergenIds: [] },
      "allergen_missing",
    ],
    ["unmapped custom allergy", { hasUnmappedCustomAllergy: true }, "unmapped_custom_allergy"],
  ])("keeps the closed safety failure for %s", async (_case, memberOverride, code) => {
    const baseSafety = makeGenerationContext().safety;
    arrangeLoader({
      members: [{ ...completeMember, allergy_status: "registered" }],
      safety: {
        ...baseSafety,
        members: baseSafety.members.map((member) => ({
          ...member,
          householdMemberId: memberId,
          ...memberOverride,
        })),
      },
    });

    await expect(
      loadGenerationContext({ userId, accessToken: "access-token" }, requestId, request, now),
    ).rejects.toMatchObject({ code });
  });

  it("does not query household data for idea mode", async () => {
    // idea は家族表・dislike・現行 safety を一切読まず、固定 null/空 context を返す
    const ideaSnapshot = {
      ...snapshot,
      target_mode: "idea" as const,
      target_member_ids: [] as string[],
      servings: 3,
    };
    const { from } = arrangeLoader({ snapshotData: [ideaSnapshot] });

    const context = await loadGenerationContext(
      { userId, accessToken: "access-token" },
      requestId,
      request,
      now,
    );

    expect(from).not.toHaveBeenCalledWith("household_members");
    expect(from).not.toHaveBeenCalledWith("member_dislikes");
    expect(loadCurrentSafetyContext).not.toHaveBeenCalled();
    expect(context).toMatchObject({
      targetMode: "idea",
      safety: null,
      memberPreferences: [],
      targetMembers: [],
      allergenVersion: null,
      foodRuleVersion: null,
    });
    expect(context.safetySnapshot).toEqual({
      assurance: "none",
      members: [],
      mode: "idea",
    });
    expect(context.submission).toMatchObject({
      targetMode: "idea",
      targetMemberIds: [],
      servings: 3,
    });
  });
});

describe("validateTransientChecks", () => {
  const selected = [pantryId];
  const expired = [pantryId];
  const valid = [{ pantryItemId: pantryId, checkedAt: "2026-07-11T02:00:00.000Z" }];

  it("accepts the exact expired selection set in submission order", () => {
    expect(validateTransientChecks(valid, selected, expired, now)).toEqual(valid);
  });

  it.each([
    ["missing", []],
    ["duplicate", [...valid, ...valid]],
    ["future", [{ pantryItemId: pantryId, checkedAt: "2026-07-11T04:00:00.000Z" }]],
    ["different JST day", [{ pantryItemId: pantryId, checkedAt: "2026-07-10T14:59:59.000Z" }]],
    ["invalid timestamp", [{ pantryItemId: pantryId, checkedAt: "not-a-date" }]],
    [
      "non-selected extra",
      [
        ...valid,
        {
          pantryItemId: "74000000-0000-4000-8000-000000000002",
          checkedAt: "2026-07-11T02:00:00.000Z",
        },
      ],
    ],
  ])("rejects %s confirmations", (_case, checks) => {
    try {
      validateTransientChecks(checks, selected, expired, now);
      throw new Error("expected transient validation failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "expired_pantry_unconfirmed" });
    }
  });

  it("rejects duplicate selected IDs before accepting confirmations", () => {
    expect(() =>
      validateTransientChecks(valid, [...selected, ...selected], expired, now),
    ).toThrow();
  });
});

describe("validateGenerationPreflight", () => {
  it.each([
    [
      "zero member sets",
      (context: ReturnType<typeof makeGenerationContext>) => ({
        ...context,
        submission: { ...context.submission, targetMemberIds: [] },
        targetMembers: [],
        safety: { ...context.safety, members: [] },
        memberPreferences: [],
      }),
    ],
    [
      "missing preferences",
      (context: ReturnType<typeof makeGenerationContext>) => ({
        ...context,
        memberPreferences: [],
      }),
    ],
    [
      "non-canonical paired refs",
      (context: ReturnType<typeof makeGenerationContext>) => ({
        ...context,
        targetMembers: context.targetMembers.map((member) => ({
          ...member,
          anonymousRef: "member_9",
        })),
        safety: {
          ...context.safety,
          members: context.safety.members.map((member) => ({
            ...member,
            anonymousRef: "member_9",
          })),
        },
        memberPreferences: context.memberPreferences.map((member) => ({
          ...member,
          anonymousMemberRef: "member_9",
        })),
      }),
    ],
    [
      "duplicate ordered member IDs",
      (context: ReturnType<typeof makeGenerationContext>) => ({
        ...context,
        submission: {
          ...context.submission,
          targetMemberIds: [
            context.submission.targetMemberIds[0]!,
            context.submission.targetMemberIds[0]!,
          ],
        },
        targetMembers: [context.targetMembers[0]!, context.targetMembers[0]!],
        safety: {
          ...context.safety,
          members: [context.safety.members[0]!, context.safety.members[0]!],
        },
        memberPreferences: [context.memberPreferences[0]!, context.memberPreferences[0]!],
      }),
    ],
  ])("fails closed for %s", (_case, mutate) => {
    expect(validateGenerationPreflight(mutate(makeGenerationContext()), now)).toMatchObject({
      ok: false,
      terminal: "failed",
      primaryCode: "invalid_request",
    });
  });

  it.each([
    [
      "unequal submission target ID length",
      (context: ReturnType<typeof makeGenerationContext>) => ({
        ...context,
        submission: {
          ...context.submission,
          targetMemberIds: context.submission.targetMemberIds.slice(0, 1),
        },
      }),
    ],
    [
      "reordered submission target IDs",
      (context: ReturnType<typeof makeGenerationContext>) => ({
        ...context,
        submission: {
          ...context.submission,
          targetMemberIds: [...context.submission.targetMemberIds].reverse(),
        },
      }),
    ],
    [
      "duplicate submission target IDs",
      (context: ReturnType<typeof makeGenerationContext>) => ({
        ...context,
        submission: {
          ...context.submission,
          targetMemberIds: [...duplicateFirst(context.submission.targetMemberIds)],
        },
      }),
    ],
    [
      "unequal target-member length",
      (context: ReturnType<typeof makeGenerationContext>) => ({
        ...context,
        targetMembers: context.targetMembers.slice(0, 1),
      }),
    ],
    [
      "unequal safety-member length",
      (context: ReturnType<typeof makeGenerationContext>) => ({
        ...context,
        safety: { ...context.safety, members: context.safety.members.slice(0, 1) },
      }),
    ],
    [
      "unequal preference length",
      (context: ReturnType<typeof makeGenerationContext>) => ({
        ...context,
        memberPreferences: context.memberPreferences.slice(0, 1),
      }),
    ],
    [
      "reordered target members",
      (context: ReturnType<typeof makeGenerationContext>) => ({
        ...context,
        targetMembers: [...context.targetMembers].reverse(),
      }),
    ],
    [
      "reordered safety members",
      (context: ReturnType<typeof makeGenerationContext>) => ({
        ...context,
        safety: { ...context.safety, members: [...context.safety.members].reverse() },
      }),
    ],
    [
      "reordered preferences",
      (context: ReturnType<typeof makeGenerationContext>) => ({
        ...context,
        memberPreferences: [...context.memberPreferences].reverse(),
      }),
    ],
    [
      "duplicate target ID and canonical ref",
      (context: ReturnType<typeof makeGenerationContext>) => ({
        ...context,
        targetMembers: duplicateFirst(context.targetMembers),
      }),
    ],
    [
      "duplicate safety ID and canonical ref",
      (context: ReturnType<typeof makeGenerationContext>) => ({
        ...context,
        safety: { ...context.safety, members: duplicateFirst(context.safety.members) },
      }),
    ],
    [
      "duplicate preference ID and canonical ref",
      (context: ReturnType<typeof makeGenerationContext>) => ({
        ...context,
        memberPreferences: duplicateFirst(context.memberPreferences),
      }),
    ],
  ])("fails closed for %s", (_case, mutate) => {
    expect(
      validateGenerationPreflight(mutate(makeTwoMemberGenerationContext()), now),
    ).toMatchObject({
      ok: false,
      terminal: "failed",
      primaryCode: "invalid_request",
    });
  });

  it("recalculates expired selections against trusted preflight time", () => {
    const base = makeGenerationContext();
    const context = {
      ...base,
      submission: {
        ...base.submission,
        pantrySelections: [{ pantryItemId: pantryId, priority: "prefer_use" as const }],
      },
      pantryItems: [
        {
          id: pantryId,
          userId,
          name: "牛乳",
          quantity: 1,
          unit: "本",
          expiresOn: "2026-07-11",
          expirationType: "use_by" as const,
          openedState: "unopened" as const,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
      expiredPantryChecks: [],
    };

    expect(
      validateGenerationPreflight(context, new Date("2026-07-11T15:00:00.000Z")),
    ).toMatchObject({
      ok: false,
      terminal: "failed",
      primaryCode: "expired_pantry_unconfirmed",
    });
  });

  it("rejects pantry rows outside the exact selected set", () => {
    const base = makeGenerationContext();
    const context = {
      ...base,
      pantryItems: [
        {
          id: pantryId,
          userId,
          name: "牛乳",
          quantity: 1,
          unit: "本",
          expiresOn: null,
          expirationType: null,
          openedState: null,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
    };

    expect(validateGenerationPreflight(context, now)).toMatchObject({
      ok: false,
      terminal: "failed",
      primaryCode: "invalid_request",
    });
  });

  it("rejects 51 otherwise exact pantry selections", () => {
    const base = makeGenerationContext();
    const pantryItems = Array.from({ length: 51 }, (_, index) => ({
      id: `74000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      userId,
      name: `食材${String(index + 1)}`,
      quantity: 1,
      unit: "個",
      expiresOn: null,
      expirationType: null,
      openedState: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }));
    const context = {
      ...base,
      submission: {
        ...base.submission,
        pantrySelections: pantryItems.map((item) => ({
          pantryItemId: item.id,
          priority: "prefer_use" as const,
        })),
      },
      pantryItems,
    };

    expect(validateGenerationPreflight(context, now)).toMatchObject({
      ok: false,
      terminal: "failed",
      primaryCode: "invalid_request",
    });
  });

  it("rebuilds unsupported medical text from the immutable submission", () => {
    const base = makeGenerationContext();
    const context = {
      ...base,
      submission: { ...base.submission, memo: "糖尿病の治療食" },
      safety: { ...base.safety, requestText: "" },
    };

    expect(validateGenerationPreflight(context, now)).toMatchObject({
      ok: false,
      terminal: "failed",
      primaryCode: "unsupported_diet",
    });
  });

  it("rejects semantic manifest drift through the shared exact helper", () => {
    vi.mocked(hasExactCurrentSafetyManifest).mockReturnValueOnce(false);
    const base = makeGenerationContext();
    const context = {
      ...base,
      safety: {
        ...base.safety,
        allergenDictionary: {
          ...base.safety.allergenDictionary,
          aliases: base.safety.allergenDictionary.aliases.map((alias, index) =>
            index === 0
              ? { ...alias, requiresLabelConfirmation: !alias.requiresLabelConfirmation }
              : alias,
          ),
        },
      },
    };

    expect(validateGenerationPreflight(context, now)).toMatchObject({
      ok: false,
      terminal: "failed",
      primaryCode: "internal_error",
    });
  });

  it("exports a unique priority and keeps primary first", () => {
    vi.mocked(hasExactCurrentSafetyManifest).mockReturnValueOnce(false);
    expect(new Set(generationPreflightIssuePriority).size).toBe(
      generationPreflightIssuePriority.length,
    );
    const base = makeGenerationContext();
    const result = validateGenerationPreflight(
      {
        ...base,
        submission: { ...base.submission, memo: "糖尿病の治療食", targetMemberIds: [] },
        safety: { ...base.safety, dictionaryVersion: "obsolete" },
      },
      now,
    );
    expect(result).toMatchObject({
      ok: false,
      terminal: "failed",
      primaryCode: "internal_error",
    });
    if (!result.ok) expect(result.issueCodes[0]).toBe(result.primaryCode);
  });

  it("returns deterministic failed internal_error for completeness permutations", () => {
    vi.mocked(hasExactCurrentSafetyManifest).mockReturnValue(false);
    const base = makeGenerationContext();
    const variants = [
      { ...base.safety, dictionaryVersion: "obsolete" },
      {
        ...base.safety,
        allergenDictionary: { ...base.safety.allergenDictionary, version: "obsolete" },
      },
      { ...base.safety, foodRuleVersion: "obsolete" },
    ];
    expect(variants.map((safety) => validateGenerationPreflight({ ...base, safety }, now))).toEqual(
      variants.map(() => ({
        ok: false,
        terminal: "failed",
        primaryCode: "internal_error",
        issueCodes: ["internal_error"],
      })),
    );
  });

  it.each([
    ["derived alias in a main ingredient", "卵白", "derived", false],
    ["processed alias in selected pantry", "マヨネーズ", "processed", true],
  ] as const)("detects an allergen conflict from %s", (_case, alias, aliasKind, pantrySource) => {
    const base = makeGenerationContext();
    const selectedPantry = pantrySource
      ? [
          {
            id: pantryId,
            userId,
            name: alias,
            quantity: 1,
            unit: "個",
            expiresOn: null,
            expirationType: null,
            openedState: null,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          },
        ]
      : [];
    const context = {
      ...base,
      submission: {
        ...base.submission,
        mainIngredients: pantrySource ? base.submission.mainIngredients : [alias],
        pantrySelections: pantrySource
          ? [{ pantryItemId: pantryId, priority: "prefer_use" as const }]
          : [],
      },
      pantryItems: selectedPantry,
      safety: {
        ...base.safety,
        members: base.safety.members.map((member) => ({
          ...member,
          allergyStatus: "registered" as const,
          allergenIds: ["egg"],
        })),
        allergenDictionary: {
          ...base.safety.allergenDictionary,
          aliases: [
            {
              allergenId: "egg",
              alias,
              normalizedAlias: alias,
              aliasKind,
              requiresLabelConfirmation: aliasKind === "processed",
              dictionaryVersion: base.safety.dictionaryVersion,
            },
          ],
        },
      },
    };

    expect(validateGenerationPreflight(context, now)).toMatchObject(
      pantrySource
        ? {
            ok: false,
            terminal: "constraint_conflict",
            primaryCode: "allergen_pantry_conflict",
          }
        : { ok: false, terminal: "failed", primaryCode: "allergy_conflict" },
    );
  });

  it("maps registered allergens and must-use avoids to their closed terminals", () => {
    const base = makeGenerationContext();
    const context = {
      ...base,
      submission: {
        ...base.submission,
        mainIngredients: ["卵"],
        avoidIngredients: ["牛乳"],
        pantrySelections: [{ pantryItemId: pantryId, priority: "must_use" as const }],
      },
      pantryItems: [
        {
          id: pantryId,
          userId,
          name: "牛乳",
          quantity: 1,
          unit: "本",
          expiresOn: null,
          expirationType: null,
          openedState: null,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
      safety: {
        ...base.safety,
        members: base.safety.members.map((member) => ({
          ...member,
          allergyStatus: "registered" as const,
          allergenIds: ["egg"],
        })),
        allergenDictionary: {
          ...base.safety.allergenDictionary,
          aliases: [
            {
              allergenId: "egg",
              alias: "卵",
              normalizedAlias: "卵",
              aliasKind: "direct" as const,
              requiresLabelConfirmation: false,
              dictionaryVersion: base.safety.dictionaryVersion,
            },
          ],
        },
      },
    };

    expect(validateGenerationPreflight(context, now)).toMatchObject({
      ok: false,
      terminal: "failed",
      primaryCode: "allergy_conflict",
      issueCodes: ["allergy_conflict", "must_use_conflict"],
    });
  });

  it("uses only anonymous member and submission-local pantry refs in conflicts", () => {
    const base = makeGenerationContext();
    const context = {
      ...base,
      submission: {
        ...base.submission,
        pantrySelections: [{ pantryItemId: pantryId, priority: "prefer_use" as const }],
      },
      pantryItems: [
        {
          id: pantryId,
          userId,
          name: "卵",
          quantity: 1,
          unit: "個",
          expiresOn: null,
          expirationType: null,
          openedState: null,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
      safety: {
        ...base.safety,
        members: base.safety.members.map((member) => ({
          ...member,
          allergyStatus: "registered" as const,
          allergenIds: ["egg"],
        })),
      },
    };

    expect(validateGenerationPreflight(context, now)).toEqual({
      ok: false,
      terminal: "constraint_conflict",
      primaryCode: "allergen_pantry_conflict",
      issueCodes: ["allergen_pantry_conflict"],
      conflicts: [
        {
          code: "allergen_pantry_conflict",
          message: "選択した在庫食材とアレルギー条件が競合しています。",
          conditionRefs: ["member_1", "pantry_1"],
        },
      ],
    });
  });

  it("keeps conflict refs within the canonical schema bound", () => {
    const base = makeGenerationContext();
    const pantryItems = Array.from({ length: 25 }, (_, index) => ({
      id: `74000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      userId,
      name: "牛乳",
      quantity: 1,
      unit: "本",
      expiresOn: null,
      expirationType: null,
      openedState: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }));
    const result = validateGenerationPreflight(
      {
        ...base,
        submission: {
          ...base.submission,
          avoidIngredients: ["牛乳"],
          pantrySelections: pantryItems.map((item) => ({
            pantryItemId: item.id,
            priority: "must_use" as const,
          })),
        },
        pantryItems,
      },
      now,
    );

    expect(result).toMatchObject({ ok: false, terminal: "constraint_conflict" });
    if (!result.ok && result.terminal === "constraint_conflict") {
      expect(result.conflicts).toHaveLength(1);
      expect(generationConflictSchema.safeParse(result.conflicts[0]).success).toBe(true);
    }
  });

  it.each([
    [
      "missing catalog",
      (context: ReturnType<typeof makeGenerationContext>) => ({
        ...context.safety,
        allergenDictionary: { ...context.safety.allergenDictionary, catalog: [] },
      }),
    ],
    [
      "missing rule",
      (context: ReturnType<typeof makeGenerationContext>) => ({
        ...context.safety,
        foodSafetyRules: context.safety.foodSafetyRules.slice(1),
      }),
    ],
  ])("fails closed for %s completeness", (_case, mutateSafety) => {
    vi.mocked(hasExactCurrentSafetyManifest).mockReturnValueOnce(false);
    const base = makeGenerationContext();
    expect(validateGenerationPreflight({ ...base, safety: mutateSafety(base) }, now)).toMatchObject(
      {
        ok: false,
        terminal: "failed",
        primaryCode: "internal_error",
        issueCodes: ["internal_error"],
      },
    );
  });

  it("keeps issue order, primary code, and terminal invariant under source permutation", () => {
    const base = makeGenerationContext();
    const pantryItems = [
      {
        id: pantryId,
        userId,
        name: "牛乳",
        quantity: 1,
        unit: "本",
        expiresOn: null,
        expirationType: null,
        openedState: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      {
        id: "74000000-0000-4000-8000-000000000002",
        userId,
        name: "卵",
        quantity: 1,
        unit: "個",
        expiresOn: null,
        expirationType: null,
        openedState: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ];
    const submission = {
      ...base.submission,
      mainIngredients: ["卵", "牛乳"],
      avoidIngredients: ["牛乳"],
      pantrySelections: pantryItems.map((item) => ({
        pantryItemId: item.id,
        priority: "must_use" as const,
      })),
    };
    const safety = {
      ...base.safety,
      members: base.safety.members.map((member) => ({
        ...member,
        allergyStatus: "registered" as const,
        allergenIds: ["egg"],
      })),
    };
    const first = validateGenerationPreflight({ ...base, submission, pantryItems, safety }, now);
    const permuted = validateGenerationPreflight(
      {
        ...base,
        submission: {
          ...submission,
          mainIngredients: [...submission.mainIngredients].reverse(),
          pantrySelections: [...submission.pantrySelections].reverse(),
        },
        pantryItems: [...pantryItems].reverse(),
        safety: { ...safety, members: [...safety.members].reverse() },
      },
      now,
    );

    expect(permuted).toMatchObject({
      ok: first.ok,
      ...(!first.ok && {
        terminal: first.terminal,
        primaryCode: first.primaryCode,
        issueCodes: first.issueCodes,
      }),
    });
  });
});
