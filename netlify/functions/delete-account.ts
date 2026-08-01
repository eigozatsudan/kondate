import { randomUUID } from "node:crypto";
import type { Config } from "@netlify/functions";
import type Stripe from "stripe";
import {
  deleteAccountRequestSchema,
  type DeleteAccountResult,
} from "../../shared/contracts/account.js";
import { requireUser } from "./_shared/auth.js";
import { getStripeClientFromEnv } from "./_shared/billing-stripe.js";
import { getServerEnv } from "./_shared/env.js";
import { handleError, HttpError, json, methodNotAllowed, parseJson } from "./_shared/http.js";
import { createSafeLogger, type SafeLogEvent } from "./_shared/logger.js";
import { getSupabaseAdmin, type AdminSupabaseClient } from "./_shared/supabase-admin.js";

/** Stripe 終端ステータス。これら以外の live/non-terminal を cancel 対象にする。 */
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(["canceled", "incomplete_expired"]);

/** 課金解約失敗で Auth 削除を止めるときのユーザー向け文言（PII・内部詳細なし）。 */
export const BILLING_CANCEL_BLOCKED_MESSAGE =
  "有料プランの解約が完了しませんでした。請求が続く可能性があるため、アカウントは削除していません。時間をおいてもう一度お試しください";

/**
 * Stripe cancel 成功後に Auth deleteUser だけ失敗したときの専用文言（AP1）。
 * fail-closed（Auth 未削除）は維持しつつ、解約が進んだ可能性を伝えて再試行を促す。
 */
export const ACCOUNT_DELETE_AFTER_BILLING_CANCEL_FAILED_MESSAGE =
  "有料プランの解約は完了した可能性がありますが、アカウント削除に失敗しました。時間をおいてもう一度削除を試してください";

export type DeleteAccountDeps = {
  authenticate: typeof requireUser;
  /** processing 予約を identity/global/quality から解放する（Auth 削除前） */
  releaseProcessingReservations: (userId: string) => Promise<{ error: { message: string } | null }>;
  /**
   * 未完了 flyer request の reserved 解放（helper 経由）。
   * 失敗しても Auth 削除は進める（best-effort）。
   */
  releaseFlyerProcessingReservations?: (
    userId: string,
  ) => Promise<{ error: { message: string } | null }>;
  /**
   * customer 単位で live subscription を cancel。
   * 失敗時は throw し、呼び出し側が Auth 削除を中止する（AP1 fail-closed）。
   */
  cancelBillingSubscriptions: (userId: string) => Promise<void>;
  /** 注入時は userId のみ。本番アダプタは Admin hard delete (shouldSoftDelete=false) を渡す。 */
  deleteUser: (userId: string) => Promise<{ error: { message: string } | null }>;
};

/**
 * 認証済み本人の Auth ユーザーを Admin API で hard delete する。
 * リクエスト body の user_id は契約外（無視）であり、削除対象は常に bearer の userId のみ。
 * Auth 削除前に processing 予約解放 → flyer reserved 解放 → Stripe live sub cancel を行う。
 * Stripe cancel が失敗した場合は Auth 削除しない（請求 orphan を優先して防ぐ）。
 */
export const createDeleteAccountHandler =
  (deps: DeleteAccountDeps) =>
  async (request: Request): Promise<Response> => {
    if (request.method !== "DELETE") return methodNotAllowed(["DELETE"]);
    try {
      const auth = await deps.authenticate(request);
      // 確認フレーズのみ検証。余分なキー（user_id 等）は Zod 既定で strip され削除対象に使わない。
      await parseJson(request, deleteAccountRequestSchema);
      const release = await deps.releaseProcessingReservations(auth.userId);
      if (release.error) {
        throw new HttpError(
          503,
          "account_delete_failed",
          "削除できませんでした。時間をおいてもう一度お試しください",
        );
      }
      // 未完了 flyer の reserved は helper で解放（失敗しても Auth 削除は止めない）
      // 返却 error だけでなく promise reject も best-effort として隔離する。
      if (deps.releaseFlyerProcessingReservations !== undefined) {
        try {
          await deps.releaseFlyerProcessingReservations(auth.userId);
        } catch {
          // flyer 解放失敗は Auth 削除を阻害しない
        }
      }
      // AP1: Stripe cancel 失敗時は Auth 削除を中止（請求 orphan を優先して防ぐ）
      try {
        await deps.cancelBillingSubscriptions(auth.userId);
      } catch {
        throw new HttpError(503, "billing_cancel_failed", BILLING_CANCEL_BLOCKED_MESSAGE);
      }
      const { error } = await deps.deleteUser(auth.userId);
      if (error) {
        // AP1: cancel 成功後の Auth 失敗を汎用 account_delete_failed に潰さない。
        // 請求 orphan は避け済みなので再試行で delete だけ通せば復旧できる。
        throw new HttpError(
          503,
          "account_delete_after_billing_cancel_failed",
          ACCOUNT_DELETE_AFTER_BILLING_CANCEL_FAILED_MESSAGE,
        );
      }
      return json<DeleteAccountResult>(200, { ok: true, data: { deleted: true } });
    } catch (error) {
      return handleError(error);
    }
  };

