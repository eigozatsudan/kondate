import Stripe from "stripe";
import { STRIPE_API_VERSION } from "../../../shared/contracts/billing.js";
import type { ServerEnv } from "./env.js";

export { STRIPE_API_VERSION };

export type CreateStripeClientOptions = {
  /**
   * ローカル mock のみ。exact `STRIPE_MOCK_BASE_URL` を host/protocol/port に分解して SDK へ渡す。
   * 本番では env が mock を拒否するため到達しない。
   */
  mockBaseUrl?: string;
};

/**
 * Stripe クライアントを固定 API version で生成する。
 * apiVersion は ADV-13 で `"2025-02-24.acacia"` にロック（Dashboard 任せにしない）。
 * mockBaseUrl があるときは SDK の接続先をその origin に向ける（local stripe-mock）。
 */
export function createStripeClient(
  secretKey: string,
  options: CreateStripeClientOptions = {},
): Stripe {
  // SDK 型の LatestApiVersion は同梱最新（例: dahlia）のみ。
  // 製品は ADV-13 で acacia 固定のため unknown 経由でピンを送る。
  const ctorOptions: Record<string, unknown> = {
    apiVersion: STRIPE_API_VERSION,
  };
  if (options.mockBaseUrl !== undefined && options.mockBaseUrl.length > 0) {
    // URL 分解: stripe-node は host/protocol/port を個別に受ける
    const parsed = new URL(options.mockBaseUrl);
    ctorOptions.host = parsed.hostname;
    ctorOptions.protocol = parsed.protocol.replace(/:$/u, "");
    if (parsed.port.length > 0) {
      ctorOptions.port = parsed.port;
    }
  }
  // apiVersion は Record 経由で渡し、SDK の LatestApiVersion 制約を回避する
  return new Stripe(secretKey, ctorOptions);
}

/**
 * ServerEnv から Stripe クライアントを作る。
 * stripe 設定が無い（kill かつ鍵なし）場合は null。
 */
export function getStripeClientFromEnv(env: ServerEnv): Stripe | null {
  if (env.stripe === undefined) return null;
  return createStripeClient(env.stripe.secretKey, {
    ...(env.stripe.mockBaseUrl === undefined ? {} : { mockBaseUrl: env.stripe.mockBaseUrl }),
  });
}

/** Checkout / Portal が要求する完全な Stripe 設定。無い・不完全なら 503 用。 */
export function requireStripeConfig(env: ServerEnv): NonNullable<ServerEnv["stripe"]> {
  if (env.stripe === undefined) {
    throw new Error("stripe_config_missing");
  }
  return env.stripe;
}
