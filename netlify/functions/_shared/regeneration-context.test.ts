import { beforeEach, describe, expect, it, vi } from "vitest";

const snapshotRpc = vi.hoisted(() =>
  vi.fn((...rpcArgs: unknown[]): Promise<{ data: unknown; error: unknown }> => {
    const name = rpcArgs[0] as string;
    const args = rpcArgs[1] as { p_request_id: string; p_user_id: string };
    if (name !== "get_ai_generation_regeneration_snapshot") {
      return Promise.resolve({ data: null, error: { message: "unexpected rpc" } });
    }
    // 既定は dishCommand 向け。個別ケースは beforeEach / テスト内で上書きする。
    return Promise.resolve({
      data: [
        {
          request_id: args.p_request_id,
          user_id: args.p_user_id,
          kind: "regenerate_dish",
          source_menu_id: "52000000-0000-4000-8000-000000000001",
          source_menu_version: 1,
          replace_dish_id: "50000000-0000-4000-8000-000000000002",
          target_mode: "household",
          servings: 2,
          target_member_ids: ["55000000-0000-4000-8000-000000000001"],
          created_at: "2026-07-11T00:00:00.000Z",
        },
      ],
      error: null,
    });
  }),
);
// F1: loadRegenerationExecutionContext が current privacy consent を DB 確認する
const privacyConsentQuery = vi.hoisted(() =>
  vi.fn((): Promise<{ data: unknown; error: unknown }> =>
    Promise.resolve({
      data: {
        user_id: "85000000-0000-4000-8000-000000000001",
        notice_version: "2026-07-29.v1",
        accepted_at: "2026-07-11T00:00:00.000Z",
      },
      error: null,
    }),
  ),
);
const createUserScopedSupabaseMock = vi.hoisted(() =>
  vi.fn(() => {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      maybeSingle: privacyConsentQuery,
    };
    return {
      from: vi.fn((table: string) => {
        if (table !== "privacy_consents") {
          throw new Error(`unexpected table ${table}`);
        }
        return builder;
      }),
    };
  }),
);
vi.mock("./supabase-admin.js", () => ({
  getSupabaseAdmin: vi.fn(() => ({ rpc: snapshotRpc })),
}));
vi.mock("./supabase-user.js", () => ({
  createUserScopedSupabase: createUserScopedSupabaseMock,
}));

import { createDishSignature, createMenuSignature } from "../../../shared/safety/deduplicate.js";
import { createCurrentSafetyFingerprint } from "../../../shared/safety/fingerprint.js";
import { validateGeneratedMenu } from "../../../shared/safety/validate-generated-menu.js";
import {
  makeGenerationContext,
  makeIdeaGenerationContext,
  makeValidatedMenu,
} from "../../../shared/testing/factories.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";
import type { GenerationCommand } from "../../../shared/contracts/generation.js";
import type { DishRegenerationAiOutput } from "../../../shared/contracts/regeneration.js";
import { HttpError } from "./http.js";
import type { GenerationExecutionContext } from "./generation-service.js";
import type { StoredMenuAggregate } from "./stored-menu-loader.js";
import {
  buildDishRegenerationPrompt,
  buildExistingDerivationMenus,
  buildPantrySelectionIdToRef,
  isRegenerationDuplicate,
  loadRegenerationExecutionContext,
  materializeDishRegenerationCandidate,
  reloadExistingDerivationMenus,
  requireRegenerationArtifacts,
  toRetainedDishPrompt,
  type LoaderDeps,
} from "./regeneration-context.js";

const user = {
  userId: "85000000-0000-4000-8000-000000000001",
  accessToken: "token",
};

const dish1Id = "50000000-0000-4000-8000-000000000001";
const dish2Id = "50000000-0000-4000-8000-000000000002";

function makeStoredMenu(
  overrides: Partial<StoredMenuAggregate> & {
    menu?: ReturnType<typeof makeValidatedMenu>;
  } = {},
): StoredMenuAggregate {
  // breakfast は既定 2 品。member_1 向け取り分けを付けて revalidation を通す。
  const baseMenu = makeValidatedMenu();
  const firstDish = baseMenu.dishes[0];
  const firstStep = firstDish?.steps[0];
  const menu =
    overrides.menu ??
    makeValidatedMenu({
      adaptations:
        firstDish !== undefined && firstStep !== undefined
          ? [
              {
                id: "57000000-0000-4000-8000-000000000001",
                dishId: firstDish.id,
                anonymousMemberRef: "member_1",
                portionText: "通常量",
                branchBeforeRecipeStepId: firstStep.id,
                additionalCutting: null,
                additionalHeating: null,
                additionalSeasoning: null,
                servingCheck: "通常の取り分けを確認する",
                safetyTags: [],
                safetyActions: [],
              },
            ]
          : [],
    });
  return {
    menu,
    userId: user.userId,
    safetyFingerprint: "source-fp",
    derivationGroupId: "a1000000-0000-4000-8000-000000000001",
    version: 1,
    // live menus.target_mode の正本。snapshot と照合する
    targetMode: "household",
    preferenceSnapshot: {
      mealType: "breakfast",
      mainIngredients: ["ごはん"],
      cuisineGenre: "japanese",
      timeLimitMinutes: 15,
      budgetPreference: "standard",
      ingredientPreference: null,
      avoidIngredients: [],
      memo: "",
      pantrySelections: [],
    },
    targetMemberIds: ["55000000-0000-4000-8000-000000000001"],
    targetMembers: [
      {
        householdMemberId: "55000000-0000-4000-8000-000000000001",
        anonymousMemberRef: "member_1",
        displayNameSnapshot: "家族1",
        displayName: "家族1",
      },
    ],
    ...overrides,
  };
}

function makeLoaderDeps(
  source: StoredMenuAggregate,
  extras: {
    group?: readonly StoredMenuAggregate[];
    recent?: readonly StoredMenuAggregate[];
    generationContext?: GenerationContext;
  } = {},
): LoaderDeps & {
  loadSource: ReturnType<typeof vi.fn>;
  loadGroup: ReturnType<typeof vi.fn>;
  loadRecent: ReturnType<typeof vi.fn>;
  buildCurrentContext: ReturnType<typeof vi.fn>;
} {
  const generationContext = extras.generationContext ?? makeGenerationContext();
  return {
    loadSource: vi.fn(() => Promise.resolve(source)),
    loadGroup: vi.fn(() => Promise.resolve(extras.group ?? [source])),
    loadRecent: vi.fn(() => Promise.resolve(extras.recent ?? [source])),
    buildCurrentContext: vi.fn(() => Promise.resolve(generationContext)),
    requestStartedAtMonotonicMs: 1_000,
    now: () => new Date("2026-07-11T00:00:00.000Z"),
    monotonicNow: () => 1_000,
  };
}

const dishCommand: Extract<GenerationCommand, { kind: "regenerate_dish" }> = {
  commandVersion: "generation-command.v3",
  kind: "regenerate_dish",
  qualityMode: false,
  request: {
    sourceMenuId: "52000000-0000-4000-8000-000000000001",
    dishId: dish2Id,
    idempotencyKey: "82000000-0000-4000-8000-000000000001",
    changeReason: "simpler",
    changeReasonCustom: null,
    privacyNoticeVersion: "2026-07-29.v1",
    expiredPantryConfirmations: [],
  },
};

const menuCommand: Extract<GenerationCommand, { kind: "regenerate_menu" }> = {
  commandVersion: "generation-command.v3",
  kind: "regenerate_menu",
  qualityMode: false,
  request: {
    sourceMenuId: "52000000-0000-4000-8000-000000000001",
    idempotencyKey: "82000000-0000-4000-8000-000000000002",
    changeReason: "simpler",
    changeReasonCustom: null,
    privacyNoticeVersion: "2026-07-29.v1",
    expiredPantryConfirmations: [],
  },
};

function dishSig(name: string, role: string, ingredients: string[]) {
  return createDishSignature({ role, name, primaryIngredients: ingredients });
}