/**
 * customer の全 subscription を list し、live/non-terminal を cancel する。
 * DB の billing_subscriptions 1 行だけに依存しない（二重 sub 残差を取りこぼさない）。
 * 失敗は throw（呼び出し側が Auth 削除を fail-closed で止める）。部分失敗も最後に throw。
 */
export async function cancelAllLiveSubscriptionsForUser(options: {
  userId: string;
  admin: Pick<AdminSupabaseClient, "rpc">;
  stripe: Pick<Stripe, "subscriptions"> | null;
  log: (event: SafeLogEvent) => void;
  requestId: string;
  startedAt: number;
}): Promise<void> {
  const { userId, admin, stripe, log, requestId, startedAt } = options;

  let data: unknown;
  try {
    const result = await admin.rpc("get_billing_customer_by_user", {
      p_user_id: userId,
    });
    if (result.error !== null) {
      log({
        level: "warn",
        requestId,
        code: "billing_cancel_failed",
        durationMs: Date.now() - startedAt,
      });
      throw new Error("billing_customer_lookup_failed");
    }
    data = result.data;
  } catch (error) {
    if (error instanceof Error && error.message === "billing_customer_lookup_failed") {
      throw error;
    }
    // RPC 自体の throw
    log({
      level: "warn",
      requestId,
      code: "billing_cancel_failed",
      durationMs: Date.now() - startedAt,
    });
    throw new Error("billing_customer_lookup_failed");
  }

  const customerId =
    data !== null && typeof data === "object"
      ? (data as { stripe_customer_id?: unknown }).stripe_customer_id
      : undefined;
  if (typeof customerId !== "string" || customerId.length === 0) {
    // billing customer なし → Stripe 操作なし（Free 利用者）
    return;
  }

  // customer があるのに Stripe クライアントが無いと live sub を触れない → fail-closed
  if (stripe === null) {
    log({
      level: "warn",
      requestId,
      code: "billing_cancel_failed",
      durationMs: Date.now() - startedAt,
      stripeCustomerId: customerId,
    });
    throw new Error("stripe_client_unavailable");
  }

  let subscriptions: Stripe.Subscription[];
  try {
    // U1-M5: limit 100 の1ページでは取り切れない病理ケースに備え、has_more まで辿る。
    // status: "all" で terminal 含む全件を取得し、live のみ cancel（Issue 4）
    subscriptions = [];
    let startingAfter: string | undefined;
    for (;;) {
      const listed = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
        ...(startingAfter === undefined ? {} : { starting_after: startingAfter }),
      });
      subscriptions.push(...listed.data);
      if (!listed.has_more || listed.data.length === 0) break;
      const last = listed.data[listed.data.length - 1];
      if (last === undefined) break;
      startingAfter = last.id;
    }
  } catch {
    log({
      level: "warn",
      requestId,
      code: "billing_cancel_failed",
      durationMs: Date.now() - startedAt,
      stripeCustomerId: customerId,
    });
    throw new Error("stripe_subscription_list_failed");
  }

  let cancelFailed = false;
  for (const sub of subscriptions) {
    if (TERMINAL_SUBSCRIPTION_STATUSES.has(sub.status)) {
      continue;
    }
    try {
      await stripe.subscriptions.cancel(sub.id);
    } catch {
      // 部分失敗でも残りを試行。いずれか失敗したら最終的に throw（Auth 削除しない）
      cancelFailed = true;
      log({
        level: "warn",
        requestId,
        code: "billing_cancel_failed",
        durationMs: Date.now() - startedAt,
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
      });
    }
  }
  if (cancelFailed) {
    throw new Error("stripe_subscription_cancel_failed");
  }
}

/**
 * 未完了 flyer の reserved 解放口（best-effort）。
 * public.release_flyer_weekly_for_user_processing で processing 行を解放し、
 * identity 週次台帳の reserved だけ戻す（success/sent は残す）。
 * 失敗しても Auth 削除は進める（BEFORE DELETE トリガが CASCADE 時の第二経路）。
 */
async function releaseFlyerBestEffort(
  userId: string,
): Promise<{ error: { message: string } | null }> {
  const { error } = await getSupabaseAdmin().rpc("release_flyer_weekly_for_user_processing", {
    p_user_id: userId,
  });
  return { error: error === null ? null : { message: error.message } };
}

export default async function deleteAccount(request: Request): Promise<Response> {
  const env = getServerEnv();
  const startedAt = Date.now();
  const requestId = randomUUID();
  const log = createSafeLogger();
  const stripeClient = getStripeClientFromEnv(env);

  return createDeleteAccountHandler({
    authenticate: requireUser,
    releaseProcessingReservations: async (userId) => {
      const { error } = await getSupabaseAdmin().rpc(
        "release_identity_and_global_for_user_processing",
        { p_user_id: userId },
      );
      return { error: error === null ? null : { message: error.message } };
    },
    releaseFlyerProcessingReservations: releaseFlyerBestEffort,
    cancelBillingSubscriptions: async (userId) => {
      await cancelAllLiveSubscriptionsForUser({
        userId,
        admin: getSupabaseAdmin(),
        stripe: stripeClient,
        log,
        requestId,
        startedAt,
      });
    },
    // false = hard delete（soft delete ではなく Auth ユーザーを完全削除）
    deleteUser: async (userId) => getSupabaseAdmin().auth.admin.deleteUser(userId, false),
  })(request);
}

export const config: Config = { path: "/api/account" };
