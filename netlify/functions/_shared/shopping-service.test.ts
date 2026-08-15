import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  shoppingItemsMax,
  type CreateShoppingListRequest,
  type CreateShoppingListResponse,
  type CurrentShoppingLabelWarning,
  type ReconcileShoppingListRequest,
  type ShoppingDraft,
  type ShoppingLabelSnapshot,
  type ShoppingList,
} from "../../../shared/contracts/shopping.js";
import { HttpError } from "./http.js";
import type { CurrentMenuLabelWarning, RevalidationResult } from "./revalidation-service.js";
import type {
  ActiveShoppingSource,
  ShoppingDependencies,
  ShoppingMenuAggregate,
} from "./shopping-adapter.js";
import { snapshotPreviewedQuantities } from "../../../shared/shopping/previewed-quantities.js";
import {
  createReconciliationRequestHash,
  createShoppingListFromMenu,
  previewShoppingListDiff,
  reconcileShoppingList,
  revalidateActiveShoppingList,
} from "./shopping-service.js";

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
  loadMenuIdentity: ReturnType<typeof vi.fn<ShoppingDependencies["loadMenuIdentity"]>>;
  loadMenu: ReturnType<typeof vi.fn<ShoppingDependencies["loadMenu"]>>;
  revalidate: ReturnType<typeof vi.fn<ShoppingDependencies["revalidate"]>>;
  loadPantry: ReturnType<typeof vi.fn<ShoppingDependencies["loadPantry"]>>;
  loadActiveList: ReturnType<typeof vi.fn<ShoppingDependencies["loadActiveList"]>>;
  getSafetyFingerprint: ReturnType<typeof vi.fn<ShoppingDependencies["getSafetyFingerprint"]>>;
  applyDraft: ReturnType<typeof vi.fn<ShoppingDependencies["applyDraft"]>>;
  applyReconciliation: ReturnType<typeof vi.fn<ShoppingDependencies["applyReconciliation"]>>;
  findMutationReplay: ReturnType<typeof vi.fn<ShoppingDependencies["findMutationReplay"]>>;
  loadActiveListSources: ReturnType<typeof vi.fn<ShoppingDependencies["loadActiveListSources"]>>;
  getListSafetyFingerprint: ReturnType<
    typeof vi.fn<ShoppingDependencies["getListSafetyFingerprint"]>
  >;
  replaceCurrentSafetyProjection: ReturnType<
    typeof vi.fn<ShoppingDependencies["replaceCurrentSafetyProjection"]>
  >;
};

function makeMocks(): Mocks {
  return {
    loadMenuIdentity: vi.fn<ShoppingDependencies["loadMenuIdentity"]>().mockResolvedValue({
      id: MENU_ID,
      userId: USER_ID,
      version: 1,
      targetMode: "household",
    }),
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
    loadActiveListSources: vi
      .fn<ShoppingDependencies["loadActiveListSources"]>()
      .mockResolvedValue([]),
    getListSafetyFingerprint: vi
      .fn<ShoppingDependencies["getListSafetyFingerprint"]>()
      .mockResolvedValue(FINGERPRINT_A),
    replaceCurrentSafetyProjection: vi
      .fn<ShoppingDependencies["replaceCurrentSafetyProjection"]>()
      .mockResolvedValue({
        listId: LIST_ID,
        safetyFingerprint: FINGERPRINT_A,
        currentLabelWarnings: [],
      }),
  };
}

function toDeps(mocks: Mocks): ShoppingDependencies {
  return {
    loadMenuIdentity: mocks.loadMenuIdentity,
    loadMenu: mocks.loadMenu,
    revalidate: mocks.revalidate,
    loadPantry: mocks.loadPantry,
    loadActiveList: mocks.loadActiveList,
    getSafetyFingerprint: mocks.getSafetyFingerprint,
    applyDraft: mocks.applyDraft,
    applyReconciliation: mocks.applyReconciliation,
    findMutationReplay: mocks.findMutationReplay,
    loadActiveListSources: mocks.loadActiveListSources,
    getListSafetyFingerprint: mocks.getListSafetyFingerprint,
    replaceCurrentSafetyProjection: mocks.replaceCurrentSafetyProjection,
    aliases: new Map(),
  };
}

describe("createShoppingListFromMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a saved replay only after live safety revalidation still passes", async () => {
    // SHOP1: 30 日 replay でも revalidate / pantry / fingerprint を再実行し、
    // 現行 safety が通るときだけ保存済み応答を返す。
    const replay = makeResponse({ replayed: true });
    const mocks = makeMocks();
    mocks.findMutationReplay.mockResolvedValue(replay);
    mocks.loadActiveList.mockResolvedValue({
      id: replay.listId,
      status: "active",
      version: 1,
      items: [],
      listLabelWarnings: [],
    });
    mocks.loadActiveListSources.mockResolvedValue([
      {
        menuId: MENU_ID,
        sourceMenuIdSnapshot: MENU_ID,
        sourceMenuVersion: 1,
        sourceDerivationGroupId: "c1000000-0000-4000-8000-000000000001",
        itemSources: [],
      },
    ]);
    const result = await createShoppingListFromMenu(toDeps(mocks), makeCommand());
    expect(result).toEqual(replay);
    expect(mocks.revalidate).toHaveBeenCalled();
    expect(mocks.loadMenu).toHaveBeenCalled();
    expect(mocks.loadPantry).toHaveBeenCalled();
    expect(mocks.getSafetyFingerprint).toHaveBeenCalled();
    expect(mocks.loadActiveList).toHaveBeenCalledWith(replay.listId);
    expect(mocks.applyDraft).not.toHaveBeenCalled();
  });

  it("rejects a saved replay when live safety revalidation fails", async () => {
    const replay = makeResponse({ replayed: true });
    const mocks = makeMocks();
    mocks.findMutationReplay.mockResolvedValue(replay);
    // 世帯 invalid は list が残っている前提。不在は 404 側（SHOP3）で分ける。
    mocks.loadActiveList.mockResolvedValue({
      id: replay.listId,
      status: "active",
      version: 1,
      items: [],
      listLabelWarnings: [],
    });
    mocks.loadActiveListSources.mockResolvedValue([
      {
        menuId: MENU_ID,
        sourceMenuIdSnapshot: MENU_ID,
        sourceMenuVersion: 1,
        sourceDerivationGroupId: "c1000000-0000-4000-8000-000000000001",
        itemSources: [],
      },
    ]);
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
    expect(mocks.applyDraft).not.toHaveBeenCalled();
  });

  it("rejects a saved replay with shopping_list_not_found when the active list is gone (SHOP3)", async () => {
    // create 成功後に応答ロスト、別タブが別 key の mode=new で archive すると
    // loadActiveList は null。409 current_safety に畳むと sticky が TTL まで残る。
    const replay = makeResponse({ replayed: true });
    const mocks = makeMocks();
    mocks.findMutationReplay.mockResolvedValue(replay);
    mocks.loadActiveList.mockResolvedValue(null);
    await expect(createShoppingListFromMenu(toDeps(mocks), makeCommand())).rejects.toMatchObject({
      status: 404,
      code: "shopping_list_not_found",
    });
    expect(mocks.applyDraft).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
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

  it("replays after list_version_conflict when the same key+hash mutation already exists (SHOP3)", async () => {
    // 並行 create: 初回 find は miss、apply が version 競合、勝者が書いた mutation を再読して 200
    const mocks = makeMocks();
    const concurrentReplay = makeResponse({ version: 4, replayed: true });
    mocks.findMutationReplay.mockResolvedValueOnce(null).mockResolvedValueOnce(concurrentReplay);
    mocks.applyDraft.mockRejectedValue(
      new HttpError(409, "list_version_conflict", "買い物リストが更新されました"),
    );
    mocks.loadActiveList.mockResolvedValue({
      id: concurrentReplay.listId,
      status: "active",
      version: 4,
      items: [],
      listLabelWarnings: [],
    });
    mocks.loadActiveListSources.mockResolvedValue([
      {
        menuId: MENU_ID,
        sourceMenuIdSnapshot: MENU_ID,
        sourceMenuVersion: 1,
        sourceDerivationGroupId: "c1000000-0000-4000-8000-000000000001",
        itemSources: [],
      },
    ]);
    await expect(createShoppingListFromMenu(toDeps(mocks), makeCommand())).resolves.toEqual(
      concurrentReplay,
    );
    expect(mocks.findMutationReplay).toHaveBeenCalledTimes(2);
    expect(mocks.applyDraft).toHaveBeenCalledTimes(1);
  });

  it("keeps list_version_conflict when no same-key mutation exists after apply failure", async () => {
    // 真の stale version（並行勝者なし）は 409 のまま
    const mocks = makeMocks();
    mocks.findMutationReplay.mockResolvedValue(null);
    mocks.applyDraft.mockRejectedValue(
      new HttpError(409, "list_version_conflict", "買い物リストが更新されました"),
    );
    await expect(createShoppingListFromMenu(toDeps(mocks), makeCommand())).rejects.toMatchObject({
      status: 409,
      code: "list_version_conflict",
    });
    expect(mocks.findMutationReplay).toHaveBeenCalledTimes(2);
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

  it("revalidates all active list sources before append (SHOP2)", async () => {
    const OTHER_MENU = "52000000-0000-4000-8000-000000000099";
    const mocks = makeMocks();
    mocks.loadActiveListSources.mockResolvedValue([
      {
        menuId: OTHER_MENU,
        sourceMenuIdSnapshot: OTHER_MENU,
        sourceMenuVersion: 1,
        sourceDerivationGroupId: "c1000000-0000-4000-8000-000000000099",
        itemSources: [],
      },
    ]);
    mocks.loadMenuIdentity.mockImplementation((menuId) =>
      Promise.resolve({
        id: menuId,
        userId: USER_ID,
        version: 1,
        targetMode: "household" as const,
      }),
    );
    // 既存 source が invalid なら append しない
    mocks.revalidate.mockImplementation((menuId) => {
      if (menuId === OTHER_MENU) {
        return Promise.resolve(
          makeRevalidation({
            status: "invalid",
            issues: [{ code: "direct_allergen_match", path: "x", message: "だめ" }],
          }),
        );
      }
      return Promise.resolve(makeRevalidation());
    });
    await expect(
      createShoppingListFromMenu(
        toDeps(mocks),
        makeCommand({
          mode: "append",
          activeListId: "70000000-0000-4000-8000-000000000001",
          expectedListVersion: 1,
        }),
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "current_safety_revalidation_required",
    });
    expect(mocks.applyDraft).not.toHaveBeenCalled();
    expect(mocks.revalidate).toHaveBeenCalledWith(OTHER_MENU);
  });

  it("passes captured live-source fingerprints to applyDraft (SHOP6)", async () => {
    const OTHER_MENU = "52000000-0000-4000-8000-000000000099";
    const mocks = makeMocks();
    mocks.loadActiveListSources.mockResolvedValue([
      {
        menuId: OTHER_MENU,
        sourceMenuIdSnapshot: OTHER_MENU,
        sourceMenuVersion: 1,
        sourceDerivationGroupId: "c1000000-0000-4000-8000-000000000099",
        itemSources: [],
      },
    ]);
    mocks.loadMenuIdentity.mockImplementation((menuId) =>
      Promise.resolve({
        id: menuId,
        userId: USER_ID,
        version: 1,
        targetMode: "household" as const,
      }),
    );
    mocks.getSafetyFingerprint.mockImplementation((menuId) =>
      Promise.resolve(menuId === OTHER_MENU ? FINGERPRINT_B : FINGERPRINT_A),
    );
    await createShoppingListFromMenu(
      toDeps(mocks),
      makeCommand({
        mode: "append",
        activeListId: "70000000-0000-4000-8000-000000000001",
        expectedListVersion: 1,
      }),
    );
    expect(mocks.applyDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSafetyFingerprints: { [OTHER_MENU]: FINGERPRINT_B },
      }),
    );
  });

  it("rejects append when another live source fingerprint drifts during assert (SHOP6)", async () => {
    const OTHER_MENU = "52000000-0000-4000-8000-000000000099";
    const mocks = makeMocks();
    mocks.loadActiveListSources.mockResolvedValue([
      {
        menuId: OTHER_MENU,
        sourceMenuIdSnapshot: OTHER_MENU,
        sourceMenuVersion: 1,
        sourceDerivationGroupId: "c1000000-0000-4000-8000-000000000099",
        itemSources: [],
      },
    ]);
    mocks.loadMenuIdentity.mockImplementation((menuId) =>
      Promise.resolve({
        id: menuId,
        userId: USER_ID,
        version: 1,
        targetMode: "household" as const,
      }),
    );
    let otherSourceReads = 0;
    mocks.getSafetyFingerprint.mockImplementation((menuId) => {
      if (menuId !== OTHER_MENU) return Promise.resolve(FINGERPRINT_A);
      otherSourceReads += 1;
      return Promise.resolve(otherSourceReads === 1 ? FINGERPRINT_A : FINGERPRINT_B);
    });
    await expect(
      createShoppingListFromMenu(
        toDeps(mocks),
        makeCommand({
          mode: "append",
          activeListId: "70000000-0000-4000-8000-000000000001",
          expectedListVersion: 1,
        }),
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "safety_fingerprint_changed",
    });
    expect(mocks.applyDraft).not.toHaveBeenCalled();
  });

  it("rejects append that would exceed shoppingItemsMax (SHOP5)", async () => {
    const mocks = makeMocks();
    mocks.loadActiveList.mockResolvedValue({
      id: "70000000-0000-4000-8000-000000000001",
      status: "active",
      version: 1,
      items: Array.from({ length: shoppingItemsMax }, (_, index) => ({
        id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        listId: "70000000-0000-4000-8000-000000000001",
        displayName: "手追加",
        normalizedName: "手追加",
        storeSection: "other" as const,
        quantityValue: 1,
        quantityText: "1個",
        unit: "個",
        isChecked: false,
        isManual: true,
        isManuallyEdited: false,
        isRemovedByUser: false,
        pantryCheckRequired: false,
        labelWarnings: [],
      })),
      listLabelWarnings: [],
    });
    await expect(
      createShoppingListFromMenu(
        toDeps(mocks),
        makeCommand({
          mode: "append",
          activeListId: "70000000-0000-4000-8000-000000000001",
          expectedListVersion: 1,
        }),
      ),
    ).rejects.toMatchObject({
      status: 422,
      code: "shopping_items_limit_exceeded",
    });
    expect(mocks.applyDraft).not.toHaveBeenCalled();
  });

  it("rejects append when same lineage is already on the active list (SHOP4)", async () => {
    // 同 derivation group の旧版が list にあると append は二重行になる → reconcile へ誘導
    const mocks = makeMocks();
    mocks.loadActiveListSources.mockResolvedValue([
      {
        menuId: "52000000-0000-4000-8000-0000000000aa",
        sourceMenuIdSnapshot: "52000000-0000-4000-8000-0000000000aa",
        sourceMenuVersion: 1,
        sourceDerivationGroupId: "c1000000-0000-4000-8000-000000000001",
        itemSources: [],
      },
    ]);
    await expect(
      createShoppingListFromMenu(
        toDeps(mocks),
        makeCommand({
          mode: "append",
          activeListId: "70000000-0000-4000-8000-000000000001",
          expectedListVersion: 1,
        }),
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "reconcile_required",
    });
    expect(mocks.applyDraft).not.toHaveBeenCalled();
  });

  it("revalidates live safety after SQL early-replay success (SHOP1)", async () => {
    // applyDraft が replayed:true を返したら service が post-assert する
    const mocks = makeMocks();
    const earlyReplay = makeResponse({ replayed: true, version: 4 });
    mocks.applyDraft.mockResolvedValue(earlyReplay);
    mocks.loadActiveList.mockResolvedValue({
      id: earlyReplay.listId,
      status: "active",
      version: 4,
      items: [],
      listLabelWarnings: [],
    });
    mocks.loadActiveListSources.mockResolvedValue([
      {
        menuId: MENU_ID,
        sourceMenuIdSnapshot: MENU_ID,
        sourceMenuVersion: 1,
        sourceDerivationGroupId: "c1000000-0000-4000-8000-000000000001",
        itemSources: [],
      },
    ]);
    await expect(createShoppingListFromMenu(toDeps(mocks), makeCommand())).resolves.toEqual(
      earlyReplay,
    );
    expect(mocks.applyDraft).toHaveBeenCalledTimes(1);
    // post-assert で list / live source / validatedDraft 経路が走る
    expect(mocks.loadActiveList).toHaveBeenCalledWith(earlyReplay.listId);
    expect(mocks.revalidate).toHaveBeenCalled();
  });

  it("rejects SQL early-replay when live safety no longer passes (SHOP1)", async () => {
    const mocks = makeMocks();
    mocks.applyDraft.mockResolvedValue(makeResponse({ replayed: true }));
    mocks.loadActiveList.mockResolvedValue({
      id: "70000000-0000-4000-8000-000000000001",
      status: "active",
      version: 1,
      items: [],
      listLabelWarnings: [],
    });
    mocks.loadActiveListSources.mockResolvedValue([
      {
        menuId: MENU_ID,
        sourceMenuIdSnapshot: MENU_ID,
        sourceMenuVersion: 1,
        sourceDerivationGroupId: "c1000000-0000-4000-8000-000000000001",
        itemSources: [],
      },
    ]);
    // apply 前の validatedDraft は通す。post-assert の revalidate だけ invalid にする
    let revalidateCalls = 0;
    mocks.revalidate.mockImplementation(() => {
      revalidateCalls += 1;
      if (revalidateCalls >= 2) {
        return Promise.resolve(
          makeRevalidation({
            status: "invalid",
            issues: [{ code: "direct_allergen_match", path: "x", message: "だめ" }],
          }),
        );
      }
      return Promise.resolve(makeRevalidation());
    });
    await expect(createShoppingListFromMenu(toDeps(mocks), makeCommand())).rejects.toMatchObject({
      status: 409,
      code: "current_safety_revalidation_required",
    });
  });
});

