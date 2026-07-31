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
  // 食パンは市販品でも小麦主原料がほぼ確実。S-I1 他パンと同型の hard match（乳は製品差があるため soft 維持）
  ["wheat", "食パン", "derived", false],
  ["milk", "食パン", "processed", true],
  ["egg", "ハム", "processed", true],
  ["milk", "ハム", "processed", true],
  ["wheat", "コンソメ", "processed", true],
  // AGS-C1: みそ/味噌は家庭調理の主原料として hard match（ラベル確認不要）
  ["soy", "みそ", "derived", false],
  // A-C1: 高頻度表記ゆれ（玉子・ミルク・小麦麺類・魚カナ表記）
  ["egg", "玉子", "direct", false],
  ["milk", "ミルク", "direct", false],
  ["milk", "みるく", "direct", false],
  ["wheat", "うどん", "derived", false],
  ["wheat", "パスタ", "derived", false],
  ["wheat", "ラーメン", "derived", false],
  ["wheat", "そばつゆ", "processed", true],
  ["salmon", "サーモン", "direct", false],
  ["salmon", "さーもん", "direct", false],
  ["mackerel", "サバ", "direct", false],
  ["walnut", "クルミ", "direct", false],
  ["buckwheat", "ソバ", "direct", false],
  // AGS-C1: 高頻度の大豆・小麦・乳・落花生表記（fail-open 残差）
  ["soy", "味噌", "derived", false],
  ["soy", "納豆", "derived", false],
  ["soy", "油揚げ", "derived", false],
  ["soy", "厚揚げ", "derived", false],
  ["soy", "きなこ", "derived", false],
  // U3-001: 「きな粉」は「きなこ」と NFKC では同一視されない（粉≠こ）
  ["soy", "きな粉", "derived", false],
  ["soy", "枝豆", "derived", false],
  // 高頻度パン形（裸の「パン」はフライパン衝突のため載せない）
  ["wheat", "バゲット", "derived", false],
  ["milk", "パルメザン", "derived", false],
  ["wheat", "パン粉", "derived", false],
  ["wheat", "そうめん", "derived", false],
  ["wheat", "素麺", "derived", false],
  ["wheat", "薄力粉", "derived", false],
  ["wheat", "強力粉", "derived", false],
  ["milk", "ヨーグルト", "derived", false],
  ["milk", "生クリーム", "derived", false],
  ["peanut", "ピーナツ", "direct", false],
  // S-I1: 高頻度小麦製品（フライパン等との衝突を避けた具体形のみ）
  ["wheat", "フランスパン", "derived", false],
  ["wheat", "ロールパン", "derived", false],
  ["wheat", "コッペパン", "derived", false],
  ["wheat", "ベーグル", "derived", false],
  ["wheat", "クロワッサン", "derived", false],
  ["wheat", "ナン", "derived", false],
  ["wheat", "中華麺", "derived", false],
  ["wheat", "焼きそば", "derived", false],
  ["wheat", "天ぷら粉", "derived", false],
  ["wheat", "ホットケーキミックス", "derived", false],
  ["wheat", "お好み焼き粉", "derived", false],
  ["wheat", "餃子の皮", "derived", false],
  // S-I2: 高頻度料理名・外来語（パスタ/粉名の部分一致では拾えない残差）
  // 裸の「パン」はフライパン衝突のため載せない（S-I1 と同じ）
  ["wheat", "スパゲッティ", "derived", false],
  ["wheat", "スパゲティ", "derived", false],
  ["wheat", "マカロニ", "derived", false],
  ["wheat", "ラザニア", "derived", false],
  ["wheat", "ピザ", "derived", false],
  ["wheat", "トースト", "derived", false],
  ["wheat", "ホットケーキ", "derived", false],
  ["wheat", "お好み焼き", "derived", false],
  ["wheat", "餃子", "derived", false],
  ["wheat", "天ぷら", "derived", false],
  ["wheat", "クッキー", "derived", false],
  ["wheat", "ビスケット", "derived", false],
  ["wheat", "ドーナツ", "derived", false],
  ["wheat", "中力粉", "derived", false],
  ["wheat", "全粒粉", "derived", false],
  ["wheat", "グルテン", "derived", false],
  ["wheat", "麩", "derived", false],
  // 卵: 料理名・外来語（卵/たまご/玉子が葉に無いとき fail-open していた）
  ["egg", "オムレツ", "derived", false],
  ["egg", "オムライス", "derived", false],
  ["egg", "目玉焼き", "derived", false],
  ["egg", "エッグ", "derived", false],
  ["egg", "スクランブルエッグ", "derived", false],
  // えび: サーモン同型の外来語
  ["shrimp", "シュリンプ", "direct", false],
  // U2-C1: 推奨表示肉類は displayName のみだと AI の部位名・外来語が fail-open する。
  // 裸の「鶏」「牛」「豚」は 鶏卵・牛乳 等と衝突するため載せない（複数文字の具体形のみ）。
  ["chicken", "チキン", "direct", false],
  ["chicken", "とり肉", "direct", false],
  ["chicken", "鳥肉", "direct", false],
  ["chicken", "鶏むね", "derived", false],
  ["chicken", "鶏もも", "derived", false],
  ["chicken", "ささみ", "derived", false],
  ["chicken", "若鶏", "derived", false],
  ["chicken", "鶏ひき", "derived", false],
  ["chicken", "地鶏", "derived", false],
  ["pork", "ポーク", "direct", false],
  ["pork", "豚バラ", "derived", false],
  ["pork", "豚こま", "derived", false],
  ["pork", "豚ひき", "derived", false],
  ["pork", "ぶた肉", "direct", false],
  ["pork", "豚ロース", "derived", false],
  ["pork", "スペアリブ", "derived", false],
  ["pork", "ベーコン", "processed", true],
  ["pork", "ソーセージ", "processed", true],
  ["beef", "ビーフ", "direct", false],
  ["beef", "牛こま", "derived", false],
  ["beef", "牛薄切り", "derived", false],
  ["beef", "和牛", "derived", false],
  ["beef", "牛ひき", "derived", false],
  ["beef", "牛バラ", "derived", false],
  ["beef", "牛もも", "derived", false],
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

