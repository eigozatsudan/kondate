import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InlineNotice } from "./inline-notice";

/**
 * WizardFrame / ChoiceCard / ProgressIndicator / ReviewRow は参照ゼロの死コードとして
 * Phase 1 Task 1.0 で削除した。残すのは live 参照のある InlineNotice のみ。
 */
describe("InlineNotice", () => {
  it("uses alert only for errors", () => {
    const { rerender } = render(
      <InlineNotice tone="notice" title="お知らせ">
        保存しました
      </InlineNotice>,
    );
    expect(screen.getByRole("note")).toHaveTextContent("保存しました");
    rerender(
      <InlineNotice tone="warning" title="確認してください">
        入力を見直してください
      </InlineNotice>,
    );
    expect(screen.getByRole("note")).toHaveTextContent("入力を見直してください");
    rerender(
      <InlineNotice tone="error" title="保存できません">
        再試行してください
      </InlineNotice>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("再試行してください");
  });

  it("accepts block content without nesting it in paragraphs", () => {
    render(
      <InlineNotice tone="notice" title="詳細">
        <div>お知らせのブロック要素</div>
      </InlineNotice>,
    );
    expect(screen.getByText("お知らせのブロック要素").parentElement).toHaveClass(
      "inline-notice-body",
    );
  });
});
