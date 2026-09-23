import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tasteLearningCopy } from "./taste-learning-copy";
import { tasteLearningKeys } from "./taste-learning-api";
import { TasteLearningSettingsSection } from "./taste-learning-settings-section";
import { TASTE_LEARNING_TOGGLE_TIMEOUT_MS } from "./taste-learning-timing";

const getTasteLearningStateMock = vi.hoisted(() => vi.fn());
const setTasteLearningEnabledMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({}),
}));

vi.mock("./taste-learning-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./taste-learning-api")>();
  return {
    ...actual,
    getTasteLearningState: getTasteLearningStateMock,
    setTasteLearningEnabled: setTasteLearningEnabledMock,
  };
});

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithClient(ui: ReactElement, client: QueryClient = makeClient()) {
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

type TasteLearningState = { enabled: boolean; seq: number };

/**
 * set_taste_learning_enabled と同じ比較更新（CAS）を持つテスト用の偽サーバー。
 * 連番が一致したときだけ書き込み、連番を 1 進める。一致しなければ現在値を返す。
 * 書き込みの届く順序をテストから操作できるようにし、遅れて届く古い書き込みが
 * 捨てられることまで確かめる。
 */
function createFakeServer(initial: TasteLearningState) {
  const state: TasteLearningState = { ...initial };
  return {
    state,
    read: (): TasteLearningState => ({ enabled: state.enabled, seq: state.seq }),
    cas: (enabled: boolean, expectedSeq: number) => {
      if (state.seq === expectedSeq) {
        state.enabled = enabled;
        state.seq += 1;
        return { enabled: state.enabled, seq: state.seq, applied: true };
      }
      return { enabled: state.enabled, seq: state.seq, applied: false };
    },
  };
}

type FakeServer = ReturnType<typeof createFakeServer>;

/** 読み取りと書き込みのモックを偽サーバーへつなぐ。 */
function wireServer(server: FakeServer) {
  getTasteLearningStateMock.mockImplementation(() => Promise.resolve(server.read()));
  setTasteLearningEnabledMock.mockImplementation(
    (_client: unknown, enabled: boolean, expectedSeq: number) =>
      Promise.resolve(server.cas(enabled, expectedSeq)),
  );
}

/**
 * 次の書き込み 1 回だけを「proxy に滞留する」書き込みにする。
 * 実の postgrest-js と同じく abort されると API ラッパーは reject するが、
 * サーバー側の commit は止まらない。arrive() を呼んだ時点で偽サーバーへ届く。
 */
function stallNextWrite(server: FakeServer) {
  let pendingArgs: { enabled: boolean; expectedSeq: number } | null = null;
  const signals: AbortSignal[] = [];
  setTasteLearningEnabledMock.mockImplementationOnce(
    (
      _client: unknown,
      enabled: boolean,
      expectedSeq: number,
      options?: { signal?: AbortSignal },
    ) => {
      pendingArgs = { enabled, expectedSeq };
      return new Promise((_resolve, reject) => {
        const signal = options?.signal;
        if (signal !== undefined) {
          signals.push(signal);
          signal.addEventListener("abort", () => {
            reject(new Error("AbortError"));
          });
        }
      });
    },
  );
  return {
    signals,
    arrive: () => {
      if (pendingArgs === null) throw new Error("the stalled write was never sent");
      return server.cas(pendingArgs.enabled, pendingArgs.expectedSeq);
    },
  };
}

function getSwitch() {
  return screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel });
}

