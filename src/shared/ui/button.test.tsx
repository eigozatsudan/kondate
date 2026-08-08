import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { Button } from "./button";

describe("Button", () => {
  it("renders a native button with the label", () => {
    render(<Button>保存する</Button>);
    expect(screen.getByRole("button", { name: "保存する" })).toBeInTheDocument();
  });

  it("applies variant and size as enumerated classes, never inline style", () => {
    render(
      <Button variant="secondary" size="large">
        戻る
      </Button>,
    );
    const button = screen.getByRole("button", { name: "戻る" });
    expect(button.className).toContain("ui-btn");
    expect(button.className).toContain("ui-btn--secondary");
    expect(button.className).toContain("ui-btn--large");
    // CSP style-src 'self' 下では inline style が本番でのみ落ちる。ここで塞ぐ。
    expect(button.getAttribute("style")).toBeNull();
  });

  it("defaults to the primary variant", () => {
    render(<Button>作る</Button>);
    expect(screen.getByRole("button", { name: "作る" }).className).toContain("ui-btn--primary");
  });

  it("marks busy state with aria-busy and disables interaction", async () => {
    const onClick = vi.fn();
    render(
      <Button busy onClick={onClick}>
        送信
      </Button>,
    );
    const button = screen.getByRole("button", { name: "送信" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps disabled independent from busy", () => {
    render(<Button disabled>送信</Button>);
    const button = screen.getByRole("button", { name: "送信" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "false");
  });

  it("defaults type to button so it never submits a form implicitly", () => {
    render(<Button>実行</Button>);
    expect(screen.getByRole("button", { name: "実行" })).toHaveAttribute("type", "button");
  });

  it("honours an explicit submit type", () => {
    render(<Button type="submit">登録</Button>);
    expect(screen.getByRole("button", { name: "登録" })).toHaveAttribute("type", "submit");
  });

  it("forwards ref to the real DOM node", () => {
    // pantry のフォーカス復帰契約（editorTriggerRef.current?.focus()）が
    // これに依存する。ref が通らないと Task 0.7 が実装不能になる。
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>追加</Button>);
    expect(ref.current).toBe(screen.getByRole("button", { name: "追加" }));
  });

  it("forwards aria attributes used by the pantry editor", () => {
    render(
      <Button aria-expanded={false} aria-controls="pantry-editor">
        食材を追加
      </Button>,
    );
    const button = screen.getByRole("button", { name: "食材を追加" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-controls", "pantry-editor");
  });
});
