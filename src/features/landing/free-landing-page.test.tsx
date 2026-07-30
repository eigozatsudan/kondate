import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it } from "vitest";
import {
  FREE_LP_BRAND,
  FREE_LP_CLOSING,
  FREE_LP_CTA,
  FREE_LP_EXISTING,
  FREE_LP_FAMILY_BODY,
  FREE_LP_FAMILY_TITLE,
  FREE_LP_H1,
  FREE_LP_LEAD,
  FREE_LP_LOGIN,
  FREE_LP_MENU_BODY,
  FREE_LP_MENU_TITLE,
  FREE_LP_PANTRY_BODY,
  FREE_LP_PANTRY_TITLE,
  FreeLandingPage,
} from "./free-landing-page";

function renderLp() {
  const router = createMemoryRouter(
    [
      { path: "/", element: <FreeLandingPage /> },
      { path: "/login", element: <h1>ログイン画面</h1> },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const FORBIDDEN = ["Plus", "plus", "安全", "絶対", "保証", "無制限", "何回でも"] as const;

describe("FreeLandingPage", () => {
  it("renders single h1, brand not as heading, three cards in order, and CTAs to /login", () => {
    renderLp();
    expect(screen.getByRole("heading", { level: 1, name: FREE_LP_H1 })).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText(FREE_LP_BRAND)).toBeVisible();
    expect(screen.queryByRole("heading", { name: FREE_LP_BRAND })).not.toBeInTheDocument();
    expect(screen.getByText(FREE_LP_LEAD)).toBeVisible();

    const cards = screen.getByRole("list", { name: "できること" });
    const items = within(cards).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(
      within(items[0]!).getByRole("heading", { level: 2, name: FREE_LP_FAMILY_TITLE }),
    ).toBeVisible();
    expect(within(items[0]!).getByText(FREE_LP_FAMILY_BODY)).toBeVisible();
    expect(
      within(items[1]!).getByRole("heading", { level: 2, name: FREE_LP_MENU_TITLE }),
    ).toBeVisible();
    expect(within(items[1]!).getByText(FREE_LP_MENU_BODY)).toBeVisible();
    expect(
      within(items[2]!).getByRole("heading", { level: 2, name: FREE_LP_PANTRY_TITLE }),
    ).toBeVisible();
    expect(within(items[2]!).getByText(FREE_LP_PANTRY_BODY)).toBeVisible();

    expect(screen.getByText(FREE_LP_CLOSING)).toBeVisible();
    expect(screen.getByText(FREE_LP_EXISTING)).toBeVisible();

    const startLinks = screen.getAllByRole("link", { name: FREE_LP_CTA });
    expect(startLinks.length).toBeGreaterThanOrEqual(2);
    for (const link of startLinks) {
      expect(link).toHaveAttribute("href", "/login");
    }
    const loginLinks = screen.getAllByRole("link", { name: FREE_LP_LOGIN });
    expect(loginLinks.length).toBeGreaterThanOrEqual(1);
    for (const link of loginLinks) {
      expect(link).toHaveAttribute("href", "/login");
    }
  });

  it("does not include forbidden marketing or safety guarantee words", () => {
    renderLp();
    // body は常に Element なので textContent は string（DOM 型定義上 null にならない）
    const text = document.body.textContent;
    for (const word of FORBIDDEN) {
      expect(text).not.toContain(word);
    }
  });

  it("uses empty alt on decorative images", () => {
    renderLp();
    const imgs = document.querySelectorAll("main img");
    expect(imgs.length).toBe(4);
    for (const img of imgs) {
      expect(img.getAttribute("alt")).toBe("");
    }
  });
});
