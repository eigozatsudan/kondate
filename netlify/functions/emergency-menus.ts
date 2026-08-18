import type { Config } from "@netlify/functions";
import { z } from "zod";
import { ageBands, mealTypes } from "../../shared/contracts/domain.js";
import { issueMessages, validatedMenuSchema } from "../../shared/contracts/generation.js";
import { shareQuota } from "../../shared/contracts/share-quota.js";
import {
  emergencyMenusRequestSchema,
  type EmergencyMenusData,
  type EmergencyMenusRequest,
} from "../../shared/emergency/contracts.js";
import {
  emergencyFixtureMetadataV1,
  emergencyFixtureVersion,
  emergencyMenuFixturesV1,
} from "../../shared/emergency/fixtures.v1.js";
import {
  buildEmergencyMenuCandidate,
  filterEmergencyMenuCandidates,
  type EmergencyMultiSourceFilterResult,
  type EmergencySourceCandidate,
} from "../../shared/emergency/filter-emergency-menus.js";
import { buildIdeaPersonalSafetyContext } from "../../shared/emergency/idea-context.js";
import { getJstDateKey } from "../../shared/time/jst.js";
import { requireUser } from "./_shared/auth.js";
import {
  loadEmergencyInspectionSafety,
  type EmergencyCurrentSafety,
} from "./_shared/current-safety.js";
import {
  closedFieldErrors,
  handleError,
  HttpError,
  json,
  methodNotAllowed,
  parseJson,
} from "./_shared/http.js";
import { safeLog } from "./_shared/logger.js";
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

// GET は ID / 列挙のみ。自由文 mainIngredients は query に載せない（Observability が URL を保持する）。
// 未知キーは拒否しない（.strict() にしない）
const rawQuerySchema = z.object({
  meal: mealSchema,
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
        mainIngredients: [],
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
        mainIngredients: [],
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
      mainIngredients: [],
      targetMode: "household",
      targetMemberIds: membersParsed.data,
      pantryItemIds,
    },
  };
}

function resolvedFromPostBody(body: EmergencyMenusRequest): ResolvedEmergencyQuery {
  if (body.targetMode === "idea") {
    return {
      meal: body.mealType,
      mainIngredients: body.mainIngredients,
      targetMode: "idea",
      pantryItemIds: [...body.pantryItemIds],
    };
  }
  return {
    meal: body.mealType,
    mainIngredients: body.mainIngredients,
    targetMode: "household",
    targetMemberIds: [...body.targetMemberIds],
    pantryItemIds: [...body.pantryItemIds],
  };
}

/** list_active_shared_emergency_recipes が返す 1 行（service_role 向け）。contributor は含まない */
const sharedEmergencyListRowSchema = z.object({
  id: z.uuid(),
  menu_payload: z.unknown(),
  meal_type: z.enum(mealTypes).optional(),
  total_elapsed_minutes: z.number().optional(),
  standard_allergen_ids: z.array(z.string()),
  eligible_age_bands: z.array(z.string()),
  created_at: z.string().optional(),
});

export type SharedEmergencyListRow = z.infer<typeof sharedEmergencyListRowSchema>;

const sharedEmergencyListResultSchema = z.array(sharedEmergencyListRowSchema);

const ageBandSet = new Set<string>(ageBands);

/** S1 fixture 候補をカタログから構築（metadata 欠落は落とす） */
function buildFixtureSourceCandidates(): EmergencySourceCandidate[] {
  return emergencyMenuFixturesV1.flatMap((menu) => {
    const metadata = emergencyFixtureMetadataV1[menu.menuId];
    if (metadata === undefined) return [];
    return [
      {
        menu,
        metadata: {
          eligibleAgeBands: metadata.eligibleAgeBands,
          standardAllergenIds: metadata.standardAllergenIds,
        },
        source: "fixture" as const,
      },
    ];
  });
}

/**
 * DB 行を community 候補へ。menu_payload は Zod で閉じ、メタは DB 列を正とする。
 * 不正行は捨てて継続（個別失敗で全体 500 にしない）。
 * PE16: meal_type 列または payload.mealType が要求帯と不一致なら Stage S 前に落とす
 * （fetch 枠を食い Stage S で捨てるだけの残差を閉じる）。
 */
