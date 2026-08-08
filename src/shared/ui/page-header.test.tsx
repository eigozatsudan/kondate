import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("renders the title as the level-1 heading", () => {
    render(<PageHeader title="食材リスト" />);
    expect(screen.getByRole("heading", { level: 1, name: "食材リスト" })).toBeInTheDocument();
  });

  it("renders lead and note when given", () => {
    render(<PageHeader title="食材リスト" lead="登録する場所です" note="判断はしません" />);
    expect(screen.getByText("登録する場所です")).toBeInTheDocument();
    expect(screen.getByText("判断はしません")).toBeInTheDocument();
  });

  it("omits lead and note when not given", () => {
    const { container } = render(<PageHeader title="食材リスト" />);
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("forwards id to the heading so aria-labelledby can target it", () => {
    render(<PageHeader title="食材リスト" id="pantry-title" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("id", "pantry-title");
  });

  it("never emits inline style", () => {
    const { container } = render(<PageHeader title="食材リスト" lead="説明" />);
    for (const element of container.querySelectorAll("*")) {
      expect(element.getAttribute("style")).toBeNull();
    }
  });
});
