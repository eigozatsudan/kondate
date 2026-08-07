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
  adjustedAuthNowMs,
  clearAuthFlow,
  markAuthContinuationCallbackOwner,
  readAuthContinuationCallbackStartedAt,
  readAuthFlow,
  isAuthSelfReturnPath,
  sanitizeReturnPath,
} from "./auth-flow";

type AuthCallbackErrorCode =
  "oauth_cancelled" | "auth_callback_failed" | "magic_link_expired" | "unbound_callback";

/** 本番既定: フルナビゲーション。OAuth 戻り直後の SPA navigate は iOS で効かないことがある。 */
export function defaultLeaveAuthCallback(href: string): void {
  window.location.replace(href);
}

/** fail-closed 時も可能な限り returnTo を保持し、再ログイン後の行き先を落とさない（C4）。 */
function loginErrorHref(code: AuthCallbackErrorCode, returnTo?: string): string {
  const params = new URLSearchParams({ authError: code });
  if (returnTo !== undefined && returnTo !== "") {
    const safe = sanitizeReturnPath(returnTo);
    // /login 自身や callback を returnTo にすると認証後にループするため載せない（C1）
    if (!isAuthSelfReturnPath(safe)) {
      params.set("returnTo", safe);
    }
  }
  return `/login?${params.toString()}`;
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
  // C14: deposited 案内が TTL 超過後も残らないよう期限切れ二次 UI へ切替
  const [depositedExpired, setDepositedExpired] = useState(false);
  const [defaultGateway] = useState<AuthGateway>(() => gateway ?? createAuthGateway());
  const activeGateway = gateway ?? defaultGateway;
  const callbackPromise = useRef<Promise<AuthCallbackResult> | null>(null);
  const callbackFlowId = useRef<string | null>(null);
  // 二重 leave を防ぐ（StrictMode 再実行や complete + recovery 競合）
  const leftRef = useRef(false);
  // deposited は案内を読み終わるまで watchdog で強制 leave しない（C14: 期限後は UI 切替）
  const stayOnDepositedRef = useRef(false);
  // hangWatchdog は storage に flow が無いケースでも returnTo を落とさない（テスト・strip 後）
  const hangWatchReturnToRef = useRef<string | undefined>(undefined);

  const leaveOnce = (href: string): void => {
    if (leftRef.current) return;
    leftRef.current = true;
    leaveAuthCallback(href);
  };

  const leaveSuccess = (returnTo: string): void => {
    leaveOnce(sanitizeReturnPath(returnTo));
  };

  const leaveLoginError = (code: AuthCallbackErrorCode, returnTo?: string): void => {
    leaveOnce(loginErrorHref(code, returnTo));
  };

  useEffect(() => {
    const callbackTtlMs = ttlMs ?? getPublicEnv().authContinuationTtlMs;

    if (callbackPromise.current === null) {
      const callbackUrl = new URL(window.location.href);
      // C5/C8: 可視 URL は flow 以外を全削除（gateway の allowlist 処理とは別層）。
      // code / access_token 等がアドレスバー・history・同一タブ Referer に残らないようにする。
      // 初回ナビゲーション URL のエッジログはインフラ管轄（アプリ JS では消せない）。
      const visibleUrl = new URL(callbackUrl);
      for (const key of [...visibleUrl.searchParams.keys()]) {
        if (key !== "flow") {
          visibleUrl.searchParams.delete(key);
        }
      }
      visibleUrl.hash = "";
      window.history.replaceState(window.history.state, "", visibleUrl);
      const flowId = callbackUrl.searchParams.get("flow");
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

    // completeCallback が deposit/claim で hang しても continuation TTL で fail-closed する。
    // awaiting 分岐の completion wait は kind 確定後にしか武装されないため、ここが必須。
    const flowIdForWatch = callbackFlowId.current;
    const ownerStartedAt =
      flowIdForWatch === null
        ? null
        : readAuthContinuationCallbackStartedAt(
            flowIdForWatch,
            window.localStorage,
            new Date(),
            callbackTtlMs,
          );
    const startedAtMs =
      ownerStartedAt !== null && Number.isFinite(new Date(ownerStartedAt).getTime())
        ? new Date(ownerStartedAt).getTime()
        : Date.now();
    // C6: サーバ expiresAt が分かればローカル TTL より厳しい方で watchdog を切る
    const flowForDeadline =
      flowIdForWatch === null ? null : readAuthFlow(flowIdForWatch, window.localStorage);
    const serverExpiresMs =
      flowForDeadline?.expiresAt === undefined
        ? null
        : new Date(flowForDeadline.expiresAt).getTime();
    const localDeadlineMs = startedAtMs + callbackTtlMs;
    const deadlineMs =
      serverExpiresMs !== null && Number.isFinite(serverExpiresMs)
        ? Math.min(localDeadlineMs, serverExpiresMs)
        : localDeadlineMs;
    // C4: normalizeAuthClock と同型で clockSkewMs を差し引き、進みすぎクライアントの早期焼却を防ぐ
    const remainingMs = Math.max(
      0,
      deadlineMs - adjustedAuthNowMs(Date.now(), flowForDeadline?.clockSkewMs),
    );
    const hangWatchdog = window.setTimeout(() => {
      if (leftRef.current) return;
      // C14: deposited は強制 leave せず、期限切れ・やり直す二次 UI へ切替
      if (stayOnDepositedRef.current) {
        setDepositedExpired(true);
        return;
      }
      // storage の flow と gateway 結果の双方から returnTo を拾う（C4）
      const fromStorage =
        flowIdForWatch === null
          ? undefined
          : (readAuthFlow(flowIdForWatch, window.localStorage)?.returnTo ?? undefined);
      const watchedReturnTo = fromStorage ?? hangWatchReturnToRef.current;
      if (flowIdForWatch !== null) clearAuthFlow(flowIdForWatch);
      leaveLoginError("unbound_callback", watchedReturnTo);
    }, remainingMs);

    let active = true;
    let stopWaiting: (() => void) | undefined;
    void callbackPromise.current.then((next) => {
      if (!active) return;
      setResult(next);
      hangWatchReturnToRef.current = next.returnTo;
      if (next.kind === "complete") {
        publishCompletionSafely({ flowId: next.flowId, returnTo: next.returnTo });
        leaveSuccess(next.returnTo);
      } else if (next.kind === "deposited") {
        stayOnDepositedRef.current = true;
      } else if (next.kind === "awaiting_completion") {
        const startedAt = readAuthContinuationCallbackStartedAt(
          next.flowId,
          window.localStorage,
          new Date(),
          callbackTtlMs,
        );
        if (startedAt === null) {
          clearAuthFlow(next.flowId);
          leaveLoginError("unbound_callback", next.returnTo);
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
          leaveLoginError(authError, next.returnTo);
        };
        // R3: hangWatchdog（C6）と同型で server expiresAt があれば wait もクリップする
        // C4 / RR1: clockSkewMs も hangWatchdog と同型で渡し、進みすぎクライアントの早期 fail-closed を防ぐ
        // exactOptionalPropertyTypes: undefined を明示渡さない
        const flowForWait = readAuthFlow(next.flowId, window.localStorage);
        stopCompletionWait = startAuthContinuationCompletionWait({
          flowId: next.flowId,
          startedAt,
          ttlMs: callbackTtlMs,
          ...(flowForWait?.expiresAt !== undefined
            ? { serverExpiresAt: flowForWait.expiresAt }
            : {}),
          ...(flowForWait?.clockSkewMs !== undefined
            ? { clockSkewMs: flowForWait.clockSkewMs }
            : {}),
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
        leaveLoginError("magic_link_expired", next.returnTo);
      } else {
        // kind === "error"（網羅的に残りは error のみ）
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
        leaveLoginError(next.code, next.returnTo);
      }
    });
    return () => {
      active = false;
      stopWaiting?.();
      window.clearTimeout(hangWatchdog);
    };
  }, [activeGateway, ttlMs, leaveAuthCallback]);

  if (result?.kind === "deposited") {
    return (
      <main className="page-frame stack">
        <h1>
          {depositedExpired
            ? "ログインの引き継ぎ期限が切れました"
            : "ログイン情報を元のブラウザへ渡しました"}
        </h1>
        <section className="card stack">
          {depositedExpired ? (
            <p>
              元のブラウザへの引き継ぎ期限が過ぎました。下のボタンから最初の画面に戻り、ログインをやり直してください。
            </p>
          ) : (
            <>
              <p>
                元のブラウザでログインを続けてください。この画面にログイン用の情報は保存されません
              </p>
              <ol className="stack type-small">
                <li>このアプリを開いていた元のブラウザのタブへ戻る</li>
                <li>元のタブでログイン完了を待つ</li>
                <li>元のタブが分からない・閉じた場合は、下のボタンからやり直す</li>
              </ol>
            </>
          )}
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
