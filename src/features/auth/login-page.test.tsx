import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COLD_START_SESSION_DEADLINE_MS } from "./auth-provider";
import { publishAuthContinuationCompletion } from "./auth-continuation-completion";
import type { AuthGateway } from "./auth-gateway";
import {
  EMAIL_OTP_CHANGE_EMAIL,
  EMAIL_OTP_GOOGLE_BUTTON,
  EMAIL_OTP_LOGIN_LEAD,
  EMAIL_OTP_LOGIN_NOTE,
  EMAIL_OTP_MISMATCH,
  EMAIL_OTP_RESEND_BUTTON,
  EMAIL_OTP_SEND_BUTTON,
  EMAIL_OTP_SWITCH_TO_GOOGLE,
  EMAIL_OTP_WAITING_HEADING,
} from "./email-otp-copy";
import { LOGIN_EMAIL_HINT, LOGIN_PAGE_NOTE, LoginPage } from "./login-page";
import { useAuth } from "./use-auth";

const leftoverSignOut = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }));

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({
    auth: { signOut: leftoverSignOut },
  }),
}));

vi.mock("./use-auth", () => ({
  useAuth: vi.fn(() => ({ status: "unauthenticated", session: null })),
}));

const leftoverSessionStorageKey = "kondate.auth.supabase";
const emailOtpCompletedKey = "kondate.auth.emailOtpCompleted";
const DIGIT_LABELS = [
  "確認番号の1けた目",
  "確認番号の2けた目",
  "確認番号の3けた目",
  "確認番号の4けた目",
  "確認番号の5けた目",
  "確認番号の6けた目",
] as const;

function stubGateway(overrides: Partial<AuthGateway> = {}): AuthGateway {
  return {
    signInWithGoogle: vi.fn(),
    sendMagicLink: vi.fn(),
    sendEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
    completeCallback: vi.fn(),
    resumeFlow: vi.fn(),
    confirmMagicLink: vi.fn(),
    ...overrides,
  };
}

function unauthenticatedAuth() {
  return {
    status: "unauthenticated" as const,
    session: null,
    refreshSession: vi.fn(),
    sessionProbeDegraded: false,
  };
}

function authenticatedAuth() {
  return {
    status: "authenticated" as const,
    session: { user: { id: "user-magic" } } as never,
    refreshSession: vi.fn(),
    sessionProbeDegraded: false,
  };
}

function renderLoginAt(entry: string, gateway: AuthGateway, options?: { strict?: boolean }) {
  const ui = (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/login" element={<LoginPage gateway={gateway} />} />
        <Route path="/welcome" element={<p>welcome-dest</p>} />
        <Route path="/planner" element={<p>planner-dest</p>} />
        <Route path="/pantry" element={<p>pantry-dest</p>} />
      </Routes>
    </MemoryRouter>
  );
  return render(options?.strict === true ? <StrictMode>{ui}</StrictMode> : ui);
}

function getDigitBox(name: string): HTMLElement {
  const textbox = screen.queryByRole("textbox", { name });
  if (textbox !== null) return textbox;
  return screen.getByRole("spinbutton", { name });
}

async function pasteOtpDigits(
  user: ReturnType<typeof userEvent.setup>,
  digits: string,
): Promise<void> {
  const first = getDigitBox("確認番号の1けた目");
  first.focus();
  await user.paste(digits);
}

function futureResendAt(): string {
  return new Date(Date.now() + 60_000).toISOString();
}

function readyResendAt(): string {
  return new Date(Date.now() - 1_000).toISOString();
}

async function sendEmailAndWait(
  user: ReturnType<typeof userEvent.setup>,
  email = "user@example.com",
): Promise<void> {
  await user.type(screen.getByLabelText("メールアドレス"), email);
  await user.click(screen.getByRole("button", { name: EMAIL_OTP_SEND_BUTTON }));
  expect(await screen.findByRole("heading", { name: EMAIL_OTP_WAITING_HEADING })).toBeVisible();
}

