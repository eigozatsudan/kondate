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

  it("restores the previous state after observing the optimistic value mid-flight (N-7)", async () => {
    let rejectToggle: (error: Error) => void = () => undefined;
    const onToggle = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectToggle = reject;
        }),
    );
    render(<TasteLearningSection enabled={true} onToggle={onToggle} />);
    const toggle = await screen.findByRole("switch", { name: "好みの学習" });

    await userEvent.click(toggle);

    // 書き込み中は楽観値（OFF）を見せている
    await waitFor(() => {
      expect(toggle).not.toBeChecked();
    });

    rejectToggle(new Error("boom"));

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
