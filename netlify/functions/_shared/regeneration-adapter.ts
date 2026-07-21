import { z } from "zod";
import {
  plannerSubmissionSchema,
  type PlannerSubmission,
} from "../../../shared/contracts/planner.js";
import type { GenerationContext } from "../../../shared/safety/generation-context.js";
import { getJstDateKey } from "../../../shared/time/jst.js";
import type { AuthenticatedUser } from "./generation-repository.js";
import { validateTransientChecks } from "./generation-context.js";
import { HttpError } from "./http.js";
import type { LoaderDeps } from "./regeneration-context.js";
import { buildStoredGenerationContext } from "./revalidation-adapter.js";
import { loadStoredMenu, type StoredMenuAggregate } from "./stored-menu-loader.js";
import { getSupabaseAdmin } from "./supabase-admin.js";
import { createUserScopedSupabase } from "./supabase-user.js";

/** preference_snapshot は targetMemberIds を現行の生存リンクで上書きする */
const savedPreferenceSchema = plannerSubmissionSchema.omit({ targetMemberIds: true }).strict();

/**
 * JWT 所有者クライアントで source / group / recent を読み、
 * 現行 safety だけ admin で loadCurrentSafetyContext する LoaderDeps を構築する。
 * requestStartedAtMonotonicMs は handler 入口の値をそのままコピーし、再計測しない。
 */
export function createRegenerationLoaderDeps(
  user: AuthenticatedUser,
  timing: { requestStartedAtMonotonicMs: number },
): LoaderDeps {
  const ownerClient = createUserScopedSupabase(user.accessToken);

  const loadSource = async (
    authenticated: AuthenticatedUser,
    menuId: string,
  ): Promise<StoredMenuAggregate> => {
    // 所有権は user_id 一致の owner クエリのみで証明する
    return loadStoredMenu(ownerClient, authenticated.userId, menuId);
  };

  const loadGroup = async (
    authenticated: AuthenticatedUser,
    groupId: string,
  ): Promise<readonly StoredMenuAggregate[]> => {
    const { data, error } = await ownerClient
      .from("menus")
      .select("id")
      .eq("user_id", authenticated.userId)
      .eq("derivation_group_id", groupId);
    if (error !== null) {
      throw new HttpError(503, "menu_load_failed", "献立を読み込めませんでした");
    }
    return Promise.all(
      data.map((row) => loadStoredMenu(ownerClient, authenticated.userId, row.id)),
    );
  };

  const loadRecent = async (
    authenticated: AuthenticatedUser,
    limit: number,
  ): Promise<readonly StoredMenuAggregate[]> => {
    const { data, error } = await ownerClient
      .from("menus")
      .select("id")
      .eq("user_id", authenticated.userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error !== null) {
      throw new HttpError(503, "menu_load_failed", "献立を読み込めませんでした");
    }
    return Promise.all(
      data.map((row) => loadStoredMenu(ownerClient, authenticated.userId, row.id)),
    );
  };

  const buildCurrentContext = async (input: {
    user: AuthenticatedUser;
    stored: StoredMenuAggregate;
    idempotencyKey: string;
    expiredPantryConfirmations: LoaderDeps["buildCurrentContext"] extends (arg: infer A) => unknown
      ? A extends { expiredPantryConfirmations: infer E }
        ? E
        : never
      : never;
    now: Date;
  }): Promise<GenerationContext> => {
    if (input.stored.targetMemberIds.length === 0) {
      throw new HttpError(
        422,
        "current_target_member_required",
        "現在の家族を1人以上選んでください",
      );
    }

    // admin は所有権が証明された後の現行 safety 読みに限定する
    const admin = getSupabaseAdmin();
    // pantry / preference 行は Task 3 の owner-scoped 構築を再利用
    const base = await buildStoredGenerationContext({
      ownerClient,
      admin,
      stored: input.stored,
      userId: input.user.userId,
      idempotencyKey: input.idempotencyKey,
    });

    // 保存済み preference を閉じたスキーマで読み、生存 target だけを差し込む
    let submission: PlannerSubmission;
    try {
      submission = plannerSubmissionSchema.parse({
        ...savedPreferenceSchema.parse(input.stored.preferenceSnapshot),
        targetMemberIds: [...input.stored.targetMemberIds],
      });
    } catch {
      // snapshot が不完全な場合は menu メタ + 空 preferences の base.submission を使う
      submission = plannerSubmissionSchema.parse({
        ...base.submission,
        targetMemberIds: [...input.stored.targetMemberIds],
      });
    }

    // pantry は submission の選択を正に再読込（base は usage 由来で不足し得る）
    const pantryItemIds = submission.pantrySelections.map((item) => item.pantryItemId);
    let pantryItems = base.pantryItems;
    if (pantryItemIds.length > 0) {
      const { data, error } = await ownerClient
        .from("pantry_items")
        .select(
          "id,user_id,name,quantity,unit,expires_on,expiration_type,opened_state,created_at,updated_at",
        )
        .eq("user_id", input.user.userId)
        .in("id", pantryItemIds);
      if (error === null) {
        pantryItems = data.map((row) => ({
          id: row.id,
          userId: row.user_id,
          name: row.name,
          quantity: row.quantity,
          unit: row.unit,
          expiresOn: row.expires_on,
          expirationType:
            row.expiration_type === "use_by" ||
            row.expiration_type === "best_before" ||
            row.expiration_type === "other" ||
            row.expiration_type === "unknown"
              ? row.expiration_type
              : null,
          openedState:
            row.opened_state === "unopened" ||
            row.opened_state === "opened" ||
            row.opened_state === "unknown"
              ? row.opened_state
              : null,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));
      }
    }

    // 期限切れ確認はコマンドの新規収集分のみ（古い確認を持ち込まない）
    const today = getJstDateKey(input.now);
    const expiredSelectedIds = submission.pantrySelections
      .filter((selection) => {
        const item = pantryItems.find((candidate) => candidate.id === selection.pantryItemId);
        return item !== undefined && item.expiresOn !== null && item.expiresOn < today;
      })
      .map((selection) => selection.pantryItemId);
    const expiredPantryChecks = validateTransientChecks(
      input.expiredPantryConfirmations,
      submission.pantrySelections.map((item) => item.pantryItemId),
      expiredSelectedIds,
      input.now,
    );

    // 現行 safety は loadCurrentSafetyContext 経由で base に既に入っている
    //（buildStoredGenerationContext が admin 呼び出し済み）
    return {
      ...base,
      submission,
      pantryItems,
      expiredPantryChecks,
      idempotencyKey: input.idempotencyKey,
      preferenceSnapshot: z
        .record(z.string(), z.unknown())
        .parse(
          typeof input.stored.preferenceSnapshot === "object" &&
            input.stored.preferenceSnapshot !== null
            ? input.stored.preferenceSnapshot
            : {},
        ),
      // 履歴 safety_snapshot は validator 入力に載せない
      safetySnapshot: {},
    };
  };

  return {
    loadSource,
    loadGroup,
    loadRecent,
    buildCurrentContext,
    requestStartedAtMonotonicMs: timing.requestStartedAtMonotonicMs,
    now: () => new Date(),
    monotonicNow: () => performance.now(),
  };
}
