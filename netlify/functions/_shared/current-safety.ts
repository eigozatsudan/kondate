import { z } from "zod";
import {
  ageBands,
  allergyStatuses,
  requiredSafetyConstraints,
  unsupportedDietKinds,
  unsupportedDietStatuses,
} from "../../../shared/contracts/domain.js";
import { safetyActionKinds } from "../../../shared/contracts/generation.js";
import type { CurrentSafetyContext } from "../../../shared/safety/context.js";
import {
  currentAllergenCatalogV1,
  currentAllergenCatalogVersion,
} from "../../../shared/safety/current-allergen-catalog.v1.js";
import { currentFoodSafetyRulesV1 } from "../../../shared/safety/current-food-safety-rules.v1.js";
import { HttpError } from "./http.js";
import type { AdminSupabaseClient } from "./supabase-admin.js";

const dictionaryVersion = currentAllergenCatalogVersion;
const foodRuleVersion = "jp-caa-child-shape-2026-07.v1" as const;
export const currentAllergenCatalogIds: readonly string[] = Object.freeze([
  ...new Set(currentAllergenCatalogV1.map((entry) => entry.id)),
]);
export const currentFoodSafetyRuleIds: readonly string[] = Object.freeze([
  ...new Set(currentFoodSafetyRulesV1.map((rule) => rule.id)),
]);

type AliasManifestEntry = {
  allergenId: string;
  alias: string;
  normalizedAlias: string;
  aliasKind: "direct" | "derived" | "processed";
  requiresLabelConfirmation: boolean;
};

const additionalAliasValues: readonly (readonly [
  string,
  string,
  "direct" | "derived" | "processed",
  boolean,
])[] = [
  ["egg", "鶏卵", "derived", false],
  ["egg", "卵白", "derived", false],
  ["egg", "卵黄", "derived", false],
  ["milk", "牛乳", "derived", false],
  ["milk", "バター", "derived", false],
  ["milk", "チーズ", "derived", false],
  ["wheat", "小麦粉", "derived", false],
  ["shrimp", "海老", "direct", false],
  ["shrimp", "エビ", "direct", false],
  ["crab", "蟹", "direct", false],
  ["crab", "カニ", "direct", false],
  ["walnut", "胡桃", "direct", false],
  ["buckwheat", "蕎麦", "direct", false],
  ["egg", "たまご", "direct", false],
  ["milk", "乳成分", "derived", false],
  ["peanut", "落花生", "direct", false],
  ["peanut", "ピーナッツ", "direct", false],
  ["sesame", "胡麻", "direct", false],
  ["salmon", "鮭", "direct", false],
  ["mackerel", "鯖", "direct", false],
  ["kiwi", "キウイ", "direct", false],
  ["peach", "桃", "direct", false],
  ["yam", "山芋", "direct", false],
  ["apple", "林檎", "direct", false],
  ["soy", "豆腐", "derived", false],
  ["soy", "豆乳", "derived", false],
  ["wheat", "カレールー", "processed", true],
  ["milk", "カレールー", "processed", true],
  ["wheat", "しょうゆ", "processed", true],
  ["soy", "しょうゆ", "processed", true],
  ["wheat", "醤油", "processed", true],
  ["soy", "醤油", "processed", true],
  ["mackerel", "顆粒だし", "processed", true],
  ["soy", "顆粒だし", "processed", true],
  ["egg", "ドレッシング", "processed", true],
  ["milk", "ドレッシング", "processed", true],
  ["wheat", "ドレッシング", "processed", true],
  ["soy", "ドレッシング", "processed", true],
  ["egg", "マヨネーズ", "processed", true],
  ["milk", "ホワイトソース", "processed", true],
  ["wheat", "ホワイトソース", "processed", true],
  ["wheat", "食パン", "processed", true],
  ["milk", "食パン", "processed", true],
  ["egg", "ハム", "processed", true],
  ["milk", "ハム", "processed", true],
  ["wheat", "コンソメ", "processed", true],
  ["soy", "みそ", "processed", true],
];

export const currentAllergenAliasManifest: readonly AliasManifestEntry[] = [
  ...currentAllergenCatalogV1.map((entry) => ({
    allergenId: entry.id,
    alias: entry.displayName,
    normalizedAlias: entry.displayName.toLowerCase().replace(/[\s（）()]/gu, ""),
    aliasKind: "direct" as const,
    requiresLabelConfirmation: false,
  })),
  ...additionalAliasValues.map(([allergenId, alias, aliasKind, requiresLabelConfirmation]) => ({
    allergenId,
    alias,
    normalizedAlias: alias,
    aliasKind,
    requiresLabelConfirmation,
  })),
];

