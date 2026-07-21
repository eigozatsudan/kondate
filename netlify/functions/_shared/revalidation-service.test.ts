import { describe, expect, it, vi } from "vitest";
import { makeValidatedMenu } from "../../../shared/testing/factories.js";
import { revalidateStoredMenu } from "./revalidation-service.js";

describe("revalidateStoredMenu", () => {
  it("validates historical dishes against current rather than snapshot safety", async () => {
    const validMenu = makeValidatedMenu();
    const save = vi.fn().mockResolvedValue(undefined);
    const result = await revalidateStoredMenu(
      {
        loadMenu: vi.fn().mockResolvedValue({
          menu: validMenu,
          userId: "user-1",
          safetyFingerprint: "previous",
          derivationGroupId: crypto.randomUUID(),
          version: 1,
          preferenceSnapshot: {},
          targetMemberIds: ["20000000-0000-4000-8000-000000000001"],
          targetMembers: [],
        }),
        loadCurrentSafety: vi.fn().mockResolvedValue({
          fingerprint: "current",
          allergenCatalogVersion: "allergens-v3",
          foodRuleVersion: "food-v2",
        }),
        validateStoredCurrentSafety: vi.fn().mockResolvedValue({
          ok: false,
          candidate: validMenu,
          changedDetails: [],
          issues: [{ code: "allergen", path: "dishes.0", message: "くるみを含みます" }],
        }),
        reconcileCurrentLabelWarnings: vi.fn().mockResolvedValue([]),
        save,
      },
      { userId: "user-1", menuId: "menu-1" },
    );

    expect(result.status).toBe("invalid");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ safetyFingerprint: "current" }));
  });

  it("keeps confirmed provenance in storage but revalidates a pending generated projection", async () => {
    const confirmedBy = crypto.randomUUID();
    const stored = makeValidatedMenu({
      labelConfirmations: [
        {
          sourceType: "ingredient",
          sourceId: "53000000-0000-4000-8000-000000000001",
          sourcePath: "dishes.0.ingredients.0.name",
          sourceText: "ごはん",
          allergenId: "wheat",
          anonymousMemberRef: "member_1",
          dictionaryVersion: "jp-caa-2026-04.v1",
          confirmationStatus: "confirmed",
          confirmedAt: "2026-07-11T01:00:00.000Z",
          confirmedBy,
        },
      ],
    });
    const validate = vi.fn().mockResolvedValue({
      ok: true,
      candidate: makeValidatedMenu(),
      changedDetails: [],
      issues: [],
    });
    await revalidateStoredMenu(
      {
        loadMenu: vi.fn().mockResolvedValue({
          menu: stored,
          userId: "user-1",
          safetyFingerprint: "old",
          derivationGroupId: crypto.randomUUID(),
          version: 1,
          preferenceSnapshot: {},
          targetMemberIds: [],
          targetMembers: [],
        }),
        loadCurrentSafety: vi.fn().mockResolvedValue({
          fingerprint: "current",
          allergenCatalogVersion: "allergens-v3",
          foodRuleVersion: "food-v2",
        }),
        validateStoredCurrentSafety: validate,
        reconcileCurrentLabelWarnings: vi.fn().mockResolvedValue([]),
        save: vi.fn().mockResolvedValue(undefined),
      },
      { userId: "user-1", menuId: stored.menuId },
    );
    // 依存は stored 集約を渡し、保存済み confirmed 証跡は validator 証拠に使わない
    expect(validate).toHaveBeenCalledTimes(1);
    const validateArg = validate.mock.calls[0]?.[0] as {
      stored: { menu: typeof stored };
    };
    expect(validateArg.stored.menu).toBe(stored);
    expect(stored.labelConfirmations[0]).toMatchObject({
      confirmationStatus: "confirmed",
      confirmedAt: "2026-07-11T01:00:00.000Z",
    });
  });
});
