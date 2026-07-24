import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { useLocation } from "react-router";
import { createAuthGateway, type AuthGateway } from "./auth-gateway";
import type { MagicLinkState } from "./magic-link-state";
import { sanitizeReturnPath } from "./auth-flow";

type LoginLocationState = {
  authError?:
    "oauth_cancelled" | "auth_callback_failed" | "magic_link_expired" | "unbound_callback";
};

function readLoginLocationState(value: unknown): LoginLocationState {
  if (typeof value !== "object" || value === null || !("authError" in value)) return {};
  const authError = value.authError;
  if (
    authError === "oauth_cancelled" ||
    authError === "auth_callback_failed" ||
    authError === "magic_link_expired" ||
    authError === "unbound_callback"
  ) {
    return { authError };
  }
  return {};
}

export function LoginPage({ gateway }: { gateway?: AuthGateway }) {
  const [defaultGateway] = useState<AuthGateway>(() => gateway ?? createAuthGateway());
  const activeGateway = gateway ?? defaultGateway;
  const location = useLocation();
  const locationState = readLoginLocationState(location.state);
  const params = new URLSearchParams(location.search);
  const returnTo = sanitizeReturnPath(params.get("returnTo"));
  const [state, setState] = useState<MagicLinkState>({ status: "idle", email: "" });
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [googleError, setGoogleError] = useState(false);

  useEffect(() => {
    if (state.status !== "sent") return;
    const update = () => {
      setSecondsLeft(
        Math.max(0, Math.ceil((new Date(state.resendAvailableAt).getTime() - Date.now()) / 1_000)),
      );
    };
    update();
    const timer = window.setInterval(update, 1_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [state]);

  const authErrorCopy = useMemo(() => {
    if (locationState.authError === "oauth_cancelled") {
      return "Googleログインがキャンセルされました。もう一度試すか、別の方法を選べます。";
    }
    if (locationState.authError === "auth_callback_failed") {
      return "ログインを確認できませんでした。もう一度お試しください。";
    }
    if (locationState.authError === "magic_link_expired") {
      return "このリンクは期限切れか、すでに使用されています。";
    }
    if (locationState.authError === "unbound_callback") {
      return "ログインの情報を確認できませんでした。最初からやり直してください。";
    }
    return null;
  }, [locationState.authError]);

  // サインアウト / アカウント削除後の案内（クエリは表示用。認証状態は既にクリア済み）
  const statusNotice = useMemo(() => {
    const query = new URLSearchParams(location.search);
    if (query.get("accountDeleted") === "1") {
      return "アカウントを削除しました。ご利用ありがとうございました。";
    }
    if (query.get("signedOut") === "1") {
      return "ログアウトしました。";
    }
    return null;
  }, [location.search]);

  const send = async (event?: SyntheticEvent) => {
    event?.preventDefault();
    const email = "email" in state ? state.email : "";
    setState({ status: "sending", email });
    try {
      const sent = await activeGateway.sendMagicLink(email, returnTo);
      setState({ status: "sent", ...sent });
    } catch {
      setState({
        status: "send_failed",
        email,
        message: "送信できませんでした。通信を確認して、もう一度お試しください。",
      });
    }
  };

  const startGoogle = async (): Promise<void> => {
    setGoogleError(false);
    try {
      await activeGateway.signInWithGoogle(returnTo);
    } catch {
      setGoogleError(true);
    }
  };

  if (state.status === "sent") {
    return (
      <main className="page-frame stack">
        <h1>メールを確認してください</h1>
        <section className="card stack" aria-live="polite">
          <strong>{state.email} に送りました</strong>
          <p>迷惑メールフォルダも確認してください</p>
          <p>リンクを開くと認証を確認します。</p>
          <button
            className="primary-button"
            type="button"
            disabled={secondsLeft > 0}
            onClick={() => void send()}
          >
            {secondsLeft > 0
              ? `${String(secondsLeft)}秒後に再送できます`
              : "ログイン用メールを再送"}
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => {
              setState({ status: "idle", email: state.email });
            }}
          >
            メールアドレスを変更
          </button>
          <button className="secondary-button" type="button" onClick={() => void startGoogle()}>
            Googleに切り替える
          </button>
          {googleError && (
            <p className="error-message" role="alert">
              Googleログインを開始できませんでした。もう一度お試しください。
            </p>
          )}
        </section>
      </main>
    );
  }

  const email = state.status === "verifying" || state.status === "complete" ? "" : state.email;
  return (
    <main className="page-frame stack">
      <div>
        <p className="eyebrow">毎日の献立を、家族に合わせて</p>
        <h1>こんだて日和</h1>
      </div>
      {authErrorCopy !== null && (
        <section className="card stack" role="alert">
          <p className="error-message">{authErrorCopy}</p>
          <p>Googleを再試行、別のGoogleアカウント、またはメールを選べます。</p>
        </section>
      )}
      {statusNotice !== null && (
        <section className="card stack" role="status">
          <p>{statusNotice}</p>
        </section>
      )}
      <button className="primary-button" type="button" onClick={() => void startGoogle()}>
        Googleで続ける
      </button>
      {googleError && (
        <p className="error-message" role="alert">
          Googleログインを開始できませんでした。もう一度お試しください。
        </p>
      )}
      <form className="card stack" onSubmit={(event) => void send(event)}>
        <label className="field">
          <span>メールアドレス</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => {
              setState({ status: "idle", email: event.target.value });
            }}
          />
        </label>
        <button className="secondary-button" disabled={state.status === "sending"} type="submit">
          {state.status === "sending" ? "送信中…" : "ログイン用メールを送る"}
        </button>
        {state.status === "send_failed" && (
          <p className="error-message" role="alert">
            {state.message}
          </p>
        )}
      </form>
    </main>
  );
}
