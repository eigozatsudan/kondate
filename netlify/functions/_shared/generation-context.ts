import { z } from "zod";
import {
  generationConflictSchema,
  type ExpiredPantryConfirmation,
  type GenerationFailureCode,
  type NewMenuGenerationRequest,
} from "../../../shared/contracts/generation.js";
import { pantryItemSchema, pantrySelectionDraftSchema } from "../../../shared/contracts/pantry.js";
import {
  collectPlannerRequestText,
  plannerSubmissionSchema,
  targetModes,
} from "../../../shared/contracts/planner.js";
import { privacyNoticeVersion } from "../../../shared/contracts/domain.js";
import { normalizeFoodText } from "../../../shared/safety/allergens.js";
import { detectUnsupportedMedicalRequest } from "../../../shared/safety/medical-scope.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";
import { getJstDateKey } from "../../../shared/time/jst.js";
import type { AuthenticatedUser } from "./generation-repository.js";
import { HttpError } from "./http.js";
import { hasExactCurrentSafetyManifest, loadCurrentSafetyContext } from "./current-safety.js";
import { getSupabaseAdmin } from "./supabase-admin.js";
import { createUserScopedSupabase } from "./supabase-user.js";

export type GenerationPreflightConflict = z.infer<typeof generationConflictSchema>;

export const generationPreflightIssuePriority = [
  "internal_error",
  "allergy_unconfirmed",
  "allergen_missing",
  "unmapped_custom_allergy",
  "unsupported_diet_unconfirmed",
  "unsupported_diet",
  "invalid_request",
  "expired_pantry_unconfirmed",
  "allergy_conflict",
  "allergen_pantry_conflict",
  "must_use_conflict",
] as const;

export type GenerationPreflightIssueCode = (typeof generationPreflightIssuePriority)[number];
export type GenerationPreflightResult =
  | { ok: true }
  | {
      ok: false;
      terminal: "failed";
      primaryCode: GenerationFailureCode;
      issueCodes: readonly GenerationPreflightIssueCode[];
    }
  | {
      ok: false;
      terminal: "constraint_conflict";
      primaryCode: "allergen_pantry_conflict" | "must_use_conflict";
      issueCodes: readonly GenerationPreflightIssueCode[];
      conflicts: readonly GenerationPreflightConflict[];
    };

const snapshotRowSchema = z
  .object({
    draft_id: z.uuid(),
    draft_revision: z.number().int().positive(),
    meal_type: z.enum(["breakfast", "lunch", "dinner"]),
    main_ingredients: z.array(z.string()),
    cuisine_genre: z.enum(["japanese", "western", "chinese", "any"]),
    target_mode: z.enum(targetModes),
    target_member_ids: z.array(z.uuid()),
    servings: z.number().int().min(1).max(20).nullable(),
    time_limit_minutes: z.union([z.literal(15), z.literal(30), z.literal(45)]).nullable(),
    budget_preference: z.enum(["economy", "standard"]).nullable(),
    avoid_ingredients: z.array(z.string()),
    memo: z.string(),
    pantry_selections: z.array(pantrySelectionDraftSchema),
    captured_at: z.iso.datetime({ offset: true }),
  })
  .strict();

const consentRowSchema = z
  .object({
    user_id: z.uuid(),
    notice_version: z.literal(privacyNoticeVersion),
    accepted_at: z.iso.datetime({ offset: true }),
  })
  .strict();

const householdMemberRowSchema = z
  .object({
    id: z.uuid(),
    user_id: z.uuid(),
    status: z.enum(["draft", "complete"]),
    display_name: z.string().nullable(),
    age_band: z
      .enum(["post_weaning_to_2", "age_3_5", "age_6_8", "age_9_12", "age_13_17", "adult", "senior"])
      .nullable(),
    portion_size: z.enum(["small", "regular", "large"]).nullable(),
    spice_level: z.enum(["none", "mild", "regular"]).nullable(),
    ease_preferences: z.array(z.enum(["small_pieces", "boneless", "soft"])),
    allergy_status: z.enum(["none", "registered", "unconfirmed"]).nullable(),
    unsupported_diet_status: z.enum(["none", "present", "unconfirmed"]).nullable(),
    unsupported_diet_kinds: z.array(
      z.enum(["weaning_food", "swallowing_concern", "therapeutic_diet"]),
    ),
  })
  .strict();

const dislikeRowSchema = z
  .object({ member_id: z.uuid(), ingredient_name: z.string().min(1) })
  .strict();

