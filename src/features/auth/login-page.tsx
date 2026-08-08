import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { Navigate, useLocation } from "react-router";
import { accountDeletionAnonymousShareNote } from "@/features/privacy/privacy-copy";
import { createAuthGateway, type AuthGateway } from "./auth-gateway";
import type { MagicLinkState } from "./magic-link-state";
import { sanitizeLoginReturnPath } from "./auth-flow";
import { useAuth } from "./use-auth";
import { useAuthLoadingDeadline } from "./use-auth-loading-deadline";

/** 低リテラシー向け：登録とログインが同じ操作であることを明示（MVP 設計の単一画面方針） */
export const LOGIN_PAGE_LEAD =
  "はじめての方も、すでに使っている方も、この画面から進めます。" as const;
/** Google のみ表示時（メール導線をいったん隠している間） */
export const LOGIN_PAGE_NOTE =
  "新規登録の別画面はありません。下のボタンで進むと、はじめての方はアカウントができます。" as const;
/** メール導線を出すときの補足（SHOW_EMAIL_LOGIN / ?emailLogin=1 / 復旧導線） */
export const LOGIN_PAGE_NOTE_WITH_EMAIL =
  "新規登録の別画面はありません。下のボタンかメールで進むと、はじめての方はアカウントができます。パスワードの設定は不要です。" as const;
export const LOGIN_EMAIL_HINT =
  "届いたメールのリンクを開くと入れます。はじめてのメールアドレスでも大丈夫です。" as const;

/**
 * ログイン画面のメール（マジックリンク）導線を表示する。
 * false にするとフォームを隠し、`?emailLogin=1` または期限切れ復帰などで再表示できる。
 * （boolean 注釈は定数切替時に lint の always-falsy を避けるため）
 */
export const SHOW_EMAIL_LOGIN: boolean = true;

function emailLoginRequested(search: string): boolean {
  if (SHOW_EMAIL_LOGIN) return true;
  return new URLSearchParams(search).get("emailLogin") === "1";
}

type LoginLocationState = {
  authError?:
    "oauth_cancelled" | "auth_callback_failed" | "magic_link_expired" | "unbound_callback";
};

/** 期限切れ復帰用。秘密は載せず、直近に送った宛先メールだけを短寿命で覚える（B-I8）。 */
const lastMagicEmailStorageKey = "kondate.auth.lastMagicEmail";
/**
 * U1-I2 / B-I9: 送信済み UI の再表示用（秘密は載せない）。
 * リロード後も「送信済み・再送まで Ns」を復元し、無意味な再送で live secret を焼かない。
 */
const magicSentUiStorageKey = "kondate.auth.magicSentUi";
/**
 * C13: 未完了マジックの PII を sessionStorage に長く残さない。
 * 共有端末での宛先露出窓を縮めるため continuation TTL（5 分）より短い 60s にする。
 * 認証成功時と logout cleanup でも消す。
 */
const MAGIC_RESIDUAL_TTL_MS = 60_000;

type MagicSentUiSnapshot = {
  email: string;
  flowId: string;
  resendAvailableAt: string;
  /** 保存時刻。無い（旧形式）は即無効として消す */
  storedAt: string;
};

type LastMagicEmailSnapshot = {
  email: string;
  storedAt: string;
};

function isFreshStoredAt(storedAt: string, nowMs: number = Date.now()): boolean {
  const storedMs = Date.parse(storedAt);
  if (Number.isNaN(storedMs)) return false;
  return nowMs - storedMs <= MAGIC_RESIDUAL_TTL_MS;
}

function readLastMagicEmail(): string {
  try {
    const raw = sessionStorage.getItem(lastMagicEmailStorageKey);
    if (raw === null) return "";
    // 旧形式: 素のメール文字列。TTL が無いので共有端末リスクがあり即捨てる（C10）
    if (!raw.startsWith("{")) {
      sessionStorage.removeItem(lastMagicEmailStorageKey);
      return "";
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      sessionStorage.removeItem(lastMagicEmailStorageKey);
      return "";
    }
    const email = "email" in parsed ? parsed.email : null;
    const storedAt = "storedAt" in parsed ? parsed.storedAt : null;
    if (
      typeof email !== "string" ||
      email.trim() === "" ||
      typeof storedAt !== "string" ||
      !isFreshStoredAt(storedAt)
    ) {
      sessionStorage.removeItem(lastMagicEmailStorageKey);
      return "";
    }
    return email.trim();
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
    const snapshot: LastMagicEmailSnapshot = {
      email: email.trim(),
      storedAt: new Date().toISOString(),
    };
    sessionStorage.setItem(lastMagicEmailStorageKey, JSON.stringify(snapshot));
  } catch {
    // sessionStorage 拒否時は期限切れ復元を諦めるだけ
  }
}

