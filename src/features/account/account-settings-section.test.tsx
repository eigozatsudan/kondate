import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { householdSafetyRevisionStorageKey } from "@/features/household/household-queries";
import {
  ACCOUNT_DELETE_CLIENT_TIMEOUT_MS,
  AccountSettingsSection,
  AUTH_SESSION_PROBE_TIMEOUT_MS,
} from "./account-settings-section";

const clearLocalAuthAndDraftsMock = vi.hoisted(() => vi.fn());
const clearOwnedLocalDataBestEffortMock = vi.hoisted(() => vi.fn());
const requireAccessTokenMock = vi.hoisted(() => vi.fn());
const getBrowserSupabaseClientMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
const getUserMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());
const locationReplaceMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth/auth-cleanup", () => ({
  clearLocalAuthAndDrafts: clearLocalAuthAndDraftsMock,
  clearOwnedLocalDataBestEffort: clearOwnedLocalDataBestEffortMock,
  // AP1: 本番は signOut と同窓。モックでも数値定数を export する
  SIGN_OUT_TIMEOUT_MS: 4_000,
}));

vi.mock("@/features/auth/session", () => ({
  requireAccessToken: requireAccessTokenMock,
}));

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: getBrowserSupabaseClientMock,
}));

function seedOwnedStorage(): void {
  for (const storage of [localStorage, sessionStorage]) {
    storage.setItem("kondate.auth.flow.abc", "flow");
    storage.setItem("kondate.auth.supabase", "session");
    storage.setItem("kondate.auth.supabase-code-verifier", "verifier");
    storage.setItem("kondate:generation:v2", '{"kind":"new_menu"}');
    storage.setItem("kondate:shopping:list:1", "{}");
    storage.setItem(householdSafetyRevisionStorageKey, "rev");
    storage.setItem("kondate:preferences", "keep-me");
  }
}

