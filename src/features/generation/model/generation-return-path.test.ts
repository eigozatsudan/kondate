import { describe, expect, it } from "vitest";
import type { GenerationCommand } from "@shared/contracts/generation";
import { createPendingGeneration } from "./pending-generation";
import { generationReturnPath } from "./generation-return-path";

const USER_ID = "40000000-0000-4000-8000-000000000001";
const SOURCE_MENU_ID = "60000000-0000-4000-8000-000000000001";
const DISH_ID = "70000000-0000-4000-8000-000000000001";

function newMenuCommand(): GenerationCommand {
  return {
    commandVersion: "generation-command.v3",
    kind: "new_menu",
    qualityMode: false,
    request: {
      idempotencyKey: "10000000-0000-4000-8000-000000000001",
      draftId: "20000000-0000-4000-8000-000000000001",
      draftRevision: 1,
      privacyNoticeVersion: "2026-07-29.v1",
      expiredPantryConfirmations: [],
    },
  };
}

function regenerateMenuCommand(): GenerationCommand {
  return {
    commandVersion: "generation-command.v3",
    kind: "regenerate_menu",
    qualityMode: false,
    request: {
      idempotencyKey: "10000000-0000-4000-8000-000000000002",
      sourceMenuId: SOURCE_MENU_ID,
      changeReason: "different_flavor",
      changeReasonCustom: null,
      privacyNoticeVersion: "2026-07-29.v1",
      expiredPantryConfirmations: [],
    },
  };
}

function regenerateDishCommand(): GenerationCommand {
  return {
    commandVersion: "generation-command.v3",
    kind: "regenerate_dish",
    qualityMode: false,
    request: {
      idempotencyKey: "10000000-0000-4000-8000-000000000003",
      sourceMenuId: SOURCE_MENU_ID,
      dishId: DISH_ID,
      changeReason: "different_flavor",
      changeReasonCustom: null,
      privacyNoticeVersion: "2026-07-29.v1",
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

  it("U4: appends resume=review for new_menu when resumeReview is requested", () => {
    const pending = createPendingGeneration(newMenuCommand(), USER_ID, () => new Date());
    expect(generationReturnPath(pending, { resumeReview: true })).toBe("/planner?resume=review");
  });

  it("U4: appends resume=review when there is no pending and resumeReview is requested", () => {
    expect(generationReturnPath(null, { resumeReview: true })).toBe("/planner?resume=review");
  });

  it("U4: ignores resumeReview for regenerate_menu (no such deep link on /menus/:id)", () => {
    const pending = createPendingGeneration(regenerateMenuCommand(), USER_ID, () => new Date());
    expect(generationReturnPath(pending, { resumeReview: true })).toBe(`/menus/${SOURCE_MENU_ID}`);
  });

  it("R2: returns the source history path for regenerate_menu opened from history", () => {
    const pending = createPendingGeneration(regenerateMenuCommand(), USER_ID, () => new Date());
    expect(generationReturnPath(pending, { returnSurface: "history" })).toBe(
      `/history/${SOURCE_MENU_ID}`,
    );
  });

  it("R2: returns the source history path for regenerate_dish opened from history", () => {
    const pending = createPendingGeneration(regenerateDishCommand(), USER_ID, () => new Date());
    expect(generationReturnPath(pending, { returnSurface: "history" })).toBe(
      `/history/${SOURCE_MENU_ID}`,
    );
  });

  it("R2: keeps the menus path when the entry surface is menus", () => {
    const pending = createPendingGeneration(regenerateMenuCommand(), USER_ID, () => new Date());
    expect(generationReturnPath(pending, { returnSurface: "menus" })).toBe(
      `/menus/${SOURCE_MENU_ID}`,
    );
  });

  it("R2: ignores the history surface for new_menu", () => {
    const pending = createPendingGeneration(newMenuCommand(), USER_ID, () => new Date());
    expect(generationReturnPath(pending, { returnSurface: "history" })).toBe("/planner");
  });
});
