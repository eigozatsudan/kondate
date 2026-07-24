import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../_shared/http.js";
import type { ShoppingDependencies } from "../_shared/shopping-adapter.js";

// 設計書 Task3 Step1: handler は createShoppingListFromMenuHandler を dependency factory
// 注入でテストする。module mock は auth/service 境界のみに使い、createDeps という
// 未定義 helper には依存しない（設計書文言の禁止事項）。
const requireUserMock = vi.hoisted(() => vi.fn());
const createShoppingListFromMenuMock = vi.hoisted(() => vi.fn());

vi.mock("../_shared/auth.js", () => ({ requireUser: requireUserMock }));
vi.mock("../_shared/shopping-service.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../_shared/shopping-service.js")>();
  return {
    ...original,
    createShoppingListFromMenu: createShoppingListFromMenuMock,
  };
});

const { createShoppingListFromMenuHandler } = await import("../shopping-list-from-menu.js");

const USER_ID = "85000000-0000-4000-8000-000000000001";
const ACCESS_TOKEN = "token-abc";
const MENU_ID = "52000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "90000000-0000-4000-8000-000000000001";

function makeFactory(deps: Partial<ShoppingDependencies> = {}) {
  return vi.fn().mockReturnValue(deps);
}

function makeRequest(body: unknown): Request {
  return new Request("http://127.0.0.1/api/shopping-lists/from-menu", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ACCESS_TOKEN}` },
    body: JSON.stringify(body),
  });
}

const validBody = {
  menuId: MENU_ID,
  mode: "new" as const,
  activeListId: null,
  expectedListVersion: null,
  idempotencyKey: IDEMPOTENCY_KEY,
};

describe("createShoppingListFromMenuHandler", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    createShoppingListFromMenuMock.mockReset();
    requireUserMock.mockResolvedValue({ userId: USER_ID, accessToken: ACCESS_TOKEN });
  });

  it("returns 405 with Allow: POST for non-POST methods without invoking auth or the factory", async () => {
    const factory = makeFactory();
    const handler = createShoppingListFromMenuHandler(factory);
    const response = await handler(
      new Request("http://127.0.0.1/api/shopping-lists/from-menu", { method: "GET" }),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(factory).not.toHaveBeenCalled();
    expect(requireUserMock).not.toHaveBeenCalled();
  });

  it("returns auth_required when the request is unauthenticated", async () => {
    requireUserMock.mockRejectedValue(new HttpError(401, "auth_required", "ログインが必要です"));
    const factory = makeFactory();
    const handler = createShoppingListFromMenuHandler(factory);
    const response = await handler(makeRequest(validBody));
    expect(response.status).toBe(401);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ ok: false, error: { code: "auth_required" } });
    expect(factory).not.toHaveBeenCalled();
  });

  it("returns invalid_json for malformed JSON bodies", async () => {
    const factory = makeFactory();
    const handler = createShoppingListFromMenuHandler(factory);
    const response = await handler(
      new Request("http://127.0.0.1/api/shopping-lists/from-menu", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ACCESS_TOKEN}` },
        body: "{not-json",
      }),
    );
    expect(response.status).toBe(400);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ ok: false, error: { code: "invalid_json" } });
    expect(factory).not.toHaveBeenCalled();
  });

  it("invokes the injected dependency factory with the authenticated user and calls the service", async () => {
    createShoppingListFromMenuMock.mockResolvedValue({
      listId: "70000000-0000-4000-8000-000000000001",
      version: 1,
      replayed: false,
    });
    const factory = makeFactory();
    const handler = createShoppingListFromMenuHandler(factory);
    const response = await handler(makeRequest(validBody));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { listId: "70000000-0000-4000-8000-000000000001", version: 1, replayed: false },
    });
    expect(factory).toHaveBeenCalledWith({ userId: USER_ID, accessToken: ACCESS_TOKEN });
    expect(createShoppingListFromMenuMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ...validBody, userId: USER_ID }),
    );
  });

  it("maps a service HttpError to its status and code", async () => {
    createShoppingListFromMenuMock.mockRejectedValue(
      new HttpError(
        409,
        "safety_fingerprint_changed",
        "家族設定が変わったため、もう一度確認してください",
      ),
    );
    const factory = makeFactory();
    const handler = createShoppingListFromMenuHandler(factory);
    const response = await handler(makeRequest(validBody));
    expect(response.status).toBe(409);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ ok: false, error: { code: "safety_fingerprint_changed" } });
  });
});
