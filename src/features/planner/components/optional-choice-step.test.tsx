import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi, afterEach } from "vitest";
import { OptionalChoiceStep } from "./optional-choice-step";

const options = [
  { value: "", label: "指定なし" },
  { value: "15", label: "15分以内" },
  { value: "30", label: "30分以内" },
] as const;

type Handlers = {
  onSelect: ReturnType<typeof vi.fn<(selected: string) => void>>;
  onNext: ReturnType<typeof vi.fn<() => void>>;
  onBack: ReturnType<typeof vi.fn<() => void>>;
};

function setup(overrides: Partial<Parameters<typeof OptionalChoiceStep>[0]> = {}): Handlers {
  const handlers: Handlers = {
    onSelect: vi.fn<(selected: string) => void>(),
    onNext: vi.fn<() => void>(),
    onBack: vi.fn<() => void>(),
  };
  render(
    <OptionalChoiceStep
      id="planner-time-limit"
      title="5. 調理時間"
      options={options}
      value=""
      onSelect={handlers.onSelect}
      onNext={handlers.onNext}
      onBack={handlers.onBack}
      {...overrides}
    />,
  );
  return handlers;
}

/** 実機と同じ経路（label の pointerup）を通すため、input ではなく .wizard-option を叩く。 */
function optionLabel(name: string): HTMLElement {
  const input = screen.getByRole("radio", { name });
  const label = input.closest("label.wizard-option");
  if (label === null) throw new Error(`.wizard-option が見つからない: ${name}`);
  return label as HTMLElement;
}

/** mount 後 350ms のガード（設計 P-03）を抜けるまで進める。 */
async function passActivationGuard(): Promise<void> {
  vi.setSystemTime(Date.now() + 400);
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

test("selects 指定なし by default", () => {
  setup();
  expect(screen.getByRole("radio", { name: "指定なし" })).toBeChecked();
});

test("does not render a 次へ button", () => {
  setup();
  expect(screen.queryByRole("button", { name: "次へ" })).not.toBeInTheDocument();
});

test("advances once when tapping an unselected card", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const handlers = setup();
  await passActivationGuard();
  await user.click(optionLabel("15分以内"));
  expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  expect(handlers.onSelect).toHaveBeenCalledWith("15");
  expect(handlers.onNext).toHaveBeenCalledTimes(1);
});

test("advances once when re-tapping the already selected 指定なし", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const handlers = setup();
  await passActivationGuard();
  await user.click(optionLabel("指定なし"));
  expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  expect(handlers.onSelect).toHaveBeenCalledWith("");
  expect(handlers.onNext).toHaveBeenCalledTimes(1);
});

test("advances once when re-tapping an already selected non-default card", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const handlers = setup({ value: "30" });
  await passActivationGuard();
  await user.click(optionLabel("30分以内"));
  expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  expect(handlers.onNext).toHaveBeenCalledTimes(1);
});

test("advances once when pressing Space on a focused radio", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const handlers = setup();
  await passActivationGuard();
  screen.getByRole("radio", { name: "15分以内" }).focus();
  await user.keyboard(" ");
  expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  expect(handlers.onSelect).toHaveBeenCalledWith("15");
  expect(handlers.onNext).toHaveBeenCalledTimes(1);
});

test("updates the value without advancing on an arrow-key change", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const handlers = setup();
  await passActivationGuard();
  screen.getByRole("radio", { name: "指定なし" }).focus();
  await user.keyboard("{ArrowDown}");
  expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  expect(handlers.onNext).not.toHaveBeenCalled();
});

test("ignores the first activation inside the 350ms guard", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const handlers = setup();
  await user.click(optionLabel("15分以内"));
  expect(handlers.onSelect).not.toHaveBeenCalled();
  expect(handlers.onNext).not.toHaveBeenCalled();
});

test("ignores a change inside the 350ms guard", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const handlers = setup();
  screen.getByRole("radio", { name: "指定なし" }).focus();
  await user.keyboard("{ArrowDown}");
  expect(handlers.onSelect).not.toHaveBeenCalled();
});

test("stays usable after an activation was blocked by the guard", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const handlers = setup();
  await user.click(optionLabel("15分以内"));
  expect(handlers.onNext).not.toHaveBeenCalled();
  await passActivationGuard();
  await user.click(optionLabel("30分以内"));
  expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  expect(handlers.onSelect).toHaveBeenCalledWith("30");
  expect(handlers.onNext).toHaveBeenCalledTimes(1);
});

test("hides the skip button unless onSkipRest is given", () => {
  setup();
  expect(
    screen.queryByRole("button", { name: "以降は指定なしでスキップ" }),
  ).not.toBeInTheDocument();
});

test("shows the skip button when onSkipRest is given", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const onSkipRest = vi.fn();
  setup({ onSkipRest });
  await passActivationGuard();
  await user.click(screen.getByRole("button", { name: "以降は指定なしでスキップ" }));
  expect(onSkipRest).toHaveBeenCalledTimes(1);
});

test("ignores 戻る inside the 350ms guard", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const handlers = setup();
  await user.click(screen.getByRole("button", { name: "戻る" }));
  expect(handlers.onBack).not.toHaveBeenCalled();
});

test("runs 戻る after the guard", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const handlers = setup();
  await passActivationGuard();
  await user.click(screen.getByRole("button", { name: "戻る" }));
  expect(handlers.onBack).toHaveBeenCalledTimes(1);
});

test("ignores the skip button inside the 350ms guard", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const onSkipRest = vi.fn();
  setup({ onSkipRest });
  await user.click(screen.getByRole("button", { name: "以降は指定なしでスキップ" }));
  expect(onSkipRest).not.toHaveBeenCalled();
});

test("keeps the description in aria-describedby while an error is shown", () => {
  setup({ description: "説明文です。", errorMessage: "選び直してください。" });
  const group = screen.getByRole("radiogroup");
  const describedBy = (group.getAttribute("aria-describedby") ?? "").split(" ");
  expect(describedBy).toContain("planner-time-limit-description");
  expect(describedBy).toContain("planner-time-limit-error");
});
