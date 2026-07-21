import { z } from "zod";
import { labelSourceTypes, storeSections } from "./generation.js";

const uuid = z.uuid();
export type StoreSection = (typeof storeSections)[number];

export const shoppingSourceIngredientSchema = z
  .object({
    ingredientId: uuid,
    dishId: uuid,
    dishName: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(100),
    quantityValue: z.number().positive().nullable(),
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
    quantityValue: z.number().positive().nullable(),
    quantityText: z.string().trim().min(1).max(60),
    unit: z.string().trim().min(1).max(24).nullable(),
    pantryCheckRequired: z.boolean(),
    sourceIngredients: z.array(shoppingSourceIngredientSchema).min(1),
    labelWarnings: z.array(shoppingLabelSnapshotSchema),
  })
  .strict();

export const shoppingDraftSchema = z
  .object({
    items: z.array(shoppingDraftItemSchema),
    listLabelWarnings: z.array(shoppingLabelSnapshotSchema),
  })
  .strict();

export const shoppingItemSchema = z
  .object({
    id: uuid,
    listId: uuid,
    displayName: z.string(),
    normalizedName: z.string(),
    storeSection: z.enum(storeSections),
    quantityValue: z.number().positive().nullable(),
    quantityText: z.string(),
    unit: z.string().nullable(),
    pantryCheckRequired: z.boolean(),
    isChecked: z.boolean(),
    isManual: z.boolean(),
    isManuallyEdited: z.boolean(),
    isRemovedByUser: z.boolean(),
    labelWarnings: z.array(shoppingLabelSnapshotSchema),
  })
  .strict();

export const shoppingListSchema = z
  .object({
    id: uuid,
    status: z.enum(["active", "archived"]),
    version: z.number().int().positive(),
    items: z.array(shoppingItemSchema),
    listLabelWarnings: z.array(shoppingLabelSnapshotSchema),
  })
  .strict();

export const shoppingDiffSchema = z
  .object({
    add: z.array(shoppingDraftItemSchema),
    replace: z.array(
      z
        .object({
          itemId: uuid,
          current: z
            .object({
              displayName: z.string(),
              quantityText: z.string(),
              storeSection: z.enum(storeSections),
            })
            .strict(),
          next: shoppingDraftItemSchema,
        })
        .strict(),
    ),
    remove: z.array(
      z.object({ itemId: uuid, displayName: z.string(), quantityText: z.string() }).strict(),
    ),
    protectedItemIds: z.array(uuid),
    listLabelWarnings: z.array(shoppingLabelSnapshotSchema),
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

export const reconcileShoppingListRequestSchema = z
  .object({
    expectedListVersion: z.number().int().positive(),
    sourceMenuId: uuid,
    sourceMenuVersion: z.number().int().positive(),
    idempotencyKey: uuid,
    approval: z
      .object({
        addKeys: z.array(z.string().min(1).max(200)),
        replaceItemIds: z.array(uuid),
        removeItemIds: z.array(uuid),
      })
      .strict(),
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
          quantityValue: z.number().positive().nullable(),
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
          quantityValue: z.number().positive().nullable(),
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
export type ReconcileShoppingListRequest = z.infer<typeof reconcileShoppingListRequestSchema>;
export type ReconcileShoppingListResponse = z.infer<typeof reconcileShoppingListResponseSchema>;
export type PreviewShoppingDiffRequest = z.infer<typeof previewShoppingDiffRequestSchema>;
export type PreviewShoppingDiffResponse = z.infer<typeof previewShoppingDiffResponseSchema>;
export type ShoppingItemMutationRequest = z.infer<typeof shoppingItemMutationRequestSchema>;
export type ShoppingItemMutationResponse = z.infer<typeof shoppingItemMutationResponseSchema>;
