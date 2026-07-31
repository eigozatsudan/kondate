import { expect, it } from "vitest";
import {
  createCurrentSafetyFingerprint,
  createFinalizeSafetyFingerprint,
  withSqlOrdinalAnonymousRefs,
} from "./fingerprint.js";
import { makeCurrentSafetyContext } from "../testing/factories.js";

it("sorts arrays and members and changes when current safety changes", () => {
  const member = { ...makeCurrentSafetyContext().members[0]!, allergenIds: ["wheat", "egg"] };
  const second = {
    ...member,
    householdMemberId: "55000000-0000-4000-8000-000000000002",
    anonymousRef: "member_2",
  };
  const first = makeCurrentSafetyContext({ members: [member, second] });
  const reordered = makeCurrentSafetyContext({
    members: [
      { ...second, allergenIds: ["egg", "wheat"] },
      { ...member, allergenIds: ["egg", "wheat"] },
    ],
  });
  const changed = makeCurrentSafetyContext({
    members: [{ ...member, ageBand: "age_3_5" }, second],
  });
  expect(createCurrentSafetyFingerprint(first)).toBe(createCurrentSafetyFingerprint(reordered));
  expect(createCurrentSafetyFingerprint(first)).not.toBe(createCurrentSafetyFingerprint(changed));
});

it("HIST-1: finalize fingerprint renumbers historical refs to SQL ordinality", () => {
  const base = makeCurrentSafetyContext().members[0]!;
  const survivorOnly = makeCurrentSafetyContext({
    members: [
      {
        ...base,
        householdMemberId: "55000000-0000-4000-8000-000000000002",
        // 履歴上 member_2 だった生存メンバーだけ
        anonymousRef: "member_2",
      },
    ],
  });
  const renumbered = withSqlOrdinalAnonymousRefs(survivorOnly, [
    "55000000-0000-4000-8000-000000000002",
  ]);
  expect(renumbered.members[0]?.anonymousRef).toBe("member_1");
  const historicalFp = createCurrentSafetyFingerprint(survivorOnly);
  const finalizeFp = createFinalizeSafetyFingerprint(survivorOnly, [
    "55000000-0000-4000-8000-000000000002",
  ]);
  expect(finalizeFp).not.toBe(historicalFp);
  expect(finalizeFp).toBe(createCurrentSafetyFingerprint(renumbered));
});

it("changes when custom allergy text changes while hasUnmapped stays true (F-SAF-002)", () => {
  const base = makeCurrentSafetyContext().members[0]!;
  const withShrimp = makeCurrentSafetyContext({
    members: [
      {
        ...base,
        hasUnmappedCustomAllergy: true,
        customAllergies: [{ name: "えび粉", aliases: [] }],
      },
    ],
  });
  const withEgg = makeCurrentSafetyContext({
    members: [
      {
        ...base,
        hasUnmappedCustomAllergy: true,
        customAllergies: [{ name: "卵", aliases: [] }],
      },
    ],
  });
  expect(createCurrentSafetyFingerprint(withShrimp)).not.toBe(
    createCurrentSafetyFingerprint(withEgg),
  );
});
