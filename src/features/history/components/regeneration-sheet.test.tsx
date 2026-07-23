import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TargetMode } from "@shared/contracts/planner";
import { RegenerationSheet } from "./regeneration-sheet";

function renderRegenerationSheet(targetMode: TargetMode = "household", remaining = 3) {
  const onSubmit = vi.fn(() => Promise.resolve());
  const onCancel = vi.fn();
  render(
    <RegenerationSheet
      targetMode={targetMode}
      remaining={remaining}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />,
  );
  return { onSubmit, onCancel };
}

describe("RegenerationSheet", () => {
  it("explains conditional quota use before regeneration", () => {
    renderRegenerationSheet();
    expect(screen.getByText("別の献立が完成した場合に1回使用・現在残り3回")).toBeVisible();
  });

  it("requires a reason before submit", async () => {
    const { onSubmit } = renderRegenerationSheet();
    await userEvent.click(screen.getByRole("button", { name: "別案を作る" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("理由を選んでください");
  });

  it("submits a preset reason with null custom text", async () => {
    const { onSubmit } = renderRegenerationSheet();
    await userEvent.click(screen.getByLabelText("もっと簡単に"));
    await userEvent.click(screen.getByRole("button", { name: "別案を作る" }));
    expect(onSubmit).toHaveBeenCalledWith({
      changeReason: "simpler",
      changeReasonCustom: null,
    });
  });

  it("requires custom text when その他 is selected", async () => {
    const { onSubmit } = renderRegenerationSheet();
    await userEvent.click(screen.getByLabelText("その他"));
    await userEvent.click(screen.getByRole("button", { name: "別案を作る" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("内容を入力してください");
    await userEvent.type(screen.getByRole("textbox"), "辛さを抑えて");
    await userEvent.click(screen.getByRole("button", { name: "別案を作る" }));
    expect(onSubmit).toHaveBeenCalledWith({
      changeReason: "custom",
      changeReasonCustom: "辛さを抑えて",
    });
  });

  it("hides child_friendly for idea menus", () => {
    render(
      <RegenerationSheet targetMode="idea" remaining={3} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByRole("radio", { name: "子どもが食べやすく" })).not.toBeInTheDocument();
    // 他の定型理由は idea でも選べる
    expect(screen.getByRole("radio", { name: "もっと簡単に" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "別の食材で" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "別の味に" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "その他" })).toBeInTheDocument();
  });

  it("keeps child_friendly available for household menus", () => {
    renderRegenerationSheet("household");
    expect(screen.getByRole("radio", { name: "子どもが食べやすく" })).toBeInTheDocument();
  });
});
