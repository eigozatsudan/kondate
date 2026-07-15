import type { EasePreference, PortionSize, SpiceLevel } from "../contracts/domain.js";
import type { PantryItem } from "../contracts/pantry.js";
import type { PlannerSubmission } from "../contracts/planner.js";
import type { CurrentSafetyContext } from "./context.js";

export type ExpiredPantryCheck = { pantryItemId: string; checkedAt: string };

export type GenerationMemberPreference = {
  householdMemberId: string;
  anonymousMemberRef: string;
  portionSize: PortionSize;
  spiceLevel: SpiceLevel;
  easePreferences: readonly EasePreference[];
  dislikes: readonly string[];
};

export type GenerationContext = {
  submission: PlannerSubmission;
  safety: CurrentSafetyContext;
  pantryItems: readonly PantryItem[];
  memberPreferences: readonly GenerationMemberPreference[];
  targetMembers: readonly {
    householdMemberId: string;
    anonymousRef: string;
    displayNameSnapshot: string;
  }[];
  expiredPantryChecks: readonly ExpiredPantryCheck[];
  idempotencyKey: string;
  preferenceSnapshot: Readonly<Record<string, unknown>>;
  safetySnapshot: Readonly<Record<string, unknown>>;
};