// --- 設計書 Task4: preview / revalidate / reconcile ---------------------------------
// Task4 で追加される三つの経路（差分プレビュー、買い物リスト単位の現行安全性再検証、
// 承認済み差分の整合適用）を、ShoppingDependencies を丸ごと差し替えられる
// makeShoppingDependencies fixture で検証する。Task3 の makeMocks/toDeps は
// 「個別の vi.fn 変数を直接 expect する」形だが、設計書 Task4 が verbatim で
// 供給するテストは deps オブジェクト経由で expect するため、両方を併存させる。

const LIST_ID = "70000000-0000-4000-8000-000000000001";
const OTHER_LIST_ID = "70000000-0000-4000-8000-000000000002";
const ITEM_ID = "71000000-0000-4000-8000-000000000001";
const OTHER_ITEM_ID = "71000000-0000-4000-8000-000000000002";
const MENU_A = "52000000-0000-4000-8000-00000000000a";
const MENU_B = "52000000-0000-4000-8000-00000000000b";
const GROUP_A = "c1000000-0000-4000-8000-00000000000a";
const GROUP_B = "c1000000-0000-4000-8000-00000000000b";
const INGREDIENT_A = "53000000-0000-4000-8000-00000000000a";
const INGREDIENT_B = "53000000-0000-4000-8000-00000000000b";

function makeList(overrides: Partial<ShoppingList> = {}): ShoppingList {
  return {
    id: LIST_ID,
    status: "active",
    version: 3,
    items: [],
    listLabelWarnings: [],
    ...overrides,
  };
}

function makeSource(overrides: Partial<ActiveShoppingSource> = {}): ActiveShoppingSource {
  return {
    menuId: MENU_A,
    sourceMenuIdSnapshot: MENU_A,
    sourceMenuVersion: 1,
    sourceDerivationGroupId: GROUP_A,
    itemSources: [],
    ...overrides,
  };
}

function makeMenuWarning(
  overrides: Partial<CurrentMenuLabelWarning> = {},
): CurrentMenuLabelWarning {
  return {
    confirmationId: "a1000000-0000-4000-8000-000000000001",
    sourceType: "ingredient",
    sourceId: INGREDIENT_A,
    sourcePath: "dishes.0.ingredients.0.name",
    sourceText: "カレールー",
    allergenId: "wheat",
    allergenName: "小麦",
    anonymousMemberRef: "member_1",
    memberLabel: "子ども",
    dictionaryVersion: "jp-caa-2026-04.v1",
    confirmationStatus: "pending",
    ...overrides,
  };
}

function makeCurrentWarning(
  overrides: Partial<CurrentShoppingLabelWarning> = {},
): CurrentShoppingLabelWarning {
  return {
    itemId: null,
    warningKey: "b".repeat(64),
    sourceMenuId: MENU_B,
    sourceDerivationGroupId: GROUP_B,
    sourceType: "ingredient",
    sourceId: INGREDIENT_A,
    sourcePath: "dishes.0.ingredients.0.name",
    sourceDisplayName: "カレールー",
    allergenId: "wheat",
    allergenDisplayName: "小麦",
    anonymousMemberRef: "member_1",
    memberDisplayName: "子ども",
    dictionaryVersion: "jp-caa-2026-04.v1",
    ...overrides,
  };
}

function makeShoppingDependencies(
  overrides: Partial<ShoppingDependencies> = {},
): ShoppingDependencies {
  return {
    ...toDeps(makeMocks()),
    // 既定は lineage 済み + 空 items + 食材 draft → pure add が pending。
    // SHOP3/SHOP5 後、RPC 到達テストは approval を付ける。空系は個別で固定。
    loadMenu: vi.fn<ShoppingDependencies["loadMenu"]>().mockResolvedValue(makeMenu()),
    loadActiveList: vi.fn<ShoppingDependencies["loadActiveList"]>().mockResolvedValue(makeList()),
    loadActiveListSources: vi
      .fn<ShoppingDependencies["loadActiveListSources"]>()
      .mockResolvedValue([
        makeSource({
          menuId: MENU_ID,
          sourceMenuIdSnapshot: MENU_ID,
          sourceDerivationGroupId: "c1000000-0000-4000-8000-000000000001",
          itemSources: [],
        }),
      ]),
    getListSafetyFingerprint: vi
      .fn<ShoppingDependencies["getListSafetyFingerprint"]>()
      .mockResolvedValue(FINGERPRINT_A),
    replaceCurrentSafetyProjection: vi
      .fn<ShoppingDependencies["replaceCurrentSafetyProjection"]>()
      .mockResolvedValue({
        listId: LIST_ID,
        safetyFingerprint: FINGERPRINT_A,
        currentLabelWarnings: [],
      }),
    applyReconciliation: vi
      .fn<ShoppingDependencies["applyReconciliation"]>()
      .mockResolvedValue({ listId: LIST_ID, version: 4, replayed: false }),
    ...overrides,
  };
}

