import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RevalidationResult } from "./_shared/revalidation-service.js";

const requireUserMock = vi.hoisted(() => vi.fn());
const createRevalidationDepsMock = vi.hoisted(() => vi.fn());
const revalidateStoredMenuMock = vi.hoisted(() => vi.fn());

vi.mock("./_shared/auth.js", () => ({
  requireUser: requireUserMock,
}));
vi.mock("./_shared/revalidation-adapter.js", () => ({
  createRevalidationDeps: createRevalidationDepsMock,
}));
vi.mock("./_shared/revalidation-service.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./_shared/revalidation-service.js")>();
  return {
    ...original,
    revalidateStoredMenu: revalidateStoredMenuMock,
  };
});

import handler, { config } from "./revalidate-menu.js";

const user = {
  userId: "85000000-0000-4000-8000-000000000001",
  accessToken: "token",
};
const menuId = "52000000-0000-4000-8000-000000000001";
const revalidationResult: RevalidationResult = {
  status: "valid",
  safetyFingerprint: "a".repeat(64),
  allergenCatalogVersion: "jp-caa-2026-04.v1",
  foodRuleVersion: "jp-caa-child-shape-2026-07.v1",
  issues: [],
  changedDetails: [],
  currentLabelWarnings: [],
};

describe("revalidate-menu", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    createRevalidationDepsMock.mockReset();
    revalidateStoredMenuMock.mockReset();
    requireUserMock.mockResolvedValue(user);
    createRevalidationDepsMock.mockReturnValue({ deps: true });
    revalidateStoredMenuMock.mockResolvedValue(revalidationResult);
  });

  it("exposes the locked revalidate path", () => {
    expect(config.path).toBe("/api/menus/:menuId/revalidate");
  });

  it("rejects non-POST methods", async () => {
    const response = await handler(new Request("http://127.0.0.1/api/menus/x/revalidate"), {
      params: { menuId },
    } as never);
    expect(response.status).toBe(405);
    expect(requireUserMock).not.toHaveBeenCalled();
  });

  it("requires authentication before loading a menu", async () => {
    requireUserMock.mockRejectedValue(
      Object.assign(new Error("auth"), { status: 401, code: "auth_required", name: "HttpError" }),
    );
    // HttpError 以外は 500 になるため、requireUser が HttpError 相当を投げる前提の実運用に合わせる
    const { HttpError } = await import("./_shared/http.js");
    requireUserMock.mockRejectedValue(new HttpError(401, "auth_required", "ログインが必要です"));
    const response = await handler(
      new Request("http://127.0.0.1/api/menus/x/revalidate", { method: "POST" }),
      { params: { menuId } } as never,
    );
    expect(response.status).toBe(401);
    expect(revalidateStoredMenuMock).not.toHaveBeenCalled();
  });

  it("rejects invalid menu ids without calling the service", async () => {
    const response = await handler(
      new Request("http://127.0.0.1/api/menus/not-a-uuid/revalidate", { method: "POST" }),
      { params: { menuId: "not-a-uuid" } } as never,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_menu_id" },
    });
    expect(revalidateStoredMenuMock).not.toHaveBeenCalled();
  });

  it("revalidates with authenticated user deps and returns the envelope", async () => {
    const response = await handler(
      new Request(`http://127.0.0.1/api/menus/${menuId}/revalidate`, { method: "POST" }),
      { params: { menuId } } as never,
    );
    expect(createRevalidationDepsMock).toHaveBeenCalledWith(user);
    expect(revalidateStoredMenuMock).toHaveBeenCalledWith(
      { deps: true },
      { userId: user.userId, menuId },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: revalidationResult,
    });
  });

  it("does not log or return free-form PII fields on failure", async () => {
    const { HttpError } = await import("./_shared/http.js");
    revalidateStoredMenuMock.mockRejectedValue(
      new HttpError(404, "menu_not_found", "献立が見つかりません"),
    );
    const response = await handler(
      new Request(`http://127.0.0.1/api/menus/${menuId}/revalidate`, { method: "POST" }),
      { params: { menuId } } as never,
    );
    expect(response.status).toBe(404);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ ok: false, error: { code: "menu_not_found" } });
    expect(JSON.stringify(body)).not.toMatch(/@|allergy|email/i);
  });
});
