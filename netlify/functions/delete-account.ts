import { randomUUID } from "node:crypto";
import type { Config } from "@netlify/functions";
import type Stripe from "stripe";
import {
  deleteAccountRequestSchema,
  type DeleteAccountResult,
} from "../../shared/contracts/account.js";
import { FUNCTION_TOTAL_BUDGET_MS } from "../../shared/contracts/function-budget.js";
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
 * AP3: cancel 実副作用が無かった場合は使わない（Free / live sub 0 は汎用文言）。
 */
export const ACCOUNT_DELETE_AFTER_BILLING_CANCEL_FAILED_MESSAGE =
  "有料プランの解約は完了した可能性がありますが、アカウント削除に失敗しました。時間をおいてもう一度削除を試してください";

/** Auth 削除失敗の汎用文言（cancel 実副作用なし）。 */
export const ACCOUNT_DELETE_FAILED_MESSAGE =
  "削除できませんでした。時間をおいてもう一度お試しください";

/**
 * AP1: 同一 user の並行 DELETE が進行中のときの文言。
 * 二重 cancel / deleteUser を避け、先勝ち完了後の再試行を促す。
 */
export const ACCOUNT_DELETE_IN_PROGRESS_MESSAGE =
  "削除処理が進行中です。完了するまでお待ちいただき、画面を更新してからもう一度お試しください";

/**
 * AP1: delete lock TTL。Function 総予算 + platform headroom を覆い、
 * 途中 abort 後の再入場が過早に第二 cancel を始めないようにする。
 */
export const ACCOUNT_DELETE_LOCK_TTL_MS = FUNCTION_TOTAL_BUDGET_MS + 10_000;

/**
 * cancel 結果。AP3: live sub を 1 件でも cancel 成功したときだけ
 * account_delete_after_billing_cancel_failed を返す根拠にする。
 */
export type CancelBillingResult = {
  cancelledLiveSubscription: boolean;
};

/**
 * AP11: Stripe list の最大ページ数。limit 100 × 本値。
 * 病理的 has_more 永続で Function 壁時計まで回らないよう上限を置く。
 */
export const MAX_STRIPE_SUBSCRIPTION_LIST_PAGES = 10;

/**
 * AP13: billing cancel（list + cancel ループ）の壁時計上限。
 * Function 総予算と同一（platform 60s の内側）。超過時は Auth 削除前に fail-closed。
 * リテラルミラー禁止 — function-budget 正本から re-export。
 */
export const ACCOUNT_DELETE_BILLING_CANCEL_BUDGET_MS = FUNCTION_TOTAL_BUDGET_MS;

/** list/cancel の各ステップ前に壁時計を検査する（AP13） */
function assertWithinBillingCancelBudget(startedAt: number): void {
  if (Date.now() - startedAt >= ACCOUNT_DELETE_BILLING_CANCEL_BUDGET_MS) {
    throw new Error("stripe_billing_cancel_budget_exceeded");
  }
}

export type DeleteAccountDeps = {
  authenticate: typeof requireUser;
  /**
   * AP1: 同一 user の並行 DELETE を user 単位 TTL lock で直列化する。
   * 未注入時は no-op（単体テスト互換）。本番 default は RPC を配線する。
   */
  acquireDeleteLock?: (
    userId: string,
    lockToken: string,
    expiresAtIso: string,
  ) => Promise<{ ok: true } | { ok: false; code: "account_delete_in_progress" | "lock_failed" }>;
  /** AP1: 失敗経路で lock を解放。成功時は Auth CASCADE で行消滅し得る。 */
  releaseDeleteLock?: (userId: string, lockToken: string) => Promise<void>;
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
   * customer 単位で open Checkout Session を expire し、live subscription を cancel。
   * 失敗時は throw し、呼び出し側が Auth 削除を中止する（AP1/AP2 fail-closed）。
   * 戻り値は cancel 実副作用の有無（AP3）。expire だけでは true にしない。
   */
  cancelBillingSubscriptions: (userId: string) => Promise<CancelBillingResult>;
  /** 注入時は userId のみ。本番アダプタは Admin hard delete (shouldSoftDelete=false) を渡す。 */
  deleteUser: (userId: string) => Promise<{ error: { message: string } | null }>;
};

