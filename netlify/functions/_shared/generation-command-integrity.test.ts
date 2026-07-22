import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  generationCommandSchema,
  type GenerationCommand,
  type GenerationIntegrityContextV2,
} from "../../../shared/contracts/generation.js";
import {
  canonicalizeGenerationCommandV2,
  generationRequestHmac,
} from "./generation-command-integrity.js";

const key = Buffer.alloc(32, 7);
const checks = [
  { pantryItemId: "30000000-0000-4000-8000-000000000002", checkedAt: "2026-07-11T09:01:00+09:00" },
  { pantryItemId: "30000000-0000-4000-8000-000000000001", checkedAt: "2026-07-11T09:00:00+09:00" },
] as const;
const memberA = "60000000-0000-4000-8000-000000000002";
const memberB = "60000000-0000-4000-8000-000000000001";

const householdNewIntegrity: GenerationIntegrityContextV2 = {
  kind: "new_menu",
  targetMode: "household",
  servings: null,
  targetMemberIds: [memberA, memberB],
  sourceMenuVersion: null,
};

const ideaNewIntegrity: GenerationIntegrityContextV2 = {
  kind: "new_menu",
  targetMode: "idea",
  servings: 3,
  targetMemberIds: [],
  sourceMenuVersion: null,
};

const householdRegenIntegrity: GenerationIntegrityContextV2 = {
  kind: "regenerate_menu",
  targetMode: "household",
  servings: 4,
  targetMemberIds: [memberB, memberA],
  sourceMenuVersion: 2,
};

const dishIntegrity: GenerationIntegrityContextV2 = {
  kind: "regenerate_dish",
  targetMode: "idea",
  servings: 2,
  targetMemberIds: [],
  sourceMenuVersion: 5,
};

const commands: readonly {
  command: GenerationCommand;
  integrity: GenerationIntegrityContextV2;
}[] = [
  {
    command: {
      commandVersion: "generation-command.v2",
      kind: "new_menu",
      request: {
        idempotencyKey: "10000000-0000-4000-8000-000000000001",
        draftId: "20000000-0000-4000-8000-000000000001",
        draftRevision: 3,
        privacyNoticeVersion: "2026-07-11.v1",
        expiredPantryConfirmations: [...checks],
      },
    },
    integrity: householdNewIntegrity,
  },
  {
    command: {
      commandVersion: "generation-command.v2",
      kind: "regenerate_menu",
      request: {
        idempotencyKey: "10000000-0000-4000-8000-000000000002",
        sourceMenuId: "40000000-0000-4000-8000-000000000001",
        changeReason: "custom",
        changeReasonCustom: "野菜を増やす",
        expiredPantryConfirmations: [...checks],
      },
    },
    integrity: householdRegenIntegrity,
  },
  {
    command: {
      commandVersion: "generation-command.v2",
      kind: "regenerate_dish",
      request: {
        idempotencyKey: "10000000-0000-4000-8000-000000000003",
        sourceMenuId: "40000000-0000-4000-8000-000000000001",
        dishId: "50000000-0000-4000-8000-000000000001",
        changeReason: "simpler",
        changeReasonCustom: null,
        expiredPantryConfirmations: [...checks],
      },
    },
    integrity: dishIntegrity,
  },
];

