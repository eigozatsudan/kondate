import { expect, it } from "vitest";
import { computeShoppingDiff, resolveApprovedDiff } from "./diff.js";
import type { ShoppingDraft, ShoppingLabelSnapshot, ShoppingList } from "../contracts/shopping.js";

it("does not propose checked, manual, edited, or removed rows", () => {
  const current = makeShoppingList([
    makeItem({ id: "10000000-0000-4000-8000-000000000001", isChecked: true }),
    makeItem({ id: "10000000-0000-4000-8000-000000000002", isManual: true }),
    makeItem({ id: "10000000-0000-4000-8000-000000000003", isManuallyEdited: true }),
    makeItem({ id: "10000000-0000-4000-8000-000000000004", isRemovedByUser: true }),
  ]);
  const diff = computeShoppingDiff(current, { items: [], listLabelWarnings: [] });
  expect(diff.remove.map((operation) => operation.itemId)).toEqual([]);
  expect(diff.protectedItemIds).toHaveLength(4);
});

it("matches repeated ambiguous rows one-to-one without dropping warnings", () => {
  const first = {
    ...makeDraft().items[0]!,
    key: "salt-small",
    displayName: "塩",
    normalizedName: "塩",
    storeSection: "seasonings" as const,
    quantityValue: null,
    quantityText: "少々",
    unit: null,
    labelWarnings: [makeShoppingWarning({ sourceDisplayName: "塩 少々" })],
  };
  const second = {
    ...first,
    key: "salt-as-needed",
    quantityText: "適量",
    labelWarnings: [makeShoppingWarning({ sourceDisplayName: "塩 適量" })],
  };
  const diff = computeShoppingDiff(makeShoppingList([]), {
    items: [first, second],
    listLabelWarnings: [],
  });
  expect(
    diff.add.map((item) => [item.key, item.quantityText, item.labelWarnings[0]?.sourceDisplayName]),
  ).toEqual([
    ["salt-small", "少々", "塩 少々"],
    ["salt-as-needed", "適量", "塩 適量"],
  ]);
});

it("resolves only operation IDs contained in the server diff", () => {
  const diff = computeShoppingDiff(makeShoppingList([]), makeDraft());
  expect(() =>
    resolveApprovedDiff(diff, {
      addKeys: ["client-invented"],
      replaceItemIds: [],
      removeItemIds: [],
    }),
  ).toThrow("approved_diff_mismatch");
});

it("rejects a duplicated approved add key", () => {
  const diff = computeShoppingDiff(makeShoppingList([]), makeDraft());
  expect(() =>
    resolveApprovedDiff(diff, {
      addKeys: ["add-key", "add-key"],
      replaceItemIds: [],
      removeItemIds: [],
    }),
  ).toThrow("approved_diff_mismatch");
});

it("rejects a duplicated approved replacement ID", () => {
  const itemId = "10000000-0000-4000-8000-000000000020";
  const current = makeShoppingList([makeItem({ id: itemId })]);
  const next = makeDraft();
  next.items[0] = {
    ...next.items[0]!,
    displayName: "にんじん",
    normalizedName: "にんじん",
    storeSection: "produce",
    quantityValue: 3,
    quantityText: "3本",
    unit: "本",
  };
  const diff = computeShoppingDiff(current, next);

  expect(() =>
    resolveApprovedDiff(diff, {
      addKeys: [],
      replaceItemIds: [itemId, itemId],
      removeItemIds: [],
    }),
  ).toThrow("approved_diff_mismatch");
});

it("rejects a duplicated approved removal ID", () => {
  const itemId = "10000000-0000-4000-8000-000000000021";
  const diff = computeShoppingDiff(makeShoppingList([makeItem({ id: itemId })]), {
    items: [],
    listLabelWarnings: [],
  });

  expect(() =>
    resolveApprovedDiff(diff, {
      addKeys: [],
      replaceItemIds: [],
      removeItemIds: [itemId, itemId],
    }),
  ).toThrow("approved_diff_mismatch");
});

