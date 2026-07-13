import type { AuthError } from "@supabase/supabase-js";
import { z } from "zod";
import {
  buildAuthCallbackUrl,
  clearAuthFlow,
  clearClaimedAuthFlow,
  ContinuationHttpError,
  createAuthFlow,
  listUnexpiredAuthFlows,
  isAuthContinuationCallbackOwned,
  readAuthFlow,
  sanitizeReturnPath,
  createContinuationApi,
  type ContinuationApi,
} from "./auth-flow";
import { getPublicEnv, type PublicEnv } from "@/shared/config/public-env";
import { getBrowserSupabaseClient, type BrowserSupabaseClient } from "@/shared/lib/supabase";

export type SentMagicLink = {
  flowId: string;
  email: string;
  resendAvailableAt: string;
};

export type AuthCallbackResult =
  | {
      kind: "complete";
      continuation: "same_browser";
      returnTo: string;
      flowId: string;
    }
  | { kind: "deposited"; continuation: "original_browser"; flowId: string; returnTo: string }
  | { kind: "awaiting_completion"; flowId: string; returnTo: string }
  | { kind: "expired"; flowId: string; returnTo: string }
  | {
      kind: "error";
      code: "oauth_cancelled" | "auth_callback_failed" | "unbound_callback";
      returnTo: string;
    };

export interface AuthGateway {
  signInWithGoogle(returnTo: string): Promise<void>;
  sendMagicLink(email: string, returnTo: string): Promise<SentMagicLink>;
  completeCallback(url: URL): Promise<AuthCallbackResult>;
  resumeFlow(flowId: string): Promise<AuthCallbackResult>;
}

export type AuthGatewayDeps = {
  getPublicEnv(): Pick<PublicEnv, "authContinuationTtlMs" | "authProviderMode" | "oauthMockOrigin">;
  fetchImpl: typeof fetch;
  appOrigin: string;
  navigate(url: string): void;
};
const browserAuthGatewayDeps: AuthGatewayDeps = {
  getPublicEnv,
  fetchImpl: (...args) => fetch(...args),
  appOrigin: window.location.origin,
  navigate: (url) => {
    window.location.assign(url);
  },
};
const localCredentialsSchema = z
  .object({
    email: z.email(),
    password: z.string().min(16),
  })
  .strict();

function isExpired(error: AuthError | null, url: URL): boolean {
  const code = error?.code ?? url.searchParams.get("error_code");
  return code === "otp_expired" || code === "otp_disabled" || code === "token_expired";
}

function replaceExistingAuthFlows(storage: Storage): void {
  for (const flow of listUnexpiredAuthFlows(storage, new Date())) {
    clearAuthFlow(flow.id, storage);
  }
}

