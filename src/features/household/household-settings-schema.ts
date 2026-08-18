import { z } from "zod";
import {
  ageBands,
  allergyStatuses,
  easePreferences,
  portionSizes,
  requiredSafetyConstraints,
  spiceLevels,
  unsupportedDietKinds,
  unsupportedDietStatuses,
  type AgeBand,
  type AllergyStatus,
  type EasePreference,
  type PortionSize,
  type RequiredSafetyConstraint,
  type SpiceLevel,
  type UnsupportedDietKind,
  type UnsupportedDietStatus,
} from "@shared/contracts/domain";
import { defaultsForAgeBand } from "./household-defaults";
import {
  UNSUPPORTED_DIET_KINDS_REQUIRED,
  UNSUPPORTED_DIET_STATUS_REQUIRED,
} from "./unsupported-diet-copy";

export const householdSettingsSchema = z
  .object({
    // H10: 31 文字は Zod 4 既定の英語が role=alert に出る。onboarding の 30 字上限と揃えて日本語にする
    // H-R1: 空白のみは value || null で残り、trim 後 min(1) も英語になる
    displayName: z
      .string()
      .trim()
      .min(1, "呼び名は1文字以上で入力してください")
      .max(30, "呼び名は30文字以内で入力してください")
      .nullable(),
    ageBand: z.enum(ageBands, "年齢のめやすを選んでください"),
    allergyStatus: z.enum(allergyStatuses, "アレルギーの確認を選んでください"),
    unsupportedDietStatus: z.enum(unsupportedDietStatuses, UNSUPPORTED_DIET_STATUS_REQUIRED),
    unsupportedDietKinds: z.array(z.enum(unsupportedDietKinds)).max(3),
    requiredSafetyConstraints: z.array(z.enum(requiredSafetyConstraints)).max(2),
    portionSize: z.enum(portionSizes),
    spiceLevel: z.enum(spiceLevels),
    easePreferences: z.array(z.enum(easePreferences)).max(3),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.unsupportedDietStatus === "present" && value.unsupportedDietKinds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["unsupportedDietKinds"],
        message: UNSUPPORTED_DIET_KINDS_REQUIRED,
      });
    }
    if (value.unsupportedDietStatus !== "present" && value.unsupportedDietKinds.length !== 0) {
      context.addIssue({
        code: "custom",
        path: ["unsupportedDietKinds"],
        // 設計 §6: 矛盾状態メッセージは据え置き（共有定数化対象外）
        message: "対象外状態と項目を確認してください",
      });
    }
  });

export type HouseholdSettingsValue = z.infer<typeof householdSettingsSchema>;
export type HouseholdFieldErrors = Partial<Record<keyof HouseholdSettingsValue, string>>;

/**
 * フォーム編集中の一時値。必須 enum が未選択のときは空文字を許す。
 * 保存時は householdSettingsSchema.safeParse で HouseholdSettingsValue に絞る。
 */
export type HouseholdSettingsFormValue = {
  displayName: string | null;
  ageBand: AgeBand | "";
  allergyStatus: AllergyStatus | "";
  unsupportedDietStatus: UnsupportedDietStatus | "";
  unsupportedDietKinds: UnsupportedDietKind[];
  requiredSafetyConstraints: RequiredSafetyConstraint[];
  portionSize: PortionSize;
  spiceLevel: SpiceLevel;
  easePreferences: EasePreference[];
};