export function mapSharedRowsToCommunityCandidates(
  rows: readonly SharedEmergencyListRow[],
  expectedMealType: (typeof mealTypes)[number],
): EmergencySourceCandidate[] {
  const out: EmergencySourceCandidate[] = [];
  for (const row of rows) {
    if (row.meal_type !== undefined && row.meal_type !== expectedMealType) continue;
    const menuParsed = validatedMenuSchema.safeParse(row.menu_payload);
    if (!menuParsed.success) continue;
    // payload 側の mealType も要求帯と一致必須（列欠落・改ざんの両経路）
    if (menuParsed.data.mealType !== expectedMealType) continue;
    const eligibleAgeBands = row.eligible_age_bands.filter(
      (band): band is (typeof ageBands)[number] => ageBandSet.has(band),
    );
    // 空帯は Stage S で全メンバー脱落するため載せない（fail-closed）
    if (eligibleAgeBands.length === 0) continue;
    out.push({
      menu: menuParsed.data,
      metadata: {
        eligibleAgeBands,
        standardAllergenIds: row.standard_allergen_ids,
      },
      source: "community",
    });
  }
  return out;
}

export type ListActiveSharedEmergencyRecipesInput = {
  mealType: (typeof mealTypes)[number];
  limit: number;
  salt: string;
};

export type EmergencyHandlerDeps = {
  authenticate(request: Request): Promise<{ userId: string }>;
  loadContext(userId: string, targetMemberIds: readonly string[]): Promise<EmergencyCurrentSafety>;
  loadPantryNames(userId: string, pantryItemIds: readonly string[]): Promise<readonly string[]>;
  /**
   * S2 bound fetch。省略時は空配列（単体テスト互換）。
   * 本番は list_active_shared_emergency_recipes を service_role で呼ぶ。
   * 例外時は呼び出し側が S1 のみで 200 に落とす。
   */
  listActiveSharedRecipes?(
    input: ListActiveSharedEmergencyRecipesInput,
  ): Promise<readonly SharedEmergencyListRow[]>;
};

/**
 * S1 Stage S → 空きがあれば S2 bound fetch → 再 Stage S（max = emergencyMaxCandidates）。
 * S2 例外・空は S1 結果のまま。current_safety_unavailable では S2 を呼ばない。
 */
async function resolveMultiSourceEmergencyMenus(input: {
  mealType: (typeof mealTypes)[number];
  mainIngredients: readonly string[];
  pantryNames: readonly string[];
  context: EmergencyCurrentSafety["context"];
  memberLabels: Readonly<Record<string, string>>;
  listActiveSharedRecipes: (
    input: ListActiveSharedEmergencyRecipesInput,
  ) => Promise<readonly SharedEmergencyListRow[]>;
  salt: string;
}): Promise<EmergencyMultiSourceFilterResult> {
  const maxCandidates = shareQuota.emergencyMaxCandidates;
  const s1Candidates = buildFixtureSourceCandidates();
  const filterInput = {
    mealType: input.mealType,
    mainIngredients: input.mainIngredients,
    pantryNames: input.pantryNames,
    context: input.context,
    memberLabels: input.memberLabels,
    maxCandidates,
  };

  const s1 = filterEmergencyMenuCandidates({
    ...filterInput,
    candidates: s1Candidates,
  });

  // 文脈ゲート失敗は community でも同じ結果。無駄な RPC を避ける
  if (s1.emptyReason === "current_safety_unavailable" || s1.emptyReason === "allergen_missing") {
    return s1;
  }

  // S1 が上限を埋めたら S2 を呼ばない
  if (s1.menus.length >= maxCandidates) {
    return s1;
  }

  let communityCandidates: EmergencySourceCandidate[] = [];
  try {
    const rows = await input.listActiveSharedRecipes({
      mealType: input.mealType,
      limit: shareQuota.sharePoolFetchLimit,
      salt: input.salt,
    });
    communityCandidates = mapSharedRowsToCommunityCandidates(rows, input.mealType);
  } catch {
    // S2 全体障害は S1 のみ 200（design §10.3）
    return s1;
  }

  if (communityCandidates.length === 0) {
    return s1;
  }

  return filterEmergencyMenuCandidates({
    ...filterInput,
    candidates: [...s1Candidates, ...communityCandidates],
  });
}

