import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { householdSafetyRevisionStorageKey } from "@/features/household/household-queries";
import { AccountSettingsSection } from "./account-settings-section";

const clearLocalAuthAndDraftsMock = vi.hoisted(() => vi.fn());
const clearOwnedLocalDataBestEffortMock = vi.hoisted(() => vi.fn());
const requireAccessTokenMock = vi.hoisted(() => vi.fn());
const getBrowserSupabaseClientMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());
const locationReplaceMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth/auth-cleanup", () => ({
  clearLocalAuthAndDrafts: clearLocalAuthAndDraftsMock,
  clearOwnedLocalDataBestEffort: clearOwnedLocalDataBestEffortMock,
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
  fetchMock.mockReset();
  locationReplaceMock.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  requireAccessTokenMock.mockResolvedValue("access-token");
  // 既定は session 残存（AP10 probe が誤って成功扱いしない）
  getSessionMock.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
  getBrowserSupabaseClientMock.mockReturnValue({ auth: { getSession: getSessionMock } });
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
      expect(clearLocalAuthAndDraftsMock).toHaveBeenCalled();
      expect(locationReplaceMock).toHaveBeenCalledWith("/login?accountDeleted=1");
    });
  });

  it("AP10: keeps error when fetch fails but session remains", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new TypeError("network"));
    getSessionMock.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });

    render(<AccountSettingsSection />);
    await user.click(screen.getByRole("button", { name: "アカウントを削除" }));
    await user.click(screen.getByRole("button", { name: "削除の確認へ進む" }));
    await user.type(screen.getByLabelText("確認のため「削除する」と入力"), "削除する");
    await user.click(screen.getByRole("button", { name: "完全に削除する" }));

    expect(
      await screen.findByText("削除できませんでした。時間をおいてもう一度お試しください"),
    ).toBeVisible();
    expect(locationReplaceMock).not.toHaveBeenCalled();
  });
});