afterEach(() => {
  leftoverSignOut.mockClear();
  window.localStorage.removeItem(leftoverSessionStorageKey);
  sessionStorage.removeItem(emailOtpCompletedKey);
  sessionStorage.removeItem("kondate.auth.lastMagicEmail");
  sessionStorage.removeItem("kondate.auth.magicSentUi");
  vi.mocked(useAuth).mockReturnValue(unauthenticatedAuth());
});

it("uses email number send as the primary action and Google as secondary without long-press hint", () => {
  renderLoginAt("/login", stubGateway());

  expect(screen.getByRole("button", { name: EMAIL_OTP_SEND_BUTTON })).toBeVisible();
  expect(screen.getByRole("button", { name: EMAIL_OTP_GOOGLE_BUTTON })).toBeVisible();
  expect(screen.queryByText(/長押し/)).toBeNull();
  expect(screen.queryByText(LOGIN_EMAIL_HINT)).toBeNull();
  const names = screen.getAllByRole("button").map((button) => button.textContent);
  expect(names.indexOf(EMAIL_OTP_SEND_BUTTON)).toBeLessThan(names.indexOf(EMAIL_OTP_GOOGLE_BUTTON));
});

it("stays on /login after send and shows the 6 digit boxes", async () => {
  const user = userEvent.setup();
  const gateway = stubGateway({
    sendEmailOtp: vi.fn().mockResolvedValue({
      email: "user@example.com",
      resendAvailableAt: futureResendAt(),
    }),
  });
  renderLoginAt("/login", gateway);

  await sendEmailAndWait(user);

  expect(screen.queryByText("welcome-dest")).not.toBeInTheDocument();
  expect(screen.queryByText("planner-dest")).not.toBeInTheDocument();
  for (const label of DIGIT_LABELS) {
    expect(getDigitBox(label)).toBeVisible();
  }
});

it("verifies 6 digits once and disables resend and change-email while in flight", async () => {
  const user = userEvent.setup();
  let resolveVerify: ((value: { kind: "complete" }) => void) | undefined;
  const verifyEmailOtp = vi.fn().mockImplementation(
    () =>
      new Promise<{ kind: "complete" }>((resolve) => {
        resolveVerify = resolve;
      }),
  );
  const gateway = stubGateway({
    sendEmailOtp: vi.fn().mockResolvedValue({
      email: "user@example.com",
      resendAvailableAt: readyResendAt(),
    }),
    verifyEmailOtp,
  });
  renderLoginAt("/login", gateway);

  await sendEmailAndWait(user);
  await pasteOtpDigits(user, "123456");

  expect(verifyEmailOtp).toHaveBeenCalledTimes(1);
  expect(verifyEmailOtp).toHaveBeenCalledWith({
    email: "user@example.com",
    token: "123456",
  });
  expect(screen.getByRole("button", { name: EMAIL_OTP_RESEND_BUTTON })).toBeDisabled();
  expect(screen.getByRole("button", { name: EMAIL_OTP_CHANGE_EMAIL })).toBeDisabled();
  expect(getDigitBox("確認番号の1けた目")).toBeDisabled();

  resolveVerify?.({ kind: "complete" });
  expect(await screen.findByText("welcome-dest")).toBeInTheDocument();
});