it("preserves a checked derived row and proposes only its positive required delta", () => {
  const current = makeShoppingList([
    makeItem({
      id: crypto.randomUUID(),
      quantityValue: 1,
      quantityText: "1本",
      unit: "本",
      isChecked: true,
    }),
  ]);
  const next = makeDraft();
  next.items[0] = {
    ...next.items[0]!,
    displayName: "にんじん",
    normalizedName: "にんじん",
    storeSection: "produce",
    quantityValue: 3,
    quantityText: "3本",
    unit: "本",
  };
  const diff = computeShoppingDiff(current, next);
  expect(diff.protectedItemIds).toEqual([current.items[0]!.id]);
  expect(diff.add[0]).toMatchObject({ quantityValue: 2, quantityText: "2本" });
  expect(diff.remove).toEqual([]);
});

it.each(["plain-first", "protected-first"] as const)(
  "prioritizes a protected numeric exact match for %s order",
  (order) => {
    const checkedId = "20000000-0000-4000-8000-000000000010";
    const plainId = "20000000-0000-4000-8000-000000000011";
    const checked = makeItem({
      id: checkedId,
      quantityValue: 100,
      quantityText: "100g",
      unit: "g",
      isChecked: true,
    });
    const plain = makeItem({
      id: plainId,
      quantityValue: 100,
      quantityText: "100g",
      unit: "g",
    });
    const current = makeShoppingList(order === "plain-first" ? [plain, checked] : [checked, plain]);
    const next = makeDraft();
    next.items[0] = {
      ...next.items[0]!,
      key: "carrot-150",
      displayName: "にんじん",
      normalizedName: "にんじん",
      storeSection: "produce",
      quantityValue: 150,
      quantityText: "150g",
      unit: "g",
    };

    const diff = computeShoppingDiff(current, next);
    // SHOP15: 同一 numeric key の合計 200g が所要 150g を既に満たすため delta も plain remove もしない。
    expect(diff.add).toEqual([]);
    expect(diff.replace).toEqual([]);
    expect(diff.remove).toEqual([]);
    expect(diff.protectedItemIds).toEqual([checkedId]);
  },
);

it("adds only the shortfall after counting plain siblings of a protected numeric row (SHOP15)", () => {
  const checkedId = "20000000-0000-4000-8000-000000000040";
  const plainId = "20000000-0000-4000-8000-000000000041";
  const current = makeShoppingList([
    makeItem({
      id: checkedId,
      quantityValue: 100,
      quantityText: "100g",
      unit: "g",
      isChecked: true,
    }),
    makeItem({
      id: plainId,
      quantityValue: 100,
      quantityText: "100g",
      unit: "g",
    }),
  ]);
  const next = makeDraft();
  next.items[0] = {
    ...next.items[0]!,
    key: "carrot-250",
    displayName: "にんじん",
    normalizedName: "にんじん",
    storeSection: "produce",
    quantityValue: 250,
    quantityText: "250g",
    unit: "g",
  };
  const diff = computeShoppingDiff(current, next);
  // 合計 200g 済み → shortfall 50g のみ。plain は被覆行として温存（remove しない）。
  expect(diff.add).toEqual([
    expect.objectContaining({
      key: `carrot-250_delta_${checkedId}`,
      quantityValue: 50,
      quantityText: "50g",
    }),
  ]);
  expect(diff.replace).toEqual([]);
  expect(diff.remove).toEqual([]);
  expect(diff.protectedItemIds).toEqual([checkedId]);
});

it("does not re-add protected delta when previous delta row still covers the requirement (SHOP15)", () => {
  // Check → reconcile higher qty（_delta_ 行適用）→ uncheck 後の再 reconcile を模す。
  // 購入済み 100g + 前回 delta 50g が残った状態で所要 150g なら追加しない。
  const checkedId = "20000000-0000-4000-8000-000000000042";
  const priorDeltaId = "20000000-0000-4000-8000-000000000043";
  const current = makeShoppingList([
    makeItem({
      id: checkedId,
      quantityValue: 100,
      quantityText: "100g",
      unit: "g",
      isChecked: true,
    }),
    makeItem({
      id: priorDeltaId,
      quantityValue: 50,
      quantityText: "50g",
      unit: "g",
    }),
  ]);
  const next = makeDraft();
  next.items[0] = {
    ...next.items[0]!,
    key: "carrot-150",
    displayName: "にんじん",
    normalizedName: "にんじん",
    storeSection: "produce",
    quantityValue: 150,
    quantityText: "150g",
    unit: "g",
  };
  const diff = computeShoppingDiff(current, next);
  expect(diff.add).toEqual([]);
  expect(diff.replace).toEqual([]);
  expect(diff.remove).toEqual([]);
  expect(diff.protectedItemIds).toEqual([checkedId]);
});

