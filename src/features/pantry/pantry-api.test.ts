import { describe, expect, it, vi } from "vitest";
import type { PantryItemInput } from "@shared/contracts/pantry";
import { deletePantryItem, PantryVersionConflictError, updatePantryItem } from "./pantry-api";

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
  return {
    client: { from: vi.fn().mockReturnValue(chain) } as never,
    chain,
  };
}

describe("pantry optimistic concurrency", () => {
  it("updates with owner, id, and displayed version and returns the written row", async () => {
    const { client, chain } = mutationClient(pantryRow());

    await expect(
      updatePantryItem(client, userId, itemId, expectedUpdatedAt, input),
    ).resolves.toMatchObject({ id: itemId, updatedAt });

    expect(chain.eq.mock.calls).toEqual([
      ["id", itemId],
      ["user_id", userId],
      ["updated_at", expectedUpdatedAt],
    ]);
    expect(chain.select).toHaveBeenCalledWith("*");
  });

  it("deletes with owner, id, and displayed version and returns the deleted id", async () => {
    const { client, chain } = mutationClient({ id: itemId });

    await expect(deletePantryItem(client, userId, itemId, expectedUpdatedAt)).resolves.toEqual({
      id: itemId,
    });

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
