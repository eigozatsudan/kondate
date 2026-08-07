import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLYER_LOCKED_PREVIEW_COPY } from "@shared/contracts/flyer-weekly";
import {
  clearFlyerStickyAttempt,
  FlyerWeeklyPanel,
  flyerStickyStorageKey,
  fingerprintFlyerImage,
  readFlyerStickyAttempt,
  writeFlyerStickyAttempt,
} from "./flyer-weekly-panel";

const FLYER_USER_ID = "72000000-0000-4000-8000-000000000099";

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({
    session: { access_token: "t", user: { id: FLYER_USER_ID } },
  }),
}));

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: vi.fn(),
}));

describe("FlyerWeeklyPanel", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    localStorage.clear();
  });

  it("shows locked preview copy for Free", () => {
    render(
      <MemoryRouter>
        <FlyerWeeklyPanel plusEntitled={false} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("flyer-weekly-locked")).toBeVisible();
    expect(screen.getByText(FLYER_LOCKED_PREVIEW_COPY)).toBeVisible();
    const plusLink = screen.getByRole("link", { name: "Plus を見る" });
    expect(plusLink).toBeVisible();
    // 未定義の .button.primary ではなく共通 CTA クラスを使う（レイアウト崩れ防止）
    expect(plusLink).toHaveClass("primary-button");
    expect(plusLink).toHaveAttribute("href", "/plus");
  });

  it("shows upload control for Plus when privacy is accepted", () => {
    render(
      <MemoryRouter>
        <FlyerWeeklyPanel plusEntitled hasAcceptedPrivacy />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("flyer-weekly-upload")).toBeVisible();
    const upload = screen.getByText("チラシ写真を選ぶ");
    expect(upload).toBeVisible();
    expect(upload).toHaveClass("secondary-button");
  });

  it("PRIV-1: Plus without privacy consent routes to notice instead of upload", () => {
    render(
      <MemoryRouter>
        <FlyerWeeklyPanel plusEntitled hasAcceptedPrivacy={false} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("flyer-weekly-privacy")).toBeVisible();
    expect(screen.queryByTestId("flyer-weekly-upload")).toBeNull();
    const privacyLink = screen.getByRole("link", { name: "AI情報の説明を見る" });
    expect(privacyLink).toHaveAttribute("href", "/privacy?returnTo=%2Fplanner");
  });

  it("AP5: Plus with omitted hasAcceptedPrivacy is fail-closed (privacy gate, not upload)", () => {
    render(
      <MemoryRouter>
        <FlyerWeeklyPanel plusEntitled />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("flyer-weekly-privacy")).toBeVisible();
    expect(screen.queryByTestId("flyer-weekly-upload")).toBeNull();
  });

  it("F-U11-1: rejects success body that fails weeklyFlyerMenuResultSchema", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            data: {
              // weekStartJst 欠落・days 不完全 → Zod 拒否
              menu: { days: [] },
            },
          }),
      }),
    );
    render(
      <MemoryRouter>
        <FlyerWeeklyPanel plusEntitled hasAcceptedPrivacy />
      </MemoryRouter>,
    );
    const input = document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(["x"], "flyer.jpg", { type: "image/jpeg" });
    fireEvent.change(input!, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText("チラシ献立を作成できませんでした。")).toBeVisible();
    });
  });

  it("PE3: Free panel notes server plan check", () => {
    render(
      <MemoryRouter>
        <FlyerWeeklyPanel plusEntitled={false} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("flyer-weekly-plus-server-note")).toBeVisible();
  });

  it("PE11: Plus upload discloses email identity count reset residual", () => {
    render(
      <MemoryRouter>
        <FlyerWeeklyPanel plusEntitled hasAcceptedPrivacy />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("flyer-weekly-identity-note")).toHaveTextContent(
      "ログインに使うメールアドレスを変更すると、週あたりの作成回数の数え方が変わる場合があります。",
    );
  });

  it("PE1: keeps sticky Idempotency-Key on generation_in_progress for same image retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: "generation_in_progress",
            message: "別の献立を作成中です。",
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter>
        <FlyerWeeklyPanel plusEntitled hasAcceptedPrivacy />
      </MemoryRouter>,
    );
    const input = document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(["same-bytes"], "flyer.jpg", { type: "image/jpeg" });
    fireEvent.change(input!, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText("別の献立を作成中です。")).toBeVisible();
    });
    const firstKey = (fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers[
      "Idempotency-Key"
    ];
    // 同一内容の再選択は sticky 再利用
    fireEvent.change(input!, { target: { files: [file] } });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const secondKey = (fetchMock.mock.calls[1]?.[1] as { headers: Record<string, string> }).headers[
      "Idempotency-Key"
    ];
    expect(secondKey).toBe(firstKey);
  });

  it("PE2: uses a new Idempotency-Key when a different image is selected after sticky keep", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            data: {
              menu: {
                weekStartJst: "2026-07-27",
                days: Array.from({ length: 7 }, (_, i) => ({
                  dayIndex: i + 1,
                  label: `Day${String(i + 1)}`,
                  mainName: "野菜炒め",
                  sideName: null,
                  ingredients: ["キャベツ"],
                  notes: null,
                })),
              },
            },
          }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter>
        <FlyerWeeklyPanel plusEntitled hasAcceptedPrivacy />
      </MemoryRouter>,
    );
    const input = document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    const fileA = new File(["image-a-bytes"], "a.jpg", { type: "image/jpeg" });
    fireEvent.change(input!, { target: { files: [fileA] } });
    await waitFor(() => {
      expect(screen.getByText("チラシ献立を作成できませんでした。")).toBeVisible();
    });
    const keyA = (fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers[
      "Idempotency-Key"
    ];
    const fileB = new File(["image-b-different"], "b.jpg", { type: "image/jpeg" });
    fireEvent.change(input!, { target: { files: [fileB] } });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const keyB = (fetchMock.mock.calls[1]?.[1] as { headers: Record<string, string> }).headers[
      "Idempotency-Key"
    ];
    expect(keyB).not.toBe(keyA);
  });

  it("PE1: reuses sticky key when same bytes are reselected with different name/lastModified", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: "generation_in_progress",
            message: "別の献立を作成中です。",
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter>
        <FlyerWeeklyPanel plusEntitled hasAcceptedPrivacy />
      </MemoryRouter>,
    );
    const input = document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    const bytes = "same-image-bytes-for-pe1";
    const fileA = new File([bytes], "flyer-a.jpg", {
      type: "image/jpeg",
      lastModified: 1_700_000_000_000,
    });
    fireEvent.change(input!, { target: { files: [fileA] } });
    await waitFor(() => {
      expect(screen.getByText("別の献立を作成中です。")).toBeVisible();
    });
    const firstKey = (fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers[
      "Idempotency-Key"
    ];
    // OS 再選択で name/lastModified だけ変わっても同一 content → 同一 key
    const fileB = new File([bytes], "flyer-b-renamed.jpg", {
      type: "image/jpeg",
      lastModified: 1_800_000_000_000,
    });
    fireEvent.change(input!, { target: { files: [fileB] } });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const secondKey = (fetchMock.mock.calls[1]?.[1] as { headers: Record<string, string> }).headers[
      "Idempotency-Key"
    ];
    expect(secondKey).toBe(firstKey);
  });

  it("PE1: uses a new key when prefix matches but full content differs", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockRejectedValueOnce(new Error("network"));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter>
        <FlyerWeeklyPanel plusEntitled hasAcceptedPrivacy />
      </MemoryRouter>,
    );
    const input = document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    // 先頭は同じ・後半だけ違う → 全文 hash で別 fingerprint
    const prefix = "x".repeat(100);
    const fileA = new File([`${prefix}-tail-a`], "a.jpg", { type: "image/jpeg" });
    fireEvent.change(input!, { target: { files: [fileA] } });
    await waitFor(() => {
      expect(screen.getByText("チラシ献立を作成できませんでした。")).toBeVisible();
    });
    const keyA = (fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers[
      "Idempotency-Key"
    ];
    const fileB = new File([`${prefix}-tail-b-different`], "a.jpg", { type: "image/jpeg" });
    fireEvent.change(input!, { target: { files: [fileB] } });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const keyB = (fetchMock.mock.calls[1]?.[1] as { headers: Record<string, string> }).headers[
      "Idempotency-Key"
    ];
    expect(keyB).not.toBe(keyA);
  });

  it("PE3: keeps sticky Idempotency-Key on structured 500 internal_error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: "internal_error",
            message: "しばらくしてから再度お試しください。",
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter>
        <FlyerWeeklyPanel plusEntitled hasAcceptedPrivacy />
      </MemoryRouter>,
    );
    const input = document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(["pe3-bytes"], "flyer.jpg", { type: "image/jpeg" });
    fireEvent.change(input!, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText("しばらくしてから再度お試しください。")).toBeVisible();
    });
    const firstKey = (fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers[
      "Idempotency-Key"
    ];
    fireEvent.change(input!, { target: { files: [file] } });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const secondKey = (fetchMock.mock.calls[1]?.[1] as { headers: Record<string, string> }).headers[
      "Idempotency-Key"
    ];
    expect(secondKey).toBe(firstKey);
  });

  it("PE1: remount reuses sticky Idempotency-Key from storage for same image", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: "generation_in_progress",
            message: "別の献立を作成中です。",
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(
      <MemoryRouter>
        <FlyerWeeklyPanel plusEntitled hasAcceptedPrivacy />
      </MemoryRouter>,
    );
    const input = document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(["pe1-remount-bytes"], "flyer.jpg", { type: "image/jpeg" });
    fireEvent.change(input!, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText("別の献立を作成中です。")).toBeVisible();
    });
    const firstKey = (fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers[
      "Idempotency-Key"
    ];
    // ref は消えるが local/session に sticky が残る
    unmount();
    render(
      <MemoryRouter>
        <FlyerWeeklyPanel plusEntitled hasAcceptedPrivacy />
      </MemoryRouter>,
    );
    const input2 = document.querySelector('input[type="file"]');
    expect(input2).not.toBeNull();
    fireEvent.change(input2!, { target: { files: [file] } });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const secondKey = (fetchMock.mock.calls[1]?.[1] as { headers: Record<string, string> }).headers[
      "Idempotency-Key"
    ];
    expect(secondKey).toBe(firstKey);
    // 他タブ相当: session を空にしても local 正本から復元
    expect(readFlyerStickyAttempt(FLYER_USER_ID)?.key).toBe(firstKey);
  });

  it("PE1: multi-tab localStorage sticky is reused when session is empty", () => {
    writeFlyerStickyAttempt(FLYER_USER_ID, {
      key: "shared-key-uuid",
      fingerprint: "10:image/jpeg:abc",
    });
    // 他タブは session が空
    sessionStorage.removeItem(flyerStickyStorageKey(FLYER_USER_ID));
    const restored = readFlyerStickyAttempt(FLYER_USER_ID);
    expect(restored).toEqual({ key: "shared-key-uuid", fingerprint: "10:image/jpeg:abc" });
    // 読取時に session へ mirror
    expect(sessionStorage.getItem(flyerStickyStorageKey(FLYER_USER_ID))).not.toBeNull();
    clearFlyerStickyAttempt(FLYER_USER_ID);
    expect(readFlyerStickyAttempt(FLYER_USER_ID)).toBeNull();
  });

  it("PE2: total content-read failure aborts without minting sticky (no size:type bind)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter>
        <FlyerWeeklyPanel plusEntitled hasAcceptedPrivacy />
      </MemoryRouter>,
    );
    const input = document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(["pe2-fail"], "flyer.jpg", { type: "image/jpeg" });
    // 全読取経路を潰す: own arrayBuffer / Blob 原型 / FileReader / stream
    // （arrayBuffer だけ throw しても FileReader で成功し得る — PE2 は meta-only 禁止が本質）
    // jsdom の File は arrayBuffer 未定義のことがあり、spyOn 前にスタブを置く。
    if (typeof file.arrayBuffer !== "function") {
      Object.defineProperty(file, "arrayBuffer", {
        configurable: true,
        writable: true,
        value: () => Promise.resolve(new ArrayBuffer(0)),
      });
    }
    const ownAb = vi.spyOn(file, "arrayBuffer").mockRejectedValue(new Error("read fail"));
    // jsdom では Blob.prototype.arrayBuffer が無い場合がある
    const blobHadAb = typeof Blob.prototype.arrayBuffer === "function";
    if (!blobHadAb) {
      Object.defineProperty(Blob.prototype, "arrayBuffer", {
        configurable: true,
        writable: true,
        value: () => Promise.resolve(new ArrayBuffer(0)),
      });
    }
    const blobAb = vi
      .spyOn(Blob.prototype, "arrayBuffer")
      .mockRejectedValue(new Error("blob read fail"));
    const readerSpy = vi
      .spyOn(FileReader.prototype, "readAsArrayBuffer")
      .mockImplementation(function (this: FileReader) {
        // arrow で this を捕捉（no-this-alias を避けつつ FileReader を保持）
        queueMicrotask(() => {
          Object.defineProperty(this, "error", {
            configurable: true,
            value: new Error("FileReader forced fail"),
          });
          const handler = this.onerror;
          if (typeof handler === "function") {
            handler.call(this, new Event("error") as ProgressEvent<FileReader>);
          }
        });
      });
    if (typeof file.stream !== "function") {
      Object.defineProperty(file, "stream", {
        configurable: true,
        writable: true,
        value: () => {
          throw new Error("stream missing");
        },
      });
    }
    const streamSpy = vi.spyOn(file, "stream").mockImplementation(() => {
      throw new Error("stream fail");
    });
    try {
      fireEvent.change(input!, { target: { files: [file] } });
      await waitFor(() => {
        expect(screen.getByText("画像を読み込めませんでした。")).toBeVisible();
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(readFlyerStickyAttempt(FLYER_USER_ID)).toBeNull();
    } finally {
      ownAb.mockRestore();
      blobAb.mockRestore();
      readerSpy.mockRestore();
      streamSpy.mockRestore();
    }
  });

  it("PE2: fingerprintFlyerImage returns null when content cannot be read", async () => {
    // Blob でも File でもない素オブジェクト → いずれの読取経路も使えない
    const file = {
      size: 12,
      type: "image/jpeg",
    } as File;
    await expect(fingerprintFlyerImage(file)).resolves.toBeNull();
  });

  it("PE2: normal File fingerprints with content hash (not size:type only)", async () => {
    const file = new File(["same-content-for-hash"], "flyer.jpg", { type: "image/jpeg" });
    const fp = await fingerprintFlyerImage(file);
    expect(fp).not.toBeNull();
    // meta だけの size:type ではなく :hash が付く
    expect(fp).toMatch(/^\d+:image\/jpeg:[0-9a-f]+$/u);
    expect(fp).not.toBe(`${String(file.size)}:${file.type}`);
    // 同一内容は同一 fingerprint（FileReader / arrayBuffer どちらでも）
    const again = await fingerprintFlyerImage(
      new File(["same-content-for-hash"], "other-name.jpg", { type: "image/jpeg" }),
    );
    expect(again).toBe(fp);
  });

  it("PE4: HTTP 200 with unparseable body keeps sticky for same-image retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          ok: true,
          data: {
            // menu が schema を満たさない → 成功 deterministic ではない
            menu: {},
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter>
        <FlyerWeeklyPanel plusEntitled hasAcceptedPrivacy />
      </MemoryRouter>,
    );
    const input = document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(["pe4-bytes"], "flyer.jpg", { type: "image/jpeg" });
    fireEvent.change(input!, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText("チラシ献立を作成できませんでした。")).toBeVisible();
    });
    const firstKey = (fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers[
      "Idempotency-Key"
    ];
    expect(readFlyerStickyAttempt(FLYER_USER_ID)?.key).toBe(firstKey);
    fireEvent.change(input!, { target: { files: [file] } });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const secondKey = (fetchMock.mock.calls[1]?.[1] as { headers: Record<string, string> }).headers[
      "Idempotency-Key"
    ];
    expect(secondKey).toBe(firstKey);
  });
});
