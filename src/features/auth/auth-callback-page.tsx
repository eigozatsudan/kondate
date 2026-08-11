import { useEffect, useRef, useState } from "react";
import { createAuthGateway, type AuthCallbackResult, type AuthGateway } from "./auth-gateway";
import {
  publishAuthContinuationCompletion,
  readAuthContinuationCompletion,
  startAuthContinuationCompletionWait,
} from "./auth-continuation-completion";
import {
  isAuthContinuationExchangeBusy,
  startAuthContinuationRecovery,
} from "./auth-continuation-recovery";
import { getPublicEnv } from "@/shared/config/public-env";
import {
  captureAndStripAuthCallbackUrl,
  takeCapturedAuthCallbackUrl,
} from "./auth-callback-url-capture";
import {
  authDeadlineRemainingMs,
  clearAuthFlow,
  markAuthContinuationCallbackOwner,
  markAuthFlowUserDismissed,
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
  // C14: deposited / needs_confirmation 案内が TTL 超過後も残らないよう期限切れ二次 UI へ切替
  const [depositedExpired, setDepositedExpired] = useState(false);
  const [confirmPending, setConfirmPending] = useState(false);
  const [defaultGateway] = useState<AuthGateway>(() => gateway ?? createAuthGateway());
  const activeGateway = gateway ?? defaultGateway;
  const callbackPromise = useRef<Promise<AuthCallbackResult> | null>(null);
  const callbackFlowId = useRef<string | null>(null);
  // 二重 leave を防ぐ（StrictMode 再実行や complete + recovery 競合）
  const leftRef = useRef(false);
  // confirm 二重タップ: state 更新前の第2タップを同期で落とす（I-3）
  const confirmInFlightRef = useRef(false);
  // deposited / needs_confirmation は案内を読み終わるまで watchdog で強制 leave しない（C14）
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

  /**
   * C3: cancel / 期限切れ terminal UI から抜けるとき secret は焼かず dismiss 印だけ付ける。
   * 遅延 success URL が来ても completeCallback が silent complete しない。
   */
  const dismissFlowBestEffort = (flowId: string | undefined): void => {
    if (flowId === undefined || flowId === "") return;
    try {
      markAuthFlowUserDismissed(flowId);
    } catch {
      // storage 障害は TTL 収束に委ねる
    }
  };

  /**
   * C8: 「最初からやり直す」は当該 flow secret を消し、/login residual recovery が拾わないようにする。
   */
  const restartFromLogin = (flowId: string | undefined): void => {
    if (flowId !== undefined && flowId !== "") {
      try {
        clearAuthFlow(flowId);
      } catch {
        // best-effort
      }
    }
    leaveOnce("/login");
  };

  const applyTerminalResult = (next: AuthCallbackResult): void => {
    hangWatchReturnToRef.current = next.returnTo;
    if (next.kind === "complete") {
      publishCompletionSafely({ flowId: next.flowId, returnTo: next.returnTo });
      leaveSuccess(next.returnTo);
      return;
    }
    if (next.kind === "deposited") {
      stayOnDepositedRef.current = true;
      setResult(next);
      setDepositedExpired(false);
      return;
    }
    if (next.kind === "expired") {
      dismissFlowBestEffort(next.flowId);
      leaveLoginError("magic_link_expired", next.returnTo);
      return;
    }
    if (next.kind === "error") {
      dismissFlowBestEffort(next.flowId);
      leaveLoginError(next.code, next.returnTo);
      return;
    }
    if (next.kind === "awaiting_completion") {
      // I-4: 一時的 awaiting を unbound に落とさない。needs_confirmation UI を維持し再タップ可能にする。
      // token_hash は React state / pending に残り、OTP 未受理なら再試行できる。
      return;
    }
  };

  const confirmMagicLink = (): void => {
    if (result?.kind !== "needs_confirmation" || leftRef.current) return;
    // 同期 ref で二重起動を止め、state の confirmPending は a11y/disabled 用
    if (confirmInFlightRef.current) return;
    confirmInFlightRef.current = true;
    setConfirmPending(true);
    void activeGateway
      .confirmMagicLink({
        flowId: result.flowId,
        tokenHash: result.tokenHash,
        otpType: result.otpType,
        state: result.state,
      })
      .then((next) => {
        applyTerminalResult(next);
      })
      .catch(() => {
        leaveLoginError("unbound_callback", result.returnTo);
      })
      .finally(() => {
        confirmInFlightRef.current = false;
        setConfirmPending(false);
      });
  };

  useEffect(() => {
    const callbackTtlMs = ttlMs ?? getPublicEnv().authContinuationTtlMs;

    if (callbackPromise.current === null) {
      // C7: main bootstrap で未 strip ならここで capture+strip（テスト経路の防御二層）。
      // エッジ access log の初回 URL はインフラ管轄（アプリでは除去不能）。
      captureAndStripAuthCallbackUrl();
      const callbackUrl = takeCapturedAuthCallbackUrl();
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
    // C4 / C9 / C12: authDeadlineRemainingMs（wall 上限 + 負 skew 早期失効）
    const remainingMs = authDeadlineRemainingMs(
      deadlineMs,
      Date.now(),
      flowForDeadline?.clockSkewMs,
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
      // C15/C9: late exchange 成功と watchdog の競合を同期で解決する。
      // completion 済み → success leave。exchange in-flight / callback-prelease 中は secret を焼かず
      // login-error のみ（gateway が後から completion を publish し、他タブ / login の listener が拾える）。
      // C9: claim 成功〜exchange lease 取得前は in-flight が無いが pre-lease で保護する。
      if (flowIdForWatch !== null) {
        const completion = readAuthContinuationCompletion(flowIdForWatch);
        if (completion !== null) {
          leaveSuccess(completion.returnTo);
          return;
        }
        const exchangeBusy = isAuthContinuationExchangeBusy(
          flowIdForWatch,
          window.localStorage,
          Date.now(),
        );
        if (!exchangeBusy) {
          clearAuthFlow(flowIdForWatch);
        }
      }
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
      } else if (next.kind === "needs_confirmation") {
        // token_hash: ユーザー操作まで OTP を消費しない（プレビュー / スキャナ耐性）
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
          // C15: onExpire と late exchange の競合 — completion があれば success へ
          if (authError === "unbound_callback") {
            const completion = readAuthContinuationCompletion(next.flowId);
            if (completion !== null) {
              stopAwaiting();
              leaveSuccess(completion.returnTo);
              return;
            }
            if (isAuthContinuationExchangeBusy(next.flowId, window.localStorage, Date.now())) {
              // exchange / pre-lease 中は secret を残し login-error のみ（completion bus が後から救える）
              stopAwaiting();
              leaveLoginError(authError, next.returnTo);
              return;
            }
          }
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
        // C5: code 無し expired でも secret を即焼かない（state 漏洩経由の DoS を縮める）。
        // C3: dismiss 印で遅延 success の silent complete を防ぎ、TTL / 明示 logout / やり直すで収束。
        dismissFlowBestEffort(next.flowId);
        leaveLoginError("magic_link_expired", next.returnTo);
      } else {
        // 残りは kind: "error" のみ（discriminated union の網羅）。
        // AUTH-1 / C5: unbound と同様、code 無し provider error でも秘密を焼かない。
        // gateway は state mismatch / hash / deposit 失敗で意図的に clear しない。
        // 以前の oauth_cancelled / auth_callback_failed 即 clear は state 一致だけで
        // in-flight 秘密を破壊できた（redirect 初回 URL 観測前提の可用性 DoS）。
        // C3: dismiss 印のみ（secret 温存ロックは維持）。
        dismissFlowBestEffort(next.flowId);
        leaveLoginError(next.code, next.returnTo);
      }
    });
    return () => {
      active = false;
      stopWaiting?.();
      window.clearTimeout(hangWatchdog);
    };
  }, [activeGateway, ttlMs, leaveAuthCallback]);

  if (result?.kind === "needs_confirmation") {
    return (
      <main className="page-frame stack">
        <h1>{depositedExpired ? "ログインの確認期限が切れました" : "ログインを完了します"}</h1>
        <section className="card stack">
          {depositedExpired ? (
            <p>
              確認の有効期限が過ぎました。下のボタンから最初の画面に戻り、ログイン用メールを送り直してください。
            </p>
          ) : (
            <>
              <p>
                メールのリンクを開けました。下のボタンを押すとログインが完了します。プレビューや自動確認だけではログインしません。
              </p>
              <p className="type-small">
                iPhone
                の長押しプレビューだけで開いたあとにエラーになることがあります。この画面で「ログインを完了する」を押してください。
              </p>
            </>
          )}
          {depositedExpired ? (
            <button
              type="button"
              className="primary-button min-h-11"
              onClick={() => {
                // C8: やり直すは当該 flow を clear（residual recovery が拾わない）
                restartFromLogin(result.flowId);
              }}
            >
              最初からやり直す
            </button>
          ) : (
            <button
              type="button"
              className="primary-button min-h-11"
              disabled={confirmPending}
              onClick={() => {
                confirmMagicLink();
              }}
            >
              {confirmPending ? "ログインを完了しています…" : "ログインを完了する"}
            </button>
          )}
        </section>
      </main>
    );
  }

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
          {/* C8: やり直すは当該 flow を clear（same-browser secret 残存 → residual recovery を閉じる） */}
          <button
            type="button"
            className="primary-button min-h-11"
            onClick={() => {
              restartFromLogin(result.flowId);
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