it.each([
  {
    label: "query-less leftover-capable /login",
    entry: "/login",
    dest: "welcome-dest",
  },
  {
    label: "unbound leftover-capable",
    entry: "/login?authError=unbound_callback",
    dest: "welcome-dest",
  },
] as const)(
  "navigates leftover-capable $label after OTP complete and remount does not signOut",
  async ({ entry, dest }) => {
    const user = userEvent.setup();
    const gateway = stubGateway({
      sendEmailOtp: vi.fn().mockResolvedValue({
        email: "user@example.com",
        resendAvailableAt: readyResendAt(),
      }),
      verifyEmailOtp: vi.fn().mockResolvedValue({ kind: "complete" }),
    });
    const view = renderLoginAt(entry, gateway);

    await sendEmailAndWait(user);
    await pasteOtpDigits(user, "123456");

    expect(await screen.findByText(dest)).toBeInTheDocument();

    leftoverSignOut.mockClear();
    view.unmount();
    window.localStorage.setItem(leftoverSessionStorageKey, "leftover-persist");
    vi.mocked(useAuth).mockReturnValue(authenticatedAuth());
    renderLoginAt(entry, gateway);

    await act(async () => {
      await Promise.resolve();
    });
    expect(leftoverSignOut).not.toHaveBeenCalled();
    expect(screen.getByText(dest)).toBeInTheDocument();
  },
);

it("discards waiting UI after Google start succeeds", async () => {
  const user = userEvent.setup();
  const gateway = stubGateway({
    signInWithGoogle: vi.fn().mockResolvedValue(undefined),
    sendEmailOtp: vi.fn().mockResolvedValue({
      email: "user@example.com",
      resendAvailableAt: futureResendAt(),
    }),
  });
  renderLoginAt("/login", gateway);

  await sendEmailAndWait(user);
  expect(getDigitBox("確認番号の1けた目")).toBeVisible();

  await user.click(screen.getByRole("button", { name: EMAIL_OTP_SWITCH_TO_GOOGLE }));

  await waitFor(() => {
    expect(
      screen.queryByRole("heading", { name: EMAIL_OTP_WAITING_HEADING }),
    ).not.toBeInTheDocument();
  });
  expect(screen.queryByLabelText("確認番号の1けた目")).not.toBeInTheDocument();
});

it("clears an unexpired Google authorization_code flow immediately before OTP complete", async () => {
  const user = userEvent.setup();
  const googleFlowId = "10000000-0000-4000-8000-0000000000aa";
  window.localStorage.setItem(
    `kondate.auth.flow.${googleFlowId}`,
    JSON.stringify({
      id: googleFlowId,
      secret: "A".repeat(43),
      state: "B".repeat(43),
      origin: "http://127.0.0.1:5173",
      returnTo: "/welcome",
      sessionExchange: "supabase",
      credentialKind: "authorization_code",
      startedAt: new Date().toISOString(),
    }),
  );
  const gateway = stubGateway({
    sendEmailOtp: vi.fn().mockResolvedValue({
      email: "user@example.com",
      resendAvailableAt: readyResendAt(),
    }),
    verifyEmailOtp: vi.fn().mockResolvedValue({ kind: "complete" }),
  });
  renderLoginAt("/login", gateway);

  await sendEmailAndWait(user);
  await pasteOtpDigits(user, "123456");

  expect(await screen.findByText("welcome-dest")).toBeInTheDocument();
  expect(window.localStorage.getItem(`kondate.auth.flow.${googleFlowId}`)).toBeNull();
});

it("clears digit boxes and shows mismatch copy when verify returns mismatch", async () => {
  const user = userEvent.setup();
  const gateway = stubGateway({
    sendEmailOtp: vi.fn().mockResolvedValue({
      email: "user@example.com",
      resendAvailableAt: readyResendAt(),
    }),
    verifyEmailOtp: vi.fn().mockResolvedValue({ kind: "mismatch" }),
  });
  renderLoginAt("/login", gateway);

  await sendEmailAndWait(user);
  await pasteOtpDigits(user, "123456");

  expect(await screen.findByRole("alert")).toHaveTextContent(EMAIL_OTP_MISMATCH);
  for (const label of DIGIT_LABELS) {
    expect(getDigitBox(label)).toHaveValue("");
  }
});

