import { z } from "zod";
import { labelSourceTypes, validatedMenuSchema } from "../contracts/generation.js";

const memberRefSchema = z.string().regex(/^member_[1-9][0-9]*$/u);
const allergenIdSchema = z.string().regex(/^[a-z][a-z0-9_]*$/u);
const humanTextSchema = z.string().trim().min(1).max(300);

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

export const emergencyMenusDataSchema = z
  .object({
    fixtureVersion: z.string().trim().min(1),
    candidates: z.array(emergencyMenuCandidateSchema),
    message: z.string().trim().min(1),
    consumesAiQuota: z.literal(false),
  })
  .strict();

export type EmergencyLabelWarning = z.infer<typeof emergencyLabelWarningSchema>;
export type EmergencyMenuCandidate = z.infer<typeof emergencyMenuCandidateSchema>;
export type EmergencyMenusData = z.infer<typeof emergencyMenusDataSchema>;
