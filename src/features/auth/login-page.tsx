import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { Navigate, useLocation } from "react-router";
import {
  accountDeletionAnonymousShareNote,
  accountDeletionOtherDeviceNote,
  accountDeletionStripeResidualNote,
  accountDeletionThisDeviceResidualNote,
} from "@/features/privacy/privacy-copy";
import { LivePendingMain } from "@/shared/ui/feedback";
import {
  abortInFlightResumeFlows,
  clearLeftoverLoginSessionIfNoSiblingCompletion,
  createAuthGateway,
  protectPkceVerifierFromLateLeftoverSignOut,
  type AuthGateway,
} from "./auth-gateway";
import { readLiveAuthSessionMark, writeLiveAuthSessionMark } from "./live-auth-session-mark";
import type { EmailOtpLoginState } from "./magic-link-state";
import {
  clearAuthFlow,
  defaultAuthContinuationTtlMs,
  markAuthFlowUserDismissed,
  readAuthFlow,
  sanitizeLoginReturnPath,
  writeSessionActiveLoginFlowId,
} from "./auth-flow";
import {
  clearTabLocalResidualRecoveryDisarm,
  notifySoftResidualRecoveryDisarm,
  notifySoftResidualRecoveryRearm,
} from "./soft-residual-recovery-suppress";
import {
  EMAIL_OTP_CHANGE_EMAIL,
  EMAIL_OTP_GOOGLE_BUTTON,
  EMAIL_OTP_GOOGLE_START_FAILED,
  EMAIL_OTP_GOOGLE_STARTING,
  EMAIL_OTP_LOGIN_LEAD,
  EMAIL_OTP_LOGIN_NOTE,
  EMAIL_OTP_MISMATCH,
  EMAIL_OTP_RESEND_BUTTON,
  EMAIL_OTP_SEND_BUTTON,
  EMAIL_OTP_SEND_FAILED,
  EMAIL_OTP_SENDING,
  EMAIL_OTP_SWITCH_TO_GOOGLE,
  EMAIL_OTP_UNAVAILABLE,
  EMAIL_OTP_WAITING_BODY,
  EMAIL_OTP_WAITING_HEADING,
  EMAIL_OTP_WAITING_HINT,
  emailOtpResendWaitSeconds,
  emailOtpSentTo,
} from "./email-otp-copy";
import { normalizeOtpDigits, OtpDigitField } from "./otp-digit-field";
import { useAuth } from "./use-auth";

/** 低リテラシー向け：登録とログインが同じ操作であることを明示（MVP 設計の単一画面方針） */
export const LOGIN_PAGE_LEAD = EMAIL_OTP_LOGIN_LEAD;
/** Google のみ表示時（メール導線をいったん隠している間） */
export const LOGIN_PAGE_NOTE =
  "新規登録の別画面はありません。下のボタンで進むと、はじめての方はアカウントができます。" as const;
/** メール導線を出すときの補足（SHOW_EMAIL_LOGIN / ?emailLogin=1 / 復旧導線） */
export const LOGIN_PAGE_NOTE_WITH_EMAIL = EMAIL_OTP_LOGIN_NOTE;

/**
 * ログイン画面のメール導線を表示する。
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
 * 番号待ち UI の再表示用（秘密は載せない）。
 * リロード後も「送信済み・再送まで Ns」を復元し、無意味な再送を避ける。
 * 番号も returnTo も書かない。
 */
const magicSentUiStorageKey = "kondate.auth.magicSentUi";
/**
 * leftover-capable でも番号成功 session を残す印。
 * component ref は再マウントで消えるので sessionStorage を正とする。
 * storedAt のみ。番号 / メール / returnTo は載せない。
 */
const emailOtpCompletedStorageKey = "kondate.auth.emailOtpCompleted";
/**
 * C13: 未完了マジックの PII を sessionStorage に長く残さない。
 * 共有端末での宛先露出窓を縮めるため continuation TTL（5 分）より短い 60s にする。
 * 認証成功時と logout cleanup でも消す。
 */
const MAGIC_RESIDUAL_TTL_MS = 60_000;

type WaitingUiSnapshot = {
  email: string;
  resendAvailableAt: string;
  /** 保存時刻。無い（旧形式）は即無効として消す */
  storedAt: string;
};

