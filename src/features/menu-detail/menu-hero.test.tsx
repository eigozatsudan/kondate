import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { MenuHero } from "./menu-hero";

it("exposes the success heading as an accessible name", () => {
  render(
    <MenuHero
      totalElapsedMinutes={30}
      servings={2}
      generationModelId={null}
      tasteHintsApplied={false}
    />,
  );
  expect(screen.getByRole("heading", { level: 1, name: "献立ができました" })).toBeVisible();
  expect(screen.getByText("食卓まで約30分・2人分")).toBeVisible();
  expect(screen.queryByText(/作成モデル/u)).not.toBeInTheDocument();
});

it("shows a muted model label when generationModelId is set", () => {
  render(
    <MenuHero
      totalElapsedMinutes={45}
      servings={4}
      generationModelId="inception/mercury-2"
      tasteHintsApplied={false}
    />,
  );
  expect(screen.getByText("作成モデル: Mercury 2")).toBeVisible();
});

it("shows the taste line alongside the model label without replacing it", () => {
  render(
    <MenuHero
      totalElapsedMinutes={30}
      servings={2}
      generationModelId="inception/mercury-2"
      tasteHintsApplied
    />,
  );
  expect(screen.getByText(/作成モデル/u)).toBeInTheDocument();
  expect(screen.getByText("✨ いつもの好みを反映しました")).toBeInTheDocument();
});

it("omits the taste line when not applied", () => {
  render(
    <MenuHero
      totalElapsedMinutes={30}
      servings={2}
      generationModelId={null}
      tasteHintsApplied={false}
    />,
  );
  expect(screen.queryByText(/いつもの好み/u)).not.toBeInTheDocument();
});