/**
 * 認証済み本人の Auth ユーザーを Admin API で hard delete する。
 * リクエスト body の user_id は契約外（無視）であり、削除対象は常に bearer の userId のみ。
 * Auth 削除前に processing 予約解放 → flyer reserved 解放 →
 * open Checkout Session expire + Stripe live sub cancel を行う。
 * expire / cancel が失敗した場合は Auth 削除しない（請求 orphan を優先して防ぐ）。
 * Stripe Customer は税務・請求記録のため残す。open Session だけ閉じる。
 * AP1: 同一 user の並行 DELETE は acquireDeleteLock で serialize（client abort ≠ server 完了）。
 */
export const createDeleteAccountHandler =
  (deps: DeleteAccountDeps) =>
  async (request: Request): Promise<Response> => {
    if (request.method !== "DELETE") return methodNotAllowed(["DELETE"]);
    let lockHeld: { userId: string; lockToken: string } | null = null;
    let deleteSucceeded = false;
    try {
      const auth = await deps.authenticate(request);
      // 確認フレーズのみ検証。余分なキー（user_id 等）は Zod 既定で strip され削除対象に使わない。
      await parseJson(request, deleteAccountRequestSchema);

      // AP1: cancel/delete の前に user 単位 lock。進行中は 409 で再試行を促す。
      if (deps.acquireDeleteLock !== undefined) {
        const lockToken = randomUUID();
        const expiresAtIso = new Date(Date.now() + ACCOUNT_DELETE_LOCK_TTL_MS).toISOString();
        const acquired = await deps.acquireDeleteLock(auth.userId, lockToken, expiresAtIso);
        if (!acquired.ok) {
          if (acquired.code === "account_delete_in_progress") {
            throw new HttpError(
              409,
              "account_delete_in_progress",
              ACCOUNT_DELETE_IN_PROGRESS_MESSAGE,
            );
          }
          throw new HttpError(503, "account_delete_failed", ACCOUNT_DELETE_FAILED_MESSAGE);
        }
        lockHeld = { userId: auth.userId, lockToken };
      }

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
      // AP1/AP2: Stripe expire/cancel 失敗時は Auth 削除を中止（請求 orphan を優先して防ぐ）
      let cancelResult: CancelBillingResult = { cancelledLiveSubscription: false };
      try {
        cancelResult = await deps.cancelBillingSubscriptions(auth.userId);
      } catch {
        throw new HttpError(503, "billing_cancel_failed", BILLING_CANCEL_BLOCKED_MESSAGE);
      }
      const { error } = await deps.deleteUser(auth.userId);
      if (error) {
        // AP3: live sub を実際に cancel したときだけ「解約は完了した可能性」文言を出す。
        // Free / customer 無し / live sub 0 の no-op 後は汎用文言（誤認防止）。
        if (cancelResult.cancelledLiveSubscription) {
          throw new HttpError(
            503,
            "account_delete_after_billing_cancel_failed",
            ACCOUNT_DELETE_AFTER_BILLING_CANCEL_FAILED_MESSAGE,
          );
        }
        throw new HttpError(503, "account_delete_failed", ACCOUNT_DELETE_FAILED_MESSAGE);
      }
      // 成功時は Auth CASCADE で lock 行も消える想定。明示 release は不要。
      deleteSucceeded = true;
      lockHeld = null;
      return json<DeleteAccountResult>(200, { ok: true, data: { deleted: true } });
    } catch (error) {
      return handleError(error);
    } finally {
      // AP1: 失敗経路だけ lock を解放し、再試行を許可する（成功は CASCADE / null 化済み）
      if (!deleteSucceeded && lockHeld !== null && deps.releaseDeleteLock !== undefined) {
        try {
          await deps.releaseDeleteLock(lockHeld.userId, lockHeld.lockToken);
        } catch {
          // release 失敗は TTL で回収。Auth 成否は既に確定している。
        }
      }
    }
  };

/**
 * 削除時の Stripe 面。live sub cancel に加え、未完了 Checkout を expire する（AP2）。
 * Customer 作成・Price・host は触らない。
 */
export type DeleteAccountStripeClient = Pick<Stripe, "subscriptions" | "checkout">;

/**
 * AP2: customer の status=open な Checkout Session を辿って expire する。
 * Checkout 作成側と同型の list(status=open)+expire。完了済みは list に出ない。
 * list / expire 失敗は fail-closed（Auth 削除前）。部分 expire 失敗は残りを試して最後に throw。
 * ページ上限は subscription list と同じ（病理 has_more で壁時計を食わない）。
 */
