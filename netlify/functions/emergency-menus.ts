import type { Config } from "@netlify/functions";
import { z } from "zod";
import { mealTypes } from "../../shared/contracts/domain.js";
import {
  emergencyMainIngredientsSchema,
  type EmergencyMenusData,
} from "../../shared/emergency/contracts.js";
import { emergencyFixtureVersion } from "../../shared/emergency/fixtures.v1.js";
import {
  buildEmergencyMenuCandidate,
  filterEmergencyMenus,
} from "../../shared/emergency/filter-emergency-menus.js";
import { buildIdeaPersonalSafetyContext } from "../../shared/emergency/idea-context.js";
import { requireUser } from "./_shared/auth.js";
import {
  loadEmergencyCurrentSafety,
  type EmergencyCurrentSafety,
} from "./_shared/current-safety.js";
import { handleError, json, methodNotAllowed } from "./_shared/http.js";
import { getSupabaseAdmin } from "./_shared/supabase-admin.js";

const uuidSchema = z.uuid();
function uuidListSchema(maxItems: number) {
  return z
    .string()
    .min(1)
    .transform((value, context) => {
      const values = value.split(",");
      if (
        values.length > maxItems ||
        new Set(values).size !== values.length ||
        values.some((item) => !uuidSchema.safeParse(item).success)
      ) {
        context.addIssue({
          code: "custom",
          message: `IDは重複なしで${String(maxItems)}件以内にしてください`,
        });
        return z.NEVER;
      }
      return values;
    });
}

const mealSchema = z.enum(mealTypes);
const targetModeSchema = z.enum(["household", "idea"]);

// 未知キーは拒否しない（.strict() にしない）
const rawQuerySchema = z.object({
  meal: mealSchema,
  mainIngredients: emergencyMainIngredientsSchema,
  targetMode: targetModeSchema.optional(),
  targetMemberIds: z.string().optional(),
  pantryItemIds: z.string().optional(),
});

type ResolvedEmergencyQuery =
  | {
      meal: (typeof mealTypes)[number];
      mainIngredients: string[];
      targetMode: "idea";
      pantryItemIds: string[];
    }
  | {
      meal: (typeof mealTypes)[number];
      mainIngredients: string[];
      targetMode: "household";
      targetMemberIds: string[];
      pantryItemIds: string[];
    };

function invalidRequestFields(fields: Record<string, string[]>): Response {
  return json(400, {
    ok: false,
    error: {
      code: "invalid_request",
      message: "検索条件を確認してください",
      details: { fields },
    },
  });
}

/**
 * design §3 の query 正規化。
 * URLSearchParams.get の null は呼び出し側で ?? undefined 済み前提。
 * 空文字 targetMemberIds は omit と混同しない。
 */
function resolveEmergencyQuery(
  raw: z.infer<typeof rawQuerySchema>,
): { ok: true; value: ResolvedEmergencyQuery } | { ok: false; response: Response } {
  const pantryParsed =
    raw.pantryItemIds === undefined
      ? { success: true as const, data: [] as string[] }
      : uuidListSchema(50).safeParse(raw.pantryItemIds);
  if (!pantryParsed.success) {
    return {
      ok: false,
      response: invalidRequestFields({
        pantryItemIds: pantryParsed.error.issues.map((issue) => issue.message),
      }),
    };
  }
  const pantryItemIds = pantryParsed.data;

  // 1. targetMode 欠落 → valid 非空 CSV のときだけ household
  if (raw.targetMode === undefined) {
    if (raw.targetMemberIds === undefined || raw.targetMemberIds === "") {
      return {
        ok: false,
        response: invalidRequestFields({
          targetMemberIds: ["対象メンバーを指定してください"],
        }),
      };
    }
    const membersParsed = uuidListSchema(20).safeParse(raw.targetMemberIds);
    if (!membersParsed.success) {
      return {
        ok: false,
        response: invalidRequestFields({
          targetMemberIds: membersParsed.error.issues.map((issue) => issue.message),
        }),
      };
    }
    return {
      ok: true,
      value: {
        meal: raw.meal,
        mainIngredients: raw.mainIngredients,
        targetMode: "household",
        targetMemberIds: membersParsed.data,
        pantryItemIds,
      },
    };
  }

  // 2. targetMode=idea → targetMemberIds キー未送出（undefined）のみ
  if (raw.targetMode === "idea") {
    if (raw.targetMemberIds !== undefined) {
      return {
        ok: false,
        response: invalidRequestFields({
          targetMemberIds: ["アイデアモードでは対象メンバーを指定できません"],
        }),
      };
    }
    return {
      ok: true,
      value: {
        meal: raw.meal,
        mainIngredients: raw.mainIngredients,
        targetMode: "idea",
        pantryItemIds,
      },
    };
  }

  // 3. targetMode=household → uuidList 必須
  if (raw.targetMemberIds === undefined || raw.targetMemberIds === "") {
    return {
      ok: false,
      response: invalidRequestFields({
        targetMemberIds: ["対象メンバーを指定してください"],
      }),
    };
  }
  const membersParsed = uuidListSchema(20).safeParse(raw.targetMemberIds);
  if (!membersParsed.success) {
    return {
      ok: false,
      response: invalidRequestFields({
        targetMemberIds: membersParsed.error.issues.map((issue) => issue.message),
      }),
    };
  }
  return {
    ok: true,
    value: {
      meal: raw.meal,
      mainIngredients: raw.mainIngredients,
      targetMode: "household",
      targetMemberIds: membersParsed.data,
      pantryItemIds,
    },
  };
}