export function householdSettingsValuesEqual(
  left: HouseholdSettingsValue,
  right: HouseholdSettingsValue,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * 空年齢の onChange が adult 既定へ置き換えただけの安全制約か。
 * 幼児既定を空年齢の [] で黙って消さないための判定。明示チェックは false。
 */
function isEmptyAgeLinkedConstraintDefault(
  next: HouseholdSettingsFormValue,
  last: HouseholdSettingsValue,
): boolean {
  if (next.ageBand !== "") {
    return false;
  }
  const emptyAgeDefaults = defaultsForAgeBand("adult");
  const lastAgeDefaults = defaultsForAgeBand(last.ageBand);
  return (
    sameStringArray(next.requiredSafetyConstraints, emptyAgeDefaults.required_safety_constraints) &&
    sameStringArray(last.requiredSafetyConstraints, lastAgeDefaults.required_safety_constraints)
  );
}

/**
 * 全体 schema が落ちても、直前の妥当な保存値へ載せられる項目だけ返す。
 * 年齢＋量/辛さ/食べやすさ/安全制約と、対象外 status＋kinds はセットで検証する。
 * 空年齢や present+kinds 0 を部分適用してデフォルトや矛盾 kinds を黙って書かない。
 * 空年齢でもユーザーが明示した安全制約は last の年齢へ載せる（H-R2）。
 * last も不正なら undefined（呼び出し側は従来どおり全体 parse 失敗へ）。
 */
export function persistableHouseholdSettings(
  next: HouseholdSettingsFormValue,
  lastPersisted: HouseholdSettingsFormValue,
): HouseholdSettingsValue | undefined {
  const full = householdSettingsSchema.safeParse(next);
  if (full.success) {
    return full.data;
  }
  const last = householdSettingsSchema.safeParse(lastPersisted);
  if (!last.success) {
    return undefined;
  }

  const groups: Partial<HouseholdSettingsFormValue>[] = [
    { displayName: next.displayName },
    {
      ageBand: next.ageBand,
      portionSize: next.portionSize,
      spiceLevel: next.spiceLevel,
      easePreferences: next.easePreferences,
      requiredSafetyConstraints: next.requiredSafetyConstraints,
    },
    { allergyStatus: next.allergyStatus },
    {
      unsupportedDietStatus: next.unsupportedDietStatus,
      unsupportedDietKinds: next.unsupportedDietKinds,
    },
  ];

  // H-R2: 空年齢で年齢セット全体が落ちても、明示した小さく切る/骨を除くは last の年齢へ載せる。
  // 空年齢の adult 既定へ置き換わっただけの制約は載せない（H3 の黙った既定上書き防止を維持）。
  if (next.ageBand === "" && !isEmptyAgeLinkedConstraintDefault(next, last.data)) {
    groups.push({ requiredSafetyConstraints: next.requiredSafetyConstraints });
  }

  let candidate: HouseholdSettingsValue = last.data;
  for (const group of groups) {
    const parsed = householdSettingsSchema.safeParse({ ...candidate, ...group });
    if (parsed.success) {
      candidate = parsed.data;
    }
  }
  return candidate;
}

/**
 * 空白のみの呼び名は未設定（null）。
 * DB CHECK は btrim せず char_length 1–30 のため "   " を通す。settings schema は
 * trim().min(1) で同じ値を拒否し、アレルギー/年齢の PATCH 全体が落ちる。
 */
export function normalizeOptionalDisplayName(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  return value.trim() === "" ? null : value;
}

/** household_members 行のうち、フォーム初期化に使う列（string 境界の生値） */
export type HouseholdMemberSettingsRow = {
  display_name: string | null;
  age_band: string | null;
  allergy_status: string | null;
  unsupported_diet_status: string | null;
  unsupported_diet_kinds: string[];
  required_safety_constraints: string[];
  portion_size: string | null;
  spice_level: string | null;
  ease_preferences: string[];
};

export function toHouseholdFieldErrors(
  error: z.ZodError<HouseholdSettingsValue>,
): HouseholdFieldErrors {
  const result: HouseholdFieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path.at(0);
    if (typeof field !== "string" || !(field in householdSettingsSchema.shape)) continue;
    const key = field as keyof HouseholdSettingsValue;
    result[key] ??= issue.message;
  }
  return result;
}

/** 単一 enum 列を schema で検証。不正・null は undefined（呼び出し側で空/デフォルトへ） */
function parseEnumField<T extends string>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * 配列 enum 列を要素ごとに schema 検証し、不正要素は捨てる。
 * max を超える分は先頭から採用（保存 schema の .max と整合）。
 */
function parseEnumArrayField<T extends string>(
  itemSchema: z.ZodType<T>,
  value: unknown,
  max: number,
): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: T[] = [];
  for (const item of value) {
    const parsed = itemSchema.safeParse(item);
    if (!parsed.success) {
      continue;
    }
    result.push(parsed.data);
    if (result.length >= max) {
      break;
    }
  }
  return result;
}

/**
 * H12: DB 行 → フォーム初期値。unchecked cast を使わず schema で検証する。
 * - 必須選択（年齢・アレルギー・対象外事情）の不正/null は空文字（未選択 UI）
 * - 量・辛さの不正/null は年齢デフォルト（年齢不正時は adult 相当）
 * - 配列の不正要素は除外。完全に schema を満たす行は parse 結果を返す
 */
export function householdSettingsValueFromDbRow(
  row: HouseholdMemberSettingsRow,
): HouseholdSettingsFormValue {
  // superRefine 後の ZodEffects に依存せず、保存 schema と同じ enum 集合で検証する
  const ageBand = parseEnumField(z.enum(ageBands), row.age_band);
  // デフォルト算出用。フォーム表示の ageBand 空とは分離（従来どおり null 時は adult 既定）
  const defaults = defaultsForAgeBand(ageBand ?? "adult");

  const formValue: HouseholdSettingsFormValue = {
    displayName: normalizeOptionalDisplayName(row.display_name),
    ageBand: ageBand ?? "",
    allergyStatus: parseEnumField(z.enum(allergyStatuses), row.allergy_status) ?? "",
    unsupportedDietStatus:
      parseEnumField(z.enum(unsupportedDietStatuses), row.unsupported_diet_status) ?? "",
    unsupportedDietKinds: parseEnumArrayField(
      z.enum(unsupportedDietKinds),
      row.unsupported_diet_kinds,
      3,
    ),
    requiredSafetyConstraints: parseEnumArrayField(
      z.enum(requiredSafetyConstraints),
      row.required_safety_constraints,
      2,
    ),
    portionSize: parseEnumField(z.enum(portionSizes), row.portion_size) ?? defaults.portion_size,
    spiceLevel: parseEnumField(z.enum(spiceLevels), row.spice_level) ?? defaults.spice_level,
    easePreferences: parseEnumArrayField(z.enum(easePreferences), row.ease_preferences, 3),
  };

  // 完全に妥当なら superRefine 込みの schema 結果を採用（型も HouseholdSettingsValue）
  const full = householdSettingsSchema.safeParse(formValue);
  if (full.success) {
    return full.data;
  }
  return formValue;
}
