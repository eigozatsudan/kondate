import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SHARE_CONSENT_TOGGLE_TIMEOUT_MS } from "@/features/privacy/share-consent-settings-section";
import { tasteLearningCopy } from "./taste-learning-copy";
import { tasteLearningKeys } from "./taste-learning-api";
import { TasteLearningSettingsSection } from "./taste-learning-settings-section";

const getTasteLearningEnabledMock = vi.hoisted(() => vi.fn());
const setTasteLearningEnabledMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({}),
}));

vi.mock("./taste-learning-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./taste-learning-api")>();
  return {
    ...actual,
    getTasteLearningEnabled: getTasteLearningEnabledMock,
    setTasteLearningEnabled: setTasteLearningEnabledMock,
  };
});

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithClient(ui: ReactElement, client: QueryClient = makeClient()) {
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

describe("TasteLearningSettingsSection", () => {
  beforeEach(() => {
    getTasteLearningEnabledMock.mockReset();
    setTasteLearningEnabledMock.mockReset();
  });

  it("always shows the heading and the disclosure copy even before the read settles", () => {
    getTasteLearningEnabledMock.mockReturnValue(new Promise(() => undefined));
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    expect(screen.getByRole("heading", { name: tasteLearningCopy.title })).toBeInTheDocument();
    expect(screen.getByText(/料理名と食材名/u)).toBeInTheDocument();
    expect(screen.getByText(/90日/u)).toBeInTheDocument();
  });

  it("shows a loading line and no switch while the initial read is in flight (N-2)", () => {
    getTasteLearningEnabledMock.mockReturnValue(new Promise(() => undefined));
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    expect(screen.getByRole("status")).toHaveTextContent(tasteLearningCopy.loading);
    // 値が未確認のうちは、初期値 true を偽装した OFF 表示も含め一切表示しない
    expect(screen.queryByRole("switch", { name: "好みの学習" })).not.toBeInTheDocument();
  });

  it("loads the stored value and shows it on the switch", async () => {
    getTasteLearningEnabledMock.mockResolvedValue(true);
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "好みの学習" })).toBeChecked();
    });
    expect(screen.getByRole("switch", { name: "好みの学習" })).toBeEnabled();
  });

  it("shows an error line and a retry affordance when the read fails, hiding the switch until it succeeds (N-2)", async () => {
    getTasteLearningEnabledMock.mockRejectedValue(new Error("boom"));
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(tasteLearningCopy.loadError);
    });
    expect(screen.getByRole("button", { name: tasteLearningCopy.retry })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "好みの学習" })).not.toBeInTheDocument();
    expect(screen.getByText(/料理名と食材名/u)).toBeInTheDocument();

    getTasteLearningEnabledMock.mockResolvedValue(true);
    await userEvent.click(screen.getByRole("button", { name: tasteLearningCopy.retry }));
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "好みの学習" })).toBeChecked();
    });
  });

  it("shows retrying feedback and hides the retry button while a retry is in flight (N-4)", async () => {
    getTasteLearningEnabledMock.mockRejectedValueOnce(new Error("boom"));
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(tasteLearningCopy.loadError);
    });

    let resolveRetry: (value: boolean) => void = () => undefined;
    getTasteLearningEnabledMock.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveRetry = resolve;
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: tasteLearningCopy.retry }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: tasteLearningCopy.retry }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("status")).toHaveTextContent(tasteLearningCopy.loading);

    resolveRetry(true);
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "好みの学習" })).toBeChecked();
    });
  });

  it("keeps the switch enabled and hides the load error when a background refetch fails with cached data (N-3)", async () => {
    getTasteLearningEnabledMock
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("boom"));
    const { client } = renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    const toggle = await screen.findByRole("switch", { name: "好みの学習" });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    await client.invalidateQueries({ queryKey: tasteLearningKeys.current("user-1") });
    await waitFor(() => {
      expect(getTasteLearningEnabledMock).toHaveBeenCalledTimes(2);
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "好みの学習" })).toBeEnabled();
    expect(screen.getByRole("switch", { name: "好みの学習" })).toBeChecked();
  });

  it("applies the RPC's own result via setQueryData without waiting on a stuck follow-up refetch (N-6)", async () => {
    // 成功後の invalidate による裏取り再読は永遠に解決しない。
    // それでもスイッチが false になるのは setQueryData のおかげであることを確認する。
    getTasteLearningEnabledMock
      .mockResolvedValueOnce(true)
      .mockReturnValue(new Promise(() => undefined));
    setTasteLearningEnabledMock.mockResolvedValue(false);
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    const toggle = await screen.findByRole("switch", { name: "好みの学習" });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    await userEvent.click(toggle);

    await waitFor(() => {
      expect(setTasteLearningEnabledMock).toHaveBeenCalledTimes(1);
    });
    expect(setTasteLearningEnabledMock.mock.calls[0]?.[1]).toBe(false);
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "好みの学習" })).not.toBeChecked();
    });
  });

  it("follows a cache value that changes with no user action (N-6)", async () => {
    getTasteLearningEnabledMock.mockResolvedValue(true);
    const { client } = renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    const toggle = await screen.findByRole("switch", { name: "好みの学習" });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    act(() => {
      client.setQueryData(tasteLearningKeys.current("user-1"), false);
    });

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "好みの学習" })).not.toBeChecked();
    });
  });

  it("restores the previous value on the switch after observing the optimistic value mid-flight (N-7)", async () => {
    getTasteLearningEnabledMock.mockResolvedValue(true);
    let rejectWrite: (error: Error) => void = () => undefined;
    setTasteLearningEnabledMock.mockReturnValue(
      new Promise<boolean>((_resolve, reject) => {
        rejectWrite = reject;
      }),
    );
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    const toggle = await screen.findByRole("switch", { name: "好みの学習" });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    await userEvent.click(toggle);

    // 書き込み中は楽観値（OFF）を見せている — ここで戻り値がまだ true 固定でないことを確認する
    await waitFor(() => {
      expect(toggle).not.toBeChecked();
    });

    rejectWrite(new Error("boom"));

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "好みの学習" })).toBeChecked();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/変更できませんでした/u);
  });

  it("aborts a write that times out and applies the late server commit to the cache and switch (N-1)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      getTasteLearningEnabledMock.mockResolvedValue(true);
      const abortSignals: AbortSignal[] = [];
      let resolveWrite: (value: boolean) => void = () => undefined;
      setTasteLearningEnabledMock.mockImplementation(
        (_client: unknown, _enabled: boolean, options?: { signal?: AbortSignal }) => {
          if (options?.signal !== undefined) {
            abortSignals.push(options.signal);
          }
          return new Promise<boolean>((resolve) => {
            resolveWrite = resolve;
          });
        },
      );
      renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
      const toggle = await screen.findByRole("switch", { name: "好みの学習" });
      await waitFor(() => {
        expect(toggle).toBeChecked();
      });

      await user.click(toggle);
      await waitFor(() => {
        expect(setTasteLearningEnabledMock).toHaveBeenCalledTimes(1);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SHARE_CONSENT_TOGGLE_TIMEOUT_MS + 50);
      });

      expect(abortSignals[0]?.aborted).toBe(true);
      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(/変更できませんでした/u);
      });

      // サーバーは実際には commit していた。orphan な書き込みの遅延成功を cache/表示へ反映する。
      resolveWrite(false);
      await waitFor(() => {
        expect(screen.getByRole("switch", { name: "好みの学習" })).not.toBeChecked();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let a stale orphaned write overwrite the result of a second toggle (N-1)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      let serverValue = true;
      getTasteLearningEnabledMock.mockImplementation(() => Promise.resolve(serverValue));
      let resolveFirstWrite: (value: boolean) => void = () => undefined;
      let callCount = 0;
      setTasteLearningEnabledMock.mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          // 1回目 (OFF) は timeout する。abort 後もサーバー処理が続いた想定で、
          // このモックは resolve するだけで、その結果を serverValue には反映しない
          // （generation ガードで無視されるべき値であることをテストする）。
          return new Promise<boolean>((resolve) => {
            resolveFirstWrite = resolve;
          });
        }
        // 2回目 (OFF) は成功する。こちらがサーバーの真値になる。
        serverValue = false;
        return Promise.resolve(false);
      });
      renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
      const toggle = await screen.findByRole("switch", { name: "好みの学習" });
      await waitFor(() => {
        expect(toggle).toBeChecked();
      });

      // 1回目の OFF 操作は timeout する。裏取り再読は変更前のサーバー値 true を返す。
      await user.click(toggle);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SHARE_CONSENT_TOGGLE_TIMEOUT_MS + 50);
      });
      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      });
      expect(screen.getByRole("switch", { name: "好みの学習" })).toBeChecked();

      // 2回目も OFF 操作。今度は成功し、false を返す。こちらが正である。
      await user.click(screen.getByRole("switch", { name: "好みの学習" }));
      await waitFor(() => {
        expect(setTasteLearningEnabledMock).toHaveBeenCalledTimes(2);
      });
      await waitFor(() => {
        expect(screen.getByRole("switch", { name: "好みの学習" })).not.toBeChecked();
      });

      // 1回目の orphan な書き込みが遅れて true で解決しても、2回目の OFF 確定を上書きしない
      resolveFirstWrite(true);
      await waitFor(() => {
        expect(screen.getByRole("switch", { name: "好みの学習" })).not.toBeChecked();
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