describe("TasteLearningSettingsSection", () => {
  beforeEach(() => {
    getTasteLearningStateMock.mockReset();
    setTasteLearningEnabledMock.mockReset();
  });

  it("always shows the heading and the disclosure copy even before the read settles", () => {
    getTasteLearningStateMock.mockReturnValue(new Promise(() => undefined));
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    expect(screen.getByRole("heading", { name: tasteLearningCopy.title })).toBeInTheDocument();
    expect(screen.getByText(/料理名と食材名/u)).toBeInTheDocument();
    expect(screen.getByText(/90日/u)).toBeInTheDocument();
    expect(screen.getByText(/50献立/u)).toBeInTheDocument();
  });

  it("shows a loading line and no switch while the initial read is in flight", () => {
    getTasteLearningStateMock.mockReturnValue(new Promise(() => undefined));
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    expect(screen.getByRole("status")).toHaveTextContent(tasteLearningCopy.loading);
    // 値が未確認のうちは、初期値 true を偽装した OFF 表示も含め一切表示しない
    expect(
      screen.queryByRole("switch", { name: tasteLearningCopy.toggleLabel }),
    ).not.toBeInTheDocument();
  });

  it("loads the stored value and shows it on the switch", async () => {
    getTasteLearningStateMock.mockResolvedValue({ enabled: true, seq: 0 });
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).toBeChecked();
    });
    expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).toBeEnabled();
  });

  it("shows an error line and a retry affordance when the read fails, hiding the switch until it succeeds", async () => {
    getTasteLearningStateMock.mockRejectedValue(new Error("boom"));
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(tasteLearningCopy.loadError);
    });
    expect(screen.getByRole("button", { name: tasteLearningCopy.retry })).toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: tasteLearningCopy.toggleLabel }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/料理名と食材名/u)).toBeInTheDocument();

    getTasteLearningStateMock.mockResolvedValue({ enabled: true, seq: 0 });
    await userEvent.click(screen.getByRole("button", { name: tasteLearningCopy.retry }));
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).toBeChecked();
    });
  });

  it("keeps the retry button rendered but disabled with loading text while a retry is in flight, announcing it only once", async () => {
    getTasteLearningStateMock.mockRejectedValueOnce(new Error("boom"));
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(tasteLearningCopy.loadError);
    });

    let resolveRetry: (value: { enabled: boolean; seq: number }) => void = () => undefined;
    getTasteLearningStateMock.mockReturnValue(
      new Promise<{ enabled: boolean; seq: number }>((resolve) => {
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

    resolveRetry({ enabled: true, seq: 0 });
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).toBeChecked();
    });
  });

  it("keeps the switch enabled and hides the load error when a background refetch fails with cached data", async () => {
    getTasteLearningStateMock
      .mockResolvedValueOnce({ enabled: true, seq: 0 })
      .mockRejectedValueOnce(new Error("boom"));
    const { client } = renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    await client.invalidateQueries({ queryKey: tasteLearningKeys.current("user-1") });
    await waitFor(() => {
      expect(getTasteLearningStateMock).toHaveBeenCalledTimes(2);
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).toBeEnabled();
    expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).toBeChecked();
  });

  it("applies the RPC's own result via setQueryData without waiting on a stuck follow-up refetch", async () => {
    // 成功後の invalidate による裏取り再読は永遠に解決しない。
    // それでもスイッチが false になるのは setQueryData のおかげであることを確認する。
    getTasteLearningStateMock
      .mockResolvedValueOnce({ enabled: true, seq: 0 })
      .mockReturnValue(new Promise(() => undefined));
    setTasteLearningEnabledMock.mockResolvedValue({ enabled: false, seq: 1, applied: true });
    const { client } = renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    await userEvent.click(toggle);

    await waitFor(() => {
      expect(getSwitch()).not.toBeChecked();
    });
    expect(setTasteLearningEnabledMock).toHaveBeenCalledTimes(1);
    expect(setTasteLearningEnabledMock.mock.calls[0]?.[1]).toBe(false);
    expect(setTasteLearningEnabledMock.mock.calls[0]?.[2]).toBe(0);
    expect(client.getQueryData(tasteLearningKeys.current("user-1"))).toEqual({
      enabled: false,
      seq: 1,
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("follows a cache value that changes with no user action", async () => {
    getTasteLearningStateMock.mockResolvedValue({ enabled: true, seq: 0 });
    const { client } = renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    act(() => {
      client.setQueryData(tasteLearningKeys.current("user-1"), { enabled: false, seq: 1 });
    });

    await waitFor(() => {
      expect(getSwitch()).not.toBeChecked();
    });
  });

  it("round-trips the toggle OFF then ON then OFF, carrying the server seq into each write", async () => {
    const server = createFakeServer({ enabled: true, seq: 0 });
    wireServer(server);
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    await userEvent.click(toggle);
    await waitFor(() => {
      expect(toggle).not.toBeChecked();
    });
    await waitFor(() => {
      expect(toggle).toBeEnabled();
    });

    await userEvent.click(toggle);
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });
    await waitFor(() => {
      expect(toggle).toBeEnabled();
    });

    await userEvent.click(toggle);
    await waitFor(() => {
      expect(toggle).not.toBeChecked();
    });

    expect(
      setTasteLearningEnabledMock.mock.calls.map((call: unknown[]): unknown[] => [
        call[1],
        call[2],
      ]),
    ).toEqual([
      [false, 0],
      [true, 1],
      [false, 2],
    ]);
    expect(server.state).toEqual({ enabled: false, seq: 3 });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("treats a stuck write that committed before the reconcile read as success, with no fence write", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const server = createFakeServer({ enabled: true, seq: 0 });
      wireServer(server);
      const stalled = stallNextWrite(server);
      const { client } = renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
      const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
      await waitFor(() => {
        expect(toggle).toBeChecked();
      });

      await user.click(toggle);
      await waitFor(() => {
        expect(setTasteLearningEnabledMock).toHaveBeenCalledTimes(1);
      });
      // 応答は返ってこないが、サーバーでは timeout 前に commit 済み
      expect(stalled.arrive().applied).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(TASTE_LEARNING_TOGGLE_TIMEOUT_MS + 50);
      });
      expect(stalled.signals[0]?.aborted).toBe(true);

      await waitFor(() => {
        expect(getSwitch()).toBeEnabled();
      });
      expect(getSwitch()).not.toBeChecked();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      // 再読で要求値が見えたので、柵の書き込みは送らない
      expect(setTasteLearningEnabledMock).toHaveBeenCalledTimes(1);
      expect(client.getQueryData(tasteLearningKeys.current("user-1"))).toEqual({
        enabled: false,
        seq: 1,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("fences a stuck uncommitted write so it is discarded when it arrives late", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const server = createFakeServer({ enabled: false, seq: 0 });
      wireServer(server);
      const stalled = stallNextWrite(server);
      const { client } = renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
      const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
      await waitFor(() => {
        expect(toggle).not.toBeChecked();
      });

      // OFF の利用者が ON にしようとして、その書き込みが proxy に滞留する
      await user.click(toggle);
      await waitFor(() => {
        expect(setTasteLearningEnabledMock).toHaveBeenCalledTimes(1);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TASTE_LEARNING_TOGGLE_TIMEOUT_MS + 50);
      });
      expect(stalled.signals[0]?.aborted).toBe(true);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(tasteLearningCopy.failed);
      });
      // 柵の書き込み: 現在値（OFF）のまま、読んだ連番で連番だけを進める
      expect(setTasteLearningEnabledMock).toHaveBeenCalledTimes(2);
      expect(setTasteLearningEnabledMock.mock.calls[1]?.[1]).toBe(false);
      expect(setTasteLearningEnabledMock.mock.calls[1]?.[2]).toBe(0);
      expect(server.state).toEqual({ enabled: false, seq: 1 });
      expect(getSwitch()).not.toBeChecked();
      expect(getSwitch()).toBeEnabled();

      // 滞留していた ON の書き込みが今ごろ届く。連番が進んでいるので捨てられる
      expect(stalled.arrive()).toEqual({ enabled: false, seq: 1, applied: false });
      expect(server.state).toEqual({ enabled: false, seq: 1 });

      // 画面とキャッシュはサーバーの OFF のまま
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TASTE_LEARNING_TOGGLE_TIMEOUT_MS);
      });
      await waitFor(() => {
        expect(client.getQueryData(tasteLearningKeys.current("user-1"))).toEqual({
          enabled: false,
          seq: 1,
        });
      });
      expect(getSwitch()).not.toBeChecked();
      expect(screen.getByRole("alert")).toHaveTextContent(tasteLearningCopy.failed);
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores the server value after showing the optimistic value when the write rejects outright", async () => {
    const server = createFakeServer({ enabled: true, seq: 0 });
    wireServer(server);
    let rejectWrite: (error: Error) => void = () => undefined;
    setTasteLearningEnabledMock.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectWrite = reject;
        }),
    );
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    await userEvent.click(toggle);
    // 書き込み中は楽観値（OFF）を見せている
    await waitFor(() => {
      expect(toggle).not.toBeChecked();
    });

    rejectWrite(new Error("boom"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(tasteLearningCopy.failed);
    });
    expect(getSwitch()).toBeChecked();
    // 失敗しても柵で連番を進め、同じ要求が後から通らないようにしている
    expect(server.state).toEqual({ enabled: true, seq: 1 });
  });

  it("shows the failure alert and the truth when another device already changed the value", async () => {
    const server = createFakeServer({ enabled: true, seq: 0 });
    wireServer(server);
    const { client } = renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    // 別の端末が OFF にしてから ON に戻した（この画面の連番 0 は古い）
    server.cas(false, 0);
    server.cas(true, 1);

    await userEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(tasteLearningCopy.failed);
    });
    expect(getSwitch()).toBeChecked();
    expect(setTasteLearningEnabledMock).toHaveBeenCalledTimes(1);
    expect(server.state).toEqual({ enabled: true, seq: 2 });
    await waitFor(() => {
      expect(client.getQueryData(tasteLearningKeys.current("user-1"))).toEqual({
        enabled: true,
        seq: 2,
      });
    });
  });

  it("treats a non-applied write as success when the server already holds the requested value", async () => {
    const server = createFakeServer({ enabled: true, seq: 0 });
    wireServer(server);
    const { client } = renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    // 別の端末が先に同じ OFF を書いていた
    server.cas(false, 0);

    await userEvent.click(toggle);

    await waitFor(() => {
      expect(getSwitch()).toBeEnabled();
    });
    expect(getSwitch()).not.toBeChecked();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(setTasteLearningEnabledMock).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(tasteLearningKeys.current("user-1"))).toEqual({
      enabled: false,
      seq: 1,
    });
  });

  it("invalidates and shows the failure alert when the fence write fails", async () => {
    const server = createFakeServer({ enabled: true, seq: 0 });
    wireServer(server);
    setTasteLearningEnabledMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("fence failed"));
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    await userEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(tasteLearningCopy.failed);
    });
    expect(setTasteLearningEnabledMock).toHaveBeenCalledTimes(2);
    // 初回読み取り + 裏取りの 1 回 + invalidate による再読
    await waitFor(() => {
      expect(getTasteLearningStateMock).toHaveBeenCalledTimes(3);
    });
    expect(getSwitch()).toBeChecked();
    expect(getSwitch()).toBeEnabled();
  });

  it("invalidates and shows the failure alert when the reconcile read fails", async () => {
    getTasteLearningStateMock
      .mockResolvedValueOnce({ enabled: true, seq: 0 })
      .mockRejectedValueOnce(new Error("read failed"))
      .mockResolvedValue({ enabled: true, seq: 0 });
    setTasteLearningEnabledMock.mockRejectedValue(new Error("boom"));
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    await userEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(tasteLearningCopy.failed);
    });
    // 読めなかったので柵は送らない
    expect(setTasteLearningEnabledMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(getTasteLearningStateMock).toHaveBeenCalledTimes(3);
    });
    expect(getSwitch()).toBeChecked();
    expect(getSwitch()).toBeEnabled();
  });
});
