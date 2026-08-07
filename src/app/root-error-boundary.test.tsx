import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RootErrorBoundary } from "./root-error-boundary";

function Thrower(): null {
  throw new Error("provider boom");
}

function PublicEnvThrower(): null {
  // parsePublicEnv / getPublicEnv と同じ固定文言
  throw new Error("公開設定を読み込めません");
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

  it("L6: public-env error shows config copy without home/reload loop buttons", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <RootErrorBoundary>
        <PublicEnvThrower />
      </RootErrorBoundary>,
    );

    expect(screen.getByRole("heading", { name: "アプリを起動できません" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("公開設定に問題がある");
    // ホーム／再読込は同一障害へ再突入するため出さない
    expect(screen.queryByRole("button", { name: "ホームへ戻る" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "再読み込み" })).not.toBeInTheDocument();

    consoleError.mockRestore();
  });
});
