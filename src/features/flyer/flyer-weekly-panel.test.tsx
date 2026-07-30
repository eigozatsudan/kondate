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

  it("shows upload control for Plus", () => {
    render(
      <MemoryRouter>
        <FlyerWeeklyPanel plusEntitled />
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
        <FlyerWeeklyPanel plusEntitled />
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
});
