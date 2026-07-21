import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "./_shared/http.js";
import type { ShoppingDependencies } from "./_shared/shopping-adapter.js";

// 設計書 Task4 Step1: preview handler も Task3 と同じく dependency factory 注入で
// テストし、module mock は auth/service 境界だけに使う。ここでの関心は
// 「path param の UUID 検証・JSON 検証・405・factory 受け渡し・HttpError 変換」と、
// 応答本文に人間向けラベル以外（sourcePath / 生アレルゲンID / member UUID）が
// 出ないことの二点。
const requireUserMock = vi.hoisted(() => vi.fn());
const previewShoppingListDiffMock = vi.hoisted(() => vi.fn());

vi.mock("./_shared/auth.js", () => ({ requireUser: requireUserMock }));
vi.mock("./_shared/shopping-service.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./_shared/shopping-service.js")>();
  return { ...original, previewShoppingListDiff: previewShoppingListDiffMock };
});

const { createShoppingListPreviewHandler } = await import("./shopping-list-preview.js");

const USER_ID = "85000000-0000-4000-8000-000000000001";
const ACCESS_TOKEN = "token-abc";
const LIST_ID = "70000000-0000-4000-8000-000000000001";
const MENU_ID = "52000000-0000-4000-8000-000000000001";
const ITEM_ID = "71000000-0000-4000-8000-000000000001";
const INGREDIENT_ID = "53000000-0000-4000-8000-000000000001";
const DISH_ID = "50000000-0000-4000-8000-000000000001";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function makeFactory(deps: Partial<ShoppingDependencies> = {}) {
  return vi.fn().mockReturnValue(deps);
}

function makeContext(listId: string) {
  return { params: { listId } } as unknown as Parameters<
    ReturnType<typeof createShoppingListPreviewHandler>
  >[1];
}

function makeRequest(body: unknown): Request {
  return new Request(`http://127.0.0.1/api/shopping-lists/${LIST_ID}/preview`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ACCESS_TOKEN}` },
    body: JSON.stringify(body),
  });
}

const validBody = { sourceMenuId: MENU_ID, sourceMenuVersion: 1, expectedListVersion: 3 };

const diff = {
  add: [
    {
      key: "curry-roux",
      displayName: "カレールー",
      normalizedName: "かれーるー",
      storeSection: "dry_goods" as const,
      quantityValue: 1,
      quantityText: "1箱",
      unit: "箱",
      pantryCheckRequired: false,
      sourceIngredients: [
        {
          ingredientId: INGREDIENT_ID,
          dishId: DISH_ID,
          dishName: "カレー",
          name: "カレールー",
          quantityValue: 1,
          quantityText: "1箱",
          unit: "箱",
          storeSection: "dry_goods" as const,
        },
      ],
      labelWarnings: [
        {
          confirmationId: "a1000000-0000-4000-8000-000000000001",
          warningKey: "c".repeat(64),
          sourceMenuId: MENU_ID,
          sourceDerivationGroupId: "c1000000-0000-4000-8000-000000000001",
          sourceType: "ingredient" as const,
          sourceId: INGREDIENT_ID,
          sourcePath: "dishes.0.ingredients.0.name",
          sourceDisplayName: "カレールー",
          allergenId: "wheat",
          allergenDisplayName: "小麦",
          anonymousMemberRef: "member_1",
          memberDisplayName: "子ども",
          dictionaryVersion: "jp-caa-2026-04.v1",
          confirmationStatus: "pending" as const,
        },
      ],
    },
  ],
  replace: [],
  remove: [],
  protectedItemIds: [ITEM_ID],
  listLabelWarnings: [],
};

describe("createShoppingListPreviewHandler", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    previewShoppingListDiffMock.mockReset();
    requireUserMock.mockResolvedValue({ userId: USER_ID, accessToken: ACCESS_TOKEN });
  });

  it("returns 405 with Allow: POST for non-POST methods without invoking auth or the factory", async () => {
    const factory = makeFactory();
    const handler = createShoppingListPreviewHandler(factory);
    const response = await handler(
      new Request(`http://127.0.0.1/api/shopping-lists/${LIST_ID}/preview`, { method: "GET" }),
      makeContext(LIST_ID),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(factory).not.toHaveBeenCalled();
    expect(requireUserMock).not.toHaveBeenCalled();
  });

  it("rejects a path list id that is not a UUID", async () => {
    const factory = makeFactory();
    const handler = createShoppingListPreviewHandler(factory);
    const response = await handler(makeRequest(validBody), makeContext("not-a-uuid"));
    expect(response.status).toBe(400);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ ok: false, error: { code: "invalid_list_id" } });
    expect(previewShoppingListDiffMock).not.toHaveBeenCalled();
  });

  it("returns invalid_json for malformed JSON bodies", async () => {
    const factory = makeFactory();
    const handler = createShoppingListPreviewHandler(factory);
    const response = await handler(
      new Request(`http://127.0.0.1/api/shopping-lists/${LIST_ID}/preview`, {
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

  it("returns the canonical human fields produced by the owner-scoped server snapshot", async () => {
    previewShoppingListDiffMock.mockResolvedValue(diff);
    const factory = makeFactory();
    const handler = createShoppingListPreviewHandler(factory);
    const response = await handler(makeRequest(validBody), makeContext(LIST_ID));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("カレールー");
    expect(text).toContain("小麦");
    expect(text).toContain("子ども");
    // sourcePath / 生アレルゲンID / 匿名参照は契約上ペイロードに含まれるため、
    // 「本文に出現しないこと」では検証できない。人間向け表示フィールドが
    // それらの生識別子と一致しないこと（＝生識別子をラベルとして描画していないこと）を
    // 構造的に固定する。
    const body = JSON.parse(text) as {
      data: {
        add: {
          labelWarnings: {
            sourcePath: string;
            sourceDisplayName: string;
            allergenId: string;
            allergenDisplayName: string;
            anonymousMemberRef: string;
            memberDisplayName: string;
          }[];
        }[];
      };
    };
    const warnings = body.data.add.flatMap((item) => item.labelWarnings);
    expect(warnings).toHaveLength(1);
    for (const warning of warnings) {
      expect(warning.sourceDisplayName).toBe("カレールー");
      expect(warning.allergenDisplayName).toBe("小麦");
      expect(warning.memberDisplayName).toBe("子ども");
      expect(warning.sourceDisplayName).not.toBe(warning.sourcePath);
      expect(warning.allergenDisplayName).not.toBe(warning.allergenId);
      expect(warning.memberDisplayName).not.toBe(warning.anonymousMemberRef);
      for (const label of [
        warning.sourceDisplayName,
        warning.allergenDisplayName,
        warning.memberDisplayName,
      ]) {
        expect(label).not.toMatch(UUID_PATTERN);
      }
    }
    expect(factory).toHaveBeenCalledWith({ userId: USER_ID, accessToken: ACCESS_TOKEN });
    expect(previewShoppingListDiffMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ...validBody, listId: LIST_ID, userId: USER_ID }),
    );
  });

  it("maps a service HttpError to its status and code", async () => {
    previewShoppingListDiffMock.mockRejectedValue(
      new HttpError(409, "list_version_conflict", "買い物リストが更新されました"),
    );
    const handler = createShoppingListPreviewHandler(makeFactory());
    const response = await handler(makeRequest(validBody), makeContext(LIST_ID));
    expect(response.status).toBe(409);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ ok: false, error: { code: "list_version_conflict" } });
  });
});
