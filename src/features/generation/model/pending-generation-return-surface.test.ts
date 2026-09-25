import { describe, expect, it } from "vitest";
import type { GenerationCommand } from "@shared/contracts/generation";
import { createPendingGeneration } from "./pending-generation";
import {
  pendingGenerationReturnSurfaceKey,
  readPendingGenerationReturnSurface,
  savePendingGenerationReturnSurface,
} from "./pending-generation-return-surface";

const USER_ID = "40000000-0000-4000-8000-000000000001";
const SOURCE_MENU_ID = "60000000-0000-4000-8000-000000000001";
const KEY_A = "10000000-0000-4000-8000-00000000000a";
const KEY_B = "10000000-0000-4000-8000-00000000000b";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => {
      map.clear();
    },
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    key: (index) => [...map.keys()][index] ?? null,
  };
}

function regenerateMenu(idempotencyKey: string) {
  const command: GenerationCommand = {
    commandVersion: "generation-command.v3",
    kind: "regenerate_menu",
    qualityMode: false,
    request: {
      idempotencyKey,
      sourceMenuId: SOURCE_MENU_ID,
      changeReason: "different_flavor",
      changeReasonCustom: null,
      privacyNoticeVersion: "2026-07-29.v1",
      expiredPantryConfirmations: [],
    },
  };
  return createPendingGeneration(command, USER_ID, () => new Date());
}

function newMenu(idempotencyKey: string) {
  const command: GenerationCommand = {
    commandVersion: "generation-command.v3",
    kind: "new_menu",
    qualityMode: false,
    request: {
      idempotencyKey,
      draftId: "20000000-0000-4000-8000-000000000001",
      draftRevision: 1,
      privacyNoticeVersion: "2026-07-29.v1",
      expiredPantryConfirmations: [],
    },
  };
  return createPendingGeneration(command, USER_ID, () => new Date());
}

describe("pending generation return surface", () => {
  it("reads history back for the same regenerate pending", () => {
    const storage = memoryStorage();
    savePendingGenerationReturnSurface(KEY_A, "history", storage);
    expect(readPendingGenerationReturnSurface(regenerateMenu(KEY_A), storage)).toBe("history");
  });

  it("falls back to menus when nothing was saved (existing pending without the record)", () => {
    const storage = memoryStorage();
    expect(readPendingGenerationReturnSurface(regenerateMenu(KEY_A), storage)).toBe("menus");
  });

  it("falls back to menus when the record belongs to another pending", () => {
    const storage = memoryStorage();
    savePendingGenerationReturnSurface(KEY_A, "history", storage);
    expect(readPendingGenerationReturnSurface(regenerateMenu(KEY_B), storage)).toBe("menus");
  });

  it("removes the record when the entry surface is menus", () => {
    const storage = memoryStorage();
    savePendingGenerationReturnSurface(KEY_A, "history", storage);
    savePendingGenerationReturnSurface(KEY_A, "menus", storage);
    expect(storage.getItem(pendingGenerationReturnSurfaceKey)).toBeNull();
    expect(readPendingGenerationReturnSurface(regenerateMenu(KEY_A), storage)).toBe("menus");
  });

  it("falls back to menus for broken JSON or an unknown shape", () => {
    const storage = memoryStorage();
    storage.setItem(pendingGenerationReturnSurfaceKey, "{not json");
    expect(readPendingGenerationReturnSurface(regenerateMenu(KEY_A), storage)).toBe("menus");
    storage.setItem(
      pendingGenerationReturnSurfaceKey,
      JSON.stringify({ idempotencyKey: KEY_A, surface: "https://evil.example" }),
    );
    expect(readPendingGenerationReturnSurface(regenerateMenu(KEY_A), storage)).toBe("menus");
  });

  it("returns menus for new_menu and for no pending", () => {
    const storage = memoryStorage();
    savePendingGenerationReturnSurface(KEY_A, "history", storage);
    expect(readPendingGenerationReturnSurface(newMenu(KEY_A), storage)).toBe("menus");
    expect(readPendingGenerationReturnSurface(null, storage)).toBe("menus");
  });

  it("does not throw when storage access fails", () => {
    const throwing: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => {
      savePendingGenerationReturnSurface(KEY_A, "history", throwing);
    }).not.toThrow();
    expect(readPendingGenerationReturnSurface(regenerateMenu(KEY_A), throwing)).toBe("menus");
  });
});
