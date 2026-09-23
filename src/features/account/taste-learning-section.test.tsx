import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { tasteLearningCopy } from "./taste-learning-copy";
import { TasteLearningSection } from "./taste-learning-section";

describe("TasteLearningSection", () => {
  it("shows the stored value", async () => {
    render(<TasteLearningSection enabled={true} onToggle={vi.fn()} />);
    const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
    expect(toggle).toBeChecked();
  });

  it("sends the next value on toggle", async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<TasteLearningSection enabled={true} onToggle={onToggle} />);
    await userEvent.click(
      await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel }),
    );
    await waitFor(() => {
      expect(onToggle).toHaveBeenCalledWith(false);
    });
  });

  it("restores the previous state after observing the optimistic value mid-flight", async () => {
    let rejectToggle: (error: Error) => void = () => undefined;
    const onToggle = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectToggle = reject;
        }),
    );
    render(<TasteLearningSection enabled={true} onToggle={onToggle} />);
    const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });

    await userEvent.click(toggle);

    // 書き込み中は楽観値（OFF）を見せている
    await waitFor(() => {
      expect(toggle).not.toBeChecked();
    });

    rejectToggle(new Error("boom"));

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).toBeChecked();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/変更できませんでした/u);
  });

  it("hides the failure alert once the server value catches up with the requested value", async () => {
    const onToggle = vi.fn().mockRejectedValue(new Error("boom"));
    const { rerender } = render(<TasteLearningSection enabled={true} onToggle={onToggle} />);
    await userEvent.click(
      await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel }),
    );
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/変更できませんでした/u);
    });

    // 失敗後の再読み込みで、実はサーバーが要求どおり OFF を確定していたと分かった
    rerender(<TasteLearningSection enabled={false} onToggle={onToggle} />);

    expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).not.toBeChecked();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables the switch when the parent disables it", async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <TasteLearningSection enabled={true} onToggle={onToggle} disabled={true} />,
    );
    const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
    expect(toggle).toBeDisabled();
    await userEvent.click(toggle);
    expect(onToggle).not.toHaveBeenCalled();

    rerender(<TasteLearningSection enabled={true} onToggle={onToggle} disabled={false} />);
    expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).toBeEnabled();
  });

  it("announces a short status line only while the change is being confirmed", async () => {
    let resolveToggle: () => void = () => undefined;
    const onToggle = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveToggle = resolve;
        }),
    );
    render(<TasteLearningSection enabled={true} onToggle={onToggle} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await userEvent.click(
      await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(tasteLearningCopy.saving);

    resolveToggle();
    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  it("follows the enabled prop after mount instead of freezing at the initial value", async () => {
    const { rerender } = render(<TasteLearningSection enabled={true} onToggle={vi.fn()} />);
    const toggle = await screen.findByRole("switch", { name: tasteLearningCopy.toggleLabel });
    expect(toggle).toBeChecked();

    rerender(<TasteLearningSection enabled={false} onToggle={vi.fn()} />);
    expect(screen.getByRole("switch", { name: tasteLearningCopy.toggleLabel })).not.toBeChecked();
  });
});
