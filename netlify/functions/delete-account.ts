import { randomUUID } from "node:crypto";
import type { Config } from "@netlify/functions";
import type Stripe from "stripe";
import {
  deleteAccountRequestSchema,
  type DeleteAccountResult,
} from "../../shared/contracts/account.js";
import { requireUser } from "./_shared/auth.js";
import { createStripeClient } from "./_shared/billing-stripe.js";
import { getServerEnv } from "./_shared/env.js";
import { handleError, HttpError, json, methodNotAllowed, parseJson } from "./_shared/http.js";
import { createSafeLogger, type SafeLogEvent } from "./_shared/logger.js";
import { getSupabaseAdmin, type AdminSupabaseClient } from "./_shared/supabase-admin.js";

/** Stripe 終端ステータス。これら以外の live/non-terminal を cancel 対象にする。 */
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(["canceled", "incomplete_expired"]);

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
   * customer 単位で live subscription を best-effort cancel。
   * 失敗しても Auth 削除へ進む。
   */
  cancelBillingSubscriptions: (userId: string) => Promise<void>;
  /** 注入時は userId のみ。本番アダプタは Admin hard delete (shouldSoftDelete=false) を渡す。 */
  deleteUser: (userId: string) => Promise<{ error: { message: string } | null }>;
};

/**
 * 認証済み本人の Auth ユーザーを Admin API で hard delete する。
 * リクエスト body の user_id は契約外（無視）であり、削除対象は常に bearer の userId のみ。
 * Auth 削除前に processing 予約解放 → flyer reserved 解放 → Stripe live sub cancel を行う。
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
      if (deps.releaseFlyerProcessingReservations !== undefined) {
        await deps.releaseFlyerProcessingReservations(auth.userId);
      }
      // Stripe cancel は best-effort。成否にかかわらず Auth delete へ進む
      await deps.cancelBillingSubscriptions(auth.userId);
      const { error } = await deps.deleteUser(auth.userId);
      if (error) {
        throw new HttpError(
          503,
          "account_delete_failed",
          "削除できませんでした。時間をおいてもう一度お試しください",
        );
      }
      return json<DeleteAccountResult>(200, { ok: true, data: { deleted: true } });
    } catch (error) {
      return handleError(error);
    }
  };

/**
 * customer の全 subscription を list し、live/non-terminal を best-effort cancel する。
 * DB の billing_subscriptions 1 行だけに依存しない（二重 sub 残差を取りこぼさない）。
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
  if (stripe === null) {
    // 鍵なし / kill かつ未設定: Stripe 操作をスキップ
    return;
  }

  const { data, error } = await admin.rpc("get_billing_customer_by_user", {
    p_user_id: userId,
  });
  if (error !== null) {
    // customer 解決失敗でも Auth 削除は進める
    log({
      level: "warn",
      requestId,
      code: "billing_cancel_failed",
      durationMs: Date.now() - startedAt,
    });
    return;
  }

  const customerId =
    data !== null && typeof data === "object"
      ? (data as { stripe_customer_id?: unknown }).stripe_customer_id
      : undefined;
  if (typeof customerId !== "string" || customerId.length === 0) {
    // billing customer なし → Stripe 操作なし
    return;
  }

  let subscriptions: Stripe.Subscription[];
  try {
    // status: "all" で terminal 含む全件を取得し、live のみ cancel（Issue 4）
    const listed = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });
    subscriptions = listed.data;
  } catch {
    log({
      level: "warn",
      requestId,
      code: "billing_cancel_failed",
      durationMs: Date.now() - startedAt,
      stripeCustomerId: customerId,
    });
    return;
  }

  for (const sub of subscriptions) {
    if (TERMINAL_SUBSCRIPTION_STATUSES.has(sub.status)) {
      continue;
    }
    try {
      await stripe.subscriptions.cancel(sub.id);
    } catch {
      // 部分失敗でも残りを試行。opaque id のみログ（email 禁止）
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
}

/**
 * 未完了 flyer の reserved 解放口。
 * public 一括 RPC は未提供のため現状 no-op。
 * quality は release_identity → release_request_quota_reservations で対称解放済み。
 * flyer の stale は cleanup_stale_flyer_weekly_batch、Auth CASCADE で request 行は消える。
 */
function releaseFlyerBestEffort(userId: string): Promise<{ error: null }> {
  // public 一括 RPC が無い間は no-op。署名だけ userId を受け取り将来差し替え可能にする。
  void userId;
  return Promise.resolve({ error: null });
}

export default async function deleteAccount(request: Request): Promise<Response> {
  const env = getServerEnv();
  const startedAt = Date.now();
  const requestId = randomUUID();
  const log = createSafeLogger();
  const stripeClient = env.stripe === undefined ? null : createStripeClient(env.stripe.secretKey);

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
