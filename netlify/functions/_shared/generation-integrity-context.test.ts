import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationCommand } from "../../../shared/contracts/generation.js";
import { HttpError } from "./http.js";

const fromMock = vi.fn();
const admin = { from: fromMock };

vi.mock("./supabase-admin.js", () => ({
  getSupabaseAdmin: vi.fn(() => admin),
}));

import {
  parseIntegrityContextPayload,
  resolveGenerationIntegrityContext,
} from "./generation-integrity-context.js";

const userId = "10000000-0000-4000-8000-000000000001";
const memberId = "20000000-0000-4000-8000-000000000001";
const draftId = "30000000-0000-4000-8000-000000000001";
const menuId = "40000000-0000-4000-8000-000000000001";
const dishId = "50000000-0000-4000-8000-000000000001";

const newMenuCommand: GenerationCommand = {
  commandVersion: "generation-command.v2",
  kind: "new_menu",
  request: {
    idempotencyKey: "60000000-0000-4000-8000-000000000001",
    draftId,
    draftRevision: 2,
    privacyNoticeVersion: "2026-07-11.v1",
    expiredPantryConfirmations: [],
  },
};

const regenerateCommand: GenerationCommand = {
  commandVersion: "generation-command.v2",
  kind: "regenerate_menu",
  request: {
    idempotencyKey: "60000000-0000-4000-8000-000000000002",
    sourceMenuId: menuId,
    changeReason: "simpler",
    changeReasonCustom: null,
    expiredPantryConfirmations: [],
  },
};

function chain(result: { data: unknown; error: null | { message: string } }) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  for (const method of ["select", "eq", "is", "maybeSingle"]) {
    builder[method] = vi.fn(method === "maybeSingle" ? () => Promise.resolve(result) : self);
  }
  // multi-row select for members uses thenable without maybeSingle
  builder.then = undefined;
  return builder;
}

describe("resolveGenerationIntegrityContext", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("resolves household new_menu from owner draft revision", async () => {
    fromMock.mockReturnValueOnce(
      chain({
        data: {
          target_mode: "household",
          servings: null,
          target_member_ids: [memberId],
        },
        error: null,
      }),
    );
    await expect(
      resolveGenerationIntegrityContext(admin as never, userId, newMenuCommand),
    ).resolves.toEqual({
      kind: "new_menu",
      targetMode: "household",
      servings: null,
      targetMemberIds: [memberId],
      sourceMenuVersion: null,
    });
  });

  it("resolves idea new_menu with servings and empty members", async () => {
    fromMock.mockReturnValueOnce(
      chain({
        data: {
          target_mode: "idea",
          servings: 3,
          target_member_ids: [],
        },
        error: null,
      }),
    );
    await expect(
      resolveGenerationIntegrityContext(admin as never, userId, newMenuCommand),
    ).resolves.toEqual({
      kind: "new_menu",
      targetMode: "idea",
      servings: 3,
      targetMemberIds: [],
      sourceMenuVersion: null,
    });
  });

  it("rejects household draft with empty members", async () => {
    fromMock.mockReturnValueOnce(
      chain({
        data: { target_mode: "household", servings: null, target_member_ids: [] },
        error: null,
      }),
    );
    await expect(
      resolveGenerationIntegrityContext(admin as never, userId, newMenuCommand),
    ).rejects.toBeInstanceOf(HttpError);
  });

  // Task 8 Step 2: mode 矛盾 4 系統を integrity resolve で区別して拒否する
  it("rejects idea draft with non-empty member IDs", async () => {
    fromMock.mockReturnValueOnce(
      chain({
        data: {
          target_mode: "idea",
          servings: 2,
          target_member_ids: [memberId],
        },
        error: null,
      }),
    );
    await expect(
      resolveGenerationIntegrityContext(admin as never, userId, newMenuCommand),
    ).rejects.toMatchObject({ code: "invalid_request", status: 422 });
  });

  it("rejects idea draft with null servings", async () => {
    fromMock.mockReturnValueOnce(
      chain({
        data: { target_mode: "idea", servings: null, target_member_ids: [] },
        error: null,
      }),
    );
    await expect(
      resolveGenerationIntegrityContext(admin as never, userId, newMenuCommand),
    ).rejects.toMatchObject({ code: "invalid_request", status: 422 });
  });

  it("rejects household draft with non-null direct servings", async () => {
    fromMock.mockReturnValueOnce(
      chain({
        data: {
          target_mode: "household",
          servings: 3,
          target_member_ids: [memberId],
        },
        error: null,
      }),
    );
    await expect(
      resolveGenerationIntegrityContext(admin as never, userId, newMenuCommand),
    ).rejects.toMatchObject({ code: "invalid_request", status: 422 });
  });

  it("resolves regeneration from source menu version and members", async () => {
    fromMock
      .mockReturnValueOnce(
        chain({
          data: {
            id: menuId,
            target_mode: "household",
            servings: 4,
            version: 7,
          },
          error: null,
        }),
      )
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ household_member_id: memberId }],
              error: null,
            }),
          }),
        }),
      });
    await expect(
      resolveGenerationIntegrityContext(admin as never, userId, regenerateCommand),
    ).resolves.toEqual({
      kind: "regenerate_menu",
      targetMode: "household",
      servings: 4,
      targetMemberIds: [memberId],
      sourceMenuVersion: 7,
    });
  });

  it("maps missing source menu to source_menu_not_found", async () => {
    fromMock.mockReturnValueOnce(chain({ data: null, error: null }));
    await expect(
      resolveGenerationIntegrityContext(admin as never, userId, regenerateCommand),
    ).rejects.toMatchObject({ code: "source_menu_not_found" });
  });
});

describe("parseIntegrityContextPayload", () => {
  it("restores a household regeneration snapshot payload", () => {
    expect(
      parseIntegrityContextPayload({
        kind: "regenerate_dish",
        target_mode: "household",
        servings: 2,
        target_member_ids: [memberId],
        source_menu_version: 3,
      }),
    ).toEqual({
      kind: "regenerate_dish",
      targetMode: "household",
      servings: 2,
      targetMemberIds: [memberId],
      sourceMenuVersion: 3,
    });
  });

  it("rejects idea payload with members", () => {
    expect(() =>
      parseIntegrityContextPayload({
        kind: "new_menu",
        target_mode: "idea",
        servings: 2,
        target_member_ids: [memberId],
        source_menu_version: null,
      }),
    ).toThrow(HttpError);
  });

  // Task 8 Step 2: parse 境界でも 4 系統の mode 矛盾を区別して拒否する
  it.each([
    {
      label: "idea + null servings",
      payload: {
        kind: "new_menu" as const,
        target_mode: "idea" as const,
        servings: null,
        target_member_ids: [] as string[],
        source_menu_version: null,
      },
    },
    {
      label: "household + empty member IDs",
      payload: {
        kind: "new_menu" as const,
        target_mode: "household" as const,
        servings: null,
        target_member_ids: [] as string[],
        source_menu_version: null,
      },
    },
    {
      label: "household + non-null direct servings",
      payload: {
        kind: "new_menu" as const,
        target_mode: "household" as const,
        servings: 4,
        target_member_ids: [memberId],
        source_menu_version: null,
      },
    },
  ])("rejects $label", ({ payload }) => {
    expect(() => parseIntegrityContextPayload(payload)).toThrow(HttpError);
  });
});

void dishId;
