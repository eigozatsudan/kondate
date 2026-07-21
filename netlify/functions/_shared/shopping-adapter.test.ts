import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentShoppingLabelWarning } from "../../../shared/contracts/shopping.js";
import { createShoppingDependencies } from "./shopping-adapter.js";
import { getSupabaseAdmin } from "./supabase-admin.js";
import { createUserScopedSupabase } from "./supabase-user.js";

// 設計書 Task4 Step1/Step3: 内部 RPC (refresh_shopping_list_safety) の応答は
// service 専用の内部スキーマだけで厳密検証する境界であり、公開 HTTP union として
// 解釈してはならない。「キー欠落・余剰キー・301件・不正な warning・重複 warningKey・
// 501文字の source text」がすべて安全側に閉じ、HTTP 成功として包まれないことを
// この adapter 境界そのもので固定する（service 側の vi.fn() モックでは
// parseRpcResponse の行が一度も実行されないため、ここでしか押さえられない）。
vi.mock("./supabase-admin.js", () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("./supabase-user.js", () => ({ createUserScopedSupabase: vi.fn() }));

const USER_ID = "85000000-0000-4000-8000-000000000001";
const LIST_ID = "70000000-0000-4000-8000-000000000001";
const MENU_ID = "52000000-0000-4000-8000-000000000001";
const GROUP_ID = "c1000000-0000-4000-8000-000000000001";
const INGREDIENT_ID = "53000000-0000-4000-8000-000000000001";
const FINGERPRINT = "a".repeat(64);

function makeWarning(
  overrides: Partial<CurrentShoppingLabelWarning> = {},
): CurrentShoppingLabelWarning {
  return {
    itemId: null,
    warningKey: "b".repeat(64),
    sourceMenuId: MENU_ID,
    sourceDerivationGroupId: GROUP_ID,
    sourceType: "ingredient",
    sourceId: INGREDIENT_ID,
    sourcePath: "dishes.0.ingredients.0.name",
    sourceDisplayName: "カレールー",
    allergenId: "wheat",
    allergenDisplayName: "小麦",
    anonymousMemberRef: "member_1",
    memberDisplayName: "子ども",
    dictionaryVersion: "jp-caa-2026-04.v1",
    ...overrides,
  };
}

// rpc の応答（data / error）だけを差し替えた依存を組み立てる。
// data は「DB が返しうる任意の JSON」なので unknown で受け、adapter 側の
// Zod 検証を素通りさせないことがこのテストの目的。
function makeDeps(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  vi.mocked(getSupabaseAdmin).mockReturnValue({ rpc } as never);
  vi.mocked(createUserScopedSupabase).mockReturnValue({} as never);
  return {
    rpc,
    deps: createShoppingDependencies({ userId: USER_ID, accessToken: "access-token" }),
  };
}

function callReplace(deps: ReturnType<typeof makeDeps>["deps"]) {
  return deps.replaceCurrentSafetyProjection({
    userId: USER_ID,
    listId: LIST_ID,
    expectedFingerprint: FINGERPRINT,
    warnings: [],
  });
}

describe("createShoppingDependencies.replaceCurrentSafetyProjection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the parsed internal RPC response when it is exactly well formed", async () => {
    const warning = makeWarning();
    const { deps, rpc } = makeDeps({
      data: {
        listId: LIST_ID,
        safetyFingerprint: FINGERPRINT,
        currentLabelWarnings: [warning],
      },
      error: null,
    });
    await expect(callReplace(deps)).resolves.toEqual({
      listId: LIST_ID,
      safetyFingerprint: FINGERPRINT,
      currentLabelWarnings: [warning],
    });
    expect(rpc).toHaveBeenCalledWith("refresh_shopping_list_safety", {
      p_user_id: USER_ID,
      p_list_id: LIST_ID,
      p_expected_fingerprint: FINGERPRINT,
      p_warnings: [],
    });
  });

  it("fails closed on a missing key, an extra key, 301 warnings, a malformed warning, or a 501-character source text", async () => {
    const malformed: { label: string; data: unknown }[] = [
      {
        label: "missing safetyFingerprint key",
        data: { listId: LIST_ID, currentLabelWarnings: [] },
      },
      {
        label: "extra key",
        data: {
          listId: LIST_ID,
          safetyFingerprint: FINGERPRINT,
          currentLabelWarnings: [],
          unexpected: true,
        },
      },
      {
        label: "301 warnings",
        data: {
          listId: LIST_ID,
          safetyFingerprint: FINGERPRINT,
          currentLabelWarnings: Array.from({ length: 301 }, (_unused, index) =>
            makeWarning({ warningKey: index.toString(16).padStart(64, "0") }),
          ),
        },
      },
      {
        label: "malformed warning",
        data: {
          listId: LIST_ID,
          safetyFingerprint: FINGERPRINT,
          currentLabelWarnings: [{ ...makeWarning(), anonymousMemberRef: "member_zero" }],
        },
      },
      {
        label: "501-character source display name",
        data: {
          listId: LIST_ID,
          safetyFingerprint: FINGERPRINT,
          currentLabelWarnings: [makeWarning({ sourceDisplayName: "あ".repeat(501) })],
        },
      },
    ];
    for (const { label, data } of malformed) {
      const { deps } = makeDeps({ data, error: null });
      // 503 / shopping_unavailable は「応答を確認できなかった」という失敗であり、
      // 決して ok:true の HTTP 成功に包まれない。
      await expect(callReplace(deps), label).rejects.toMatchObject({
        status: 503,
        code: "shopping_unavailable",
      });
    }
  });

  it("fails closed when the RPC rejects a duplicate warning key instead of returning a projection", async () => {
    // 同一 (list,warningKey,itemId) の重複は DB の一意制約が拒否する。
    // adapter は既知コードに該当しないエラーを 503 に落とし、成功として包まない。
    const { deps } = makeDeps({
      data: null,
      error: {
        message:
          'duplicate key value violates unique constraint "shopping_current_label_warnings_key_unique"',
      },
    });
    await expect(callReplace(deps)).rejects.toMatchObject({
      status: 503,
      code: "shopping_unavailable",
    });
  });

  it("maps the RPC race error to safety_fingerprint_changed rather than a success wrapper", async () => {
    const { deps } = makeDeps({
      data: null,
      error: { message: "shopping_safety_fingerprint_changed" },
    });
    await expect(callReplace(deps)).rejects.toMatchObject({
      status: 409,
      code: "safety_fingerprint_changed",
    });
  });
});
