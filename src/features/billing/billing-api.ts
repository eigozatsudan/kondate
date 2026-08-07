import { z } from "zod";
import {
  checkoutDataSchema,
  checkoutRequestSchema,
  entitlementDataSchema,
  portalDataSchema,
  type CheckoutRequest,
  type EntitlementData,
} from "@shared/contracts/billing";
import { requireAccessToken } from "@/features/auth/session";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";

/** Function 共通 envelope。ok=false は code だけ throw する（UI は日本語固定）。 */
const billingEnvelopeSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      data: z.unknown(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: z
        .object({
          code: z.string(),
          message: z.string(),
          details: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
    })
    .strict(),
]);

export type BillingApiDeps = {
  fetchImpl?: typeof fetch;
};

async function authedJson(
  path: string,
  init: {
    method: string;
    headers?: Record<string, string>;
    body?: string;
  },
  deps: BillingApiDeps = {},
): Promise<unknown> {
  const accessToken = await requireAccessToken(getBrowserSupabaseClient());
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };
  if (init.headers !== undefined) {
    for (const [key, value] of Object.entries(init.headers)) {
      headers[key] = value;
    }
  }
  const requestInit: RequestInit = {
    method: init.method,
    headers,
    cache: "no-store",
  };
  if (init.body !== undefined) {
    requestInit.body = init.body;
  }
  const response = await (deps.fetchImpl ?? fetch)(path, requestInit);
  const envelope = billingEnvelopeSchema.parse(await response.json());
  if (!envelope.ok) {
    throw new Error(envelope.error.code);
  }
  return envelope.data;
}

/**
 * GET /api/billing/entitlement — クライアントはプランを主張せずサーバ投影を読む。
 * residual-intentional (B11): DevTools 等で UI の plusEntitled を改変しても表示のみ。
 * quality / flyer / quota 消費はサーバ loadEntitlement + applyQuotaPlan が権威（真 elevation 閉じ）。
 */
export async function getEntitlement(deps: BillingApiDeps = {}): Promise<EntitlementData> {
  const data = await authedJson(
    "/api/billing/entitlement",
    {
      method: "GET",
    },
    deps,
  );
  return entitlementDataSchema.parse(data);
}

/**
 * POST /api/billing/checkout → Hosted Checkout URL。
 * Price ID はサーバのみ。ブラウザは interval だけ送る。
 */
export async function createCheckoutSession(
  body: CheckoutRequest,
  deps: BillingApiDeps = {},
): Promise<{ url: string }> {
  const parsed = checkoutRequestSchema.parse(body);
  const data = await authedJson(
    "/api/billing/checkout",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    },
    deps,
  );
  return checkoutDataSchema.parse(data);
}

/** POST /api/billing/portal → Customer Portal URL。 */
export async function createPortalSession(deps: BillingApiDeps = {}): Promise<{ url: string }> {
  const data = await authedJson(
    "/api/billing/portal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
    deps,
  );
  return portalDataSchema.parse(data);
}