it("does not count out-of-scope rows toward protected numeric coverage (SHOP1)", () => {
  // 他献立 B のにんじん 3本（plain・scope 外）を被覆に使うと、A の購入済み 2本
  // + B 3本 = 5 で所要 4 を満たしたことになり shortfall 2本が落ちる。
  const foreignPlainId = "30000000-0000-4000-8000-000000000011";
  const scopedCheckedId = "30000000-0000-4000-8000-000000000012";
  const current = makeShoppingList([
    makeItem({
      id: foreignPlainId,
      quantityValue: 3,
      quantityText: "3本",
      unit: "本",
    }),
    makeItem({
      id: scopedCheckedId,
      quantityValue: 2,
      quantityText: "2本",
      unit: "本",
      isChecked: true,
    }),
  ]);
  const next = makeDraft();
  next.items[0] = {
    ...next.items[0]!,
    key: "carrot-4",
    displayName: "にんじん",
    normalizedName: "にんじん",
    storeSection: "produce",
    quantityValue: 4,
    quantityText: "4本",
    unit: "本",
  };
  const diff = computeShoppingDiff(current, next, {
    scopeItemIds: new Set([scopedCheckedId]),
  });
  expect(diff.add).toEqual([
    expect.objectContaining({
      key: `carrot-4_delta_${scopedCheckedId}`,
      quantityValue: 2,
      quantityText: "2本",
    }),
  ]);
  expect(diff.replace).toEqual([]);
  expect(diff.remove.map((row) => row.itemId)).not.toContain(foreignPlainId);
  expect(diff.protectedItemIds).toEqual([scopedCheckedId]);
});

it("still counts in-scope siblings for SHOP15 coverage when scoped", () => {
  // 同一 lineage の購入済み + 前回 _delta_ が両方 scope 内なら二重加算しない。
  const checkedId = "30000000-0000-4000-8000-000000000013";
  const priorDeltaId = "30000000-0000-4000-8000-000000000014";
  const current = makeShoppingList([
    makeItem({
      id: checkedId,
      quantityValue: 100,
      quantityText: "100g",
      unit: "g",
      isChecked: true,
    }),
    makeItem({
      id: priorDeltaId,
      quantityValue: 50,
      quantityText: "50g",
      unit: "g",
    }),
  ]);
  const next = makeDraft();
  next.items[0] = {
    ...next.items[0]!,
    key: "carrot-150",
    displayName: "にんじん",
    normalizedName: "にんじん",
    storeSection: "produce",
    quantityValue: 150,
    quantityText: "150g",
    unit: "g",
  };
  const diff = computeShoppingDiff(current, next, {
    scopeItemIds: new Set([checkedId, priorDeltaId]),
  });
  expect(diff.add).toEqual([]);
  expect(diff.replace).toEqual([]);
  expect(diff.remove).toEqual([]);
  expect(diff.protectedItemIds).toEqual([checkedId]);
});

it("does not assign protected name fallback across different units (SHOP12)", () => {
  // 購入済み unit=本 に exact が無く、draft が同名 unit=g だけのとき unit 跨ぎ review しない。
  const checkedId = "20000000-0000-4000-8000-000000000044";
  const current = makeShoppingList([
    makeItem({
      id: checkedId,
      displayName: "にんじん",
      normalizedName: "にんじん",
      quantityValue: 1,
      quantityText: "1本",
      unit: "本",
      isChecked: true,
    }),
  ]);
  const next = makeDraft();
  next.items[0] = {
    ...next.items[0]!,
    key: "carrot-100g",
    displayName: "にんじん",
    normalizedName: "にんじん",
    storeSection: "produce",
    quantityValue: 100,
    quantityText: "100g",
    unit: "g",
  };
  const diff = computeShoppingDiff(current, next);
  // fallback で reverse せず、draft 行はそのまま add（unit 不一致の review を付けない）
  expect(diff.add).toEqual([
    expect.objectContaining({
      key: "carrot-100g",
      quantityValue: 100,
      quantityText: "100g",
      unit: "g",
      pantryCheckRequired: false,
    }),
  ]);
  expect(diff.add.some((item) => item.key.includes("_review_"))).toBe(false);
  expect(diff.protectedItemIds).toEqual([checkedId]);
});