export function createEmergencyMenusHandler(deps: EmergencyHandlerDeps) {
  // 省略時は空プール（単体テスト互換）。常に deps 経由で呼び unbound-method を避ける。
  const listActiveSharedRecipes = (
    input: ListActiveSharedEmergencyRecipesInput,
  ): Promise<readonly SharedEmergencyListRow[]> => {
    if (deps.listActiveSharedRecipes === undefined) {
      return Promise.resolve([]);
    }
    return deps.listActiveSharedRecipes(input);
  };

  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET" && request.method !== "POST") {
      return methodNotAllowed(["GET", "POST"]);
    }
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    try {
      const url = new URL(request.url);
      // 製品経路は POST body。query の自由文は受理せず、基盤ログ残留を契約から外す。
      if (url.searchParams.has("mainIngredients")) {
        return invalidRequestFields({ mainIngredients: ["invalid"] });
      }

      let resolved: ResolvedEmergencyQuery;
      if (request.method === "POST") {
        const body = await parseJson(request, emergencyMenusRequestSchema);
        resolved = resolvedFromPostBody(body);
      } else {
        // ★ critical: URLSearchParams.get は欠落時 null。Zod .optional() は undefined のみ受理。
        // null を渡すと idea omit / targetMode omit が 400 になる。必ず ?? undefined する。
        const rawParsed = rawQuerySchema.safeParse({
          meal: url.searchParams.get("meal") ?? undefined,
          targetMode: url.searchParams.get("targetMode") ?? undefined,
          // キー未送出 → null → undefined（omit）
          // キーあり空文字 ?targetMemberIds= → ""（idea では 400。omit と混同しない）
          targetMemberIds: url.searchParams.get("targetMemberIds") ?? undefined,
          pantryItemIds: url.searchParams.get("pantryItemIds") ?? undefined,
        });
        if (!rawParsed.success) {
          // S8: Zod 既定 message を wire に出さない（parseJson の closedFieldErrors と対称）
          return json(400, {
            ok: false,
            error: {
              code: "invalid_request",
              message: "検索条件を確認してください",
              details: {
                fields: closedFieldErrors(z.flattenError(rawParsed.error).fieldErrors),
              },
            },
          });
        }

        const resolvedResult = resolveEmergencyQuery(rawParsed.data);
        if (!resolvedResult.ok) return resolvedResult.response;
        resolved = resolvedResult.value;
      }
      const mainIngredientCount = resolved.mainIngredients.length;

      const { userId } = await deps.authenticate(request);
      // pantry は path 共通: 所有者 pantry のみ（家族表を読まない）
      const pantryNames = await deps.loadPantryNames(userId, resolved.pantryItemIds);
      // salt はリクエスト単位で攪拌（newest 固定順へのフォールバックを避ける）
      const salt = requestId;

      if (resolved.targetMode === "idea") {
        // loadEmergencyInspectionSafety / loadContext 禁止（家族 current safety を読まない）
        const idea = buildIdeaPersonalSafetyContext();
        const filtered = await resolveMultiSourceEmergencyMenus({
          mealType: resolved.meal,
          mainIngredients: resolved.mainIngredients,
          pantryNames,
          context: idea.context,
          memberLabels: idea.memberLabels,
          listActiveSharedRecipes,
          salt,
        });
        if (
          filtered.emptyReason === "current_safety_unavailable" ||
          filtered.emptyReason === "allergen_missing"
        ) {
          // 到達しない想定のバグ。偽の 200 empty にしない。運用検知用に非PII だけ記録。
          safeLog({
            level: "error",
            requestId,
            code: "idea_emergency_current_safety_unavailable",
            durationMs: Date.now() - startedAt,
            path: "idea",
            matchMode: null,
            emptyReason: filtered.emptyReason,
            candidateCount: 0,
            mealType: resolved.meal,
            mainIngredientCount,
            sourceCounts: filtered.sourceCounts,
          });
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

        // 成功/空とも 1 回。食材名・アレルギー本文・contributor は載せない。
        safeLog({
          level: "info",
          requestId,
          code: "emergency_menus",
          durationMs: Date.now() - startedAt,
          path: "idea",
          matchMode: filtered.matchMode,
          emptyReason: filtered.emptyReason,
          candidateCount: candidates.length,
          mealType: resolved.meal,
          mainIngredientCount,
          sourceCounts: filtered.sourceCounts,
        });

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
      // PE9: targetMemberIds 改ざん・順序不一致は loadEmergencyInspectionSafety/validateSnapshot が
      // safetyUnavailable で閉じ、候補を偽 valid にしない（防衛確認・挙動変更なし）。
      // PE2: inspection は complete snapshot + draft 確認済み針。SQL は complete のまま。
      const loaded = await deps.loadContext(userId, resolved.targetMemberIds);
      const filtered = await resolveMultiSourceEmergencyMenus({
        mealType: resolved.meal,
        mainIngredients: resolved.mainIngredients,
        pantryNames,
        context: loaded.context,
        memberLabels: loaded.memberLabels,
        listActiveSharedRecipes,
        salt,
      });
      const candidates = filtered.menus.map((menu) =>
        buildEmergencyMenuCandidate({
          menu,
          context: loaded.context,
          memberLabels: loaded.memberLabels,
        }),
      );
      // household 専用のサーバ message 行列（UI banner の safety_only 文言は Task 5 で別）
      // PE6: emptyReason に応じて wire message を分岐（custom/unconfirmed を汎用 empty に溶かさない）
      const message =
        candidates.length === 0
          ? filtered.emptyReason === "allergen_missing"
            ? issueMessages.allergen_missing
            : filtered.emptyReason === "current_safety_unavailable"
              ? "アレルギー確認や食事条件のため、候補を表示できません"
              : "条件に合う緊急献立がありません"
          : filtered.matchMode === "safety_only"
            ? "メイン食材は一致しませんでした。安全条件に合う固定候補を表示しています"
            : "AIを使わない15分緊急献立です";

      safeLog({
        level: "info",
        requestId,
        code: "emergency_menus",
        durationMs: Date.now() - startedAt,
        path: "household",
        matchMode: filtered.matchMode,
        emptyReason: filtered.emptyReason,
        candidateCount: candidates.length,
        mealType: resolved.meal,
        mainIngredientCount,
        sourceCounts: filtered.sourceCounts,
      });

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

async function listActiveSharedRecipesFromAdmin(input: ListActiveSharedEmergencyRecipesInput) {
  const { data, error } = await getSupabaseAdmin().rpc("list_active_shared_emergency_recipes", {
    p_meal_type: input.mealType,
    p_limit: input.limit,
    p_salt: input.salt,
  });
  if (error !== null) {
    throw new Error("list_active_shared_emergency_recipes_failed");
  }
  const parsed = sharedEmergencyListResultSchema.safeParse(data ?? []);
  if (!parsed.success) {
    throw new Error("list_active_shared_emergency_recipes_invalid");
  }
  return parsed.data;
}

/**
 * PE4: 緊急候補の pantry スコア用名前。入力済み期限が todayJst より前の行は除外。
 * expires_on null はゲートしない（PE15 製品境界と同型）。
 */
export function pantryNamesForEmergencyScoring(
  rows: readonly { name: string; expires_on: string | null }[],
  todayJst: string,
): string[] {
  return rows
    .filter((row) => row.expires_on === null || row.expires_on >= todayJst)
    .map((row) => row.name);
}

/**
 * PE9: pantry select の error を空成功にしない。見つからない ID は data から落ちるだけ。
 */
export function pantryNamesFromSelectResult(
  result: {
    data: readonly { name: string; expires_on: string | null }[] | null;
    error: { message?: string } | null;
  },
  todayJst: string,
): string[] {
  if (result.error !== null) {
    throw new HttpError(500, "internal_error", issueMessages.internal_error);
  }
  return pantryNamesForEmergencyScoring(result.data ?? [], todayJst);
}

const handler = createEmergencyMenusHandler({
  authenticate: requireUser,
  loadContext: (userId, ids) => loadEmergencyInspectionSafety(getSupabaseAdmin(), userId, ids),
  loadPantryNames: async (userId, ids) => {
    if (ids.length === 0) return [];
    const { data, error } = await getSupabaseAdmin()
      .from("pantry_items")
      .select("name, expires_on")
      .eq("user_id", userId)
      .in("id", [...ids]);
    // 見つからない ID は黙って落とす。select error は空成功にせず fail-closed。
    return pantryNamesFromSelectResult({ data, error }, getJstDateKey(new Date()));
  },
  listActiveSharedRecipes: listActiveSharedRecipesFromAdmin,
});

export default handler;

export const config: Config = { path: "/api/emergency-menus", method: ["GET", "POST"] };