export type EmergencyHandlerDeps = {
  authenticate(request: Request): Promise<{ userId: string }>;
  loadContext(userId: string, targetMemberIds: readonly string[]): Promise<EmergencyCurrentSafety>;
  loadPantryNames(userId: string, pantryItemIds: readonly string[]): Promise<readonly string[]>;
};

export function createEmergencyMenusHandler(deps: EmergencyHandlerDeps) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    try {
      const url = new URL(request.url);
      // ★ critical: URLSearchParams.get は欠落時 null。Zod .optional() は undefined のみ受理。
      // null を渡すと idea omit / targetMode omit が 400 になる。必ず ?? undefined する。
      const rawParsed = rawQuerySchema.safeParse({
        meal: url.searchParams.get("meal") ?? undefined,
        mainIngredients: url.searchParams.getAll("mainIngredients"),
        targetMode: url.searchParams.get("targetMode") ?? undefined,
        // キー未送出 → null → undefined（omit）
        // キーあり空文字 ?targetMemberIds= → ""（idea では 400。omit と混同しない）
        targetMemberIds: url.searchParams.get("targetMemberIds") ?? undefined,
        pantryItemIds: url.searchParams.get("pantryItemIds") ?? undefined,
      });
      if (!rawParsed.success) {
        return json(400, {
          ok: false,
          error: {
            code: "invalid_request",
            message: "検索条件を確認してください",
            details: { fields: z.flattenError(rawParsed.error).fieldErrors },
          },
        });
      }

      const resolvedResult = resolveEmergencyQuery(rawParsed.data);
      if (!resolvedResult.ok) return resolvedResult.response;
      const resolved = resolvedResult.value;

      const { userId } = await deps.authenticate(request);
      // pantry は path 共通: 所有者 pantry のみ（家族表を読まない）
      const pantryNames = await deps.loadPantryNames(userId, resolved.pantryItemIds);

      if (resolved.targetMode === "idea") {
        // loadEmergencyCurrentSafety / loadContext 禁止（家族 current safety を読まない）
        const idea = buildIdeaPersonalSafetyContext();
        const filtered = filterEmergencyMenus({
          mealType: resolved.meal,
          mainIngredients: resolved.mainIngredients,
          pantryNames,
          context: idea.context,
          memberLabels: idea.memberLabels,
        });
        if (filtered.emptyReason === "current_safety_unavailable") {
          // 到達しない想定のバグ。偽の 200 empty にしない。
          throw new Error("idea_emergency_current_safety_unavailable");
        }
        const candidates = filtered.menus.map((menu) =>
          buildEmergencyMenuCandidate({
            menu,
            context: idea.context,
            memberLabels: idea.memberLabels,
          }),
        );
        // §4 idea message 行列（wire）。UI は非空時 banner/intro を別表示してもよいが wire は正本。
        const message =
          candidates.length === 0
            ? "条件に合う緊急献立がありません"
            : filtered.matchMode === "safety_only"
              ? "メイン食材は一致しませんでした。アレルギー条件は適用していません"
              : "AIを使わない15分緊急献立です。アレルギー条件は適用していません";

        return json<EmergencyMenusData>(200, {
          ok: true,
          data: {
            fixtureVersion: emergencyFixtureVersion,
            candidates,
            message,
            consumesAiQuota: false,
            path: "idea",
            matchMode: filtered.matchMode,
            emptyReason: filtered.emptyReason,
          },
        });
      }

      // household: 既存 loadContext 経路
      const loaded = await deps.loadContext(userId, resolved.targetMemberIds);
      const filtered = filterEmergencyMenus({
        mealType: resolved.meal,
        mainIngredients: resolved.mainIngredients,
        pantryNames,
        context: loaded.context,
        memberLabels: loaded.memberLabels,
      });
      const candidates = filtered.menus.map((menu) =>
        buildEmergencyMenuCandidate({
          menu,
          context: loaded.context,
          memberLabels: loaded.memberLabels,
        }),
      );
      // household 専用のサーバ message 行列（UI banner の safety_only 文言は Task 5 で別）
      const message =
        candidates.length === 0
          ? "条件に合う緊急献立がありません"
          : filtered.matchMode === "safety_only"
            ? "メイン食材は一致しませんでした。安全条件に合う固定候補を表示しています"
            : "AIを使わない15分緊急献立です";

      return json<EmergencyMenusData>(200, {
        ok: true,
        data: {
          fixtureVersion: emergencyFixtureVersion,
          candidates,
          message,
          consumesAiQuota: false,
          path: "household",
          matchMode: filtered.matchMode,
          emptyReason: filtered.emptyReason,
        },
      });
    } catch (error) {
      return handleError(error);
    }
  };
}

const handler = createEmergencyMenusHandler({
  authenticate: requireUser,
  loadContext: (userId, ids) => loadEmergencyCurrentSafety(getSupabaseAdmin(), userId, ids),
  loadPantryNames: async (userId, ids) => {
    if (ids.length === 0) return [];
    const { data, error } = await getSupabaseAdmin()
      .from("pantry_items")
      .select("name")
      .eq("user_id", userId)
      .in("id", [...ids]);
    if (error !== null || data.length !== new Set(ids).size) return [];
    return data.map((row) => row.name);
  },
});

export default handler;

export const config: Config = { path: "/api/emergency-menus", method: "GET" };