it("assigns protected name fallback only when unit matches (SHOP12)", () => {
  // exact key 不一致（quantityText / store 等で ambiguous 側）でも同 unit なら review 可。
  const checkedId = "20000000-0000-4000-8000-000000000045";
  const current = makeShoppingList([
    makeItem({
      id: checkedId,
      displayName: "にんじん",
      normalizedName: "にんじん",
      quantityValue: null,
      quantityText: "適量",
      unit: null,
      storeSection: "produce",
      isChecked: true,
    }),
  ]);
  const next = makeDraft();
  next.items[0] = {
    ...next.items[0]!,
    key: "carrot-small",
    displayName: "にんじん",
    normalizedName: "にんじん",
    storeSection: "produce",
    quantityValue: null,
    quantityText: "少々",
    unit: null,
  };
  const diff = computeShoppingDiff(current, next);
  expect(diff.add).toEqual([
    expect.objectContaining({
      key: `carrot-small_review_${checkedId}`,
      quantityText: "少々",
      unit: null,
      pantryCheckRequired: true,
    }),
  ]);
  expect(diff.protectedItemIds).toEqual([checkedId]);
});

it.each(["plain-first", "protected-first"] as const)(
  "prioritizes a protected ambiguous exact match for %s order",
  (order) => {
    const checkedId = "20000000-0000-4000-8000-000000000012";
    const plainId = "20000000-0000-4000-8000-000000000013";
    const checked = makeItem({
      id: checkedId,
      quantityValue: null,
      quantityText: "適量",
      unit: null,
      isChecked: true,
    });
    const plain = makeItem({
      id: plainId,
      quantityValue: null,
      quantityText: "適量",
      unit: null,
    });
    const current = makeShoppingList(order === "plain-first" ? [plain, checked] : [checked, plain]);
    const next = makeDraft();
    next.items[0] = {
      ...next.items[0]!,
      key: "carrot-as-needed",
      displayName: "にんじん",
      normalizedName: "にんじん",
      storeSection: "produce",
      quantityValue: null,
      quantityText: "適量",
      unit: null,
    };

    const diff = computeShoppingDiff(current, next);
    expect(diff.add).toEqual([
      expect.objectContaining({
        key: `carrot-as-needed_review_${checkedId}`,
        quantityText: "適量",
        pantryCheckRequired: true,
      }),
    ]);
    expect(diff.replace).toEqual([]);
    expect(diff.remove).toEqual([
      expect.objectContaining({
        itemId: plainId,
        quantityText: "適量",
      }),
    ]);
    expect(diff.protectedItemIds).toEqual([checkedId]);
  },
);

it.each(["manual-first", "plain-first"] as const)(
  "does not let a manual row consume an exact candidate for %s order",
  (order) => {
    const manualId = "20000000-0000-4000-8000-000000000014";
    const plainId = "20000000-0000-4000-8000-000000000015";
    const manual = makeItem({
      id: manualId,
      quantityValue: 100,
      quantityText: "100g",
      unit: "g",
      isManual: true,
    });
    const plain = makeItem({
      id: plainId,
      quantityValue: 100,
      quantityText: "100g",
      unit: "g",
    });
    const current = makeShoppingList(order === "manual-first" ? [manual, plain] : [plain, manual]);
    const next = makeDraft();
    next.items[0] = {
      ...next.items[0]!,
      key: "carrot-150",
      displayName: "にんじん",
      normalizedName: "にんじん",
      storeSection: "produce",
      quantityValue: 150,
      quantityText: "150g",
      unit: "g",
    };

    const diff = computeShoppingDiff(current, next);
    expect(diff.add).toEqual([]);
    expect(diff.replace).toEqual([
      expect.objectContaining({
        itemId: plainId,
        next: expect.objectContaining({
          key: "carrot-150",
          quantityText: "150g",
        }) as object,
      }),
    ]);
    expect(diff.remove).toEqual([]);
    expect(diff.protectedItemIds).toEqual([manualId]);
  },
);

