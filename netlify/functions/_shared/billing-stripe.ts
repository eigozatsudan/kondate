import Stripe from "stripe";
import { STRIPE_API_VERSION } from "../../../shared/contracts/billing.js";
import type { ServerEnv } from "./env.js";

export { STRIPE_API_VERSION };

/** Stripe SDK コンストラクタ第2引数。LatestApiVersion 型は同梱最新のみのため固定ピンを明示キャスト。 */
type StripeCtorOptions = NonNullable<ConstructorParameters<typeof Stripe>[1]>;

/**
 * Stripe クライアントを固定 API version で生成する。
 * apiVersion は ADV-13 で `"2025-02-24.acacia"` にロック（Dashboard 任せにしない）。
 */
export function createStripeClient(secretKey: string): Stripe {
  // SDK 型の LatestApiVersion は同梱最新（例: dahlia）のみ。
  // 製品は ADV-13 で acacia 固定のため unknown 経由でピンを送る。
  const options = {
    apiVersion: STRIPE_API_VERSION,
  } as unknown as StripeCtorOptions;
  return new Stripe(secretKey, options);
}

/**
 * ServerEnv から Stripe クライアントを作る。
 * stripe 設定が無い（kill かつ鍵なし）場合は null。
 */
export function getStripeClientFromEnv(env: ServerEnv): Stripe | null {
  if (env.stripe === undefined) return null;
  return createStripeClient(env.stripe.secretKey);
}

/** Checkout / Portal が要求する完全な Stripe 設定。無い・不完全なら 503 用。 */
export function requireStripeConfig(env: ServerEnv): NonNullable<ServerEnv["stripe"]> {
  if (env.stripe === undefined) {
    throw new Error("stripe_config_missing");
  }
  return env.stripe;
}
