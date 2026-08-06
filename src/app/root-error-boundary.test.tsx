import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RootErrorBoundary } from "./root-error-boundary";

function Thrower(): null {
  throw new Error("provider boom");
}

describe("RootErrorBoundary", () => {
  it("shows Japanese recovery UI when a child throws outside the router", () => {
    // React は error boundary 中に console.error する。テストノイズだけ抑える。
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <RootErrorBoundary>
        <Thrower />
      </RootErrorBoundary>,
    );

    expect(screen.getByRole("heading", { name: "画面を表示できませんでした" })).toBeVisible();
    expect(screen.getByRole("button", { name: "ホームへ戻る" })).toBeVisible();
    expect(screen.getByRole("button", { name: "再読み込み" })).toBeVisible();

    consoleError.mockRestore();
  });
});
