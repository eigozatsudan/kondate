import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppToastProvider, useAppToast } from "./app-toast";
import { vi } from "vitest";

function Probe({ msg }: { msg: string }) {
  const t = useAppToast();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          t.show({ message: msg, tone: "error" });
        }}
      >
        show
      </button>
      <button
        type="button"
        onClick={() => {
          t.show({ message: "二件目", tone: "error" });
        }}
      >
        show2
      </button>
    </>
  );
}

it("shows status toast and replaces on second show", async () => {
  const user = userEvent.setup();
  render(
    <AppToastProvider>
      <Probe msg="食事の時間帯を選んでください" />
    </AppToastProvider>,
  );
  await user.click(screen.getByRole("button", { name: "show" }));
  expect(screen.getByRole("status")).toHaveTextContent("食事の時間帯を選んでください");
  expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  await user.click(screen.getByRole("button", { name: "show2" }));
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent("二件目");
});

it("does not dismiss while hovered", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(
    <AppToastProvider>
      <Probe msg="保持" />
    </AppToastProvider>,
  );
  await user.click(screen.getByRole("button", { name: "show" }));
  const toast = screen.getByRole("status");
  await user.hover(toast);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(7000);
  });
  expect(screen.getByRole("status")).toHaveTextContent("保持");
  await user.unhover(toast);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(7000);
  });
  expect(screen.queryByRole("status")).toBeNull();
  vi.useRealTimers();
});

it("L7: Escape dismisses toast so keyboard can stop the 6s limit", async () => {
  const user = userEvent.setup();
  render(
    <AppToastProvider>
      <Probe msg="保持" />
    </AppToastProvider>,
  );
  await user.click(screen.getByRole("button", { name: "show" }));
  expect(screen.getByRole("status")).toHaveTextContent("保持");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("status")).toBeNull();
});

it("L7: focusing the close button pauses auto-dismiss", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(
    <AppToastProvider>
      <Probe msg="保持" />
    </AppToastProvider>,
  );
  await user.click(screen.getByRole("button", { name: "show" }));
  const close = screen.getByRole("button", { name: "閉じる" });
  close.focus();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(7000);
  });
  expect(screen.getByRole("status")).toHaveTextContent("保持");
  await user.click(close);
  expect(screen.queryByRole("status")).toBeNull();
  vi.useRealTimers();
});
