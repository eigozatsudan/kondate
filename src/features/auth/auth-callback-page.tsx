import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { createAuthGateway, type AuthCallbackResult, type AuthGateway } from "./auth-gateway";
import {
  publishAuthContinuationCompletion,
  readAuthContinuationCompletion,
  startAuthContinuationCompletionWait,
} from "./auth-continuation-completion";
import { startAuthContinuationRecovery } from "./auth-continuation-recovery";
import { getPublicEnv } from "@/shared/config/public-env";
import {
  clearAuthFlow,
  markAuthContinuationCallbackOwner,
  readAuthContinuationCallbackStartedAt,
} from "./auth-flow";

function publishCompletionSafely(completion: { flowId: string; returnTo: string }): void {
  try {
    publishAuthContinuationCompletion(completion);
  } catch {
    // session確立後のlocalStorage障害は遷移を妨げず、秘密を含み得る例外も外へ出さない。
  }
}

export function AuthCallbackPage({ gateway, ttlMs }: { gateway?: AuthGateway; ttlMs?: number }) {
  const navigate = useNavigate();
  const [result, setResult] = useState<AuthCallbackResult | null>(null);
  const [defaultGateway] = useState<AuthGateway>(() => gateway ?? createAuthGateway());
  const activeGateway = gateway ?? defaultGateway;
  const callbackPromise = useRef<Promise<AuthCallbackResult> | null>(null);
  const callbackFlowId = useRef<string | null>(null);

  useEffect(() => {
    if (callbackPromise.current === null) {
      const callbackUrl = new URL(window.location.href);
      const visibleUrl = new URL(callbackUrl);
      visibleUrl.searchParams.delete("code");
      visibleUrl.searchParams.delete("state");
      visibleUrl.searchParams.delete("error");
      visibleUrl.searchParams.delete("error_code");
      visibleUrl.searchParams.delete("error_description");
      visibleUrl.hash = "";
      window.history.replaceState(window.history.state, "", visibleUrl);
      const flowId = callbackUrl.searchParams.get("flow");
      const callbackTtlMs = ttlMs ?? getPublicEnv().authContinuationTtlMs;
      callbackFlowId.current = flowId;
      const canContinue =
        flowId === null ||
        markAuthContinuationCallbackOwner(flowId, window.localStorage, new Date(), callbackTtlMs);
      callbackPromise.current = canContinue
        ? activeGateway.completeCallback(callbackUrl).catch((): AuthCallbackResult => ({
            kind: "error",
            code: "unbound_callback",
            returnTo: "/login",
          }))
        : Promise.resolve({
            kind: "error",
            code: "unbound_callback",
            returnTo: "/login",
          });
    }
    let active = true;
    let stopWaiting: (() => void) | undefined;
    void callbackPromise.current.then((next) => {
      if (!active) return;
      setResult(next);
      if (next.kind === "complete") {
        publishCompletionSafely({ flowId: next.flowId, returnTo: next.returnTo });
        void navigate(next.returnTo, { replace: true });
      } else if (next.kind === "awaiting_completion") {
        const callbackTtlMs = ttlMs ?? getPublicEnv().authContinuationTtlMs;
        const startedAt = readAuthContinuationCallbackStartedAt(
          next.flowId,
          window.localStorage,
          new Date(),
          callbackTtlMs,
        );
        if (startedAt === null) {
          clearAuthFlow(next.flowId);
          void navigate("/login", {
            replace: true,
            state: { authError: "unbound_callback" },
          });
          return;
        }
        const existingCompletion = readAuthContinuationCompletion(next.flowId);
        if (existingCompletion !== null) {
          void navigate(existingCompletion.returnTo, { replace: true });
          return;
        }
        let finished = false;
        let stopCompletionWait = (): void => undefined;
        let stopRecovery = (): void => undefined;
        const stopAwaiting = (): void => {
          if (finished) return;
          finished = true;
          stopCompletionWait();
          stopRecovery();
        };
        const failClosed = (authError: "magic_link_expired" | "unbound_callback"): void => {
          if (finished) return;
          stopAwaiting();
          clearAuthFlow(next.flowId);
          void navigate("/login", {
            replace: true,
            state: { authError },
          });
        };
        stopCompletionWait = startAuthContinuationCompletionWait({
          flowId: next.flowId,
          startedAt,
          ttlMs: callbackTtlMs,
          onComplete: (completion) => {
            if (finished) return;
            stopAwaiting();
            void navigate(completion.returnTo, { replace: true });
          },
          onExpire: () => {
            failClosed("unbound_callback");
          },
        });
        // callback ownerも通常recoveryと同じ共有slotを通し、タブ数にかかわらずclaim頻度を固定する。
        stopRecovery = startAuthContinuationRecovery({
          gateway: activeGateway,
          storage: window.localStorage,
          targetFlowId: next.flowId,
          ttlMs: callbackTtlMs,
          onComplete: (completion) => {
            if (finished) return;
            stopAwaiting();
            publishCompletionSafely({
              flowId: completion.flowId,
              returnTo: completion.returnTo,
            });
            void navigate(completion.returnTo, { replace: true });
          },
          onResult: (recoveryResult) => {
            if (recoveryResult.kind === "expired") {
              failClosed("magic_link_expired");
            } else if (recoveryResult.kind === "error") {
              failClosed("unbound_callback");
            }
          },
        });
        stopWaiting = stopAwaiting;
      } else if (next.kind === "expired") {
        if (callbackFlowId.current !== null) clearAuthFlow(callbackFlowId.current);
        void navigate("/login", {
          replace: true,
          state: { authError: "magic_link_expired" },
        });
      } else if (next.kind === "error") {
        if (callbackFlowId.current !== null) clearAuthFlow(callbackFlowId.current);
        void navigate("/login", {
          replace: true,
          state: { authError: next.code },
        });
      }
    });
    return () => {
      active = false;
      stopWaiting?.();
    };
  }, [activeGateway, navigate, ttlMs]);

  if (result?.kind === "deposited") {
    return (
      <main className="page-frame stack">
        <h1>ログイン情報を元のブラウザへ渡しました</h1>
        <section className="card stack">
          <p>元のブラウザでログインを続けてください。この画面にログイン用の情報は保存されません</p>
          <ol className="stack type-small">
            <li>このアプリを開いていた元のブラウザのタブへ戻る</li>
            <li>元のタブでログイン完了を待つ</li>
            <li>元のタブが分からない・閉じた場合は、下のボタンからやり直す</li>
          </ol>
          {/* B-C1: WebView 内で session を作らず、continuation も再消費しない。新規ログインのみ。 */}
          <button
            type="button"
            className="primary-button min-h-11"
            onClick={() => {
              void navigate("/login", { replace: true });
            }}
          >
            最初からやり直す
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="page-frame stack" aria-live="polite">
      <h1>ログインを確認中</h1>
      <p>Google やメールのリンクから戻ってきたあとの確認です。この画面を閉じずにお待ちください。</p>
      <p className="type-small">
        しばらく待っても進まないときは、前の画面に戻って「Googleで続ける」またはメールログインをやり直してください。
      </p>
    </main>
  );
}
