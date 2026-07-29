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
    if (now.getTime() <= since + graceMs) {
      return { plusEntitled: true, pastDueGrace: true };
    }
    return { plusEntitled: false, pastDueGrace: false };
  }
  if (row.status === "canceled" && now.getTime() < new Date(row.current_period_end).getTime()) {
    return { plusEntitled: true, pastDueGrace: false };
  }
  return { plusEntitled: false, pastDueGrace: false };
}

/** BILLING_ENABLED=false → 常に free limits（A3 枠面） */
export function applyQuotaPlan(entitlement: Entitlement, billingEnabled: boolean): PlanCode {
  if (!billingEnabled) return "free";
  return entitlement.plusEntitled ? "plus" : "free";
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
 */
export function toEntitlementData(
  entitlement: Entitlement,
  billingEnabled: boolean,
): EntitlementData {
  const quotaPlan = applyQuotaPlan(entitlement, billingEnabled);
  return {
    plan: entitlement.plan,
    status: entitlement.status,
    plusEntitled: entitlement.plusEntitled,
    pastDueGrace: entitlement.pastDueGrace,
    currentPeriodEnd: entitlement.currentPeriodEnd,
    cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
    trialEnd: entitlement.trialEnd,
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
    };
  } catch (error: unknown) {
    if (error instanceof BillingEntitlementUnavailableError) throw error;
    throw new BillingEntitlementUnavailableError(error);
  }
}