const standardAllergySchema = z
  .object({
    kind: z.literal("standard"),
    allergen_id: z.string().min(1),
  })
  .strict();
const customAllergySchema = z
  .object({
    kind: z.literal("custom"),
    name: z.string().min(1),
    aliases: z.array(z.string().min(1)),
  })
  .strict();
const memberSchema = z
  .object({
    id: z.uuid(),
    display_name: z.string(),
    age_band: z.enum(ageBands),
    portion_size: z.enum(portionSizes).nullable(),
    spice_level: z.enum(spiceLevels).nullable(),
    ease_preferences: z.array(z.enum(easePreferences)),
    // 未確認は RPC から返る。拒否すると revalidation / 緊急献立が 500 になり救済コードが死ぬ（A-I3）。
    // 呼び出し側が allergy_unconfirmed / current_safety_unavailable で閉じて 500 にしない。
    allergy_status: z.enum(allergyStatuses),
    required_safety_constraints: z.array(z.enum(requiredSafetyConstraints)),
    unsupported_diet_status: z.enum(unsupportedDietStatuses),
    unsupported_diet_kinds: z.array(z.enum(unsupportedDietKinds)),
    allergies: z.array(z.discriminatedUnion("kind", [standardAllergySchema, customAllergySchema])),
  })
  .strict();
const catalogRowSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/u),
    display_name: z.string().min(1),
    regulatory_class: z.enum(["mandatory", "recommended"]),
    catalog_version: z.string().min(1),
  })
  .strict();
const aliasRowSchema = z
  .object({
    allergen_id: z.string().min(1),
    alias: z.string().min(1),
    normalized_alias: z.string().min(1),
    alias_kind: z.enum(["direct", "derived", "processed"]),
    requires_label_confirmation: z.boolean(),
    dictionary_version: z.string().min(1),
  })
  .strict();
const ruleRowSchema = z
  .object({
    id: z.string().min(1),
    applies_to_age_bands: z.array(z.enum(ageBands)).min(1),
    match_terms: z.array(z.string().min(1)).min(1),
    rule_kind: z.enum(["forbidden", "requires_tag"]),
    required_safety_tag: z.enum(safetyActionKinds).nullable(),
    user_message: z.string().min(1),
    rule_version: z.string().min(1),
  })
  .strict();
const currentSafetySnapshotSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unavailable") }).strict(),
  z
    .object({
      status: z.literal("available"),
      dictionary_version: z.string().min(1),
      food_rule_version: z.string().min(1),
      members: z.array(memberSchema).min(1).max(20),
      catalog: z.array(catalogRowSchema),
      aliases: z.array(aliasRowSchema),
      rules: z.array(ruleRowSchema),
    })
    .strict(),
]);

type AvailableSnapshot = Extract<
  z.infer<typeof currentSafetySnapshotSchema>,
  { status: "available" }
>;

const safetyUnavailable = () =>
  new HttpError(500, "safety_context_failed", "現在の安全条件を読み込めませんでした");

