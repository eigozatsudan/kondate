import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FLYER_LOCKED_PREVIEW_COPY } from "@shared/contracts/flyer-weekly";
import { FlyerWeeklyPanel } from "./flyer-weekly-panel";

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({ session: { access_token: "t" } }),
}));

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: vi.fn(),
}));

describe("FlyerWeeklyPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
});
