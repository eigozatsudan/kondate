import { z } from "zod";
import { nullablePositiveQuantity } from "./ai-generation-output.js";
import { labelSourceTypes, storeSections } from "./generation.js";

const uuid = z.uuid();
export type StoreSection = (typeof storeSections)[number];

/**
 * draft/list 品目配列の上限。
 * 5 品×50 材料の理論上限に手追加・append 合算の余裕を足した製品天井（無制限 graph を閉じる・S6）。
 */
export const shoppingItemsMax = 500 as const;

/**
 * 1 品目あたり sourceIngredients の上限。
 * dish 材料 max(50) と揃え、合算後の 1 行病理的膨張を閉じる（S8）。
 */
export const shoppingSourceIngredientsMax = 50 as const;

/**
 * 1 品目あたり labelWarnings の上限。
 * emergency labelWarnings.max(200) と同型。list 全体は listLabelWarnings.max(300)（S8）。
 */
export const shoppingItemLabelWarningsMax = 200 as const;

/** 材料・draft・list で AI/pantry と同一の数量正本（天井 + milli グリッド） */
const shoppingQuantityValue = nullablePositiveQuantity;

export const shoppingSourceIngredientSchema = z
  .object({
    ingredientId: uuid,
    dishId: uuid,
    dishName: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(100),
    quantityValue: shoppingQuantityValue,
    quantityText: z.string().trim().min(1).max(60),
    unit: z.string().trim().min(1).max(24).nullable(),
    storeSection: z.enum(storeSections),
  })
  .strict();

export const shoppingLabelSnapshotSchema = z
  .object({
    confirmationId: uuid.nullable(),
    warningKey: z.string().regex(/^[a-f0-9]{64}$/),
    sourceMenuId: uuid,
    sourceDerivationGroupId: uuid,
    sourceType: z.enum(labelSourceTypes),
    sourceId: uuid,
    sourcePath: z.string().trim().min(1).max(200),
    allergenId: z.string().regex(/^[a-z][a-z0-9_]*$/),
    allergenDisplayName: z.string().trim().min(1).max(100),
    anonymousMemberRef: z.string().regex(/^member_[1-9][0-9]*$/),
    memberDisplayName: z.string().trim().min(1).max(100),
    sourceDisplayName: z.string().trim().min(1).max(500),
    dictionaryVersion: z.string().trim().min(1).max(80),
    confirmationStatus: z.enum(["pending", "confirmed"]),
  })
  .strict();

export const shoppingDraftItemSchema = z
  .object({
    key: z.string().min(1).max(200),
    existingItemId: uuid.optional(),
    displayName: z.string().trim().min(1).max(100),
    normalizedName: z.string().trim().min(1).max(100),
    storeSection: z.enum(storeSections),
    quantityValue: shoppingQuantityValue,
    quantityText: z.string().trim().min(1).max(60),
    unit: z.string().trim().min(1).max(24).nullable(),
    pantryCheckRequired: z.boolean(),
    // ネスト配列も天井付き（外側 items max だけでは 1 行の病理的膨張を閉じられない・S8）
    sourceIngredients: z
      .array(shoppingSourceIngredientSchema)
      .min(1)
      .max(shoppingSourceIngredientsMax),
    labelWarnings: z.array(shoppingLabelSnapshotSchema).max(shoppingItemLabelWarningsMax),
  })
  .strict();

export const shoppingDraftSchema = z
  .object({
    items: z.array(shoppingDraftItemSchema).max(shoppingItemsMax),
    listLabelWarnings: z.array(shoppingLabelSnapshotSchema).max(300),
  })
  .strict();

// list 応答も draft 書込と同型の文字列 bound（S8: 巨大文字列の構造受理を閉じる）
export const shoppingItemSchema = z
  .object({
    id: uuid,
    listId: uuid,
    displayName: z.string().trim().min(1).max(100),
    normalizedName: z.string().trim().min(1).max(100),
    storeSection: z.enum(storeSections),
    quantityValue: shoppingQuantityValue,
    quantityText: z.string().trim().min(1).max(60),
    unit: z.string().trim().min(1).max(24).nullable(),
    pantryCheckRequired: z.boolean(),
    isChecked: z.boolean(),
    isManual: z.boolean(),
    isManuallyEdited: z.boolean(),
    isRemovedByUser: z.boolean(),
    labelWarnings: z.array(shoppingLabelSnapshotSchema).max(shoppingItemLabelWarningsMax),
  })
  .strict();

export const shoppingListSchema = z
  .object({
    id: uuid,
    status: z.enum(["active", "archived"]),
    version: z.number().int().positive(),
    items: z.array(shoppingItemSchema).max(shoppingItemsMax),
    listLabelWarnings: z.array(shoppingLabelSnapshotSchema).max(300),
  })
  .strict();