const emptyPreviewedQuantities: ReconcileShoppingListRequest["previewedQuantities"] = {
  add: [],
  replace: [],
};

const reconcileCommand: ReconcileShoppingListRequest & { userId: string; listId: string } = {
  userId: USER_ID,
  listId: LIST_ID,
  expectedListVersion: 3,
  sourceMenuId: MENU_ID,
  sourceMenuVersion: 1,
  idempotencyKey: IDEMPOTENCY_KEY,
  approval: { addKeys: [], replaceItemIds: [], removeItemIds: [] },
  previewedQuantities: emptyPreviewedQuantities,
};

function sentWarnings(
  mock: ReturnType<typeof vi.fn<ShoppingDependencies["replaceCurrentSafetyProjection"]>>,
): readonly CurrentShoppingLabelWarning[] {
  return mock.mock.calls[0]?.[0].warnings ?? [];
}

describe("revalidateActiveShoppingList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a deterministic fingerprint with sorted unique checked source menu ids", async () => {
    // 設計書 Task4 Step1: source は逆順かつ重複ありで供給し、公開結果の
    // checkedSourceMenuIds が「重複排除 + 昇順」であることを固定する。
    const warningB = makeCurrentWarning();
    const replace = vi
      .fn<ShoppingDependencies["replaceCurrentSafetyProjection"]>()
      .mockResolvedValue({
        listId: LIST_ID,
        safetyFingerprint: FINGERPRINT_A,
        currentLabelWarnings: [warningB],
      });
    const revalidate = vi
      .fn<ShoppingDependencies["revalidate"]>()
      .mockResolvedValue(makeRevalidation());
    const deps = makeShoppingDependencies({
      loadActiveListSources: vi
        .fn<ShoppingDependencies["loadActiveListSources"]>()
        .mockResolvedValue([
          makeSource({
            menuId: MENU_B,
            sourceMenuIdSnapshot: MENU_B,
            sourceDerivationGroupId: GROUP_B,
          }),
          makeSource(),
          makeSource({
            menuId: MENU_B,
            sourceMenuIdSnapshot: MENU_B,
            sourceMenuVersion: 2,
            sourceDerivationGroupId: GROUP_B,
          }),
        ]),
      revalidate,
      replaceCurrentSafetyProjection: replace,
    });
    await expect(
      revalidateActiveShoppingList(deps, { userId: USER_ID, listId: LIST_ID }),
    ).resolves.toEqual({
      status: "valid",
      safetyFingerprint: FINGERPRINT_A,
      checkedSourceMenuIds: [MENU_A, MENU_B],
      currentLabelWarnings: [warningB],
      issues: [],
    });
    // 同一献立は distinct 単位で一度だけ再検証する。
    expect(revalidate).toHaveBeenCalledTimes(2);
  });

  it("returns unverifiable with no fingerprint when a source menu is no longer live", async () => {
    const replace = vi.fn<ShoppingDependencies["replaceCurrentSafetyProjection"]>();
    const fingerprint = vi.fn<ShoppingDependencies["getListSafetyFingerprint"]>();
    const deps = makeShoppingDependencies({
      loadActiveListSources: vi
        .fn<ShoppingDependencies["loadActiveListSources"]>()
        .mockResolvedValue([makeSource(), makeSource({ menuId: null })]),
      getListSafetyFingerprint: fingerprint,
      replaceCurrentSafetyProjection: replace,
    });
    const result = await revalidateActiveShoppingList(deps, {
      userId: USER_ID,
      listId: LIST_ID,
    });
    expect(result.status).toBe("unverifiable");
    expect(result.safetyFingerprint).toBeNull();
    expect(result.currentLabelWarnings).toEqual([]);
    expect(result.issues[0]?.code).toBe("source_menu_unavailable");
    expect(fingerprint).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("returns human issues and no fingerprint when a source is currently invalid", async () => {
    const replace = vi.fn<ShoppingDependencies["replaceCurrentSafetyProjection"]>();
    const deps = makeShoppingDependencies({
      loadActiveListSources: vi
        .fn<ShoppingDependencies["loadActiveListSources"]>()
        .mockResolvedValue([makeSource()]),
      revalidate: vi.fn<ShoppingDependencies["revalidate"]>().mockResolvedValue(
        makeRevalidation({
          status: "invalid",
          issues: [
            { code: "direct_allergen_match", path: "dishes.0", message: "小麦が含まれます" },
          ],
        }),
      ),
      replaceCurrentSafetyProjection: replace,
    });
    const result = await revalidateActiveShoppingList(deps, {
      userId: USER_ID,
      listId: LIST_ID,
    });
    expect(result.status).toBe("invalid");
    expect(result.safetyFingerprint).toBeNull();
    expect(result.checkedSourceMenuIds).toEqual([MENU_A]);
    expect(result.issues[0]).toMatchObject({
      code: "current_safety_invalid",
      sourceMenuId: MENU_A,
    });
    expect(result.issues[0]?.message.length).toBeGreaterThan(0);
    expect(replace).not.toHaveBeenCalled();
  });

  it("stays closed when owner-scoped source enumeration fails", async () => {
    const deps = makeShoppingDependencies({
      loadActiveListSources: vi
        .fn<ShoppingDependencies["loadActiveListSources"]>()
        .mockRejectedValue(new HttpError(503, "shopping_unavailable", "読み込めませんでした")),
    });
    await expect(
      revalidateActiveShoppingList(deps, { userId: USER_ID, listId: LIST_ID }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("returns no token when the list safety fingerprint disappears after source validation", async () => {
    const replace = vi.fn<ShoppingDependencies["replaceCurrentSafetyProjection"]>();
    const deps = makeShoppingDependencies({
      loadActiveListSources: vi
        .fn<ShoppingDependencies["loadActiveListSources"]>()
        .mockResolvedValue([makeSource()]),
      getListSafetyFingerprint: vi
        .fn<ShoppingDependencies["getListSafetyFingerprint"]>()
        .mockResolvedValue(null),
      replaceCurrentSafetyProjection: replace,
    });
    const result = await revalidateActiveShoppingList(deps, {
      userId: USER_ID,
      listId: LIST_ID,
    });
    expect(result.status).toBe("unverifiable");
    expect(result.safetyFingerprint).toBeNull();
    expect(result.issues[0]?.code).toBe("safety_check_failed");
    expect(replace).not.toHaveBeenCalled();
  });

  it("returns no token when the list safety fingerprint changes across the source validation window", async () => {
    // 設計書 Task4 Step1:「source 検証と fingerprint 読み取りの間に安全性が変わった場合は
    // トークンを返さない」。fingerprint が null になる（source 削除）ケースとは別に、
    // 値そのものが変わるケースを固定する。前後で読み直して食い違いを検出しないと、
    // 古い家族設定で計算した警告に、新しい設定の fingerprint トークンが付いて返る。
    const replace = vi.fn<ShoppingDependencies["replaceCurrentSafetyProjection"]>();
    const deps = makeShoppingDependencies({
      loadActiveListSources: vi
        .fn<ShoppingDependencies["loadActiveListSources"]>()
        .mockResolvedValue([makeSource()]),
      getListSafetyFingerprint: vi
        .fn<ShoppingDependencies["getListSafetyFingerprint"]>()
        .mockResolvedValueOnce(FINGERPRINT_A)
        .mockResolvedValueOnce(FINGERPRINT_B),
      replaceCurrentSafetyProjection: replace,
    });
    const result = await revalidateActiveShoppingList(deps, {
      userId: USER_ID,
      listId: LIST_ID,
    });
    expect(result.status).toBe("unverifiable");
    expect(result.safetyFingerprint).toBeNull();
    expect(result.currentLabelWarnings).toEqual([]);
    expect(result.issues[0]?.code).toBe("safety_check_failed");
    expect(replace).not.toHaveBeenCalled();
  });

  it("returns safety_check_failed with no current projection when the replacement loses the race", async () => {
    const deps = makeShoppingDependencies({
      loadActiveListSources: vi
        .fn<ShoppingDependencies["loadActiveListSources"]>()
        .mockResolvedValue([makeSource()]),
      replaceCurrentSafetyProjection: vi
        .fn<ShoppingDependencies["replaceCurrentSafetyProjection"]>()
        .mockRejectedValue(
          new HttpError(409, "safety_fingerprint_changed", "家族設定が変わりました"),
        ),
    });
    const result = await revalidateActiveShoppingList(deps, {
      userId: USER_ID,
      listId: LIST_ID,
    });
    expect(result.status).toBe("unverifiable");
    expect(result.currentLabelWarnings).toEqual([]);
    expect(result.issues[0]?.code).toBe("safety_check_failed");
  });

  it("never wraps a foreign list id or a changed fingerprint from the internal RPC as success", async () => {
    for (const persisted of [
      { listId: OTHER_LIST_ID, safetyFingerprint: FINGERPRINT_A, currentLabelWarnings: [] },
      { listId: LIST_ID, safetyFingerprint: FINGERPRINT_B, currentLabelWarnings: [] },
    ]) {
      const deps = makeShoppingDependencies({
        loadActiveListSources: vi
          .fn<ShoppingDependencies["loadActiveListSources"]>()
          .mockResolvedValue([makeSource()]),
        replaceCurrentSafetyProjection: vi
          .fn<ShoppingDependencies["replaceCurrentSafetyProjection"]>()
          .mockResolvedValue(persisted),
      });
      await expect(
        revalidateActiveShoppingList(deps, { userId: USER_ID, listId: LIST_ID }),
      ).rejects.toMatchObject({ status: 503, code: "safety_check_failed" });
    }
  });

  it("maps a warning to an item only on an exact source ingredient snapshot match", async () => {
    const replace = vi
      .fn<ShoppingDependencies["replaceCurrentSafetyProjection"]>()
      .mockResolvedValue({
        listId: LIST_ID,
        safetyFingerprint: FINGERPRINT_A,
        currentLabelWarnings: [],
      });
    const deps = makeShoppingDependencies({
      loadActiveListSources: vi
        .fn<ShoppingDependencies["loadActiveListSources"]>()
        .mockResolvedValue([
          makeSource({
            itemSources: [{ itemId: ITEM_ID, sourceIngredientIdSnapshot: INGREDIENT_A }],
          }),
        ]),
      revalidate: vi
        .fn<ShoppingDependencies["revalidate"]>()
        .mockResolvedValue(makeRevalidation({ currentLabelWarnings: [makeMenuWarning()] })),
      replaceCurrentSafetyProjection: replace,
    });
    await revalidateActiveShoppingList(deps, { userId: USER_ID, listId: LIST_ID });
    expect(sentWarnings(replace)).toEqual([
      expect.objectContaining({
        itemId: ITEM_ID,
        sourceMenuId: MENU_A,
        sourceDerivationGroupId: GROUP_A,
        sourceDisplayName: "カレールー",
        allergenDisplayName: "小麦",
        memberDisplayName: "子ども",
      }),
    ]);
  });

  it("keeps a warning list-level instead of falling back to name-only matching", async () => {
    const replace = vi
      .fn<ShoppingDependencies["replaceCurrentSafetyProjection"]>()
      .mockResolvedValue({
        listId: LIST_ID,
        safetyFingerprint: FINGERPRINT_A,
        currentLabelWarnings: [],
      });
    const deps = makeShoppingDependencies({
      loadActiveListSources: vi
        .fn<ShoppingDependencies["loadActiveListSources"]>()
        .mockResolvedValue([
          makeSource({
            // 同じ表示名でも ingredient スナップショット ID が違えば item へは結び付けない。
            itemSources: [{ itemId: ITEM_ID, sourceIngredientIdSnapshot: INGREDIENT_B }],
          }),
        ]),
      revalidate: vi
        .fn<ShoppingDependencies["revalidate"]>()
        .mockResolvedValue(makeRevalidation({ currentLabelWarnings: [makeMenuWarning()] })),
      replaceCurrentSafetyProjection: replace,
    });
    await revalidateActiveShoppingList(deps, { userId: USER_ID, listId: LIST_ID });
    expect(sentWarnings(replace)[0]?.itemId).toBeNull();
  });

  it("deduplicates and sorts the composed current warnings by warning key and item id", async () => {
    const replace = vi
      .fn<ShoppingDependencies["replaceCurrentSafetyProjection"]>()
      .mockResolvedValue({
        listId: LIST_ID,
        safetyFingerprint: FINGERPRINT_A,
        currentLabelWarnings: [],
      });
    const deps = makeShoppingDependencies({
      loadActiveListSources: vi
        .fn<ShoppingDependencies["loadActiveListSources"]>()
        .mockResolvedValue([makeSource()]),
      revalidate: vi.fn<ShoppingDependencies["revalidate"]>().mockResolvedValue(
        makeRevalidation({
          currentLabelWarnings: [
            makeMenuWarning({ allergenId: "milk", allergenName: "乳" }),
            makeMenuWarning(),
            makeMenuWarning(),
          ],
        }),
      ),
      replaceCurrentSafetyProjection: replace,
    });
    await revalidateActiveShoppingList(deps, { userId: USER_ID, listId: LIST_ID });
    const sent = sentWarnings(replace);
    expect(sent).toHaveLength(2);
    // 「自分自身をソートした結果と比べる」では並び替えを外しても通りうるため、
    // 隣接要素が厳密に昇順であることを直接固定する。
    expect(sent[0]?.warningKey.localeCompare(sent[1]?.warningKey ?? "")).toBeLessThan(0);
  });

  it("returns valid with nothing checked for a manual-only list that has no sources", async () => {
    // 手動追加のみのリストは source 行を持たない。ループは回らず、SQL 側の
    // 'manual-only' ダイジェストが返るため valid になる。境界として明示的に固定する。
    const replace = vi
      .fn<ShoppingDependencies["replaceCurrentSafetyProjection"]>()
      .mockResolvedValue({
        listId: LIST_ID,
        safetyFingerprint: FINGERPRINT_A,
        currentLabelWarnings: [],
      });
    const revalidate = vi.fn<ShoppingDependencies["revalidate"]>();
    const deps = makeShoppingDependencies({
      loadActiveListSources: vi
        .fn<ShoppingDependencies["loadActiveListSources"]>()
        .mockResolvedValue([]),
      revalidate,
      replaceCurrentSafetyProjection: replace,
    });
    await expect(
      revalidateActiveShoppingList(deps, { userId: USER_ID, listId: LIST_ID }),
    ).resolves.toEqual({
      status: "valid",
      safetyFingerprint: FINGERPRINT_A,
      checkedSourceMenuIds: [],
      currentLabelWarnings: [],
      issues: [],
    });
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("fails closed when one ingredient snapshot maps to two different shopping items", async () => {
    // warningKey 側の曖昧さは既に 503 に倒している。同じ (献立, ingredient スナップショット)
    // が別々の item を指す状態も同種の曖昧さであり、どちらの item に警告を付けるかを
    // 行順に委ねてはならないため、同じく安全側で閉じる。
    const replace = vi.fn<ShoppingDependencies["replaceCurrentSafetyProjection"]>();
    const deps = makeShoppingDependencies({
      loadActiveListSources: vi
        .fn<ShoppingDependencies["loadActiveListSources"]>()
        .mockResolvedValue([
          makeSource({
            itemSources: [
              { itemId: ITEM_ID, sourceIngredientIdSnapshot: INGREDIENT_A },
              { itemId: OTHER_ITEM_ID, sourceIngredientIdSnapshot: INGREDIENT_A },
            ],
          }),
        ]),
      replaceCurrentSafetyProjection: replace,
    });
    await expect(
      revalidateActiveShoppingList(deps, { userId: USER_ID, listId: LIST_ID }),
    ).rejects.toMatchObject({ status: 503, code: "safety_check_failed" });
    expect(replace).not.toHaveBeenCalled();
  });

  it("fails closed when a composed warning exceeds the bounded source text length", async () => {
    const replace = vi.fn<ShoppingDependencies["replaceCurrentSafetyProjection"]>();
    const deps = makeShoppingDependencies({
      loadActiveListSources: vi
        .fn<ShoppingDependencies["loadActiveListSources"]>()
        .mockResolvedValue([makeSource()]),
      revalidate: vi.fn<ShoppingDependencies["revalidate"]>().mockResolvedValue(
        makeRevalidation({
          currentLabelWarnings: [makeMenuWarning({ sourceText: "あ".repeat(501) })],
        }),
      ),
      replaceCurrentSafetyProjection: replace,
    });
    await expect(
      revalidateActiveShoppingList(deps, { userId: USER_ID, listId: LIST_ID }),
    ).rejects.toMatchObject({ status: 503, code: "safety_check_failed" });
    expect(replace).not.toHaveBeenCalled();
  });

  it("sends only the currently derived warning and never the immutable provenance snapshot", async () => {
    const immutableA: ShoppingLabelSnapshot = {
      confirmationId: "a1000000-0000-4000-8000-0000000000aa",
      warningKey: "a".repeat(64),
      sourceMenuId: MENU_A,
      sourceDerivationGroupId: GROUP_A,
      sourceType: "ingredient",
      sourceId: INGREDIENT_B,
      sourcePath: "dishes.0.ingredients.1.name",
      sourceDisplayName: "旧食材",
      allergenId: "egg",
      allergenDisplayName: "卵",
      anonymousMemberRef: "member_2",
      memberDisplayName: "削除済みの家族",
      dictionaryVersion: "jp-caa-2026-04.v1",
      confirmationStatus: "pending",
    };
    const replace = vi
      .fn<ShoppingDependencies["replaceCurrentSafetyProjection"]>()
      .mockResolvedValue({
        listId: LIST_ID,
        safetyFingerprint: FINGERPRINT_A,
        currentLabelWarnings: [],
      });
    const deps = makeShoppingDependencies({
      loadActiveList: vi
        .fn<ShoppingDependencies["loadActiveList"]>()
        .mockResolvedValue(makeList({ listLabelWarnings: [immutableA] })),
      loadActiveListSources: vi
        .fn<ShoppingDependencies["loadActiveListSources"]>()
        .mockResolvedValue([makeSource()]),
      revalidate: vi
        .fn<ShoppingDependencies["revalidate"]>()
        .mockResolvedValue(makeRevalidation({ currentLabelWarnings: [makeMenuWarning()] })),
      replaceCurrentSafetyProjection: replace,
    });
    await revalidateActiveShoppingList(deps, { userId: USER_ID, listId: LIST_ID });
    const sent = sentWarnings(replace);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.warningKey).not.toBe(immutableA.warningKey);
  });

  it("fails closed when the list is missing or owned by another user", async () => {
    const deps = makeShoppingDependencies({
      loadActiveList: vi.fn<ShoppingDependencies["loadActiveList"]>().mockResolvedValue(null),
    });
    await expect(
      revalidateActiveShoppingList(deps, { userId: USER_ID, listId: OTHER_LIST_ID }),
    ).rejects.toMatchObject({ status: 404, code: "shopping_list_not_found" });
  });
});

describe("previewShoppingListDiff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns canonical human fields from the owner-scoped server snapshot", async () => {
    const deps = makeShoppingDependencies({
      loadMenu: vi.fn<ShoppingDependencies["loadMenu"]>().mockResolvedValue(
        makeMenu({
          ingredients: [
            {
              ingredientId: INGREDIENT_A,
              dishId: DISH_ID,
              dishName: "カレー",
              name: "カレールー",
              quantityValue: 1,
              quantityText: "1箱",
              unit: "箱",
              storeSection: "dry_goods",
            },
          ],
          labels: [
            {
              confirmationId: "a1000000-0000-4000-8000-000000000001",
              warningKey: "c".repeat(64),
              sourceMenuId: MENU_ID,
              sourceDerivationGroupId: GROUP_A,
              sourceType: "ingredient",
              sourceId: INGREDIENT_A,
              sourcePath: "dishes.0.ingredients.0.name",
              sourceDisplayName: "カレールー",
              allergenId: "wheat",
              allergenDisplayName: "小麦",
              anonymousMemberRef: "member_1",
              memberDisplayName: "子ども",
              dictionaryVersion: "jp-caa-2026-04.v1",
              confirmationStatus: "pending",
            },
          ],
        }),
      ),
    });
    const diff = await previewShoppingListDiff(deps, {
      userId: USER_ID,
      listId: LIST_ID,
      sourceMenuId: MENU_ID,
      sourceMenuVersion: 1,
      expectedListVersion: 3,
    });
    expect(diff.add[0]?.displayName).toBe("カレールー");
    const labels = [...diff.add.flatMap((item) => item.labelWarnings), ...diff.listLabelWarnings];
    expect(labels[0]?.allergenDisplayName).toBe("小麦");
    expect(labels[0]?.memberDisplayName).toBe("子ども");
  });

  it("rejects a stale list version after household identity passes", async () => {
    // identity/mode は list version より先。household で identity が通ったあとだけ
    // list_version_conflict になる（SQL の owner→version→mode→list 優先と揃える）。
    const deps = makeShoppingDependencies();
    await expect(
      previewShoppingListDiff(deps, {
        userId: USER_ID,
        listId: LIST_ID,
        sourceMenuId: MENU_ID,
        sourceMenuVersion: 1,
        expectedListVersion: 2,
      }),
    ).rejects.toMatchObject({ status: 409, code: "list_version_conflict" });
    /* eslint-disable @typescript-eslint/unbound-method -- makeShoppingDependencies の
       vi.fn プロパティは this を使わない純粋関数なので束縛外れの危険はない */
    expect(deps.revalidate).toHaveBeenCalled();
    expect(deps.loadActiveList).toHaveBeenCalled();
    /* eslint-enable @typescript-eslint/unbound-method */
  });

  it("rejects a stale source menu version before the list version check", async () => {
    const loadActiveList = vi.fn<ShoppingDependencies["loadActiveList"]>();
    const deps = makeShoppingDependencies({ loadActiveList });
    await expect(
      previewShoppingListDiff(deps, {
        userId: USER_ID,
        listId: LIST_ID,
        sourceMenuId: MENU_ID,
        sourceMenuVersion: 2,
        expectedListVersion: 3,
      }),
    ).rejects.toMatchObject({ status: 409, code: "source_menu_version_conflict" });
    expect(loadActiveList).not.toHaveBeenCalled();
  });

  it("revalidates all active list sources before returning a preview (SHOP1)", async () => {
    const OTHER_MENU = "52000000-0000-4000-8000-000000000099";
    const revalidate = vi.fn<ShoppingDependencies["revalidate"]>().mockImplementation((menuId) => {
      if (menuId === OTHER_MENU) {
        return Promise.resolve(
          makeRevalidation({
            status: "invalid",
            issues: [{ code: "direct_allergen_match", path: "x", message: "だめ" }],
          }),
        );
      }
      return Promise.resolve(makeRevalidation());
    });
    const loadMenuIdentity = vi
      .fn<ShoppingDependencies["loadMenuIdentity"]>()
      .mockImplementation((menuId) =>
        Promise.resolve({
          id: menuId,
          userId: USER_ID,
          version: 1,
          targetMode: "household" as const,
        }),
      );
    const deps = makeShoppingDependencies({
      revalidate,
      loadMenuIdentity,
      loadActiveListSources: vi.fn().mockResolvedValue([
        makeSource({
          menuId: MENU_ID,
          sourceMenuIdSnapshot: MENU_ID,
          sourceDerivationGroupId: "c1000000-0000-4000-8000-000000000001",
        }),
        makeSource({
          menuId: OTHER_MENU,
          sourceMenuIdSnapshot: OTHER_MENU,
          sourceDerivationGroupId: "c1000000-0000-4000-8000-000000000099",
        }),
      ]),
    });
    await expect(
      previewShoppingListDiff(deps, {
        userId: USER_ID,
        listId: LIST_ID,
        sourceMenuId: MENU_ID,
        sourceMenuVersion: 1,
        expectedListVersion: 3,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "current_safety_revalidation_required",
    });
    expect(revalidate).toHaveBeenCalledWith(OTHER_MENU);
  });
});

describe("reconcileShoppingList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a saved reconcile replay with shopping_list_not_found when the active list is gone (SHOP3)", async () => {
    // create と同 helper。archive 済み list の replay を世帯 invalid に畳まない。
    const saved = { listId: LIST_ID, version: 4, replayed: true };
    const applyReconciliation = vi.fn<ShoppingDependencies["applyReconciliation"]>();
    const revalidate = vi.fn<ShoppingDependencies["revalidate"]>();
    const deps = makeShoppingDependencies({
      findMutationReplay: vi.fn().mockResolvedValue(saved),
      loadActiveList: vi.fn().mockResolvedValue(null),
      applyReconciliation,
      revalidate,
    });
    await expect(reconcileShoppingList(deps, reconcileCommand)).rejects.toMatchObject({
      status: 404,
      code: "shopping_list_not_found",
    });
    expect(applyReconciliation).not.toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("returns a saved reconciliation only after live safety revalidation still passes", async () => {
    // SHOP1: reconcile replay も現行 safety 再確認後にだけ保存済み応答を返す
    const saved = { listId: LIST_ID, version: 4, replayed: true };
    const applyReconciliation = vi.fn<ShoppingDependencies["applyReconciliation"]>();
    const deps = makeShoppingDependencies({
      findMutationReplay: vi.fn().mockResolvedValue(saved),
      loadActiveList: vi.fn().mockResolvedValue(makeList()),
      loadActiveListSources: vi.fn().mockResolvedValue([
        makeSource({
          menuId: MENU_ID,
          sourceMenuIdSnapshot: MENU_ID,
          sourceDerivationGroupId: "c1000000-0000-4000-8000-000000000001",
        }),
      ]),
      applyReconciliation,
    });
    await expect(reconcileShoppingList(deps, reconcileCommand)).resolves.toEqual(saved);
    /* eslint-disable @typescript-eslint/unbound-method -- vi.fn プロパティは this 非依存 */
    expect(deps.revalidate).toHaveBeenCalled();
    expect(deps.loadActiveList).toHaveBeenCalled();
    /* eslint-enable @typescript-eslint/unbound-method */
    expect(applyReconciliation).not.toHaveBeenCalled();
  });

  it("rejects a stale list version after household identity passes", async () => {
    // household identity が通ったあとだけ list_version_conflict を返す。
    // idea + stale list の dual-fault は idea_menu_not_supported 側のテストで固定する。
    const applyReconciliation = vi.fn<ShoppingDependencies["applyReconciliation"]>();
    const deps = makeShoppingDependencies({ applyReconciliation });
    await expect(
      reconcileShoppingList(deps, { ...reconcileCommand, expectedListVersion: 2 }),
    ).rejects.toMatchObject({ status: 409, code: "list_version_conflict" });
    expect(applyReconciliation).not.toHaveBeenCalled();
    /* eslint-disable @typescript-eslint/unbound-method -- vi.fn プロパティは this 非依存 */
    expect(deps.revalidate).toHaveBeenCalled();
    expect(deps.loadActiveList).toHaveBeenCalled();
    /* eslint-enable @typescript-eslint/unbound-method */
  });

  it("replays reconcile after apply list_version_conflict when mutation exists (SHOP3)", async () => {
    // 並行 reconcile: version は通ったが apply 内で競合 → 同一 key+hash を再読
    const concurrentReplay = { listId: LIST_ID, version: 4, replayed: true };
    const findMutationReplay = vi
      .fn<ShoppingDependencies["findMutationReplay"]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(concurrentReplay);
    const applyReconciliation = vi
      .fn<ShoppingDependencies["applyReconciliation"]>()
      .mockRejectedValue(
        new HttpError(409, "list_version_conflict", "買い物リストが更新されました"),
      );
    const deps = makeShoppingDependencies({
      findMutationReplay,
      applyReconciliation,
      loadActiveList: vi.fn().mockResolvedValue(makeList()),
      loadActiveListSources: vi.fn().mockResolvedValue([
        makeSource({
          menuId: MENU_ID,
          sourceMenuIdSnapshot: MENU_ID,
          sourceDerivationGroupId: "c1000000-0000-4000-8000-000000000001",
        }),
      ]),
    });
    // pure add 承認を付けて prepare を通し、apply の競合パスへ進める
    const preview = await previewShoppingListDiff(deps, {
      userId: USER_ID,
      listId: LIST_ID,
      sourceMenuId: MENU_ID,
      sourceMenuVersion: 1,
      expectedListVersion: 3,
    });
    const draftKey = preview.add[0]?.key;
    expect(draftKey).toBeDefined();
    await expect(
      reconcileShoppingList(deps, {
        ...reconcileCommand,
        approval: { addKeys: [draftKey!], replaceItemIds: [], removeItemIds: [] },
        previewedQuantities: snapshotPreviewedQuantities(preview),
      }),
    ).resolves.toEqual(concurrentReplay);
    expect(findMutationReplay).toHaveBeenCalledTimes(2);
    expect(applyReconciliation).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale source menu version before the list version check", async () => {
    const applyReconciliation = vi.fn<ShoppingDependencies["applyReconciliation"]>();
    const loadActiveList = vi.fn<ShoppingDependencies["loadActiveList"]>();
    const deps = makeShoppingDependencies({ applyReconciliation, loadActiveList });
    await expect(
      reconcileShoppingList(deps, { ...reconcileCommand, sourceMenuVersion: 2 }),
    ).rejects.toMatchObject({ status: 409, code: "source_menu_version_conflict" });
    expect(applyReconciliation).not.toHaveBeenCalled();
    expect(loadActiveList).not.toHaveBeenCalled();
  });

  it("passes the just-read safety fingerprint and the canonical request hash to the RPC", async () => {
    const applyReconciliation = vi
      .fn<ShoppingDependencies["applyReconciliation"]>()
      .mockResolvedValue({ listId: LIST_ID, version: 4, replayed: false });
    const deps = makeShoppingDependencies({ applyReconciliation });
    // pure add が pending なので key を承認して RPC へ進める
    const preview = await previewShoppingListDiff(deps, {
      userId: USER_ID,
      listId: LIST_ID,
      sourceMenuId: MENU_ID,
      sourceMenuVersion: 1,
      expectedListVersion: 3,
    });
    const draftKey = preview.add[0]?.key;
    expect(draftKey).toBeDefined();
    await reconcileShoppingList(deps, {
      ...reconcileCommand,
      approval: { addKeys: [draftKey!], replaceItemIds: [], removeItemIds: [] },
      previewedQuantities: snapshotPreviewedQuantities(preview),
    });
    expect(applyReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        listId: LIST_ID,
        expectedListVersion: 3,
        sourceMenuId: MENU_ID,
        sourceMenuVersion: 1,
        safetyFingerprint: FINGERPRINT_A,
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown as string,
        // remove 候補が無い pure add は版刻印する（R1）
        stampSourceVersion: true,
        sourceSafetyFingerprints: { [MENU_ID]: FINGERPRINT_A },
      }),
    );
  });

  it("rejects reconcile that would exceed shoppingItemsMax (SHOP5)", async () => {
    const applyReconciliation = vi.fn<ShoppingDependencies["applyReconciliation"]>();
    const deps = makeShoppingDependencies({
      applyReconciliation,
      loadActiveList: vi.fn<ShoppingDependencies["loadActiveList"]>().mockResolvedValue(
        makeList({
          items: Array.from({ length: shoppingItemsMax }, (_, index) => ({
            id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            listId: LIST_ID,
            displayName: "手追加",
            normalizedName: "手追加",
            storeSection: "other" as const,
            quantityValue: 1,
            quantityText: "1個",
            unit: "個",
            isChecked: false,
            isManual: true,
            isManuallyEdited: false,
            isRemovedByUser: false,
            pantryCheckRequired: false,
            labelWarnings: [],
          })),
        }),
      ),
    });
    const preview = await previewShoppingListDiff(deps, {
      userId: USER_ID,
      listId: LIST_ID,
      sourceMenuId: MENU_ID,
      sourceMenuVersion: 1,
      expectedListVersion: 3,
    });
    const draftKey = preview.add[0]?.key;
    expect(draftKey).toBeDefined();
    await expect(
      reconcileShoppingList(deps, {
        ...reconcileCommand,
        approval: { addKeys: [draftKey!], replaceItemIds: [], removeItemIds: [] },
        previewedQuantities: snapshotPreviewedQuantities(preview),
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: "shopping_items_limit_exceeded",
    });
    expect(applyReconciliation).not.toHaveBeenCalled();
  });

  it("surfaces the RPC protected_item_conflict defense to the caller", async () => {
    const deps = makeShoppingDependencies({
      applyReconciliation: vi
        .fn<ShoppingDependencies["applyReconciliation"]>()
        .mockRejectedValue(
          new HttpError(409, "protected_item_conflict", "差分を作り直してください"),
        ),
    });
    const preview = await previewShoppingListDiff(deps, {
      userId: USER_ID,
      listId: LIST_ID,
      sourceMenuId: MENU_ID,
      sourceMenuVersion: 1,
      expectedListVersion: 3,
    });
    const draftKey = preview.add[0]?.key;
    await expect(
      reconcileShoppingList(deps, {
        ...reconcileCommand,
        approval: { addKeys: [draftKey!], replaceItemIds: [], removeItemIds: [] },
        previewedQuantities: snapshotPreviewedQuantities(preview),
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "protected_item_conflict",
    });
  });

  // U5-002: pending diff があるのに承認ゼロは版だけ登録されるため拒否する
  it("rejects empty approval when the computed diff has pending ops", async () => {
    const applyReconciliation = vi.fn<ShoppingDependencies["applyReconciliation"]>();
    const deps = makeShoppingDependencies({
      loadMenu: vi.fn<ShoppingDependencies["loadMenu"]>().mockResolvedValue(makeMenu()),
      applyReconciliation,
    });
    await expect(reconcileShoppingList(deps, reconcileCommand)).rejects.toMatchObject({
      status: 422,
      code: "empty_approval",
    });
    expect(applyReconciliation).not.toHaveBeenCalled();
  });

  // U5-004 / SHOP3: lineage 無しは items の有無に関わらず拒否
  it("rejects reconcile when source lineage is not on the list but items exist", async () => {
    const applyReconciliation = vi.fn<ShoppingDependencies["applyReconciliation"]>();
    const deps = makeShoppingDependencies({
      loadMenu: vi.fn<ShoppingDependencies["loadMenu"]>().mockResolvedValue(makeMenu()),
      loadActiveList: vi.fn<ShoppingDependencies["loadActiveList"]>().mockResolvedValue(
        makeList({
          items: [
            {
              id: "a1000000-0000-4000-8000-000000000099",
              listId: LIST_ID,
              displayName: "既存",
              normalizedName: "既存",
              storeSection: "other",
              quantityValue: 1,
              quantityText: "1",
              unit: "個",
              isChecked: false,
              isManual: false,
              isManuallyEdited: false,
              isRemovedByUser: false,
              pantryCheckRequired: false,
              labelWarnings: [],
            },
          ],
        }),
      ),
      loadActiveListSources: vi
        .fn<ShoppingDependencies["loadActiveListSources"]>()
        .mockResolvedValue([]),
      applyReconciliation,
    });
    await expect(reconcileShoppingList(deps, reconcileCommand)).rejects.toMatchObject({
      status: 409,
      code: "reconcile_source_not_in_list",
    });
    expect(applyReconciliation).not.toHaveBeenCalled();
  });

  it("rejects reconcile when source lineage is missing even if list items are empty", async () => {
    // SHOP3: pantry 全差し引き等で items 0 でも、未取り込み menu の純 add を許さない
    const applyReconciliation = vi.fn<ShoppingDependencies["applyReconciliation"]>();
    const deps = makeShoppingDependencies({
      loadActiveList: vi.fn<ShoppingDependencies["loadActiveList"]>().mockResolvedValue(makeList()),
      loadActiveListSources: vi
        .fn<ShoppingDependencies["loadActiveListSources"]>()
        .mockResolvedValue([]),
      applyReconciliation,
    });
    await expect(reconcileShoppingList(deps, reconcileCommand)).rejects.toMatchObject({
      status: 409,
      code: "reconcile_source_not_in_list",
    });
    expect(applyReconciliation).not.toHaveBeenCalled();
  });

  it("rejects no-op reconcile with empty pending diff (SHOP5)", async () => {
    // 空 draft + 空 list + lineage あり → pending 無し。version/source だけ進ませない
    const applyReconciliation = vi.fn<ShoppingDependencies["applyReconciliation"]>();
    const deps = makeShoppingDependencies({
      loadMenu: vi
        .fn<ShoppingDependencies["loadMenu"]>()
        .mockResolvedValue(makeMenu({ ingredients: [], labels: [] })),
      applyReconciliation,
    });
    await expect(reconcileShoppingList(deps, reconcileCommand)).rejects.toMatchObject({
      status: 422,
      code: "empty_approval",
      message: "反映する変更がありません",
    });
    expect(applyReconciliation).not.toHaveBeenCalled();
  });

  it("revalidates all active list sources before reconcile apply (SHOP1)", async () => {
    const OTHER_MENU = "52000000-0000-4000-8000-000000000099";
    const applyReconciliation = vi.fn<ShoppingDependencies["applyReconciliation"]>();
    const revalidate = vi.fn<ShoppingDependencies["revalidate"]>().mockImplementation((menuId) => {
      if (menuId === OTHER_MENU) {
        return Promise.resolve(
          makeRevalidation({
            status: "invalid",
            issues: [{ code: "direct_allergen_match", path: "x", message: "だめ" }],
          }),
        );
      }
      return Promise.resolve(makeRevalidation());
    });
    const loadMenuIdentity = vi
      .fn<ShoppingDependencies["loadMenuIdentity"]>()
      .mockImplementation((menuId) =>
        Promise.resolve({
          id: menuId,
          userId: USER_ID,
          version: 1,
          targetMode: "household" as const,
        }),
      );
    const deps = makeShoppingDependencies({
      revalidate,
      loadMenuIdentity,
      applyReconciliation,
      loadActiveListSources: vi.fn().mockResolvedValue([
        makeSource({
          menuId: MENU_ID,
          sourceMenuIdSnapshot: MENU_ID,
          sourceDerivationGroupId: "c1000000-0000-4000-8000-000000000001",
        }),
        makeSource({
          menuId: OTHER_MENU,
          sourceMenuIdSnapshot: OTHER_MENU,
          sourceDerivationGroupId: "c1000000-0000-4000-8000-000000000099",
        }),
      ]),
    });
    await expect(reconcileShoppingList(deps, reconcileCommand)).rejects.toMatchObject({
      status: 409,
      code: "current_safety_revalidation_required",
    });
    expect(applyReconciliation).not.toHaveBeenCalled();
    expect(revalidate).toHaveBeenCalledWith(OTHER_MENU);
  });

  it("rejects partial add approval that would stamp menu version (SHOP2)", async () => {
    const applyReconciliation = vi.fn<ShoppingDependencies["applyReconciliation"]>();
    // 2 件の pure add を作り、1 件だけ承認すると部分承認になる
    const deps = makeShoppingDependencies({
      applyReconciliation,
      loadMenu: vi.fn<ShoppingDependencies["loadMenu"]>().mockResolvedValue(
        makeMenu({
          ingredients: [
            {
              ingredientId: INGREDIENT_A,
              dishId: DISH_ID,
              dishName: "料理",
              name: "にんじん",
              quantityValue: 1,
              quantityText: "1本",
              unit: "本",
              storeSection: "produce",
            },
            {
              ingredientId: INGREDIENT_B,
              dishId: DISH_ID,
              dishName: "料理",
              name: "じゃがいも",
              quantityValue: 2,
              quantityText: "2個",
              unit: "個",
              storeSection: "produce",
            },
          ],
        }),
      ),
    });
    const diff = await previewShoppingListDiff(deps, {
      userId: USER_ID,
      listId: LIST_ID,
      sourceMenuId: MENU_ID,
      sourceMenuVersion: 1,
      expectedListVersion: 3,
    });
    expect(diff.add.length).toBeGreaterThanOrEqual(2);
    const onlyFirst = diff.add[0]?.key;
    expect(onlyFirst).toBeDefined();
    await expect(
      reconcileShoppingList(deps, {
        ...reconcileCommand,
        approval: { addKeys: [onlyFirst!], replaceItemIds: [], removeItemIds: [] },
        previewedQuantities: snapshotPreviewedQuantities(diff),
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: "partial_approval_not_allowed",
    });
    expect(applyReconciliation).not.toHaveBeenCalled();
  });

  it("defers source version stamp when remove candidates stay unapproved (R1)", async () => {
    // リストに旧材料、draft は別材料 → add + remove。remove 未選択のまま反映しても
    // 版は刻印しない（同 version 再 reconcile / CTA 維持）。
    const applyReconciliation = vi
      .fn<ShoppingDependencies["applyReconciliation"]>()
      .mockResolvedValue({ listId: LIST_ID, version: 4, replayed: false });
    const deps = makeShoppingDependencies({
      applyReconciliation,
      loadActiveList: vi.fn<ShoppingDependencies["loadActiveList"]>().mockResolvedValue(
        makeList({
          items: [
            {
              id: ITEM_ID,
              listId: LIST_ID,
              displayName: "旧材料",
              normalizedName: "旧材料",
              storeSection: "other",
              quantityValue: 1,
              quantityText: "1個",
              unit: "個",
              isChecked: false,
              isManual: false,
              isManuallyEdited: false,
              isRemovedByUser: false,
              pantryCheckRequired: false,
              labelWarnings: [],
            },
          ],
        }),
      ),
      loadActiveListSources: vi.fn().mockResolvedValue([
        makeSource({
          menuId: MENU_ID,
          sourceMenuIdSnapshot: MENU_ID,
          sourceDerivationGroupId: "c1000000-0000-4000-8000-000000000001",
          itemSources: [{ itemId: ITEM_ID, sourceIngredientIdSnapshot: INGREDIENT_B }],
        }),
      ]),
    });
    const diff = await previewShoppingListDiff(deps, {
      userId: USER_ID,
      listId: LIST_ID,
      sourceMenuId: MENU_ID,
      sourceMenuVersion: 1,
      expectedListVersion: 3,
    });
    expect(diff.remove.some((item) => item.itemId === ITEM_ID)).toBe(true);
    expect(diff.add.length).toBeGreaterThan(0);
    await reconcileShoppingList(deps, {
      ...reconcileCommand,
      approval: {
        addKeys: diff.add.map((item) => item.key),
        replaceItemIds: diff.replace.map((item) => item.itemId),
        removeItemIds: [],
      },
      previewedQuantities: snapshotPreviewedQuantities(diff),
    });
    expect(applyReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        stampSourceVersion: false,
        resolvedDiff: expect.objectContaining({
          removeIds: [],
        }) as unknown as object,
      }),
    );
  });

  it("stamps source version when all remove candidates are approved (R1)", async () => {
    const applyReconciliation = vi
      .fn<ShoppingDependencies["applyReconciliation"]>()
      .mockResolvedValue({ listId: LIST_ID, version: 4, replayed: false });
    const deps = makeShoppingDependencies({
      applyReconciliation,
      loadActiveList: vi.fn<ShoppingDependencies["loadActiveList"]>().mockResolvedValue(
        makeList({
          items: [
            {
              id: ITEM_ID,
              listId: LIST_ID,
              displayName: "旧材料",
              normalizedName: "旧材料",
              storeSection: "other",
              quantityValue: 1,
              quantityText: "1個",
              unit: "個",
              isChecked: false,
              isManual: false,
              isManuallyEdited: false,
              isRemovedByUser: false,
              pantryCheckRequired: false,
              labelWarnings: [],
            },
          ],
        }),
      ),
      loadActiveListSources: vi.fn().mockResolvedValue([
        makeSource({
          menuId: MENU_ID,
          sourceMenuIdSnapshot: MENU_ID,
          sourceDerivationGroupId: "c1000000-0000-4000-8000-000000000001",
          itemSources: [{ itemId: ITEM_ID, sourceIngredientIdSnapshot: INGREDIENT_B }],
        }),
      ]),
    });
    const diff = await previewShoppingListDiff(deps, {
      userId: USER_ID,
      listId: LIST_ID,
      sourceMenuId: MENU_ID,
      sourceMenuVersion: 1,
      expectedListVersion: 3,
    });
    expect(diff.remove.some((item) => item.itemId === ITEM_ID)).toBe(true);
    await reconcileShoppingList(deps, {
      ...reconcileCommand,
      approval: {
        addKeys: diff.add.map((item) => item.key),
        replaceItemIds: diff.replace.map((item) => item.itemId),
        removeItemIds: diff.remove.map((item) => item.itemId),
      },
      previewedQuantities: snapshotPreviewedQuantities(diff),
    });
    expect(applyReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        stampSourceVersion: true,
        resolvedDiff: expect.objectContaining({
          removeIds: expect.arrayContaining([ITEM_ID]) as unknown as string[],
        }) as unknown as object,
      }),
    );
  });

  it("revalidates list safety after successful reconcile apply (R2)", async () => {
    // post-apply の revalidateActiveShoppingList が projection を書き戻すこと
    const replaceCurrentSafetyProjection = vi
      .fn<ShoppingDependencies["replaceCurrentSafetyProjection"]>()
      .mockResolvedValue({
        listId: LIST_ID,
        safetyFingerprint: FINGERPRINT_A,
        currentLabelWarnings: [],
      });
    const applyReconciliation = vi
      .fn<ShoppingDependencies["applyReconciliation"]>()
      .mockResolvedValue({ listId: LIST_ID, version: 4, replayed: false });
    const deps = makeShoppingDependencies({
      applyReconciliation,
      replaceCurrentSafetyProjection,
    });
    const preview = await previewShoppingListDiff(deps, {
      userId: USER_ID,
      listId: LIST_ID,
      sourceMenuId: MENU_ID,
      sourceMenuVersion: 1,
      expectedListVersion: 3,
    });
    const draftKey = preview.add[0]?.key;
    expect(draftKey).toBeDefined();
    await reconcileShoppingList(deps, {
      ...reconcileCommand,
      approval: { addKeys: [draftKey!], replaceItemIds: [], removeItemIds: [] },
      previewedQuantities: snapshotPreviewedQuantities(preview),
    });
    expect(applyReconciliation).toHaveBeenCalled();
    // apply 前の assertActiveListSourcesCurrentlySafe は revalidate のみで
    // replaceCurrentSafetyProjection は呼ばない。post-apply revalidate の証拠。
    expect(replaceCurrentSafetyProjection).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, listId: LIST_ID }),
    );
  });

  it("still returns reconcile success when post-apply revalidate fails (R2)", async () => {
    const replaceCurrentSafetyProjection = vi
      .fn<ShoppingDependencies["replaceCurrentSafetyProjection"]>()
      .mockRejectedValue(new Error("projection write failed"));
    const applyReconciliation = vi
      .fn<ShoppingDependencies["applyReconciliation"]>()
      .mockResolvedValue({ listId: LIST_ID, version: 4, replayed: false });
    const deps = makeShoppingDependencies({
      applyReconciliation,
      replaceCurrentSafetyProjection,
    });
    const preview = await previewShoppingListDiff(deps, {
      userId: USER_ID,
      listId: LIST_ID,
      sourceMenuId: MENU_ID,
      sourceMenuVersion: 1,
      expectedListVersion: 3,
    });
    const draftKey = preview.add[0]?.key;
    await expect(
      reconcileShoppingList(deps, {
        ...reconcileCommand,
        approval: { addKeys: [draftKey!], replaceItemIds: [], removeItemIds: [] },
        previewedQuantities: snapshotPreviewedQuantities(preview),
      }),
    ).resolves.toEqual({ listId: LIST_ID, version: 4, replayed: false });
    expect(applyReconciliation).toHaveBeenCalled();
  });

  it("rejects apply when pantry drift changes the previewed add quantity", async () => {
    // preview/apply の数量ずれ: 献立 3・在庫 2 → add 1。同じ承認キーのまま
    // apply 前に在庫を消すと再計算 add は 3 になる。list version は進まない。
    const applyReconciliation = vi
      .fn<ShoppingDependencies["applyReconciliation"]>()
      .mockResolvedValue({ listId: LIST_ID, version: 4, replayed: false });
    const loadPantry = vi
      .fn<ShoppingDependencies["loadPantry"]>()
      .mockResolvedValue([{ name: "にんじん", quantity: 2, unit: "本" }]);
    const deps = makeShoppingDependencies({
      applyReconciliation,
      loadPantry,
      loadMenu: vi.fn<ShoppingDependencies["loadMenu"]>().mockResolvedValue(
        makeMenu({
          ingredients: [
            {
              ingredientId: INGREDIENT_ID,
              dishId: DISH_ID,
              dishName: "料理",
              name: "にんじん",
              quantityValue: 3,
              quantityText: "3本",
              unit: "本",
              storeSection: "produce",
            },
          ],
        }),
      ),
    });
    const preview = await previewShoppingListDiff(deps, {
      userId: USER_ID,
      listId: LIST_ID,
      sourceMenuId: MENU_ID,
      sourceMenuVersion: 1,
      expectedListVersion: 3,
    });
    expect(preview.add).toHaveLength(1);
    expect(preview.add[0]?.quantityValue).toBe(1);
    expect(preview.add[0]?.quantityText).toBe("1本");
    const previewedAdd = preview.add[0]!;
    loadPantry.mockResolvedValue([]);
    await expect(
      reconcileShoppingList(deps, {
        ...reconcileCommand,
        approval: {
          addKeys: [previewedAdd.key],
          replaceItemIds: [],
          removeItemIds: [],
        },
        previewedQuantities: {
          add: [
            {
              key: previewedAdd.key,
              quantityValue: previewedAdd.quantityValue,
              quantityText: previewedAdd.quantityText,
              pantryCheckRequired: previewedAdd.pantryCheckRequired,
            },
          ],
          replace: [],
        },
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "approved_diff_mismatch",
    });
    expect(applyReconciliation).not.toHaveBeenCalled();
  });

  it("applies the previewed add quantity when pantry is unchanged", async () => {
    const applyReconciliation = vi
      .fn<ShoppingDependencies["applyReconciliation"]>()
      .mockResolvedValue({ listId: LIST_ID, version: 4, replayed: false });
    const deps = makeShoppingDependencies({
      applyReconciliation,
      loadPantry: vi
        .fn<ShoppingDependencies["loadPantry"]>()
        .mockResolvedValue([{ name: "にんじん", quantity: 2, unit: "本" }]),
      loadMenu: vi.fn<ShoppingDependencies["loadMenu"]>().mockResolvedValue(
        makeMenu({
          ingredients: [
            {
              ingredientId: INGREDIENT_ID,
              dishId: DISH_ID,
              dishName: "料理",
              name: "にんじん",
              quantityValue: 3,
              quantityText: "3本",
              unit: "本",
              storeSection: "produce",
            },
          ],
        }),
      ),
    });
    const preview = await previewShoppingListDiff(deps, {
      userId: USER_ID,
      listId: LIST_ID,
      sourceMenuId: MENU_ID,
      sourceMenuVersion: 1,
      expectedListVersion: 3,
    });
    expect(preview.add[0]?.quantityValue).toBe(1);
    const previewedAdd = preview.add[0]!;
    await expect(
      reconcileShoppingList(deps, {
        ...reconcileCommand,
        approval: {
          addKeys: [previewedAdd.key],
          replaceItemIds: [],
          removeItemIds: [],
        },
        previewedQuantities: {
          add: [
            {
              key: previewedAdd.key,
              quantityValue: previewedAdd.quantityValue,
              quantityText: previewedAdd.quantityText,
              pantryCheckRequired: previewedAdd.pantryCheckRequired,
            },
          ],
          replace: [],
        },
      }),
    ).resolves.toEqual({ listId: LIST_ID, version: 4, replayed: false });
    expect(applyReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        resolvedDiff: expect.objectContaining({
          add: [expect.objectContaining({ quantityValue: 1, quantityText: "1本" })],
        }) as unknown as object,
      }),
    );
  });

  it("rejects apply when pantryCheckRequired drifts with the same quantity (SHOP7)", async () => {
    const applyReconciliation = vi
      .fn<ShoppingDependencies["applyReconciliation"]>()
      .mockResolvedValue({ listId: LIST_ID, version: 4, replayed: false });
    const loadPantry = vi.fn<ShoppingDependencies["loadPantry"]>().mockResolvedValue([]);
    const deps = makeShoppingDependencies({
      applyReconciliation,
      loadPantry,
      loadMenu: vi.fn<ShoppingDependencies["loadMenu"]>().mockResolvedValue(
        makeMenu({
          ingredients: [
            {
              ingredientId: INGREDIENT_ID,
              dishId: DISH_ID,
              dishName: "料理",
              name: "にんじん",
              quantityValue: 3,
              quantityText: "3本",
              unit: "本",
              storeSection: "produce",
            },
          ],
        }),
      ),
    });
    const preview = await previewShoppingListDiff(deps, {
      userId: USER_ID,
      listId: LIST_ID,
      sourceMenuId: MENU_ID,
      sourceMenuVersion: 1,
      expectedListVersion: 3,
    });
    expect(preview.add[0]?.quantityValue).toBe(3);
    expect(preview.add[0]?.pantryCheckRequired).toBe(false);
    const previewedAdd = preview.add[0]!;
    loadPantry.mockResolvedValue([
      { name: "にんじん", quantity: 1, unit: "本", expiresOn: "2000-01-01" },
    ]);
    await expect(
      reconcileShoppingList(deps, {
        ...reconcileCommand,
        approval: {
          addKeys: [previewedAdd.key],
          replaceItemIds: [],
          removeItemIds: [],
        },
        previewedQuantities: snapshotPreviewedQuantities(preview),
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "approved_diff_mismatch",
    });
    expect(applyReconciliation).not.toHaveBeenCalled();
  });

  it("changes the reconciliation hash when previewed quantities differ for the same key", () => {
    const base = {
      ...reconcileCommand,
      approval: { addKeys: ["carrot-add"], replaceItemIds: [], removeItemIds: [] },
      previewedQuantities: {
        add: [
          { key: "carrot-add", quantityValue: 1, quantityText: "1本", pantryCheckRequired: false },
        ],
        replace: [],
      },
    };
    const drifted = {
      ...base,
      previewedQuantities: {
        add: [
          { key: "carrot-add", quantityValue: 3, quantityText: "3本", pantryCheckRequired: false },
        ],
        replace: [],
      },
    };
    expect(createReconciliationRequestHash(base)).not.toBe(
      createReconciliationRequestHash(drifted),
    );
  });
});

