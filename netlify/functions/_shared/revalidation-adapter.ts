import { z } from "zod";
import type { GeneratedMenu, MenuValidationIssue } from "../../../shared/contracts/generation.js";
import type { EasePreference, PortionSize, SpiceLevel } from "../../../shared/contracts/domain.js";
import {
  evaluateAllergens,
  foodTextContainsAlias,
  normalizeFoodText,
} from "../../../shared/safety/allergens.js";
import type { CurrentSafetyContext } from "../../../shared/safety/context.js";
import { createCurrentSafetyFingerprint } from "../../../shared/safety/fingerprint.js";
import { evaluateFoodSafetyRules } from "../../../shared/safety/food-rules.js";
import type {
  GenerationContext,
  HouseholdGenerationContext,
} from "../../../shared/safety/generation-context.js";
import type { Json } from "../../../src/shared/types/database.generated.js";
import type { AuthenticatedUser } from "./generation-repository.js";
import { loadCurrentSafetyContext } from "./current-safety.js";
import { HttpError } from "./http.js";
import type { CurrentMenuLabelWarning, RevalidationDeps } from "./revalidation-service.js";
import {
  loadStoredMenu,
  toStoredRevalidationCandidate,
  type StoredMenuAggregate,
} from "./stored-menu-loader.js";
import { getSupabaseAdmin, type AdminSupabaseClient } from "./supabase-admin.js";
import { createUserScopedSupabase, type UserSupabaseClient } from "./supabase-user.js";

const changedDetailCodes = [
  "pantry_item_removed",
  "pantry_quantity_changed",
  "preference_changed",
] as const;

type ChangedDetail = (typeof changedDetailCodes)[number];