export const shoppingDiffSchema = z
  .object({
    add: z.array(shoppingDraftItemSchema).max(shoppingItemsMax),
    replace: z
      .array(
        z
          .object({
            itemId: uuid,
            current: z
              .object({
                displayName: z.string().trim().min(1).max(100),
                quantityText: z.string().trim().min(1).max(60),
                storeSection: z.enum(storeSections),
              })
              .strict(),
            next: shoppingDraftItemSchema,
          })
          .strict(),
      )
      .max(shoppingItemsMax),
    remove: z
      .array(
        z
          .object({
            itemId: uuid,
            displayName: z.string().trim().min(1).max(100),
            quantityText: z.string().trim().min(1).max(60),
          })
          .strict(),
      )
      .max(shoppingItemsMax),
    protectedItemIds: z.array(uuid).max(shoppingItemsMax),
    listLabelWarnings: z.array(shoppingLabelSnapshotSchema).max(300),
  })
  .strict();

const activeExpectation = z
  .object({
    activeListId: uuid.nullable(),
    expectedListVersion: z.number().int().positive().nullable(),
  })
  .superRefine((value, context) => {
    if ((value.activeListId === null) !== (value.expectedListVersion === null)) {
      context.addIssue({
        code: "custom",
        path: ["expectedListVersion"],
        message: "active_expectation_pair_required",
      });
    }
  });

// residual-intentional (SHOP14): create は sourceMenuVersion 非ピン（menuId identity のみ）。
// reconcile/preview は version 必須。create SQL は write 時 live version を source 刻印する。
export const createShoppingListRequestSchema = z
  .object({
    menuId: uuid,
    mode: z.enum(["new", "append"]),
    activeListId: uuid.nullable(),
    expectedListVersion: z.number().int().positive().nullable(),
    idempotencyKey: uuid,
  })
  .strict()
  .and(activeExpectation)
  .superRefine((value, context) => {
    if (value.mode === "append" && value.activeListId === null) {
      context.addIssue({ code: "custom", path: ["activeListId"], message: "active_list_required" });
    }
  });

export const createShoppingListResponseSchema = z
  .object({
    listId: uuid,
    version: z.number().int().positive(),
    replayed: z.boolean(),
  })
  .strict();

const previewedShoppingQuantityAddSchema = z
  .object({
    key: z.string().min(1).max(200),
    quantityValue: shoppingQuantityValue,
    quantityText: z.string().trim().min(1).max(60),
    pantryCheckRequired: z.boolean(),
  })
  .strict();

const previewedShoppingQuantityReplaceSchema = z
  .object({
    itemId: uuid,
    quantityValue: shoppingQuantityValue,
    quantityText: z.string().trim().min(1).max(60),
    pantryCheckRequired: z.boolean(),
  })
  .strict();

/** 画面が見せた add/replace 数量と在庫確認フラグ。承認キーだけでは preview/apply のずれを縛れない。 */
export const previewedShoppingQuantitiesSchema = z
  .object({
    add: z.array(previewedShoppingQuantityAddSchema).max(shoppingItemsMax),
    replace: z.array(previewedShoppingQuantityReplaceSchema).max(shoppingItemsMax),
  })
  .strict();

export const reconcileShoppingListRequestSchema = z
  .object({
    expectedListVersion: z.number().int().positive(),
    sourceMenuId: uuid,
    sourceMenuVersion: z.number().int().positive(),
    idempotencyKey: uuid,
    approval: z
      .object({
        addKeys: z.array(z.string().min(1).max(200)).max(shoppingItemsMax),
        replaceItemIds: z.array(uuid).max(shoppingItemsMax),
        removeItemIds: z.array(uuid).max(shoppingItemsMax),
      })
      .strict(),
    previewedQuantities: previewedShoppingQuantitiesSchema,
  })
  .strict();

export const reconcileShoppingListResponseSchema = createShoppingListResponseSchema;
export const previewShoppingDiffRequestSchema = z
  .object({
    sourceMenuId: uuid,
    sourceMenuVersion: z.number().int().positive(),
    expectedListVersion: z.number().int().positive(),
  })
  .strict();
export const previewShoppingDiffResponseSchema = shoppingDiffSchema;

export const currentShoppingLabelWarningSchema = z
  .object({
    itemId: uuid.nullable(),
    warningKey: z.string().regex(/^[a-f0-9]{64}$/),
    sourceMenuId: uuid,
    sourceDerivationGroupId: uuid,
    sourceType: z.enum(labelSourceTypes),
    sourceId: uuid,
    sourcePath: z.string().trim().min(1).max(200),
    allergenId: z.string().regex(/^[a-z][a-z0-9_]*$/),
    allergenDisplayName: z.string().trim().min(1).max(100),
    anonymousMemberRef: z.string().regex(/^member_[1-9][0-9]*$/),
    memberDisplayName: z.string().trim().min(1).max(100),
    sourceDisplayName: z.string().trim().min(1).max(500),
    dictionaryVersion: z.string().trim().min(1).max(80),
  })
  .strict();
