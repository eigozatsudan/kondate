import { useEffect, useRef, useState } from "react";
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
  sanitizeReturnPath,
} from "./auth-flow";

type AuthCallbackErrorCode =
  "oauth_cancelled" | "auth_callback_failed" | "magic_link_expired" | "unbound_callback";

/** 本番既定: フルナビゲーション。OAuth 戻り直後の SPA navigate は iOS で効かないことがある。 */
export function defaultLeaveAuthCallback(href: string): void {
  window.location.replace(href);
}

function loginErrorHref(code: AuthCallbackErrorCode): string {
  return `/login?authError=${encodeURIComponent(code)}`;
}

function publishCompletionSafely(completion: { flowId: string; returnTo: string }): void {
  try {
    publishAuthContinuationCompletion(completion);
  } catch {
    // session確立後のlocalStorage障害は遷移を妨げず、秘密を含み得る例外も外へ出さない。
  }
}

export function AuthCallbackPage({
  gateway,
  ttlMs,
  leaveAuthCallback = defaultLeaveAuthCallback,
}: {
  gateway?: AuthGateway;
  ttlMs?: number;
  /**
   * 認証完了・失敗後に callback 画面を離れる。
   * AuthProvider / session-expiry と同型の location.replace を既定にし、
   * テストだけ差し替える（MemoryRouter の SPA navigate では iOS 再現にならない）。
   */
  leaveAuthCallback?: (href: string) => void;
}) {
  const [result, setResult] = useState<AuthCallbackResult | null>(null);
  const [defaultGateway] = useState<AuthGateway>(() => gateway ?? createAuthGateway());
  const activeGateway = gateway ?? defaultGateway;
  const callbackPromise = useRef<Promise<AuthCallbackResult> | null>(null);
  const callbackFlowId = useRef<string | null>(null);
  // 二重 leave を防ぐ（StrictMode 再実行や complete + recovery 競合）
  const leftRef = useRef(false);

  const leaveOnce = (href: string): void => {
    if (leftRef.current) return;
    leftRef.current = true;
    leaveAuthCallback(href);
  };

  const leaveSuccess = (returnTo: string): void => {
    leaveOnce(sanitizeReturnPath(returnTo));
  };

  const leaveLoginError = (code: AuthCallbackErrorCode): void => {
    leaveOnce(loginErrorHref(code));
  };

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
        leaveSuccess(next.returnTo);
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
          leaveLoginError("unbound_callback");
          return;
        }
        const existingCompletion = readAuthContinuationCompletion(next.flowId);
        if (existingCompletion !== null) {
          leaveSuccess(existingCompletion.returnTo);
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
          leaveLoginError(authError);
        };
        stopCompletionWait = startAuthContinuationCompletionWait({
          flowId: next.flowId,
          startedAt,
          ttlMs: callbackTtlMs,
          onComplete: (completion) => {
            if (finished) return;
            stopAwaiting();
            leaveSuccess(completion.returnTo);
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
            leaveSuccess(completion.returnTo);
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
        leaveLoginError("magic_link_expired");
      } else if (next.kind === "error") {
        // AUTH-1: unbound_callback では秘密を焼かない。
        // gateway は state mismatch / hash / deposit 失敗で意図的に clear しない。
        // ページ側の無条件 clear は公開 flow UUID 経由の in-flight 秘密破壊（DoS）になる。
        // provider 端末エラー（oauth_cancelled / auth_callback_failed）だけ端末 secret を消す。
        if (
          callbackFlowId.current !== null &&
          (next.code === "oauth_cancelled" || next.code === "auth_callback_failed")
        ) {
          clearAuthFlow(callbackFlowId.current);
        }
        leaveLoginError(next.code);
      }
    });
    return () => {
      active = false;
      stopWaiting?.();
    };
  }, [activeGateway, ttlMs, leaveAuthCallback]);

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
              // ユーザー操作後は SPA navigate でもよいが、iOS 一貫性のためフル遷移する
              leaveOnce("/login");
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
