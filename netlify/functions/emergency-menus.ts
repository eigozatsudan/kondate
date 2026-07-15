import type { Config } from "@netlify/functions";
import { z } from "zod";
import { mealTypes } from "../../shared/contracts/domain.js";
import { emergencyFixtureVersion } from "../../shared/emergency/fixtures.v1.js";
import {
  buildEmergencyMenuCandidate,
  filterEmergencyMenus,
  type EmergencyMenusData,
} from "../../shared/emergency/filter-emergency-menus.js";
import { requireUser } from "./_shared/auth.js";
import {
  loadEmergencyCurrentSafety,
  type EmergencyCurrentSafety,
} from "./_shared/current-safety.js";
import { handleError, json, methodNotAllowed } from "./_shared/http.js";
import { getSupabaseAdmin } from "./_shared/supabase-admin.js";

const uuidSchema = z.uuid();
const uuidListSchema = z
  .string()
  .min(1)
  .transform((value, context) => {
    const values = value.split(",");
    if (
      values.length > 20 ||
      new Set(values).size !== values.length ||
      values.some((item) => !uuidSchema.safeParse(item).success)
    ) {
      context.addIssue({ code: "custom", message: "IDは重複なしで20件以内にしてください" });
      return z.NEVER;
    }
    return values;
  });

const querySchema = z.object({
  meal: z.enum(mealTypes),
  targetMemberIds: uuidListSchema,
  pantryItemIds: uuidListSchema.optional().default([]),
});

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
      const parsed = querySchema.safeParse({
        meal: url.searchParams.get("meal"),
        targetMemberIds: url.searchParams.get("targetMemberIds"),
        pantryItemIds: url.searchParams.get("pantryItemIds") ?? undefined,
      });
      if (!parsed.success) {
        return json(400, {
          ok: false,
          error: {
            code: "invalid_request",
            message: "検索条件を確認してください",
            details: { fields: z.flattenError(parsed.error).fieldErrors },
          },
        });
      }
      const { userId } = await deps.authenticate(request);
      const [loaded, pantryNames] = await Promise.all([
        deps.loadContext(userId, parsed.data.targetMemberIds),
        deps.loadPantryNames(userId, parsed.data.pantryItemIds),
      ]);
      const filtered = filterEmergencyMenus({
        mealType: parsed.data.meal,
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
      return json<EmergencyMenusData>(200, {
        ok: true,
        data: {
          fixtureVersion: emergencyFixtureVersion,
          candidates,
          message:
            candidates.length === 0
              ? "条件に合う緊急献立がありません"
              : "AIを使わない15分緊急献立です",
          consumesAiQuota: false,
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
    if (error !== null || data.length !== ids.length) {
      throw new Error("pantry_items_unavailable");
    }
    return data.map((row) => row.name);
  },
});

export default handler;

export const config: Config = { path: "/api/emergency-menus", method: "GET" };