describe("generation command integrity v2", () => {
  it.each(commands)(
    "is deterministic for $command.kind and sorts set-like fields",
    ({ command, integrity }) => {
      const reversed = generationCommandSchema.parse({
        ...command,
        request: {
          ...command.request,
          expiredPantryConfirmations: command.request.expiredPantryConfirmations.toReversed(),
        },
      });
      const reversedMembers: GenerationIntegrityContextV2 =
        integrity.targetMode === "household"
          ? {
              ...integrity,
              targetMemberIds: [...integrity.targetMemberIds].toReversed() as [string, ...string[]],
            }
          : integrity;
      expect(canonicalizeGenerationCommandV2(reversed, reversedMembers)).toBe(
        canonicalizeGenerationCommandV2(command, integrity),
      );
      expect(generationRequestHmac(reversed, reversedMembers, key)).toBe(
        generationRequestHmac(command, integrity, key),
      );
      expect(generationRequestHmac(command, integrity, key)).toMatch(/^[a-f0-9]{64}$/u);
    },
  );

  it("serializes every field in fixed key order with nulls for absent kind fields", () => {
    const sorted = [...checks].toSorted(
      (left, right) =>
        left.pantryItemId.localeCompare(right.pantryItemId) ||
        left.checkedAt.localeCompare(right.checkedAt),
    );
    const sortedMembers = [memberB, memberA].toSorted((a, b) => a.localeCompare(b));
    expect(
      commands.map(
        ({ command, integrity }) =>
          JSON.parse(canonicalizeGenerationCommandV2(command, integrity)) as unknown,
      ),
    ).toEqual([
      {
        version: "generation-command.v2",
        kind: "new_menu",
        idempotencyKey: "10000000-0000-4000-8000-000000000001",
        draftId: "20000000-0000-4000-8000-000000000001",
        draftRevision: 3,
        sourceMenuId: null,
        dishId: null,
        changeReason: null,
        changeReasonCustom: null,
        privacyNoticeVersion: "2026-07-11.v1",
        expiredPantryConfirmations: sorted,
        targetMode: "household",
        servings: null,
        targetMemberIds: sortedMembers,
        sourceMenuVersion: null,
      },
      {
        version: "generation-command.v2",
        kind: "regenerate_menu",
        idempotencyKey: "10000000-0000-4000-8000-000000000002",
        draftId: null,
        draftRevision: null,
        sourceMenuId: "40000000-0000-4000-8000-000000000001",
        dishId: null,
        changeReason: "custom",
        changeReasonCustom: "野菜を増やす",
        privacyNoticeVersion: null,
        expiredPantryConfirmations: sorted,
        targetMode: "household",
        servings: 4,
        targetMemberIds: sortedMembers,
        sourceMenuVersion: 2,
      },
      {
        version: "generation-command.v2",
        kind: "regenerate_dish",
        idempotencyKey: "10000000-0000-4000-8000-000000000003",
        draftId: null,
        draftRevision: null,
        sourceMenuId: "40000000-0000-4000-8000-000000000001",
        dishId: "50000000-0000-4000-8000-000000000001",
        changeReason: "simpler",
        changeReasonCustom: null,
        privacyNoticeVersion: null,
        expiredPantryConfirmations: sorted,
        targetMode: "idea",
        servings: 2,
        targetMemberIds: [],
        sourceMenuVersion: 5,
      },
    ]);
  });

  it("changes HMAC for mode, servings, members, source version, and command leaves", () => {
    const [newEntry, menuEntry, dishEntry] = commands;
    if (
      newEntry === undefined ||
      menuEntry === undefined ||
      dishEntry === undefined ||
      newEntry.command.kind !== "new_menu"
    ) {
      throw new Error("fixture mismatch");
    }
    const base = generationRequestHmac(newEntry.command, newEntry.integrity, key);
    expect(generationRequestHmac(newEntry.command, ideaNewIntegrity, key)).not.toBe(base);
    expect(
      generationRequestHmac(
        newEntry.command,
        {
          kind: "new_menu",
          targetMode: "household",
          servings: null,
          targetMemberIds: [memberB],
          sourceMenuVersion: null,
        },
        key,
      ),
    ).not.toBe(base);
    expect(
      generationRequestHmac(
        menuEntry.command,
        { ...householdRegenIntegrity, sourceMenuVersion: 9 },
        key,
      ),
    ).not.toBe(generationRequestHmac(menuEntry.command, menuEntry.integrity, key));
    expect(
      generationRequestHmac(
        generationCommandSchema.parse({
          ...newEntry.command,
          request: { ...newEntry.command.request, draftRevision: 4 },
        }),
        newEntry.integrity,
        key,
      ),
    ).not.toBe(base);
    expect(
      generationRequestHmac(menuEntry.command, menuEntry.integrity, Buffer.alloc(32, 8)),
    ).not.toBe(generationRequestHmac(menuEntry.command, menuEntry.integrity, key));
    expect(generationRequestHmac(dishEntry.command, dishEntry.integrity, key)).toMatch(
      /^[a-f0-9]{64}$/u,
    );
  });

  it("rejects unsupported commandVersion on the wire schema without retaining v1 readers", () => {
    expect(
      generationCommandSchema.safeParse({
        commandVersion: "unsupported-command-version",
        kind: "new_menu",
        request: {
          idempotencyKey: "10000000-0000-4000-8000-000000000001",
          draftId: "20000000-0000-4000-8000-000000000001",
          draftRevision: 1,
          privacyNoticeVersion: "2026-07-11.v1",
          expiredPantryConfirmations: [],
        },
      }).success,
    ).toBe(false);
    expect(
      generationCommandSchema.safeParse({
        kind: "new_menu",
        request: {
          idempotencyKey: "10000000-0000-4000-8000-000000000001",
          draftId: "20000000-0000-4000-8000-000000000001",
          draftRevision: 1,
          privacyNoticeVersion: "2026-07-11.v1",
          expiredPantryConfirmations: [],
        },
      }).success,
    ).toBe(false);
  });
});
