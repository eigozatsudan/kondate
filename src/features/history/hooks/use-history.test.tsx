import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MENU_ACCEPT_BROADCAST_CHANNEL,
  useAcceptMenuVersion,
} from "./use-history";

const acceptMenuVersionMock = vi.hoisted(() => vi.fn());

vi.mock("../api/history-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api/history-api")>();
  return {
    ...original,
    acceptMenuVersion: acceptMenuVersionMock,
  };
});

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({
    session: { user: { id: "40000000-0000-4000-8000-000000000001" } },
  }),
}));

const USER_ID = "40000000-0000-4000-8000-000000000001";
const MENU_A = "30000000-0000-4000-8000-000000000001";
const MENU_B = "30000000-0000-4000-8000-000000000002";

/** テスト用: postMessage を購読者へ配送する最小 BroadcastChannel スタブ */
class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>();
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly name: string;

  constructor(name: string) {
    this.name = name;
    const set = FakeBroadcastChannel.channels.get(name) ?? new Set();
    set.add(this);
    FakeBroadcastChannel.channels.set(name, set);
  }

  postMessage(data: unknown): void {
    const peers = FakeBroadcastChannel.channels.get(this.name);
    if (peers === undefined) return;
    for (const peer of peers) {
      // 同一タブには届けない（ブラウザ仕様）
      if (peer === this) continue;
      peer.onmessage?.({ data } as MessageEvent<unknown>);
    }
  }

  close(): void {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
  }

  static reset(): void {
    FakeBroadcastChannel.channels.clear();
  }
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useAcceptMenuVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acceptMenuVersionMock.mockResolvedValue(undefined);
    FakeBroadcastChannel.reset();
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  });

  afterEach(() => {
    FakeBroadcastChannel.reset();
    vi.unstubAllGlobals();
  });

  it("HR1: clears sibling menu-result isSelected when accepting another version", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // 案A を過去に開いたキャッシュ（isSelected:true residual）
    client.setQueryData(["menu-result", USER_ID, MENU_A, "history"], {
      menuId: MENU_A,
      isSelected: true,
    });
    client.setQueryData(["menu-result", USER_ID, MENU_B, "history"], {
      menuId: MENU_B,
      isSelected: false,
    });

    const { result } = renderHook(() => useAcceptMenuVersion(), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync(MENU_B);
    });

    await waitFor(() => {
      expect(acceptMenuVersionMock).toHaveBeenCalledWith(MENU_B);
    });

    const siblingA = client.getQueryData<{ isSelected?: boolean }>([
      "menu-result",
      USER_ID,
      MENU_A,
      "history",
    ]);
    const acceptedB = client.getQueryData<{ isSelected?: boolean }>([
      "menu-result",
      USER_ID,
      MENU_B,
      "history",
    ]);
    expect(siblingA?.isSelected).toBe(false);
    expect(acceptedB?.isSelected).toBe(true);
  });

  it("HR4: other tab accept broadcast clears sibling isSelected and marks accepted menu", async () => {
    // Tab B: 詳細を開いたまま。Tab A の採用 Broadcast を受けて cache を同期する
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["menu-result", USER_ID, MENU_A, "history"], {
      menuId: MENU_A,
      isSelected: true,
    });
    client.setQueryData(["menu-result", USER_ID, MENU_B, "history"], {
      menuId: MENU_B,
      isSelected: false,
    });

    // 受信側フック（詳細）をマウントして購読を張る
    renderHook(() => useAcceptMenuVersion(), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      const publisher = new FakeBroadcastChannel(MENU_ACCEPT_BROADCAST_CHANNEL);
      publisher.postMessage({ userId: USER_ID, menuId: MENU_B, at: Date.now() });
      publisher.close();
    });

    await waitFor(() => {
      const siblingA = client.getQueryData<{ isSelected?: boolean }>([
        "menu-result",
        USER_ID,
        MENU_A,
        "history",
      ]);
      const acceptedB = client.getQueryData<{ isSelected?: boolean }>([
        "menu-result",
        USER_ID,
        MENU_B,
        "history",
      ]);
      expect(siblingA?.isSelected).toBe(false);
      expect(acceptedB?.isSelected).toBe(true);
    });
  });

  it("HR4: accept success posts BroadcastChannel for other tabs", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const received: unknown[] = [];
    const listener = new FakeBroadcastChannel(MENU_ACCEPT_BROADCAST_CHANNEL);
    listener.onmessage = (event) => {
      received.push(event.data);
    };

    const { result } = renderHook(() => useAcceptMenuVersion(), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync(MENU_B);
    });

    await waitFor(() => {
      expect(received.length).toBeGreaterThanOrEqual(1);
    });
    expect(received[0]).toMatchObject({ userId: USER_ID, menuId: MENU_B });
    listener.close();
  });
});
