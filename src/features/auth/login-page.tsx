import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { Navigate, useLocation } from "react-router";
import { createAuthGateway, type AuthGateway } from "./auth-gateway";
import type { MagicLinkState } from "./magic-link-state";
import { sanitizeReturnPath } from "./auth-flow";
import { useAuth } from "./use-auth";

/** 低リテラシー向け：登録とログインが同じ操作であることを明示（MVP 設計の単一画面方針） */
export const LOGIN_PAGE_LEAD =
  "はじめての方も、すでに使っている方も、この画面から進めます。" as const;
export const LOGIN_PAGE_NOTE =
  "新規登録の別画面はありません。下のボタンかメールで進むと、はじめての方はアカウントができます。パスワードの設定は不要です。" as const;
export const LOGIN_EMAIL_HINT =
  "届いたメールのリンクを開くと入れます。はじめてのメールアドレスでも大丈夫です。" as const;

type LoginLocationState = {
  authError?:
    "oauth_cancelled" | "auth_callback_failed" | "magic_link_expired" | "unbound_callback";
};

/** 期限切れ復帰用。秘密は載せず、直近に送った宛先メールだけを短寿命で覚える（B-I8）。 */
const lastMagicEmailStorageKey = "kondate.auth.lastMagicEmail";

function readLastMagicEmail(): string {
  try {
    return sessionStorage.getItem(lastMagicEmailStorageKey) ?? "";
  } catch {
    return "";
  }
}

function rememberLastMagicEmail(email: string): void {
  try {
    if (email.trim() === "") {
      sessionStorage.removeItem(lastMagicEmailStorageKey);
      return;
    }
    sessionStorage.setItem(lastMagicEmailStorageKey, email.trim());
  } catch {
    // sessionStorage 拒否時は期限切れ復元を諦めるだけ
  }
}

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
  const auth = useAuth();
  const [defaultGateway] = useState<AuthGateway>(() => gateway ?? createAuthGateway());
  const activeGateway = gateway ?? defaultGateway;
  const location = useLocation();
  const locationState = readLoginLocationState(location.state);
  const params = new URLSearchParams(location.search);
  // 明示的な復帰先は従来どおり安全化し、指定がない初回ログインだけ使い方の案内へ導く。
  const returnTo = params.has("returnTo") ? sanitizeReturnPath(params.get("returnTo")) : "/welcome";
  const [state, setState] = useState<MagicLinkState>(() => {
    // マジックリンク期限切れは送信済み文脈へ戻す（再入力を強いない）
    if (locationState.authError === "magic_link_expired") {
      return { status: "expired", email: readLastMagicEmail() };
    }
    return { status: "idle", email: "" };
  });
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [googleError, setGoogleError] = useState(false);
  const [googlePending, setGooglePending] = useState(false);

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
      return "アカウントを削除しました。不正利用防止のため、利用回数の記録だけは残ることがあります。ご利用ありがとうございました。";
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
      rememberLastMagicEmail(sent.email);
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
    if (googlePending) return;
    setGoogleError(false);
    setGooglePending(true);
    try {
      await activeGateway.signInWithGoogle(returnTo);
    } catch {
      setGoogleError(true);
      setGooglePending(false);
    }
  };

  // 既にセッションがある場合はフォームを出さず returnTo へ進める
  if (auth.status === "authenticated") {
    return <Navigate to={returnTo} replace />;
  }
  if (auth.status === "loading") {
    return (
      <main className="page-frame stack">
        <p>読み込み中…</p>
      </main>
    );
  }

  // 送信済み・期限切れは同一文脈（宛先・再送・変更・Google）でやり直せる（B-I8 / L174 / L644）
  if (state.status === "sent" || state.status === "expired") {
    const emailLabel = state.email.trim() === "" ? "メール" : state.email;
    const resendDisabled = state.status === "sent" && secondsLeft > 0;
    return (
      <main className="page-frame stack">
        <h1>
          {state.status === "expired" ? "リンクの期限が切れました" : "メールを確認してください"}
        </h1>
        <section className="card stack" aria-live="polite">
          {state.status === "expired" && (
            <p className="error-message" role="alert">
              {authErrorCopy ?? "このリンクは期限切れか、すでに使用されています。"}
            </p>
          )}
          {state.email.trim() !== "" ? (
            <strong>{state.email} に送りました</strong>
          ) : (
            <strong>ログイン用メールを再送できます</strong>
          )}
          <p>迷惑メールフォルダも確認してください</p>
          <p>
            {state.status === "expired"
              ? "新しいログイン用メールを送って、もう一度お試しください。"
              : "リンクを開くと認証を確認します。"}
          </p>
          <button
            className="primary-button"
            type="button"
            disabled={resendDisabled || state.email.trim() === ""}
            onClick={() => void send()}
          >
            {resendDisabled
              ? `${String(secondsLeft)}秒後に再送できます`
              : state.email.trim() === ""
                ? "メールアドレスを入力して再送"
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
          <button
            className="secondary-button"
            type="button"
            disabled={googlePending}
            onClick={() => void startGoogle()}
          >
            {googlePending ? "Googleへ移動中…" : "Googleに切り替える"}
          </button>
          {googleError && (
            <p className="error-message" role="alert">
              Googleログインを開始できませんでした。もう一度お試しください。
            </p>
          )}
          {state.email.trim() === "" && (
            <p className="type-small">
              宛先が分からないときは、下でメールアドレスを変更してください。
            </p>
          )}
          {/* emailLabel は aria 用の文脈。表示は上の strong で足りる */}
          <span className="sr-only">{emailLabel}</span>
        </section>
      </main>
    );
  }

  const email = state.status === "verifying" || state.status === "complete" ? "" : state.email;
  return (
    <main className="page-frame stack">
      <div className="stack gap-2">
        <p className="eyebrow">毎日の献立を、家族に合わせて</p>
        <h1>こんだて日和</h1>
        <p>{LOGIN_PAGE_LEAD}</p>
        <p className="type-small">{LOGIN_PAGE_NOTE}</p>
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
      <button
        className="primary-button min-h-11"
        type="button"
        disabled={googlePending}
        onClick={() => void startGoogle()}
      >
        {googlePending ? "Googleへ移動中…" : "Googleで続ける"}
      </button>
      <p className="type-small">Google アカウントではじめての方も、そのまま使えます。</p>
      {googleError && (
        <p className="error-message" role="alert">
          Googleログインを開始できませんでした。もう一度お試しください。
        </p>
      )}
      <form className="card stack" onSubmit={(event) => void send(event)}>
        <p className="type-small">メールで進む場合</p>
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
        <p className="type-small">{LOGIN_EMAIL_HINT}</p>
        <button
          className="secondary-button min-h-11"
          disabled={state.status === "sending"}
          type="submit"
        >
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
