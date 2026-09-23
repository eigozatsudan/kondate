import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tasteLearningCopy } from "./taste-learning-copy";
import { TasteLearningSettingsSection } from "./taste-learning-settings-section";

const getTasteLearningEnabledMock = vi.hoisted(() => vi.fn());
const setTasteLearningEnabledMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({}),
}));

vi.mock("./taste-learning-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./taste-learning-api")>();
  return {
    ...actual,
    getTasteLearningEnabled: getTasteLearningEnabledMock,
    setTasteLearningEnabled: setTasteLearningEnabledMock,
  };
});

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("TasteLearningSettingsSection", () => {
  beforeEach(() => {
    getTasteLearningEnabledMock.mockReset();
    setTasteLearningEnabledMock.mockReset();
  });

  it("always shows the heading and the disclosure copy even before the read settles", () => {
    getTasteLearningEnabledMock.mockReturnValue(new Promise(() => undefined));
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    expect(screen.getByRole("heading", { name: tasteLearningCopy.title })).toBeInTheDocument();
    expect(screen.getByText(/料理名と食材名/u)).toBeInTheDocument();
    expect(screen.getByText(/90日/u)).toBeInTheDocument();
  });

  it("shows a loading line with the switch disabled while the initial read is in flight", () => {
    getTasteLearningEnabledMock.mockReturnValue(new Promise(() => undefined));
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    expect(screen.getByRole("status")).toHaveTextContent(tasteLearningCopy.loading);
    expect(screen.getByRole("switch", { name: "好みの学習" })).toBeDisabled();
  });

  it("loads the stored value and shows it on the switch", async () => {
    getTasteLearningEnabledMock.mockResolvedValue(true);
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "好みの学習" })).toBeChecked();
    });
    expect(screen.getByRole("switch", { name: "好みの学習" })).toBeEnabled();
  });

  it("shows an error line and a retry affordance when the read fails, with the copy still visible", async () => {
    getTasteLearningEnabledMock.mockRejectedValue(new Error("boom"));
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(tasteLearningCopy.loadError);
    });
    expect(screen.getByRole("button", { name: tasteLearningCopy.retry })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "好みの学習" })).toBeDisabled();
    expect(screen.getByText(/料理名と食材名/u)).toBeInTheDocument();

    getTasteLearningEnabledMock.mockResolvedValue(true);
    await userEvent.click(screen.getByRole("button", { name: tasteLearningCopy.retry }));
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "好みの学習" })).toBeChecked();
    });
  });

  it("round-trips a toggle through the RPC, updates the cache, and reflects it on the switch", async () => {
    // 初回読み取りは true、成功後の invalidate による裏取り再読は false（RPC 結果と一致）
    getTasteLearningEnabledMock.mockResolvedValueOnce(true).mockResolvedValue(false);
    setTasteLearningEnabledMock.mockResolvedValue(false);
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    const toggle = await screen.findByRole("switch", { name: "好みの学習" });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    await userEvent.click(toggle);

    await waitFor(() => {
      expect(setTasteLearningEnabledMock).toHaveBeenCalledWith(expect.anything(), false);
    });
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "好みの学習" })).not.toBeChecked();
    });
  });

  it("restores the previous value on the switch when the write fails", async () => {
    getTasteLearningEnabledMock.mockResolvedValue(true);
    setTasteLearningEnabledMock.mockRejectedValue(new Error("boom"));
    renderWithClient(<TasteLearningSettingsSection userId="user-1" />);
    const toggle = await screen.findByRole("switch", { name: "好みの学習" });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    await userEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "好みの学習" })).toBeChecked();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/変更できませんでした/u);
  });
});
