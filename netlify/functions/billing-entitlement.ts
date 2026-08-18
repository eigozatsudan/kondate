import type { Config } from "@netlify/functions";
import { entitlementDataSchema } from "../../shared/contracts/billing.js";
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
    // B10: GET 境界で entitlementDataSchema に閉じる。壊れた日時は toEntitlementData が null。
    // parse 失敗（想定外 shape）は handleError で 500。クライアント z.iso.datetime を落とさない。
    const data = entitlementDataSchema.parse(toEntitlementData(entitlement, env.billingEnabled));
    return json(200, { ok: true, data });
  } catch (error: unknown) {
    return handleError(error);
  }
}

export const config: Config = {
  path: "/api/billing/entitlement",
  method: "GET",
};
