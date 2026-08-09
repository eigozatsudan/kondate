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
  FREE_LP_FAMILY_POINTS,
  FREE_LP_FAMILY_TITLE,
  FREE_LP_FEATURES_TITLE,
  FREE_LP_FLOW_STEPS,
  FREE_LP_FLOW_TITLE,
  FREE_LP_H1,
  FREE_LP_LEAD,
  FREE_LP_LEAD_SUB,
  FREE_LP_LOGIN,
  FREE_LP_MENU_BODY,
  FREE_LP_MENU_POINTS,
  FREE_LP_MENU_TITLE,
  FREE_LP_PANTRY_BODY,
  FREE_LP_PANTRY_POINTS,
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
  it("renders single h1, richer copy, flow steps, three feature cards, and CTAs to /login", () => {
    renderLp();
    expect(screen.getByRole("heading", { level: 1, name: FREE_LP_H1 })).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText(FREE_LP_BRAND)).toBeVisible();
    expect(screen.queryByRole("heading", { name: FREE_LP_BRAND })).not.toBeInTheDocument();
    expect(screen.getByText(FREE_LP_LEAD)).toBeVisible();
    expect(screen.getByText(FREE_LP_LEAD_SUB)).toBeVisible();

    expect(screen.getByRole("heading", { level: 2, name: FREE_LP_FLOW_TITLE })).toBeVisible();
    for (const step of FREE_LP_FLOW_STEPS) {
      expect(screen.getByText(step)).toBeVisible();
    }

    expect(screen.getByRole("heading", { level: 2, name: FREE_LP_FEATURES_TITLE })).toBeVisible();
    const cards = screen.getByRole("list", { name: "できること" });
    const items = within(cards).getAllByRole("listitem");
    // 各カード本文 + 各カード内のポイント li がネストされるため、直下のカード li だけを数える
    const topCards = items.filter((el) => el.classList.contains("free-landing__card"));
    expect(topCards).toHaveLength(3);

    expect(
      within(topCards[0]!).getByRole("heading", { level: 3, name: FREE_LP_FAMILY_TITLE }),
    ).toBeVisible();
    expect(within(topCards[0]!).getByText(FREE_LP_FAMILY_BODY)).toBeVisible();
    for (const point of FREE_LP_FAMILY_POINTS) {
      expect(within(topCards[0]!).getByText(point)).toBeVisible();
    }

    expect(
      within(topCards[1]!).getByRole("heading", { level: 3, name: FREE_LP_MENU_TITLE }),
    ).toBeVisible();
    expect(within(topCards[1]!).getByText(FREE_LP_MENU_BODY)).toBeVisible();
    for (const point of FREE_LP_MENU_POINTS) {
      expect(within(topCards[1]!).getByText(point)).toBeVisible();
    }

    expect(
      within(topCards[2]!).getByRole("heading", { level: 3, name: FREE_LP_PANTRY_TITLE }),
    ).toBeVisible();
    expect(within(topCards[2]!).getByText(FREE_LP_PANTRY_BODY)).toBeVisible();
    for (const point of FREE_LP_PANTRY_POINTS) {
      expect(within(topCards[2]!).getByText(point)).toBeVisible();
    }

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
    const text = document.body.textContent;
    for (const word of FORBIDDEN) {
      expect(text).not.toContain(word);
    }
  });

  it("uses empty alt on decorative images and keeps images compact classes", () => {
    renderLp();
    const imgs = document.querySelectorAll("main img");
    expect(imgs.length).toBe(4);
    for (const img of imgs) {
      expect(img.getAttribute("alt")).toBe("");
    }
    expect(document.querySelector(".free-landing__hero-img")).not.toBeNull();
    expect(document.querySelectorAll(".free-landing__card-img")).toHaveLength(3);
  });

  it("never emits inline style so CSP style-src self holds in production", () => {
    renderLp();
    const main = document.querySelector("main");
    expect(main).not.toBeNull();
    for (const element of main!.querySelectorAll("*")) {
      expect(element.getAttribute("style")).toBeNull();
    }
    expect(main!.getAttribute("style")).toBeNull();
  });

  it("gives the h1 its own class so the page-frame h1 rule cannot win", () => {
    // .free-landing h1 は .page-frame h1（styles.css:989）と詳細度が同点(0,1,1)になり、
    // 読み込み順で --text-hero が死ぬ。Phase 0 が .ui-page-header__title で
    // 実際に踏んだ罠（styles.css:2948 の注記）。クラスを付けて (0,2,0) にする。
    renderLp();
    const heading = screen.getByRole("heading", { level: 1, name: FREE_LP_H1 });
    expect(heading).toHaveClass("free-landing__title");
  });

  it("places the hero image after the call to action with its real dimensions", () => {
    renderLp();
    const hero = document.querySelector(".free-landing__hero-img");
    expect(hero).not.toBeNull();
    // 実ファイルは 1280x720。属性が 480 のままだと予約ボックスと実体がずれて CLS が出る。
    expect(hero).toHaveAttribute("width", "1280");
    expect(hero).toHaveAttribute("height", "720");
    const cta = screen.getAllByRole("link", { name: FREE_LP_CTA })[0]!;
    // DOCUMENT_POSITION_FOLLOWING === 4: hero が CTA より後ろにある
    expect(cta.compareDocumentPosition(hero!) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(4);
  });
});
