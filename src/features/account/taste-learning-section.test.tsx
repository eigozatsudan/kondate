import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TasteLearningSection } from "./taste-learning-section";

function renderSection(props: Parameters<typeof TasteLearningSection>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TasteLearningSection {...props} />
    </QueryClientProvider>,
  );
}

describe("TasteLearningSection", () => {
  it("shows the stored value and the disclosure copy", async () => {
    renderSection({ enabled: true, onToggle: vi.fn() });
    const toggle = await screen.findByRole("switch", { name: "好みの学習" });
    expect(toggle).toBeChecked();
    expect(screen.getByText(/料理名と食材名/u)).toBeInTheDocument();
    expect(screen.getByText(/90日/u)).toBeInTheDocument();
  });

  it("sends the next value on toggle", async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    renderSection({ enabled: true, onToggle });
    await userEvent.click(await screen.findByRole("switch", { name: "好みの学習" }));
    await waitFor(() => {
      expect(onToggle).toHaveBeenCalledWith(false);
    });
  });

  it("restores the previous state when the update fails", async () => {
    const onToggle = vi.fn().mockRejectedValue(new Error("boom"));
    renderSection({ enabled: true, onToggle });
    await userEvent.click(await screen.findByRole("switch", { name: "好みの学習" }));
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "好みの学習" })).toBeChecked();
    });
    expect(screen.getByRole("status")).toHaveTextContent(/変更できませんでした/u);
  });
});
