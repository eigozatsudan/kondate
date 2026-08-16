import { describe, expect, it, vi } from "vitest";
import { makeCurrentSafetyContext, makeValidatedMenu } from "../../../shared/testing/factories.js";
import {
  revalidateStoredMenu,
  toDisplayRevalidationIssues,
  toPersistedRevalidationIssues,
} from "./revalidation-service.js";

const safetySnapshot = makeCurrentSafetyContext();

describe("revalidateStoredMenu", () => {
  it("validates historical dishes against current rather than snapshot safety", async () => {
    const validMenu = makeValidatedMenu();
    const save = vi.fn().mockResolvedValue(undefined);
    const validate = vi.fn().mockResolvedValue({
      ok: false,
      candidate: validMenu,
      changedDetails: [],
      issues: [{ code: "allergen", path: "dishes.0", message: "くるみを含みます" }],
    });
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
          safety: safetySnapshot,
        }),
        validateStoredCurrentSafety: validate,
        reconcileCurrentLabelWarnings: vi.fn().mockResolvedValue([]),
        save,
      },
      { userId: "user-1", menuId: "menu-1" },
    );

    expect(result.status).toBe("invalid");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ safetyFingerprint: "current" }));
    // HR5: validate に load と同じ safety snapshot を渡す
    expect(validate).toHaveBeenCalledWith(
      expect.objectContaining({ safety: safetySnapshot, userId: "user-1" }),
    );
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
          safety: safetySnapshot,
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
      safety: typeof safetySnapshot;
    };
    expect(validateArg.stored.menu).toBe(stored);
    expect(validateArg.safety).toBe(safetySnapshot);
    expect(stored.labelConfirmations[0]).toMatchObject({
      confirmationStatus: "confirmed",
      confirmedAt: "2026-07-11T01:00:00.000Z",
    });
  });

  it("HR8: save persists closed codes without display or allergen names; 200 keeps Japanese", async () => {
    const validMenu = makeValidatedMenu();
    const save = vi.fn().mockResolvedValue(undefined);
    const namedIssue = {
      code: "direct_allergen_match" as const,
      path: "dishes.0.ingredients.0.name",
      message: "「花子」さんの登録アレルギー「小麦」が「小麦粉」に残っています",
    };
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
          safety: safetySnapshot,
        }),
        validateStoredCurrentSafety: vi.fn().mockResolvedValue({
          ok: false,
          candidate: validMenu,
          changedDetails: [],
          issues: [namedIssue],
        }),
        reconcileCurrentLabelWarnings: vi.fn().mockResolvedValue([]),
        save,
      },
      { userId: "user-1", menuId: "menu-1" },
    );

    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0]?.[0] as { issues: unknown };
    expect(saved.issues).toEqual([
      { code: "direct_allergen_match", path: "dishes.0.ingredients.0.name" },
    ]);
    const savedJson = JSON.stringify(saved.issues);
    expect(savedJson).not.toContain("花子");
    expect(savedJson).not.toContain("小麦");
    expect(savedJson).not.toContain("小麦粉");
    expect(savedJson).not.toMatch(/displayName|allergenName|allergenDisplayName/iu);
    // 200 / 返却は読取時に利用者向け日本語を組み立てる（DB には書かない）
    expect(result.issues).toEqual([
      {
        code: "direct_allergen_match",
        path: "dishes.0.ingredients.0.name",
        message: "登録アレルギーが献立に残っています",
      },
    ]);
    expect(JSON.stringify(result.issues)).not.toContain("花子");
    expect(JSON.stringify(result.issues)).not.toMatch(/displayName|allergenName/iu);
  });

  it("HR8: display assembly keeps catalog food-rule copy and drops honorific names", () => {
    const issues = toDisplayRevalidationIssues([
      {
        code: "age_shape_rule",
        path: "dishes.0.ingredients.0.name",
        message: "5歳以下を含む献立では餅を使用できません",
      },
      {
        code: "required_safety_action",
        path: "members.member_1.requiredSafetyConstraints",
        message: "「家族1」さん向けの「小さく切る」工程がありません",
      },
    ]);
    expect(issues[0]?.message).toBe("5歳以下を含む献立では餅を使用できません");
    expect(issues[1]?.message).toBe("必要な安全工程がありません");
    expect(toPersistedRevalidationIssues(issues)).toEqual([
      { code: "age_shape_rule", path: "dishes.0.ingredients.0.name" },
      { code: "required_safety_action", path: "members.member_1.requiredSafetyConstraints" },
    ]);
  });
});
