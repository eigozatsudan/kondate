import { z } from "zod";
import { labelSourceTypes, validatedMenuSchema } from "../contracts/generation.js";

const memberRefSchema = z.string().regex(/^member_[1-9][0-9]*$/u);
const allergenIdSchema = z.string().regex(/^[a-z][a-z0-9_]*$/u);
const humanTextSchema = z.string().trim().min(1).max(300);

const emergencyMainIngredientSchema = z
  .string()
  .transform((value) => value.normalize("NFKC").trim())
  .refine((value) => {
    const length = Array.from(value).length;
    return length >= 1 && length <= 80;
  }, "メイン食材は1〜80文字で入力してください");

export const emergencyMainIngredientsSchema = z
  .array(emergencyMainIngredientSchema)
  .max(8)
  .refine((values) => new Set(values).size === values.length, "メイン食材は重複なしにしてください");

export const emergencyLabelWarningSchema = z
  .object({
    sourceType: z.enum(labelSourceTypes),
    sourceId: z.uuid(),
    sourcePath: z.string().trim().min(1).max(200),
    sourceDisplayName: humanTextSchema,
    allergenId: allergenIdSchema,
    allergenDisplayName: humanTextSchema,
    anonymousMemberRef: memberRefSchema,
    memberDisplayName: humanTextSchema,
    dictionaryVersion: z.string().trim().min(1).max(80),
    confirmationStatus: z.literal("pending"),
  })
  .strict();

export const emergencyMenuCandidateSchema = z
  .object({
    menu: validatedMenuSchema,
    memberLabels: z.record(memberRefSchema, humanTextSchema),
    allergenLabels: z.record(allergenIdSchema, humanTextSchema),
    labelWarnings: z.array(emergencyLabelWarningSchema).max(200),
  })
  .strict()
  .superRefine((value, context) => {
    const requiredRefs = new Set(value.menu.adaptations.map((item) => item.anonymousMemberRef));
    for (const ref of requiredRefs) {
      if (value.memberLabels[ref] === undefined) {
        context.addIssue({
          code: "custom",
          path: ["memberLabels", ref],
          message: "対象者の表示名が必要です",
        });
      }
    }
    const requiredAllergenIds = new Set(
      value.menu.labelConfirmations.map((item) => item.allergenId),
    );
    if (
      Object.keys(value.allergenLabels).length !== requiredAllergenIds.size ||
      [...requiredAllergenIds].some((id) => value.allergenLabels[id] === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["allergenLabels"],
        message: "原材料表示確認のアレルゲン表示名が必要です",
      });
    }
    if (value.labelWarnings.length !== value.menu.labelConfirmations.length) {
      context.addIssue({
        code: "custom",
        path: ["labelWarnings"],
        message: "すべての原材料表示確認に人向け表示が必要です",
      });
    }
    for (const [index, confirmation] of value.menu.labelConfirmations.entries()) {
      const warning = value.labelWarnings[index];
      if (
        warning === undefined ||
        warning.sourceType !== confirmation.sourceType ||
        warning.sourceId !== confirmation.sourceId ||
        warning.sourcePath !== confirmation.sourcePath ||
        warning.sourceDisplayName !== confirmation.sourceText ||
        warning.allergenId !== confirmation.allergenId ||
        warning.allergenDisplayName !== value.allergenLabels[confirmation.allergenId] ||
        warning.anonymousMemberRef !== confirmation.anonymousMemberRef ||
        warning.memberDisplayName !== value.memberLabels[confirmation.anonymousMemberRef] ||
        warning.dictionaryVersion !== confirmation.dictionaryVersion
      ) {
        context.addIssue({
          code: "custom",
          path: ["labelWarnings", index],
          message: "原材料表示確認と人向け警告の対応が一致しません",
        });
      }
    }
  });

export const emergencyMatchModes = ["none", "main_ingredient", "safety_only"] as const;
// no_matching_fixture は歴史的名称。意味は S1（fixture）∪S2（community）を通しても
// Stage S 通過候補がゼロのとき（wire 互換のため値は変えない）。
export const emergencyEmptyReasons = ["current_safety_unavailable", "no_matching_fixture"] as const;
export const emergencyPaths = ["household", "idea"] as const;

export type EmergencyMatchMode = (typeof emergencyMatchModes)[number];
export type EmergencyEmptyReason = (typeof emergencyEmptyReasons)[number];
export type EmergencyPath = (typeof emergencyPaths)[number];

export const emergencyMenusDataSchema = z
  .object({
    fixtureVersion: z.string().trim().min(1),
    candidates: z.array(emergencyMenuCandidateSchema),
    message: z.string().trim().min(1),
    consumesAiQuota: z.literal(false),
    path: z.enum(emergencyPaths),
    matchMode: z.enum(emergencyMatchModes).nullable(),
    emptyReason: z.enum(emergencyEmptyReasons).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const nonEmpty = value.candidates.length > 0;
    if (nonEmpty) {
      if (value.emptyReason !== null || value.matchMode === null) {
        context.addIssue({
          code: "custom",
          message: "非空候補では emptyReason=null かつ matchMode 必須",
        });
      }
    } else if (value.emptyReason === null || value.matchMode !== null) {
      context.addIssue({
        code: "custom",
        message: "空候補では emptyReason 必須かつ matchMode=null",
      });
    }
    if (
      value.path === "idea" &&
      value.emptyReason !== null &&
      value.emptyReason !== "no_matching_fixture"
    ) {
      context.addIssue({
        code: "custom",
        path: ["emptyReason"],
        message: "idea の emptyReason は no_matching_fixture のみ",
      });
    }
  });

export type EmergencyLabelWarning = z.infer<typeof emergencyLabelWarningSchema>;
export type EmergencyMenuCandidate = z.infer<typeof emergencyMenuCandidateSchema>;
export type EmergencyMenusData = z.infer<typeof emergencyMenusDataSchema>;
