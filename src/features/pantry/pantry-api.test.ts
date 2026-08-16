import { afterEach, describe, expect, it, vi } from "vitest";
import type { PantryItemInput } from "@shared/contracts/pantry";
import {
  createPantryItem,
  deletePantryItem,
  PantryVersionConflictError,
  updatePantryItem,
} from "./pantry-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

const userId = "61000000-0000-4000-8000-000000000001";
const itemId = "60000000-0000-4000-8000-000000000001";
const expectedUpdatedAt = "2026-07-09T00:00:00.000Z";
const updatedAt = "2026-07-09T01:00:00.000Z";
const input: PantryItemInput = {
  name: "牛乳",
  quantity: 400,
  unit: "ml",
  expiresOn: "2026-07-10",
  expirationType: "use_by",
  openedState: "opened",
};

function pantryRow() {
  return {
    id: itemId,
    user_id: userId,
    name: input.name,
    quantity: input.quantity,
    unit: input.unit,
    expires_on: input.expiresOn,
    expiration_type: input.expirationType,
    opened_state: input.openedState,
    created_at: "2026-07-09T00:00:00.000Z",
    updated_at: updatedAt,
  };
}

function mutationClient(data: unknown) {
  const chain = {
    update: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn(),
  };
  chain.update.mockReturnValue(chain);
  chain.delete.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.maybeSingle.mockResolvedValue({ data, error: null });
  const from = vi.fn().mockReturnValue(chain);
  return {
    client: { from } as never,
    chain,
    from,
  };
}

describe("pantry create single-flight (PE14)", () => {
  it("rejects concurrent create while first insert is in flight", async () => {
    let resolveInsert: ((value: { data: unknown; error: null }) => void) | undefined;
    const insertPromise = new Promise<{ data: unknown; error: null }>((resolve) => {
      resolveInsert = resolve;
    });
    const chain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnValue(insertPromise),
    };
    const client = { from: vi.fn().mockReturnValue(chain) } as never;

    const first = createPantryItem(client, userId, input);
    // 第一が完了する前の第二は insert せず失敗（二重行を作らない）
    await expect(createPantryItem(client, userId, input)).rejects.toThrow(
      "食材を追加できませんでした",
    );
    resolveInsert?.({ data: pantryRow(), error: null });
    await expect(first).resolves.toMatchObject({ id: itemId, name: input.name });
    expect(chain.insert).toHaveBeenCalledTimes(1);
  });

  it("PE9: serializes create through navigator.locks when available", async () => {
    const request = vi.fn(async (_name: string, run: () => Promise<unknown>) => run());
    vi.stubGlobal("navigator", { locks: { request } });
    const chain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: pantryRow(),
        error: null,
      }),
    };
    const client = { from: vi.fn().mockReturnValue(chain) } as never;
    await createPantryItem(client, userId, input);
    expect(request).toHaveBeenCalledWith("kondate:pantry-create", expect.any(Function));
    expect(chain.insert).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("PE8: normalizes unit synonyms on write (グラム → g)", async () => {
    const chain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { ...pantryRow(), unit: "g" },
        error: null,
      }),
    };
    const client = { from: vi.fn().mockReturnValue(chain) } as never;
    await createPantryItem(client, userId, { ...input, unit: "グラム" });
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ unit: "g", name: input.name }),
    );
  });
});

describe("pantry optimistic concurrency", () => {
  it("updates with owner, id, and displayed version and returns the written row", async () => {
    const { client, chain, from } = mutationClient(pantryRow());

    await expect(
      updatePantryItem(client, userId, itemId, expectedUpdatedAt, input),
    ).resolves.toMatchObject({ id: itemId, updatedAt });

    expect(from).toHaveBeenCalledWith("pantry_items");
    expect(chain.update).toHaveBeenCalledWith({
      user_id: userId,
      name: input.name,
      quantity: input.quantity,
      unit: input.unit,
      expires_on: input.expiresOn,
      expiration_type: input.expirationType,
      opened_state: input.openedState,
    });
    expect(chain.delete).not.toHaveBeenCalled();
    expect(chain.eq.mock.calls).toEqual([
      ["id", itemId],
      ["user_id", userId],
      ["updated_at", expectedUpdatedAt],
    ]);
    expect(chain.select).toHaveBeenCalledWith("*");
  });

  it("deletes with owner, id, and displayed version and returns the deleted id", async () => {
    const { client, chain, from } = mutationClient({ id: itemId });

    await expect(deletePantryItem(client, userId, itemId, expectedUpdatedAt)).resolves.toEqual({
      id: itemId,
    });

    expect(from).toHaveBeenCalledWith("pantry_items");
    expect(chain.delete).toHaveBeenCalledOnce();
    expect(chain.update).not.toHaveBeenCalled();
    expect(chain.eq.mock.calls).toEqual([
      ["id", itemId],
      ["user_id", userId],
      ["updated_at", expectedUpdatedAt],
    ]);
    expect(chain.select).toHaveBeenCalledWith("id");
  });

  it.each(["update", "delete"])(
    "maps a successful zero-row %s to pantry_version_conflict",
    async (operation) => {
      const { client } = mutationClient(null);
      const promise =
        operation === "update"
          ? updatePantryItem(client, userId, itemId, expectedUpdatedAt, input)
          : deletePantryItem(client, userId, itemId, expectedUpdatedAt);

      await expect(promise).rejects.toMatchObject({
        name: "PantryVersionConflictError",
        code: "pantry_version_conflict",
      });
      await expect(promise).rejects.toBeInstanceOf(PantryVersionConflictError);
    },
  );
});
