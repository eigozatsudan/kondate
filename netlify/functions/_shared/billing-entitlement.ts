import { z } from "zod";
import type { EntitlementData } from "../../../shared/contracts/billing.js";
import { planQuota, type PlanCode } from "../../../shared/contracts/plan-quota.js";
import { getSupabaseAdmin } from "./supabase-admin.js";

export type BillingSubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

export type Entitlement = {
  plan: PlanCode;
  status: "none" | BillingSubscriptionStatus;
  plusEntitled: boolean;
  pastDueGrace: boolean;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: string | null;
  dbPlusEntitled: boolean;
  /** RPC の past_due_since。kill 復元で past_due grace を再計算する */
  pastDueSince?: string | null;
  /**
   * kill 中に unpaid へ落としたときの元 status。
   * B2: 読取側は Stripe 未検証のため elevation に使わない。webhook / reconcile 待ち。
   */
  killSourceStatus?: BillingSubscriptionStatus | null;
};

/** past_due 猶予（時間）。SQL の interval '72 hours' と一致させる */
export const PAST_DUE_GRACE_HOURS = 72;

/**
 * entitlement RPC / DB 読取失敗。生成経路は 503 fail-closed（A9）。
 * Free 既定や defense max への silent fallback は禁止。
 */
export class BillingEntitlementUnavailableError extends Error {
  readonly code = "billing_entitlement_unavailable" as const;
  constructor(cause?: unknown) {
    super("billing_entitlement_unavailable");
    this.name = "BillingEntitlementUnavailableError";
    this.cause = cause;
  }
}

/**
 * unit parity 専用。request path では RPC の plus_entitled を map するだけ（再計算しない）。
 * SQL private.billing_entitlement_json と判定を揃える。
 */
export function computePlusEntitled(
  row: {
    status: BillingSubscriptionStatus;
    past_due_since: string | null;
    current_period_end: string;
  } | null,
  now: Date,
): { plusEntitled: boolean; pastDueGrace: boolean } {
  if (!row) return { plusEntitled: false, pastDueGrace: false };
  if (row.status === "trialing" || row.status === "active") {
    return { plusEntitled: true, pastDueGrace: false };
  }
  if (row.status === "past_due") {
    // A6: past_due_since NULL は fail-closed（無限 Plus を作らない）
    if (row.past_due_since == null) {
      return { plusEntitled: false, pastDueGrace: false };
    }
    const since = new Date(row.past_due_since).getTime();
    const graceMs = PAST_DUE_GRACE_HOURS * 3600_000;
    // SQL 正本: now < past_due_since + 72h（終端排他）。境界ちょうどは非 entitled。
    if (now.getTime() < since + graceMs) {
      return { plusEntitled: true, pastDueGrace: true };
    }
    return { plusEntitled: false, pastDueGrace: false };
  }
  // A6: 支払済み残存の canceled は期間内 Plus。B2: grace 失効後は再付与しない。
  // SQL private.billing_entitlement_json と同型（終端排他の 72h）。
  if (row.status === "canceled" && now.getTime() < new Date(row.current_period_end).getTime()) {
    if (row.past_due_since != null) {
      const since = new Date(row.past_due_since).getTime();
      const graceMs = PAST_DUE_GRACE_HOURS * 3600_000;
      if (now.getTime() >= since + graceMs) {
        return { plusEntitled: false, pastDueGrace: false };
      }
    }
    return { plusEntitled: true, pastDueGrace: false };
  }
  return { plusEntitled: false, pastDueGrace: false };
}

/**
 * kill 中 unpaid 投影の読取側フック。
 * B2: kill_source は Stripe 未検証の stale。BILLING_ENABLED 復帰だけで
 * elevation しない。権益は webhook / reconcile の投影を待つ（fail-closed）。
 * unknown price の unpaid（kill_source 無し）も触らない。
 */
export function restoreKillMaskedEntitlement(
  entitlement: Entitlement,
  billingEnabled: boolean,
  now: Date = new Date(),
): Entitlement {
  if (!billingEnabled) return entitlement;
  // B2: now は B15 の時計共有のために受け取る。Stripe 未検証の kill_source では elevation しない。
  void now;
  return entitlement;
}

