import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isRevalidationActionable,
  revalidateMenu,
  revalidationResultSchema,
  type RevalidationResult,
} from "./revalidation-api";

const requireAccessTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth/session", () => ({
  requireAccessToken: requireAccessTokenMock,
}));
vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({}),
}));

const MENU_ID = "30000000-0000-4000-8000-000000000001";

const validResult: RevalidationResult = {
  status: "valid",
  safetyFingerprint: "current-fp",
  allergenCatalogVersion: "allergens-v3",
  foodRuleVersion: "food-v2",
  issues: [],
  changedDetails: [],
  currentLabelWarnings: [],
};

function okResponse(data: unknown): Response {
  return Response.json({ ok: true, data });
}

describe("revalidateMenu", () => {
  beforeEach(() => {
    requireAccessTokenMock.mockReset();
    requireAccessTokenMock.mockResolvedValue("access-token");
  });

  it("posts with the current access token and parses a valid envelope", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(okResponse(validResult)));
    await expect(revalidateMenu(MENU_ID, { fetchImpl })).resolves.toEqual(validResult);
    expect(requireAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(`/api/menus/${MENU_ID}/revalidate`, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: "Bearer access-token",
        "Content-Type": "application/json",
      },
    });
  });

  it("rejects unknown fields on the result payload", () => {
    expect(
      revalidationResultSchema.safeParse({
        ...validResult,
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("throws a closed typed error when auth is missing", async () => {
    requireAccessTokenMock.mockRejectedValue(new Error("ログインが必要です"));
    await expect(revalidateMenu(MENU_ID, { fetchImpl: vi.fn() })).rejects.toThrow(
      "ログインが必要です",
    );
  });

  it("throws for an invalid envelope shape", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(Response.json({ ok: true, data: { status: "ok" } })),
    );
    await expect(revalidateMenu(MENU_ID, { fetchImpl })).rejects.toMatchObject({
      code: "invalid_envelope",
    });
  });

  it("throws the server error code for ok:false envelopes", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        Response.json({
          ok: false,
          error: { code: "menu_not_found", message: "献立が見つかりません" },
        }),
      ),
    );
    await expect(revalidateMenu(MENU_ID, { fetchImpl })).rejects.toMatchObject({
      code: "menu_not_found",
    });
  });

  it("accepts pantry and preference drift as non-blocking changed", async () => {
    const changed: RevalidationResult = {
      ...validResult,
      status: "changed",
      changedDetails: ["pantry_item_removed", "pantry_quantity_changed", "preference_changed"],
    };
    const fetchImpl = vi.fn(() => Promise.resolve(okResponse(changed)));
    const result = await revalidateMenu(MENU_ID, { fetchImpl });
    expect(result.status).toBe("changed");
    expect(isRevalidationActionable(result)).toBe(true);
  });

  it("accepts all status variants and bounds currentLabelWarnings", async () => {
    for (const status of ["valid", "changed", "invalid"] as const) {
      const payload: RevalidationResult = {
        ...validResult,
        status,
        issues:
          status === "invalid"
            ? [{ code: "allergen_present", path: "dishes.0", message: "アレルゲンが含まれます" }]
            : [],
        currentLabelWarnings:
          status === "valid"
            ? [
                {
                  confirmationId: "48000000-0000-4000-8000-000000000001",
                  sourceType: "ingredient",
                  sourceId: "53000000-0000-4000-8000-000000000001",
                  sourcePath: "dishes.0.ingredients.0.name",
                  sourceText: "しょうゆ（RPC snapshot）",
                  allergenId: "wheat",
                  allergenName: "小麦",
                  anonymousMemberRef: "member_1",
                  memberLabel: "子ども",
                  dictionaryVersion: "jp-caa-2026-04.v1",
                  confirmationStatus: "pending",
                },
              ]
            : [],
      };
      const fetchImpl = vi.fn(() => Promise.resolve(okResponse(payload)));
      await expect(revalidateMenu(MENU_ID, { fetchImpl })).resolves.toEqual(payload);
    }
  });

  it("treats invalid status as not actionable even with empty issues", () => {
    expect(
      isRevalidationActionable({
        ...validResult,
        status: "invalid",
        issues: [{ code: "x", path: "y", message: "z" }],
      }),
    ).toBe(false);
  });
});
