import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { YEARLY_CONFIRM_COPY, STRIPE_REDIRECT_NOTICE } from "./billing-ui-copy";
import { CheckoutIntervalForm } from "./checkout-interval-form";

describe("CheckoutIntervalForm", () => {
  it("starts monthly checkout without year confirm", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    render(<CheckoutIntervalForm onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Plus をはじめる" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("month");
    });
  });

  it("requires yearly confirmation before submit", async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    render(<CheckoutIntervalForm onSubmit={onSubmit} />);
    await user.click(screen.getByLabelText(/年額 5,800 円/));
    expect(screen.getByText(YEARLY_CONFIRM_COPY)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Plus をはじめる" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("年額のお支払いについて確認にチェックを入れてください")).toBeVisible();
    await user.click(screen.getByLabelText(YEARLY_CONFIRM_COPY));
    await user.click(screen.getByRole("button", { name: "Plus をはじめる" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("year");
    });
  });

  it("disables primary button when disabled", () => {
    render(<CheckoutIntervalForm onSubmit={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: "Plus をはじめる" })).toBeDisabled();
  });

  it("shows Stripe redirect notice", () => {
    render(<CheckoutIntervalForm onSubmit={vi.fn()} />);
    expect(screen.getByText(STRIPE_REDIRECT_NOTICE)).toBeVisible();
  });
});