function readMagicSentUi(): MagicSentUiSnapshot | null {
  try {
    const raw = sessionStorage.getItem(magicSentUiStorageKey);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const email = "email" in parsed ? parsed.email : null;
    const flowId = "flowId" in parsed ? parsed.flowId : null;
    const resendAvailableAt = "resendAvailableAt" in parsed ? parsed.resendAvailableAt : null;
    const storedAt = "storedAt" in parsed ? parsed.storedAt : null;
    if (
      typeof email !== "string" ||
      email.trim() === "" ||
      typeof flowId !== "string" ||
      flowId.length === 0 ||
      typeof resendAvailableAt !== "string" ||
      Number.isNaN(Date.parse(resendAvailableAt)) ||
      typeof storedAt !== "string" ||
      !isFreshStoredAt(storedAt)
    ) {
      // C10: 期限切れ・旧形式は残さず消す
      sessionStorage.removeItem(magicSentUiStorageKey);
      return null;
    }
    return {
      email: email.trim(),
      flowId,
      resendAvailableAt,
      storedAt,
    };
  } catch {
    return null;
  }
}

function rememberMagicSentUi(
  snapshot: Omit<MagicSentUiSnapshot, "storedAt"> | MagicSentUiSnapshot | null,
): void {
  try {
    if (snapshot === null) {
      sessionStorage.removeItem(magicSentUiStorageKey);
      return;
    }
    const existingStoredAt =
      "storedAt" in snapshot && typeof snapshot.storedAt === "string" ? snapshot.storedAt : null;
    const withTtl: MagicSentUiSnapshot = {
      email: snapshot.email,
      flowId: snapshot.flowId,
      resendAvailableAt: snapshot.resendAvailableAt,
      storedAt: existingStoredAt ?? new Date().toISOString(),
    };
    sessionStorage.setItem(magicSentUiStorageKey, JSON.stringify(withTtl));
  } catch {
    // sessionStorage 拒否時は sent UI 復元を諦めるだけ
  }
}

/** C10: マウント時に期限切れ residual をまとめて捨てる（読まないキーが残らないようにする） */
function purgeExpiredMagicResiduals(): void {
  // read* は期限切れを remove する副作用付き
  void readLastMagicEmail();
  void readMagicSentUi();
}

function initialMagicLinkState(
  authError: LoginLocationState["authError"],
  search: string,
): MagicLinkState {
  purgeExpiredMagicResiduals();
  // マジックリンク期限切れは送信済み文脈へ戻す（再入力を強いない）
  if (authError === "magic_link_expired") {
    return { status: "expired", email: readLastMagicEmail() };
  }
  // サインアウト / アカウント削除 / セッション失効の案内は idle フォーム上の status で出す。
  // sent UI 再水和が優先されると案内が消える（account-deletion E2E）。
  const query = new URLSearchParams(search);
  if (
    query.get("accountDeleted") === "1" ||
    query.get("signedOut") === "1" ||
    query.get("sessionExpired") === "1"
  ) {
    rememberMagicSentUi(null);
    return { status: "idle", email: "" };
  }
  // U1-I2: リロード後も sent UI を復元（再送クールダウン中は特に重要）
  const sent = readMagicSentUi();
  if (sent !== null) {
    // storedAt は storage 用メタ。MagicLinkState には載せない
    return {
      status: "sent",
      email: sent.email,
      flowId: sent.flowId,
      resendAvailableAt: sent.resendAvailableAt,
    };
  }
  return { status: "idle", email: "" };
}

function isAuthErrorCode(value: unknown): value is NonNullable<LoginLocationState["authError"]> {
  return (
    value === "oauth_cancelled" ||
    value === "auth_callback_failed" ||
    value === "magic_link_expired" ||
    value === "unbound_callback"
  );
}

function readLoginLocationState(value: unknown): LoginLocationState {
  if (typeof value !== "object" || value === null || !("authError" in value)) return {};
  const authError = value.authError;
  if (isAuthErrorCode(authError)) {
    return { authError };
  }
  return {};
}

/** history.state に加え、callback の location.replace 用クエリも読む（iOS フル遷移）。 */
function readLoginAuthError(state: unknown, search: string): LoginLocationState {
  const fromState = readLoginLocationState(state);
  if (fromState.authError !== undefined) return fromState;
  const authError = new URLSearchParams(search).get("authError");
  if (isAuthErrorCode(authError)) {
    return { authError };
  }
  return {};
}

