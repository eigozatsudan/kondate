import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { normalizeOtpDigits, OtpDigitField } from "./otp-digit-field";

const DIGIT_LABELS = [
  "確認番号の1けた目",
  "確認番号の2けた目",
  "確認番号の3けた目",
  "確認番号の4けた目",
  "確認番号の5けた目",
  "確認番号の6けた目",
] as const;

function getDigitBox(name: string): HTMLElement {
  const textbox = screen.queryByRole("textbox", { name });
  if (textbox !== null) return textbox;
  return screen.getByRole("spinbutton", { name });
}

describe("normalizeOtpDigits", () => {
  it("normalizes fullwidth digits with NFKC", () => {
    expect(normalizeOtpDigits("１２３４５６")).toBe("123456");
  });

  it("keeps only ASCII digits", () => {
    expect(normalizeOtpDigits("12ab34")).toBe("1234");
  });

  it("caps a 7-digit paste at the first 6 digits", () => {
    expect(normalizeOtpDigits("1234567")).toBe("123456");
  });
});

describe("OtpDigitField", () => {
  it("renders 6 labeled digit boxes", () => {
    render(<OtpDigitField value="" disabled={false} onChange={() => undefined} />);

    const boxes = DIGIT_LABELS.map((name) => getDigitBox(name));
    expect(boxes).toHaveLength(6);
  });

  it("reports the first typed digit", async () => {
    const onChange = vi.fn();
    render(<OtpDigitField value="" disabled={false} onChange={onChange} />);

    await userEvent.type(getDigitBox("確認番号の1けた目"), "3");

    expect(onChange).toHaveBeenCalledWith("3");
  });

  it("prefixes existing digits before the paste target", async () => {
    const onChange = vi.fn();
    render(<OtpDigitField value="12" disabled={false} onChange={onChange} />);

    const third = getDigitBox("確認番号の3けた目");
    third.focus();
    await userEvent.paste("3456");

    expect(onChange).toHaveBeenCalledWith("123456");
  });

  it("deletes the focused digit on Backspace", async () => {
    const onChange = vi.fn();
    render(<OtpDigitField value="12" disabled={false} onChange={onChange} />);

    await userEvent.type(getDigitBox("確認番号の2けた目"), "{Backspace}");

    expect(onChange).toHaveBeenCalledWith("1");
  });

  it("blocks input while disabled", async () => {
    const onChange = vi.fn();
    render(<OtpDigitField value="" disabled={true} onChange={onChange} />);

    const first = getDigitBox("確認番号の1けた目");
    expect(first).toBeDisabled();
    await userEvent.type(first, "3");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not call onChange when Enter is pressed during composition", () => {
    const onChange = vi.fn();
    render(<OtpDigitField value="" disabled={false} onChange={onChange} />);

    const first = getDigitBox("確認番号の1けた目");
    fireEvent.compositionStart(first);
    fireEvent.keyDown(first, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
  });
});
