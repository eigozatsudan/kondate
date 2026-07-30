import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppToastProvider } from "@/shared/ui/app-toast";
import { IngredientStep } from "./ingredient-step";

describe("IngredientStep incomplete UX", () => {
  it("ingredients incomplete: no alertdialog; toast+alert with locked copy", async () => {
    const user = userEvent.setup();
    render(
      <AppToastProvider>
        <IngredientStep value={[]} onChange={vi.fn()} onNext={vi.fn()} />
      </AppToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("メイン食材を1つ以上選んでください");
    expect(screen.getByRole("status")).toHaveTextContent("メイン食材を1つ以上選んでください");
    // focus はメイン食材 text input（チップ button ではない）
    expect(screen.getByRole("textbox")).toHaveFocus();
  });
});