type LastMagicEmailSnapshot = {
  email: string;
  storedAt: string;
};

type EmailOtpCompletedSnapshot = {
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

function readWaitingUi(): WaitingUiSnapshot | null {
  try {
    const raw = sessionStorage.getItem(magicSentUiStorageKey);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const email = "email" in parsed ? parsed.email : null;
    const resendAvailableAt = "resendAvailableAt" in parsed ? parsed.resendAvailableAt : null;
    const storedAt = "storedAt" in parsed ? parsed.storedAt : null;
    if (
      typeof email !== "string" ||
      email.trim() === "" ||
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
      resendAvailableAt,
      storedAt,
    };
  } catch {
    return null;
  }
}

function rememberWaitingUi(
  snapshot: Omit<WaitingUiSnapshot, "storedAt"> | WaitingUiSnapshot | null,
): void {
  try {
    if (snapshot === null) {
      sessionStorage.removeItem(magicSentUiStorageKey);
      return;
    }
    const existingStoredAt =
      "storedAt" in snapshot && typeof snapshot.storedAt === "string" ? snapshot.storedAt : null;
    const withTtl: WaitingUiSnapshot = {
      email: snapshot.email,
      resendAvailableAt: snapshot.resendAvailableAt,
      storedAt: existingStoredAt ?? new Date().toISOString(),
    };
    sessionStorage.setItem(magicSentUiStorageKey, JSON.stringify(withTtl));
  } catch {
    // sessionStorage 拒否時は sent UI 復元を諦めるだけ
  }
}

function writeEmailOtpCompletedMark(): void {
  try {
    const snapshot: EmailOtpCompletedSnapshot = { storedAt: new Date().toISOString() };
    sessionStorage.setItem(emailOtpCompletedStorageKey, JSON.stringify(snapshot));
  } catch {
    // 印が書けなくても Navigate はする。再マウント leftover 掃除は残差
  }
  // C1/C3: 同一タブ 60s 印に加え、origin 共有 live 印を立てて他タブ leftover 掃除から守る
  writeLiveAuthSessionMark();
}

function isFreshEmailOtpCompleted(nowMs: number = Date.now()): boolean {
  try {
    const raw = sessionStorage.getItem(emailOtpCompletedStorageKey);
    if (raw === null) return false;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      sessionStorage.removeItem(emailOtpCompletedStorageKey);
      return false;
    }
    const storedAt = "storedAt" in parsed ? parsed.storedAt : null;
    if (typeof storedAt !== "string" || !isFreshStoredAt(storedAt, nowMs)) {
      sessionStorage.removeItem(emailOtpCompletedStorageKey);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * C4: OTP 送信/待ち中のタブが origin 共有 sibling Google pin を residual claim しない。
 * sessionStorage だけを別 UUID で上書きし、localStorage の開始タブ pin は残す。
 * 書けたときだけ true。失敗時は origin 共有 pin のままなので re-arm してはいけない（N2）。
 */
function pinThisTabAwayFromSharedLoginFlow(): boolean {
  try {
    return writeSessionActiveLoginFlowId(crypto.randomUUID());
  } catch {
    return false;
  }
}

/**
 * N1/N2/C4: OTP 送信/待ち開始でこのタブを sibling Google residual から切り離す。
 * - 既走 resume を abort し、exchange 後も completion で Navigate しない（N1）
 * - pin 成功時だけ re-arm して dummy UUID に restrict する（C4）
 * - pin 失敗時は re-arm せずタブ局所 disarm で residual を止める（N2）
 */
function isolateThisTabFromSharedLoginResidual(): void {
  abortInFlightResumeFlows();
  if (pinThisTabAwayFromSharedLoginFlow()) {
    clearTabLocalResidualRecoveryDisarm();
    notifySoftResidualRecoveryRearm();
    return;
  }
  notifySoftResidualRecoveryDisarm();
}

/**
 * 番号成功直前に未期限切れの Google / authorization_code と残存 token_hash を捨てる。
 * 完了 id が無いので clearSiblingUnexpiredAuthFlows は呼ばない（空文字で全消しもしない）。
 */
function dismissUnexpiredSiblingAuthFlowsForEmailOtp(storage: Storage = window.localStorage): void {
  const prefix = "kondate.auth.flow.";
  const nowMs = Date.now();
  const flowIds: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix) === true) {
      flowIds.push(key.slice(prefix.length));
    }
  }
  for (const flowId of flowIds) {
    const existing = readAuthFlow(flowId, storage);
    if (existing === null) continue;
    const startedMs = Date.parse(existing.startedAt);
    if (Number.isNaN(startedMs) || nowMs - startedMs > defaultAuthContinuationTtlMs) continue;
    markAuthFlowUserDismissed(existing.id, storage);
    clearAuthFlow(existing.id, storage);
  }
}