function catalogSignature(row: AvailableSnapshot["catalog"][number]): string {
  return [row.id, row.display_name, row.regulatory_class, row.catalog_version].join("\u0000");
}

function aliasSignature(row: AvailableSnapshot["aliases"][number]): string {
  return [
    row.allergen_id,
    row.alias,
    row.normalized_alias,
    row.alias_kind,
    row.requires_label_confirmation ? "1" : "0",
    row.dictionary_version,
  ].join("\u0000");
}

function ruleSignature(row: AvailableSnapshot["rules"][number]): string {
  return JSON.stringify([
    row.id,
    row.applies_to_age_bands,
    row.match_terms,
    row.rule_kind,
    row.required_safety_tag,
    row.user_message,
    row.rule_version,
  ]);
}

const expectedCatalogSignatures = new Set(
  currentAllergenCatalogV1.map((entry) =>
    catalogSignature({
      id: entry.id,
      display_name: entry.displayName,
      regulatory_class: entry.regulatoryClass,
      catalog_version: entry.catalogVersion,
    }),
  ),
);
const expectedAliasSignatures = new Set(
  currentAllergenAliasManifest.map((entry) =>
    aliasSignature({
      allergen_id: entry.allergenId,
      alias: entry.alias,
      normalized_alias: entry.normalizedAlias,
      alias_kind: entry.aliasKind,
      requires_label_confirmation: entry.requiresLabelConfirmation,
      dictionary_version: dictionaryVersion,
    }),
  ),
);
const expectedRuleSignatures = new Set(
  currentFoodSafetyRulesV1.map((rule) =>
    ruleSignature({
      id: rule.id,
      applies_to_age_bands: [...rule.appliesToAgeBands],
      match_terms: [...rule.matchTerms],
      rule_kind: rule.ruleKind,
      required_safety_tag: rule.requiredSafetyTag,
      user_message: rule.userMessage,
      rule_version: rule.ruleVersion,
    }),
  ),
);

function hasExactSignatures<T>(
  rows: readonly T[],
  expected: ReadonlySet<string>,
  signature: (row: T) => string,
): boolean {
  const actual = new Set(rows.map(signature));
  return (
    rows.length === expected.size &&
    actual.size === expected.size &&
    [...expected].every((value) => actual.has(value))
  );
}

function canonicalCatalogSignature(
  row: CurrentSafetyContext["allergenDictionary"]["catalog"][number],
): string {
  return [row.id, row.displayName, row.catalogVersion].join("\u0000");
}

function canonicalAliasSignature(
  row: CurrentSafetyContext["allergenDictionary"]["aliases"][number],
): string {
  return [
    row.allergenId,
    row.alias,
    row.normalizedAlias,
    row.aliasKind,
    row.requiresLabelConfirmation ? "1" : "0",
    row.dictionaryVersion,
  ].join("\u0000");
}

function canonicalRuleSignature(row: CurrentSafetyContext["foodSafetyRules"][number]): string {
  return JSON.stringify([
    row.id,
    row.appliesToAgeBands,
    row.matchTerms,
    row.ruleKind,
    row.requiredSafetyTag,
    row.userMessage,
    row.ruleVersion,
  ]);
}

const expectedCanonicalCatalogSignatures = new Set(
  currentAllergenCatalogV1.map(canonicalCatalogSignature),
);
const expectedCanonicalAliasSignatures = new Set(
  currentAllergenAliasManifest.map((entry) =>
    canonicalAliasSignature({ ...entry, dictionaryVersion }),
  ),
);
const expectedCanonicalRuleSignatures = new Set(
  currentFoodSafetyRulesV1.map(canonicalRuleSignature),
);

export function hasExactCurrentSafetyManifest(context: CurrentSafetyContext): boolean {
  return (
    context.dictionaryVersion === dictionaryVersion &&
    context.allergenDictionary.version === dictionaryVersion &&
    context.foodRuleVersion === foodRuleVersion &&
    hasExactSignatures(
      context.allergenDictionary.catalog,
      expectedCanonicalCatalogSignatures,
      canonicalCatalogSignature,
    ) &&
    hasExactSignatures(
      context.allergenDictionary.aliases,
      expectedCanonicalAliasSignatures,
      canonicalAliasSignature,
    ) &&
    hasExactSignatures(
      context.foodSafetyRules,
      expectedCanonicalRuleSignatures,
      canonicalRuleSignature,
    )
  );
}

