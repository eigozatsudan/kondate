import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shareConsentVersion } from "@shared/contracts/share-consent";
import { shareConsentRequiredPhrases, shareConsentSettingsCopy } from "./privacy-copy";
import type { ShareConsentState, SharedEmergencyRecipeListItem } from "./share-consent-api";
import {
  SHARE_CONSENT_RECONCILE_ATTEMPTS,
  SHARE_CONSENT_RECONCILE_RETRY_DELAY_MS,
  SHARE_CONSENT_TOGGLE_TIMEOUT_MS,
  ShareConsentSettingsSection,
} from "./share-consent-settings-section";

const getMyShareConsentMock = vi.hoisted(() => vi.fn());
const reacceptMyShareConsentMock = vi.hoisted(() => vi.fn());
const revokeMyShareConsentMock = vi.hoisted(() => vi.fn());
const listMySharedEmergencyRecipesMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({}),
}));

vi.mock("./share-consent-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./share-consent-api")>();
  return {
    ...actual,
    getMyShareConsent: getMyShareConsentMock,
    reacceptMyShareConsent: reacceptMyShareConsentMock,
    revokeMyShareConsent: revokeMyShareConsentMock,
    listMySharedEmergencyRecipes: listMySharedEmergencyRecipesMock,
  };
});

const acceptedConsent: ShareConsentState = {
  consent_version: shareConsentVersion,
  accepted_at: "2026-08-01T00:00:00.000Z",
  revoked_at: null,
};

const revokedConsent: ShareConsentState = {
  consent_version: shareConsentVersion,
  accepted_at: "2026-08-01T00:00:00.000Z",
  revoked_at: "2026-08-01T01:00:00.000Z",
};

const emptyConsent: ShareConsentState = {
  consent_version: null,
  accepted_at: null,
  revoked_at: null,
};

const sampleList: SharedEmergencyRecipeListItem[] = [
  { title: "肉じゃが", shared_on: "2026-08-01" },
  { title: "野菜炒め", shared_on: "2026-07-30" },
];

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function renderSection(props: Partial<ComponentProps<typeof ShareConsentSettingsSection>> = {}) {
  return renderWithClient(
    <ShareConsentSettingsSection
      userId="user-1"
      consent={emptyConsent}
      consentLoading={false}
      consentError={false}
      sharedList={[]}
      sharedListLoading={false}
      sharedListError={false}
      {...props}
    />,
  );
}