it("calls verifyEmailOtp once when 6 digits are entered under StrictMode", async () => {
  const user = userEvent.setup();
  const verifyEmailOtp = vi.fn().mockResolvedValue({ kind: "complete" });
  const gateway = stubGateway({
    sendEmailOtp: vi.fn().mockResolvedValue({
      email: "user@example.com",
      resendAvailableAt: readyResendAt(),
    }),
    verifyEmailOtp,
  });
  renderLoginAt("/login", gateway, { strict: true });

  await sendEmailAndWait(user);
  await pasteOtpDigits(user, "123456");

  await waitFor(() => {
    expect(verifyEmailOtp).toHaveBeenCalledTimes(1);
  });
});

it("explains that first-time users can register on the same screen with Google and email", () => {
  renderLoginAt("/login", stubGateway());

  expect(screen.getByText(EMAIL_OTP_LOGIN_LEAD)).toBeVisible();
  expect(screen.getByText(EMAIL_OTP_LOGIN_NOTE)).toBeVisible();
  expect(screen.getByLabelText("メールアドレス")).toBeVisible();
  expect(screen.getByText("Google アカウントではじめての方も、そのまま使えます。")).toBeVisible();
  expect(screen.getByRole("button", { name: EMAIL_OTP_GOOGLE_BUTTON })).toBeVisible();
  expect(screen.getByRole("button", { name: EMAIL_OTP_SEND_BUTTON })).toBeVisible();
  expect(screen.queryByText(LOGIN_PAGE_NOTE)).toBeNull();
});

it("shows email number form by default without emailLogin query", () => {
  renderLoginAt("/login", stubGateway());

  expect(screen.getByText(EMAIL_OTP_LOGIN_NOTE)).toBeVisible();
  expect(screen.getByRole("button", { name: EMAIL_OTP_SEND_BUTTON })).toBeVisible();
});

it("renders the waiting state after a successful send", async () => {
  const user = userEvent.setup();
  const gateway = stubGateway({
    sendEmailOtp: vi.fn().mockResolvedValue({
      email: "user@example.com",
      resendAvailableAt: futureResendAt(),
    }),
  });
  renderLoginAt("/login", gateway);

  await sendEmailAndWait(user);

  expect(screen.getByText("user@example.com に送りました")).toBeInTheDocument();
  expect(screen.getByText("迷惑メールフォルダも確認してください")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: EMAIL_OTP_CHANGE_EMAIL })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: EMAIL_OTP_SWITCH_TO_GOOGLE })).toBeInTheDocument();
});

it("shows visible error copy when the callback arrives unbound to a known flow", () => {
  render(
    <MemoryRouter
      initialEntries={[{ pathname: "/login", state: { authError: "unbound_callback" } }]}
    >
      <LoginPage gateway={stubGateway()} />
    </MemoryRouter>,
  );

  expect(screen.getByRole("alert")).toHaveTextContent(
    "ログインの情報を確認できませんでした。最初からやり直してください。",
  );
});

it.each([
  {
    code: "unbound_callback" as const,
    copy: "ログインの情報を確認できませんでした。最初からやり直してください。",
  },
  {
    code: "oauth_cancelled" as const,
    copy: "Googleログインがキャンセルされました。もう一度試すか、別の方法を選べます。",
  },
  {
    code: "auth_callback_failed" as const,
    copy: "ログインを確認できませんでした。もう一度お試しください。",
  },
] as const)("shows authError=$code from query (full leave path)", ({ code, copy }) => {
  renderLoginAt(`/login?authError=${code}`, stubGateway());

  expect(screen.getByRole("alert")).toHaveTextContent(copy);
});