/** C10: マウント時に期限切れ residual をまとめて捨てる（読まないキーが残らないようにする） */
function purgeExpiredMagicResiduals(): void {
  // read* は期限切れを remove する副作用付き
  void readLastMagicEmail();
  void readWaitingUi();
  void isFreshEmailOtpCompleted();
}

function initialEmailOtpState(
  authError: LoginLocationState["authError"],
  search: string,
): EmailOtpLoginState {
  purgeExpiredMagicResiduals();
  // 旧リンク期限切れは idle に戻し、宛先だけあれば再送できるようにする
  if (authError === "magic_link_expired") {
    return { status: "idle", email: readLastMagicEmail() };
  }
  // サインアウト / アカウント削除 / セッション失効の案内は idle フォーム上の status で出す。
  // sent UI 再水和が優先されると案内が消える（account-deletion E2E）。
  const query = new URLSearchParams(search);
  if (
    query.get("accountDeleted") === "1" ||
    query.get("signedOut") === "1" ||
    query.get("sessionExpired") === "1"
  ) {
    rememberWaitingUi(null);
    return { status: "idle", email: "" };
  }
  // U1-I2: リロード後も番号待ち UI を復元（再送クールダウン中は特に重要）
  const sent = readWaitingUi();
  if (sent !== null) {
    // C4: 復元時点で session pin を外し、AuthProvider residual が sibling Google を拾わない
    pinThisTabAwayFromSharedLoginFlow();
    return {
      status: "waiting",
      email: sent.email,
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

/**
 * leftover session を伴い得る leave。authenticated でも Navigate せず
 * エラー + Google CTA を出す（C2 / C-R2 / C-R3）。
 * 個別コードは列挙しない。authError（query / history.state）がある leave は
 * leftover を伴い得る（oauth_cancelled / unbound_callback / auth_callback_failed /
 * magic_link_expired）。query 無し /login は restart として現状どおり残す。
 */
function isLeftoverCapableLoginLeave(
  authError: LoginLocationState["authError"],
  search: string,
): boolean {
  if (authError !== undefined || new URLSearchParams(search).has("authError")) {
    return true;
  }
  return search === "" || search === "?";
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
  // 指定がない初回ログインだけ使い方の案内へ導く。login 成功既定は /welcome。
  const returnTo = params.has("returnTo")
    ? sanitizeLoginReturnPath(params.get("returnTo"), "/welcome")
    : "/welcome";
  const [state, setState] = useState<EmailOtpLoginState>(() =>
    initialEmailOtpState(locationState.authError, location.search),
  );
  const [otpDigits, setOtpDigits] = useState("");
  const [otpError, setOtpError] = useState<"mismatch" | "unavailable" | null>(null);
  // 同期 in-flight。useState だけだと StrictMode remount で戻り二重 verify する
  const verifyInFlightRef = useRef(false);
  // C-R4: leftover 待ち中の Google 開始を OTP verify より先に同期で排他する
  const googleInFlightRef = useRef(false);
  const requestSeqRef = useRef(0);
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
    return readWaitingUi() !== null;
  });
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [googleError, setGoogleError] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const leftoverCapable = isLeftoverCapableLoginLeave(locationState.authError, location.search);
  const otpCompletedFresh = isFreshEmailOtpCompleted();
  // C1/C3/C5: origin 共有 committed live。TTL 切れ番号印がなくても leftover ではない
  const liveSessionCommitted = readLiveAuthSessionMark() !== null;
  const showEmailSection =
    emailUnlocked ||
    state.status === "sending" ||
    state.status === "send_failed" ||
    state.status === "waiting" ||
    state.status === "verifying";

  const isOtpWaiting = state.status === "waiting" || state.status === "verifying";
  useEffect(() => {
    if (!isOtpWaiting) return;
    // 待ち UI 復元（リロード / remount）でも既走 residual を止める。送信成功は send() でも isolate する。
    isolateThisTabFromSharedLoginResidual();
  }, [isOtpWaiting]);

  useEffect(() => {
    if (state.status !== "waiting" && state.status !== "verifying") return;
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
      // AP8/AP9: 方針 B + Stripe + 他端末を成功バナーでも再掲（dialog と単一ソース）
      // AP8: 当該端末の掃除失敗は localResidual=1 のときだけ追加
      const thisDeviceResidual =
        query.get("localResidual") === "1" ? accountDeletionThisDeviceResidualNote : "";
      return `アカウントを削除しました。不正利用防止のため、利用回数の記録だけは残ることがあります。${accountDeletionAnonymousShareNote}${accountDeletionStripeResidualNote}${accountDeletionOtherDeviceNote}${thisDeviceResidual}ご利用ありがとうございました。`;
    }
    if (query.get("signedOut") === "1") {
      return "ログアウトしました。";
    }
    if (query.get("sessionExpired") === "1") {
      return "ログインの有効期限が切れたか、別の端末でログアウトされたため、もう一度ログインしてください。";
    }
    return null;
  }, [location.search]);

  const beginExclusive = (): boolean => {
    if (verifyInFlightRef.current) return false;
    verifyInFlightRef.current = true;
    return true;
  };

  const endExclusive = (): void => {
    verifyInFlightRef.current = false;
  };

  const discardWaiting = (email: string): void => {
    rememberWaitingUi(null);
    setOtpDigits("");
    setOtpError(null);
    setState({ status: "idle", email });
  };

  const send = async (event?: SyntheticEvent) => {
    event?.preventDefault();
    if (!beginExclusive()) return;
    const email = "email" in state ? state.email : "";
    const seq = ++requestSeqRef.current;
    setEmailUnlocked(true);
    setOtpError(null);
    setState({ status: "sending", email });
    try {
      const sent = await activeGateway.sendEmailOtp(email);
      if (seq !== requestSeqRef.current) return;
      rememberLastMagicEmail(sent.email);
      rememberWaitingUi({
        email: sent.email,
        resendAvailableAt: sent.resendAvailableAt,
      });
      // C4/N1/N2: 送信成功後に自タブを sibling Google residual から切り離す
      isolateThisTabFromSharedLoginResidual();
      setOtpDigits("");
      setState({
        status: "waiting",
        email: sent.email,
        resendAvailableAt: sent.resendAvailableAt,
      });
    } catch {
      if (seq !== requestSeqRef.current) return;
      setState({
        status: "send_failed",
        email,
        message: EMAIL_OTP_SEND_FAILED,
      });
    } finally {
      if (seq === requestSeqRef.current) endExclusive();
    }
  };

  const verifyDigits = (digits: string, email: string, resendAvailableAt: string): void => {
    if (digits.length !== 6) return;
    // C-R4: leftover 待ち中の Google 開始と番号確認を並走させない
    if (googleInFlightRef.current || googlePending) return;
    if (!beginExclusive()) return;
    const seq = ++requestSeqRef.current;
    setState({ status: "verifying", email, resendAvailableAt });
    void activeGateway
      .verifyEmailOtp({ email, token: digits })
      .then((result) => {
        if (seq !== requestSeqRef.current) return;
        if (result.kind === "complete") {
          // sibling を先に捨て、印を書いてから Navigate する（ref だけを正にしない）
          dismissUnexpiredSiblingAuthFlowsForEmailOtp();
          writeEmailOtpCompletedMark();
          rememberLastMagicEmail("");
          rememberWaitingUi(null);
          setOtpDigits("");
          setOtpError(null);
          setState({ status: "complete" });
          endExclusive();
          return;
        }
        if (result.kind === "mismatch") {
          setOtpDigits("");
          setOtpError("mismatch");
        } else {
          setOtpError("unavailable");
        }
        setState({ status: "waiting", email, resendAvailableAt });
        endExclusive();
      })
      .catch(() => {
        if (seq !== requestSeqRef.current) return;
        setOtpError("unavailable");
        setState({ status: "waiting", email, resendAvailableAt });
        endExclusive();
      });
  };

  const handleOtpChange = (next: string, email: string, resendAvailableAt: string): void => {
    // OtpDigitField は composition 中 onChange しない。親も 6 桁揃い以外では verify しない
    const digits = normalizeOtpDigits(next);
    setOtpDigits(digits);
    if (otpError !== null) setOtpError(null);
    if (digits.length === 6) {
      verifyDigits(digits, email, resendAvailableAt);
    }
  };

  // leftover-capable の local signOut を startGoogle が待つ（C2）。
  // 2s で掃除は終わり Google を開始する（C-R3: hang で CTA を永久 disable しない）。
  // timeout 後の後着 _removeSession は protect で新規 verifier を消さない（C-R2）。
  const leftoverCleanupRef = useRef<Promise<void>>(Promise.resolve());

  const startGoogle = async (): Promise<void> => {
    if (googlePending || googleInFlightRef.current) return;
    // C5: 番号確認中は Google を並走させない。書いた B を leftover / discard と競合させない。
    if (verifyInFlightRef.current) return;
    if (state.status === "verifying" || state.status === "sending") return;
    setGoogleError(false);
    googleInFlightRef.current = true;
    setGooglePending(true);
    try {
      await leftoverCleanupRef.current.catch(() => undefined);
      await activeGateway.signInWithGoogle(returnTo);
      // 注入 gateway は SDK を通さないので、OAuth 直後に控えを取る
      protectPkceVerifierFromLateLeftoverSignOut();
      // 開始成功後はその番号では確認しない（sibling §4.3）
      requestSeqRef.current += 1;
      verifyInFlightRef.current = false;
      discardWaiting("email" in state ? state.email : "");
    } catch {
      googleInFlightRef.current = false;
      setGoogleError(true);
      setGooglePending(false);
    }
  };

  // C-R4: Login は pin 前に leftover persist を local signOut する。
  // 番号成功印が新鮮、または origin 共有 live 印が指紋と一致すれば leftover ではない。
  // C1: unmount / 印書き込み後の late .then で leftover を再起動しない。
  // C4: 番号待ち snapshot でも leftover persist は掃く（待ちと leftover pin の衝突を閉じる）。
  // C5: leftover-capable 以外の /login でも武装する（returnTo / sessionExpired 等）。
  // C3: 設計 §3.3 どおりマウント時点の persist に限る。waiting→verifying で再武装しない。
  // C9 は本物の成功時だけ snapshot を消す（M1）。leftover-capable authenticated では残す。
  useEffect(() => {
    if (otpCompletedFresh) {
      return;
    }
    let aborted = false;
    leftoverCleanupRef.current = Promise.resolve().then(() => {
      if (aborted) return;
      if (isFreshEmailOtpCompleted()) return;
      return clearLeftoverLoginSessionIfNoSiblingCompletion();
    });
    return () => {
      aborted = true;
    };
  }, [otpCompletedFresh, locationState.authError, location.search]);

  // ログイン成功後は宛先の PII を sessionStorage に残さない（C9）。
  // leftover-capable の authenticated は本物の成功ではない（M1 / C1b residual）。
  // leftover-incapable でも committed live が無い authenticated は leftover pin（C5）。
  // otp 成功印が無く complete でもないなら番号待ち snapshot を残す（再マウント再水和用）。
  useEffect(() => {
    const realSuccess =
      otpCompletedFresh ||
      state.status === "complete" ||
      (auth.status === "authenticated" && !leftoverCapable && liveSessionCommitted);
    if (!realSuccess) return;
    rememberLastMagicEmail("");
    rememberWaitingUi(null);
  }, [auth.status, leftoverCapable, liveSessionCommitted, otpCompletedFresh, state.status]);

  // 既にセッションがある場合はフォームを出さず returnTo へ進める。
  // C2 / C-R2 / C-R3: leftover を伴い得る leave はエラーより先に Navigate しない。
  // 番号成功印があるときだけ leftover-capable でも Navigate する（MF-C1）。
  // C2: pin mismatch の degraded のまま leftover A の Authenticated shell へ入らない。
  // C5: leftover-incapable でも committed live が無い authenticated は leftover persist の
  // first-writer pin なので Navigate せず、上の leftover 掃除に任せる。
  if (
    !auth.sessionProbeDegraded &&
    (state.status === "complete" ||
      (auth.status === "authenticated" &&
        (otpCompletedFresh || (!leftoverCapable && liveSessionCommitted))))
  ) {
    return <Navigate to={returnTo} replace />;
  }
  // C6: loading 中は deadline 超過でもフォームを出さない。
  // provider が fail-closed して unauthenticated になるまで LivePendingMain。
  // useAuthLoadingDeadline の RootGate / RequireSession 用途は変えない。
  if (auth.status === "loading") {
    return <LivePendingMain message="読み込み中…" />;
  }

  if (state.status === "waiting" || state.status === "verifying") {
    const verifying = state.status === "verifying" || verifyInFlightRef.current;
    const resendDisabled = secondsLeft > 0 || verifying || state.email.trim() === "";
    return (
      <main className="page-frame stack">
        <h1>{EMAIL_OTP_WAITING_HEADING}</h1>
        <section className="card stack" aria-live="polite">
          {state.email.trim() !== "" ? <strong>{emailOtpSentTo(state.email)}</strong> : null}
          <p>{EMAIL_OTP_WAITING_BODY}</p>
          <p>{EMAIL_OTP_WAITING_HINT}</p>
          {otpError === "mismatch" && (
            <p className="error-message" role="alert">
              {EMAIL_OTP_MISMATCH}
            </p>
          )}
          {otpError === "unavailable" && (
            <p className="error-message" role="alert">
              {EMAIL_OTP_UNAVAILABLE}
            </p>
          )}
          <OtpDigitField
            value={otpDigits}
            disabled={verifying || googlePending}
            onChange={(next) => {
              handleOtpChange(next, state.email, state.resendAvailableAt);
            }}
          />
          <button
            className="primary-button"
            type="button"
            disabled={resendDisabled}
            onClick={() => void send()}
          >
            {secondsLeft > 0 ? emailOtpResendWaitSeconds(secondsLeft) : EMAIL_OTP_RESEND_BUTTON}
          </button>
          <button
            className="text-button"
            type="button"
            disabled={verifying}
            onClick={() => {
              if (verifyInFlightRef.current) return;
              requestSeqRef.current += 1;
              setEmailUnlocked(true);
              discardWaiting(state.email);
            }}
          >
            {EMAIL_OTP_CHANGE_EMAIL}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={googlePending || verifying}
            onClick={() => void startGoogle()}
          >
            {googlePending ? EMAIL_OTP_GOOGLE_STARTING : EMAIL_OTP_SWITCH_TO_GOOGLE}
          </button>
          {googleError && (
            <p className="error-message" role="alert">
              {EMAIL_OTP_GOOGLE_START_FAILED}
            </p>
          )}
        </section>
      </main>
    );
  }

  // complete + degraded は Navigate しない（C2）。complete 型に email は無い。
  const email = "email" in state ? state.email : "";
  return (
    <main className="page-frame stack">
      <div className="stack gap-2">
        <p className="eyebrow">毎日の献立を、家族に合わせて</p>
        <h1>こんだて日和</h1>
        <p>{EMAIL_OTP_LOGIN_LEAD}</p>
        <p className="type-small">{showEmailSection ? EMAIL_OTP_LOGIN_NOTE : LOGIN_PAGE_NOTE}</p>
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
      {showEmailSection && (
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
          <button
            className="primary-button min-h-11"
            disabled={state.status === "sending"}
            type="submit"
          >
            {state.status === "sending" ? EMAIL_OTP_SENDING : EMAIL_OTP_SEND_BUTTON}
          </button>
          {state.status === "send_failed" && (
            <p className="error-message" role="alert">
              {state.message}
            </p>
          )}
        </form>
      )}
      <button
        className="secondary-button min-h-11"
        type="button"
        disabled={googlePending || state.status === "sending"}
        onClick={() => void startGoogle()}
      >
        {googlePending ? EMAIL_OTP_GOOGLE_STARTING : EMAIL_OTP_GOOGLE_BUTTON}
      </button>
      <p className="type-small">Google アカウントではじめての方も、そのまま使えます。</p>
      {googleError && (
        <p className="error-message" role="alert">
          {EMAIL_OTP_GOOGLE_START_FAILED}
        </p>
      )}
    </main>
  );
}
