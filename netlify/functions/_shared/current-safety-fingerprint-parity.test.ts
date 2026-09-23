import { expect, it } from "vitest";
import type { CurrentSafetyContext, CurrentSafetyMember } from "../../../shared/safety/context.js";
import { createCurrentSafetyFingerprint } from "../../../shared/safety/fingerprint.js";
import { makeCurrentSafetyContext } from "../../../shared/testing/factories.js";
import { currentAllergenAliasManifest } from "./current-safety.js";

// supabase/tests/database/ai_control_and_quota.test.sql の fingerprint fixture を TS 側で再現し、
// SQL private.current_safety_fingerprint の pgTAP 固定値と同じ digest になることを固定する。
// 辞書は実 DB の alias 行と一致する manifest（hasExactCurrentSafetyManifest の正本）を使う。
// どちらか一方だけの JSON 形状・並び順が変わると、pgTAP かこのテストのどちらかが落ちる。
const dictionaryVersion = "jp-caa-2026-04.v1";
const childId = "15100000-0000-4000-8000-000000000001";
const adultId = "15100000-0000-4000-8000-000000000002";

const child: Omit<CurrentSafetyMember, "anonymousRef"> = {
  householdMemberId: childId,
  ageBand: "age_3_5",
  allergyStatus: "registered",
  allergenIds: ["wheat", "egg"],
  hasUnmappedCustomAllergy: true,
  customAllergies: [{ name: "独自食材", aliases: ["独自別名"] }],
  requiredSafetyConstraints: ["remove_bones", "cut_small"],
  unsupportedDietStatus: "present",
  unsupportedDietKinds: ["therapeutic_diet", "swallowing_concern"],
};
const adult: Omit<CurrentSafetyMember, "anonymousRef"> = {
  householdMemberId: adultId,
  ageBand: "adult",
  allergyStatus: "none",
  allergenIds: [],
  hasUnmappedCustomAllergy: false,
  customAllergies: [],
  requiredSafetyConstraints: [],
  unsupportedDietStatus: "none",
  unsupportedDietKinds: [],
};

function sqlFixtureContext(orderedMembers: readonly (typeof child)[]): CurrentSafetyContext {
  const base = makeCurrentSafetyContext();
  return makeCurrentSafetyContext({
    dictionaryVersion,
    members: orderedMembers.map((member, index) => ({
      ...member,
      anonymousRef: `member_${String(index + 1)}`,
    })),
    allergenDictionary: {
      ...base.allergenDictionary,
      version: dictionaryVersion,
      aliases: currentAllergenAliasManifest.map((entry) => ({ ...entry, dictionaryVersion })),
    },
  });
}

it("matches the pgTAP-pinned SQL current_safety_fingerprint for the shared fixture", () => {
  expect(createCurrentSafetyFingerprint(sqlFixtureContext([child, adult]))).toBe(
    "d6fd851cc243f1cc8ebce012a24006a98455795ca4e368b553b2fd58c074a535",
  );
  expect(createCurrentSafetyFingerprint(sqlFixtureContext([adult, child]))).toBe(
    "3ab3ed551af3efdcfab13f7e112a3e4d06b036b59fd797aaaae9204935e689e1",
  );
});
