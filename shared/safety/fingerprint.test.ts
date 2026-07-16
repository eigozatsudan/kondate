import { expect, it } from "vitest";
import { createCurrentSafetyFingerprint } from "./fingerprint.js";
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