const pantryRowSchema = z
  .object({
    id: z.uuid(),
    user_id: z.uuid(),
    name: z.string(),
    quantity: z.number().nullable(),
    unit: z.string().nullable(),
    expires_on: z.iso.date().nullable(),
    expiration_type: z.enum(["use_by", "best_before", "other", "unknown"]).nullable(),
    opened_state: z.enum(["unopened", "opened", "unknown"]).nullable(),
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict();

type HouseholdMemberRow = z.infer<typeof householdMemberRowSchema>;
type CompleteHouseholdMemberRow = Omit<
  HouseholdMemberRow,
  "display_name" | "age_band" | "portion_size" | "spice_level"
> & {
  display_name: string;
  age_band: NonNullable<HouseholdMemberRow["age_band"]>;
  portion_size: NonNullable<HouseholdMemberRow["portion_size"]>;
  spice_level: NonNullable<HouseholdMemberRow["spice_level"]>;
};

const invalidRequest = () =>
  new HttpError(422, "invalid_request", "現在の入力内容を確認できませんでした。");

function memberFailure(member: HouseholdMemberRow): GenerationFailureCode | null {
  if (member.status !== "complete" || member.age_band === null) return "invalid_request";
  if (member.allergy_status === "unconfirmed") return "allergy_unconfirmed";
  if (member.allergy_status === null) return "invalid_request";
  if (member.unsupported_diet_status === "unconfirmed") return "unsupported_diet_unconfirmed";
  if (member.unsupported_diet_status === "present") return "unsupported_diet";
  if (member.unsupported_diet_status === null) return "invalid_request";
  if (member.display_name === null || member.portion_size === null || member.spice_level === null) {
    return "invalid_request";
  }
  return null;
}

function requireCompleteMember(member: HouseholdMemberRow): CompleteHouseholdMemberRow {
  const failure = memberFailure(member);
  if (failure !== null) throwGenerationFailure(failure);
  if (
    member.display_name === null ||
    member.age_band === null ||
    member.portion_size === null ||
    member.spice_level === null
  ) {
    throw invalidRequest();
  }
  return {
    ...member,
    display_name: member.display_name,
    age_band: member.age_band,
    portion_size: member.portion_size,
    spice_level: member.spice_level,
  };
}

function throwGenerationFailure(code: GenerationFailureCode): never {
  throw new HttpError(422, code, "現在の入力内容では献立を作成できません。");
}

export function validateTransientChecks(
  checks: readonly ExpiredPantryConfirmation[],
  selectedIds: readonly string[],
  expiredSelectedIds: readonly string[],
  now: Date,
): readonly ExpiredPantryConfirmation[] {
  const selected = new Set(selectedIds);
  const expired = new Set(expiredSelectedIds);
  const checkIds = checks.map((check) => check.pantryItemId);
  const today = getJstDateKey(now);
  const valid =
    selected.size === selectedIds.length &&
    expired.size === expiredSelectedIds.length &&
    new Set(checkIds).size === checkIds.length &&
    checks.length === expired.size &&
    checkIds.every((id) => selected.has(id) && expired.has(id)) &&
    checks.every((check) => {
      const checkedAt = new Date(check.checkedAt);
      return (
        !Number.isNaN(checkedAt.getTime()) &&
        checkedAt.getTime() <= now.getTime() &&
        getJstDateKey(checkedAt) === today
      );
    });
  if (!valid) throwGenerationFailure("expired_pantry_unconfirmed");
  const byId = new Map(checks.map((check) => [check.pantryItemId, check]));
  return expiredSelectedIds.map((id) => {
    const check = byId.get(id);
    if (check === undefined) throwGenerationFailure("expired_pantry_unconfirmed");
    return check;
  });
}

function mapSnapshot(row: z.infer<typeof snapshotRowSchema>) {
  return plannerSubmissionSchema.parse({
    mealType: row.meal_type,
    mainIngredients: row.main_ingredients,
    cuisineGenre: row.cuisine_genre,
    targetMode: row.target_mode,
    targetMemberIds: row.target_member_ids,
    servings: row.servings,
    timeLimitMinutes: row.time_limit_minutes,
    budgetPreference: row.budget_preference,
    avoidIngredients: row.avoid_ingredients,
    memo: row.memo,
    pantrySelections: row.pantry_selections,
  });
}

export async function loadGenerationContext(
  user: AuthenticatedUser,
  requestId: string,
  request: NewMenuGenerationRequest,
  now: Date = new Date(),
): Promise<GenerationContext> {
  const admin = getSupabaseAdmin();
  const { data: snapshotData, error: snapshotError } = await admin.rpc(
    "get_ai_generation_submission_snapshot",
    { p_request_id: requestId, p_user_id: user.userId },
  );
  if (snapshotError !== null || !Array.isArray(snapshotData) || snapshotData.length !== 1) {
    throw new HttpError(404, "draft_not_found", "予約済みの入力を確認できませんでした。");
  }
  const parsedSnapshot = snapshotRowSchema.safeParse(snapshotData[0]);
  if (!parsedSnapshot.success) throw invalidRequest();
  if (
    parsedSnapshot.data.draft_id !== request.draftId ||
    parsedSnapshot.data.draft_revision !== request.draftRevision
  ) {
    throw invalidRequest();
  }
  let submission: GenerationContext["submission"];
  try {
    submission = mapSnapshot(parsedSnapshot.data);
  } catch {
    throw invalidRequest();
  }

  const userClient = createUserScopedSupabase(user.accessToken);
  const consentResult = await userClient
    .from("privacy_consents")
    .select("user_id,notice_version,accepted_at")
    .eq("user_id", user.userId)
    .eq("notice_version", privacyNoticeVersion)
    .maybeSingle();
  const consent = consentRowSchema.safeParse(consentResult.data);
  if (consentResult.error !== null || !consent.success || consent.data.user_id !== user.userId) {
    throw new HttpError(422, "consent_required", "最新の利用説明への同意が必要です。");
  }

  const memberResult = await userClient
    .from("household_members")
    .select(
      "id,user_id,status,display_name,age_band,portion_size,spice_level,ease_preferences,allergy_status,unsupported_diet_status,unsupported_diet_kinds",
    )
    .in("id", submission.targetMemberIds)
    .order("sort_order", { ascending: true });
  if (memberResult.error !== null) throw invalidRequest();
  const members = z.array(householdMemberRowSchema).safeParse(memberResult.data);
  if (!members.success || members.data.length !== submission.targetMemberIds.length) {
    throw invalidRequest();
  }
  const membersById = new Map(members.data.map((member) => [member.id, member]));
  const orderedMembers: CompleteHouseholdMemberRow[] = [];
  for (const memberId of submission.targetMemberIds) {
    const member = membersById.get(memberId);
    if (member === undefined || member.user_id !== user.userId) throw invalidRequest();
    orderedMembers.push(requireCompleteMember(member));
  }

  const dislikeResult = await userClient
    .from("member_dislikes")
    .select("member_id,ingredient_name")
    .in("member_id", submission.targetMemberIds);
  const dislikes = z.array(dislikeRowSchema).safeParse(dislikeResult.data);
  if (dislikeResult.error !== null || !dislikes.success) throw invalidRequest();

  const selectedIds = submission.pantrySelections.map((selection) => selection.pantryItemId);
  if (new Set(selectedIds).size !== selectedIds.length) throw invalidRequest();
  const pantryResult =
    selectedIds.length === 0
      ? { data: [], error: null }
      : await userClient
          .from("pantry_items")
          .select(
            "id,user_id,name,quantity,unit,expires_on,expiration_type,opened_state,created_at,updated_at",
          )
          .in("id", selectedIds);
  const pantryRows = z.array(pantryRowSchema).safeParse(pantryResult.data);
  if (
    pantryResult.error !== null ||
    !pantryRows.success ||
    pantryRows.data.length !== selectedIds.length ||
    pantryRows.data.some((row) => row.user_id !== user.userId)
  ) {
    throw invalidRequest();
  }
  const pantryItems = pantryRows.data.map((row) =>
    pantryItemSchema.parse({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      quantity: row.quantity,
      unit: row.unit,
      expiresOn: row.expires_on,
      expirationType: row.expiration_type,
      openedState: row.opened_state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  );
  const today = getJstDateKey(now);
  const expiredIds = submission.pantrySelections
    .filter((selection) => {
      const item = pantryItems.find((candidate) => candidate.id === selection.pantryItemId);
      return item !== undefined && item.expiresOn !== null && item.expiresOn < today;
    })
    .map((selection) => selection.pantryItemId);
  const expiredPantryChecks = validateTransientChecks(
    request.expiredPantryConfirmations,
    selectedIds,
    expiredIds,
    now,
  );

  const safety = await loadCurrentSafetyContext(admin, user.userId, submission.targetMemberIds);
  for (const member of safety.members) {
    if (member.allergyStatus === "registered" && member.allergenIds.length === 0) {
      throwGenerationFailure("allergen_missing");
    }
    if (member.hasUnmappedCustomAllergy) throwGenerationFailure("unmapped_custom_allergy");
  }
  const targetMembers = orderedMembers.map((member, index) => ({
    householdMemberId: member.id,
    anonymousRef: `member_${String(index + 1)}`,
    displayNameSnapshot: member.display_name,
  }));
  if (
    safety.members.some((member, index) => {
      const target = targetMembers.at(index);
      return (
        target === undefined ||
        member.householdMemberId !== target.householdMemberId ||
        member.anonymousRef !== target.anonymousRef
      );
    })
  ) {
    throw invalidRequest();
  }
  const memberPreferences = orderedMembers.map((member, index) => ({
    householdMemberId: member.id,
    anonymousMemberRef: `member_${String(index + 1)}`,
    portionSize: member.portion_size,
    spiceLevel: member.spice_level,
    easePreferences: [...member.ease_preferences],
    dislikes: dislikes.data
      .filter((row) => row.member_id === member.id)
      .map((row) => row.ingredient_name),
  }));

  return {
    submission,
    safety: {
      ...safety,
      requestText: [
        ...submission.mainIngredients,
        ...submission.avoidIngredients,
        submission.memo,
      ].join("\n"),
    },
    pantryItems,
    memberPreferences,
    targetMembers,
    expiredPantryChecks,
    idempotencyKey: request.idempotencyKey,
    preferenceSnapshot: { submission, memberPreferences },
    safetySnapshot: safety,
  };
}

function containsAlias(text: string, aliases: readonly { normalizedAlias: string }[]): boolean {
  const normalized = normalizeFoodText(text);
  return aliases.some((alias) => normalized.includes(normalizeFoodText(alias.normalizedAlias)));
}

export function validateGenerationPreflight(
  context: GenerationContext,
  now: Date,
): GenerationPreflightResult {
  const issues = new Set<GenerationPreflightIssueCode>();
  if (!hasExactCurrentSafetyManifest(context.safety)) issues.add("internal_error");
  const submissionIds = context.submission.targetMemberIds;
  const targetIds = context.targetMembers.map((member) => member.householdMemberId);
  const safetyIds = context.safety.members.map((member) => member.householdMemberId);
  const preferenceIds = context.memberPreferences.map((member) => member.householdMemberId);
  const memberCount = submissionIds.length;
  if (
    memberCount === 0 ||
    targetIds.length !== memberCount ||
    safetyIds.length !== memberCount ||
    preferenceIds.length !== memberCount ||
    new Set(submissionIds).size !== memberCount ||
    new Set(targetIds).size !== memberCount ||
    new Set(safetyIds).size !== memberCount ||
    new Set(preferenceIds).size !== memberCount ||
    submissionIds.some((id, index) => {
      const expectedRef = `member_${String(index + 1)}`;
      return (
        targetIds[index] !== id ||
        safetyIds[index] !== id ||
        preferenceIds[index] !== id ||
        context.targetMembers[index]?.anonymousRef !== expectedRef ||
        context.safety.members[index]?.anonymousRef !== expectedRef ||
        context.memberPreferences[index]?.anonymousMemberRef !== expectedRef
      );
    })
  ) {
    issues.add("invalid_request");
  }
  for (const member of context.safety.members) {
    if (member.allergyStatus === "unconfirmed") issues.add("allergy_unconfirmed");
    if (member.allergyStatus === "registered" && member.allergenIds.length === 0) {
      issues.add("allergen_missing");
    }
    if (member.hasUnmappedCustomAllergy) issues.add("unmapped_custom_allergy");
    if (member.unsupportedDietStatus === "unconfirmed") {
      issues.add("unsupported_diet_unconfirmed");
    }
    if (member.unsupportedDietStatus === "present") issues.add("unsupported_diet");
    for (const allergenId of member.allergenIds) {
      const aliases = context.safety.allergenDictionary.aliases.filter(
        (alias) => alias.allergenId === allergenId,
      );
      if (aliases.length === 0) issues.add("allergen_missing");
      if (
        context.submission.mainIngredients.some((ingredient) => containsAlias(ingredient, aliases))
      ) {
        issues.add("allergy_conflict");
      }
      if (
        context.pantryItems.some((item) =>
          context.submission.pantrySelections.some(
            (selection) => selection.pantryItemId === item.id && containsAlias(item.name, aliases),
          ),
        )
      ) {
        issues.add("allergen_pantry_conflict");
      }
    }
  }
  const selectedIds = context.submission.pantrySelections.map(
    (selection) => selection.pantryItemId,
  );
  const pantryIds = context.pantryItems.map((item) => item.id);
  if (
    selectedIds.length > 50 ||
    new Set(selectedIds).size !== selectedIds.length ||
    new Set(pantryIds).size !== pantryIds.length ||
    pantryIds.length !== selectedIds.length ||
    selectedIds.some((id) => !pantryIds.includes(id))
  ) {
    issues.add("invalid_request");
  }
  const today = getJstDateKey(now);
  const expiredIds = selectedIds.filter((id) => {
    const item = context.pantryItems.find((candidate) => candidate.id === id);
    return item !== undefined && item.expiresOn !== null && item.expiresOn < today;
  });
  try {
    validateTransientChecks(context.expiredPantryChecks, selectedIds, expiredIds, now);
  } catch {
    issues.add("expired_pantry_unconfirmed");
  }
  for (const avoided of context.submission.avoidIngredients) {
    if (
      context.submission.mainIngredients.some(
        (main) => normalizeFoodText(main) === normalizeFoodText(avoided),
      )
    ) {
      issues.add("invalid_request");
    }
    if (
      context.submission.pantrySelections.some(
        (selection) =>
          selection.priority === "must_use" &&
          context.pantryItems.some(
            (item) =>
              item.id === selection.pantryItemId &&
              normalizeFoodText(item.name) === normalizeFoodText(avoided),
          ),
      )
    ) {
      issues.add("must_use_conflict");
    }
  }
  if (detectUnsupportedMedicalRequest(collectPlannerRequestText(context.submission)).length > 0) {
    issues.add("unsupported_diet");
  }

  const issueCodes = generationPreflightIssuePriority.filter((code) => issues.has(code));
  const primaryCode = issueCodes[0];
  if (primaryCode === undefined) return { ok: true };
  if (primaryCode === "allergen_pantry_conflict" || primaryCode === "must_use_conflict") {
    const pantryRef = new Map(
      context.submission.pantrySelections.map(
        (selection, index) => [selection.pantryItemId, `pantry_${String(index + 1)}`] as const,
      ),
    );
    const conflicts = issueCodes
      .filter(
        (code): code is "allergen_pantry_conflict" | "must_use_conflict" =>
          code === "allergen_pantry_conflict" || code === "must_use_conflict",
      )
      .map((code) => {
        const conditionRefs = new Set<string>();
        if (code === "allergen_pantry_conflict") {
          for (const member of context.safety.members) {
            const aliases = context.safety.allergenDictionary.aliases.filter((alias) =>
              member.allergenIds.includes(alias.allergenId),
            );
            for (const selection of context.submission.pantrySelections) {
              const item = context.pantryItems.find(
                (candidate) => candidate.id === selection.pantryItemId,
              );
              if (item !== undefined && containsAlias(item.name, aliases)) {
                const ref = pantryRef.get(selection.pantryItemId);
                if (ref === undefined) continue;
                conditionRefs.add(member.anonymousRef);
                conditionRefs.add(ref);
              }
            }
          }
        } else {
          for (const selection of context.submission.pantrySelections) {
            const item = context.pantryItems.find(
              (candidate) => candidate.id === selection.pantryItemId,
            );
            if (
              selection.priority === "must_use" &&
              item !== undefined &&
              context.submission.avoidIngredients.some(
                (avoided) => normalizeFoodText(avoided) === normalizeFoodText(item.name),
              )
            ) {
              const ref = pantryRef.get(selection.pantryItemId);
              if (ref !== undefined) conditionRefs.add(ref);
            }
          }
        }
        return {
          code,
          message:
            code === "allergen_pantry_conflict"
              ? "選択した在庫食材とアレルギー条件が競合しています。"
              : "必ず使う食材と避けたい食材が競合しています。",
          conditionRefs: [...conditionRefs].sort().slice(0, 24),
        };
      });
    return { ok: false, terminal: "constraint_conflict", primaryCode, issueCodes, conflicts };
  }
  return {
    ok: false,
    terminal: "failed",
    primaryCode: primaryCode as GenerationFailureCode,
    issueCodes,
  };
}