export function LoginPage({ gateway }: { gateway?: AuthGateway }) {
  const auth = useAuth();
  const [defaultGateway] = useState<AuthGateway>(() => gateway ?? createAuthGateway());
  const activeGateway = gateway ?? defaultGateway;
  const location = useLocation();
  const locationState = readLoginAuthError(location.state, location.search);
  const params = new URLSearchParams(location.search);
  // 明示的な復帰先は安全化し、/login・/auth/callback 自己参照は載せない（C1）。
  // 指定がない初回ログインだけ使い方の案内へ導く。
  const returnTo = params.has("returnTo")
    ? sanitizeLoginReturnPath(params.get("returnTo"), "/welcome")
    : "/welcome";
  // C14: AuthProvider 15s 主防衛の二次防衛（RequireSession / RootGate と同型）
  const { showLoading } = useAuthLoadingDeadline(auth.status);
  const [state, setState] = useState<MagicLinkState>(() =>
    initialMagicLinkState(locationState.authError, location.search),
  );
  // 既定は非表示。クエリ・期限切れ・送信済み復元・「メールアドレスを変更」でフォームを出す。
  const [emailUnlocked, setEmailUnlocked] = useState(() => {
    if (emailLoginRequested(location.search)) return true;
    if (locationState.authError === "magic_link_expired") return true;
    const query = new URLSearchParams(location.search);
    if (
      query.get("accountDeleted") === "1" ||
      query.get("signedOut") === "1" ||
      query.get("sessionExpired") === "1"
    ) {
      return false;
    }
    return readMagicSentUi() !== null;
  });
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [googleError, setGoogleError] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const showEmailSection =
    emailUnlocked ||
    state.status === "sending" ||
    state.status === "send_failed" ||
    state.status === "sent" ||
    state.status === "expired";

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

  // サインアウト / アカウント削除 / セッション失効の案内（クエリは表示用。認証状態は既にクリア済み）
  const statusNotice = useMemo(() => {
    const query = new URLSearchParams(location.search);
    if (query.get("accountDeleted") === "1") {
      // AP8: 方針 B（匿名共有 pool 残存）を成功バナーでも再掲（DangerZone と単一ソース）
      return `アカウントを削除しました。不正利用防止のため、利用回数の記録だけは残ることがあります。${accountDeletionAnonymousShareNote}ご利用ありがとうございました。`;
    }
    if (query.get("signedOut") === "1") {
      return "ログアウトしました。";
    }
    if (query.get("sessionExpired") === "1") {
      return "ログインの有効期限が切れたか、別の端末でログアウトされたため、もう一度ログインしてください。";
    }
    return null;
  }, [location.search]);

  const send = async (event?: SyntheticEvent) => {
    event?.preventDefault();
    const email = "email" in state ? state.email : "";
    setEmailUnlocked(true);
    setState({ status: "sending", email });
    try {
      const sent = await activeGateway.sendMagicLink(email, returnTo);
      rememberLastMagicEmail(sent.email);
      rememberMagicSentUi({
        email: sent.email,
        flowId: sent.flowId,
        resendAvailableAt: sent.resendAvailableAt,
      });
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

  // ログイン成功後はマジックリンク宛先の PII を sessionStorage に残さない（C9）
  useEffect(() => {
    if (auth.status !== "authenticated") return;
    rememberLastMagicEmail("");
    rememberMagicSentUi(null);
  }, [auth.status]);

  // 既にセッションがある場合はフォームを出さず returnTo へ進める
  if (auth.status === "authenticated") {
    return <Navigate to={returnTo} replace />;
  }
  // deadline 超過後は未ログイン UI（フォーム）へフォールスルーする
  if (showLoading) {
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
              setEmailUnlocked(true);
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
        <p className="type-small">
          {showEmailSection ? LOGIN_PAGE_NOTE_WITH_EMAIL : LOGIN_PAGE_NOTE}
        </p>
      </div>
      {authErrorCopy !== null && (
        <section className="card stack" role="alert">
          <p className="error-message">{authErrorCopy}</p>
          <p>
            {showEmailSection
              ? "Googleを再試行、別のGoogleアカウント、またはメールを選べます。"
              : "Googleを再試行するか、別のGoogleアカウントを選べます。"}
          </p>
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
      {showEmailSection && (
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
      )}
    </main>
  );
}