export const refreshShoppingListSafetyRpcResponseSchema = z
  .object({
    listId: uuid,
    safetyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    currentLabelWarnings: z.array(currentShoppingLabelWarningSchema).max(300),
  })
  .strict();
export const shoppingListSafetyDataSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("valid"),
      safetyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      checkedSourceMenuIds: z.array(uuid).max(50),
      currentLabelWarnings: z.array(currentShoppingLabelWarningSchema).max(300),
      issues: z.array(z.never()),
    })
    .strict(),
  z
    .object({
      status: z.enum(["invalid", "unverifiable"]),
      safetyFingerprint: z.null(),
      checkedSourceMenuIds: z.array(uuid).max(50),
      currentLabelWarnings: z.array(z.never()),
      issues: z
        .array(
          z
            .object({
              code: z.enum([
                "source_menu_unavailable",
                "current_safety_invalid",
                "safety_check_failed",
              ]),
              message: z.string().trim().min(1).max(200),
              sourceMenuId: uuid.nullable(),
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
]);
export type ShoppingListSafetyData = z.infer<typeof shoppingListSafetyDataSchema>;
export type CurrentShoppingLabelWarning = z.infer<typeof currentShoppingLabelWarningSchema>;
export type RefreshShoppingListSafetyRpcResponse = z.infer<
  typeof refreshShoppingListSafetyRpcResponseSchema
>;

const mutationBase = {
  listId: uuid,
  expectedListVersion: z.number().int().positive(),
  expectedSafetyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: uuid,
};
export const shoppingItemMutationRequestSchema = z.discriminatedUnion("operation", [
  z
    .object({
      ...mutationBase,
      operation: z.literal("add_manual"),
      itemId: z.null(),
      payload: z
        .object({
          displayName: z.string().trim().min(1).max(100),
          normalizedName: z.string().trim().min(1).max(100),
          storeSection: z.enum(storeSections),
          quantityValue: shoppingQuantityValue,
          quantityText: z.string().trim().min(1).max(60),
          unit: z.string().trim().min(1).max(24).nullable(),
          pantryCheckRequired: z.literal(false),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...mutationBase,
      operation: z.literal("set_checked"),
      itemId: uuid,
      payload: z.object({ isChecked: z.boolean() }).strict(),
    })
    .strict(),
  z
    .object({
      ...mutationBase,
      operation: z.literal("edit"),
      itemId: uuid,
      payload: z
        .object({
          displayName: z.string().trim().min(1).max(100),
          normalizedName: z.string().trim().min(1).max(100),
          storeSection: z.enum(storeSections),
          quantityValue: shoppingQuantityValue,
          quantityText: z.string().trim().min(1).max(60),
          unit: z.string().trim().min(1).max(24).nullable(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...mutationBase,
      operation: z.literal("remove"),
      itemId: uuid,
      payload: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      ...mutationBase,
      operation: z.literal("mark_at_home"),
      itemId: uuid,
      payload: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      ...mutationBase,
      operation: z.literal("undo"),
      itemId: uuid,
      payload: z.object({}).strict(),
    })
    .strict(),
]);
export const shoppingItemMutationResponseSchema = z
  .object({
    listId: uuid,
    version: z.number().int().positive(),
    itemId: uuid,
    replayed: z.boolean(),
  })
  .strict();

export type ShoppingSourceIngredient = z.infer<typeof shoppingSourceIngredientSchema>;
export type ShoppingLabelSnapshot = z.infer<typeof shoppingLabelSnapshotSchema>;
export type ShoppingDraftItem = z.infer<typeof shoppingDraftItemSchema>;
export type ShoppingDraft = z.infer<typeof shoppingDraftSchema>;
export type ShoppingItem = z.infer<typeof shoppingItemSchema>;
export type ShoppingList = z.infer<typeof shoppingListSchema>;
export type ShoppingDiff = z.infer<typeof shoppingDiffSchema>;
export type CreateShoppingListRequest = z.infer<typeof createShoppingListRequestSchema>;
export type CreateShoppingListResponse = z.infer<typeof createShoppingListResponseSchema>;
export type PreviewedShoppingQuantities = z.infer<typeof previewedShoppingQuantitiesSchema>;
export type ReconcileShoppingListRequest = z.infer<typeof reconcileShoppingListRequestSchema>;
export type ReconcileShoppingListResponse = z.infer<typeof reconcileShoppingListResponseSchema>;
export type PreviewShoppingDiffRequest = z.infer<typeof previewShoppingDiffRequestSchema>;
export type PreviewShoppingDiffResponse = z.infer<typeof previewShoppingDiffResponseSchema>;
export type ShoppingItemMutationRequest = z.infer<typeof shoppingItemMutationRequestSchema>;
export type ShoppingItemMutationResponse = z.infer<typeof shoppingItemMutationResponseSchema>;