it("assigns a next item to only the exact plain-row replacement", () => {
  // protected の同名fallbackより未保護行の完全一致を優先し、同じ候補の二重反映を防ぐ。
  const checkedId = "20000000-0000-4000-8000-000000000001";
  const plainId = "20000000-0000-4000-8000-000000000002";
  const current = makeShoppingList([
    makeItem({
      id: checkedId,
      displayName: "にんじん",
      normalizedName: "にんじん",
      quantityValue: null,
      quantityText: "適量",
      unit: null,
      isChecked: true,
    }),
    makeItem({
      id: plainId,
      displayName: "にんじん",
      normalizedName: "にんじん",
      quantityValue: 100,
      quantityText: "100g",
      unit: "g",
    }),
  ]);
  const next = makeDraft();
  next.items[0] = {
    ...next.items[0]!,
    key: "carrot-150",
    displayName: "にんじん",
    normalizedName: "にんじん",
    quantityValue: 150,
    quantityText: "150g",
    unit: "g",
    storeSection: "produce",
  };
  const diff = computeShoppingDiff(current, next);
  expect(diff).toMatchObject({
    add: [],
    replace: [
      {
        itemId: plainId,
        current: { quantityText: "100g" },
        next: { key: "carrot-150", quantityText: "150g" },
      },
    ],
    remove: [],
    protectedItemIds: [checkedId],
  });

  const resolved = resolveApprovedDiff(diff, {
    addKeys: [],
    replaceItemIds: [plainId],
    removeItemIds: [],
  });
  expect(resolved).toMatchObject({
    add: [],
    replace: [
      {
        existingItemId: plainId,
        key: "carrot-150",
        quantityText: "150g",
      },
    ],
    removeIds: [],
  });
});

it("keeps a removed row and proposes its larger known delta or unknown review item", () => {
  const removed = makeItem({
    quantityValue: 1,
    quantityText: "1本",
    unit: "本",
    isRemovedByUser: true,
  });
  const next = makeDraft();
  next.items[0] = {
    ...next.items[0]!,
    displayName: "にんじん",
    normalizedName: "にんじん",
    quantityValue: 3,
    quantityText: "3本",
    unit: "本",
  };
  expect(computeShoppingDiff(makeShoppingList([removed]), next).add[0]).toMatchObject({
    quantityValue: 2,
    quantityText: "2本",
  });
  // 同 unit の ambiguous 所要は exact 不一致でも unit 一致 fallback で review（在庫確認）
  next.items[0] = {
    ...next.items[0],
    quantityValue: null,
    quantityText: "適量",
    unit: "本",
  };
  expect(computeShoppingDiff(makeShoppingList([removed]), next).add[0]).toMatchObject({
    pantryCheckRequired: true,
    unit: "本",
  });
  // SHOP12: unit 不一致（本 vs null）は protected review に紐づけない
  next.items[0] = { ...next.items[0], quantityValue: null, quantityText: "適量", unit: null };
  const crossUnit = computeShoppingDiff(makeShoppingList([removed]), next);
  expect(crossUnit.add[0]).toMatchObject({
    quantityText: "適量",
    unit: null,
    pantryCheckRequired: false,
  });
  expect(crossUnit.add[0]?.key.includes("_review_")).toBe(false);
});

it("does not treat milli-rounded float noise as a quantity replace (SP-I2)", () => {
  const itemId = "10000000-0000-4000-8000-000000000030";
  const current = makeShoppingList([
    makeItem({
      id: itemId,
      quantityValue: 0.3,
      quantityText: "0.3大さじ",
      unit: "大さじ",
      storeSection: "seasonings",
      displayName: "みりん",
      normalizedName: "みりん",
    }),
  ]);
  const next = makeDraft();
  next.items[0] = {
    ...next.items[0]!,
    displayName: "みりん",
    normalizedName: "みりん",
    storeSection: "seasonings",
    quantityValue: 0.1 + 0.2,
    quantityText: "0.3大さじ",
    unit: "大さじ",
    labelWarnings: [],
  };
  const diff = computeShoppingDiff(current, next);
  expect(diff.replace).toEqual([]);
  expect(diff.add).toEqual([]);
  expect(diff.remove).toEqual([]);
});

