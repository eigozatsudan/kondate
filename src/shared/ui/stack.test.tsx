import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Inset, Stack } from "./stack";

describe("Stack", () => {
  it("defaults to gap step 4", () => {
    render(<Stack>中身</Stack>);
    const stack = screen.getByText("中身");
    expect(stack.className).toContain("ui-stack");
    expect(stack.className).toContain("ui-stack--gap-4");
    expect(stack.getAttribute("style")).toBeNull();
  });

  it("maps every gap step to its own class", () => {
    render(<Stack gap={6}>広い</Stack>);
    expect(screen.getByText("広い").className).toContain("ui-stack--gap-6");
  });

  it("renders as a list when asked so list semantics survive", () => {
    render(
      <Stack as="ul">
        <li>一件目</li>
      </Stack>,
    );
    expect(screen.getByRole("list")).toBeInTheDocument();
  });

  it("forwards aria-label so labelled lists keep their name", () => {
    // これが無いと <Stack as="ul" aria-label="…"> が型を通ったまま実行時に消える。
    // pantry-page.tsx:294 の「冷蔵庫の食材」がこの経路で静かに失われる。
    render(
      <Stack as="ul" aria-label="冷蔵庫の食材">
        <li>キャベツ</li>
      </Stack>,
    );
    expect(screen.getByRole("list", { name: "冷蔵庫の食材" })).toBeInTheDocument();
  });

  it("forwards id and aria-labelledby", () => {
    render(
      <>
        <h2 id="stack-heading">見出し</h2>
        <Stack id="stack-body" aria-labelledby="stack-heading" role="group">
          中身
        </Stack>
      </>,
    );
    const group = screen.getByRole("group", { name: "見出し" });
    expect(group).toHaveAttribute("id", "stack-body");
  });
});

describe("Inset", () => {
  it("maps pad to an enumerated class", () => {
    render(<Inset pad={5}>余白つき</Inset>);
    const inset = screen.getByText("余白つき");
    expect(inset.className).toContain("ui-inset--pad-5");
    expect(inset.getAttribute("style")).toBeNull();
  });
});