const ageBandSchema = z.enum(ageBands);
const allergyStatusSchema = z.enum(allergyStatuses);
const requiredSafetyConstraintSchema = z.enum(requiredSafetyConstraints);
const unsupportedDietKindSchema = z.enum(unsupportedDietKinds);
const unsupportedDietStatusSchema = z.enum(unsupportedDietStatuses);
const aliasKindSchema = z.enum(["direct", "derived", "processed"]);
const allergenAliasRowSchema = z
  .object({
    allergen_id: z.string().min(1),
    alias: z.string().min(1),
    normalized_alias: z.string().min(1),
    alias_kind: aliasKindSchema,
    requires_label_confirmation: z.boolean(),
    dictionary_version: z.string().min(1),
  })
  .strict();
const allergenCatalogRowSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/u),
    display_name: z.string().min(1).max(100),
    catalog_version: z.string().min(1).max(80),
  })
  .strict();

const invalidTargets = () =>
  new HttpError(400, "invalid_target_members", "対象メンバーを確認してください");
const safetyUnavailable = () =>
  new HttpError(500, "safety_context_failed", "現在の安全条件を読み込めませんでした");

type AllergenAliasRow = z.infer<typeof allergenAliasRowSchema>;
type AllergenCatalogRow = z.infer<typeof allergenCatalogRowSchema>;

function catalogSignature(row: AllergenCatalogRow): string {
  return [row.id, row.display_name, row.catalog_version].join("\u0000");
}

const expectedCatalogSignatures = new Set(
  currentAllergenCatalogV1.map((entry) =>
    catalogSignature({
      id: entry.id,
      display_name: entry.displayName,
      catalog_version: entry.catalogVersion,
    }),
  ),
);

function hasExactCurrentCatalog(catalog: SafetyRows["catalog"]): boolean {
  const parsedResult = z.array(allergenCatalogRowSchema).safeParse(catalog);
  if (!parsedResult.success) return false;
  const actualSignatures = new Set(parsedResult.data.map(catalogSignature));
  return (
    currentAllergenCatalogIds.length === currentAllergenCatalogV1.length &&
    parsedResult.data.length === expectedCatalogSignatures.size &&
    actualSignatures.size === expectedCatalogSignatures.size &&
    [...expectedCatalogSignatures].every((signature) => actualSignatures.has(signature))
  );
}

function copyCurrentAllergenCatalog(): CurrentSafetyContext["allergenDictionary"]["catalog"] {
  return currentAllergenCatalogV1.map((entry) => ({
    id: entry.id,
    displayName: entry.displayName,
    catalogVersion: entry.catalogVersion,
  }));
}

function aliasSignature(alias: AllergenAliasRow): string {
  return [
    alias.allergen_id,
    alias.alias,
    alias.normalized_alias,
    alias.alias_kind,
    alias.requires_label_confirmation ? "1" : "0",
    alias.dictionary_version,
  ].join("\u0000");
}

const expectedAliasSignatures = new Set(
  currentAllergenAliasManifest.map((alias) =>
    aliasSignature({
      allergen_id: alias.allergenId,
      alias: alias.alias,
      normalized_alias: alias.normalizedAlias,
      alias_kind: alias.aliasKind,
      requires_label_confirmation: alias.requiresLabelConfirmation,
      dictionary_version: dictionaryVersion,
    }),
  ),
);

function parseExactCurrentAliases(aliases: SafetyRows["aliases"]): AllergenAliasRow[] | undefined {
  const parsedResult = z.array(allergenAliasRowSchema).safeParse(aliases);
  if (!parsedResult.success) return undefined;

  const parsedAliases = parsedResult.data;
  const actualSignatures = new Set(parsedAliases.map(aliasSignature));
  if (
    parsedAliases.length !== expectedAliasSignatures.size ||
    actualSignatures.size !== expectedAliasSignatures.size ||
    ![...expectedAliasSignatures].every((signature) => actualSignatures.has(signature))
  ) {
    return undefined;
  }
  return parsedAliases;
}

type SafetyRows = {
  members: readonly {
    id: string;
    user_id: string;
    status: string;
    age_band: string | null;
    allergy_status: string | null;
    required_safety_constraints: readonly string[];
    unsupported_diet_status: string | null;
    unsupported_diet_kinds: readonly string[];
  }[];
  allergies: readonly { user_id: string; member_id: string; allergen_id: string | null }[];
  catalog: readonly { id: string; display_name: string; catalog_version: string }[];
  aliases: readonly {
    allergen_id: string;
    alias: string;
    normalized_alias: string;
    alias_kind: string;
    requires_label_confirmation: boolean;
    dictionary_version: string;
  }[];
  rules: readonly {
    id: string;
    applies_to_age_bands: readonly string[];
    match_terms: readonly string[];
    rule_kind: string;
    required_safety_tag: string | null;
    user_message: string;
    rule_version: string;
  }[];
};

