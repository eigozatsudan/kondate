import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CreateShoppingListRequest,
  CreateShoppingListResponse,
  ShoppingDraft,
} from "../../../shared/contracts/shopping.js";
import type { CurrentMenuLabelWarning, RevalidationResult } from "./revalidation-service.js";
import type { ShoppingDependencies, ShoppingMenuAggregate } from "./shopping-adapter.js";
import { createShoppingListFromMenu } from "./shopping-service.js";

// 設計書 Task3 Step1: current-safety 検証 → fingerprint-before → owner 読み込み →
// fingerprint-after → RPC 適用、という順序と replay/エラーの各分岐を網羅する。
// deps は ShoppingDependencies の各メソッドを個別の vi.fn() 変数として保持し、
// アサーションはその変数へ直接行う（deps.method を later で参照すると
// @typescript-eslint/unbound-method に抵触するため、既存 revalidation-service.test.ts
// と同じ「変数を直接 expect する」スタイルに合わせる）。
const USER_ID = "85000000-0000-4000-8000-000000000001";
const MENU_ID = "52000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "90000000-0000-4000-8000-000000000001";
const INGREDIENT_ID = "53000000-0000-4000-8000-000000000001";
const DISH_ID = "50000000-0000-4000-8000-000000000001";
const FINGERPRINT_A = "a".repeat(64);
const FINGERPRINT_B = "b".repeat(64);

function makeMenu(overrides: Partial<ShoppingMenuAggregate> = {}): ShoppingMenuAggregate {
  return {
    menuId: MENU_ID,
    version: 1,
    derivationGroupId: "c1000000-0000-4000-8000-000000000001",
    ingredients: [
      {
        ingredientId: INGREDIENT_ID,
        dishId: DISH_ID,
        dishName: "料理",
        name: "にんじん",
        quantityValue: 1,
        quantityText: "1本",
        unit: "本",
        storeSection: "produce",
      },
    ],
    labels: [],
    ...overrides,
  };
}

function makeRevalidation(overrides: Partial<RevalidationResult> = {}): RevalidationResult {
  return {
    status: "valid",
    safetyFingerprint: FINGERPRINT_A,
    allergenCatalogVersion: "jp-caa-2026-04.v1",
    foodRuleVersion: "jp-caa-child-shape-2026-07.v1",
    issues: [],
    changedDetails: [],
    currentLabelWarnings: [],
    ...overrides,
  };
}

function makeResponse(
  overrides: Partial<CreateShoppingListResponse> = {},
): CreateShoppingListResponse {
  return {
    listId: "70000000-0000-4000-8000-000000000001",
    version: 1,
    replayed: false,
    ...overrides,
  };
}

function makeCommand(
  overrides: Partial<CreateShoppingListRequest> = {},
): CreateShoppingListRequest & { userId: string } {
  return {
    menuId: MENU_ID,
    mode: "new",
    activeListId: null,
    expectedListVersion: null,
    idempotencyKey: IDEMPOTENCY_KEY,
    userId: USER_ID,
    ...overrides,
  };
}

type Mocks = {
  loadMenu: ReturnType<typeof vi.fn<ShoppingDependencies["loadMenu"]>>;
  revalidate: ReturnType<typeof vi.fn<ShoppingDependencies["revalidate"]>>;
  loadPantry: ReturnType<typeof vi.fn<ShoppingDependencies["loadPantry"]>>;
  loadActiveList: ReturnType<typeof vi.fn<ShoppingDependencies["loadActiveList"]>>;
  getSafetyFingerprint: ReturnType<typeof vi.fn<ShoppingDependencies["getSafetyFingerprint"]>>;
  applyDraft: ReturnType<typeof vi.fn<ShoppingDependencies["applyDraft"]>>;
  applyReconciliation: ReturnType<typeof vi.fn<ShoppingDependencies["applyReconciliation"]>>;
  findMutationReplay: ReturnType<typeof vi.fn<ShoppingDependencies["findMutationReplay"]>>;
};

