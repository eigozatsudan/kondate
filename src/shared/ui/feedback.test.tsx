import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge, EmptyState, Skeleton } from "./feedback";
import { Button } from "./button";

describe("Skeleton", () => {
  it("announces its label politely so screen readers are not left silent", () => {
    render(<Skeleton label="食材リストを読み込んでいます" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("食材リストを読み込んでいます");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("renders the requested number of placeholder lines", () => {
    const { container } = render(<Skeleton lines={3} label="読み込み中" />);
    expect(container.querySelectorAll(".ui-skeleton__line")).toHaveLength(3);
  });

  it("defaults to two lines", () => {
    const { container } = render(<Skeleton label="読み込み中" />);
    expect(container.querySelectorAll(".ui-skeleton__line")).toHaveLength(2);
  });
});

describe("EmptyState", () => {
  it("renders title, body and action", () => {
    render(
      <EmptyState
        title="まだ食材がありません"
        body="「食材を追加」から登録できます"
        action={<Button>食材を追加</Button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "まだ食材がありません" })).toBeInTheDocument();
    expect(screen.getByText("「食材を追加」から登録できます")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "食材を追加" })).toBeInTheDocument();
  });

  it("omits the action slot when not given", () => {
    render(<EmptyState title="ありません" body="説明" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("Badge", () => {
  it("maps tone to an enumerated class and never to inline style", () => {
    render(<Badge tone="warning">まもなく</Badge>);
    const badge = screen.getByText("まもなく");
    expect(badge.className).toContain("ui-badge--warning");
    expect(badge.getAttribute("style")).toBeNull();
  });

  it("defaults to the neutral tone", () => {
    render(<Badge>未開封</Badge>);
    expect(screen.getByText("未開封").className).toContain("ui-badge--neutral");
  });
});
