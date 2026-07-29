import { z } from "zod";

/** Checkout body。設計 mermaid の priceInterval は diagram-only 誤り — interval が正。 */
export const checkoutRequestSchema = z.object({ interval: z.enum(["month", "year"]) }).strict();

export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

export const checkoutDataSchema = z
  .object({
    url: z.url(),
  })
  .strict();

export type CheckoutData = z.infer<typeof checkoutDataSchema>;

export const portalDataSchema = z
  .object({
    url: z.url(),
  })
  .strict();

export type PortalData = z.infer<typeof portalDataSchema>;

/** GET /api/billing/entitlement の閉じたレスポンス。 */
export const entitlementDataSchema = z
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
    plusEntitled: z.boolean(),
    pastDueGrace: z.boolean(),
    currentPeriodEnd: z.string().nullable(),
    cancelAtPeriodEnd: z.boolean(),
    trialEnd: z.string().nullable(),
    dbPlusEntitled: z.boolean(),
    productSurfacesOpen: z.boolean(),
    quotaPlan: z.enum(["free", "plus"]),
  })
  .strict();

export type EntitlementData = z.infer<typeof entitlementDataSchema>;

/** ADV-13: Stripe API version 固定ピン。変更は設計改訂。 */
export const STRIPE_API_VERSION = "2025-02-24.acacia" as const;
export type StripeApiVersion = typeof STRIPE_API_VERSION;
