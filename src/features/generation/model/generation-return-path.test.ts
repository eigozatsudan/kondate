import { describe, expect, it } from "vitest";
import type { GenerationCommand } from "@shared/contracts/generation";
import { createPendingGeneration } from "./pending-generation";
import { generationReturnPath } from "./generation-return-path";

const USER_ID = "40000000-0000-4000-8000-000000000001";
const SOURCE_MENU_ID = "60000000-0000-4000-8000-000000000001";
const DISH_ID = "70000000-0000-4000-8000-000000000001";

function newMenuCommand(): GenerationCommand {
  return {
    commandVersion: "generation-command.v2",
    kind: "new_menu",
    request: {
      idempotencyKey: "10000000-0000-4000-8000-000000000001",
      draftId: "20000000-0000-4000-8000-000000000001",
      draftRevision: 1,
      privacyNoticeVersion: "2026-07-28.v1",
      expiredPantryConfirmations: [],
    },
  };
}

function regenerateMenuCommand(): GenerationCommand {
  return {
    commandVersion: "generation-command.v2",
    kind: "regenerate_menu",
    request: {
      idempotencyKey: "10000000-0000-4000-8000-000000000002",
      sourceMenuId: SOURCE_MENU_ID,
      changeReason: "different_flavor",
      changeReasonCustom: null,
      privacyNoticeVersion: "2026-07-28.v1",
      expiredPantryConfirmations: [],
    },
  };
}

function regenerateDishCommand(): GenerationCommand {
  return {
    commandVersion: "generation-command.v2",
    kind: "regenerate_dish",
    request: {
      idempotencyKey: "10000000-0000-4000-8000-000000000003",
      sourceMenuId: SOURCE_MENU_ID,
      dishId: DISH_ID,
      changeReason: "different_flavor",
      changeReasonCustom: null,
      privacyNoticeVersion: "2026-07-28.v1",
      expiredPantryConfirmations: [],
    },
  };
}

describe("generationReturnPath", () => {
  it("returns /planner when there is no pending generation", () => {
    expect(generationReturnPath(null)).toBe("/planner");
  });

  it("returns /planner for new_menu pending", () => {
    const pending = createPendingGeneration(newMenuCommand(), USER_ID, () => new Date());
    expect(generationReturnPath(pending)).toBe("/planner");
  });

  it("returns the source menus path for regenerate_menu", () => {
    const pending = createPendingGeneration(regenerateMenuCommand(), USER_ID, () => new Date());
    expect(generationReturnPath(pending)).toBe(`/menus/${SOURCE_MENU_ID}`);
  });

  it("returns the source menus path for regenerate_dish", () => {
    const pending = createPendingGeneration(regenerateDishCommand(), USER_ID, () => new Date());
    expect(generationReturnPath(pending)).toBe(`/menus/${SOURCE_MENU_ID}`);
  });
});