const preferenceSnapshotSchema = z.looseObject({
  memberPreferences: z
    .array(
      z.looseObject({
        householdMemberId: z.uuid(),
        anonymousMemberRef: z.string(),
        portionSize: z.string().nullable().optional(),
        spiceLevel: z.string().nullable().optional(),
        easePreferences: z.array(z.string()).optional(),
        dislikes: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

const reconcileRowSchema = z.looseObject({
  id: z.uuid(),
  source_type: z.enum(["dish", "ingredient", "recipe_step", "adaptation", "timeline"]),
  source_id: z.uuid(),
  source_path: z.string().min(1).max(200),
  source_text_snapshot: z.string().min(1).max(500),
  allergen_id: z.string().min(1),
  anonymous_member_ref: z.string().regex(/^member_[1-9][0-9]*$/),
  dictionary_version: z.string().min(1),
  confirmation_status: z.enum(["pending", "confirmed"]),
  requirement_safety_fingerprint: z.string().min(1).max(200),
});

const pantryLiveRowSchema = z
  .object({
    id: z.uuid(),
    quantity: z.number().nullable(),
  })
  .strict();

const householdPreferenceRowSchema = z
  .object({
    id: z.uuid(),
    portion_size: z.enum(["small", "regular", "large"]).nullable(),
    spice_level: z.enum(["none", "mild", "regular"]).nullable(),
    ease_preferences: z.array(z.enum(["small_pieces", "boneless", "soft"])),
  })
  .strict();

/**
 * loadCurrentSafetyContext は targetMemberIds 順に member_1.. を採番する。
 * 履歴の menu_target_members / label confirmation FK は生成時の anonymous_ref を
 * 保持するため、生存メンバーだけ歴史的 ref へ戻して validator 入力を組む。
 * fingerprint 計算には renumber 済み context をそのまま使う。
 */
function withHistoricalAnonymousRefs(
  safety: CurrentSafetyContext,
  stored: StoredMenuAggregate,
): CurrentSafetyContext {
  const historicalById = new Map(
    stored.targetMembers.flatMap((member) =>
      member.householdMemberId === null
        ? []
        : ([[member.householdMemberId, member.anonymousMemberRef]] as const),
    ),
  );
  return {
    ...safety,
    members: safety.members.map((member) => {
      const historical = historicalById.get(member.householdMemberId);
      return historical === undefined ? member : { ...member, anonymousRef: historical };
    }),
  };
}

function makeRevalidationGenerationContext(
  stored: StoredMenuAggregate,
  safety: CurrentSafetyContext,
): GenerationContext {
  const surviving = stored.targetMembers.filter(
    (
      member,
    ): member is StoredMenuAggregate["targetMembers"][number] & {
      householdMemberId: string;
    } => member.householdMemberId !== null,
  );
  return {
    targetMode: "household" as const,
    submission: {
      mealType: stored.menu.mealType,
      mainIngredients: [],
      cuisineGenre: stored.menu.cuisineGenre,
      targetMode: "household" as const,
      targetMemberIds: surviving.map((member) => member.householdMemberId),
      servings: null,
      timeLimitMinutes: null,
      budgetPreference: null,
      ingredientPreference: null,
      avoidIngredients: [],
      memo: "",
      pantrySelections: [],
    },
    safety,
    pantryItems: [],
    memberPreferences: surviving.map((member) => ({
      householdMemberId: member.householdMemberId,
      anonymousMemberRef: member.anonymousMemberRef,
      portionSize: "regular" as const,
      spiceLevel: "regular" as const,
      easePreferences: [],
      dislikes: [],
    })),
    targetMembers: surviving.map((member) => ({
      householdMemberId: member.householdMemberId,
      anonymousRef: member.anonymousMemberRef,
      displayNameSnapshot: member.displayNameSnapshot,
    })),
    allergenVersion: safety.dictionaryVersion,
    foodRuleVersion: safety.foodRuleVersion,
    expiredPantryChecks: [],
    idempotencyKey: "00000000-0000-4000-8000-000000000099",
    preferenceSnapshot:
      typeof stored.preferenceSnapshot === "object" && stored.preferenceSnapshot !== null
        ? (stored.preferenceSnapshot as Readonly<Record<string, unknown>>)
        : {},
    safetySnapshot: {},
  };
}

/**
 * 在庫名スナップショットも現行アレルギー辞書へ通す（材料・手順テキスト収集外の leaf）。
 * A-C2 residual: memberDisplayLabel と同じ優先順（live → snapshot → 家族N）。
 */
function scanPantryNameSnapshotIssues(
  menu: GeneratedMenu | StoredMenuAggregate["menu"],
  safety: CurrentSafetyContext,
  stored: StoredMenuAggregate,
): readonly MenuValidationIssue[] {
  const issues: MenuValidationIssue[] = [];
  for (const [index, usage] of menu.pantryUsage.entries()) {
    if (normalizeFoodText(usage.pantryItemName) === "") continue;
    for (const member of safety.members) {
      const memberLabel = memberDisplayLabel(stored, member.anonymousRef);
      const pantryName = usage.pantryItemName.trim();
      const pushPantryAllergenIssue = (allergenDisplayName: string) => {
        issues.push({
          code: "direct_allergen_match",
          path: `pantryUsage.${String(index)}.pantryItemName`,
          message:
            pantryName === ""
              ? `「${memberLabel}」さんの登録アレルギー「${allergenDisplayName}」が献立に残っています`
              : `「${memberLabel}」さんの登録アレルギー「${allergenDisplayName}」が「${pantryName}」に残っています`,
        });
      };
      for (const allergenId of member.allergenIds) {
        const aliases = safety.allergenDictionary.aliases.filter(
          (alias) => alias.allergenId === allergenId,
        );
        const matched = aliases.filter((alias) =>
          foodTextContainsAlias(usage.pantryItemName, alias.normalizedAlias),
        );
        // H5: 履歴再検証にラベル確認 UI が無いため soft（requiresLabelConfirmation）命中も
        // hard と同型で issue 化（flyer assertFlyerMenuAgainstSafety / 生成 preflight と同型 fail-closed）。
        // 本文 soft は evaluateAllergens が label confirmation を返す別経路。ここは pantry 名専用。
        if (matched.length > 0) {
          const catalogEntry = safety.allergenDictionary.catalog.find(
            (entry) => entry.id === allergenId,
          );
          pushPantryAllergenIssue(catalogEntry?.displayName ?? "登録アレルギー");
        }
      }
      // カタログ外の確認済みカスタムも在庫名 residual に hard match する（evaluateAllergens と同型）
      for (const custom of member.customAllergies) {
        const needles = [custom.name, ...custom.aliases].filter((value) => value.trim() !== "");
        if (needles.length === 0) continue;
        if (!needles.some((needle) => foodTextContainsAlias(usage.pantryItemName, needle))) {
          continue;
        }
        pushPantryAllergenIssue(custom.name);
      }
    }
  }
  return issues;
}

async function loadLivePantryQuantities(
  ownerClient: UserSupabaseClient,
  pantryItemIds: readonly string[],
): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>();
  if (pantryItemIds.length === 0) return map;
  const { data, error } = await ownerClient
    .from("pantry_items")
    .select("id,quantity")
    .in("id", [...pantryItemIds]);
  // F-U07-2: 空 Map で fail-open すると全 usage が pantry_item_removed になるため fail-closed
  if (error !== null) {
    throw new HttpError(503, "request_failed", "処理を完了できませんでした");
  }
  for (const row of data) {
    const parsed = pantryLiveRowSchema.safeParse(row);
    // HR10: schema 崩れを Map 非登録のままにすると pantry_item_removed 誤誘導になる。
    // query error と同型の 503 fail-closed（削除と区別する）。
    if (!parsed.success) {
      throw new HttpError(503, "request_failed", "処理を完了できませんでした");
    }
    map.set(parsed.data.id, parsed.data.quantity);
  }
  return map;
}

async function loadCurrentMemberPreferences(
  ownerClient: UserSupabaseClient,
  memberIds: readonly string[],
): Promise<
  Map<
    string,
    {
      portionSize: string | null;
      spiceLevel: string | null;
      easePreferences: readonly string[];
      dislikes: readonly string[];
    }
  >
> {
  const map = new Map<
    string,
    {
      portionSize: string | null;
      spiceLevel: string | null;
      easePreferences: readonly string[];
      dislikes: readonly string[];
    }
  >();
  if (memberIds.length === 0) return map;
  const { data, error } = await ownerClient
    .from("household_members")
    .select("id,portion_size,spice_level,ease_preferences")
    .in("id", [...memberIds]);
  // F-U07-2: 空 Map は全 target が preference_changed になるため fail-closed
  if (error !== null) {
    throw new HttpError(503, "request_failed", "処理を完了できませんでした");
  }
  for (const row of data) {
    const parsed = householdPreferenceRowSchema.safeParse(row);
    if (!parsed.success) continue;
    map.set(parsed.data.id, {
      portionSize: parsed.data.portion_size,
      spiceLevel: parsed.data.spice_level,
      easePreferences: parsed.data.ease_preferences,
      dislikes: [],
    });
  }
  // 嫌いなもの（dislikes）も好み drift として比較する（列名は ingredient_name が正）
  const { data: dislikeRows, error: dislikeError } = await ownerClient
    .from("member_dislikes")
    .select("member_id,ingredient_name")
    .in("member_id", [...memberIds]);
  if (dislikeError !== null) {
    throw new HttpError(503, "request_failed", "処理を完了できませんでした");
  }
  if (Array.isArray(dislikeRows)) {
    for (const row of dislikeRows) {
      const record = row as { member_id?: unknown; ingredient_name?: unknown };
      if (typeof record.member_id !== "string" || typeof record.ingredient_name !== "string") {
        continue;
      }
      const current = map.get(record.member_id);
      if (current === undefined) continue;
      map.set(record.member_id, {
        ...current,
        dislikes: [...current.dislikes, record.ingredient_name],
      });
    }
  }
  return map;
}

function detectChangedDetails(
  stored: StoredMenuAggregate,
  livePantry: Map<string, number | null>,
  livePreferences: Map<
    string,
    {
      portionSize: string | null;
      spiceLevel: string | null;
      easePreferences: readonly string[];
      dislikes: readonly string[];
    }
  >,
): readonly ChangedDetail[] {
  const details = new Set<ChangedDetail>();

  for (const usage of stored.menu.pantryUsage) {
    if (usage.pantryItemId === null) continue;
    if (!livePantry.has(usage.pantryItemId)) {
      details.add("pantry_item_removed");
      continue;
    }
    const currentQuantity = livePantry.get(usage.pantryItemId) ?? null;
    if (
      usage.inventoryQuantity !== null &&
      currentQuantity !== null &&
      currentQuantity !== usage.inventoryQuantity
    ) {
      details.add("pantry_quantity_changed");
    } else if (usage.inventoryQuantity !== currentQuantity) {
      // 片方が null の数量差も「変わった」とみなし、再生成確認を促す
      if (usage.inventoryQuantity !== null || currentQuantity !== null) {
        details.add("pantry_quantity_changed");
      }
    }
  }

  const snapshot = preferenceSnapshotSchema.safeParse(stored.preferenceSnapshot);
  const snapshotPrefs = snapshot.success ? (snapshot.data.memberPreferences ?? []) : [];
  for (const memberId of stored.targetMemberIds) {
    const live = livePreferences.get(memberId);
    if (live === undefined) {
      details.add("preference_changed");
      continue;
    }
    const historical = snapshotPrefs.find((item) => item.householdMemberId === memberId);
    if (historical === undefined) continue;
    const easeLeft = [...(historical.easePreferences ?? [])].sort().join("\u0000");
    const easeRight = [...live.easePreferences].sort().join("\u0000");
    const dislikeLeft = [...(historical.dislikes ?? [])].sort().join("\u0000");
    const dislikeRight = [...live.dislikes].sort().join("\u0000");
    if (
      (historical.portionSize ?? null) !== live.portionSize ||
      (historical.spiceLevel ?? null) !== live.spiceLevel ||
      easeLeft !== easeRight ||
      dislikeLeft !== dislikeRight
    ) {
      details.add("preference_changed");
    }
  }

  return changedDetailCodes.filter((code) => details.has(code));
}

/**
 * 履歴結果専用の subset validator。GenerationContext を mutable に渡さず、
 * 保存本文を現行安全条件だけで検査する。pantry/preference の drift は
 * invalid ではなく changedDetails に閉じる。
 *
 * residual-intentional (adversarial HR7): mount 再検証は allergen / food-rules /
 * pantry 名 / member status + changedDetails の subset。再生成入口は
 * validateGeneratedMenu full（adaptation 全員一致・portion/spice/ease hard 等）。
 * 経路ごとにゲート集合が違う dual-validator は意図的（履歴 CTA を full まで
 * 揃えると誤 invalid が増え、full を緩めると再生成安全性が落ちる）。
 * subset ok でも再生成が 422 になり得る residual はサーバ fail-closed で受ける。
 */
export async function validateStoredMenuCurrentSafety(input: {
  ownerClient: UserSupabaseClient;
  admin: AdminSupabaseClient;
  stored: StoredMenuAggregate;
  userId: string;
}): Promise<{
  ok: boolean;
  candidate: GeneratedMenu;
  issues: readonly MenuValidationIssue[];
  changedDetails: readonly ChangedDetail[];
}> {
  const { ownerClient, admin, stored, userId } = input;
  // buildStoredGenerationContext と同じ空ターゲットガード。
  // 生存メンバーが 0 のとき allergen ループは 0 件になり、未ガードだと
  // issues=[] のまま ok:true になり履歴詳細が「現行安全を通過」と誤表示する。
  if (stored.targetMemberIds.length === 0) {
    throw new HttpError(422, "current_target_member_required", "現在の家族を1人以上選んでください");
  }
  // 削除済みリンクは決して現行 validator メンバーにしない
  const renumberedSafety = await loadCurrentSafetyContext(admin, userId, stored.targetMemberIds);
  const safety = withHistoricalAnonymousRefs(renumberedSafety, stored);
  const generationContext = makeRevalidationGenerationContext(stored, safety);
  const candidate = toStoredRevalidationCandidate(stored.menu, generationContext);

  // A-C2 residual: invalid allergen もラベル警告と同じ memberDisplayLabel を使う。
  const allergenMemberLabels = Object.fromEntries(
    safety.members.map((member) => [
      member.anonymousRef,
      memberDisplayLabel(stored, member.anonymousRef),
    ]),
  );
  const allergenResult = evaluateAllergens(candidate, safety, {
    memberLabels: allergenMemberLabels,
  });
  const foodIssues = evaluateFoodSafetyRules(candidate, safety);
  const pantryIssues = scanPantryNameSnapshotIssues(candidate, safety, stored);
  const issues: MenuValidationIssue[] = [...allergenResult.issues, ...foodIssues, ...pantryIssues];

  for (const member of safety.members) {
    if (member.allergyStatus === "unconfirmed") {
      issues.push({
        code: "allergy_unconfirmed",
        path: member.anonymousRef,
        message: "アレルギー確認が必要です",
      });
    }
    // U3-002: generation / validateGeneratedMenu と同型。registered なのに針が無い状態を false-valid にしない。
    if (
      member.allergyStatus === "registered" &&
      member.allergenIds.length === 0 &&
      member.customAllergies.length === 0
    ) {
      issues.push({
        code: "allergen_missing",
        path: member.anonymousRef,
        message: "登録アレルゲンを選んでください",
      });
    }
    // AGS-I2: 評価可能なカスタムは evaluateAllergens 側。空のときだけ unmapped。
    if (
      member.hasUnmappedCustomAllergy &&
      member.customAllergies.every(
        (entry) => entry.name.trim() === "" && entry.aliases.every((alias) => alias.trim() === ""),
      )
    ) {
      issues.push({
        code: "unmapped_custom_allergy",
        path: member.anonymousRef,
        message: "自由登録アレルギーを固定候補へ対応付けできません",
      });
    }
    if (member.unsupportedDietStatus === "unconfirmed") {
      issues.push({
        code: "unsupported_diet_unconfirmed",
        path: member.anonymousRef,
        message: "対象外条件の確認が必要です",
      });
    }
    if (member.unsupportedDietStatus === "present") {
      issues.push({
        code: "unsupported_diet_present",
        path: member.anonymousRef,
        message: "対象外条件のあるメンバーは対象にできません",
      });
    }
  }

  const pantryItemIds = stored.menu.pantryUsage.flatMap((usage) =>
    usage.pantryItemId === null ? [] : [usage.pantryItemId],
  );
  const [livePantry, livePreferences] = await Promise.all([
    loadLivePantryQuantities(ownerClient, pantryItemIds),
    loadCurrentMemberPreferences(ownerClient, stored.targetMemberIds),
  ]);
  const changedDetails = detectChangedDetails(stored, livePantry, livePreferences);

  return {
    ok: issues.length === 0,
    candidate,
    issues,
    changedDetails,
  };
}

function memberDisplayLabel(stored: StoredMenuAggregate, anonymousMemberRef: string): string {
  const target = stored.targetMembers.find(
    (member) => member.anonymousMemberRef === anonymousMemberRef,
  );
  if (target === undefined) {
    const suffix = anonymousMemberRef.slice("member_".length);
    return `家族${suffix}`;
  }
  const live = target.displayName.trim();
  if (live !== "") return live;
  const snapshot = target.displayNameSnapshot.trim();
  if (snapshot !== "") return snapshot;
  const suffix = anonymousMemberRef.slice("member_".length);
  return `家族${suffix}`;
}

/**
 * 現行 canonical label requirements を service-role RPC で reconcile し、
 * 返却行の immutable source_text_snapshot をそのまま表示用 sourceText にする。
 */
export async function reconcileCurrentMenuLabelWarnings(
  admin: AdminSupabaseClient,
  user: AuthenticatedUser,
  input: {
    stored: StoredMenuAggregate;
    candidate: GeneratedMenu;
    safetyFingerprint: string;
  },
): Promise<readonly CurrentMenuLabelWarning[]> {
  const requirements = input.candidate.labelConfirmations.map((item) => ({
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    sourcePath: item.sourcePath,
    sourceTextSnapshot: item.sourceText,
    allergenId: item.allergenId,
    anonymousMemberRef: item.anonymousMemberRef,
    dictionaryVersion: item.dictionaryVersion,
  }));
  const requirementsJson = JSON.parse(JSON.stringify(requirements)) as Json;

  const { data, error } = await admin.rpc("reconcile_menu_label_confirmations", {
    p_user_id: user.userId,
    p_menu_id: input.stored.menu.menuId,
    p_expected_safety_fingerprint: input.safetyFingerprint,
    p_requirements: requirementsJson,
  });

  if (error !== null) {
    throw new HttpError(503, "revalidation_unavailable", "現在の家族設定で確認できませんでした");
  }

  const rows = Array.isArray(data) ? data : [];
  const catalogResult = await admin.from("allergen_catalog").select("id,display_name");
  const catalogRows = catalogResult.error !== null ? [] : catalogResult.data;
  const catalog = new Map(catalogRows.map((row) => [row.id, row.display_name] as const));

  const warnings: CurrentMenuLabelWarning[] = [];
  for (const raw of rows) {
    const parsed = reconcileRowSchema.safeParse(raw);
    if (!parsed.success) {
      throw new HttpError(503, "revalidation_unavailable", "現在の家族設定で確認できませんでした");
    }
    const row = parsed.data;
    const allergenName = (catalog.get(row.allergen_id) ?? "").trim() || "確認対象アレルゲン";
    warnings.push({
      confirmationId: row.id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      sourcePath: row.source_path,
      // RPC が保存したスナップショットをそのまま表示。candidate から再解決しない。
      sourceText: row.source_text_snapshot,
      allergenId: row.allergen_id,
      allergenName,
      anonymousMemberRef: row.anonymous_member_ref,
      memberLabel: memberDisplayLabel(input.stored, row.anonymous_member_ref),
      dictionaryVersion: row.dictionary_version,
      confirmationStatus: row.confirmation_status,
    });
  }

  // 表示順を決定論的に固定（path → allergen → member）
  return warnings
    .toSorted((left, right) => {
      const byPath = left.sourcePath.localeCompare(right.sourcePath);
      if (byPath !== 0) return byPath;
      const byAllergen = left.allergenId.localeCompare(right.allergenId);
      if (byAllergen !== 0) return byAllergen;
      return left.anonymousMemberRef.localeCompare(right.anonymousMemberRef);
    })
    .slice(0, 200);
}

/**
 * 再生成用: 所有者境界で現行 pantry / preference を読み直し GenerationContext を組む。
 * mount 時 revalidation は validateStoredMenuCurrentSafety を使い、こちらは
 * 利用者が現行入力を確認した後の full generation validation にだけ使う。
 */
export async function buildStoredGenerationContext(input: {
  ownerClient: UserSupabaseClient;
  admin: AdminSupabaseClient;
  stored: StoredMenuAggregate;
  userId: string;
  idempotencyKey: string;
}): Promise<HouseholdGenerationContext> {
  const { ownerClient, admin, stored, userId, idempotencyKey } = input;
  if (stored.targetMemberIds.length === 0) {
    throw new HttpError(422, "current_target_member_required", "再生成できる対象の家族がいません");
  }
  const renumberedSafety = await loadCurrentSafetyContext(admin, userId, stored.targetMemberIds);
  const safety = withHistoricalAnonymousRefs(renumberedSafety, stored);
  const livePreferences = await loadCurrentMemberPreferences(ownerClient, stored.targetMemberIds);

  const pantryItemIds = stored.menu.pantryUsage.flatMap((usage) =>
    usage.pantryItemId === null ? [] : [usage.pantryItemId],
  );
  const pantryItems: Array<GenerationContext["pantryItems"][number]> = [];
  if (pantryItemIds.length > 0) {
    const { data, error } = await ownerClient
      .from("pantry_items")
      .select(
        "id,user_id,name,quantity,unit,expires_on,expiration_type,opened_state,created_at,updated_at",
      )
      .in("id", [...pantryItemIds]);
    // U3-003: 読取失敗を空配列のまま進めると再生成が fail-open になる。live 在庫読取と同型で閉じる。
    if (error !== null) {
      throw new HttpError(503, "internal_error", "冷蔵庫の食材を確認できませんでした");
    }
    for (const row of data) {
      const expirationType =
        row.expiration_type === "use_by" ||
        row.expiration_type === "best_before" ||
        row.expiration_type === "other" ||
        row.expiration_type === "unknown"
          ? row.expiration_type
          : null;
      const openedState =
        row.opened_state === "unopened" ||
        row.opened_state === "opened" ||
        row.opened_state === "unknown"
          ? row.opened_state
          : null;
      pantryItems.push({
        id: row.id,
        userId: row.user_id,
        name: row.name,
        quantity: row.quantity,
        unit: row.unit,
        expiresOn: row.expires_on,
        expirationType,
        openedState,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }
  }

  const surviving = stored.targetMembers.filter(
    (
      member,
    ): member is StoredMenuAggregate["targetMembers"][number] & {
      householdMemberId: string;
    } => member.householdMemberId !== null,
  );

  const asPortion = (value: string | null | undefined): PortionSize | null =>
    value === "small" || value === "regular" || value === "large" ? value : null;
  const asSpice = (value: string | null | undefined): SpiceLevel | null =>
    value === "none" || value === "mild" || value === "regular" ? value : null;
  const asEase = (values: readonly string[] | undefined): EasePreference[] =>
    (values ?? []).flatMap((value) =>
      value === "small_pieces" || value === "boneless" || value === "soft" ? [value] : [],
    );

  // U3-006: ライブ好みが欠ける対象を regular/空 dislikes で埋めない（generation と同型で fail-closed）
  const memberPreferences = surviving.map((member) => {
    const live = livePreferences.get(member.householdMemberId);
    if (live === undefined) {
      throw new HttpError(422, "invalid_request", "家族の好み設定を確認できませんでした");
    }
    const portionSize = asPortion(live.portionSize);
    const spiceLevel = asSpice(live.spiceLevel);
    if (portionSize === null || spiceLevel === null) {
      throw new HttpError(422, "invalid_request", "家族の分量・辛さ設定を確認してください");
    }
    return {
      householdMemberId: member.householdMemberId,
      anonymousMemberRef: member.anonymousMemberRef,
      portionSize,
      spiceLevel,
      easePreferences: asEase(live.easePreferences),
      dislikes: [...live.dislikes],
    };
  });

  return {
    targetMode: "household" as const,
    submission: {
      mealType: stored.menu.mealType,
      mainIngredients: [],
      cuisineGenre: stored.menu.cuisineGenre,
      targetMode: "household" as const,
      targetMemberIds: surviving.map((member) => member.householdMemberId),
      servings: null,
      timeLimitMinutes: null,
      budgetPreference: null,
      ingredientPreference: null,
      avoidIngredients: [],
      memo: "",
      pantrySelections: pantryItems.map((item) => ({
        pantryItemId: item.id,
        priority: "prefer_use" as const,
      })),
    },
    safety,
    pantryItems,
    memberPreferences,
    targetMembers: surviving.map((member) => ({
      householdMemberId: member.householdMemberId,
      anonymousRef: member.anonymousMemberRef,
      displayNameSnapshot: member.displayNameSnapshot,
    })),
    allergenVersion: safety.dictionaryVersion,
    foodRuleVersion: safety.foodRuleVersion,
    expiredPantryChecks: [],
    idempotencyKey,
    preferenceSnapshot:
      typeof stored.preferenceSnapshot === "object" && stored.preferenceSnapshot !== null
        ? (stored.preferenceSnapshot as Readonly<Record<string, unknown>>)
        : {},
    safetySnapshot: {},
  };
}

export function createRevalidationDeps(user: AuthenticatedUser): RevalidationDeps {
  const ownerClient = createUserScopedSupabase(user.accessToken);
  const admin = getSupabaseAdmin();
  return {
    loadMenu: async (userId, menuId) => {
      // 所有権は JWT 所有者クライアントの user_id 一致で先に証明する
      return loadStoredMenu(ownerClient, userId, menuId);
    },
    loadCurrentSafety: async (userId, stored) => {
      // mount 再検証でも空ターゲットを 422 で閉じる（silent valid を出さない）
      if (stored.targetMemberIds.length === 0) {
        throw new HttpError(
          422,
          "current_target_member_required",
          "現在の家族を1人以上選んでください",
        );
      }
      const safety = await loadCurrentSafetyContext(admin, userId, stored.targetMemberIds);
      return {
        fingerprint: createCurrentSafetyFingerprint(safety),
        allergenCatalogVersion: safety.dictionaryVersion,
        foodRuleVersion: safety.foodRuleVersion,
      };
    },
    validateStoredCurrentSafety: async ({ stored, userId }) =>
      validateStoredMenuCurrentSafety({ ownerClient, admin, stored, userId }),
    reconcileCurrentLabelWarnings: (input) => reconcileCurrentMenuLabelWarnings(admin, user, input),
    save: async (value) => {
      // menu_id,user_id 一意で最新 1 行を置換。マウント連打でも増殖しない。
      const issuesJson = JSON.parse(JSON.stringify(value.issues)) as Json;
      const { error } = await admin.from("menu_revalidations").upsert(
        {
          user_id: value.userId,
          menu_id: value.menuId,
          safety_fingerprint: value.safetyFingerprint,
          allergen_catalog_version: value.allergenCatalogVersion,
          food_rule_version: value.foodRuleVersion,
          status: value.status,
          issues: issuesJson,
          created_at: new Date().toISOString(),
        },
        { onConflict: "menu_id,user_id" },
      );
      if (error !== null) {
        throw new HttpError(
          503,
          "revalidation_unavailable",
          "現在の家族設定で確認できませんでした",
        );
      }
    },
  };
}
