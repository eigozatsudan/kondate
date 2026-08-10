import { expect, it } from "vitest";
import {
  compareFingerprintText,
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

// H4/S6: localeCompare と code-point が分岐する日本語集合でも入力順によらず同一 digest
it("H4/S6: multi-custom JP allergies sort by code-point order independent of input order", () => {
  const base = makeCurrentSafetyContext().members[0]!;
  // localeCompare では「バナナ」<「りんご」・「アワビ」が「えび粉」前になり得るが code-point では下順
  const namesInCodePointOrder = ["あわび", "えび粉", "りんご", "アワビ", "バナナ", "卵"] as const;
  // ん (U+3093) < ア (U+30A2)。localeCompare では逆になり得る
  const aliasesInCodePointOrder = ["ん", "ア"] as const;
  expect([...namesInCodePointOrder].sort(compareFingerprintText)).toEqual([
    ...namesInCodePointOrder,
  ]);
  expect([...aliasesInCodePointOrder].sort(compareFingerprintText)).toEqual([
    ...aliasesInCodePointOrder,
  ]);
  // 実行環境の localeCompare が code-point と乖離することを観測（環境により一致し得るが乖離が本体）
  const localeNameOrder = [...namesInCodePointOrder].sort((a, b) => a.localeCompare(b));
  const localeAliasOrder = [...aliasesInCodePointOrder].sort((a, b) => a.localeCompare(b));
  expect(
    JSON.stringify(localeNameOrder) !== JSON.stringify(namesInCodePointOrder) ||
      JSON.stringify(localeAliasOrder) !== JSON.stringify(aliasesInCodePointOrder),
  ).toBe(true);

  const withCustoms = (customs: { name: string; aliases: string[] }[]) =>
    makeCurrentSafetyContext({
      members: [
        {
          ...base,
          hasUnmappedCustomAllergy: true,
          customAllergies: customs,
        },
      ],
    });

  const forward = withCustoms(
    namesInCodePointOrder.map((name, index) => ({
      name,
      aliases: index === 0 ? ["ん", "ア"] : [],
    })),
  );
  const reverse = withCustoms(
    [...namesInCodePointOrder].reverse().map((name) => ({
      name,
      aliases: name === namesInCodePointOrder[0] ? ["ア", "ん"] : [],
    })),
  );
  const shuffled = withCustoms([
    { name: "バナナ", aliases: [] },
    { name: "あわび", aliases: ["ア", "ん"] },
    { name: "卵", aliases: [] },
    { name: "りんご", aliases: [] },
    { name: "えび粉", aliases: [] },
    { name: "アワビ", aliases: [] },
  ]);

  const digest = createCurrentSafetyFingerprint(forward);
  expect(createCurrentSafetyFingerprint(reverse)).toBe(digest);
  expect(createCurrentSafetyFingerprint(shuffled)).toBe(digest);
  // factory 既定 member + 上記 multi-custom の固定 digest（SQL COLLATE "C" 同型の回帰錨）
  expect(digest).toBe("21ec091b88e20fb655c0186b65b8a149ea15837822c476b29088b8d3c86da4a3");
});