it("proposes replace when only label warnings change (SP-I8)", () => {
  const itemId = "10000000-0000-4000-8000-000000000031";
  const warning = makeShoppingWarning({ allergenId: "wheat", sourceId: crypto.randomUUID() });
  const current = makeShoppingList([
    makeItem({
      id: itemId,
      quantityValue: 1,
      quantityText: "1本",
      unit: "本",
      labelWarnings: [],
    }),
  ]);
  const next = makeDraft();
  next.items[0] = {
    ...next.items[0]!,
    displayName: "にんじん",
    normalizedName: "にんじん",
    storeSection: "produce",
    quantityValue: 1,
    quantityText: "1本",
    unit: "本",
    labelWarnings: [warning],
  };
  const diff = computeShoppingDiff(current, next);
  expect(diff.replace).toHaveLength(1);
  expect(diff.replace[0]?.itemId).toBe(itemId);
  expect(diff.replace[0]?.next.labelWarnings).toHaveLength(1);
});

it("does not replace or remove out-of-scope multi-source plain rows", () => {
  const foreignId = "30000000-0000-4000-8000-000000000001";
  const scopedId = "30000000-0000-4000-8000-000000000002";
  const foreign = makeItem({
    id: foreignId,
    displayName: "にんじん",
    normalizedName: "にんじん",
    quantityValue: 1,
    quantityText: "1本",
    unit: "本",
  });
  const scoped = makeItem({
    id: scopedId,
    displayName: "にんじん",
    normalizedName: "にんじん",
    quantityValue: 2,
    quantityText: "2本",
    unit: "本",
  });
  const next = makeDraft();
  next.items[0] = {
    ...next.items[0]!,
    key: "carrot-3",
    displayName: "にんじん",
    normalizedName: "にんじん",
    storeSection: "produce",
    quantityValue: 3,
    quantityText: "3本",
    unit: "本",
  };
  // 他献立の foreign が先に並んでいても scope 内の scoped だけを replace する
  const diff = computeShoppingDiff(makeShoppingList([foreign, scoped]), next, {
    scopeItemIds: new Set([scopedId]),
  });
  expect(diff.replace).toHaveLength(1);
  expect(diff.replace[0]?.itemId).toBe(scopedId);
  expect(diff.replace[0]?.next.quantityValue).toBe(3);
  expect(diff.replace[0]?.next.quantityText).toBe("3本");
  expect(diff.remove.map((row) => row.itemId)).not.toContain(foreignId);
  expect(diff.remove.map((row) => row.itemId)).not.toContain(scopedId);
});

function makeItem(
  overrides: Partial<ShoppingList["items"][number]> = {},
): ShoppingList["items"][number] {
  return {
    id: crypto.randomUUID(),
    listId: "10000000-0000-4000-8000-000000000010",
    displayName: "にんじん",
    normalizedName: "にんじん",
    storeSection: "produce",
    quantityValue: 1,
    quantityText: "1本",
    unit: "本",
    pantryCheckRequired: false,
    isChecked: false,
    isManual: false,
    isManuallyEdited: false,
    isRemovedByUser: false,
    labelWarnings: [],
    ...overrides,
  };
}
function makeShoppingWarning(
  overrides: Partial<ShoppingLabelSnapshot> = {},
): ShoppingLabelSnapshot {
  return {
    confirmationId: null,
    warningKey: "c".repeat(64),
    sourceMenuId: crypto.randomUUID(),
    sourceDerivationGroupId: crypto.randomUUID(),
    sourceType: "ingredient",
    sourceId: crypto.randomUUID(),
    sourcePath: "dishes.0.ingredients.0.name",
    allergenId: "wheat",
    allergenDisplayName: "小麦",
    anonymousMemberRef: "member_1",
    memberDisplayName: "子ども",
    sourceDisplayName: "材料",
    dictionaryVersion: "allergen-v1",
    confirmationStatus: "pending",
    ...overrides,
  };
}
function makeShoppingList(items: ShoppingList["items"]): ShoppingList {
  return {
    id: "10000000-0000-4000-8000-000000000010",
    status: "active",
    version: 1,
    items,
    listLabelWarnings: [],
  };
}
function makeDraft(): ShoppingDraft {
  return {
    items: [
      {
        key: "add-key",
        displayName: "牛乳",
        normalizedName: "牛乳",
        storeSection: "dairy_eggs",
        quantityValue: 1,
        quantityText: "1本",
        unit: "本",
        pantryCheckRequired: false,
        sourceIngredients: [],
        labelWarnings: [],
      },
    ],
    listLabelWarnings: [],
  };
}