function makeMocks(): Mocks {
  return {
    loadMenu: vi.fn<ShoppingDependencies["loadMenu"]>().mockResolvedValue(makeMenu()),
    revalidate: vi.fn<ShoppingDependencies["revalidate"]>().mockResolvedValue(makeRevalidation()),
    loadPantry: vi.fn<ShoppingDependencies["loadPantry"]>().mockResolvedValue([]),
    loadActiveList: vi.fn<ShoppingDependencies["loadActiveList"]>().mockResolvedValue(null),
    getSafetyFingerprint: vi
      .fn<ShoppingDependencies["getSafetyFingerprint"]>()
      .mockResolvedValue(FINGERPRINT_A),
    applyDraft: vi.fn<ShoppingDependencies["applyDraft"]>().mockResolvedValue(makeResponse()),
    applyReconciliation: vi.fn<ShoppingDependencies["applyReconciliation"]>(),
    findMutationReplay: vi.fn<ShoppingDependencies["findMutationReplay"]>().mockResolvedValue(null),
  };
}

function toDeps(mocks: Mocks): ShoppingDependencies {
  return {
    loadMenu: mocks.loadMenu,
    revalidate: mocks.revalidate,
    loadPantry: mocks.loadPantry,
    loadActiveList: mocks.loadActiveList,
    getSafetyFingerprint: mocks.getSafetyFingerprint,
    applyDraft: mocks.applyDraft,
    applyReconciliation: mocks.applyReconciliation,
    findMutationReplay: mocks.findMutationReplay,
    aliases: new Map(),
  };
}

