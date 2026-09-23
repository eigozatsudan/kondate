import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tasteLearningCopy } from "./taste-learning-copy";
import { tasteLearningKeys } from "./taste-learning-api";
import { TasteLearningSettingsSection } from "./taste-learning-settings-section";
import {
  TASTE_LEARNING_FENCE_ATTEMPTS,
  TASTE_LEARNING_FENCE_RETRY_DELAY_MS,
  TASTE_LEARNING_TOGGLE_TIMEOUT_MS,
} from "./taste-learning-timing";

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

  it("shows the failure alert when a retried fence eventually answers with a different value", async () => {
    // 柵は最大 TASTE_LEARNING_FENCE_ATTEMPTS 回まで再試行する。1 回目が失敗しても、
    // 2 回目で答え（要求とは食い違う値）が得られれば、そこで再試行をやめて失敗表示にする。
    const server = createFakeServer({ enabled: true, seq: 0 });
    wireServer(server);
    setTasteLearningEnabledMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("fence 1 failed"));
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    await userEvent.click(toggle);

    await waitFor(
      () => {
        expect(screen.getByRole("alert")).toHaveTextContent(tasteLearningCopy.failed);
      },
      { timeout: 10_000 },
    );
    // 元の書き込み + 柵 1 回目（失敗）+ 柵 2 回目（答えは得られたが要求と食い違う）
    expect(setTasteLearningEnabledMock).toHaveBeenCalledTimes(3);
    // 初回読み取り + 裏取りの読み + 柵 2 回目の前の読み直し
    expect(getTasteLearningStateMock).toHaveBeenCalledTimes(3);
    expect(getSwitch()).toBeChecked();
    expect(getSwitch()).toBeEnabled();
  }, 15_000);

  it("treats a fence that answers applied:false with the requested value as success, not failure (M-2)", async () => {
    // このテストは、fence.enabled === nextEnabled のときに早期 return する分岐が
    // 削除されると、代わりに元の書き込みエラーが投げられて失敗表示になり、失敗する。
    getTasteLearningStateMock
      .mockResolvedValueOnce({ enabled: true, seq: 0 })
      .mockResolvedValueOnce({ enabled: true, seq: 0 });
    setTasteLearningEnabledMock
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValueOnce({ enabled: false, seq: 5, applied: false });
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    await userEvent.click(toggle);

    await waitFor(() => {
      expect(getSwitch()).not.toBeChecked();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(setTasteLearningEnabledMock).toHaveBeenCalledTimes(2);
  });

  it("retries the fence after failures and stops once an attempt gets an answer, without a persistent alert", async () => {
    getTasteLearningStateMock
      .mockResolvedValueOnce({ enabled: true, seq: 0 }) // 初期読み込み
      .mockResolvedValueOnce({ enabled: true, seq: 0 }) // 書き込み失敗後の裏取り読み
      .mockResolvedValueOnce({ enabled: true, seq: 0 }) // 柵 1 失敗後の再読
      .mockResolvedValueOnce({ enabled: true, seq: 0 }); // 柵 2 失敗後の再読
    setTasteLearningEnabledMock
      .mockRejectedValueOnce(new Error("write failed"))
      .mockRejectedValueOnce(new Error("fence 1 failed"))
      .mockRejectedValueOnce(new Error("fence 2 failed"))
      .mockResolvedValueOnce({ enabled: true, seq: 1, applied: true }); // 柵 3 で答えが得られる

    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    await userEvent.click(toggle);

    await waitFor(
      () => {
        expect(screen.getByRole("alert")).toHaveTextContent(tasteLearningCopy.failed);
      },
      { timeout: 10_000 },
    );
    expect(screen.queryByText(tasteLearningCopy.unconfirmed)).not.toBeInTheDocument();
    // 本来の書き込み 1 回 + 柵 3 回
    expect(setTasteLearningEnabledMock).toHaveBeenCalledTimes(4);
  }, 15_000);

  it("shows a persistent unconfirmed alert when every fence attempt fails, and the retry button clears it once it resolves", async () => {
    getTasteLearningStateMock
      .mockResolvedValueOnce({ enabled: true, seq: 0 }) // 初期読み込み
      .mockResolvedValueOnce({ enabled: true, seq: 0 }) // 書き込み失敗後の裏取り読み
      .mockResolvedValueOnce({ enabled: true, seq: 0 }) // 柵 1 失敗後の再読
      .mockResolvedValueOnce({ enabled: true, seq: 0 }); // 柵 2 失敗後の再読
    setTasteLearningEnabledMock
      .mockRejectedValueOnce(new Error("write failed"))
      .mockRejectedValueOnce(new Error("fence 1 failed"))
      .mockRejectedValueOnce(new Error("fence 2 failed"))
      .mockRejectedValueOnce(new Error("fence 3 failed"));

    const { client } = renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    await userEvent.click(toggle);

    await waitFor(
      () => {
        expect(screen.getByRole("alert")).toHaveTextContent(tasteLearningCopy.unconfirmed);
      },
      { timeout: 10_000 },
    );
    expect(screen.queryByText(tasteLearningCopy.failed)).not.toBeInTheDocument();
    // スイッチは直前に読んだサーバー値（ON）のまま。楽観の OFF には戻さない
    expect(getSwitch()).toBeChecked();
    expect(getSwitch()).toBeEnabled();
    expect(client.getQueryData(tasteLearningKeys.current("user-1"))).toEqual({
      enabled: true,
      seq: 0,
    });
    const retryButton = screen.getByRole("button", { name: tasteLearningCopy.unconfirmedRetry });
    expect(retryButton).toBeEnabled();

    // 再読では要求（OFF）とまだ食い違う。柵を 1 回送り、それが答えを返せば警告を下げる
    getTasteLearningStateMock.mockResolvedValueOnce({ enabled: true, seq: 0 });
    setTasteLearningEnabledMock.mockResolvedValueOnce({ enabled: true, seq: 1, applied: true });

    await userEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
    expect(getSwitch()).toBeChecked();
    expect(client.getQueryData(tasteLearningKeys.current("user-1"))).toEqual({
      enabled: true,
      seq: 1,
    });
  }, 15_000);

  it("keeps a remounted instance's cache from being regressed by a late reconcile read from a stale instance (M-1)", async () => {
    let resolveOldRead: (value: { enabled: boolean; seq: number }) => void = () => undefined;
    getTasteLearningStateMock
      .mockResolvedValueOnce({ enabled: true, seq: 0 }) // 旧インスタンスの初期読み込み
      .mockImplementationOnce(
        () =>
          new Promise<{ enabled: boolean; seq: number }>((resolve) => {
            resolveOldRead = resolve;
          }),
      ); // 旧インスタンスの裏取り読み。remount しても保留のまま
    // 上の 2 回の意図した呼び出しは Once キューが優先されるため乱れない。
    // それ以外の偶発的な背景 fetch（新インスタンスの mount 時 refetch など）が
    // 古い値を返しても、queryFn 側の連番ガード（本体側の修正）が上書きを防ぐ。
    getTasteLearningStateMock.mockResolvedValue({ enabled: true, seq: 0 });

    setTasteLearningEnabledMock.mockRejectedValueOnce(new Error("write failed"));

    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity,
          // remount 後の useQuery が、まだ新鮮な cache を無視してもう一度 queryFn を
          // 呼ぶと、旧インスタンスの裏取り読みと呼び出し順序を数えているこのテストの
          // 前提が崩れる。ここでは remount 時の裏取り再読そのものを検証したいのでは
          // ないため、はっきり止めておく。
          refetchOnMount: false,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      },
    });
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <TasteLearningSettingsSection userId="user-1" />
      </QueryClientProvider>,
    );
    const oldToggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
    await waitFor(() => {
      expect(oldToggle).toBeChecked();
    });
    await userEvent.click(oldToggle); // OFF へ、seq 0 を期待
    await waitFor(() => {
      expect(setTasteLearningEnabledMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(getTasteLearningStateMock).toHaveBeenCalledTimes(2);
    });

    unmount();

    setTasteLearningEnabledMock
      .mockResolvedValueOnce({ enabled: false, seq: 1, applied: true })
      .mockResolvedValueOnce({ enabled: true, seq: 2, applied: true });
    render(
      <QueryClientProvider client={client}>
        <TasteLearningSettingsSection userId="user-1" />
      </QueryClientProvider>,
    );
    const newToggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
    await waitFor(() => {
      expect(newToggle).toBeChecked(); // 旧キャッシュ（ON, seq 0）のまま
    });

    await userEvent.click(newToggle); // OFF へ、seq 0 で通る
    await waitFor(() => {
      expect(newToggle).not.toBeChecked();
    });
    await userEvent.click(newToggle); // ON へ、seq 1 で通る
    await waitFor(() => {
      expect(newToggle).toBeChecked();
    });

    // 旧インスタンスの裏取り読みがようやく届く。要求どおりの値（OFF）だが連番は古い（1 < 2）
    resolveOldRead({ enabled: false, seq: 1 });

    await waitFor(() => {
      expect(client.getQueryData(tasteLearningKeys.current("user-1"))).toEqual({
        enabled: true,
        seq: 2,
      });
    });
    expect(newToggle).toBeChecked();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("still fences the stalled write when the first reconcile read fails (I-1)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const server = createFakeServer({ enabled: false, seq: 0 });
      wireServer(server);
      getTasteLearningStateMock
        .mockImplementationOnce(() => Promise.resolve(server.read())) // 初期読み込み
        .mockRejectedValueOnce(new Error("read failed")); // 書き込み失敗後の 1 回目の読み
      const stalled = stallNextWrite(server);
      renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
      const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
      await waitFor(() => {
        expect(toggle).not.toBeChecked();
      });

      await user.click(toggle);
      await waitFor(() => {
        expect(setTasteLearningEnabledMock).toHaveBeenCalledTimes(1);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TASTE_LEARNING_TOGGLE_TIMEOUT_MS + 50);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TASTE_LEARNING_FENCE_RETRY_DELAY_MS + 50);
      });

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(tasteLearningCopy.failed);
      });
      // 読み取りに失敗しても諦めず、読み直してから柵を送っている
      expect(setTasteLearningEnabledMock).toHaveBeenCalledTimes(2);
      expect(server.state).toEqual({ enabled: false, seq: 1 });
      // 滞留していた ON は今ごろ届いても捨てられる
      expect(stalled.arrive().applied).toBe(false);
      expect(getSwitch()).not.toBeChecked();
    } finally {
      vi.useRealTimers();
    }
  });

  describe("unconfirmed writes", () => {
    /** down の間は読み書きがすべて失敗する偽サーバーをつなぐ。 */
    function wireFlakyServer(server: FakeServer) {
      const link = { down: false };
      getTasteLearningStateMock.mockImplementation(() =>
        link.down ? Promise.reject(new Error("offline")) : Promise.resolve(server.read()),
      );
      setTasteLearningEnabledMock.mockImplementation(
        (_client: unknown, enabled: boolean, expectedSeq: number) =>
          link.down
            ? Promise.reject(new Error("offline"))
            : Promise.resolve(server.cas(enabled, expectedSeq)),
      );
      return link;
    }

    async function renderAndGoUnconfirmed(client: QueryClient, server: FakeServer) {
      const link = wireFlakyServer(server);
      const view = renderWithClient(<TasteLearningSettingsSection userId="user-1" />, client);
      const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
      await waitFor(() => {
        expect(toggle).toBeChecked();
      });
      link.down = true;
      await userEvent.click(toggle);
      await waitFor(
        () => {
          expect(screen.getByRole("alert")).toHaveTextContent(tasteLearningCopy.unconfirmed);
        },
        { timeout: 10_000 },
      );
      return { link, view };
    }

    it("keeps the unconfirmed alert across a remount and clears it through the retry button", async () => {
      // 既定の gcTime（5 分）ではテスト中に掃除が走らないので、既定を 0 にして
      // 記録側の gcTime: Infinity が効いていることを確かめる
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
      const server = createFakeServer({ enabled: true, seq: 0 });
      const { link, view } = await renderAndGoUnconfirmed(client, server);

      view.unmount();
      // 画面を離れている間に、使われていない cache の掃除が走るだけの時間をおく
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      // 設定値の cache は掃除されているので、開き直すと読み直す（通信は戻っている）
      link.down = false;
      renderWithClient(<TasteLearningSettingsSection userId="user-1" />, client);
      expect(
        await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel }),
      ).toBeChecked();
      // 連番が進んでいない読み取りなので、確定していない以上は警告を出し続ける
      expect(screen.getByRole("alert")).toHaveTextContent(tasteLearningCopy.unconfirmed);
      let releaseRead: () => void = () => undefined;
      getTasteLearningStateMock.mockImplementationOnce(
        () =>
          new Promise<TasteLearningState>((resolve) => {
            releaseRead = () => {
              resolve(server.read());
            };
          }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: tasteLearningCopy.unconfirmedRetry }),
      );
      // 確かめている間はボタンを残したまま disabled + 読み込み中の文言にする
      expect(await screen.findByRole("button", { name: tasteLearningCopy.loading })).toBeDisabled();

      releaseRead();
      await waitFor(() => {
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      });
      // 連番が進んでいなかったので柵で閉じた
      expect(server.state).toEqual({ enabled: true, seq: 1 });
      expect(getSwitch()).toBeChecked();
    }, 15_000);

    it("keeps the alert while the retry still cannot reach the server", async () => {
      const client = makeClient();
      const server = createFakeServer({ enabled: true, seq: 0 });
      await renderAndGoUnconfirmed(client, server);

      const readsBefore = getTasteLearningStateMock.mock.calls.length;
      await userEvent.click(
        screen.getByRole("button", { name: tasteLearningCopy.unconfirmedRetry }),
      );
      await waitFor(() => {
        expect(getTasteLearningStateMock.mock.calls.length).toBe(readsBefore + 1);
      });
      expect(
        await screen.findByRole("button", { name: tasteLearningCopy.unconfirmedRetry }),
      ).toBeEnabled();
      expect(screen.getByRole("alert")).toHaveTextContent(tasteLearningCopy.unconfirmed);
    }, 15_000);

    it("disables the retry button while a toggle write is in flight", async () => {
      // 書き込み中に柵を送ると、その書き込みの連番を奪って偽の失敗表示を出す
      const client = makeClient();
      client.setQueryData(tasteLearningKeys.unconfirmed("user-1"), {
        requestedEnabled: false,
        expectedSeq: 0,
      });
      const server = createFakeServer({ enabled: true, seq: 0 });
      wireServer(server);
      setTasteLearningEnabledMock.mockReturnValueOnce(new Promise(() => undefined));
      renderWithClient(<TasteLearningSettingsSection userId="user-1" />, client);
      const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
      await waitFor(() => {
        expect(toggle).toBeChecked();
      });
      expect(
        screen.getByRole("button", { name: tasteLearningCopy.unconfirmedRetry }),
      ).toBeEnabled();

      await userEvent.click(toggle);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: tasteLearningCopy.unconfirmedRetry }),
        ).toBeDisabled();
      });
    });

    it("does not let an older write's unconfirmed record overwrite a newer one", async () => {
      // 画面を開き直した後の別の書き込み（連番 1）が先に未確定になっている。
      // この画面の cache はまだ連番 0 のままで、連番 0 の書き込みも未確定に終わる
      const client = makeClient();
      const newer = { requestedEnabled: true, expectedSeq: 1 };
      client.setQueryData(tasteLearningKeys.unconfirmed("user-1"), newer);
      const server = createFakeServer({ enabled: true, seq: 0 });
      const link = wireFlakyServer(server);
      renderWithClient(<TasteLearningSettingsSection userId="user-1" />, client);
      const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
      await waitFor(() => {
        expect(toggle).toBeChecked();
      });

      link.down = true;
      const readsBefore = getTasteLearningStateMock.mock.calls.length;
      await userEvent.click(toggle);
      // 確定処理の読み取りが TASTE_LEARNING_FENCE_ATTEMPTS 回すべて失敗し、書き込みが終わるまで待つ
      await waitFor(
        () => {
          expect(getTasteLearningStateMock.mock.calls.length).toBe(
            readsBefore + TASTE_LEARNING_FENCE_ATTEMPTS,
          );
          expect(toggle).toBeEnabled();
        },
        { timeout: 10_000 },
      );
      // 新しい記録が残るので、連番 1 を超えるまで警告は消えない
      expect(client.getQueryData(tasteLearningKeys.unconfirmed("user-1"))).toEqual(newer);
    }, 15_000);

    it("clears the alert on its own once any read shows the seq moved past the unconfirmed write", async () => {
      const client = makeClient();
      const server = createFakeServer({ enabled: true, seq: 0 });
      const { link } = await renderAndGoUnconfirmed(client, server);
      link.down = false;

      // 連番が同じ読み取りでは、滞留中の書き込みがまだ通りうるので消さない
      const readsBefore = getTasteLearningStateMock.mock.calls.length;
      await act(async () => {
        await client.invalidateQueries({ queryKey: tasteLearningKeys.current("user-1") });
      });
      expect(getTasteLearningStateMock.mock.calls.length).toBe(readsBefore + 1);
      // 画面への通知は非同期なので、記録そのものが残っていることを直接確かめる
      expect(client.getQueryData(tasteLearningKeys.unconfirmed("user-1"))).toEqual({
        requestedEnabled: false,
        expectedSeq: 0,
      });
      expect(screen.getByRole("alert")).toHaveTextContent(tasteLearningCopy.unconfirmed);

      // 滞留していた OFF が届いた（または別端末が書いた）後の読み取りで消える
      server.cas(false, 0);
      await act(async () => {
        await client.invalidateQueries({ queryKey: tasteLearningKeys.current("user-1") });
      });
      await waitFor(() => {
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      });
      expect(getSwitch()).not.toBeChecked();
      expect(client.getQueryData(tasteLearningKeys.unconfirmed("user-1"))).toBeNull();
    }, 15_000);
  });
});