it("prefills last email when leftover inbound is magic_link_expired", () => {
  sessionStorage.setItem(
    "kondate.auth.lastMagicEmail",
    JSON.stringify({ email: "user@example.com", storedAt: new Date().toISOString() }),
  );

  render(
    <MemoryRouter
      initialEntries={[{ pathname: "/login", state: { authError: "magic_link_expired" } }]}
    >
      <LoginPage gateway={stubGateway()} />
    </MemoryRouter>,
  );

  expect(screen.getByRole("heading", { name: "こんだて日和" })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "このリンクは期限切れか、すでに使用されています。",
  );
  expect(screen.getByLabelText("メールアドレス")).toHaveValue("user@example.com");
  expect(screen.getByRole("button", { name: EMAIL_OTP_SEND_BUTTON })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: EMAIL_OTP_GOOGLE_BUTTON })).toBeInTheDocument();
});

it("does not rehydrate sent UI when accountDeleted notice must show", () => {
  sessionStorage.setItem(
    "kondate.auth.magicSentUi",
    JSON.stringify({
      email: "user@example.com",
      resendAvailableAt: futureResendAt(),
      storedAt: new Date().toISOString(),
    }),
  );

  renderLoginAt("/login?accountDeleted=1", stubGateway());

  expect(screen.getByRole("status")).toHaveTextContent("アカウントを削除しました");
  expect(screen.getByRole("status")).toHaveTextContent(/匿名一般化済みの緊急候補本文/);
  expect(screen.getByRole("status")).toHaveTextContent(/Stripe/);
  expect(screen.getByRole("status")).toHaveTextContent(/他の端末に残った下書き/);
  expect(screen.queryByText(EMAIL_OTP_WAITING_HEADING)).not.toBeInTheDocument();
});

it("AP8: accountDeleted banner mentions this-device residual when localResidual=1", () => {
  renderLoginAt("/login?accountDeleted=1&localResidual=1", stubGateway());

  expect(screen.getByRole("status")).toHaveTextContent("この端末に下書きや一時データが残っている");
  expect(screen.getByRole("status")).toHaveTextContent(/Stripe/);
  expect(screen.getByRole("status")).toHaveTextContent(/他の端末に残った下書き/);
});

it("shows sessionExpired notice and does not rehydrate sent UI", () => {
  sessionStorage.setItem(
    "kondate.auth.magicSentUi",
    JSON.stringify({
      email: "user@example.com",
      resendAvailableAt: futureResendAt(),
      storedAt: new Date().toISOString(),
    }),
  );

  renderLoginAt("/login?sessionExpired=1&returnTo=%2Fplanner", stubGateway());

  expect(screen.getByRole("status")).toHaveTextContent(
    "ログインの有効期限が切れたか、別の端末でログアウトされたため、もう一度ログインしてください。",
  );
  expect(screen.queryByText(EMAIL_OTP_WAITING_HEADING)).not.toBeInTheDocument();
});

it("U1-I2 rehydrates waiting UI from sessionStorage after reload", async () => {
  const resendAvailableAt = futureResendAt();
  sessionStorage.setItem(
    "kondate.auth.magicSentUi",
    JSON.stringify({
      email: "user@example.com",
      resendAvailableAt,
      storedAt: new Date().toISOString(),
    }),
  );

  renderLoginAt("/login", stubGateway());

  expect(screen.getByText("user@example.com に送りました")).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: /秒後に再送できます/ })).toBeDisabled();
  expect(getDigitBox("確認番号の1けた目")).toBeVisible();
});

