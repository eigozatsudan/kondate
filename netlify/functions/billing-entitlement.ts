import type { Config } from "@netlify/functions";
import type { EntitlementData } from "../../shared/contracts/billing.js";
import { requireUser } from "./_shared/auth.js";
import {
  BillingEntitlementUnavailableError,
  loadEntitlement,
  toEntitlementData,
} from "./_shared/billing-entitlement.js";
import { getServerEnv } from "./_shared/env.js";
import { handleError, HttpError, json, methodNotAllowed } from "./_shared/http.js";

/**
 * GET /api/billing/entitlement
 * DB 投影 + productSurfacesOpen + quotaPlan。
 * BILLING_ENABLED=false でも 200（surfaces closed / quota free）。
 */
export default async function billingEntitlement(request: Request): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  try {
    const user = await requireUser(request);
    const env = getServerEnv();
    let entitlement;
    try {
      entitlement = await loadEntitlement(user.userId);
    } catch (error: unknown) {
      if (error instanceof BillingEntitlementUnavailableError) {
        throw new HttpError(
          503,
          "billing_entitlement_unavailable",
          "プラン情報を確認できませんでした。しばらくしてからお試しください。",
        );
      }
      throw new HttpError(
        503,
        "billing_entitlement_unavailable",
        "プラン情報を確認できませんでした。しばらくしてからお試しください。",
      );
    }
    const data: EntitlementData = toEntitlementData(entitlement, env.billingEnabled);
    return json(200, { ok: true, data });
  } catch (error: unknown) {
    return handleError(error);
  }
}

export const config: Config = {
  path: "/api/billing/entitlement",
  method: "GET",
};