describe("idea menu shopping boundaries", () => {
  it("rejects idea menus on create after replay miss without full aggregate", async () => {
    const mocks = makeMocks();
    mocks.loadMenuIdentity.mockResolvedValue({
      id: MENU_ID,
      userId: USER_ID,
      version: 1,
      targetMode: "idea",
    });
    const deps = toDeps(mocks);
    await expect(createShoppingListFromMenu(deps, makeCommand())).rejects.toMatchObject({
      status: 422,
      code: "idea_menu_not_supported",
      message: "アイデア献立は買い物リストに利用できません",
    });
    expect(mocks.loadMenuIdentity).toHaveBeenCalledWith(MENU_ID);
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.loadMenu).not.toHaveBeenCalled();
    expect(mocks.loadPantry).not.toHaveBeenCalled();
    expect(mocks.getSafetyFingerprint).not.toHaveBeenCalled();
    expect(mocks.applyDraft).not.toHaveBeenCalled();
  });

  it("revalidates live identity on create replay and still skips applyDraft", async () => {
    // SHOP1: replay でも identity / revalidate は走らせる。apply だけしない。
    const mocks = makeMocks();
    const replay = makeResponse({ replayed: true });
    mocks.findMutationReplay.mockResolvedValue(replay);
    mocks.loadActiveList.mockResolvedValue({
      id: replay.listId,
      status: "active",
      version: 1,
      items: [],
      listLabelWarnings: [],
    });
    mocks.loadActiveListSources.mockResolvedValue([
      {
        menuId: MENU_ID,
        sourceMenuIdSnapshot: MENU_ID,
        sourceMenuVersion: 1,
        sourceDerivationGroupId: "c1000000-0000-4000-8000-000000000001",
        itemSources: [],
      },
    ]);
    const deps = toDeps(mocks);
    await expect(createShoppingListFromMenu(deps, makeCommand())).resolves.toEqual(replay);
    expect(mocks.loadMenuIdentity).toHaveBeenCalled();
    expect(mocks.applyDraft).not.toHaveBeenCalled();
  });

  it("rejects idea menus on preview without revalidation", async () => {
    const mocks = makeMocks();
    mocks.loadActiveList.mockResolvedValue({
      id: LIST_ID,
      status: "active",
      version: 3,
      items: [],
      listLabelWarnings: [],
    });
    mocks.loadMenuIdentity.mockResolvedValue({
      id: MENU_ID,
      userId: USER_ID,
      version: 1,
      targetMode: "idea",
    });
    const deps = toDeps(mocks);
    await expect(
      previewShoppingListDiff(deps, {
        userId: USER_ID,
        listId: LIST_ID,
        sourceMenuId: MENU_ID,
        sourceMenuVersion: 1,
        expectedListVersion: 3,
      }),
    ).rejects.toMatchObject({ status: 422, code: "idea_menu_not_supported" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.loadMenu).not.toHaveBeenCalled();
  });

  it("rejects idea sources on list revalidate before projection writes", async () => {
    const mocks = makeMocks();
    mocks.loadActiveList.mockResolvedValue({
      id: LIST_ID,
      status: "active",
      version: 3,
      items: [],
      listLabelWarnings: [],
    });
    mocks.loadActiveListSources.mockResolvedValue([
      {
        menuId: MENU_ID,
        sourceMenuIdSnapshot: MENU_ID,
        sourceMenuVersion: 1,
        sourceDerivationGroupId: "c1000000-0000-4000-8000-000000000001",
        itemSources: [],
      },
    ]);
    mocks.loadMenuIdentity.mockResolvedValue({
      id: MENU_ID,
      userId: USER_ID,
      version: 1,
      targetMode: "idea",
    });
    const deps = toDeps(mocks);
    await expect(
      revalidateActiveShoppingList(deps, { userId: USER_ID, listId: LIST_ID }),
    ).rejects.toMatchObject({ status: 422, code: "idea_menu_not_supported" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.replaceCurrentSafetyProjection).not.toHaveBeenCalled();
  });

  it("revalidates live identity on reconcile replay and still skips apply", async () => {
    const mocks = makeMocks();
    mocks.findMutationReplay.mockResolvedValue({
      listId: LIST_ID,
      version: 4,
      replayed: true,
    });
    mocks.loadActiveList.mockResolvedValue({
      id: LIST_ID,
      status: "active",
      version: 3,
      items: [],
      listLabelWarnings: [],
    });
    mocks.loadActiveListSources.mockResolvedValue([
      {
        menuId: MENU_ID,
        sourceMenuIdSnapshot: MENU_ID,
        sourceMenuVersion: 1,
        sourceDerivationGroupId: "c1000000-0000-4000-8000-000000000001",
        itemSources: [],
      },
    ]);
    const deps = toDeps(mocks);
    await expect(
      reconcileShoppingList(deps, {
        userId: USER_ID,
        listId: LIST_ID,
        expectedListVersion: 3,
        sourceMenuId: MENU_ID,
        sourceMenuVersion: 1,
        idempotencyKey: IDEMPOTENCY_KEY,
        approval: { addKeys: [], replaceItemIds: [], removeItemIds: [] },
        previewedQuantities: emptyPreviewedQuantities,
      }),
    ).resolves.toEqual({ listId: LIST_ID, version: 4, replayed: true });
    expect(mocks.loadMenuIdentity).toHaveBeenCalled();
    expect(mocks.applyReconciliation).not.toHaveBeenCalled();
  });

  it("rejects idea menus on reconcile after replay miss without full aggregate", async () => {
    const mocks = makeMocks();
    mocks.findMutationReplay.mockResolvedValue(null);
    mocks.loadActiveList.mockResolvedValue({
      id: LIST_ID,
      status: "active",
      version: 3,
      items: [],
      listLabelWarnings: [],
    });
    mocks.loadMenuIdentity.mockResolvedValue({
      id: MENU_ID,
      userId: USER_ID,
      version: 1,
      targetMode: "idea",
    });
    const deps = toDeps(mocks);
    await expect(
      reconcileShoppingList(deps, {
        userId: USER_ID,
        listId: LIST_ID,
        expectedListVersion: 3,
        sourceMenuId: MENU_ID,
        sourceMenuVersion: 1,
        idempotencyKey: IDEMPOTENCY_KEY,
        approval: { addKeys: [], replaceItemIds: [], removeItemIds: [] },
        previewedQuantities: emptyPreviewedQuantities,
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: "idea_menu_not_supported",
    });
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.loadMenu).not.toHaveBeenCalled();
    expect(mocks.applyReconciliation).not.toHaveBeenCalled();
  });

  it("prefers idea_menu_not_supported over list_version_conflict on dual-fault reconcile", async () => {
    // SQL と同じ identity 優先: idea 出典 + stale expectedListVersion では
    // list_version_conflict ではなく idea_menu_not_supported を返す。
    const mocks = makeMocks();
    mocks.findMutationReplay.mockResolvedValue(null);
    mocks.loadActiveList.mockResolvedValue({
      id: LIST_ID,
      status: "active",
      version: 3,
      items: [],
      listLabelWarnings: [],
    });
    mocks.loadMenuIdentity.mockResolvedValue({
      id: MENU_ID,
      userId: USER_ID,
      version: 1,
      targetMode: "idea",
    });
    const deps = toDeps(mocks);
    await expect(
      reconcileShoppingList(deps, {
        userId: USER_ID,
        listId: LIST_ID,
        expectedListVersion: 2,
        sourceMenuId: MENU_ID,
        sourceMenuVersion: 1,
        idempotencyKey: IDEMPOTENCY_KEY,
        approval: { addKeys: [], replaceItemIds: [], removeItemIds: [] },
        previewedQuantities: emptyPreviewedQuantities,
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: "idea_menu_not_supported",
    });
    expect(mocks.loadMenuIdentity).toHaveBeenCalledWith(MENU_ID);
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.loadMenu).not.toHaveBeenCalled();
    expect(mocks.loadActiveList).not.toHaveBeenCalled();
    expect(mocks.applyReconciliation).not.toHaveBeenCalled();
  });

  it("prefers idea_menu_not_supported over list_version_conflict on dual-fault preview", async () => {
    const mocks = makeMocks();
    mocks.loadActiveList.mockResolvedValue({
      id: LIST_ID,
      status: "active",
      version: 3,
      items: [],
      listLabelWarnings: [],
    });
    mocks.loadMenuIdentity.mockResolvedValue({
      id: MENU_ID,
      userId: USER_ID,
      version: 1,
      targetMode: "idea",
    });
    const deps = toDeps(mocks);
    await expect(
      previewShoppingListDiff(deps, {
        userId: USER_ID,
        listId: LIST_ID,
        sourceMenuId: MENU_ID,
        sourceMenuVersion: 1,
        expectedListVersion: 2,
      }),
    ).rejects.toMatchObject({ status: 422, code: "idea_menu_not_supported" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.loadMenu).not.toHaveBeenCalled();
    expect(mocks.loadActiveList).not.toHaveBeenCalled();
  });

  it("rejects idea reconcile with matching versions without revalidate or loadMenu", async () => {
    // matching list/menu versions でも mode 拒否は full aggregate より前。
    const mocks = makeMocks();
    mocks.findMutationReplay.mockResolvedValue(null);
    mocks.loadActiveList.mockResolvedValue({
      id: LIST_ID,
      status: "active",
      version: 3,
      items: [],
      listLabelWarnings: [],
    });
    mocks.loadMenuIdentity.mockResolvedValue({
      id: MENU_ID,
      userId: USER_ID,
      version: 1,
      targetMode: "idea",
    });
    const deps = toDeps(mocks);
    await expect(
      reconcileShoppingList(deps, {
        userId: USER_ID,
        listId: LIST_ID,
        expectedListVersion: 3,
        sourceMenuId: MENU_ID,
        sourceMenuVersion: 1,
        idempotencyKey: IDEMPOTENCY_KEY,
        approval: { addKeys: [], replaceItemIds: [], removeItemIds: [] },
        previewedQuantities: emptyPreviewedQuantities,
      }),
    ).rejects.toMatchObject({ status: 422, code: "idea_menu_not_supported" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.loadMenu).not.toHaveBeenCalled();
    expect(mocks.loadActiveList).not.toHaveBeenCalled();
  });
});

describe("reconcile identity priority order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    {
      name: "idea source beats stale list version",
      targetMode: "idea" as const,
      expectedListVersion: 2,
      sourceMenuVersion: 1,
      expectedCode: "idea_menu_not_supported",
      expectedStatus: 422,
      shouldLoadList: false,
    },
    {
      name: "household identity then stale list version",
      targetMode: "household" as const,
      expectedListVersion: 2,
      sourceMenuVersion: 1,
      expectedCode: "list_version_conflict",
      expectedStatus: 409,
      shouldLoadList: true,
    },
    {
      name: "stale source menu version before list load",
      targetMode: "household" as const,
      expectedListVersion: 3,
      sourceMenuVersion: 99,
      expectedCode: "source_menu_version_conflict",
      expectedStatus: 409,
      shouldLoadList: false,
    },
  ])(
    "documents priority: $name",
    async ({
      targetMode,
      expectedListVersion,
      sourceMenuVersion,
      expectedCode,
      expectedStatus,
      shouldLoadList,
    }) => {
      const mocks = makeMocks();
      mocks.findMutationReplay.mockResolvedValue(null);
      mocks.loadMenuIdentity.mockResolvedValue({
        id: MENU_ID,
        userId: USER_ID,
        version: 1,
        targetMode,
      });
      mocks.loadActiveList.mockResolvedValue({
        id: LIST_ID,
        status: "active",
        version: 3,
        items: [],
        listLabelWarnings: [],
      });
      // household で source version が一致するときだけ loadMenu が version 1 を返す。
      // sourceMenuVersion 不一致は loadMenu 後に弾くため、menu.version は常に 1。
      mocks.loadMenu.mockResolvedValue(makeMenu({ version: 1 }));
      const deps = toDeps(mocks);
      await expect(
        reconcileShoppingList(deps, {
          userId: USER_ID,
          listId: LIST_ID,
          expectedListVersion,
          sourceMenuId: MENU_ID,
          sourceMenuVersion,
          idempotencyKey: IDEMPOTENCY_KEY,
          approval: { addKeys: [], replaceItemIds: [], removeItemIds: [] },
          previewedQuantities: emptyPreviewedQuantities,
        }),
      ).rejects.toMatchObject({ status: expectedStatus, code: expectedCode });
      if (targetMode === "idea") {
        expect(mocks.revalidate).not.toHaveBeenCalled();
        expect(mocks.loadMenu).not.toHaveBeenCalled();
      }
      if (shouldLoadList) {
        expect(mocks.loadActiveList).toHaveBeenCalled();
      } else {
        expect(mocks.loadActiveList).not.toHaveBeenCalled();
      }
      expect(mocks.applyReconciliation).not.toHaveBeenCalled();
    },
  );
});