it("allows retrying Google after switching from a number wait and a failed start", async () => {
  const user = userEvent.setup();
  const gateway = stubGateway({
    signInWithGoogle: vi
      .fn()
      .mockRejectedValueOnce(new Error("failed"))
      .mockResolvedValueOnce(undefined),
    sendEmailOtp: vi.fn().mockResolvedValue({
      email: "user@example.com",
      resendAvailableAt: readyResendAt(),
    }),
  });
  renderLoginAt("/login", gateway);

  await sendEmailAndWait(user);
  await user.click(screen.getByRole("button", { name: EMAIL_OTP_SWITCH_TO_GOOGLE }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Googleログインを開始できませんでした。もう一度お試しください。",
  );

  await user.click(screen.getByRole("button", { name: EMAIL_OTP_SWITCH_TO_GOOGLE }));
  // eslint-disable-next-line @typescript-eslint/unbound-method
  expect(gateway.signInWithGoogle).toHaveBeenCalledTimes(2);
});

it("uses /welcome for Google when returnTo is omitted and sends email without returnTo", async () => {
  const user = userEvent.setup();
  const signInWithGoogle = vi.fn().mockResolvedValue(undefined);
  const sendEmailOtp = vi.fn().mockResolvedValue({
    email: "user@example.com",
    resendAvailableAt: futureResendAt(),
  });
  const gateway = stubGateway({ signInWithGoogle, sendEmailOtp });
  renderLoginAt("/login", gateway);

  await user.click(screen.getByRole("button", { name: EMAIL_OTP_GOOGLE_BUTTON }));
  expect(signInWithGoogle).toHaveBeenCalledWith("/welcome");

  await user.type(screen.getByLabelText("メールアドレス"), "user@example.com");
  await user.click(screen.getByRole("button", { name: EMAIL_OTP_SEND_BUTTON }));
  expect(sendEmailOtp).toHaveBeenCalledWith("user@example.com");
});

it("preserves an explicit safe returnTo for Google", async () => {
  const user = userEvent.setup();
  const signInWithGoogle = vi.fn().mockResolvedValue(undefined);
  const gateway = stubGateway({
    signInWithGoogle,
    sendEmailOtp: vi.fn().mockResolvedValue({
      email: "user@example.com",
      resendAvailableAt: futureResendAt(),
    }),
  });
  renderLoginAt("/login?returnTo=%2Fpantry", gateway);

  await user.click(screen.getByRole("button", { name: EMAIL_OTP_GOOGLE_BUTTON }));
  expect(signInWithGoogle).toHaveBeenCalledWith("/pantry");
});

it("C1: drops /login and /auth/callback returnTo for Google", async () => {
  const user = userEvent.setup();
  const signInWithGoogle = vi.fn().mockResolvedValue(undefined);
  const gateway = stubGateway({ signInWithGoogle });

  const { unmount } = renderLoginAt("/login?returnTo=%2Flogin", gateway);
  await user.click(screen.getByRole("button", { name: EMAIL_OTP_GOOGLE_BUTTON }));
  expect(signInWithGoogle).toHaveBeenCalledWith("/welcome");
  unmount();

  signInWithGoogle.mockClear();
  renderLoginAt("/login?returnTo=%2Fauth%2Fcallback", gateway);
  await user.click(screen.getByRole("button", { name: EMAIL_OTP_GOOGLE_BUTTON }));
  expect(signInWithGoogle).toHaveBeenCalledWith("/welcome");
});

it("C13: discards stale number-wait residual sessionStorage past TTL", () => {
  const staleAt = new Date(Date.now() - 61_000).toISOString();
  sessionStorage.setItem(
    "kondate.auth.lastMagicEmail",
    JSON.stringify({ email: "stale@example.com", storedAt: staleAt }),
  );
  sessionStorage.setItem(
    "kondate.auth.magicSentUi",
    JSON.stringify({
      email: "stale@example.com",
      resendAvailableAt: futureResendAt(),
      storedAt: staleAt,
    }),
  );

  renderLoginAt("/login", stubGateway());

  expect(screen.queryByText("stale@example.com に送りました")).not.toBeInTheDocument();
  expect(sessionStorage.getItem("kondate.auth.lastMagicEmail")).toBeNull();
  expect(sessionStorage.getItem("kondate.auth.magicSentUi")).toBeNull();
});

it("C2: authenticated login still shows oauth_cancelled instead of navigating away", () => {
  vi.mocked(useAuth).mockReturnValue(authenticatedAuth());
  renderLoginAt("/login?authError=oauth_cancelled", stubGateway());

  expect(screen.getByRole("heading", { name: "こんだて日和" })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Googleログインがキャンセルされました。もう一度試すか、別の方法を選べます。",
  );
  expect(screen.getByRole("button", { name: EMAIL_OTP_GOOGLE_BUTTON })).toBeVisible();
});

it.each([
  {
    label: "unbound_callback query",
    entry: "/login?authError=unbound_callback",
    heading: "こんだて日和",
    copy: "ログインの情報を確認できませんでした。最初からやり直してください。",
    googleName: EMAIL_OTP_GOOGLE_BUTTON,
  },
  {
    label: "restart-style query-less /login",
    entry: "/login",
    heading: "こんだて日和",
    copy: null,
    googleName: EMAIL_OTP_GOOGLE_BUTTON,
  },
] as const)(
  "C-R2: authenticated login still shows leftover-capable $label instead of navigating away",
  ({ entry, heading, copy, googleName }) => {
    vi.mocked(useAuth).mockReturnValue(authenticatedAuth());
    renderLoginAt(entry, stubGateway());

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    if (copy !== null) {
      expect(screen.getByRole("alert")).toHaveTextContent(copy);
    }
    expect(screen.getByRole("button", { name: googleName })).toBeVisible();
    expect(screen.queryByText("welcome-dest")).not.toBeInTheDocument();
    expect(screen.queryByText("planner-dest")).not.toBeInTheDocument();
  },
);

it.each([
  {
    label: "auth_callback_failed query",
    entry: "/login?authError=auth_callback_failed",
    heading: "こんだて日和",
    copy: "ログインを確認できませんでした。もう一度お試しください。",
    googleName: EMAIL_OTP_GOOGLE_BUTTON,
  },
  {
    label: "auth_callback_failed with returnTo",
    entry: "/login?authError=auth_callback_failed&returnTo=%2Fplanner",
    heading: "こんだて日和",
    copy: "ログインを確認できませんでした。もう一度お試しください。",
    googleName: EMAIL_OTP_GOOGLE_BUTTON,
  },
  {
    label: "magic_link_expired query",
    entry: "/login?authError=magic_link_expired",
    heading: "こんだて日和",
    copy: "このリンクは期限切れか、すでに使用されています。",
    googleName: EMAIL_OTP_GOOGLE_BUTTON,
  },
  {
    label: "magic_link_expired with returnTo",
    entry: "/login?authError=magic_link_expired&returnTo=%2Fplanner",
    heading: "こんだて日和",
    copy: "このリンクは期限切れか、すでに使用されています。",
    googleName: EMAIL_OTP_GOOGLE_BUTTON,
  },
] as const)(
  "C-R3: authenticated login still shows leftover-capable $label instead of navigating away",
  ({ entry, heading, copy, googleName }) => {
    vi.mocked(useAuth).mockReturnValue(authenticatedAuth());
    renderLoginAt(entry, stubGateway());

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(copy);
    expect(screen.getByRole("button", { name: googleName })).toBeVisible();
    expect(screen.queryByText("welcome-dest")).not.toBeInTheDocument();
    expect(screen.queryByText("planner-dest")).not.toBeInTheDocument();
  },
);

it.each([
  {
    label: "unbound_callback leave",
    entry: "/login?authError=unbound_callback",
  },
  {
    label: "query-less restart",
    entry: "/login",
  },
] as const)(
  "C-R4: leftover-capable $label local-signs-out leftover when no sibling completion",
  async ({ entry }) => {
    window.localStorage.setItem(leftoverSessionStorageKey, "leftover-persist");
    vi.mocked(useAuth).mockReturnValue(authenticatedAuth());
    renderLoginAt(entry, stubGateway());

    await waitFor(() => {
      expect(leftoverSignOut).toHaveBeenCalledWith({ scope: "local" });
    });
    expect(window.localStorage.getItem(leftoverSessionStorageKey)).toBeNull();
  },
);

it("C-R4: leftover-capable login does not signOut leftover when sibling completion exists", async () => {
  window.localStorage.setItem(leftoverSessionStorageKey, "winner-persist");
  publishAuthContinuationCompletion({
    flowId: "google-winner",
    returnTo: "/planner",
  });
  vi.mocked(useAuth).mockReturnValue(authenticatedAuth());
  try {
    renderLoginAt("/login?authError=unbound_callback", stubGateway());

    await act(async () => {
      await Promise.resolve();
    });
    expect(leftoverSignOut).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(leftoverSessionStorageKey)).toBe("winner-persist");
  } finally {
    window.localStorage.removeItem("kondate.auth.supabase.continuation-complete.google-winner");
  }
});