beforeEach(() => {
  clearLocalAuthAndDraftsMock.mockReset();
  clearOwnedLocalDataBestEffortMock.mockReset();
  requireAccessTokenMock.mockReset();
  getBrowserSupabaseClientMock.mockReset();
  getSessionMock.mockReset();
  getUserMock.mockReset();
  fetchMock.mockReset();
  locationReplaceMock.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  requireAccessTokenMock.mockResolvedValue("access-token");
  // 既定は session/user 残存（AP10/AP3 probe が誤って成功扱いしない）
  getSessionMock.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  getBrowserSupabaseClientMock.mockReturnValue({
    auth: { getSession: getSessionMock, getUser: getUserMock },
  });
  // jsdom の location.replace は差し替え不能なことがあるため、defineProperty で固定する
  // Location は class instance のため spread すると prototype を失う（misused-spread）
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { replace: locationReplaceMock },
  });
  // 実ストレージ掃除を再現しつつ deferred 制御できるようにする
  clearLocalAuthAndDraftsMock.mockImplementation(() => {
    for (const storage of [localStorage, sessionStorage]) {
      for (const key of [...Object.keys(storage)]) {
        if (
          key.startsWith("kondate.auth.") ||
          key.startsWith("kondate:generation:") ||
          key.startsWith("kondate:shopping:") ||
          key === householdSafetyRevisionStorageKey
        ) {
          storage.removeItem(key);
        }
      }
    }
    return Promise.resolve();
  });
  vi.stubGlobal("fetch", fetchMock);
  if (typeof HTMLDialogElement !== "undefined") {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AccountSettingsSection", () => {
  it("renders sign-out and a separately labelled DangerZone", () => {
    render(<AccountSettingsSection />);
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeVisible();
    // AP2: local scope の開示
    expect(screen.getByText(/この端末だけログアウトします/)).toBeVisible();
    expect(screen.getByRole("region", { name: "危険な操作" })).toBeVisible();
    expect(screen.getByRole("button", { name: "アカウントを削除" })).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("awaits cleanup before hard-navigating on ordinary sign-out without returnTo and never calls DELETE /api/account", async () => {
    const user = userEvent.setup();
    seedOwnedStorage();
    let resolveCleanup: (() => void) | undefined;
    clearLocalAuthAndDraftsMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCleanup = resolve;
        }),
    );

    render(<AccountSettingsSection />);
    await user.click(screen.getByRole("button", { name: "ログアウト" }));

    expect(clearLocalAuthAndDraftsMock).toHaveBeenCalledTimes(1);
    // 通常ログアウトは local 既定（他端末セッション維持）。scope オプションは付けない。
    expect(clearLocalAuthAndDraftsMock).toHaveBeenCalledWith(
      getBrowserSupabaseClientMock.mock.results[0]?.value ?? getBrowserSupabaseClientMock(),
    );
    expect(locationReplaceMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    resolveCleanup?.();
    await waitFor(() => {
      // returnTo を付けない。RequireSession 競合を避け再ログインで設定へ戻さない
      expect(locationReplaceMock).toHaveBeenCalledWith("/login?signedOut=1");
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("expands the danger zone, gates confirmation, and keeps the dialog open on failure", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: { code: "account_delete_failed", message: "削除できませんでした" },
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
    );

    render(<AccountSettingsSection />);

    // 初期は折りたたみ。展開で不可逆性を説明する
    expect(
      screen.queryByText(/家族設定、献立履歴、冷蔵庫の食材、買い物リスト/u),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "アカウントを削除" }));
    expect(screen.getByText(/家族設定、献立履歴、冷蔵庫の食材、買い物リスト/u)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "削除の確認へ進む" }));
    const dialog = screen.getByRole("dialog", { name: "アカウントを削除しますか？" });
    expect(dialog).toBeVisible();

    const submit = screen.getByRole("button", { name: "完全に削除する" });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText("確認のため「削除する」と入力"), "削除する");
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(
      await screen.findByText("削除できませんでした。時間をおいてもう一度お試しください"),
    ).toBeVisible();
    expect(screen.getByRole("dialog", { name: "アカウントを削除しますか？" })).toBeVisible();
    expect(clearLocalAuthAndDraftsMock).not.toHaveBeenCalled();
    expect(locationReplaceMock).not.toHaveBeenCalled();
  });

  it("closes without a request on cancel or Escape", async () => {
    const user = userEvent.setup();
    render(<AccountSettingsSection />);
    await user.click(screen.getByRole("button", { name: "アカウントを削除" }));
    await user.click(screen.getByRole("button", { name: "削除の確認へ進む" }));
    expect(screen.getByRole("dialog")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "やめる" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "削除の確認へ進む" }));
    const dialog = screen.getByRole("dialog");
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces billing_cancel_failed without deleting local session (AP1)", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "billing_cancel_failed",
            message: "有料プランの解約が完了しませんでした",
          },
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
    );

    render(<AccountSettingsSection />);
    await user.click(screen.getByRole("button", { name: "アカウントを削除" }));
    await user.click(screen.getByRole("button", { name: "削除の確認へ進む" }));
    await user.type(screen.getByLabelText("確認のため「削除する」と入力"), "削除する");
    await user.click(screen.getByRole("button", { name: "完全に削除する" }));

    expect(
      await screen.findByText(/請求が続く可能性があるため、アカウントは削除していません/),
    ).toBeVisible();
    expect(clearLocalAuthAndDraftsMock).not.toHaveBeenCalled();
    expect(locationReplaceMock).not.toHaveBeenCalled();
  });

  it("surfaces account_delete_after_billing_cancel_failed without deleting local session (AP1)", async () => {
    // cancel 成功後 Auth 失敗: 解約が進んだ可能性を示し、再試行を促す（セッションは消さない）
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "account_delete_after_billing_cancel_failed",
            message: "有料プランの解約は完了した可能性がありますが、アカウント削除に失敗しました",
          },
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
    );

    render(<AccountSettingsSection />);
    await user.click(screen.getByRole("button", { name: "アカウントを削除" }));
    await user.click(screen.getByRole("button", { name: "削除の確認へ進む" }));
    await user.type(screen.getByLabelText("確認のため「削除する」と入力"), "削除する");
    await user.click(screen.getByRole("button", { name: "完全に削除する" }));

    expect(
      await screen.findByText(/解約は完了した可能性がありますが、アカウント削除に失敗しました/),
    ).toBeVisible();
    expect(clearLocalAuthAndDraftsMock).not.toHaveBeenCalled();
    expect(locationReplaceMock).not.toHaveBeenCalled();
  });

  it("awaits the same cleanup helper then navigates after successful deletion", async () => {
    const user = userEvent.setup();
    seedOwnedStorage();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { deleted: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    let resolveCleanup: (() => void) | undefined;
    clearLocalAuthAndDraftsMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCleanup = resolve;
        }),
    );

    render(<AccountSettingsSection />);
    await user.click(screen.getByRole("button", { name: "アカウントを削除" }));
    await user.click(screen.getByRole("button", { name: "削除の確認へ進む" }));
    await user.type(screen.getByLabelText("確認のため「削除する」と入力"), "削除する");
    await user.click(screen.getByRole("button", { name: "完全に削除する" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/account",
        expect.objectContaining({
          method: "DELETE",
          body: JSON.stringify({ confirmation: "削除する" }),
        }),
      );
    });
    expect(clearLocalAuthAndDraftsMock).toHaveBeenCalledTimes(1);
    expect(locationReplaceMock).not.toHaveBeenCalled();

    resolveCleanup?.();
    await waitFor(() => {
      expect(locationReplaceMock).toHaveBeenCalledWith("/login?accountDeleted=1");
    });
  });

  it("navigates after delete even when clearLocalAuthAndDrafts throws (AP5)", async () => {
    const user = userEvent.setup();
    seedOwnedStorage();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { deleted: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    clearLocalAuthAndDraftsMock.mockRejectedValue(new Error("storage quota"));

    render(<AccountSettingsSection />);
    await user.click(screen.getByRole("button", { name: "アカウントを削除" }));
    await user.click(screen.getByRole("button", { name: "削除の確認へ進む" }));
    await user.type(screen.getByLabelText("確認のため「削除する」と入力"), "削除する");
    await user.click(screen.getByRole("button", { name: "完全に削除する" }));

    await waitFor(() => {
      expect(clearOwnedLocalDataBestEffortMock).toHaveBeenCalled();
      expect(locationReplaceMock).toHaveBeenCalledWith("/login?accountDeleted=1");
    });
  });

  it("AP10: fetch reject + session gone → success-equivalent local cleanup", async () => {
    const user = userEvent.setup();
    seedOwnedStorage();
    fetchMock.mockRejectedValue(new TypeError("network"));
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null });

    render(<AccountSettingsSection />);
    await user.click(screen.getByRole("button", { name: "アカウントを削除" }));
    await user.click(screen.getByRole("button", { name: "削除の確認へ進む" }));
    await user.type(screen.getByLabelText("確認のため「削除する」と入力"), "削除する");
    await user.click(screen.getByRole("button", { name: "完全に削除する" }));

    await waitFor(() => {
      expect(getSessionMock).toHaveBeenCalled();
      // local session が既に null なら getUser は不要
      expect(getUserMock).not.toHaveBeenCalled();
      expect(clearLocalAuthAndDraftsMock).toHaveBeenCalled();
      expect(locationReplaceMock).toHaveBeenCalledWith("/login?accountDeleted=1");
    });
  });

  it("AP10: keeps error when fetch fails but session and server user remain", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new TypeError("network"));
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    render(<AccountSettingsSection />);
    await user.click(screen.getByRole("button", { name: "アカウントを削除" }));
    await user.click(screen.getByRole("button", { name: "削除の確認へ進む" }));
    await user.type(screen.getByLabelText("確認のため「削除する」と入力"), "削除する");
    await user.click(screen.getByRole("button", { name: "完全に削除する" }));

    expect(
      await screen.findByText("削除できませんでした。時間をおいてもう一度お試しください"),
    ).toBeVisible();
    expect(getUserMock).toHaveBeenCalled();
    expect(clearLocalAuthAndDraftsMock).not.toHaveBeenCalled();
    expect(locationReplaceMock).not.toHaveBeenCalled();
  });

  it("AP3: fetch reject + local JWT remains but Auth user gone → success-equivalent cleanup", async () => {
    // Admin hard delete 成功後も local getSession は JWT を返す。getUser 4xx でサーバ削除を検出する。
    const user = userEvent.setup();
    seedOwnedStorage();
    fetchMock.mockRejectedValue(new TypeError("network"));
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "stale-jwt" } },
      error: null,
    });
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: "User from sub claim in JWT does not exist", status: 403 },
    });

    render(<AccountSettingsSection />);
    await user.click(screen.getByRole("button", { name: "アカウントを削除" }));
    await user.click(screen.getByRole("button", { name: "削除の確認へ進む" }));
    await user.type(screen.getByLabelText("確認のため「削除する」と入力"), "削除する");
    await user.click(screen.getByRole("button", { name: "完全に削除する" }));

    await waitFor(() => {
      expect(getSessionMock).toHaveBeenCalled();
      expect(getUserMock).toHaveBeenCalled();
      expect(clearLocalAuthAndDraftsMock).toHaveBeenCalled();
      expect(locationReplaceMock).toHaveBeenCalledWith("/login?accountDeleted=1");
    });
  });

  it("AP3: non-JSON body + local JWT remains but Auth user gone → success-equivalent cleanup", async () => {
    const user = userEvent.setup();
    seedOwnedStorage();
    fetchMock.mockResolvedValue(new Response("not-json", { status: 200 }));
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "stale-jwt" } },
      error: null,
    });
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: "invalid claim", status: 401 },
    });

    render(<AccountSettingsSection />);
    await user.click(screen.getByRole("button", { name: "アカウントを削除" }));
    await user.click(screen.getByRole("button", { name: "削除の確認へ進む" }));
    await user.type(screen.getByLabelText("確認のため「削除する」と入力"), "削除する");
    await user.click(screen.getByRole("button", { name: "完全に削除する" }));

    await waitFor(() => {
      expect(getUserMock).toHaveBeenCalled();
      expect(clearLocalAuthAndDraftsMock).toHaveBeenCalled();
      expect(locationReplaceMock).toHaveBeenCalledWith("/login?accountDeleted=1");
    });
  });

  it("AP3: keeps error when getUser fails without 4xx (network unknown, no false success)", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new TypeError("network"));
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    // status 無し = リトライ可能な fetch 失敗等。誤って削除成功表示しない
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: "Failed to fetch" },
    });

    render(<AccountSettingsSection />);
    await user.click(screen.getByRole("button", { name: "アカウントを削除" }));
    await user.click(screen.getByRole("button", { name: "削除の確認へ進む" }));
    await user.type(screen.getByLabelText("確認のため「削除する」と入力"), "削除する");
    await user.click(screen.getByRole("button", { name: "完全に削除する" }));

    expect(
      await screen.findByText("削除できませんでした。時間をおいてもう一度お試しください"),
    ).toBeVisible();
    expect(clearLocalAuthAndDraftsMock).not.toHaveBeenCalled();
    expect(locationReplaceMock).not.toHaveBeenCalled();
  });

  it("AP3: explicit billing_cancel_failed still skips probe (no false success)", async () => {
    // 明示 ok:false は Auth 残存が正。local JWT 残 + getUser が 4xx でも probe しない
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "billing_cancel_failed",
            message: "有料プランの解約が完了しませんでした",
          },
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
    );
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: "should not be used", status: 403 },
    });

    render(<AccountSettingsSection />);
    await user.click(screen.getByRole("button", { name: "アカウントを削除" }));
    await user.click(screen.getByRole("button", { name: "削除の確認へ進む" }));
    await user.type(screen.getByLabelText("確認のため「削除する」と入力"), "削除する");
    await user.click(screen.getByRole("button", { name: "完全に削除する" }));

    expect(
      await screen.findByText(/請求が続く可能性があるため、アカウントは削除していません/),
    ).toBeVisible();
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(getUserMock).not.toHaveBeenCalled();
    expect(clearLocalAuthAndDraftsMock).not.toHaveBeenCalled();
    expect(locationReplaceMock).not.toHaveBeenCalled();
  });

  it("AP1: getUser never-settle is timed out so pending clears (no dialog stuck)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      fetchMock.mockRejectedValue(new TypeError("network"));
      getSessionMock.mockResolvedValue({
        data: { session: { access_token: "stale-jwt" } },
        error: null,
      });
      // never-settle: timeout 後に不明扱いへ倒し pending を finally で落とす
      getUserMock.mockReturnValue(new Promise(() => undefined));

      render(<AccountSettingsSection />);
      await user.click(screen.getByRole("button", { name: "アカウントを削除" }));
      await user.click(screen.getByRole("button", { name: "削除の確認へ進む" }));
      await user.type(screen.getByLabelText("確認のため「削除する」と入力"), "削除する");
      await user.click(screen.getByRole("button", { name: "完全に削除する" }));

      await vi.advanceTimersByTimeAsync(AUTH_SESSION_PROBE_TIMEOUT_MS + 50);

      expect(
        await screen.findByText("削除できませんでした。時間をおいてもう一度お試しください"),
      ).toBeVisible();
      expect(clearLocalAuthAndDraftsMock).not.toHaveBeenCalled();
      expect(locationReplaceMock).not.toHaveBeenCalled();
      // pending 解除後は「やめる」で閉じられる
      expect(screen.getByRole("button", { name: "やめる" })).not.toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("AP1: DELETE fetch never-settle is timed out so pending clears", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      // DELETE 本体が never-settle → withTimeout で pending 解除
      fetchMock.mockReturnValue(new Promise(() => undefined));

      render(<AccountSettingsSection />);
      await user.click(screen.getByRole("button", { name: "アカウントを削除" }));
      await user.click(screen.getByRole("button", { name: "削除の確認へ進む" }));
      await user.type(screen.getByLabelText("確認のため「削除する」と入力"), "削除する");
      await user.click(screen.getByRole("button", { name: "完全に削除する" }));

      expect(screen.getByRole("button", { name: "削除しています" })).toBeDisabled();
      await vi.advanceTimersByTimeAsync(ACCOUNT_DELETE_CLIENT_TIMEOUT_MS + 50);

      // AP3: timeout は処理継続の可能性を開示（失敗確定文言にしない）
      expect(
        await screen.findByText(/削除の結果を確認できませんでした。処理が続いている場合がある/),
      ).toBeVisible();
      expect(screen.getByRole("button", { name: "やめる" })).not.toBeDisabled();
      expect(locationReplaceMock).not.toHaveBeenCalled();
      // AP2: abortable fetch（signal 付き）
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/account",
        expect.objectContaining({
          method: "DELETE",
          signal: expect.any(AbortSignal) as AbortSignal,
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("AP1: headers-only body hang is timed out so pending clears", async () => {
    // headers は返るが body が never-settle → json() も同一予算で切る
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => new Promise(() => undefined),
      });

      render(<AccountSettingsSection />);
      await user.click(screen.getByRole("button", { name: "アカウントを削除" }));
      await user.click(screen.getByRole("button", { name: "削除の確認へ進む" }));
      await user.type(screen.getByLabelText("確認のため「削除する」と入力"), "削除する");
      await user.click(screen.getByRole("button", { name: "完全に削除する" }));

      expect(screen.getByRole("button", { name: "削除しています" })).toBeDisabled();
      await vi.advanceTimersByTimeAsync(ACCOUNT_DELETE_CLIENT_TIMEOUT_MS + 50);

      expect(
        await screen.findByText(/削除の結果を確認できませんでした。処理が続いている場合がある/),
      ).toBeVisible();
      expect(screen.getByRole("button", { name: "やめる" })).not.toBeDisabled();
      expect(locationReplaceMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("AP4: DangerZone discloses 方針 B anonymous share residual", async () => {
    const user = userEvent.setup();
    render(<AccountSettingsSection />);
    await user.click(screen.getByRole("button", { name: "アカウントを削除" }));
    expect(screen.getAllByText(/匿名一般化済みの緊急候補本文/).length).toBeGreaterThanOrEqual(1);
  });

  it("AP8: getUser user:null error:null is treated as session gone", async () => {
    const user = userEvent.setup();
    seedOwnedStorage();
    fetchMock.mockRejectedValue(new TypeError("network"));
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "stale-jwt" } },
      error: null,
    });
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });

    render(<AccountSettingsSection />);
    await user.click(screen.getByRole("button", { name: "アカウントを削除" }));
    await user.click(screen.getByRole("button", { name: "削除の確認へ進む" }));
    await user.type(screen.getByLabelText("確認のため「削除する」と入力"), "削除する");
    await user.click(screen.getByRole("button", { name: "完全に削除する" }));

    await waitFor(() => {
      expect(getUserMock).toHaveBeenCalled();
      expect(clearLocalAuthAndDraftsMock).toHaveBeenCalled();
      expect(locationReplaceMock).toHaveBeenCalledWith("/login?accountDeleted=1");
    });
  });

  it("AP4: double confirm does not issue parallel DELETE", async () => {
    // pending state 再描画前の連打でも inFlight ref が第二 DELETE を拒否する
    const user = userEvent.setup();
    let resolveDelete: ((value: Response) => void) | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveDelete = resolve;
        }),
    );

    render(<AccountSettingsSection />);
    await user.click(screen.getByRole("button", { name: "アカウントを削除" }));
    await user.click(screen.getByRole("button", { name: "削除の確認へ進む" }));
    await user.type(screen.getByLabelText("確認のため「削除する」と入力"), "削除する");
    const submit = screen.getByRole("button", { name: "完全に削除する" });
    // 同一 tick の二重 pointer（disabled 再描画前）
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    resolveDelete?.(
      new Response(JSON.stringify({ ok: true, data: { deleted: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await waitFor(() => {
      expect(locationReplaceMock).toHaveBeenCalledWith("/login?accountDeleted=1");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
