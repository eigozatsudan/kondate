import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "./_shared/http.js";
import type { ShoppingDependencies } from "./_shared/shopping-adapter.js";

// 設計書 Task4 Step1: revalidate handler は body を取らず、path param の listId と
// 認証ユーザーだけで service を呼ぶ。内部 RPC の生の形（source 行や member UUID）が
// 応答に出ないこと、失敗が HTTP success に包まれないことをここで固定する。
const requireUserMock = vi.hoisted(() => vi.fn());
const revalidateActiveShoppingListMock = vi.hoisted(() => vi.fn());

vi.mock("./_shared/auth.js", () => ({ requireUser: requireUserMock }));
vi.mock("./_shared/shopping-service.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./_shared/shopping-service.js")>();
  return { ...original, revalidateActiveShoppingList: revalidateActiveShoppingListMock };
});

const { createShoppingListRevalidateHandler } = await import("./shopping-list-revalidate.js");

const USER_ID = "85000000-0000-4000-8000-000000000001";
const ACCESS_TOKEN = "token-abc";
const LIST_ID = "70000000-0000-4000-8000-000000000001";
const MENU_A = "52000000-0000-4000-8000-00000000000a";
const MENU_B = "52000000-0000-4000-8000-00000000000b";
const INGREDIENT_A = "53000000-0000-4000-8000-00000000000a";
const FINGERPRINT = "a".repeat(64);

function makeFactory(deps: Partial<ShoppingDependencies> = {}) {
  return vi.fn().mockReturnValue(deps);
}

function makeContext(listId: string) {
  return { params: { listId } } as unknown as Parameters<
    ReturnType<typeof createShoppingListRevalidateHandler>
  >[1];
}

function makeRequest(): Request {
  return new Request(`http://127.0.0.1/api/shopping-lists/${LIST_ID}/revalidate`, {
    method: "POST",
    headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
  });
}

const validResult = {
  status: "valid" as const,
  safetyFingerprint: FINGERPRINT,
  checkedSourceMenuIds: [MENU_A, MENU_B],
  currentLabelWarnings: [
    {
      itemId: null,
      warningKey: "b".repeat(64),
      sourceMenuId: MENU_B,
      sourceDerivationGroupId: "c1000000-0000-4000-8000-00000000000b",
      sourceType: "ingredient" as const,
      sourceId: INGREDIENT_A,
      sourcePath: "dishes.0.ingredients.0.name",
      sourceDisplayName: "カレールー",
      allergenId: "wheat",
      allergenDisplayName: "小麦",
      anonymousMemberRef: "member_1",
      memberDisplayName: "子ども",
      dictionaryVersion: "jp-caa-2026-04.v1",
    },
  ],
  issues: [],
};

describe("createShoppingListRevalidateHandler", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    revalidateActiveShoppingListMock.mockReset();
    requireUserMock.mockResolvedValue({ userId: USER_ID, accessToken: ACCESS_TOKEN });
  });

  it("returns 405 with Allow: POST for non-POST methods without invoking auth or the factory", async () => {
    const factory = makeFactory();
    const handler = createShoppingListRevalidateHandler(factory);
    const response = await handler(
      new Request(`http://127.0.0.1/api/shopping-lists/${LIST_ID}/revalidate`, { method: "GET" }),
      makeContext(LIST_ID),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(factory).not.toHaveBeenCalled();
    expect(requireUserMock).not.toHaveBeenCalled();
  });

  it("returns auth_required when the request is unauthenticated", async () => {
    requireUserMock.mockRejectedValue(new HttpError(401, "auth_required", "ログインが必要です"));
    const factory = makeFactory();
    const handler = createShoppingListRevalidateHandler(factory);
    const response = await handler(makeRequest(), makeContext(LIST_ID));
    expect(response.status).toBe(401);
    expect(factory).not.toHaveBeenCalled();
  });

  it("rejects a path list id that is not a UUID", async () => {
    const handler = createShoppingListRevalidateHandler(makeFactory());
    const response = await handler(makeRequest(), makeContext("../../etc"));
    expect(response.status).toBe(400);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ ok: false, error: { code: "invalid_list_id" } });
    expect(revalidateActiveShoppingListMock).not.toHaveBeenCalled();
  });

  it("wraps the public safety result with sorted unique checked source menu ids", async () => {
    revalidateActiveShoppingListMock.mockResolvedValue(validResult);
    const factory = makeFactory();
    const handler = createShoppingListRevalidateHandler(factory);
    const response = await handler(makeRequest(), makeContext(LIST_ID));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, data: validResult });
    expect(factory).toHaveBeenCalledWith({ userId: USER_ID, accessToken: ACCESS_TOKEN });
    expect(revalidateActiveShoppingListMock).toHaveBeenCalledWith(expect.anything(), {
      userId: USER_ID,
      listId: LIST_ID,
    });
  });

  it("wraps an unverifiable result without a fingerprint or current warnings", async () => {
    revalidateActiveShoppingListMock.mockResolvedValue({
      status: "unverifiable",
      safetyFingerprint: null,
      checkedSourceMenuIds: [],
      currentLabelWarnings: [],
      issues: [
        {
          code: "source_menu_unavailable",
          message: "献立が見つからないため確認できません",
          sourceMenuId: null,
        },
      ],
    });
    const handler = createShoppingListRevalidateHandler(makeFactory());
    const response = await handler(makeRequest(), makeContext(LIST_ID));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      data: { safetyFingerprint: null; currentLabelWarnings: unknown[] };
    };
    expect(body.data.safetyFingerprint).toBeNull();
    expect(body.data.currentLabelWarnings).toEqual([]);
  });

  it("never wraps a failed internal safety refresh as an HTTP success", async () => {
    revalidateActiveShoppingListMock.mockRejectedValue(
      new HttpError(503, "safety_check_failed", "現在の家族設定を確認できませんでした"),
    );
    const handler = createShoppingListRevalidateHandler(makeFactory());
    const response = await handler(makeRequest(), makeContext(LIST_ID));
    expect(response.status).toBe(503);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ ok: false, error: { code: "safety_check_failed" } });
  });
});