type SafetyRuleRow = SafetyRows["rules"][number];

const safetyRuleRowSchema = z
  .object({
    id: z.string().min(1),
    applies_to_age_bands: z.array(ageBandSchema).min(1),
    match_terms: z.array(z.string().min(1)).min(1),
    rule_kind: z.enum(["forbidden", "requires_tag"]),
    required_safety_tag: z.enum(safetyActionKinds).nullable(),
    user_message: z.string().min(1),
    rule_version: z.string().min(1),
  })
  .strict();

function ruleSignature(rule: SafetyRuleRow): string {
  return JSON.stringify([
    rule.id,
    rule.applies_to_age_bands,
    rule.match_terms,
    rule.rule_kind,
    rule.required_safety_tag,
    rule.user_message,
    rule.rule_version,
  ]);
}

const expectedRuleSignatures = new Map(
  currentFoodSafetyRulesV1.map((rule) => [
    rule.id,
    ruleSignature({
      id: rule.id,
      applies_to_age_bands: rule.appliesToAgeBands,
      match_terms: rule.matchTerms,
      rule_kind: rule.ruleKind,
      required_safety_tag: rule.requiredSafetyTag,
      user_message: rule.userMessage,
      rule_version: rule.ruleVersion,
    }),
  ]),
);

function hasExactCurrentRules(rules: readonly SafetyRuleRow[]): boolean {
  const parsedRulesResult = z.array(safetyRuleRowSchema).safeParse(rules);
  if (!parsedRulesResult.success) return false;
  const parsedRules = parsedRulesResult.data;
  if (
    currentFoodSafetyRuleIds.length !== currentFoodSafetyRulesV1.length ||
    parsedRules.length !== currentFoodSafetyRulesV1.length
  ) {
    return false;
  }
  const rowsById = new Map(parsedRules.map((rule) => [rule.id, rule]));
  return (
    rowsById.size === currentFoodSafetyRulesV1.length &&
    currentFoodSafetyRulesV1.every((canonicalRule) => {
      const row = rowsById.get(canonicalRule.id);
      return (
        row !== undefined && ruleSignature(row) === expectedRuleSignatures.get(canonicalRule.id)
      );
    })
  );
}

function copyCurrentFoodSafetyRules(): CurrentSafetyContext["foodSafetyRules"] {
  return currentFoodSafetyRulesV1.map((rule) => ({
    ...rule,
    appliesToAgeBands: [...rule.appliesToAgeBands],
    matchTerms: [...rule.matchTerms],
  }));
}

export function buildCurrentSafetyContext(input: {
  userId: string;
  targetMemberIds: readonly string[];
  rows: SafetyRows;
}): CurrentSafetyContext {
  const { userId, targetMemberIds, rows } = input;
  const parsedAliases = parseExactCurrentAliases(rows.aliases);
  if (
    targetMemberIds.length === 0 ||
    targetMemberIds.length > 20 ||
    new Set(targetMemberIds).size !== targetMemberIds.length ||
    rows.members.length !== targetMemberIds.length ||
    rows.members.some((member) => member.user_id !== userId || member.status !== "complete") ||
    rows.allergies.some(
      (allergy) => allergy.user_id !== userId || !targetMemberIds.includes(allergy.member_id),
    )
  ) {
    throw invalidTargets();
  }
  if (
    !hasExactCurrentCatalog(rows.catalog) ||
    !hasExactCurrentRules(rows.rules) ||
    parsedAliases === undefined
  ) {
    throw safetyUnavailable();
  }
  return {
    dictionaryVersion,
    foodRuleVersion,
    requestText: "",
    members: targetMemberIds.map((memberId, index) => {
      const member = rows.members.find((row) => row.id === memberId);
      if (
        member === undefined ||
        member.age_band === null ||
        member.allergy_status === null ||
        member.unsupported_diet_status === null
      ) {
        throw invalidTargets();
      }
      const memberAllergies = rows.allergies.filter((row) => row.member_id === memberId);
      return {
        householdMemberId: member.id,
        anonymousRef: `member_${String(index + 1)}`,
        ageBand: ageBandSchema.parse(member.age_band),
        allergyStatus: allergyStatusSchema.parse(member.allergy_status),
        allergenIds: memberAllergies.flatMap((row) =>
          row.allergen_id === null ? [] : [row.allergen_id],
        ),
        hasUnmappedCustomAllergy: memberAllergies.some((row) => row.allergen_id === null),
        requiredSafetyConstraints: z
          .array(requiredSafetyConstraintSchema)
          .parse(member.required_safety_constraints),
        unsupportedDietStatus: unsupportedDietStatusSchema.parse(member.unsupported_diet_status),
        unsupportedDietKinds: z
          .array(unsupportedDietKindSchema)
          .parse(member.unsupported_diet_kinds),
      };
    }),
    allergenDictionary: {
      version: dictionaryVersion,
      catalog: copyCurrentAllergenCatalog(),
      aliases: parsedAliases.map((row) => ({
        allergenId: row.allergen_id,
        alias: row.alias,
        normalizedAlias: row.normalized_alias,
        aliasKind: row.alias_kind,
        requiresLabelConfirmation: row.requires_label_confirmation,
        dictionaryVersion: row.dictionary_version,
      })),
    },
    foodSafetyRules: copyCurrentFoodSafetyRules(),
  };
}