describe("loadRegenerationExecutionContext", () => {
  beforeEach(() => {
    snapshotRpc.mockClear();
    createUserScopedSupabaseMock.mockClear();
    privacyConsentQuery.mockReset();
    privacyConsentQuery.mockResolvedValue({
      data: {
        user_id: user.userId,
        notice_version: "2026-07-29.v1",
        accepted_at: "2026-07-11T00:00:00.000Z",
      },
      error: null,
    });
    snapshotRpc.mockImplementation((...rpcArgs: unknown[]) => {
      const name = rpcArgs[0] as string;
      const args = rpcArgs[1] as { p_request_id: string; p_user_id: string };
      if (name !== "get_ai_generation_regeneration_snapshot") {
        return Promise.resolve({ data: null, error: { message: "unexpected rpc" } });
      }
      return Promise.resolve({
        data: [
          {
            request_id: args.p_request_id,
            user_id: args.p_user_id,
            kind: "regenerate_dish",
            source_menu_id: "52000000-0000-4000-8000-000000000001",
            source_menu_version: 1,
            replace_dish_id: dish2Id,
            target_mode: "household",
            servings: 2,
            target_member_ids: ["55000000-0000-4000-8000-000000000001"],
            created_at: "2026-07-11T00:00:00.000Z",
          },
        ],
        error: null,
      });
    });
  });

  // F1: body の literal ではなく DB の current consent を必須にする
  it.each([
    ["no consent row", null],
    [
      "old notice version only",
      {
        user_id: "85000000-0000-4000-8000-000000000001",
        notice_version: "2026-07-11.v1",
        accepted_at: "2026-07-11T00:00:00.000Z",
      },
    ],
    [
      "foreign user's current consent",
      {
        user_id: "85000000-0000-4000-8000-000000000099",
        notice_version: "2026-07-29.v1",
        accepted_at: "2026-07-11T00:00:00.000Z",
      },
    ],
  ] as const)("rejects regenerate_dish with consent_required when %s", async (_case, consent) => {
    privacyConsentQuery.mockResolvedValue({ data: consent, error: null });
    const deps = makeLoaderDeps(makeStoredMenu());
    await expect(
      loadRegenerationExecutionContext(
        deps,
        user,
        dishCommand,
        "91000000-0000-4000-8000-000000000001",
        50_000,
      ),
    ).rejects.toMatchObject({
      code: "consent_required",
      status: 422,
      message: "最新の利用説明への同意が必要です。",
    });
    expect(deps.loadSource).not.toHaveBeenCalled();
    expect(deps.buildCurrentContext).not.toHaveBeenCalled();
  });

  it.each([
    ["no consent row", null],
    [
      "old notice version only",
      {
        user_id: "85000000-0000-4000-8000-000000000001",
        notice_version: "2026-07-11.v1",
        accepted_at: "2026-07-11T00:00:00.000Z",
      },
    ],
    [
      "foreign user's current consent",
      {
        user_id: "85000000-0000-4000-8000-000000000099",
        notice_version: "2026-07-29.v1",
        accepted_at: "2026-07-11T00:00:00.000Z",
      },
    ],
  ] as const)("rejects regenerate_menu with consent_required when %s", async (_case, consent) => {
    privacyConsentQuery.mockResolvedValue({ data: consent, error: null });
    // メニュー全体再生成用 snapshot。hoisted 既定は dish 向けのため上書きする
    snapshotRpc.mockImplementation((...rpcArgs: unknown[]) => {
      const args = rpcArgs[1] as { p_request_id: string; p_user_id: string };
      return Promise.resolve({
        data: [
          {
            request_id: args.p_request_id,
            user_id: args.p_user_id,
            kind: "regenerate_menu",
            source_menu_id: "52000000-0000-4000-8000-000000000001",
            source_menu_version: 1,
            replace_dish_id: null as string | null,
            target_mode: "household",
            servings: 2,
            target_member_ids: ["55000000-0000-4000-8000-000000000001"],
            created_at: "2026-07-11T00:00:00.000Z",
          },
        ],
        error: null,
      });
    });
    const deps = makeLoaderDeps(makeStoredMenu());
    await expect(
      loadRegenerationExecutionContext(
        deps,
        user,
        menuCommand,
        "91000000-0000-4000-8000-000000000001",
        50_000,
      ),
    ).rejects.toMatchObject({
      code: "consent_required",
      status: 422,
      message: "最新の利用説明への同意が必要です。",
    });
    expect(deps.loadSource).not.toHaveBeenCalled();
    expect(deps.buildCurrentContext).not.toHaveBeenCalled();
  });

  it.each(["regenerate_menu", "regenerate_dish"] as const)(
    "proceeds for %s when the authenticated user has current consent",
    async (kind) => {
      const command = kind === "regenerate_menu" ? menuCommand : dishCommand;
      if (kind === "regenerate_menu") {
        snapshotRpc.mockImplementation((...rpcArgs: unknown[]) => {
          const args = rpcArgs[1] as { p_request_id: string; p_user_id: string };
          return Promise.resolve({
            data: [
              {
                request_id: args.p_request_id,
                user_id: args.p_user_id,
                kind: "regenerate_menu",
                source_menu_id: "52000000-0000-4000-8000-000000000001",
                source_menu_version: 1,
                replace_dish_id: null as string | null,
                target_mode: "household",
                servings: 2,
                target_member_ids: ["55000000-0000-4000-8000-000000000001"],
                created_at: "2026-07-11T00:00:00.000Z",
              },
            ],
            error: null,
          });
        });
      }
      const deps = makeLoaderDeps(makeStoredMenu());
      const context = await loadRegenerationExecutionContext(
        deps,
        user,
        command,
        "91000000-0000-4000-8000-000000000001",
        50_000,
      );
      expect(context.kind).toBe(kind);
      expect(createUserScopedSupabaseMock).toHaveBeenCalledWith(user.accessToken);
      expect(deps.loadSource).toHaveBeenCalled();
    },
  );

  it("loads current safety and excludes every dish in the root group", async () => {
    const teriyakiSignature = dishSig("照り焼き", "main", ["鶏肉"]);
    const sweetSoySignature = dishSig("甘辛炒め", "side", ["豚肉"]);
    const source = makeStoredMenu();
    const sibling = makeStoredMenu({
      menu: makeValidatedMenu({
        menuId: "52000000-0000-4000-8000-000000000099",
        dishes: [
          {
            id: "50000000-0000-4000-8000-000000000091",
            role: "main",
            position: 1,
            name: "照り焼き",
            description: "主菜",
            cookingTimeMinutes: 20,
            ingredients: [
              {
                id: "53000000-0000-4000-8000-000000000091",
                position: 1,
                name: "鶏肉",
                quantityValue: 200,
                quantityText: "200g",
                unit: "g",
                storeSection: "meat_fish",
                pantrySelectionId: null,
                labelConfirmationRequired: false,
              },
            ],
            steps: [
              {
                id: "51000000-0000-4000-8000-000000000091",
                position: 1,
                instruction: "焼く",
              },
            ],
          },
          {
            id: "50000000-0000-4000-8000-000000000092",
            role: "side",
            position: 2,
            name: "甘辛炒め",
            description: "副菜",
            cookingTimeMinutes: 15,
            ingredients: [
              {
                id: "53000000-0000-4000-8000-000000000092",
                position: 1,
                name: "豚肉",
                quantityValue: 100,
                quantityText: "100g",
                unit: "g",
                storeSection: "meat_fish",
                pantrySelectionId: null,
                labelConfirmationRequired: false,
              },
            ],
            steps: [
              {
                id: "51000000-0000-4000-8000-000000000092",
                position: 1,
                instruction: "炒める",
              },
            ],
          },
        ],
      }),
    });

    const generationContext = makeGenerationContext();
    const deps = makeLoaderDeps(source, {
      group: [source, sibling],
      generationContext,
    });

    // expectedSafetyFingerprint は現行 context から計算される
    const expectedFp = createCurrentSafetyFingerprint(generationContext.safety);

    snapshotRpc.mockImplementation((...rpcArgs: unknown[]) => {
      const args = rpcArgs[1] as { p_request_id: string; p_user_id: string };
      return Promise.resolve({
        data: [
          {
            request_id: args.p_request_id,
            user_id: args.p_user_id,
            kind: "regenerate_dish",
            source_menu_id: source.menu.menuId,
            source_menu_version: source.version,
            replace_dish_id: dish2Id,
            target_mode: "household",
            servings: 2,
            target_member_ids: [...source.targetMemberIds],
            created_at: "2026-07-11T00:00:00.000Z",
          },
        ],
        error: null,
      });
    });
    const context = await loadRegenerationExecutionContext(
      deps,
      user,
      {
        commandVersion: "generation-command.v3",
        kind: "regenerate_dish",
        qualityMode: false,
        request: {
          sourceMenuId: source.menu.menuId,
          dishId: dish2Id,
          idempotencyKey: "82000000-0000-4000-8000-000000000001",
          changeReason: "simpler",
          changeReasonCustom: null,
          privacyNoticeVersion: "2026-07-29.v1",
          expiredPantryConfirmations: [],
        },
      },
      "91000000-0000-4000-8000-000000000001",
      50_000,
    );

    expect(context.expectedSafetyFingerprint).toBe(expectedFp);
    expect(context.kind).toBe("regenerate_dish");
    if (context.kind !== "regenerate_dish") throw new Error("expected regenerate_dish");
    expect(
      context.regeneration.existingDerivationMenus.flatMap((menu) => menu.dishSignatures),
    ).toEqual(expect.arrayContaining([teriyakiSignature, sweetSoySignature]));
    expect(context.regeneration.retainedDishIds).not.toContain(dish2Id);
    expect(context.startedAtMonotonicMs).toBe(1_000);
  });

  it("caps dish regeneration excludedDishSignatures at 200 so load does not throw ZodError", async () => {
    const source = makeStoredMenu();
    const group = Array.from({ length: 101 }, (_, index) =>
      makeStoredMenu({
        menu: makeValidatedMenu({
          menuId: `b1000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        }),
      }),
    );
    group[0] = source;
    const deps = makeLoaderDeps(source, { group, recent: [] });
    snapshotRpc.mockImplementation((...rpcArgs: unknown[]) => {
      const args = rpcArgs[1] as { p_request_id: string; p_user_id: string };
      return Promise.resolve({
        data: [
          {
            request_id: args.p_request_id,
            user_id: args.p_user_id,
            kind: "regenerate_dish",
            source_menu_id: source.menu.menuId,
            source_menu_version: source.version,
            replace_dish_id: dish2Id,
            target_mode: "household",
            servings: 2,
            target_member_ids: [...source.targetMemberIds],
            created_at: "2026-07-11T00:00:00.000Z",
          },
        ],
        error: null,
      });
    });
    const loaded = await loadRegenerationExecutionContext(
      deps,
      user,
      {
        commandVersion: "generation-command.v3",
        kind: "regenerate_dish",
        qualityMode: false,
        request: {
          sourceMenuId: source.menu.menuId,
          dishId: dish2Id,
          idempotencyKey: "82000000-0000-4000-8000-000000000001",
          changeReason: "simpler",
          changeReasonCustom: null,
          privacyNoticeVersion: "2026-07-29.v1",
          expiredPantryConfirmations: [],
        },
      },
      "91000000-0000-4000-8000-000000000001",
      50_000,
    );
    expect(loaded.kind).toBe("regenerate_dish");
    if (loaded.kind !== "regenerate_dish") throw new Error("expected regenerate_dish");
    const flat = loaded.regeneration.existingDerivationMenus.flatMap((menu) => menu.dishSignatures);
    expect(flat.length).toBeGreaterThan(200);
    const artifacts = requireRegenerationArtifacts(loaded.regeneration.artifacts);
    expect(artifacts.promptDto?.excludedDishSignatures).toHaveLength(200);
  });

  it("requires at least one surviving current target member", async () => {
    const deps = makeLoaderDeps(
      makeStoredMenu({
        targetMembers: [
          {
            householdMemberId: null,
            anonymousMemberRef: "member_1",
            displayNameSnapshot: "削除済みの家族",
            displayName: "削除済みの家族",
          },
        ],
        targetMemberIds: [],
      }),
    );
    await expect(
      loadRegenerationExecutionContext(
        deps,
        user,
        dishCommand,
        "91000000-0000-4000-8000-000000000001",
        50_000,
      ),
    ).rejects.toMatchObject({ code: "current_target_member_required" });
    expect(deps.buildCurrentContext).not.toHaveBeenCalled();
  });

  it("fails current safety revalidation before build side-effects complete", async () => {
    // 取り分けを欠いた献立は現行 validate で target_member_mismatch になる
    const deps = makeLoaderDeps(
      makeStoredMenu({
        menu: makeValidatedMenu({ adaptations: [] }),
      }),
    );
    await expect(
      loadRegenerationExecutionContext(
        deps,
        user,
        dishCommand,
        "91000000-0000-4000-8000-000000000001",
        50_000,
      ),
    ).rejects.toMatchObject({ code: "current_safety_revalidation_required" });
  });

  it("does not map source guarantee phrases to current_safety_revalidation_required", async () => {
    // G2: 歴史行の「安全です」は家族 allergen/food-rules 失敗ではない。
    // ソース関門を 422 current_safety_revalidation_required に畳むと、
    // 家族安全 OK のまま「家族設定では使えない」と誤誘導し再生成が始まらない。
    const base = makeStoredMenu();
    const source = makeStoredMenu({
      menu: {
        ...base.menu,
        dishes: base.menu.dishes.map((dish, index) =>
          index === 0 ? { ...dish, description: "小麦アレルギーでも安全です" } : dish,
        ),
      },
    });
    const deps = makeLoaderDeps(source);
    const context = await loadRegenerationExecutionContext(
      deps,
      user,
      dishCommand,
      "91000000-0000-4000-8000-000000000001",
      50_000,
    );
    expect(context.kind).toBe("regenerate_dish");
    expect(deps.buildCurrentContext).toHaveBeenCalled();
  });

  it("maps foreign or missing source to source_menu_changed before current context", async () => {
    const deps = makeLoaderDeps(makeStoredMenu());
    deps.loadSource.mockRejectedValue(new HttpError(404, "menu_not_found", "献立が見つかりません"));
    await expect(
      loadRegenerationExecutionContext(
        deps,
        user,
        dishCommand,
        "91000000-0000-4000-8000-000000000001",
        50_000,
      ),
    ).rejects.toMatchObject({ code: "source_menu_changed", status: 422 });
    // snapshot 後の live source 欠落は fail-closed。build へ進まない
    expect(deps.buildCurrentContext).not.toHaveBeenCalled();
    expect(deps.loadGroup).not.toHaveBeenCalled();
  });

  it("fails closed when live source version diverges from the request snapshot", async () => {
    const deps = makeLoaderDeps(makeStoredMenu({ version: 9 }));
    await expect(
      loadRegenerationExecutionContext(
        deps,
        user,
        dishCommand,
        "91000000-0000-4000-8000-000000000001",
        50_000,
      ),
    ).rejects.toMatchObject({ code: "source_menu_changed", status: 422 });
    expect(deps.buildCurrentContext).not.toHaveBeenCalled();
  });

  it("returns source_menu_changed when live targetMode disagrees with snapshot after version match", async () => {
    // snapshot は household（beforeEach 既定）、version 一致、live だけ idea
    const deps = makeLoaderDeps(makeStoredMenu({ targetMode: "idea" }));
    await expect(
      loadRegenerationExecutionContext(
        deps,
        user,
        dishCommand,
        "91000000-0000-4000-8000-000000000001",
        50_000,
      ),
    ).rejects.toMatchObject({
      code: "source_menu_changed",
      status: 422,
      message: "元の献立が更新されたため、もう一度操作してください",
    });
    expect(deps.buildCurrentContext).not.toHaveBeenCalled();
  });

  it("does not report current_target_member_required when mode flipped to idea before empty-member check", async () => {
    // snapshot household のまま live が idea + 空メンバー → mode 不一致が先
    const deps = makeLoaderDeps(
      makeStoredMenu({
        targetMode: "idea",
        targetMemberIds: [],
        targetMembers: [],
      }),
    );
    await expect(
      loadRegenerationExecutionContext(
        deps,
        user,
        dishCommand,
        "91000000-0000-4000-8000-000000000001",
        50_000,
      ),
    ).rejects.toMatchObject({ code: "source_menu_changed", status: 422 });
    await expect(
      loadRegenerationExecutionContext(
        deps,
        user,
        dishCommand,
        "91000000-0000-4000-8000-000000000001",
        50_000,
      ),
    ).rejects.not.toMatchObject({ code: "current_target_member_required" });
    expect(deps.buildCurrentContext).not.toHaveBeenCalled();
  });

  it("passes snapshot.target_mode as authorityTargetMode into buildCurrentContext", async () => {
    // idea revalidation ゲートは snapshot のみなので household validate を走らせない
    const ideaContext = makeIdeaGenerationContext();
    const deps = makeLoaderDeps(makeStoredMenu({ targetMode: "idea" }), {
      generationContext: ideaContext,
    });
    snapshotRpc.mockImplementation((...rpcArgs: unknown[]) => {
      const args = rpcArgs[1] as { p_request_id: string; p_user_id: string };
      return Promise.resolve({
        data: [
          {
            request_id: args.p_request_id,
            user_id: args.p_user_id,
            kind: "regenerate_dish",
            source_menu_id: "52000000-0000-4000-8000-000000000001",
            source_menu_version: 1,
            replace_dish_id: dish2Id,
            target_mode: "idea",
            servings: 2,
            target_member_ids: [],
            created_at: "2026-07-11T00:00:00.000Z",
          },
        ],
        error: null,
      });
    });

    await loadRegenerationExecutionContext(
      deps,
      user,
      dishCommand,
      "91000000-0000-4000-8000-000000000001",
      50_000,
    );

    expect(deps.buildCurrentContext).toHaveBeenCalledWith(
      expect.objectContaining({ authorityTargetMode: "idea" }),
    );

    // household snapshot でも同様に伝播する
    const householdDeps = makeLoaderDeps(makeStoredMenu({ targetMode: "household" }));
    snapshotRpc.mockImplementation((...rpcArgs: unknown[]) => {
      const args = rpcArgs[1] as { p_request_id: string; p_user_id: string };
      return Promise.resolve({
        data: [
          {
            request_id: args.p_request_id,
            user_id: args.p_user_id,
            kind: "regenerate_dish",
            source_menu_id: "52000000-0000-4000-8000-000000000001",
            source_menu_version: 1,
            replace_dish_id: dish2Id,
            target_mode: "household",
            servings: 2,
            target_member_ids: ["55000000-0000-4000-8000-000000000001"],
            created_at: "2026-07-11T00:00:00.000Z",
          },
        ],
        error: null,
      });
    });
    await loadRegenerationExecutionContext(
      householdDeps,
      user,
      dishCommand,
      "91000000-0000-4000-8000-000000000002",
      50_000,
    );
    expect(householdDeps.buildCurrentContext).toHaveBeenCalledWith(
      expect.objectContaining({ authorityTargetMode: "household" }),
    );
  });
});

describe("buildExistingDerivationMenus / reloadExistingDerivationMenus", () => {
  it("includes source when absent from group+recent and maps signatures", () => {
    const source = makeStoredMenu();
    const other = makeStoredMenu({
      menu: makeValidatedMenu({
        menuId: "b1000000-0000-4000-8000-000000000002",
      }),
    });
    const built = buildExistingDerivationMenus([other], source.menu);
    expect(built).toHaveLength(2);
    expect(built.map((item) => item.menuId).sort()).toEqual(
      [source.menu.menuId, other.menu.menuId].sort(),
    );
    const sourceEntry = built.find((item) => item.menuId === source.menu.menuId);
    expect(sourceEntry?.dishSignatures).toHaveLength(source.menu.dishes.length);
    expect(sourceEntry?.menuSignature.length).toBeGreaterThan(0);
  });

  it("HR3: reloadExistingDerivationMenus re-reads group+recent via deps", async () => {
    const source = makeStoredMenu();
    const concurrentSibling = makeStoredMenu({
      menu: makeValidatedMenu({
        menuId: "c1000000-0000-4000-8000-000000000003",
      }),
    });
    const loadGroup = vi.fn(() => Promise.resolve([source, concurrentSibling]));
    const loadRecent = vi.fn(() => Promise.resolve([]));
    const result = await reloadExistingDerivationMenus(
      { loadGroup, loadRecent },
      user,
      source.derivationGroupId,
      source.menu,
    );
    expect(loadGroup).toHaveBeenCalledWith(user, source.derivationGroupId);
    expect(loadRecent).toHaveBeenCalledWith(user, 20);
    expect(result.map((item) => item.menuId).sort()).toEqual(
      [source.menu.menuId, concurrentSibling.menu.menuId].sort(),
    );
  });
});

describe("isRegenerationDuplicate material equivalence", () => {
  const chickenCabbage = {
    role: "main",
    name: "鶏肉と白菜の煮物",
    primaryIngredients: ["鶏もも肉", "白菜", "しょうゆ"],
  } as const;
  const cabbageChicken = {
    role: "main",
    name: "白菜と鶏肉の煮物",
    primaryIngredients: ["白菜", "鶏もも肉", "しょうゆ"],
  } as const;

  function dishFromSigInput(
    input: {
      role: "main" | "side" | "soup" | "staple" | "other";
      name: string;
      primaryIngredients: readonly string[];
    },
    dishId: string,
  ) {
    return {
      id: dishId,
      role: input.role,
      position: 1,
      name: input.name,
      description: "テスト",
      cookingTimeMinutes: 20,
      ingredients: input.primaryIngredients.map((name, index) => ({
        id: `53000000-0000-4000-8000-00000000000${String(index + 1)}`,
        position: index + 1,
        name,
        quantityValue: 100,
        quantityText: "100g",
        unit: "g",
        storeSection: "meat_fish" as const,
        pantrySelectionId: null,
        labelConfirmationRequired: false,
      })),
      steps: [
        {
          id: "51000000-0000-4000-8000-000000000001",
          position: 1,
          instruction: "煮る",
        },
      ],
    };
  }

  it("rejects a dish that is only materially the same as an existing derivation dish", () => {
    const sourceMenu = makeValidatedMenu({
      dishes: [
        dishFromSigInput(chickenCabbage, dish1Id),
        {
          ...makeValidatedMenu().dishes[1]!,
          id: dish2Id,
        },
      ],
    });
    const candidate = makeValidatedMenu({
      dishes: [
        dishFromSigInput(cabbageChicken, "b0000000-0000-4000-8000-000000000001"),
        {
          ...makeValidatedMenu().dishes[1]!,
          id: "b0000000-0000-4000-8000-000000000002",
        },
      ],
    });
    const existingSig = createDishSignature(chickenCabbage);
    const candidateSig = createDishSignature(cabbageChicken);
    // 名前順が異なるため exact シグネチャは不一致
    expect(existingSig).not.toBe(candidateSig);

    const execution: Extract<GenerationExecutionContext, { kind: "regenerate_dish" }> = {
      kind: "regenerate_dish",
      command: dishCommand,
      requestId: "81000000-0000-4000-8000-000000000001",
      generationContext: makeGenerationContext(),
      expectedSafetyFingerprint: "fp",
      startedAtMonotonicMs: 0,
      deadlineAtMonotonicMs: 50_000,
      regeneration: {
        sourceMenuId: sourceMenu.menuId,
        sourceMenu,
        derivationGroupId: "a1000000-0000-4000-8000-000000000001",
        replaceDishId: dish1Id,
        retainedDishIds: [dish2Id],
        excludedDishIds: [dish1Id, dish2Id],
        sourceSafetyFingerprint: "source-fp",
        sourcePreferenceSnapshot: {},
        existingDerivationMenus: [
          {
            menuId: sourceMenu.menuId,
            menuSignature: createMenuSignature({
              dishes: sourceMenu.dishes.map((dish) => ({
                role: dish.role,
                name: dish.name,
                primaryIngredients: dish.ingredients.map((item) => item.name),
              })),
            }),
            dishSignatures: [
              existingSig,
              createDishSignature({
                role: "side",
                name: "温野菜",
                primaryIngredients: ["にんじん"],
              }),
            ],
          },
        ],
        artifacts: {
          retainedDishes: [],
          sourceDishToReplace: null,
          promptDto: null,
          retainedRefMap: new Map(),
        },
      },
    };

    expect(isRegenerationDuplicate(candidate, execution)).toBe(true);
  });

  it("rejects a whole menu when every role is only materially unchanged", () => {
    const firstDishes = [
      dishFromSigInput(chickenCabbage, dish1Id),
      {
        id: dish2Id,
        role: "side" as const,
        position: 2,
        name: "にんじんの和え物",
        description: "副菜",
        cookingTimeMinutes: 10,
        ingredients: [
          {
            id: "53000000-0000-4000-8000-000000000099",
            position: 1,
            name: "にんじん",
            quantityValue: 1,
            quantityText: "1本",
            unit: "本",
            storeSection: "produce" as const,
            pantrySelectionId: null,
            labelConfirmationRequired: false,
          },
        ],
        steps: [
          {
            id: "51000000-0000-4000-8000-000000000099",
            position: 1,
            instruction: "和える",
          },
        ],
      },
    ];
    const secondDishes = [
      {
        id: "b0000000-0000-4000-8000-000000000002",
        role: "side" as const,
        position: 2,
        name: "人参の和え物",
        description: "副菜",
        cookingTimeMinutes: 10,
        ingredients: [
          {
            id: "b3000000-0000-4000-8000-000000000002",
            position: 1,
            name: "にんじん",
            quantityValue: 1,
            quantityText: "1本",
            unit: "本",
            storeSection: "produce" as const,
            pantrySelectionId: null,
            labelConfirmationRequired: false,
          },
        ],
        steps: [
          {
            id: "b1000000-0000-4000-8000-000000000002",
            position: 1,
            instruction: "和える",
          },
        ],
      },
      dishFromSigInput(cabbageChicken, "b0000000-0000-4000-8000-000000000001"),
    ];
    const sourceMenu = makeValidatedMenu({ dishes: firstDishes });
    const candidate = makeValidatedMenu({ dishes: secondDishes });
    const existingMenuSig = createMenuSignature({
      dishes: firstDishes.map((dish) => ({
        role: dish.role,
        name: dish.name,
        primaryIngredients: dish.ingredients.map((item) => item.name),
      })),
    });
    const candidateMenuSig = createMenuSignature({
      dishes: secondDishes.map((dish) => ({
        role: dish.role,
        name: dish.name,
        primaryIngredients: dish.ingredients.map((item) => item.name),
      })),
    });
    // 人参/にんじん は signature 正規化で一致し得るが、主菜名順が違うので menu 全体は別
    expect(existingMenuSig).not.toBe(candidateMenuSig);

    const execution: Extract<GenerationExecutionContext, { kind: "regenerate_menu" }> = {
      kind: "regenerate_menu",
      command: {
        commandVersion: "generation-command.v3",
        kind: "regenerate_menu",
        qualityMode: false,
        request: {
          idempotencyKey: "82000000-0000-4000-8000-000000000001",
          sourceMenuId: sourceMenu.menuId,
          changeReason: "simpler",
          changeReasonCustom: null,
          privacyNoticeVersion: "2026-07-29.v1",
          expiredPantryConfirmations: [],
        },
      },
      requestId: "81000000-0000-4000-8000-000000000001",
      generationContext: makeGenerationContext(),
      expectedSafetyFingerprint: "fp",
      startedAtMonotonicMs: 0,
      deadlineAtMonotonicMs: 50_000,
      regeneration: {
        sourceMenuId: sourceMenu.menuId,
        sourceMenu,
        derivationGroupId: "a1000000-0000-4000-8000-000000000001",
        replaceDishId: null,
        retainedDishIds: firstDishes.map((dish) => dish.id),
        excludedDishIds: firstDishes.map((dish) => dish.id),
        sourceSafetyFingerprint: "source-fp",
        sourcePreferenceSnapshot: {},
        existingDerivationMenus: [
          {
            menuId: sourceMenu.menuId,
            menuSignature: existingMenuSig,
            dishSignatures: firstDishes.map((dish) =>
              createDishSignature({
                role: dish.role,
                name: dish.name,
                primaryIngredients: dish.ingredients.map((item) => item.name),
              }),
            ),
          },
        ],
        artifacts: {
          retainedDishes: [],
          sourceDishToReplace: null,
          promptDto: null,
          retainedRefMap: new Map(),
        },
      },
    };

    expect(isRegenerationDuplicate(candidate, execution)).toBe(true);
  });
});

describe("materializeDishRegenerationCandidate", () => {
  function makeDishRegenerationExecutionContext() {
    const mainStepId = "51000000-0000-4000-8000-000000000001";
    const sideStepId = "51000000-0000-4000-8000-000000000002";
    const sourceMenu = makeValidatedMenu({
      dishes: [
        {
          id: dish1Id,
          role: "main",
          position: 1,
          name: "元の主菜",
          description: "置換対象",
          cookingTimeMinutes: 20,
          ingredients: [
            {
              id: "53000000-0000-4000-8000-000000000001",
              position: 1,
              name: "鶏肉",
              quantityValue: 200,
              quantityText: "200g",
              unit: "g",
              storeSection: "meat_fish",
              pantrySelectionId: null,
              labelConfirmationRequired: false,
            },
          ],
          steps: [
            {
              id: mainStepId,
              position: 1,
              instruction: "焼く",
            },
          ],
        },
        {
          id: dish2Id,
          role: "side",
          position: 2,
          name: "保持する副菜",
          description: "保持",
          cookingTimeMinutes: 10,
          ingredients: [
            {
              id: "53000000-0000-4000-8000-000000000002",
              position: 1,
              name: "にんじん",
              quantityValue: 1,
              quantityText: "1本",
              unit: "本",
              storeSection: "produce",
              pantrySelectionId: null,
              labelConfirmationRequired: false,
            },
          ],
          steps: [
            {
              id: sideStepId,
              position: 1,
              instruction: "和える",
            },
          ],
        },
      ],
      timeline: [
        {
          id: "54000000-0000-4000-8000-000000000001",
          position: 1,
          startMinute: 0,
          durationMinutes: 20,
          instruction: "主菜",
          dishId: dish1Id,
          recipeStepId: mainStepId,
        },
      ],
      adaptations: [
        {
          id: "57000000-0000-4000-8000-000000000001",
          dishId: dish1Id,
          anonymousMemberRef: "member_1",
          portionText: "通常量",
          branchBeforeRecipeStepId: mainStepId,
          additionalCutting: null,
          additionalHeating: null,
          additionalSeasoning: null,
          servingCheck: "通常の取り分けを確認する",
          safetyTags: [],
          safetyActions: [],
        },
      ],
      pantryUsage: [],
      labelConfirmations: [],
    });
    const retained = toRetainedDishPrompt(sourceMenu, dish1Id);
    // 現行条件は時間上限なし・主要食材なしにして materialize 後の validate を通す
    const generationContext = makeGenerationContext({
      submission: {
        ...makeGenerationContext().submission,
        mainIngredients: ["豚こま肉"],
        timeLimitMinutes: null,
      },
    });
    let seq = 0;
    const uuid = () => {
      seq += 1;
      return `b${String(seq).padStart(7, "0")}-0000-4000-8000-000000000001`;
    };
    return {
      execution: {
        kind: "regenerate_dish" as const,
        command: dishCommand,
        requestId: "81000000-0000-4000-8000-000000000001",
        generationContext,
        expectedSafetyFingerprint: createCurrentSafetyFingerprint(generationContext.safety),
        startedAtMonotonicMs: 0,
        deadlineAtMonotonicMs: 50_000,
        regeneration: {
          sourceMenuId: sourceMenu.menuId,
          sourceMenu,
          derivationGroupId: "a1000000-0000-4000-8000-000000000001",
          replaceDishId: dish1Id,
          retainedDishIds: [dish2Id],
          excludedDishIds: [dish1Id, dish2Id],
          sourceSafetyFingerprint: "source-fp",
          sourcePreferenceSnapshot: {},
          existingDerivationMenus: [],
          artifacts: {
            retainedDishes: retained.dto,
            sourceDishToReplace: retained.replaceTarget,
            promptDto: null,
            retainedRefMap: retained.refMap,
          },
        },
      },
      uuid,
    };
  }

  function makeDishRegenerationAiOutput(): DishRegenerationAiOutput {
    return {
      replacementDish: {
        dishRef: "dish_1",
        role: "main",
        position: 1,
        name: "豚肉と白菜の炒め物",
        description: "さっと炒める主菜",
        cookingTimeMinutes: 20,
        ingredients: [
          {
            ingredientRef: "ingredient_10",
            position: 1,
            name: "豚こま肉",
            quantityValue: 200,
            quantityText: "200g",
            unit: "g",
            storeSection: "meat_fish",
            pantryRef: null,
            labelConfirmationRequired: false,
          },
        ],
        steps: [
          {
            stepRef: "step_10",
            position: 1,
            instruction: "中火で炒める",
          },
        ],
      },
      timeline: [
        {
          timelineRef: "timeline_1",
          position: 1,
          startMinute: 0,
          durationMinutes: 20,
          instruction: "主菜を炒める",
          dishRef: "dish_1",
          stepRef: "step_10",
        },
        {
          timelineRef: "timeline_2",
          position: 2,
          startMinute: 0,
          durationMinutes: 10,
          instruction: "副菜を作る",
          dishRef: "dish_2",
          stepRef: "step_31",
        },
      ],
      adaptations: [
        {
          adaptationRef: "adaptation_1",
          dishRef: "dish_1",
          anonymousMemberRef: "member_1",
          portionText: "通常量",
          beforeStepRef: "step_10",
          additionalCutting: null,
          additionalHeating: null,
          additionalSeasoning: null,
          servingCheck: "通常の取り分けを確認する",
          safetyTags: [],
          safetyActions: [],
        },
      ],
      pantryUsage: [],
      labelConfirmations: [],
    };
  }

  it("materializes one replacement plus complete local-ref sections into one full candidate", () => {
    const { execution, uuid } = makeDishRegenerationExecutionContext();
    const candidate = materializeDishRegenerationCandidate(
      execution,
      makeDishRegenerationAiOutput(),
      uuid,
    );
    expect(
      candidate.dishes.filter((dish) => dish.id === execution.regeneration.replaceDishId),
    ).toHaveLength(0);
    const retained = candidate.dishes.find((dish) => dish.name === "保持する副菜");
    const sourceRetained = execution.regeneration.sourceMenu.dishes.find(
      (dish) => dish.name === "保持する副菜",
    );
    expect(retained).toBeDefined();
    expect(sourceRetained).toBeDefined();
    if (retained === undefined || sourceRetained === undefined) {
      throw new Error("retained fixture missing");
    }
    expect({
      role: retained.role,
      position: retained.position,
      name: retained.name,
      description: retained.description,
      cookingTimeMinutes: retained.cookingTimeMinutes,
      ingredientText: retained.ingredients.map(
        ({ name, quantityValue, quantityText, unit, storeSection }) => ({
          name,
          quantityValue,
          quantityText,
          unit,
          storeSection,
        }),
      ),
      stepText: retained.steps.map(({ position, instruction }) => ({ position, instruction })),
    }).toEqual({
      role: sourceRetained.role,
      position: sourceRetained.position,
      name: sourceRetained.name,
      description: sourceRetained.description,
      cookingTimeMinutes: sourceRetained.cookingTimeMinutes,
      ingredientText: sourceRetained.ingredients.map(
        ({ name, quantityValue, quantityText, unit, storeSection }) => ({
          name,
          quantityValue,
          quantityText,
          unit,
          storeSection,
        }),
      ),
      stepText: sourceRetained.steps.map(({ position, instruction }) => ({
        position,
        instruction,
      })),
    });
    expect(retained.id).not.toBe(sourceRetained.id);
    expect(retained.ingredients.map((item) => item.id)).not.toEqual(
      sourceRetained.ingredients.map((item) => item.id),
    );
    expect(retained.steps.map((item) => item.id)).not.toEqual(
      sourceRetained.steps.map((item) => item.id),
    );
    expect(
      candidate.timeline.every((row) =>
        row.dishId === null ? true : candidate.dishes.some((dish) => dish.id === row.dishId),
      ),
    ).toBe(true);
    const checked = validateGeneratedMenu(candidate, execution.generationContext);
    if (!checked.ok) {
      throw new Error(`materialize validation: ${JSON.stringify(checked.issues)}`);
    }
    expect(checked.ok).toBe(true);

    // 集約所有 UUID を source と共有しない（menu/dish/ingredient/step/timeline/adaptation）
    const sourceMenu = execution.regeneration.sourceMenu;
    const sourceIds = new Set<string>([sourceMenu.menuId]);
    for (const dish of sourceMenu.dishes) {
      sourceIds.add(dish.id);
      for (const item of dish.ingredients) sourceIds.add(item.id);
      for (const step of dish.steps) sourceIds.add(step.id);
    }
    for (const row of sourceMenu.timeline) sourceIds.add(row.id);
    for (const row of sourceMenu.adaptations) sourceIds.add(row.id);
    expect(sourceIds.has(candidate.menuId)).toBe(false);
    for (const dish of candidate.dishes) {
      expect(sourceIds.has(dish.id)).toBe(false);
      for (const item of dish.ingredients) expect(sourceIds.has(item.id)).toBe(false);
      for (const step of dish.steps) expect(sourceIds.has(step.id)).toBe(false);
    }
    for (const row of candidate.timeline) expect(sourceIds.has(row.id)).toBe(false);
    for (const row of candidate.adaptations) expect(sourceIds.has(row.id)).toBe(false);
    // 保持・置換のラベルはすべて pending（履歴 confirmed を持ち込まない）
    // Generated 形は confirmationStatus が pending 固定なので、confirmed フィールド非存在で検証する
    expect(
      candidate.labelConfirmations.every(
        (row) => !("confirmedAt" in row) && !("confirmedBy" in row),
      ),
    ).toBe(true);
  });

  it("strips retained-dish guarantee phrases from the materialized candidate", () => {
    // G3: 保持料理の「安全です」を新 UUID 行へ再 persist / 表示しない。
    const { execution, uuid } = makeDishRegenerationExecutionContext();
    const guaranteedExecution = {
      ...execution,
      regeneration: {
        ...execution.regeneration,
        artifacts: {
          ...execution.regeneration.artifacts,
          retainedDishes: execution.regeneration.artifacts.retainedDishes.map((dish) =>
            dish.name === "保持する副菜"
              ? { ...dish, description: "小麦アレルギーでも安全です" }
              : dish,
          ),
        },
      },
    };
    const candidate = materializeDishRegenerationCandidate(
      guaranteedExecution,
      makeDishRegenerationAiOutput(),
      uuid,
    );
    const retained = candidate.dishes.find((dish) => dish.name === "保持する副菜");
    expect(retained).toBeDefined();
    expect(retained?.description.includes("安全です")).toBe(false);
    // 葉全体プレースホルダにすると小麦針が消え、persist 後の世帯変更再検証が開く
    expect(retained?.description).toContain("小麦");
    expect(retained?.description).not.toBe("料理の説明");
  });

  it("normalizes non-pantry tablespoon quantities on replacement dish", () => {
    const { execution, uuid } = makeDishRegenerationExecutionContext();
    const output = makeDishRegenerationAiOutput();
    output.replacementDish.ingredients[0] = {
      ingredientRef: "ingredient_10",
      position: 1,
      name: "オリーブ油",
      quantityValue: 15,
      quantityText: "15大さじ",
      unit: "大さじ",
      storeSection: "seasonings",
      pantryRef: null,
      labelConfirmationRequired: false,
    };
    const candidate = materializeDishRegenerationCandidate(execution, output, uuid);
    const oil = candidate.dishes.flatMap((d) => d.ingredients).find((i) => i.name === "オリーブ油");
    expect(oil).toMatchObject({
      quantityValue: 225,
      quantityText: "225ml",
      unit: "ml",
    });
  });

  // G2/G3/G4: dish materialize を full_menu の pantry integrity / safetyTags strip と揃える
  it("G2/G3/G4: aligns pantry name/unit/quantity/shortage and strips safetyTags", () => {
    const pantryItemId = "61000000-0000-4000-8000-000000000099";
    const { execution, uuid } = makeDishRegenerationExecutionContext();
    execution.generationContext = makeGenerationContext({
      submission: {
        ...makeGenerationContext().submission,
        mainIngredients: ["豚こま肉"],
        timeLimitMinutes: null,
        pantrySelections: [{ pantryItemId, priority: "prefer_use" as const }],
      },
      pantryItems: [
        {
          id: pantryItemId,
          userId: user.userId,
          name: "豚こま肉",
          quantity: 100,
          unit: "g",
          expiresOn: null,
          expirationType: null,
          openedState: null,
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
        },
      ],
    });
    const output = makeDishRegenerationAiOutput();
    // AI が unit/quantity/name/shortage/safetyTags を偽値で載せても materialize が揃える
    output.replacementDish.ingredients[0] = {
      ...output.replacementDish.ingredients[0]!,
      name: "偽の肉",
      quantityValue: 999,
      quantityText: "999本",
      unit: "本",
      pantryRef: "pantry_1",
    };
    output.pantryUsage = [
      {
        pantryRef: "pantry_1",
        pantryItemName: "偽の肉",
        priority: "prefer_use",
        usageStatus: "used",
        plannedQuantity: 200,
        inventoryQuantity: 50,
        shortageQuantity: 999,
        unit: "g",
        dishRefs: ["dish_1"],
        unusedReason: null,
      },
    ];
    output.adaptations[0]!.safetyTags = ["soft_vegetable", "remove_bones"];

    const candidate = materializeDishRegenerationCandidate(execution, output, uuid);
    const replacement = candidate.dishes.find((dish) => dish.role === "main");
    expect(replacement).toBeDefined();
    expect(replacement!.ingredients[0]).toMatchObject({
      name: "豚こま肉",
      unit: "g",
      quantityValue: 200,
      quantityText: "200g",
    });
    expect(candidate.pantryUsage[0]).toMatchObject({
      pantryItemName: "豚こま肉",
      plannedQuantity: 200,
      inventoryQuantity: 100,
      shortageQuantity: 100,
      unit: "g",
    });
    expect(candidate.safetyTags).toEqual([]);
    expect(candidate.adaptations[0]?.safetyTags).toEqual([]);
  });

  // RR2: full_menu 同型の pantry integrity（duplicate / priority / dishRefs link）
  it("RR2: rejects pantry_usage_duplicate, pantry_priority_mismatch, and pantry_usage_link_mismatch", () => {
    const pantryItemId = "61000000-0000-4000-8000-000000000099";
    const withPantry = () => {
      const { execution, uuid } = makeDishRegenerationExecutionContext();
      execution.generationContext = makeGenerationContext({
        submission: {
          ...makeGenerationContext().submission,
          mainIngredients: ["豚こま肉"],
          timeLimitMinutes: null,
          pantrySelections: [{ pantryItemId, priority: "prefer_use" as const }],
        },
        pantryItems: [
          {
            id: pantryItemId,
            userId: user.userId,
            name: "豚こま肉",
            quantity: 100,
            unit: "g",
            expiresOn: null,
            expirationType: null,
            openedState: null,
            createdAt: "2026-07-11T00:00:00.000Z",
            updatedAt: "2026-07-11T00:00:00.000Z",
          },
        ],
      });
      const output = makeDishRegenerationAiOutput();
      output.replacementDish.ingredients[0] = {
        ...output.replacementDish.ingredients[0]!,
        pantryRef: "pantry_1",
      };
      output.pantryUsage = [
        {
          pantryRef: "pantry_1",
          pantryItemName: "豚こま肉",
          priority: "prefer_use",
          usageStatus: "used",
          plannedQuantity: 200,
          inventoryQuantity: 100,
          shortageQuantity: 100,
          unit: "g",
          dishRefs: ["dish_1"],
          unusedReason: null,
        },
      ];
      return { execution, uuid, output };
    };

    // duplicate pantryRef — assertMaterializationRefUnion が先に fail-closed（RR2 の DiD）
    {
      const { execution, uuid, output } = withPantry();
      output.pantryUsage = [...output.pantryUsage, output.pantryUsage[0]!];
      expect(() => materializeDishRegenerationCandidate(execution, output, uuid)).toThrow(
        /duplicate local ref declaration: pantry_1|pantry_usage_duplicate/,
      );
    }

    // AI priority ≠ trusted selection.priority
    {
      const { execution, uuid, output } = withPantry();
      output.pantryUsage[0]!.priority = "must_use";
      expect(() => materializeDishRegenerationCandidate(execution, output, uuid)).toThrow(
        "pantry_priority_mismatch",
      );
    }

    // dishRefs が実際の ingredient.pantryRef 集合と不一致（retained に pantryRef 無し）
    {
      const { execution, uuid, output } = withPantry();
      output.pantryUsage[0]!.dishRefs = ["dish_2"];
      expect(() => materializeDishRegenerationCandidate(execution, output, uuid)).toThrow(
        "pantry_usage_link_mismatch",
      );
    }
  });

  // G3: 保持料理の pantry 由来を再リンクできる（置換料理だけに押し付ける必要がない）
  it("G3: re-links retained dish pantrySelectionId when pantryRef maps through current submission", () => {
    const pantryItemId = "61000000-0000-4000-8000-000000000088";
    const sourceSelectionId = "58000000-0000-4000-8000-000000000088";
    const mainStepId = "51000000-0000-4000-8000-000000000001";
    const sideStepId = "51000000-0000-4000-8000-000000000002";
    const sourceMenu = makeValidatedMenu({
      dishes: [
        {
          id: dish1Id,
          role: "main",
          position: 1,
          name: "元の主菜",
          description: "置換対象",
          cookingTimeMinutes: 20,
          ingredients: [
            {
              id: "53000000-0000-4000-8000-000000000001",
              position: 1,
              name: "鶏肉",
              quantityValue: 200,
              quantityText: "200g",
              unit: "g",
              storeSection: "meat_fish",
              pantrySelectionId: null,
              labelConfirmationRequired: false,
            },
          ],
          steps: [{ id: mainStepId, position: 1, instruction: "焼く" }],
        },
        {
          id: dish2Id,
          role: "side",
          position: 2,
          name: "保持する副菜",
          description: "保持",
          cookingTimeMinutes: 10,
          ingredients: [
            {
              id: "53000000-0000-4000-8000-000000000002",
              position: 1,
              name: "にんじん",
              quantityValue: 100,
              quantityText: "100g",
              unit: "g",
              storeSection: "produce",
              // ソースでは副菜だけが在庫リンク
              pantrySelectionId: sourceSelectionId,
              labelConfirmationRequired: false,
            },
          ],
          steps: [{ id: sideStepId, position: 1, instruction: "和える" }],
        },
      ],
      timeline: [
        {
          id: "54000000-0000-4000-8000-000000000001",
          position: 1,
          startMinute: 0,
          durationMinutes: 20,
          instruction: "主菜",
          dishId: dish1Id,
          recipeStepId: mainStepId,
        },
      ],
      adaptations: [
        {
          id: "57000000-0000-4000-8000-000000000001",
          dishId: dish1Id,
          anonymousMemberRef: "member_1",
          portionText: "通常量",
          branchBeforeRecipeStepId: mainStepId,
          additionalCutting: null,
          additionalHeating: null,
          additionalSeasoning: null,
          servingCheck: "通常の取り分けを確認する",
          safetyTags: [],
          safetyActions: [],
        },
      ],
      pantryUsage: [
        {
          selectionId: sourceSelectionId,
          pantryItemId,
          pantryItemName: "にんじん",
          priority: "must_use",
          usageStatus: "used",
          plannedQuantity: 100,
          inventoryQuantity: 100,
          shortageQuantity: 0,
          unit: "g",
          dishIds: [dish2Id],
          unusedReason: null,
        },
      ],
    });

    const pantrySelectionIdToRef = buildPantrySelectionIdToRef(sourceMenu, [{ pantryItemId }]);
    // 投影: 保持副菜の ingredient が pantry_1 を持つ
    const retained = toRetainedDishPrompt(sourceMenu, dish1Id, pantrySelectionIdToRef);
    expect(retained.dto).toHaveLength(1);
    expect(retained.dto[0]?.ingredients[0]?.pantryRef).toBe("pantry_1");
    // 置換対象はリンク無し → null のまま
    expect(retained.replaceTarget?.ingredients[0]?.pantryRef).toBeNull();

    const generationContext = makeGenerationContext({
      submission: {
        ...makeGenerationContext().submission,
        mainIngredients: ["豚こま肉"],
        timeLimitMinutes: null,
        pantrySelections: [{ pantryItemId, priority: "must_use" as const }],
      },
      pantryItems: [
        {
          id: pantryItemId,
          userId: user.userId,
          name: "にんじん",
          quantity: 100,
          unit: "g",
          expiresOn: null,
          expirationType: null,
          openedState: null,
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
        },
      ],
    });
    let seq = 0;
    const uuid = () => {
      seq += 1;
      return `c${String(seq).padStart(7, "0")}-0000-4000-8000-000000000001`;
    };
    const execution: Extract<GenerationExecutionContext, { kind: "regenerate_dish" }> = {
      kind: "regenerate_dish",
      command: dishCommand,
      requestId: "81000000-0000-4000-8000-000000000001",
      generationContext,
      expectedSafetyFingerprint: createCurrentSafetyFingerprint(generationContext.safety),
      startedAtMonotonicMs: 0,
      deadlineAtMonotonicMs: 50_000,
      regeneration: {
        sourceMenuId: sourceMenu.menuId,
        sourceMenu,
        derivationGroupId: "a1000000-0000-4000-8000-000000000001",
        replaceDishId: dish1Id,
        retainedDishIds: [dish2Id],
        excludedDishIds: [dish1Id, dish2Id],
        sourceSafetyFingerprint: "source-fp",
        sourcePreferenceSnapshot: {},
        existingDerivationMenus: [],
        artifacts: {
          retainedDishes: retained.dto,
          sourceDishToReplace: retained.replaceTarget,
          promptDto: null,
          retainedRefMap: retained.refMap,
        },
      },
    };

    const output = makeDishRegenerationAiOutput();
    // AI は保持副菜 dish_2 を truthfully 列挙（置換 dish_1 へ寄せない）
    output.pantryUsage = [
      {
        pantryRef: "pantry_1",
        pantryItemName: "にんじん",
        priority: "must_use",
        usageStatus: "used",
        plannedQuantity: 100,
        inventoryQuantity: 100,
        shortageQuantity: 0,
        unit: "g",
        dishRefs: ["dish_2"],
        unusedReason: null,
      },
    ];

    const candidate = materializeDishRegenerationCandidate(execution, output, uuid);
    const retainedDish = candidate.dishes.find((dish) => dish.name === "保持する副菜");
    expect(retainedDish).toBeDefined();
    expect(retainedDish!.ingredients[0]?.pantrySelectionId).not.toBeNull();
    expect(retainedDish!.ingredients[0]?.pantrySelectionId).toBe(
      candidate.pantryUsage[0]?.selectionId,
    );
    expect(candidate.pantryUsage[0]?.dishIds).toEqual([retainedDish!.id]);
    // 置換料理は pantry 無し
    const replacement = candidate.dishes.find((dish) => dish.role === "main");
    expect(replacement?.ingredients[0]?.pantrySelectionId).toBeNull();
  });

  it("G3: strips retained pantryRef when source pantry is absent from current submission", () => {
    const sourceSelectionId = "58000000-0000-4000-8000-000000000077";
    const gonePantryItemId = "61000000-0000-4000-8000-000000000077";
    const menu = makeValidatedMenu({
      dishes: [
        {
          id: dish1Id,
          role: "main",
          position: 1,
          name: "主菜",
          description: "置換",
          cookingTimeMinutes: 20,
          ingredients: [
            {
              id: "53000000-0000-4000-8000-000000000001",
              position: 1,
              name: "鶏肉",
              quantityValue: 200,
              quantityText: "200g",
              unit: "g",
              storeSection: "meat_fish",
              pantrySelectionId: null,
              labelConfirmationRequired: false,
            },
          ],
          steps: [
            {
              id: "51000000-0000-4000-8000-000000000001",
              position: 1,
              instruction: "焼く",
            },
          ],
        },
        {
          id: dish2Id,
          role: "side",
          position: 2,
          name: "副菜",
          description: "保持",
          cookingTimeMinutes: 10,
          ingredients: [
            {
              id: "53000000-0000-4000-8000-000000000002",
              position: 1,
              name: "消えた在庫",
              quantityValue: 1,
              quantityText: "1",
              unit: null,
              storeSection: "other",
              pantrySelectionId: sourceSelectionId,
              labelConfirmationRequired: false,
            },
          ],
          steps: [
            {
              id: "51000000-0000-4000-8000-000000000002",
              position: 1,
              instruction: "和える",
            },
          ],
        },
      ],
      pantryUsage: [
        {
          selectionId: sourceSelectionId,
          pantryItemId: gonePantryItemId,
          pantryItemName: "消えた在庫",
          priority: "prefer_use",
          usageStatus: "used",
          plannedQuantity: null,
          inventoryQuantity: null,
          shortageQuantity: null,
          unit: null,
          dishIds: [dish2Id],
          unusedReason: null,
        },
      ],
    });
    // 現行 submission に gonePantryItemId が無い
    const map = buildPantrySelectionIdToRef(menu, []);
    const retained = toRetainedDishPrompt(menu, dish1Id, map);
    expect(retained.dto[0]?.ingredients[0]?.pantryRef).toBeNull();
  });
});

describe("buildDishRegenerationPrompt label source refs", () => {
  it("resolves timeline and adaptation sourced labels without throwing 500", () => {
    const base = makeValidatedMenu();
    const firstDish = base.dishes[0];
    const firstStep = firstDish?.steps[0];
    const timelineId = base.timeline[0]?.id;
    if (firstDish === undefined || firstStep === undefined || timelineId === undefined) {
      throw new Error("fixture missing dish/step/timeline");
    }
    const adaptationId = "57000000-0000-4000-8000-000000000099";
    const menu = makeValidatedMenu({
      adaptations: [
        {
          id: adaptationId,
          dishId: firstDish.id,
          anonymousMemberRef: "member_1",
          portionText: "通常量",
          branchBeforeRecipeStepId: firstStep.id,
          additionalCutting: null,
          additionalHeating: null,
          additionalSeasoning: null,
          servingCheck: "確認",
          safetyTags: [],
          safetyActions: [],
        },
      ],
      labelConfirmations: [
        {
          sourceType: "timeline",
          sourceId: timelineId,
          sourcePath: "timeline.0.instruction",
          sourceText: base.timeline[0]?.instruction ?? "工程",
          allergenId: "wheat",
          anonymousMemberRef: "member_1",
          dictionaryVersion: "jp-caa-2026-04.v1",
          confirmationStatus: "pending",
          confirmedAt: null,
          confirmedBy: null,
        },
        {
          sourceType: "adaptation",
          sourceId: adaptationId,
          sourcePath: "adaptations.0.portionText",
          sourceText: "通常量",
          allergenId: "egg",
          anonymousMemberRef: "member_1",
          dictionaryVersion: "jp-caa-2026-04.v1",
          confirmationStatus: "pending",
          confirmedAt: null,
          confirmedBy: null,
        },
      ],
    });
    const stored = makeStoredMenu({ menu });
    const retained = toRetainedDishPrompt(menu, firstDish.id);
    const prompt = buildDishRegenerationPrompt({
      command: {
        commandVersion: "generation-command.v3",
        kind: "regenerate_dish",
        qualityMode: false,
        request: {
          sourceMenuId: menu.menuId,
          dishId: firstDish.id,
          idempotencyKey: "82000000-0000-4000-8000-000000000099",
          changeReason: "simpler",
          changeReasonCustom: null,
          privacyNoticeVersion: "2026-07-29.v1",
          expiredPantryConfirmations: [],
        },
      },
      source: stored,
      generationContext: makeGenerationContext(),
      retained,
    });

    const timelineLabel = prompt.sourceLabelConfirmations.find(
      (row) => row.sourceType === "timeline",
    );
    const adaptationLabel = prompt.sourceLabelConfirmations.find(
      (row) => row.sourceType === "adaptation",
    );
    expect(timelineLabel?.sourceRef).toMatch(/^timeline_[1-9][0-9]*$/u);
    expect(adaptationLabel?.sourceRef).toMatch(/^adaptation_[1-9][0-9]*$/u);
  });
});
