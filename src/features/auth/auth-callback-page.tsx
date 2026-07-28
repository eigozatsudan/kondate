import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { createAuthGateway, type AuthCallbackResult, type AuthGateway } from "./auth-gateway";
import {
  publishAuthContinuationCompletion,
  startAuthContinuationCompletionWait,
} from "./auth-continuation-completion";
import { getPublicEnv } from "@/shared/config/public-env";
import {
  clearAuthFlow,
  markAuthContinuationCallbackOwner,
  readAuthContinuationCallbackStartedAt,
} from "./auth-flow";

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
      callbackFlowId.current = flowId;
      if (flowId !== null) markAuthContinuationCallbackOwner(flowId);
      callbackPromise.current = activeGateway.completeCallback(callbackUrl);
    }
    let active = true;
    let stopWaiting: (() => void) | undefined;
    void callbackPromise.current.then((next) => {
      if (!active) return;
      setResult(next);
      if (next.kind === "complete") {
        publishAuthContinuationCompletion({ flowId: next.flowId, returnTo: next.returnTo });
        void navigate(next.returnTo, { replace: true });
      } else if (next.kind === "awaiting_completion") {
        const startedAt = readAuthContinuationCallbackStartedAt(next.flowId);
        if (startedAt === null) {
          clearAuthFlow(next.flowId);
          void navigate("/login", {
            replace: true,
            state: { authError: "unbound_callback" },
          });
          return;
        }
        // AUTH-01: 他タブ完了待ちに加え、コールバック所有者タブ自身が claim を再試行する。
        // deposit 後の 429/5xx/network で waiting に入った単独タブが TTL まで固まるのを防ぐ。
        // 間隔は recovery と同じ 5s（claim IP 上限 20/60s を超えない）。
        let claimRetryFinished = false;
        // DOM setInterval は number を返す（Node Timeout 型との混同を避ける）
        let claimRetryTimer: number | undefined;
        const stopClaimRetry = (): void => {
          claimRetryFinished = true;
          if (claimRetryTimer !== undefined) {
            window.clearInterval(claimRetryTimer);
            claimRetryTimer = undefined;
          }
        };
        const stopCompletionWait = startAuthContinuationCompletionWait({
          flowId: next.flowId,
          startedAt,
          ttlMs: ttlMs ?? getPublicEnv().authContinuationTtlMs,
          onComplete: (completion) => {
            stopClaimRetry();
            void navigate(completion.returnTo, { replace: true });
          },
          onExpire: () => {
            stopClaimRetry();
            clearAuthFlow(next.flowId);
            void navigate("/login", {
              replace: true,
              state: { authError: "unbound_callback" },
            });
          },
        });
        claimRetryTimer = window.setInterval(() => {
          if (claimRetryFinished) return;
          void activeGateway.resumeFlow(next.flowId).then((retry) => {
            if (claimRetryFinished) return;
            if (retry.kind === "complete") {
              stopClaimRetry();
              stopCompletionWait();
              publishAuthContinuationCompletion({
                flowId: retry.flowId,
                returnTo: retry.returnTo,
              });
              void navigate(retry.returnTo, { replace: true });
            } else if (retry.kind === "error" || retry.kind === "expired") {
              stopClaimRetry();
              stopCompletionWait();
              clearAuthFlow(next.flowId);
              void navigate("/login", {
                replace: true,
                state: {
                  authError: retry.kind === "expired" ? "magic_link_expired" : retry.code,
                },
              });
            }
            // awaiting_completion / deposited は継続待ち
          });
        }, 5_000);
        stopWaiting = () => {
          stopClaimRetry();
          stopCompletionWait();
        };
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
    <main className="page-frame" aria-live="polite">
      <h1>ログインを確認中</h1>
      <p>この画面を閉じずにお待ちください。</p>
    </main>
  );
}
