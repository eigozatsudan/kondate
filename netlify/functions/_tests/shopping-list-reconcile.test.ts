import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../_shared/http.js";
import type { ShoppingDependencies } from "../_shared/shopping-adapter.js";

// 設計書 Task4 Step1: reconcile handler は承認キー/IDのみを受け取り、
// 解決済みの値は絶対にブラウザから来ない。ここでは path param 検証・JSON 検証・
// 405・factory 受け渡し・RPC 由来の各 409 防御の写像を固定する。
const requireUserMock = vi.hoisted(() => vi.fn());
const reconcileShoppingListMock = vi.hoisted(() => vi.fn());

vi.mock("../_shared/auth.js", () => ({ requireUser: requireUserMock }));
vi.mock("../_shared/shopping-service.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../_shared/shopping-service.js")>();
  return { ...original, reconcileShoppingList: reconcileShoppingListMock };
});

const { createShoppingListReconcileHandler } = await import("../shopping-list-reconcile.js");

const USER_ID = "85000000-0000-4000-8000-000000000001";
const ACCESS_TOKEN = "token-abc";
const LIST_ID = "70000000-0000-4000-8000-000000000001";
const MENU_ID = "52000000-0000-4000-8000-000000000001";
const ITEM_ID = "71000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "90000000-0000-4000-8000-000000000001";

function makeFactory(deps: Partial<ShoppingDependencies> = {}) {
  return vi.fn().mockReturnValue(deps);
}

function makeContext(listId: string) {
  return { params: { listId } } as unknown as Parameters<
    ReturnType<typeof createShoppingListReconcileHandler>
  >[1];
}

function makeRequest(body: unknown): Request {
  return new Request(`http://127.0.0.1/api/shopping-lists/${LIST_ID}/reconcile`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ACCESS_TOKEN}` },
    body: JSON.stringify(body),
  });
}

const validBody = {
  expectedListVersion: 3,
  sourceMenuId: MENU_ID,
  sourceMenuVersion: 1,
  idempotencyKey: IDEMPOTENCY_KEY,
  approval: { addKeys: ["curry-roux"], replaceItemIds: [ITEM_ID], removeItemIds: [] },
};

describe("createShoppingListReconcileHandler", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    reconcileShoppingListMock.mockReset();
    requireUserMock.mockResolvedValue({ userId: USER_ID, accessToken: ACCESS_TOKEN });
  });

  it("returns 405 with Allow: POST for non-POST methods without invoking auth or the factory", async () => {
    const factory = makeFactory();
    const handler = createShoppingListReconcileHandler(factory);
    const response = await handler(
      new Request(`http://127.0.0.1/api/shopping-lists/${LIST_ID}/reconcile`, { method: "GET" }),
      makeContext(LIST_ID),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(factory).not.toHaveBeenCalled();
    expect(requireUserMock).not.toHaveBeenCalled();
  });

  it("rejects a path list id that is not a UUID", async () => {
    const handler = createShoppingListReconcileHandler(makeFactory());
    const response = await handler(makeRequest(validBody), makeContext("70000000-list"));
    expect(response.status).toBe(400);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ ok: false, error: { code: "invalid_list_id" } });
    expect(reconcileShoppingListMock).not.toHaveBeenCalled();
  });

  it("returns invalid_json for malformed JSON bodies", async () => {
    const handler = createShoppingListReconcileHandler(makeFactory());
    const response = await handler(
      new Request(`http://127.0.0.1/api/shopping-lists/${LIST_ID}/reconcile`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ACCESS_TOKEN}` },
        body: "{not-json",
      }),
      makeContext(LIST_ID),
    );
    expect(response.status).toBe(400);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ ok: false, error: { code: "invalid_json" } });
  });

  it("rejects a body that carries resolved values instead of approval keys and ids", async () => {
    const handler = createShoppingListReconcileHandler(makeFactory());
    const response = await handler(
      makeRequest({ ...validBody, resolvedDiff: { add: [] } }),
      makeContext(LIST_ID),
    );
    expect(response.status).toBe(400);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(reconcileShoppingListMock).not.toHaveBeenCalled();
  });

  it("passes the path list id and the authenticated user to the service", async () => {
    reconcileShoppingListMock.mockResolvedValue({ listId: LIST_ID, version: 4, replayed: false });
    const factory = makeFactory();
    const handler = createShoppingListReconcileHandler(factory);
    const response = await handler(makeRequest(validBody), makeContext(LIST_ID));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { listId: LIST_ID, version: 4, replayed: false },
    });
    expect(factory).toHaveBeenCalledWith({ userId: USER_ID, accessToken: ACCESS_TOKEN });
    expect(reconcileShoppingListMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ...validBody, listId: LIST_ID, userId: USER_ID }),
    );
  });

  it.each([
    ["list_version_conflict", 409],
    ["source_menu_version_conflict", 409],
    ["safety_fingerprint_changed", 409],
    ["protected_item_conflict", 409],
  ])("maps the %s defense to status %i", async (code, status) => {
    reconcileShoppingListMock.mockRejectedValue(new HttpError(status, code, "やり直してください"));
    const handler = createShoppingListReconcileHandler(makeFactory());
    const response = await handler(makeRequest(validBody), makeContext(LIST_ID));
    expect(response.status).toBe(status);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ ok: false, error: { code } });
  });
});