export function captureMemberLabels(input: {
  context: CurrentSafetyContext;
  userId: string;
  rows: readonly { id: string; user_id: string; status: string; display_name: string | null }[];
}): Readonly<Record<string, string>> {
  if (
    input.rows.length !== input.context.members.length ||
    input.rows.some((row) => row.user_id !== input.userId || row.status !== "complete")
  ) {
    throw invalidTargets();
  }
  const rows = new Map(input.rows.map((member) => [member.id, member] as const));
  return Object.freeze(
    Object.fromEntries(
      input.context.members.map((member, index) => {
        const liveName = rows.get(member.householdMemberId)?.display_name?.trim();
        if (!rows.has(member.householdMemberId)) throw invalidTargets();
        // レスポンス生成時点の所有者確認済み名称を固定し、後続更新の影響を遮断する。
        return [member.anonymousRef, liveName || `家族${String(index + 1)}`] as const;
      }),
    ),
  );
}

export async function loadCurrentSafetyContext(
  admin: AdminSupabaseClient,
  userId: string,
  targetMemberIds: readonly string[],
): Promise<CurrentSafetyContext> {
  if (
    targetMemberIds.length === 0 ||
    targetMemberIds.length > 20 ||
    new Set(targetMemberIds).size !== targetMemberIds.length
  ) {
    throw invalidTargets();
  }
  const [membersResult, allergiesResult, catalogResult, aliasesResult, rulesResult] =
    await Promise.all([
      admin
        .from("household_members")
        .select(
          "id,user_id,status,age_band,allergy_status,required_safety_constraints,unsupported_diet_status,unsupported_diet_kinds",
        )
        .eq("user_id", userId)
        .eq("status", "complete")
        .in("id", [...targetMemberIds]),
      admin
        .from("member_allergies")
        .select("user_id,member_id,allergen_id")
        .eq("user_id", userId)
        .in("member_id", [...targetMemberIds]),
      admin
        .from("allergen_catalog")
        .select("id,display_name,catalog_version")
        .eq("catalog_version", dictionaryVersion),
      admin
        .from("allergen_aliases")
        .select(
          "allergen_id,alias,normalized_alias,alias_kind,requires_label_confirmation,dictionary_version",
        )
        .eq("dictionary_version", dictionaryVersion),
      admin
        .from("food_safety_rules")
        .select(
          "id,applies_to_age_bands,match_terms,rule_kind,required_safety_tag,user_message,rule_version",
        )
        .eq("rule_version", foodRuleVersion),
    ]);
  const firstError = [
    membersResult.error,
    allergiesResult.error,
    catalogResult.error,
    aliasesResult.error,
    rulesResult.error,
  ].find((error) => error !== null);
  if (firstError !== undefined) throw safetyUnavailable();

  return buildCurrentSafetyContext({
    userId,
    targetMemberIds,
    rows: {
      members: membersResult.data ?? [],
      allergies: allergiesResult.data ?? [],
      catalog: catalogResult.data ?? [],
      aliases: aliasesResult.data ?? [],
      rules: rulesResult.data ?? [],
    },
  });
}

export type EmergencyCurrentSafety = {
  context: CurrentSafetyContext;
  memberLabels: Readonly<Record<string, string>>;
};

export async function loadEmergencyCurrentSafety(
  admin: AdminSupabaseClient,
  userId: string,
  targetMemberIds: readonly string[],
): Promise<EmergencyCurrentSafety> {
  const context = await loadCurrentSafetyContext(admin, userId, targetMemberIds);
  const { data, error } = await admin
    .from("household_members")
    .select("id,user_id,status,display_name")
    .eq("user_id", userId)
    .eq("status", "complete")
    .in("id", [...targetMemberIds]);
  if (error !== null || data.length !== targetMemberIds.length) {
    throw invalidTargets();
  }
  const memberLabels = captureMemberLabels({ context, userId, rows: data });
  return { context, memberLabels };
}
