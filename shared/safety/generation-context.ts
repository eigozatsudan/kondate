import type { EasePreference, PortionSize, SpiceLevel } from "../contracts/domain.js";
import type { PantryItem } from "../contracts/pantry.js";
import type { PlannerSubmission } from "../contracts/planner.js";
import type { CurrentSafetyContext } from "./context.js";
import type { ideaSafetySnapshot } from "./idea-fingerprint.js";

export type ExpiredPantryCheck = { pantryItemId: string; checkedAt: string };

export type GenerationMemberPreference = {
  householdMemberId: string;
  anonymousMemberRef: string;
  portionSize: PortionSize;
  spiceLevel: SpiceLevel;
  easePreferences: readonly EasePreference[];
  dislikes: readonly string[];
};

export type GenerationTargetMember = {
  householdMemberId: string;
  anonymousRef: string;
  displayNameSnapshot: string;
};

export type GenerationContextBase = {
  pantryItems: readonly PantryItem[];
  expiredPantryChecks: readonly ExpiredPantryCheck[];
  idempotencyKey: string;
  preferenceSnapshot: Readonly<Record<string, unknown>>;
  safetySnapshot: Readonly<Record<string, unknown>>;
};

/**
 * 家族モード: 現行 safety / 対象家族 / アレルゲン版を必須で持つ。
 * アイデア mode とフィールドを混ぜず、判別可能 union で閉じる。
 */
export type HouseholdGenerationContext = GenerationContextBase & {
  targetMode: "household";
  submission: Extract<PlannerSubmission, { targetMode: "household" }>;
  safety: CurrentSafetyContext;
  memberPreferences: readonly GenerationMemberPreference[];
  targetMembers: readonly GenerationTargetMember[];
  allergenVersion: string;
  foodRuleVersion: string;
};

/**
 * アイデアモード: 家族表を読まず、safety は null、対象 0 件、版は null。
 * 永続 safety_snapshot は ideaSafetySnapshot 固定形を用いる。
 */
export type IdeaGenerationContext = GenerationContextBase & {
  targetMode: "idea";
  submission: Extract<PlannerSubmission, { targetMode: "idea" }>;
  safety: null;
  memberPreferences: readonly [];
  targetMembers: readonly [];
  allergenVersion: null;
  foodRuleVersion: null;
  safetySnapshot: typeof ideaSafetySnapshot | Readonly<Record<string, unknown>>;
};

export type GenerationContext = HouseholdGenerationContext | IdeaGenerationContext;
