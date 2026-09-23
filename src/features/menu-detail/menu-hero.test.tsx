import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { MenuHero } from "./menu-hero";

it("exposes the success heading as an accessible name", () => {
  render(
    <MenuHero
      totalElapsedMinutes={30}
      servings={2}
      heading="献立ができました"
      tasteHintsApplied={false}
    />,
  );
  expect(screen.getByRole("heading", { level: 1, name: "献立ができました" })).toBeVisible();
  expect(screen.getByText("食卓まで約30分・2人分")).toBeVisible();
});

it("shows the history heading when the caller passes it (UX U1)", () => {
  render(
    <MenuHero
      totalElapsedMinutes={30}
      servings={2}
      heading="献立の詳細"
      tasteHintsApplied={false}
    />,
  );
  expect(screen.getByRole("heading", { level: 1, name: "献立の詳細" })).toBeVisible();
});

it("never shows the dev-facing model note (UX U1)", () => {
  render(
    <MenuHero
      totalElapsedMinutes={45}
      servings={4}
      heading="献立ができました"
      tasteHintsApplied={false}
    />,
  );
  expect(screen.queryByText(/作成モデル/u)).not.toBeInTheDocument();
});

it("shows the taste line when applied", () => {
  render(
    <MenuHero totalElapsedMinutes={30} servings={2} heading="献立ができました" tasteHintsApplied />,
  );
  expect(screen.getByText("✨ いつもの好みを反映しました")).toBeInTheDocument();
});

it("omits the taste line when not applied", () => {
  render(
    <MenuHero
      totalElapsedMinutes={30}
      servings={2}
      heading="献立ができました"
      tasteHintsApplied={false}
    />,
  );
  expect(screen.queryByText(/いつもの好み/u)).not.toBeInTheDocument();
});
