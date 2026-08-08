import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Surface } from "./surface";

describe("Surface", () => {
  it("renders a div by default with the plain tone", () => {
    render(<Surface>本文</Surface>);
    const surface = screen.getByText("本文");
    expect(surface.tagName).toBe("DIV");
    expect(surface.className).toContain("ui-surface");
    expect(surface.className).toContain("ui-surface--plain");
  });

  it("maps tone to an enumerated class and never to inline style", () => {
    render(<Surface tone="sunken">沈んだ面</Surface>);
    const surface = screen.getByText("沈んだ面");
    expect(surface.className).toContain("ui-surface--sunken");
    expect(surface.getAttribute("style")).toBeNull();
  });

  it("renders as a labelled section when asked", () => {
    render(
      <Surface as="section" aria-label="登録済みの食材">
        中身
      </Surface>,
    );
    expect(screen.getByRole("region", { name: "登録済みの食材" })).toBeInTheDocument();
  });

  it("can render as a form so pantry-form keeps its submit semantics", () => {
    render(
      <Surface as="form" aria-label="食材を追加">
        中身
      </Surface>,
    );
    expect(screen.getByRole("form", { name: "食材を追加" })).toBeInTheDocument();
  });
});