export function createAuthGateway(
  providedClient?: BrowserSupabaseClient,
  continuationApi: ContinuationApi = createContinuationApi(),
  storage: Storage = window.localStorage,
  deps: AuthGatewayDeps = browserAuthGatewayDeps,
): AuthGateway {
  const client = providedClient ?? getBrowserSupabaseClient();
  return {
    async signInWithGoogle(returnTo) {
      replaceExistingAuthFlows(storage);
      const provider = deps.getPublicEnv();
      const flow = await createAuthFlow(
        returnTo,
        continuationApi,
        storage,
        undefined,
        provider.authProviderMode,
      );
      try {
        const redirectTo = buildAuthCallbackUrl(deps.appOrigin, flow);
        if (provider.authProviderMode === "oauth_mock") {
          if (provider.oauthMockOrigin !== "http://127.0.0.1:8788") {
            throw new Error("invalid mock origin");
          }
          const authorize = new URL("/authorize", provider.oauthMockOrigin);
          authorize.searchParams.set(
            "redirect_uri",
            new URL("/auth/callback", deps.appOrigin).href,
          );
          authorize.searchParams.set("flow", flow.id);
          authorize.searchParams.set("state", flow.state);
          deps.navigate(authorize.href);
          return;
        }
        const { error } = await client.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo },
        });
        if (error !== null) {
          throw new Error("Googleログインを開始できませんでした");
        }
      } catch {
        clearAuthFlow(flow.id, storage);
        throw new Error("Googleログインを開始できませんでした");
      }
    },

    async sendMagicLink(email, returnTo) {
      replaceExistingAuthFlows(storage);
      const flow = await createAuthFlow(returnTo, continuationApi, storage);
      const emailRedirectTo = buildAuthCallbackUrl(deps.appOrigin, flow);
      try {
        const { error } = await client.auth.signInWithOtp({
          email,
          options: { emailRedirectTo, shouldCreateUser: true },
        });
        if (error !== null) throw new Error("magic link failed");
      } catch {
        clearAuthFlow(flow.id, storage);
        throw new Error("ログイン用メールを送信できませんでした");
      }
      return {
        flowId: flow.id,
        email,
        resendAvailableAt: new Date(
          Date.now() + getPublicEnv().magicLinkResendSeconds * 1_000,
        ).toISOString(),
      };
    },

    async completeCallback(url) {
      if (url.hash !== "") return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
      const flowId = url.searchParams.get("flow");
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const stored = flowId === null ? null : readAuthFlow(flowId, storage);
      const returnTo = sanitizeReturnPath(stored?.returnTo);
      if (isExpired(null, url)) return { kind: "expired", flowId: flowId ?? "", returnTo };
      const providerError = url.searchParams.get("error");
      if (providerError !== null) {
        if (stored !== null && state !== stored.state) {
          return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
        }
        if (flowId !== null) clearAuthFlow(flowId, storage);
        return {
          kind: "error",
          code: providerError === "access_denied" ? "oauth_cancelled" : "auth_callback_failed",
          returnTo,
        };
      }
      if (flowId === null || state === null || code === null) {
        return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
      }
      try {
        await continuationApi.deposit(flowId, { state, code });
      } catch {
        return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
      }
      if (stored === null) {
        return {
          kind: "deposited",
          continuation: "original_browser",
          flowId,
          returnTo: "/planner",
        };
      }
      return this.resumeFlow(flowId);
    },

    async resumeFlow(flowId) {
      const flow = readAuthFlow(flowId, storage);
      if (flow === null) return { kind: "error", code: "unbound_callback", returnTo: "/planner" };
      let claimed = false;
      try {
        const claimedCode = await continuationApi.claim(flow.id, {
          secret: flow.secret,
          state: flow.state,
        });
        claimed = true;
        const result =
          flow.sessionExchange === "oauth_mock"
            ? await (async () => {
                const provider = deps.getPublicEnv();
                if (provider.oauthMockOrigin !== "http://127.0.0.1:8788") {
                  throw new Error("invalid mock origin");
                }
                const response = await deps.fetchImpl(`${provider.oauthMockOrigin}/exchange`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ code: claimedCode.code }),
                });
                if (!response.ok) throw new Error("mock exchange failed");
                return client.auth.signInWithPassword(
                  localCredentialsSchema.parse(await response.json()),
                );
              })()
            : client.auth.exchangeCodeForSession(claimedCode.code);
        const { error } = await result;
        if (error !== null) throw new Error("provider exchange failed");
        clearClaimedAuthFlow(flow.id, storage);
        return {
          kind: "complete",
          continuation: "same_browser",
          returnTo: claimedCode.returnTo,
          flowId: flow.id,
        };
      } catch (error) {
        if (claimed) clearAuthFlow(flow.id, storage);
        else if (
          error instanceof ContinuationHttpError &&
          error.status === 404 &&
          isAuthContinuationCallbackOwned(
            flow.id,
            storage,
            new Date(),
            deps.getPublicEnv().authContinuationTtlMs,
          )
        ) {
          return { kind: "awaiting_completion", flowId: flow.id, returnTo: flow.returnTo };
        }
        return { kind: "error", code: "unbound_callback", returnTo: flow.returnTo };
      }
    },
  };
}
