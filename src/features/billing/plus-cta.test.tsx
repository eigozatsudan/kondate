import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PLUS_HARD_LIMIT_BUTTON, PLUS_HARD_LIMIT_COPY, PlusHardLimitCta } from "./plus-cta";

describe("PlusHardLimitCta", () => {
  it("shows fixed hard-limit copy and settings link", () => {
    render(<PlusHardLimitCta />);
    expect(screen.getByText(PLUS_HARD_LIMIT_COPY)).toBeVisible();
    const link = screen.getByRole("link", { name: PLUS_HARD_LIMIT_BUTTON });
    expect(link).toBeVisible();
    expect(link).toHaveAttribute("href", "/settings");
  });
});