it("C9: clears number-wait residual sessionStorage when already authenticated", () => {
  sessionStorage.setItem(
    "kondate.auth.lastMagicEmail",
    JSON.stringify({ email: "user@example.com", storedAt: new Date().toISOString() }),
  );
  sessionStorage.setItem(
    "kondate.auth.magicSentUi",
    JSON.stringify({
      email: "user@example.com",
      resendAvailableAt: futureResendAt(),
      storedAt: new Date().toISOString(),
    }),
  );
  vi.mocked(useAuth).mockReturnValue({
    status: "authenticated",
    session: { user: { id: "user-1" } } as never,
    refreshSession: vi.fn(),
    sessionProbeDegraded: false,
  });
  renderLoginAt("/login", stubGateway());

  expect(sessionStorage.getItem("kondate.auth.lastMagicEmail")).toBeNull();
  expect(sessionStorage.getItem("kondate.auth.magicSentUi")).toBeNull();
});

it.each([
  ["empty", "/login?returnTo=", "/planner"],
  ["bare slash", "/login?returnTo=%2F", "/"],
  ["external URL", "/login?returnTo=https%3A%2F%2Fattacker.example", "/planner"],
  ["protocol-relative URL", "/login?returnTo=%2F%2Fattacker.example", "/planner"],
])("sanitizes an explicit %s returnTo for Google", async (_label, entry, expected) => {
  const user = userEvent.setup();
  const signInWithGoogle = vi.fn().mockResolvedValue(undefined);
  renderLoginAt(entry, stubGateway({ signInWithGoogle }));

  await user.click(screen.getByRole("button", { name: EMAIL_OTP_GOOGLE_BUTTON }));
  expect(signInWithGoogle).toHaveBeenCalledWith(expected);
});