function validateSnapshot(snapshot: AvailableSnapshot, targetMemberIds: readonly string[]): void {
  if (
    snapshot.dictionary_version !== dictionaryVersion ||
    snapshot.food_rule_version !== foodRuleVersion ||
    snapshot.members.length !== targetMemberIds.length ||
    snapshot.members.some((member, index) => member.id !== targetMemberIds[index]) ||
    snapshot.catalog.some((row) => row.catalog_version !== snapshot.dictionary_version) ||
    snapshot.aliases.some((row) => row.dictionary_version !== snapshot.dictionary_version) ||
    snapshot.rules.some((row) => row.rule_version !== snapshot.food_rule_version) ||
    !hasExactSignatures(snapshot.catalog, expectedCatalogSignatures, catalogSignature) ||
    !hasExactSignatures(snapshot.aliases, expectedAliasSignatures, aliasSignature) ||
    !hasExactSignatures(snapshot.rules, expectedRuleSignatures, ruleSignature)
  ) {
    throw safetyUnavailable();
  }
}

function mapContext(snapshot: AvailableSnapshot): CurrentSafetyContext {
  return {
    dictionaryVersion: snapshot.dictionary_version,
    foodRuleVersion: snapshot.food_rule_version,
    requestText: "",
    members: snapshot.members.map((member, index) => {
      const customAllergies = member.allergies.flatMap((allergy) =>
        allergy.kind === "custom"
          ? [{ name: allergy.name, aliases: [...allergy.aliases] as readonly string[] }]
          : [],
      );
      return {
        householdMemberId: member.id,
        anonymousRef: `member_${String(index + 1)}`,
        ageBand: member.age_band,
        allergyStatus: member.allergy_status,
        allergenIds: member.allergies.flatMap((allergy) =>
          allergy.kind === "standard" ? [allergy.allergen_id] : [],
        ),
        // 緊急献立 fixture は標準 ID のみ照合できるため、カスタム有りは引き続き unmapped 扱い。
        // AI 生成は customAllergies を evaluateAllergens で検査する（AGS-I2）。
        hasUnmappedCustomAllergy: customAllergies.length > 0,
        customAllergies,
        requiredSafetyConstraints: [...member.required_safety_constraints],
        unsupportedDietStatus: member.unsupported_diet_status,
        unsupportedDietKinds: [...member.unsupported_diet_kinds],
      };
    }),
    allergenDictionary: {
      version: snapshot.dictionary_version,
      catalog: snapshot.catalog.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        catalogVersion: row.catalog_version,
      })),
      aliases: snapshot.aliases.map((row) => ({
        allergenId: row.allergen_id,
        alias: row.alias,
        normalizedAlias: row.normalized_alias,
        aliasKind: row.alias_kind,
        requiresLabelConfirmation: row.requires_label_confirmation,
        dictionaryVersion: row.dictionary_version,
      })),
    },
    foodSafetyRules: snapshot.rules.map((row) => ({
      id: row.id,
      appliesToAgeBands: [...row.applies_to_age_bands],
      matchTerms: [...row.match_terms],
      ruleKind: row.rule_kind,
      requiredSafetyTag: row.required_safety_tag,
      userMessage: row.user_message,
      ruleVersion: row.rule_version,
    })),
  };
}

function captureLabels(snapshot: AvailableSnapshot): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      snapshot.members.map((member, index) => {
        const displayName = member.display_name.trim();
        // RPCと同じスナップショットの名称を固定し、後続更新との混在を防ぐ。
        return [`member_${String(index + 1)}`, displayName || `家族${String(index + 1)}`];
      }),
    ),
  );
}

async function loadSnapshot(
  admin: AdminSupabaseClient,
  userId: string,
  targetMemberIds: readonly string[],
): Promise<{ snapshot: AvailableSnapshot; context: CurrentSafetyContext }> {
  const { data, error } = await admin.rpc("get_current_safety_snapshot", {
    p_user_id: userId,
    p_target_member_ids: [...targetMemberIds],
  });
  if (error !== null || data === null) throw safetyUnavailable();

  const parsed = currentSafetySnapshotSchema.safeParse(data);
  if (!parsed.success || parsed.data.status === "unavailable") throw safetyUnavailable();
  validateSnapshot(parsed.data, targetMemberIds);
  return { snapshot: parsed.data, context: mapContext(parsed.data) };
}

export async function loadCurrentSafetyContext(
  admin: AdminSupabaseClient,
  userId: string,
  targetMemberIds: readonly string[],
): Promise<CurrentSafetyContext> {
  return (await loadSnapshot(admin, userId, targetMemberIds)).context;
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
  const { snapshot, context } = await loadSnapshot(admin, userId, targetMemberIds);
  return { context, memberLabels: captureLabels(snapshot) };
}