async function expireOpenCheckoutSessionsForDelete(options: {
  customerId: string;
  stripe: DeleteAccountStripeClient;
  log: (event: SafeLogEvent) => void;
  requestId: string;
  startedAt: number;
}): Promise<void> {
  const { customerId, stripe, log, requestId, startedAt } = options;
  let startingAfter: string | undefined;
  let pageCount = 0;
  let expireFailed = false;

  for (;;) {
    pageCount += 1;
    if (pageCount > MAX_STRIPE_SUBSCRIPTION_LIST_PAGES) {
      log({
        level: "warn",
        requestId,
        code: "billing_cancel_failed",
        durationMs: Date.now() - startedAt,
        stripeCustomerId: customerId,
      });
      throw new Error("stripe_checkout_session_list_page_limit");
    }

    let listed: Stripe.ApiList<Stripe.Checkout.Session>;
    try {
      // AP13: ページ取得前に壁時計。遅延 list で Auth 削除前に platform を食わない
      assertWithinBillingCancelBudget(startedAt);
      listed = await stripe.checkout.sessions.list({
        customer: customerId,
        status: "open",
        limit: 100,
        ...(startingAfter === undefined ? {} : { starting_after: startingAfter }),
      });
    } catch (error) {
      if (error instanceof Error && error.message === "stripe_billing_cancel_budget_exceeded") {
        log({
          level: "warn",
          requestId,
          code: "billing_cancel_failed",
          durationMs: Date.now() - startedAt,
          stripeCustomerId: customerId,
        });
        throw error;
      }
      log({
        level: "warn",
        requestId,
        code: "billing_cancel_failed",
        durationMs: Date.now() - startedAt,
        stripeCustomerId: customerId,
      });
      throw new Error("stripe_checkout_session_list_failed");
    }

    for (const session of listed.data) {
      if (typeof session.id !== "string" || session.id.length === 0) continue;
      try {
        assertWithinBillingCancelBudget(startedAt);
        await stripe.checkout.sessions.expire(session.id);
      } catch (error) {
        if (error instanceof Error && error.message === "stripe_billing_cancel_budget_exceeded") {
          log({
            level: "warn",
            requestId,
            code: "billing_cancel_failed",
            durationMs: Date.now() - startedAt,
            stripeCustomerId: customerId,
          });
          throw error;
        }
        expireFailed = true;
        log({
          level: "warn",
          requestId,
          code: "billing_cancel_failed",
          durationMs: Date.now() - startedAt,
          stripeCustomerId: customerId,
        });
      }
    }

    if (!listed.has_more || listed.data.length === 0) {
      break;
    }
    const last = listed.data[listed.data.length - 1];
    if (last === undefined || typeof last.id !== "string" || last.id.length === 0) {
      break;
    }
    startingAfter = last.id;
  }

  if (expireFailed) {
    throw new Error("stripe_checkout_session_expire_failed");
  }
}

/**
 * customer の open Checkout Session を expire してから、
 * 全 subscription を list し live/non-terminal を cancel する。
 * DB の billing_subscriptions 1 行だけに依存しない（二重 sub 残差を取りこぼさない）。
 * 失敗は throw（呼び出し側が Auth 削除を fail-closed で止める）。部分失敗も最後に throw。
 * AP2: 手元の Checkout URL 完了で孤児 subscription が立つのを防ぐ。Customer は残す。
 */
