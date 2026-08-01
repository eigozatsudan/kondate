// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { makeValidatedMenu } from "../../../shared/testing/factories.js";
import { maybeEnqueueShareJob, type MaybeEnqueueShareJobInput } from "./share-enqueue.js";

function makeAdminRpc(rpcImpl?: ReturnType<typeof vi.fn>) {
  const rpc =
    rpcImpl ??
    vi.fn(() => Promise.resolve({ data: { enqueued: true, job_id: "job-1" }, error: null }));
  // テスト用 stub。本番は service_role AdminSupabaseClient を渡す。
  const admin = { rpc } as unknown as MaybeEnqueueShareJobInput["admin"];
  return { admin, rpc };
}

describe("maybeEnqueueShareJob", () => {
  it("does not call rpc when over 15 minutes", async () => {
    const { admin, rpc } = makeAdminRpc();
    await maybeEnqueueShareJob({
      menuId: "52000000-0000-4000-8000-000000000001",
      menu: makeValidatedMenu({ totalElapsedMinutes: 16 }),
      admin,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not call rpc when pantry-bound", async () => {
    const { admin, rpc } = makeAdminRpc();
    const base = makeValidatedMenu();
    const selectionId = "58000000-0000-4000-8000-000000000001";
    const dishes = base.dishes.map((dish, dishIndex) =>
      dishIndex === 0
        ? {
            ...dish,
            ingredients: dish.ingredients.map((ingredient, ingredientIndex) =>
              ingredientIndex === 0
                ? { ...ingredient, pantrySelectionId: selectionId }
                : ingredient,
            ),
          }
        : dish,
    );
    await maybeEnqueueShareJob({
      menuId: "52000000-0000-4000-8000-000000000001",
      menu: makeValidatedMenu({ dishes }),
      admin,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls try_enqueue_share_job once when eligible", async () => {
    const { admin, rpc } = makeAdminRpc();
    const menuId = "52000000-0000-4000-8000-000000000099";
    const menu = makeValidatedMenu({ totalElapsedMinutes: 15 });
    await maybeEnqueueShareJob({ menuId, menu, admin });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("try_enqueue_share_job", { p_menu_id: menuId });
  });

  it("swallows rpc errors", async () => {
    const { admin, rpc } = makeAdminRpc(
      vi.fn(() => Promise.reject(new Error("rpc transport failed"))),
    );
    await expect(
      maybeEnqueueShareJob({
        menuId: "52000000-0000-4000-8000-000000000001",
        menu: makeValidatedMenu(),
        admin,
      }),
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("swallows rpc error field without throwing", async () => {
    const { admin, rpc } = makeAdminRpc(
      vi.fn(() =>
        Promise.resolve({
          data: null,
          error: { message: "permission denied", code: "42501" },
        }),
      ),
    );
    await expect(
      maybeEnqueueShareJob({
        menuId: "52000000-0000-4000-8000-000000000001",
        menu: makeValidatedMenu(),
        admin,
      }),
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("module does not import share-generalize-pipeline or openrouter share helpers", async () => {
    const source = await readFile(new URL("./share-enqueue.ts", import.meta.url), "utf8");
    // 静的 import / 動的 import の禁止（コメント内の文言は対象外）
    const importSpecifiers = [
      ...source.matchAll(/from\s+["']([^"']+)["']/gu),
      ...source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/gu),
    ].map((match) => match[1]!);
    expect(importSpecifiers.some((s) => s.includes("share-generalize-pipeline"))).toBe(false);
    expect(importSpecifiers.some((s) => /openrouter/i.test(s))).toBe(false);
    expect(source).not.toMatch(/sendMenuGeneration|createOpenRouter/);
    // 依存は eligibility + admin.rpc のみ（Pass pipeline 禁止）
    expect(source).toMatch(/evaluateShareEligibility/);
    expect(source).toMatch(/try_enqueue_share_job/);
  });
});