/** BILLING_ENABLED=false → 常に free limits（A3 枠面） */
export function applyQuotaPlan(
  entitlement: Entitlement,
  billingEnabled: boolean,
  now: Date = new Date(),
): PlanCode {
  if (!billingEnabled) return "free";
  // B15: toEntitlementData / Checkout と同じ now を渡せる。別時計で plan と quota が割れない。
  const restored = restoreKillMaskedEntitlement(entitlement, billingEnabled, now);
  return restored.plusEntitled ? "plus" : "free";
}

/**
 * Checkout/Portal/品質/チラシの製品面が開いているか。
 * A3: BILLING_ENABLED のみで判定（DB の plus 投影とは独立）。
 */
export function productSurfacesOpen(billingEnabled: boolean): boolean {
  return billingEnabled;
}

/**
 * GET /api/billing/entitlement 用: DB 投影 + kill 分割面を合成する。
 * productSurfacesOpen / quotaPlan は env.billingEnabled 由来。
 * B5: plusEntitled は usage.plusEntitled と同義（quotaPlan === "plus"）。
 * dbPlusEntitled だけが BILLING_ENABLED 非依存の DB 生値。
 */
export function toEntitlementData(
  entitlement: Entitlement,
  billingEnabled: boolean,
  now: Date = new Date(),
): EntitlementData {
  // B15: restore と apply を同じ時計で見る（終端ちょうどで plan と plusEntitled が割れない）
  const restored = restoreKillMaskedEntitlement(entitlement, billingEnabled, now);
  const quotaPlan = applyQuotaPlan(entitlement, billingEnabled, now);
  return {
    plan: restored.plan,
    status: restored.status,
    plusEntitled: quotaPlan === "plus",
    pastDueGrace: restored.pastDueGrace,
    currentPeriodEnd: restored.currentPeriodEnd,
    cancelAtPeriodEnd: restored.cancelAtPeriodEnd,
    trialEnd: restored.trialEnd,
    dbPlusEntitled: entitlement.dbPlusEntitled,
    productSurfacesOpen: productSurfacesOpen(billingEnabled),
    quotaPlan,
  };
}

export function limitsForPlan(plan: PlanCode) {
  return planQuota[plan];
}

// RPC 投影 JSON（snake_case）。不正 shape は 503（A9）
const entitlementRpcSchema = z
  .object({
    plan: z.enum(["free", "plus"]),
    status: z.enum([
      "none",
      "trialing",
      "active",
      "past_due",
      "canceled",
      "unpaid",
      "incomplete",
      "incomplete_expired",
      "paused",
    ]),
    plus_entitled: z.boolean(),
    past_due_grace: z.boolean(),
    current_period_end: z.string().nullable(),
    cancel_at_period_end: z.boolean(),
    trial_end: z.string().nullable(),
    db_plus_entitled: z.boolean(),
    past_due_since: z.string().nullable().optional(),
    kill_source_status: z
      .enum([
        "trialing",
        "active",
        "past_due",
        "canceled",
        "unpaid",
        "incomplete",
        "incomplete_expired",
        "paused",
      ])
      .nullable()
      .optional(),
  })
  .strict();

/**
 * get_billing_entitlement_for_user を map するだけ。
 * plusEntitled は RPC 投影を信頼し、TS で再計算しない。
 * 失敗・不正 JSON → BillingEntitlementUnavailableError（A9）。
 * 成功時の limits 選択は applyQuotaPlan のみ。defense.max* を default にしない。
 */
export async function loadEntitlement(userId: string): Promise<Entitlement> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc("get_billing_entitlement_for_user", {
      p_user_id: userId,
    });
    if (error !== null) {
      throw new BillingEntitlementUnavailableError(error);
    }
    const parsed = entitlementRpcSchema.safeParse(data);
    if (!parsed.success) {
      throw new BillingEntitlementUnavailableError(parsed.error);
    }
    return {
      plan: parsed.data.plan,
      status: parsed.data.status,
      plusEntitled: parsed.data.plus_entitled,
      pastDueGrace: parsed.data.past_due_grace,
      currentPeriodEnd: parsed.data.current_period_end,
      cancelAtPeriodEnd: parsed.data.cancel_at_period_end,
      trialEnd: parsed.data.trial_end,
      dbPlusEntitled: parsed.data.db_plus_entitled,
      pastDueSince: parsed.data.past_due_since ?? null,
      killSourceStatus: parsed.data.kill_source_status ?? null,
    };
  } catch (error: unknown) {
    if (error instanceof BillingEntitlementUnavailableError) throw error;
    throw new BillingEntitlementUnavailableError(error);
  }
}
