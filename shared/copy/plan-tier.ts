import { formatFreeTierQuotaCopy } from "./free-tier.js";
import type { PlanCode } from "../contracts/plan-quota.js";

/**
 * 制限説明のプラン接頭。
 * Free: 「無料版は」。Plus: 接頭なし（既に Plusでは/無料版は なら触らない）。
 */
export function formatPlanQuotaCopy(body: string, plan: PlanCode): string {
  const trimmed = body.trim();
  if (!trimmed) return trimmed;
  if (plan === "plus") {
    if (trimmed.startsWith("Plusでは") || trimmed.startsWith("無料版は")) {
      return trimmed;
    }
    return trimmed;
  }
  return formatFreeTierQuotaCopy(trimmed);
}
