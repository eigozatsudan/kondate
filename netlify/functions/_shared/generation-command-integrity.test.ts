import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  generationCommandSchema,
  type GenerationCommand,
} from "../../../shared/contracts/generation.js";
import {
  canonicalizeGenerationCommandV1,
  generationRequestHmac,
} from "./generation-command-integrity.js";

const key = Buffer.alloc(32, 7);
const checks = [
  { pantryItemId: "30000000-0000-4000-8000-000000000002", checkedAt: "2026-07-11T09:01:00+09:00" },
  { pantryItemId: "30000000-0000-4000-8000-000000000001", checkedAt: "2026-07-11T09:00:00+09:00" },
] as const;
const commands: readonly GenerationCommand[] = [
  {
    kind: "new_menu",
    request: {
      idempotencyKey: "10000000-0000-4000-8000-000000000001",
      draftId: "20000000-0000-4000-8000-000000000001",
      draftRevision: 3,
      privacyNoticeVersion: "2026-07-11.v1",
      expiredPantryConfirmations: [...checks],
    },
  },
  {
    kind: "regenerate_menu",
    request: {
      idempotencyKey: "10000000-0000-4000-8000-000000000002",
      sourceMenuId: "40000000-0000-4000-8000-000000000001",
      changeReason: "custom",
      changeReasonCustom: "野菜を増やす",
      expiredPantryConfirmations: [...checks],
    },
  },
  {
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
];

describe("generation command integrity", () => {
  it.each(commands)("is deterministic for $kind and sorts set-like checks", (command) => {
    const reversed = generationCommandSchema.parse({
      ...command,
      request: {
        ...command.request,
        expiredPantryConfirmations: command.request.expiredPantryConfirmations.toReversed(),
      },
    });
    expect(canonicalizeGenerationCommandV1(reversed)).toBe(
      canonicalizeGenerationCommandV1(command),
    );
    expect(generationRequestHmac(reversed, key)).toBe(generationRequestHmac(command, key));
    expect(generationRequestHmac(command, key)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("serializes every field of all three command variants", () => {
    const sorted = [...checks].toSorted(
      (left, right) =>
        left.pantryItemId.localeCompare(right.pantryItemId) ||
        left.checkedAt.localeCompare(right.checkedAt),
    );
    expect(
      commands.map((command) => JSON.parse(canonicalizeGenerationCommandV1(command)) as unknown),
    ).toEqual([
      {
        version: "generation-command.v1",
        kind: "new_menu",
        idempotencyKey: "10000000-0000-4000-8000-000000000001",
        draftId: "20000000-0000-4000-8000-000000000001",
        draftRevision: 3,
        privacyNoticeVersion: "2026-07-11.v1",
        expiredPantryConfirmations: sorted,
      },
      {
        version: "generation-command.v1",
        kind: "regenerate_menu",
        idempotencyKey: "10000000-0000-4000-8000-000000000002",
        sourceMenuId: "40000000-0000-4000-8000-000000000001",
        dishId: null,
        changeReason: "custom",
        changeReasonCustom: "野菜を増やす",
        expiredPantryConfirmations: sorted,
      },
      {
        version: "generation-command.v1",
        kind: "regenerate_dish",
        idempotencyKey: "10000000-0000-4000-8000-000000000003",
        sourceMenuId: "40000000-0000-4000-8000-000000000001",
        dishId: "50000000-0000-4000-8000-000000000001",
        changeReason: "simpler",
        changeReasonCustom: null,
        expiredPantryConfirmations: sorted,
      },
    ]);
  });

  it("changes for every mutable leaf and for the HMAC key", () => {
    const [newCommand, menuCommand, dishCommand] = commands;
    if (
      newCommand?.kind !== "new_menu" ||
      menuCommand?.kind !== "regenerate_menu" ||
      dishCommand?.kind !== "regenerate_dish"
    )
      throw new Error("fixture mismatch");
    const variants: readonly (readonly [GenerationCommand, GenerationCommand])[] = [
      [
        newCommand,
        generationCommandSchema.parse({
          ...newCommand,
          request: {
            ...newCommand.request,
            idempotencyKey: "10000000-0000-4000-8000-000000000009",
          },
        }),
      ],
      [
        newCommand,
        generationCommandSchema.parse({
          ...newCommand,
          request: {
            ...newCommand.request,
            draftId: "20000000-0000-4000-8000-000000000009",
          },
        }),
      ],
      [
        newCommand,
        generationCommandSchema.parse({
          ...newCommand,
          request: {
            ...newCommand.request,
            draftRevision: 4,
          },
        }),
      ],
      [
        newCommand,
        generationCommandSchema.parse({
          ...newCommand,
          request: {
            ...newCommand.request,
            expiredPantryConfirmations: [
              { ...checks[0], pantryItemId: "30000000-0000-4000-8000-000000000009" },
              checks[1],
            ],
          },
        }),
      ],
      [
        newCommand,
        generationCommandSchema.parse({
          ...newCommand,
          request: {
            ...newCommand.request,
            expiredPantryConfirmations: [
              { ...checks[0], checkedAt: "2026-07-11T09:02:00+09:00" },
              checks[1],
            ],
          },
        }),
      ],
      [
        menuCommand,
        generationCommandSchema.parse({
          ...menuCommand,
          request: {
            ...menuCommand.request,
            sourceMenuId: "40000000-0000-4000-8000-000000000009",
          },
        }),
      ],
      [
        menuCommand,
        generationCommandSchema.parse({
          ...menuCommand,
          request: {
            ...menuCommand.request,
            changeReason: "simpler",
            changeReasonCustom: null,
          },
        }),
      ],
      [
        menuCommand,
        generationCommandSchema.parse({
          ...menuCommand,
          request: {
            ...menuCommand.request,
            changeReasonCustom: "肉を増やす",
          },
        }),
      ],
      [
        dishCommand,
        generationCommandSchema.parse({
          ...dishCommand,
          request: {
            ...dishCommand.request,
            dishId: "50000000-0000-4000-8000-000000000009",
          },
        }),
      ],
    ];
    for (const [original, changed] of variants) {
      expect(generationRequestHmac(changed, key)).not.toBe(generationRequestHmac(original, key));
    }
    expect(generationRequestHmac(menuCommand, Buffer.alloc(32, 8))).not.toBe(
      generationRequestHmac(menuCommand, key),
    );
  });
});