describe("C6: login form while auth is loading", () => {
  const useAuthMock = vi.mocked(useAuth);

  afterEach(() => {
    useAuthMock.mockReturnValue(unauthenticatedAuth());
    vi.useRealTimers();
  });

  it("does not show Google start CTA while status is loading past 15s", async () => {
    useAuthMock.mockReturnValue({
      status: "loading",
      session: null,
      refreshSession: vi.fn(),
      sessionProbeDegraded: false,
    });
    vi.useFakeTimers();
    renderLoginAt("/login", stubGateway());

    expect(screen.queryByRole("button", { name: EMAIL_OTP_GOOGLE_BUTTON })).toBeNull();
    expect(screen.getByText("読み込み中…")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLD_START_SESSION_DEADLINE_MS + 1_000);
    });

    expect(screen.queryByRole("button", { name: EMAIL_OTP_GOOGLE_BUTTON })).toBeNull();
    expect(screen.queryByRole("button", { name: EMAIL_OTP_SEND_BUTTON })).toBeNull();
    expect(screen.getByText("読み込み中…")).toBeInTheDocument();
  });

  it("shows Google start CTA when unauthenticated", () => {
    useAuthMock.mockReturnValue(unauthenticatedAuth());
    renderLoginAt("/login", stubGateway());

    expect(screen.getByRole("button", { name: EMAIL_OTP_GOOGLE_BUTTON })).toBeVisible();
  });
});