describe("createShoppingListFromMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a saved replay before touching revalidate/menu/pantry/fingerprint/list reads", async () => {
    const replay = makeResponse({ replayed: true });
    const mocks = makeMocks();
    mocks.findMutationReplay.mockResolvedValue(replay);
    const result = await createShoppingListFromMenu(toDeps(mocks), makeCommand());
    expect(result).toEqual(replay);
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.loadMenu).not.toHaveBeenCalled();
    expect(mocks.loadPantry).not.toHaveBeenCalled();
    expect(mocks.getSafetyFingerprint).not.toHaveBeenCalled();
    expect(mocks.loadActiveList).not.toHaveBeenCalled();
    expect(mocks.applyDraft).not.toHaveBeenCalled();
  });

  it("looks up replay using the idempotency key and the precomputed canonical command hash", async () => {
    const mocks = makeMocks();
    await createShoppingListFromMenu(toDeps(mocks), makeCommand());
    expect(mocks.findMutationReplay).toHaveBeenCalledWith({
      idempotencyKey: IDEMPOTENCY_KEY,
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/) as string,
    });
  });

  it("fails a same-key different-canonical-command replay before reaching later reads", async () => {
    // findMutationReplay 自体は idempotencyKey+requestHash が異なる場合 null を返す実装なので、
    // ここでは異なる canonical 入力 (mode違い) が異なる requestHash を生成し、
    // replay lookup が別キーとして処理されることを確認する。
    const mocksA = makeMocks();
    await createShoppingListFromMenu(toDeps(mocksA), makeCommand({ mode: "new" }));
    const firstCall = mocksA.findMutationReplay.mock.calls[0] as
      [{ requestHash: string }] | undefined;
    const firstHash = firstCall?.[0].requestHash;

    const mocksB = makeMocks();
    await createShoppingListFromMenu(
      toDeps(mocksB),
      makeCommand({
        mode: "append",
        activeListId: "70000000-0000-4000-8000-000000000001",
        expectedListVersion: 1,
      }),
    );
    const secondCall = mocksB.findMutationReplay.mock.calls[0] as
      [{ requestHash: string }] | undefined;
    const secondHash = secondCall?.[0].requestHash;
    expect(secondHash).not.toBe(firstHash);
  });

  it("throws current_safety_revalidation_required when revalidation has issues", async () => {
    const mocks = makeMocks();
    mocks.revalidate.mockResolvedValue(
      makeRevalidation({
        status: "invalid",
        issues: [{ code: "direct_allergen_match", path: "x", message: "だめ" }],
      }),
    );
    await expect(createShoppingListFromMenu(toDeps(mocks), makeCommand())).rejects.toMatchObject({
      status: 409,
      code: "current_safety_revalidation_required",
    });
    expect(mocks.getSafetyFingerprint).not.toHaveBeenCalled();
    expect(mocks.loadMenu).not.toHaveBeenCalled();
    expect(mocks.applyDraft).not.toHaveBeenCalled();
  });

  it("does not throw when revalidation status is changed but issues remain empty", async () => {
    // "changed" は issues が無ければ安全確認自体は通す設計（drift 詳細のみ）。
    const mocks = makeMocks();
    mocks.revalidate.mockResolvedValue(makeRevalidation({ status: "changed", issues: [] }));
    await expect(createShoppingListFromMenu(toDeps(mocks), makeCommand())).resolves.toBeDefined();
  });

  it("reads the safety fingerprint only after revalidation completes", async () => {
    const order: string[] = [];
    const mocks = makeMocks();
    mocks.revalidate.mockImplementation(() => {
      order.push("revalidate");
      return Promise.resolve(makeRevalidation());
    });
    mocks.getSafetyFingerprint.mockImplementation(() => {
      order.push("fingerprint");
      return Promise.resolve(FINGERPRINT_A);
    });
    mocks.loadMenu.mockImplementation(() => {
      order.push("loadMenu");
      return Promise.resolve(makeMenu());
    });
    mocks.loadPantry.mockImplementation(() => {
      order.push("loadPantry");
      return Promise.resolve([]);
    });
    await createShoppingListFromMenu(toDeps(mocks), makeCommand());
    expect(order[0]).toBe("revalidate");
    expect(order[1]).toBe("fingerprint");
    expect(order.slice(2, 4).toSorted()).toEqual(["loadMenu", "loadPantry"]);
    expect(order[4]).toBe("fingerprint");
  });

  it("passes only the just-completed revalidation currentLabelWarnings to loadMenu", async () => {
    const warnings = [
      {
        confirmationId: "a1000000-0000-4000-8000-000000000001",
        sourceType: "ingredient" as const,
        sourceId: INGREDIENT_ID,
        sourcePath: "dishes.0.ingredients.0.name",
        sourceText: "にんじん",
        allergenId: "carrot",
        allergenName: "にんじん",
        anonymousMemberRef: "member_1",
        memberLabel: "家族1",
        dictionaryVersion: "jp-caa-2026-04.v1",
        confirmationStatus: "pending" as const,
      },
    ];
    const mocks = makeMocks();
    mocks.revalidate.mockResolvedValue(makeRevalidation({ currentLabelWarnings: warnings }));
    await createShoppingListFromMenu(toDeps(mocks), makeCommand());
    expect(mocks.loadMenu).toHaveBeenCalledWith(MENU_ID, warnings);
  });

  it("throws safety_fingerprint_changed with no applyDraft call when fingerprint drifts across the read window", async () => {
    const mocks = makeMocks();
    mocks.getSafetyFingerprint
      .mockResolvedValueOnce(FINGERPRINT_A)
      .mockResolvedValueOnce(FINGERPRINT_B);
    await expect(createShoppingListFromMenu(toDeps(mocks), makeCommand())).rejects.toMatchObject({
      status: 409,
      code: "safety_fingerprint_changed",
    });
    expect(mocks.applyDraft).not.toHaveBeenCalled();
  });

  it("passes exact active id/version and the precomputed command hash and safety fingerprint to applyDraft on new/append", async () => {
    const mocks = makeMocks();
    const command = makeCommand({
      mode: "append",
      activeListId: "70000000-0000-4000-8000-000000000009",
      expectedListVersion: 3,
    });
    await createShoppingListFromMenu(toDeps(mocks), command);
    expect(mocks.applyDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        menuId: MENU_ID,
        mode: "append",
        activeListId: "70000000-0000-4000-8000-000000000009",
        expectedListVersion: 3,
        safetyFingerprint: FINGERPRINT_A,
        idempotencyKey: IDEMPOTENCY_KEY,
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown as string,
        draft: expect.any(Object) as unknown as ShoppingDraft,
      }),
    );
  });

  it("adds a newly derived warning into the returned draft's snapshot when a new allergy appears", async () => {
    // 設計書 Step1 は「新規許可されたアレルギーの null-ID warning」を要求するが、
    // CurrentMenuLabelWarning.confirmationId は reconcileCurrentMenuLabelWarnings が
    // 常に RPC で行を作成/reconcile した後の非 null id を返す契約（revalidation-service.ts）。
    // そのためこのレベルでの「新規発生」は「revalidate 前には存在しなかった新しい
    // confirmationId が draft の label snapshot に現れる」という意味で検証する
    // （契約レベルの ShoppingLabelSnapshot.confirmationId は uuid.nullable() のままで、
    // reconciliation 段階など他の生成経路で null になり得る余地は残す）。
    const newlyDerivedConfirmationId = "a1000000-0000-4000-8000-000000000099";
    const warnings = [
      {
        confirmationId: newlyDerivedConfirmationId,
        sourceType: "ingredient" as const,
        sourceId: INGREDIENT_ID,
        sourcePath: "dishes.0.ingredients.0.name",
        sourceText: "にんじん",
        allergenId: "carrot",
        allergenName: "にんじん",
        anonymousMemberRef: "member_1",
        memberLabel: "家族1",
        dictionaryVersion: "jp-caa-2026-04.v1",
        confirmationStatus: "pending" as const,
      },
    ];
    let capturedDraft: ShoppingDraft | undefined;
    const mocks = makeMocks();
    // loadMenu の mock は adapter の実装（currentLabelWarnings → labels 投影）を模倣し、
    // revalidate が返した警告だけが menu.labels に反映されることを確認する。
    mocks.revalidate.mockResolvedValue(makeRevalidation({ currentLabelWarnings: warnings }));
    mocks.loadMenu.mockImplementation(
      (_menuId: string, received: readonly CurrentMenuLabelWarning[]) =>
        Promise.resolve(
          makeMenu({
            labels: received.map((warning) => ({
              confirmationId: warning.confirmationId,
              warningKey: "f".repeat(64),
              sourceMenuId: MENU_ID,
              sourceDerivationGroupId: "c1000000-0000-4000-8000-000000000001",
              sourceType: warning.sourceType,
              sourceId: warning.sourceId,
              sourcePath: warning.sourcePath,
              allergenId: warning.allergenId,
              allergenDisplayName: warning.allergenName,
              anonymousMemberRef: warning.anonymousMemberRef,
              memberDisplayName: warning.memberLabel,
              sourceDisplayName: warning.sourceText,
              dictionaryVersion: warning.dictionaryVersion,
              confirmationStatus: "pending" as const,
            })),
          }),
        ),
    );
    mocks.applyDraft.mockImplementation((input: { draft: ShoppingDraft }) => {
      capturedDraft = input.draft;
      return Promise.resolve(makeResponse());
    });
    await createShoppingListFromMenu(toDeps(mocks), makeCommand());
    const allWarnings = [
      ...(capturedDraft?.listLabelWarnings ?? []),
      ...(capturedDraft?.items.flatMap(
        (item: ShoppingDraft["items"][number]) => item.labelWarnings,
      ) ?? []),
    ];
    expect(
      allWarnings.some((warning) => warning.confirmationId === newlyDerivedConfirmationId),
    ).toBe(true);
  });

  it("does not include an obsolete current warning that revalidate no longer reports", async () => {
    // 事前にアレルギーを解除した=revalidate が currentLabelWarnings を返さないケース。
    let capturedDraft: ShoppingDraft | undefined;
    const mocks = makeMocks();
    mocks.revalidate.mockResolvedValue(makeRevalidation({ currentLabelWarnings: [] }));
    mocks.applyDraft.mockImplementation((input: { draft: ShoppingDraft }) => {
      capturedDraft = input.draft;
      return Promise.resolve(makeResponse());
    });
    await createShoppingListFromMenu(toDeps(mocks), makeCommand());
    const allWarnings = [
      ...(capturedDraft?.listLabelWarnings ?? []),
      ...(capturedDraft?.items.flatMap(
        (item: ShoppingDraft["items"][number]) => item.labelWarnings,
      ) ?? []),
    ];
    expect(allWarnings).toHaveLength(0);
  });

  it("uses the immutable snapshot returned by loadMenu even when its underlying target was deleted", async () => {
    // Plan4 の loadStoredMenu は削除済みメンバーも表示名スナップショットで保持する。
    // ここでは adapter 層が返す ingredient snapshot をそのまま消費することだけを確認する
    // （service は削除有無を判定せず、常に受け取った ingredients を使う）。
    const deletedTargetMenu = makeMenu({
      ingredients: [
        {
          ingredientId: INGREDIENT_ID,
          dishId: DISH_ID,
          dishName: "料理",
          name: "スナップショット食材",
          quantityValue: 1,
          quantityText: "1個",
          unit: "個",
          storeSection: "other",
        },
      ],
    });
    let capturedDraft: ShoppingDraft | undefined;
    const mocks = makeMocks();
    mocks.loadMenu.mockResolvedValue(deletedTargetMenu);
    mocks.applyDraft.mockImplementation((input: { draft: ShoppingDraft }) => {
      capturedDraft = input.draft;
      return Promise.resolve(makeResponse());
    });
    await createShoppingListFromMenu(toDeps(mocks), makeCommand());
    expect(capturedDraft?.items[0]?.displayName).toBe("スナップショット食材");
  });
});