export async function cancelAllLiveSubscriptionsForUser(options: {
  userId: string;
  admin: Pick<AdminSupabaseClient, "rpc">;
  stripe: DeleteAccountStripeClient | null;
  log: (event: SafeLogEvent) => void;
  requestId: string;
  startedAt: number;
}): Promise<CancelBillingResult> {
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
    // billing customer なし → Stripe 操作なし（Free 利用者 / AP3）
    return { cancelledLiveSubscription: false };
  }

  // customer があるのに Stripe クライアントが無いと live sub / open Session を触れない → fail-closed
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

  // AP2: live sub cancel より先に open Checkout を閉じる。
  // 手元 URL 完了で削除後に孤児 subscription が立つのを防ぐ。Customer は残す。
  await expireOpenCheckoutSessionsForDelete({
    customerId,
    stripe,
    log,
    requestId,
    startedAt,
  });

  let subscriptions: Stripe.Subscription[];
  try {
    // U1-M5: limit 100 の1ページでは取り切れない病理ケースに備え、has_more まで辿る。
    // status: "all" で terminal 含む全件を取得し、live のみ cancel（Issue 4）
    // AP11: ページ上限を超えたら fail-closed（無限 list で Function 壁時計を食わない）
    subscriptions = [];
    let startingAfter: string | undefined;
    let pageCount = 0;
    for (;;) {
      pageCount += 1;
      if (pageCount > MAX_STRIPE_SUBSCRIPTION_LIST_PAGES) {
        log({
          level: "warn",
          requestId,
          code: "billing_cancel_failed",
          durationMs: Date.now() - startedAt,
          stripeCustomerId: customerId,
        });
        throw new Error("stripe_subscription_list_page_limit");
      }
      // AP13: ページ取得前に壁時計。遅延 list で Auth 削除前に platform を食わない
      assertWithinBillingCancelBudget(startedAt);
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
  } catch (error) {
    if (error instanceof Error && error.message === "stripe_subscription_list_page_limit") {
      throw error;
    }
    if (error instanceof Error && error.message === "stripe_billing_cancel_budget_exceeded") {
      log({
        level: "warn",
        requestId,
        code: "billing_cancel_failed",
        durationMs: Date.now() - startedAt,
        stripeCustomerId: customerId,
      });
      throw error;
    }
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
  let cancelledLiveSubscription = false;
  for (const sub of subscriptions) {
    if (TERMINAL_SUBSCRIPTION_STATUSES.has(sub.status)) {
      continue;
    }
    try {
      // AP13: cancel 前に壁時計。遅延 multi-sub cancel で Auth 削除を失わない
      assertWithinBillingCancelBudget(startedAt);
      await stripe.subscriptions.cancel(sub.id);
      cancelledLiveSubscription = true;
    } catch (error) {
      if (error instanceof Error && error.message === "stripe_billing_cancel_budget_exceeded") {
        // 予算超過は即 fail-closed（残り cancel を続けて壁時計を食い潰さない）
        log({
          level: "warn",
          requestId,
          code: "billing_cancel_failed",
          durationMs: Date.now() - startedAt,
          stripeCustomerId: customerId,
          stripeSubscriptionId: sub.id,
        });
        throw error;
      }
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
  return { cancelledLiveSubscription };
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
    // AP1: 並行 DELETE を private.account_delete_locks で serialize
    acquireDeleteLock: async (userId, lockToken, expiresAtIso) => {
      const { data, error } = await getSupabaseAdmin().rpc("acquire_account_delete_lock", {
        p_user_id: userId,
        p_lock_token: lockToken,
        p_expires_at: expiresAtIso,
      });
      if (error !== null || data === null || typeof data !== "object") {
        return { ok: false, code: "lock_failed" };
      }
      const payload = data as { ok?: unknown; failure_code?: unknown };
      if (payload.ok === true) return { ok: true };
      if (payload.failure_code === "account_delete_in_progress") {
        return { ok: false, code: "account_delete_in_progress" };
      }
      return { ok: false, code: "lock_failed" };
    },
    releaseDeleteLock: async (userId, lockToken) => {
      await getSupabaseAdmin().rpc("release_account_delete_lock", {
        p_user_id: userId,
        p_lock_token: lockToken,
      });
    },
    releaseProcessingReservations: async (userId) => {
      const { error } = await getSupabaseAdmin().rpc(
        "release_identity_and_global_for_user_processing",
        { p_user_id: userId },
      );
      return { error: error === null ? null : { message: error.message } };
    },
    releaseFlyerProcessingReservations: releaseFlyerBestEffort,
    cancelBillingSubscriptions: async (userId) =>
      cancelAllLiveSubscriptionsForUser({
        userId,
        admin: getSupabaseAdmin(),
        stripe: stripeClient,
        log,
        requestId,
        startedAt,
      }),
    // false = hard delete（soft delete ではなく Auth ユーザーを完全削除）
    deleteUser: async (userId) => getSupabaseAdmin().auth.admin.deleteUser(userId, false),
  })(request);
}

export const config: Config = { path: "/api/account" };
