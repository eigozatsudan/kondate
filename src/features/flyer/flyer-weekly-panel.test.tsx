import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { FLYER_LOCKED_PREVIEW_COPY } from "@shared/contracts/flyer-weekly";
import { FlyerWeeklyPanel } from "./flyer-weekly-panel";

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({ session: { access_token: "t" } }),
}));

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: vi.fn(),
}));

describe("FlyerWeeklyPanel", () => {
  it("shows locked preview copy for Free", () => {
    render(
      <MemoryRouter>
        <FlyerWeeklyPanel plusEntitled={false} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("flyer-weekly-locked")).toBeVisible();
    expect(screen.getByText(FLYER_LOCKED_PREVIEW_COPY)).toBeVisible();
    expect(screen.getByRole("link", { name: "Plus を見る" })).toBeVisible();
  });

  it("shows upload control for Plus", () => {
    render(
      <MemoryRouter>
        <FlyerWeeklyPanel plusEntitled />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("flyer-weekly-upload")).toBeVisible();
    expect(screen.getByText("チラシ写真を選ぶ")).toBeVisible();
  });
});
