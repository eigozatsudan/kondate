import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TasteLearningSection } from "./taste-learning-section";

describe("TasteLearningSection", () => {
  it("shows the stored value", async () => {
    render(<TasteLearningSection enabled={true} onToggle={vi.fn()} />);
    const toggle = await screen.findByRole("switch", { name: "好みの学習" });
    expect(toggle).toBeChecked();
  });

  it("sends the next value on toggle", async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<TasteLearningSection enabled={true} onToggle={onToggle} />);
    await userEvent.click(await screen.findByRole("switch", { name: "好みの学習" }));
    await waitFor(() => {
      expect(onToggle).toHaveBeenCalledWith(false);
    });
  });

  it("restores the previous state when the update fails", async () => {
    const onToggle = vi.fn().mockRejectedValue(new Error("boom"));
    render(<TasteLearningSection enabled={true} onToggle={onToggle} />);
    await userEvent.click(await screen.findByRole("switch", { name: "好みの学習" }));
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "好みの学習" })).toBeChecked();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/変更できませんでした/u);
  });

  it("follows the enabled prop after mount instead of freezing at the initial value", async () => {
    const { rerender } = render(<TasteLearningSection enabled={true} onToggle={vi.fn()} />);
    const toggle = await screen.findByRole("switch", { name: "好みの学習" });
    expect(toggle).toBeChecked();

    rerender(<TasteLearningSection enabled={false} onToggle={vi.fn()} />);
    expect(screen.getByRole("switch", { name: "好みの学習" })).not.toBeChecked();
  });

  it("disables the switch when the wrapper marks it unverified", () => {
    render(<TasteLearningSection enabled={true} onToggle={vi.fn()} disabled />);
    expect(screen.getByRole("switch", { name: "好みの学習" })).toBeDisabled();
  });
});
