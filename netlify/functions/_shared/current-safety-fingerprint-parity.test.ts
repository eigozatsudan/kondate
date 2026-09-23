import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { AllergenAlias } from "../../../shared/safety/allergens.js";
import type { CurrentSafetyContext, CurrentSafetyMember } from "../../../shared/safety/context.js";
import { createCurrentSafetyFingerprint } from "../../../shared/safety/fingerprint.js";
import { makeCurrentSafetyContext } from "../../../shared/testing/factories.js";

// supabase/tests/database/ai_control_and_quota.test.sql の fingerprint fixture を TS 側で再現し、
// SQL private.current_safety_fingerprint と同じ digest になることを確かめる。
// 固定辞書（pgTAP がトランザクション内で差し替える alias 行）と期待値は、どちらも pgTAP の
// ファイルから直接読み取る。TS 側に値の写しを持たないので、次のどちらでもこのテストが落ちる。
// - pgTAP の期待値だけを貼り直した（TS の計算結果と合わなくなる）。
// - TS の JSON 形状や並び順だけを変えた（pgTAP の期待値と合わなくなる）。
// 逆に、ここを通すために pgTAP の期待値を TS の値へ貼り直すと、今度は pgTAP が落ちる。
// 両方が同じ値で通ることだけが、TS と SQL の一致の証拠になる。
// 固定辞書を使うので、実辞書（manifest と migration）に alias を足してもこのテストは落ちない。
const pgTapPath = "supabase/tests/database/ai_control_and_quota.test.sql";
const pgTapSource = readFileSync(pgTapPath, "utf8");

function markedBlock(name: string): string {
  const begin = `-- fingerprint-parity-${name}:begin`;
  const end = `-- fingerprint-parity-${name}:end`;
  const start = pgTapSource.indexOf(begin);
  const stop = pgTapSource.indexOf(end);
  if (start < 0 || stop < start || pgTapSource.indexOf(begin, start + 1) >= 0) {
    throw new Error(`${pgTapPath} に ${begin} 〜 ${end} がちょうど 1 組ない`);
  }
  return pgTapSource.slice(start + begin.length, stop);
}

function isAliasKind(value: string): value is AllergenAlias["aliasKind"] {
  return value === "direct" || value === "derived" || value === "processed";
}

// pgTAP の insert 文の values 行を読む。1 行でも形が崩れていれば、黙って落とさずに失敗させる。
function parseFixtureDictionary(): AllergenAlias[] {
  const tupleLines = markedBlock("dictionary")
    .split("\n")
    .filter((line) => /^\s*\(/.test(line));
  const pattern =
    /^\s*\('([^']+)', '([^']+)', '([^']+)', '([a-z]+)', (true|false), '([^']+)'\)[,;]$/;
  return tupleLines.map((line) => {
    const match = pattern.exec(line);
    if (!match) throw new Error(`固定辞書の行を読めない: ${line}`);
    const [, allergenId, alias, normalizedAlias, aliasKind, flag, version] = match;
    if (
      allergenId === undefined ||
      alias === undefined ||
      normalizedAlias === undefined ||
      aliasKind === undefined ||
      version === undefined ||
      !isAliasKind(aliasKind)
    ) {
      throw new Error(`固定辞書の行を読めない: ${line}`);
    }
    return {
      allergenId,
      alias,
      normalizedAlias,
      aliasKind,
      requiresLabelConfirmation: flag === "true",
      dictionaryVersion: version,
    };
  });
}

function parseExpected(): ReadonlyMap<string, string> {
  const entries = [...markedBlock("expected").matchAll(/\('([a-z_]+)', '([0-9a-f]{64})'\)/g)].map(
    (match): [string, string] => [match[1] ?? "", match[2] ?? ""],
  );
  return new Map(entries);
}

const fixtureAliases = parseFixtureDictionary();
const expected = parseExpected();

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
      aliases: fixtureAliases,
    },
  });
}

it("reads a small fixed dictionary covering kanji, hiragana and label-confirmation rows", () => {
  expect(fixtureAliases.length).toBeGreaterThanOrEqual(3);
  expect(fixtureAliases.every((row) => row.dictionaryVersion === dictionaryVersion)).toBe(true);
  expect(fixtureAliases.some((row) => /\p{Script=Han}/u.test(row.normalizedAlias))).toBe(true);
  expect(fixtureAliases.some((row) => /\p{Script=Hiragana}/u.test(row.normalizedAlias))).toBe(true);
  expect(
    fixtureAliases.some((row) => row.aliasKind === "processed" && row.requiresLabelConfirmation),
  ).toBe(true);
});

it("keeps every pinned SQL fingerprint hex inside the single expected block", () => {
  // 期待値を pgTAP の本文へ直書きし直すと、この一致テストの外に値の写しができるため禁止する。
  const outside = pgTapSource.replace(markedBlock("expected"), "");
  expect(outside.match(/'[0-9a-f]{64}'/g) ?? []).toEqual([]);
  expect([...expected.keys()].sort()).toEqual(["adult_then_child", "child_then_adult"]);
});

it("matches the pgTAP-pinned SQL current_safety_fingerprint for the shared fixture", () => {
  expect(createCurrentSafetyFingerprint(sqlFixtureContext([child, adult]))).toBe(
    expected.get("child_then_adult"),
  );
  expect(createCurrentSafetyFingerprint(sqlFixtureContext([adult, child]))).toBe(
    expected.get("adult_then_child"),
  );
});