describe("ShareConsentSettingsSection", () => {
  beforeEach(() => {
    getMyShareConsentMock.mockReset();
    reacceptMyShareConsentMock.mockReset();
    revokeMyShareConsentMock.mockReset();
    listMySharedEmergencyRecipesMock.mockReset();
    listMySharedEmergencyRecipesMock.mockResolvedValue([]);
  });

  it("renders toggle off by default when consent is absent, with residual retention copy", () => {
    renderSection({ consent: emptyConsent });
    const toggle = screen.getByRole("switch", {
      name: shareConsentSettingsCopy.toggleLabel,
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(shareConsentSettingsCopy.residualRetentionNotice)).toBeVisible();
    expect(shareConsentSettingsCopy.residualRetentionNotice).toContain("既提供分は残");
  });

  it("AP6: shows required consent phrases before settings reaccept", () => {
    renderSection({ consent: emptyConsent });
    const section = screen
      .getByRole("heading", { name: shareConsentSettingsCopy.title })
      .closest("section");
    const text = section?.textContent ?? "";
    for (const phrase of shareConsentRequiredPhrases) {
      expect(text).toContain(phrase);
    }
  });

  it("shows residual retention notice when consent is revoked", () => {
    renderSection({ consent: revokedConsent });
    expect(
      screen.getByRole("switch", { name: shareConsentSettingsCopy.toggleLabel }),
    ).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(shareConsentSettingsCopy.residualRetentionNotice)).toBeVisible();
  });

  it("renders toggle on when current consent is valid and hides residual while on", () => {
    renderSection({ consent: acceptedConsent });
    expect(
      screen.getByRole("switch", { name: shareConsentSettingsCopy.toggleLabel }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.queryByText(shareConsentSettingsCopy.residualRetentionNotice),
    ).not.toBeInTheDocument();
  });

  it("revokes on toggle off and keeps residual copy visible", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderSection({
      consent: acceptedConsent,
      onToggle,
    });

    await user.click(screen.getByRole("switch", { name: shareConsentSettingsCopy.toggleLabel }));
    await waitFor(() => {
      expect(onToggle).toHaveBeenCalledWith(false);
    });

    // 親が revoke 後の state を注入する想定で residual が出ることを確認
    rerender(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <ShareConsentSettingsSection
          userId="user-1"
          consent={revokedConsent}
          consentLoading={false}
          consentError={false}
          sharedList={[]}
          sharedListLoading={false}
          sharedListError={false}
          onToggle={onToggle}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText(shareConsentSettingsCopy.residualRetentionNotice)).toBeVisible();
  });

  it("reaccepts on toggle on with injected handler", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn().mockResolvedValue(undefined);
    renderSection({ consent: revokedConsent, onToggle });

    await user.click(screen.getByRole("switch", { name: shareConsentSettingsCopy.toggleLabel }));
    await waitFor(() => {
      expect(onToggle).toHaveBeenCalledWith(true);
    });
  });

  it("lists shared recipes as title + date only", () => {
    renderSection({ consent: acceptedConsent, sharedList: sampleList });
    expect(screen.getByText("肉じゃが")).toBeVisible();
    expect(screen.getByText("野菜炒め")).toBeVisible();
    // 日付は時刻なし（YYYY-MM-DD を ja-JP long に）
    expect(screen.getByText("2026年8月1日")).toBeVisible();
    expect(screen.getByText("2026年7月30日")).toBeVisible();
  });

  it("shows empty list copy when there are no shared recipes", () => {
    renderSection({ consent: acceptedConsent, sharedList: [] });
    expect(screen.getByText(shareConsentSettingsCopy.sharedListEmpty)).toBeVisible();
  });

  it("shows loading and error states for consent and list", () => {
    const { rerender } = renderSection({
      consent: null,
      consentLoading: true,
      sharedList: null,
      sharedListLoading: true,
    });
    expect(screen.getByText(shareConsentSettingsCopy.consentLoading)).toBeVisible();
    expect(screen.getByText(shareConsentSettingsCopy.sharedListLoading)).toBeVisible();

    rerender(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <ShareConsentSettingsSection
          userId="user-1"
          consent={null}
          consentLoading={false}
          consentError={true}
          sharedList={null}
          sharedListLoading={false}
          sharedListError={true}
        />
      </QueryClientProvider>,
    );
    // role=alert の p は name を持たないので本文で特定する
    const alerts = screen.getAllByRole("alert");
    expect(alerts.map((el) => el.textContent)).toEqual(
      expect.arrayContaining([
        shareConsentSettingsCopy.consentError,
        shareConsentSettingsCopy.sharedListError,
      ]),
    );
  });

  it("surfaces save error when toggle mutation fails", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn().mockRejectedValue(new Error("network"));
    renderSection({ consent: acceptedConsent, onToggle });

    await user.click(screen.getByRole("switch", { name: shareConsentSettingsCopy.toggleLabel }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(shareConsentSettingsCopy.saveError);
    });
  });

  it("AP12: disables toggle while pending so concurrent toggles do not race in-tab", async () => {
    const user = userEvent.setup();
    let resolveToggle: (() => void) | undefined;
    const onToggle = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveToggle = resolve;
        }),
    );
    renderSection({ consent: acceptedConsent, onToggle });

    const toggle = screen.getByRole("switch", { name: shareConsentSettingsCopy.toggleLabel });
    await user.click(toggle);
    await waitFor(() => {
      expect(onToggle).toHaveBeenCalledTimes(1);
    });
    expect(toggle).toBeDisabled();

    // pending 中の二度目は disabled で届かない
    await user.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);

    resolveToggle?.();
    await waitFor(() => {
      expect(toggle).not.toBeDisabled();
    });
  });

  it("AP6: never-settle toggle times out so pending clears and saveError shows", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      // revoke/reaccept が settle しない共有端末固着を再現
      const onToggle = vi.fn(() => new Promise<void>(() => undefined));
      renderSection({ consent: acceptedConsent, onToggle });

      const toggle = screen.getByRole("switch", { name: shareConsentSettingsCopy.toggleLabel });
      await user.click(toggle);
      await waitFor(() => {
        expect(onToggle).toHaveBeenCalledTimes(1);
      });
      expect(toggle).toBeDisabled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SHARE_CONSENT_TOGGLE_TIMEOUT_MS + 50);
      });

      expect(await screen.findByRole("alert")).toHaveTextContent(
        shareConsentSettingsCopy.saveError,
      );
      expect(toggle).not.toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("AP5: timeout after toggle on aborts upsert and reconciles cache from server ON", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const upsertSignals: AbortSignal[] = [];
      getMyShareConsentMock.mockImplementation(() => {
        // upsert 開始後の再読はサーバ正（ON）。初期 query はオフ。
        if (reacceptMyShareConsentMock.mock.calls.length > 0) {
          return Promise.resolve(acceptedConsent);
        }
        return Promise.resolve(revokedConsent);
      });
      reacceptMyShareConsentMock.mockImplementation(
        (_client: unknown, options?: { signal?: AbortSignal }) => {
          if (options?.signal !== undefined) {
            upsertSignals.push(options.signal);
          }
          return new Promise<ShareConsentState>(() => undefined);
        },
      );

      renderWithClient(<ShareConsentSettingsSection userId="user-1" />);
      const toggle = await screen.findByRole("switch", {
        name: shareConsentSettingsCopy.toggleLabel,
      });
      expect(toggle).toHaveAttribute("aria-checked", "false");

      await user.click(toggle);
      await waitFor(() => {
        expect(reacceptMyShareConsentMock).toHaveBeenCalledTimes(1);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SHARE_CONSENT_TOGGLE_TIMEOUT_MS + 50);
      });

      expect(upsertSignals[0]?.aborted).toBe(true);
      await waitFor(() => {
        expect(toggle).toHaveAttribute("aria-checked", "true");
      });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("AP5: timeout after toggle on keeps saveError when server is still off", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      getMyShareConsentMock.mockResolvedValue(revokedConsent);
      reacceptMyShareConsentMock.mockImplementation(
        () => new Promise<ShareConsentState>(() => undefined),
      );

      renderWithClient(<ShareConsentSettingsSection userId="user-1" />);
      const toggle = await screen.findByRole("switch", {
        name: shareConsentSettingsCopy.toggleLabel,
      });
      await user.click(toggle);
      await waitFor(() => {
        expect(reacceptMyShareConsentMock).toHaveBeenCalledTimes(1);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SHARE_CONSENT_TOGGLE_TIMEOUT_MS + 50);
      });
      // AP-R1: 再読 OFF でも遅延 commit 窓を空けるため追加再読がある
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          (SHARE_CONSENT_RECONCILE_ATTEMPTS - 1) * SHARE_CONSENT_RECONCILE_RETRY_DELAY_MS + 50,
        );
      });

      expect(await screen.findByRole("alert")).toHaveTextContent(
        shareConsentSettingsCopy.saveError,
      );
      expect(toggle).toHaveAttribute("aria-checked", "false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("AP-R1: timeout re-read miss then later server ON reconciles toggle on", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      let postUpsertReads = 0;
      getMyShareConsentMock.mockImplementation(() => {
        if (reacceptMyShareConsentMock.mock.calls.length === 0) {
          return Promise.resolve(revokedConsent);
        }
        postUpsertReads += 1;
        // 直後の再読はまだ revoked。遅延 commit 後の再読で ON
        if (postUpsertReads === 1) {
          return Promise.resolve(revokedConsent);
        }
        return Promise.resolve(acceptedConsent);
      });
      reacceptMyShareConsentMock.mockImplementation(
        () => new Promise<ShareConsentState>(() => undefined),
      );

      renderWithClient(<ShareConsentSettingsSection userId="user-1" />);
      const toggle = await screen.findByRole("switch", {
        name: shareConsentSettingsCopy.toggleLabel,
      });
      await user.click(toggle);
      await waitFor(() => {
        expect(reacceptMyShareConsentMock).toHaveBeenCalledTimes(1);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SHARE_CONSENT_TOGGLE_TIMEOUT_MS + 50);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SHARE_CONSENT_RECONCILE_RETRY_DELAY_MS + 50);
      });

      await waitFor(() => {
        expect(toggle).toHaveAttribute("aria-checked", "true");
      });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("AP-R1: timeout re-read throw stays fail-closed mixed until server can be read", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      getMyShareConsentMock.mockImplementation(() => {
        if (reacceptMyShareConsentMock.mock.calls.length === 0) {
          return Promise.resolve(revokedConsent);
        }
        return Promise.reject(new Error("network"));
      });
      reacceptMyShareConsentMock.mockImplementation(
        () => new Promise<ShareConsentState>(() => undefined),
      );

      renderWithClient(<ShareConsentSettingsSection userId="user-1" />);
      const toggle = await screen.findByRole("switch", {
        name: shareConsentSettingsCopy.toggleLabel,
      });
      expect(toggle).toHaveAttribute("aria-checked", "false");
      await user.click(toggle);
      await waitFor(() => {
        expect(reacceptMyShareConsentMock).toHaveBeenCalledTimes(1);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SHARE_CONSENT_TOGGLE_TIMEOUT_MS + 50);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          (SHARE_CONSENT_RECONCILE_ATTEMPTS - 1) * SHARE_CONSENT_RECONCILE_RETRY_DELAY_MS + 50,
        );
      });

      const switchAfter = await screen.findByRole("switch", {
        name: shareConsentSettingsCopy.toggleLabel,
      });
      expect(switchAfter).toHaveAttribute("aria-checked", "mixed");
      expect(switchAfter).toBeDisabled();
      expect(await screen.findByText(shareConsentSettingsCopy.reconcileUnconfirmed)).toBeVisible();
      expect(
        screen.getByRole("button", { name: shareConsentSettingsCopy.reconcileRetry }),
      ).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });
});
