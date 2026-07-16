import { z } from "zod";
import { pantryPriorities } from "./domain.js";

export const expirationTypes = ["use_by", "best_before", "other", "unknown"] as const;
export const openedStates = ["unopened", "opened", "unknown"] as const;
export const pantryUsageStatuses = ["used", "unused"] as const;

function boundedCanonicalText(min: number, max: number) {
  return z
    .string()
    .trim()
    .refine(
      (value) => {
        const length = Array.from(value).length;
        return length >= min && length <= max;
      },
      { message: `${String(min)}〜${String(max)}文字で入力してください` },
    );
}

const nullableUnitSchema = boundedCanonicalText(1, 24).nullable();
const nullableQuantitySchema = z.number().positive().max(999_999).multipleOf(0.001).nullable();

export const pantryItemInputSchema = z
  .object({
    name: boundedCanonicalText(1, 80),
    quantity: nullableQuantitySchema,
    unit: nullableUnitSchema,
    expiresOn: z.iso.date().nullable(),
    expirationType: z.enum(expirationTypes).nullable(),
    openedState: z.enum(openedStates).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.quantity === null) !== (value.unit === null)) {
      context.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "分量と単位は両方入力してください",
      });
    }
  });

export const pantryItemSchema = pantryItemInputSchema.safeExtend({
  id: z.uuid(),
  userId: z.uuid(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const pantrySelectionDraftSchema = z
  .object({
    pantryItemId: z.uuid(),
    priority: z.enum(pantryPriorities),
  })
  .strict();

const pantryUsageObjectSchema = z
  .object({
    selectionId: z.uuid(),
    pantryItemId: z.uuid().nullable(),
    pantryItemName: boundedCanonicalText(1, 80),
    priority: z.enum(pantryPriorities),
    usageStatus: z.enum(pantryUsageStatuses),
    plannedQuantity: nullableQuantitySchema,
    inventoryQuantity: nullableQuantitySchema,
    shortageQuantity: z.number().min(0).max(999_999).multipleOf(0.001).nullable(),
    unit: nullableUnitSchema,
    dishIds: z.array(z.uuid()),
    unusedReason: boundedCanonicalText(1, 200).nullable(),
  })
  .strict();

function validatePantryUsage(
  value: z.infer<typeof pantryUsageObjectSchema>,
  context: z.RefinementCtx,
  requireUnusedReason: boolean,
): void {
  if (value.priority === "must_use" && value.usageStatus === "unused") {
    context.addIssue({
      code: "custom",
      path: ["usageStatus"],
      message: "必ず使う食材が未使用です",
    });
  }
  if (value.usageStatus === "used" && value.dishIds.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["dishIds"],
      message: "使用先の料理が必要です",
    });
  }
  if (requireUnusedReason && value.usageStatus === "unused" && value.unusedReason === null) {
    context.addIssue({
      code: "custom",
      path: ["unusedReason"],
      message: "未使用理由が必要です",
    });
  }
  if (value.usageStatus === "used" && value.unusedReason !== null) {
    context.addIssue({
      code: "custom",
      path: ["unusedReason"],
      message: "使用時に未使用理由は保存しません",
    });
  }
  if (
    (value.plannedQuantity === null || value.inventoryQuantity === null) &&
    value.shortageQuantity !== null
  ) {
    context.addIssue({
      code: "custom",
      path: ["shortageQuantity"],
      message: "数量未入力時に不足量は保存しません",
    });
  }
  const hasQuantity =
    value.plannedQuantity !== null ||
    value.inventoryQuantity !== null ||
    value.shortageQuantity !== null;
  if (hasQuantity !== (value.unit !== null)) {
    context.addIssue({
      code: "custom",
      path: ["unit"],
      message: "数量がある場合だけ単位を入力してください",
    });
  }
  if (value.plannedQuantity !== null && value.inventoryQuantity !== null) {
    const plannedQuantityUnits = Math.round(value.plannedQuantity * 1000);
    const inventoryQuantityUnits = Math.round(value.inventoryQuantity * 1000);
    const shortageQuantityUnits =
      value.shortageQuantity === null ? null : Math.round(value.shortageQuantity * 1000);
    const expectedQuantityUnits = Math.max(plannedQuantityUnits - inventoryQuantityUnits, 0);
    if (shortageQuantityUnits !== expectedQuantityUnits) {
      context.addIssue({
        code: "custom",
        path: ["shortageQuantity"],
        message: "不足量が在庫量と一致しません",
      });
    }
  }
}

// AI出力では未使用理由の意味エラーを validator の専用コードへ委ねます。
export const generatedPantryUsageSchema = pantryUsageObjectSchema.superRefine((value, context) => {
  validatePantryUsage(value, context, false);
});

export const pantryUsageSchema = pantryUsageObjectSchema.superRefine((value, context) => {
  validatePantryUsage(value, context, true);
});

export type ExpirationType = (typeof expirationTypes)[number];
export type OpenedState = (typeof openedStates)[number];
export type PantryItemInput = z.infer<typeof pantryItemInputSchema>;
export type PantryItem = z.infer<typeof pantryItemSchema>;
export type PantrySelectionDraft = z.infer<typeof pantrySelectionDraftSchema>;
export type PantryUsage = z.infer<typeof pantryUsageSchema>;
