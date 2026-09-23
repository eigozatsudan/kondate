import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tasteLearningCopy } from "./taste-learning-copy";
import { tasteLearningKeys } from "./taste-learning-api";
import { TasteLearningSettingsSection } from "./taste-learning-settings-section";
import {
  TASTE_LEARNING_RECONCILE_ATTEMPTS,
  TASTE_LEARNING_RECONCILE_RETRY_DELAY_MS,
  TASTE_LEARNING_TOGGLE_TIMEOUT_MS,
} from "./taste-learning-timing";

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
    expect(screen.getByText(/50献立/u)).toBeInTheDocument();
  });

  it("shows a loading line and no switch while the initial read is in flight", () => {
    getTasteLearningEnabledMock.mockReturnValue(new Promise(() => undefined));
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    expect(screen.getByRole("status")).toHaveTextContent(tasteLearningCopy.loading);
    // 値が未確認のうちは、初期値 true を偽装した OFF 表示も含め一切表示しない
    expect(
      screen.queryByRole("switch", { name: tasteLearningCopy.toggleLabel }),
    ).not.toBeInTheDocument();
  });

  it("loads the stored value and shows it on the switch", async () => {
    getTasteLearningEnabledMock.mockResolvedValue(true);
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).toBeChecked();
    });
    expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).toBeEnabled();
  });

  it("shows an error line and a retry affordance when the read fails, hiding the switch until it succeeds", async () => {
    getTasteLearningEnabledMock.mockRejectedValue(new Error("boom"));
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(tasteLearningCopy.loadError);
    });
    expect(screen.getByRole("button", { name: tasteLearningCopy.retry })).toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: tasteLearningCopy.toggleLabel }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/料理名と食材名/u)).toBeInTheDocument();

    getTasteLearningEnabledMock.mockResolvedValue(true);
    await userEvent.click(screen.getByRole("button", { name: tasteLearningCopy.retry }));
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).toBeChecked();
    });
  });

  it("keeps the retry button rendered but disabled with loading text while a retry is in flight, announcing it only once", async () => {
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
    const retryButton = screen.getByRole("button", { name: tasteLearningCopy.retry });
    retryButton.focus();
    await userEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: tasteLearningCopy.loading })).toBeDisabled();
    });
    // フォーカス中のボタンを unmount しない
    expect(screen.getByRole("button", { name: tasteLearningCopy.loading })).toHaveFocus();
    // ボタンのラベルが読み込み中を伝えるので、role="status" の重複表示は出さない
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    resolveRetry(true);
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).toBeChecked();
    });
  });

  it("keeps the switch enabled and hides the load error when a background refetch fails with cached data", async () => {
    getTasteLearningEnabledMock
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("boom"));
    const { client } = renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    await client.invalidateQueries({ queryKey: tasteLearningKeys.current("user-1") });
    await waitFor(() => {
      expect(getTasteLearningEnabledMock).toHaveBeenCalledTimes(2);
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).toBeEnabled();
    expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).toBeChecked();
  });

  it("applies the RPC's own result via setQueryData without waiting on a stuck follow-up refetch", async () => {
    // 成功後の invalidate による裏取り再読は永遠に解決しない。
    // それでもスイッチが false になるのは setQueryData のおかげであることを確認する。
    getTasteLearningEnabledMock
      .mockResolvedValueOnce(true)
      .mockReturnValue(new Promise(() => undefined));
    setTasteLearningEnabledMock.mockResolvedValue(false);
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    await userEvent.click(toggle);

    await waitFor(() => {
      expect(setTasteLearningEnabledMock).toHaveBeenCalledTimes(1);
    });
    expect(setTasteLearningEnabledMock.mock.calls[0]?.[1]).toBe(false);
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).not.toBeChecked();
    });
  });

  it("follows a cache value that changes with no user action", async () => {
    getTasteLearningEnabledMock.mockResolvedValue(true);
    const { client } = renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    act(() => {
      client.setQueryData(tasteLearningKeys.current("user-1"), false);
    });

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).not.toBeChecked();
    });
  });

  it("round-trips the toggle OFF then ON then OFF through the RPC mock and the cache", async () => {
    // 各書き込み成功後の invalidate 裏取りが実際のサーバー値を返す前提を作るため、
    // 読み取りモックも書き込みと同じ順で値を返す（初回読み取り→3 回の裏取り）。
    getTasteLearningEnabledMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    setTasteLearningEnabledMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    await userEvent.click(toggle);
    await waitFor(() => {
      expect(toggle).not.toBeChecked();
    });

    await userEvent.click(toggle);
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    await userEvent.click(toggle);
    await waitFor(() => {
      expect(toggle).not.toBeChecked();
    });

    expect(setTasteLearningEnabledMock).toHaveBeenCalledTimes(3);
    expect(setTasteLearningEnabledMock.mock.calls[0]?.[1]).toBe(false);
    expect(setTasteLearningEnabledMock.mock.calls[1]?.[1]).toBe(true);
    expect(setTasteLearningEnabledMock.mock.calls[2]?.[1]).toBe(false);
  });

  it("restores the previous value on the switch after observing the optimistic value mid-flight", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      // 書き込み失敗後の裏取り再読も、変更前のサーバー値 true を返し続ける（未 commit）。
      getTasteLearningEnabledMock.mockResolvedValue(true);
      let rejectWrite: (error: Error) => void = () => undefined;
      setTasteLearningEnabledMock.mockReturnValue(
        new Promise<boolean>((_resolve, reject) => {
          rejectWrite = reject;
        }),
      );
      renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
      const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
      await waitFor(() => {
        expect(toggle).toBeChecked();
      });

      await user.click(toggle);

      // 書き込み中は楽観値（OFF）を見せている — ここで戻り値がまだ true 固定でないことを確認する
      await waitFor(() => {
        expect(toggle).not.toBeChecked();
      });

      rejectWrite(new Error("boom"));

      for (let attempt = 0; attempt < TASTE_LEARNING_RECONCILE_ATTEMPTS; attempt += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(TASTE_LEARNING_RECONCILE_RETRY_DELAY_MS + 50);
        });
      }

      await waitFor(() => {
        expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).toBeChecked();
      });
      expect(screen.getByRole("alert")).toHaveTextContent(/変更できませんでした/u);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects on abort like the real client, then reconciles from a later re-read with no failure alert", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      getTasteLearningEnabledMock.mockResolvedValueOnce(true);
      const abortSignals: AbortSignal[] = [];
      // 実の postgrest-js と同じく、abort されたら reject する（resolve はしない）。
      setTasteLearningEnabledMock.mockImplementation(
        (_client: unknown, _enabled: boolean, options?: { signal?: AbortSignal }) =>
          new Promise<boolean>((_resolve, reject) => {
            const signal = options?.signal;
            if (signal !== undefined) {
              abortSignals.push(signal);
              signal.addEventListener("abort", () => {
                reject(new Error("AbortError"));
              });
            }
          }),
      );
      renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
      const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
      await waitFor(() => {
        expect(toggle).toBeChecked();
      });

      // 裏取りの再読: 1回目は commit 前の古い値 (true) を返し、2回目でサーバーの
      // commit 済みの値 (false) が見える。
      getTasteLearningEnabledMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await user.click(toggle);
      await waitFor(() => {
        expect(setTasteLearningEnabledMock).toHaveBeenCalledTimes(1);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(TASTE_LEARNING_TOGGLE_TIMEOUT_MS + 50);
      });
      expect(abortSignals[0]?.aborted).toBe(true);

      // 1回目の再読はまだ commit 前の値なので一致せず、再読間隔を空けて再試行する。
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TASTE_LEARNING_RECONCILE_RETRY_DELAY_MS + 50);
      });

      // 2回目の再読でサーバーが実際に commit していた false が確認でき、成功扱いになる。
      // 書き込み中も楽観値は OFF なので、pending が解けた（スイッチが有効に戻った）ことまで見る。
      await waitFor(() => {
        expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).toBeEnabled();
      });
      expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).not.toBeChecked();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      // 初回読み取り 1 回 + 裏取り 2 回で打ち切っている（一致後に 3 回目を読まない）
      expect(getTasteLearningEnabledMock).toHaveBeenCalledTimes(3);

      // 残りの再読間隔を過ぎても失敗表示は出ず、値も戻らない
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TASTE_LEARNING_RECONCILE_RETRY_DELAY_MS * 3);
      });
      expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).not.toBeChecked();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the failure alert and the server value when every reconciliation re-read still returns the old value", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      getTasteLearningEnabledMock.mockResolvedValueOnce(true);
      setTasteLearningEnabledMock.mockImplementation(
        (_client: unknown, _enabled: boolean, options?: { signal?: AbortSignal }) =>
          new Promise<boolean>((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () => {
              reject(new Error("AbortError"));
            });
          }),
      );
      renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
      const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
      await waitFor(() => {
        expect(toggle).toBeChecked();
      });

      // 全ての裏取り再読が、変更前のサーバー値 true を返し続ける（未 commit）。
      getTasteLearningEnabledMock.mockResolvedValue(true);

      await user.click(toggle);
      await waitFor(() => {
        expect(setTasteLearningEnabledMock).toHaveBeenCalledTimes(1);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(TASTE_LEARNING_TOGGLE_TIMEOUT_MS + 50);
      });
      for (let attempt = 0; attempt < TASTE_LEARNING_RECONCILE_ATTEMPTS; attempt += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(TASTE_LEARNING_RECONCILE_RETRY_DELAY_MS + 50);
        });
      }

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(/変更できませんでした/u);
      });
      expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).toBeChecked();
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-checks the server after every reconciliation re-read rejects, spacing re-reads by the retry delay", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      getTasteLearningEnabledMock.mockResolvedValueOnce(true);
      setTasteLearningEnabledMock.mockRejectedValue(new Error("boom"));
      renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
      const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
      await waitFor(() => {
        expect(toggle).toBeChecked();
      });

      // 裏取りの再読はすべて失敗する（通信断など）
      getTasteLearningEnabledMock.mockRejectedValue(new Error("read failed"));

      await user.click(toggle);
      // 書き込み失敗の直後に 1 回目の再読（初回読み取りと合わせて 2 回）
      await waitFor(() => {
        expect(getTasteLearningEnabledMock).toHaveBeenCalledTimes(2);
      });

      // 再読間隔が過ぎるまでは次の再読をしない
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TASTE_LEARNING_RECONCILE_RETRY_DELAY_MS / 2);
      });
      expect(getTasteLearningEnabledMock).toHaveBeenCalledTimes(2);

      for (let attempt = 1; attempt < TASTE_LEARNING_RECONCILE_ATTEMPTS; attempt += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(TASTE_LEARNING_RECONCILE_RETRY_DELAY_MS + 50);
        });
      }

      // 再読 3 回がすべて失敗 → invalidate でサーバーへの裏取りをもう 1 回やり直す
      await waitFor(() => {
        expect(getTasteLearningEnabledMock).toHaveBeenCalledTimes(
          1 + TASTE_LEARNING_RECONCILE_ATTEMPTS + 1,
        );
      });
      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(/変更できませんでした/u);
      });
      // 読み込めていた値は保持し、スイッチは変更前の値へ戻って操作できる
      expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).toBeChecked();
      expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
